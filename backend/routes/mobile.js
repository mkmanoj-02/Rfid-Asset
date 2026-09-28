const express = require('express');
const router = express.Router();
const db = require('../db');
const { trimAttrName } = require('../attributeNameUtil');
const { filterAttributesByPrivilege } = require('../lib/assetScope');
const {
  scopeAssetWhere,
  canModify,
  locationAllowed,
  assetTypeAllowed,
  assetInScope,
} = require('../lib/userAuthz');
const { withTransaction } = require('../lib/importHelpers');
const { normalizeRfidTag, shouldLogRfidTagMovement, insertRfidTagMovement } = require('../lib/rfidMovements');
const {
  resolveAssetImageOnCreate,
  resolveAssetImageOnUpdate,
  safeUnlinkCustomAssetFile,
  safeUnlinkImageUrl,
} = require('../controllers/imageInheritance');
const {
  uploadImageMiddleware,
  handleMulterImageError,
  uploadAttachmentMiddleware,
  handleMulterAttachmentError,
  publicUrlForStoredFile,
  ENTITY_UPLOAD_SUBDIR,
} = require('../helper/upload');
const { requireModify } = require('../middleware/requireAuthz');
const { runRules } = require('../ruleEngine');
const audit = require('../audit');
const fs = require('fs').promises;

const FIELD_TYPE = { string: 'TEXT', double: 'NUMBER', date: 'DATE', list: 'LIST' };

function toKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function absoluteUrl(req, url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${req.protocol}://${req.get('host')}${url.startsWith('/') ? '' : '/'}${url}`;
}

function placeholders(arr) {
  return arr.map(() => '?').join(',');
}

/**
 * GET /api/mobile/asset-types
 * Android: asset types with attribute definitions.
 * fieldType: TEXT | NUMBER | DATE | LIST (LIST includes `options`).
 */
router.get('/asset-types', async (req, res, next) => {
  try {
    const allowedIds = req.authz?.typeIds ?? null;
    let typeSql = 'SELECT id, name, image_url FROM asset_types';
    const typeParams = [];
    if (allowedIds?.length) {
      typeSql += ` WHERE id IN (${placeholders(allowedIds)})`;
      typeParams.push(...allowedIds);
    }
    typeSql += ' ORDER BY name';
    const [types] = await db.query(typeSql, typeParams);
    if (!types.length) return res.json({ assetTypes: [] });

    const typeIds = types.map((t) => t.id);
    const [attrRows] = await db.query(
      `SELECT id, asset_type_id, name, attr_type
       FROM asset_type_attributes
       WHERE asset_type_id IN (${placeholders(typeIds)})
       ORDER BY sort_order, id`,
      typeIds
    );
    const attrs = filterAttributesByPrivilege(attrRows, req.authz);

    const listAttrIds = attrs.filter((a) => a.attr_type === 'list').map((a) => a.id);
    const optionsByAttr = new Map();
    if (listAttrIds.length) {
      const [opts] = await db.query(
        `SELECT attribute_id, option_value
         FROM attribute_list_options
         WHERE attribute_id IN (${placeholders(listAttrIds)})
         ORDER BY sort_order, id`,
        listAttrIds
      );
      for (const o of opts) {
        if (!optionsByAttr.has(o.attribute_id)) optionsByAttr.set(o.attribute_id, []);
        optionsByAttr.get(o.attribute_id).push(o.option_value);
      }
    }

    const attrsByType = new Map();
    for (const a of attrs) {
      const label = trimAttrName(a.name);
      const seen = attrsByType.get(a.asset_type_id) || { names: new Set(), defs: [] };
      if (seen.names.has(label)) continue;
      seen.names.add(label);
      const def = {
        id: a.id,
        key: toKey(label),
        label,
        fieldType: FIELD_TYPE[a.attr_type] || 'TEXT',
      };
      if (a.attr_type === 'list') def.options = optionsByAttr.get(a.id) || [];
      seen.defs.push(def);
      attrsByType.set(a.asset_type_id, seen);
    }

    res.json({
      assetTypes: types.map((t) => ({
        id: t.id,
        name: t.name,
        image: absoluteUrl(req, t.image_url),
        attributeDefs: attrsByType.get(t.id)?.defs || [],
      })),
    });
  } catch (err) {
    next(err);
  }
});

function toEpochMs(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Assets in the user's scope, in the Android asset shape.
 * inventoryStatus: inventory | missing (not_in_inventory is reported as missing).
 * status: UNTAGGED (no rfid) | MISSING | INVENTORIED.
 */
async function fetchMobileAssets(req, extraConditions = [], extraParams = []) {
  const scoped = scopeAssetWhere(req.authz, 'a', extraConditions, extraParams);
  const [rows] = await db.query(
    `SELECT a.id, a.asset_serial, a.name, a.asset_type_id, a.current_location_id, a.rfid_tag,
            a.description, a.image_url, a.attachment_url, a.attachment_name,
            a.asset_inventory_status, a.updated_at,
            (SELECT MAX(mh.moved_at) FROM movement_history mh WHERE mh.asset_id = a.id) AS last_seen
     FROM assets a
     ${scoped.sql}
     ORDER BY a.name ASC, a.id ASC`,
    scoped.params
  );
  if (!rows.length) return [];

  const assetIds = rows.map((r) => r.id);
  const [valueRows] = await db.query(
    `SELECT aav.asset_id, aav.value, ata.name
     FROM asset_attribute_values aav
     JOIN asset_type_attributes ata ON ata.id = aav.attribute_id
     WHERE aav.asset_id IN (${placeholders(assetIds)})
     ORDER BY ata.sort_order, ata.id`,
    assetIds
  );
  const attrsByAsset = new Map();
  for (const v of filterAttributesByPrivilege(valueRows, req.authz)) {
    const key = toKey(trimAttrName(v.name));
    if (!key) continue;
    if (!attrsByAsset.has(v.asset_id)) attrsByAsset.set(v.asset_id, {});
    const obj = attrsByAsset.get(v.asset_id);
    if (!(key in obj)) obj[key] = v.value;
  }

  return rows.map((a) => {
    const rfid = a.rfid_tag && String(a.rfid_tag).trim() ? a.rfid_tag : null;
    const inventoryStatus = a.asset_inventory_status === 'in_inventory' ? 'inventory' : 'missing';
    let status = 'INVENTORIED';
    if (!rfid) status = 'UNTAGGED';
    else if (inventoryStatus === 'missing') status = 'MISSING';
    return {
      id: a.id,
      serial: a.asset_serial,
      name: a.name,
      assetTypeId: a.asset_type_id,
      locationId: a.current_location_id,
      rfid,
      description: a.description || '',
      imageUrl: absoluteUrl(req, a.image_url),
      attachmentUrl: absoluteUrl(req, a.attachment_url),
      attachmentName: a.attachment_name || null,
      attributes: attrsByAsset.get(a.id) || {},
      status,
      inventoryStatus,
      lastSeenAt: toEpochMs(a.last_seen),
      updatedAt: toEpochMs(a.updated_at),
    };
  });
}

async function fetchMobileAsset(req, id) {
  const [asset] = await fetchMobileAssets(req, ['a.id = ?'], [id]);
  return asset || null;
}

/**
 * GET /api/mobile/assets[?since=<ISO datetime>][&untagged=true][&q=<text>]
 * Android: every asset the user may see.
 * untagged=true: only assets without an RFID tag.
 * q: search serial, name, or attribute value.
 */
router.get('/assets', async (req, res, next) => {
  try {
    const extraConditions = [];
    const extraParams = [];
    const { since, untagged } = req.query;
    if (since !== undefined && since !== '') {
      const d = new Date(String(since));
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ message: 'Invalid since; use ISO 8601 datetime' });
      }
      extraConditions.push('a.updated_at > ?');
      extraParams.push(d);
    }
    if (String(untagged).toLowerCase() === 'true' || untagged === '1') {
      extraConditions.push("(a.rfid_tag IS NULL OR TRIM(a.rfid_tag) = '')");
    }
    const q = String(req.query.q ?? '').trim();
    if (q) {
      const like = `%${q}%`;
      extraConditions.push(`(
        a.asset_serial LIKE ? OR a.name LIKE ? OR EXISTS (
          SELECT 1 FROM asset_attribute_values aavq
          WHERE aavq.asset_id = a.id AND aavq.value LIKE ?
        )
      )`);
      extraParams.push(like, like, like);
    }

    res.json({ assets: await fetchMobileAssets(req, extraConditions, extraParams) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/mobile/assets/lookup?rfid=<epc>
 * Duplicate-tag check: 200 with the asset holding this tag, 404 if the tag is free.
 * Assets outside the user's scope return only id, serial, name, rfid.
 */
router.get('/assets/lookup', async (req, res, next) => {
  try {
    const rfid = normalizeRfidTag(req.query.rfid);
    if (!rfid) return res.status(400).json({ message: 'rfid query parameter is required' });

    const [rows] = await db.query(
      'SELECT id, asset_serial, name, rfid_tag FROM assets WHERE rfid_tag = ? LIMIT 1',
      [rfid]
    );
    if (!rows.length) return res.status(404).json({ message: 'Tag is not assigned to any asset' });

    const row = rows[0];
    if (await assetInScope(req.authz, row.id)) {
      const asset = await fetchMobileAsset(req, row.id);
      if (asset) return res.json(asset);
    }
    res.json({ id: row.id, serial: row.asset_serial, name: row.name, rfid: row.rfid_tag, inScope: false });
  } catch (err) {
    next(err);
  }
});

async function loadAssetForChange(req, res) {
  const id = toPositiveInt(req.params.id);
  if (!id) {
    res.status(400).json({ message: 'Invalid asset ID' });
    return null;
  }
  const [rows] = await db.query(
    `SELECT id, name, asset_serial, rfid_tag, asset_type_id, current_location_id, image_url, is_custom_image,
            attachment_url, attachment_name
     FROM assets WHERE id = ?`,
    [id]
  );
  if (!rows.length) {
    res.status(404).json({ message: 'Asset not found' });
    return null;
  }
  if (!(await assetInScope(req.authz, id))) {
    res.status(403).json({ message: 'Asset not allowed for this user' });
    return null;
  }
  return rows[0];
}

async function removeUploadedFile(file) {
  if (!file?.path) return;
  try { await fs.unlink(file.path); } catch {}
}

/**
 * GET /api/mobile/assets/:id — single asset (404 when missing or outside the user's scope).
 */
router.get('/assets/:id', async (req, res, next) => {
  try {
    const id = toPositiveInt(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid asset ID' });
    const asset = await fetchMobileAsset(req, id);
    if (!asset) return res.status(404).json({ message: 'Asset not found' });
    res.json(asset);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/mobile/assets/:id
 * Partial update: locationId (Update Location) and/or name, description, attributes (Edit Asset).
 * serial, assetTypeId, rfid and imageUrl are ignored.
 */
router.patch('/assets/:id', requireModify('asset'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const asset = await loadAssetForChange(req, res);
    if (!asset) return;

    const sets = [];
    const params = [];
    const changes = [];

    let newLocationId = null;
    if (body.locationId !== undefined) {
      newLocationId = toPositiveInt(body.locationId);
      if (!newLocationId) return res.status(400).json({ message: 'Invalid locationId' });
      if (!locationAllowed(req.authz, newLocationId)) {
        return res.status(403).json({ message: 'Location not allowed for this user' });
      }
      const [[loc]] = await db.query('SELECT id FROM locations WHERE id = ?', [newLocationId]);
      if (!loc) return res.status(404).json({ message: `Location ${newLocationId} not found` });
      if (newLocationId === asset.current_location_id) {
        newLocationId = null;
      } else {
        sets.push('current_location_id = ?');
        params.push(newLocationId);
        changes.push(`location ${asset.current_location_id ?? 'none'} → ${newLocationId}`);
      }
    }

    if (body.name !== undefined) {
      const name = String(body.name ?? '').trim();
      if (!name) return res.status(400).json({ message: 'name cannot be empty' });
      sets.push('name = ?');
      params.push(name);
      changes.push('name');
    }

    if (body.description !== undefined) {
      sets.push('description = ?');
      params.push(body.description ? String(body.description) : null);
      changes.push('description');
    }

    const hasAttributes =
      body.attributes && typeof body.attributes === 'object' && !Array.isArray(body.attributes);
    if (hasAttributes) changes.push('attributes');

    if (changes.length) {
      await withTransaction(db, async (conn) => {
        sets.push('updated_at = CURRENT_TIMESTAMP');
        await conn.query(`UPDATE assets SET ${sets.join(', ')} WHERE id = ?`, [...params, asset.id]);
        if (hasAttributes && asset.asset_type_id) {
          await saveAttributes(conn, asset.id, asset.asset_type_id, body.attributes, new Map());
        }
        if (newLocationId) {
          await conn.query(
            'INSERT INTO movement_history (asset_id, from_location_id, to_location_id, notes) VALUES (?, ?, ?, ?)',
            [asset.id, asset.current_location_id, newLocationId, 'Handheld location update']
          );
        }
      });

      if (newLocationId) {
        setImmediate(() => runRules().catch((e) => console.error('Rule engine error:', e.message)));
      }
      await audit.log(
        'Asset',
        'Modified',
        `Asset "${asset.name}" (Serial: ${asset.asset_serial || 'N/A'}) updated from handheld: ${changes.join(', ')}`,
        req.auditUser,
        req.auditUserId
      );
    }

    res.json(await fetchMobileAsset(req, asset.id));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/mobile/assets/:id/tag  { "rfid": "..." }
 * Assign (or replace) the RFID tag of an asset and mark it inventoried.
 * 409 with the other asset when the tag is already in use.
 */
router.post('/assets/:id/tag', requireModify('asset'), async (req, res, next) => {
  try {
    const rfid = normalizeRfidTag(req.body?.rfid);
    if (!rfid) return res.status(400).json({ message: 'rfid is required' });

    const asset = await loadAssetForChange(req, res);
    if (!asset) return;

    const [conflicts] = await db.query(
      'SELECT id, asset_serial, name, rfid_tag FROM assets WHERE rfid_tag = ? AND id <> ? LIMIT 1',
      [rfid, asset.id]
    );
    if (conflicts.length) {
      const c = conflicts[0];
      return res.status(409).json({
        message: `RFID "${rfid}" is already assigned to asset ${c.id}`,
        asset: { id: c.id, serial: c.asset_serial, name: c.name, rfid: c.rfid_tag },
      });
    }

    await withTransaction(db, async (conn) => {
      await conn.query(
        `UPDATE assets SET rfid_tag = ?, asset_inventory_status = 'in_inventory', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [rfid, asset.id]
      );
      if (shouldLogRfidTagMovement(asset.rfid_tag, rfid) && asset.current_location_id) {
        await insertRfidTagMovement(conn, asset.id, asset.current_location_id);
      }
      await conn.query('DELETE FROM unprocessed_tags WHERE tag_value = ?', [rfid]);
    });

    setImmediate(() => runRules().catch((e) => console.error('Rule engine error:', e.message)));
    await audit.log(
      'Asset',
      'Tagged',
      `Asset "${asset.name}" (Serial: ${asset.asset_serial || 'N/A'}) tagged with RFID ${rfid} from handheld`,
      req.auditUser,
      req.auditUserId
    );
    res.json(await fetchMobileAsset(req, asset.id));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'RFID already assigned to another asset' });
    next(err);
  }
});

/**
 * DELETE /api/mobile/assets/:id/rfid
 * Remove the RFID tag from an asset (user confirmed moving the tag elsewhere).
 */
router.delete('/assets/:id/rfid', requireModify('asset'), async (req, res, next) => {
  try {
    const asset = await loadAssetForChange(req, res);
    if (!asset) return;

    if (asset.rfid_tag) {
      await db.query('UPDATE assets SET rfid_tag = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [asset.id]);
      await audit.log(
        'Asset',
        'Tag removed',
        `RFID ${asset.rfid_tag} removed from asset "${asset.name}" (Serial: ${asset.asset_serial || 'N/A'}) from handheld`,
        req.auditUser,
        req.auditUserId
      );
    }
    res.json(await fetchMobileAsset(req, asset.id));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/mobile/assets/:id/image — multipart field "file".
 */
router.post(
  '/assets/:id/image',
  requireModify('asset'),
  uploadImageMiddleware('assets', 'file'),
  handleMulterImageError,
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No image provided. Send multipart/form-data with field "file".' });
      }
      const asset = await loadAssetForChange(req, res);
      if (!asset) return removeUploadedFile(req.file);

      if (Number(asset.is_custom_image) === 1 && asset.image_url) {
        await safeUnlinkCustomAssetFile(asset.image_url);
      }
      const imageUrl = publicUrlForStoredFile(ENTITY_UPLOAD_SUBDIR.assets, req.file.filename);
      await db.query(
        'UPDATE assets SET image_url = ?, is_custom_image = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [imageUrl, asset.id]
      );
      await audit.log('Asset', 'Image uploaded', `Asset ID ${asset.id}: custom image ${imageUrl} from handheld`, req.auditUser, req.auditUserId);
      res.json({ imageUrl: absoluteUrl(req, imageUrl) });
    } catch (err) {
      await removeUploadedFile(req.file);
      next(err);
    }
  }
);

/**
 * POST /api/mobile/assets/:id/attachments — multipart fields "file" and "name".
 * One attachment per asset; a new upload replaces the previous file.
 */
router.post(
  '/assets/:id/attachments',
  requireModify('asset'),
  uploadAttachmentMiddleware('file'),
  handleMulterAttachmentError,
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No file provided. Send multipart/form-data with field "file".' });
      }
      const asset = await loadAssetForChange(req, res);
      if (!asset) return removeUploadedFile(req.file);

      const attachmentName = String(req.body?.name ?? '').trim() || req.file.originalname;
      const attachmentUrl = publicUrlForStoredFile(ENTITY_UPLOAD_SUBDIR.attachments, req.file.filename);
      await db.query(
        'UPDATE assets SET attachment_url = ?, attachment_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [attachmentUrl, attachmentName, asset.id]
      );
      if (asset.attachment_url) await safeUnlinkImageUrl(asset.attachment_url);
      await audit.log('Asset', 'Attachment uploaded', `Asset ID ${asset.id}: attachment "${attachmentName}" from handheld`, req.auditUser, req.auditUserId);
      res.json({ attachmentUrl: absoluteUrl(req, attachmentUrl), attachmentName });
    } catch (err) {
      await removeUploadedFile(req.file);
      next(err);
    }
  }
);

const SYNC_INVENTORY_STATUS = { INVENTORIED: 'in_inventory', MISSING: 'missing' };

class SyncError extends Error {}

function toPositiveInt(value) {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n > 0 && String(value).trim() === String(n) ? n : null;
}

async function loadAttributeKeyMap(executor, assetTypeId, cache) {
  if (cache.has(assetTypeId)) return cache.get(assetTypeId);
  const [rows] = await executor.query(
    'SELECT id, name FROM asset_type_attributes WHERE asset_type_id = ? ORDER BY sort_order, id',
    [assetTypeId]
  );
  const map = new Map();
  for (const r of rows) {
    const key = toKey(trimAttrName(r.name));
    if (key && !map.has(key)) map.set(key, r.id);
  }
  cache.set(assetTypeId, map);
  return map;
}

async function saveAttributes(executor, assetId, assetTypeId, attributes, cache) {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return;
  const keyMap = await loadAttributeKeyMap(executor, assetTypeId, cache);
  for (const [rawKey, rawValue] of Object.entries(attributes)) {
    const attrId = keyMap.get(toKey(rawKey));
    if (!attrId) continue;
    const value = rawValue === undefined || rawValue === null || rawValue === '' ? null : String(rawValue);
    await executor.query(
      `INSERT INTO asset_attribute_values (asset_id, attribute_id, value) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [assetId, attrId, value]
    );
  }
}

async function assertUnique(executor, column, value, label, excludeId = null) {
  if (!value) return;
  const [rows] = await executor.query(
    `SELECT id FROM assets WHERE ${column} = ?${excludeId ? ' AND id <> ?' : ''} LIMIT 1`,
    excludeId ? [value, excludeId] : [value]
  );
  if (rows.length) throw new SyncError(`${label} "${value}" is already used by asset ${rows[0].id}`);
}

async function assertTypeAndLocation(authz, assetTypeId, locationId) {
  if (!assetTypeAllowed(authz, assetTypeId)) throw new SyncError('Asset type not allowed for this user');
  if (!locationAllowed(authz, locationId)) throw new SyncError('Location not allowed for this user');
  const [[type]] = await db.query('SELECT id FROM asset_types WHERE id = ?', [assetTypeId]);
  if (!type) throw new SyncError(`Asset type ${assetTypeId} not found`);
  const [[loc]] = await db.query('SELECT id FROM locations WHERE id = ?', [locationId]);
  if (!loc) throw new SyncError(`Location ${locationId} not found`);
}

async function findExistingAsset(item, action) {
  const cols = 'id, asset_serial, name, asset_type_id, current_location_id, rfid_tag, description, asset_inventory_status, image_url, is_custom_image';
  const numericId = action === 'CREATE' ? null : toPositiveInt(item.id);
  if (numericId) {
    const [rows] = await db.query(`SELECT ${cols} FROM assets WHERE id = ?`, [numericId]);
    if (rows.length) return rows[0];
  }
  const serial = String(item.serial ?? '').trim();
  if (serial) {
    const [rows] = await db.query(`SELECT ${cols} FROM assets WHERE asset_serial = ? LIMIT 1`, [serial]);
    if (rows.length) return rows[0];
  }
  return null;
}

function readSyncFields(item) {
  const status = String(item.status ?? '').trim().toUpperCase();
  const rfidRaw = normalizeRfidTag(item.rfid);
  return {
    serial: String(item.serial ?? '').trim(),
    name: String(item.name ?? '').trim(),
    assetTypeId: toPositiveInt(item.assetTypeId),
    locationId: toPositiveInt(item.locationId),
    rfidProvided: item.rfid !== undefined,
    rfid: status === 'UNTAGGED' ? null : rfidRaw || null,
    description: item.description,
    status,
    invStatus: SYNC_INVENTORY_STATUS[status] || null,
  };
}

async function createSyncedAsset(req, item, f, attrCache) {
  const missing = [];
  if (!f.serial) missing.push('serial');
  if (!f.name) missing.push('name');
  if (!f.assetTypeId) missing.push('assetTypeId');
  if (!f.locationId) missing.push('locationId');
  if (missing.length) throw new SyncError(`Missing required fields: ${missing.join(', ')}`);

  await assertTypeAndLocation(req.authz, f.assetTypeId, f.locationId);
  await assertUnique(db, 'rfid_tag', f.rfid, 'RFID');

  const { imageUrl, isCustom } = await resolveAssetImageOnCreate(f.assetTypeId, null);

  return withTransaction(db, async (conn) => {
    const [result] = await conn.query(
      `INSERT INTO assets (rfid_tag, asset_serial, name, asset_type_id, current_location_id,
         status, description, asset_inventory_status, image_url, is_custom_image)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      [
        f.rfid, f.serial, f.name, f.assetTypeId, f.locationId,
        f.description || null, f.invStatus || 'in_inventory', imageUrl, isCustom,
      ]
    );
    const id = result.insertId;

    await conn.query(
      `INSERT IGNORE INTO asset_attribute_values (asset_id, attribute_id, value)
       SELECT ?, id, NULL FROM asset_type_attributes WHERE asset_type_id = ?`,
      [id, f.assetTypeId]
    );
    await saveAttributes(conn, id, f.assetTypeId, item.attributes, attrCache);

    await conn.query(
      'INSERT INTO movement_history (asset_id, from_location_id, to_location_id, notes) VALUES (?, NULL, ?, ?)',
      [id, f.locationId, 'Initial placement']
    );
    if (shouldLogRfidTagMovement(null, f.rfid)) {
      await insertRfidTagMovement(conn, id, f.locationId);
      await conn.query('DELETE FROM unprocessed_tags WHERE tag_value = ?', [f.rfid]);
    }
    return { id, serial: f.serial, name: f.name, created: true };
  });
}

async function updateSyncedAsset(req, item, f, existing, attrCache) {
  if (!(await assetInScope(req.authz, existing.id))) {
    throw new SyncError('Asset not allowed for this user');
  }

  const next = {
    serial: f.serial || existing.asset_serial,
    name: f.name || existing.name,
    assetTypeId: f.assetTypeId || existing.asset_type_id,
    locationId: f.locationId || existing.current_location_id,
    rfid: f.status === 'UNTAGGED' || f.rfidProvided ? f.rfid : existing.rfid_tag,
    description: f.description !== undefined ? f.description || null : existing.description,
    invStatus: f.invStatus || existing.asset_inventory_status || 'in_inventory',
  };

  if (next.assetTypeId !== existing.asset_type_id || next.locationId !== existing.current_location_id) {
    await assertTypeAndLocation(req.authz, next.assetTypeId, next.locationId);
  }
  if (next.serial !== existing.asset_serial) {
    await assertUnique(db, 'asset_serial', next.serial, 'Serial', existing.id);
  }
  if (next.rfid && next.rfid !== existing.rfid_tag) {
    await assertUnique(db, 'rfid_tag', next.rfid, 'RFID', existing.id);
  }

  const image = await resolveAssetImageOnUpdate({
    existing,
    file: null,
    removeCustomImage: false,
    newAssetTypeId: next.assetTypeId,
  });

  await withTransaction(db, async (conn) => {
    await conn.query(
      `UPDATE assets SET asset_serial = ?, name = ?, asset_type_id = ?, current_location_id = ?,
         rfid_tag = ?, description = ?, asset_inventory_status = ?, image_url = ?, is_custom_image = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        next.serial, next.name, next.assetTypeId, next.locationId, next.rfid, next.description,
        next.invStatus, image.imageUrl, image.isCustom, existing.id,
      ]
    );
    await saveAttributes(conn, existing.id, next.assetTypeId, item.attributes, attrCache);

    if (next.locationId && next.locationId !== existing.current_location_id) {
      await conn.query(
        'INSERT INTO movement_history (asset_id, from_location_id, to_location_id, notes) VALUES (?, ?, ?, ?)',
        [existing.id, existing.current_location_id, next.locationId, 'Handheld sync']
      );
    }
    if (shouldLogRfidTagMovement(existing.rfid_tag, next.rfid) && next.locationId) {
      await insertRfidTagMovement(conn, existing.id, next.locationId);
      await conn.query('DELETE FROM unprocessed_tags WHERE tag_value = ?', [next.rfid]);
    }
  });

  return { id: existing.id, serial: next.serial, name: next.name, created: false };
}

/**
 * POST /api/mobile/sync
 * Android dashboard sync: applies pending assets, returns the sync report.
 * clientAction CREATE inserts (or updates when the serial already exists);
 * anything else updates the asset matched by numeric id, then by serial.
 */
router.post('/sync', async (req, res, next) => {
  try {
    if (!canModify(req.authz, 'asset')) {
      return res.status(403).json({ message: 'You do not have permission to modify assets' });
    }
    const deviceName = String(req.body?.deviceName ?? '').trim();
    const assets = req.body?.assets;
    if (!Array.isArray(assets)) {
      return res.status(400).json({ message: 'assets array is required' });
    }

    const attrCache = new Map();
    let inventoriedCount = 0;
    let missingCount = 0;
    let createdCount = 0;
    let updatedCount = 0;
    const newlyTaggedAssets = [];
    const errors = [];

    for (const item of assets) {
      const clientId = item?.id ?? null;
      try {
        if (!item || typeof item !== 'object') throw new SyncError('Invalid asset entry');
        const action = String(item.clientAction ?? 'UPDATE').trim().toUpperCase();
        const fields = readSyncFields(item);
        const existing = await findExistingAsset(item, action);

        let saved;
        if (existing) {
          saved = await updateSyncedAsset(req, item, fields, existing, attrCache);
        } else if (action === 'CREATE') {
          saved = await createSyncedAsset(req, item, fields, attrCache);
        } else {
          throw new SyncError('Asset not found');
        }

        if (saved.created) createdCount += 1;
        else updatedCount += 1;
        if (fields.status === 'INVENTORIED') inventoriedCount += 1;
        else if (fields.status === 'MISSING') missingCount += 1;
        if (item.newlyTagged === true) {
          newlyTaggedAssets.push({ id: clientId, serverId: saved.id, serial: saved.serial, name: saved.name });
        }
      } catch (err) {
        if (!(err instanceof SyncError) && err.code !== 'ER_DUP_ENTRY') {
          console.error('Mobile sync asset error:', err);
        }
        errors.push({
          id: clientId,
          serial: item?.serial ?? null,
          message: err.code === 'ER_DUP_ENTRY' ? 'Serial or RFID already exists' : err.message,
        });
      }
    }

    if (createdCount || updatedCount) {
      setImmediate(() => runRules().catch((e) => console.error('Rule engine error:', e.message)));
      await audit.log(
        'Asset',
        'Synced',
        `Handheld sync${deviceName ? ` from "${deviceName}"` : ''}: ${createdCount} created, ${updatedCount} updated, ${errors.length} failed`,
        req.auditUser,
        req.auditUserId
      );
    }

    res.json({ inventoriedCount, missingCount, newlyTaggedAssets, errors });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/mobile/assets
 * Create an asset from the Android asset object (status is always INVENTORIED).
 */
router.post('/assets', requireModify('asset'), async (req, res, next) => {
  try {
    const item = { ...(req.body || {}), status: 'INVENTORIED' };
    const fields = readSyncFields(item);
    await assertUnique(db, 'asset_serial', fields.serial, 'Serial');
    const saved = await createSyncedAsset(req, item, fields, new Map());

    setImmediate(() => runRules().catch((e) => console.error('Rule engine error:', e.message)));
    await audit.log(
      'Asset',
      'Added',
      `Asset "${saved.name}" (Serial: ${saved.serial}) was added from handheld`,
      req.auditUser,
      req.auditUserId
    );
    res.status(201).json(await fetchMobileAsset(req, saved.id));
  } catch (err) {
    if (err instanceof SyncError) {
      let status = 400;
      if (/already used/.test(err.message)) status = 409;
      else if (/not allowed/.test(err.message)) status = 403;
      return res.status(status).json({ message: err.message });
    }
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Serial or RFID already exists' });
    next(err);
  }
});

module.exports = router;

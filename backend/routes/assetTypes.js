const express = require('express');
const router = express.Router();
const db = require('../db');
const audit = require('../audit');
const { trimAttrName } = require('../attributeNameUtil');
const resourceImages = require('../controllers/resourceImages');
const { uploadImageMiddleware, handleMulterImageError } = require('../helper/upload');
const { optionalImageUpload } = require('../middleware/optionalImageUpload');
const {
  applyAssetTypeImageUpdate,
  cleanupAssetTypeImageOnDelete,
  parseAttributesField,
  truthyFormFlag,
  safeUnlinkImageUrl,
  propagateTypeImageToInheritedAssets,
} = require('../controllers/imageInheritance');
const { publicUrlForStoredFile, ENTITY_UPLOAD_SUBDIR } = require('../helper/upload');
const { assertAssetTypeAccess } = require('../lib/userAuthz');
const { requireModify, requireDelete } = require('../middleware/requireAuthz');
const {
  normalizeAssetTypeName,
  findAssetTypeNameConflict,
} = require('../lib/assetTypeName');

router.get('/', async (req, res) => {
  const allowedIds = req.authz?.typeIds ?? null;

  let query = `SELECT at.*, p.name AS parent_name FROM asset_types at LEFT JOIN asset_types p ON at.parent_id = p.id`;
  const params = [];
  if (allowedIds?.length) {
    query += ` WHERE at.id IN (${allowedIds.map(() => '?').join(',')})`;
    params.push(...allowedIds);
  }
  query += ' ORDER BY p.name, at.name';
  const [rows] = await db.query(query, params);
  res.json(rows);
});

// --- Image: multipart field "image" (jpg, jpeg, png, webp; max 5MB) ---
router.post(
  '/:id/image',
  requireModify('asset_type'),
  uploadImageMiddleware('asset_types'),
  handleMulterImageError,
  resourceImages.upload('asset_types')
);
router.delete('/:id/image', requireModify('asset_type'), resourceImages.remove('asset_types'));

router.get('/:id', async (req, res) => {
  const typeErr = assertAssetTypeAccess(req.authz, res, req.params.id);
  if (typeErr) return typeErr;
  const [rows] = await db.query('SELECT * FROM asset_types WHERE id = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: 'Not found' });
  res.json(rows[0]);
});

router.post('/', requireModify('asset_type'), optionalImageUpload('asset_types'), async (req, res, next) => {
  try {
  const name = normalizeAssetTypeName(req.body.name);
  const { description } = req.body;
  const attributes = parseAttributesField(req.body) ?? req.body.attributes;
  if (!name) {
    return res.status(400).json({ message: 'Name is required' });
  }
  const conflict = await findAssetTypeNameConflict(db, name);
  if (conflict) {
    return res.status(400).json({
      message: `Asset type "${conflict.name}" already exists (names must be unique across all parents)`,
    });
  }

  let imageUrl = null;
  if (req.file) {
    imageUrl = publicUrlForStoredFile(ENTITY_UPLOAD_SUBDIR.asset_types, req.file.filename);
  }

  const [result] = await db.query(
    'INSERT INTO asset_types (name, description, parent_id, image_url) VALUES (?, ?, ?, ?)',
    [name, description || null, req.body.parent_id || null, imageUrl]
  );
  const typeId = result.insertId;

  if (attributes && Array.isArray(attributes) && attributes.length) {
    const seenInBatch = new Set();
    for (const attr of attributes) {
      const attrName = trimAttrName(attr.name);
      if (!attrName)
        return res.status(400).json({ message: 'Each attribute must have a non-empty name' });
      if (seenInBatch.has(attrName))
        return res.status(400).json({ message: `Duplicate attribute name in request: "${attrName}"` });
      seenInBatch.add(attrName);
    }
    for (const attr of attributes) {
      const attrName = trimAttrName(attr.name);
      const attrType = attr.attr_type || 'string';
      const defVal = attr.default_value != null ? attr.default_value : null;
      const [ins] = await db.query(
        'INSERT INTO asset_type_attributes (asset_type_id, name, attr_type, default_value) VALUES (?, ?, ?, ?)',
        [typeId, attrName, attrType, defVal]
      );
      const attrId = ins.insertId;
      if (attrType === 'list' && attr.list_options && attr.list_options.length) {
        for (let i = 0; i < attr.list_options.length; i++) {
          await db.query(
            'INSERT INTO attribute_list_options (attribute_id, option_value, sort_order) VALUES (?, ?, ?)',
            [attrId, attr.list_options[i], i]
          );
        }
      }
    }
  }

  await audit.log('Asset Type', 'Added', `Asset type "${name}" was created`, req.auditUser, req.auditUserId);
  res.status(201).json({ id: typeId, name, description, image_url: imageUrl });
  } catch (err) { next(err); }
});

router.put('/:id', requireModify('asset_type'), optionalImageUpload('asset_types'), async (req, res, next) => {
  try {
  const typeErr = assertAssetTypeAccess(req.authz, res, req.params.id);
  if (typeErr) return typeErr;
  const typeId = req.params.id;
  const name = normalizeAssetTypeName(req.body.name);
  const { description } = req.body;
  const attributes = parseAttributesField(req.body) ?? req.body.attributes;
  if (!name) {
    return res.status(400).json({ message: 'Name is required' });
  }
  const conflict = await findAssetTypeNameConflict(db, name, typeId);
  if (conflict) {
    return res.status(400).json({
      message: `Asset type "${conflict.name}" already exists (names must be unique across all parents)`,
    });
  }

  const [[typeRow]] = await db.query('SELECT image_url FROM asset_types WHERE id = ?', [typeId]);
  if (!typeRow) return res.status(404).json({ message: 'Not found' });

  let imageUrl = typeRow.image_url;
  if (truthyFormFlag(req.body.remove_image)) {
    if (imageUrl) await safeUnlinkImageUrl(imageUrl);
    imageUrl = null;
    await propagateTypeImageToInheritedAssets(typeId, null);
  } else if (req.file) {
    imageUrl = await applyAssetTypeImageUpdate(typeId, typeRow.image_url, req.file);
  }

  await db.query('UPDATE asset_types SET name = ?, description = ?, parent_id = ?, image_url = ? WHERE id = ?',
    [name, description, req.body.parent_id || null, imageUrl, typeId]);

  if (attributes && Array.isArray(attributes) && attributes.length) {
    const seenInBatch = new Set();
    for (const attr of attributes) {
      const attrName = trimAttrName(attr.name);
      if (!attrName)
        return res.status(400).json({ message: 'Each attribute must have a non-empty name' });
      if (seenInBatch.has(attrName))
        return res.status(400).json({ message: `Duplicate attribute name in request: "${attrName}"` });
      seenInBatch.add(attrName);
    }
    for (const attr of attributes) {
      const attrName = trimAttrName(attr.name);
      const attrType = attr.attr_type || 'string';
      const defVal = attr.default_value != null ? attr.default_value : null;
      if (attr.id != null && attr.id !== '') {
        const [dup] = await db.query(
          'SELECT id FROM asset_type_attributes WHERE asset_type_id = ? AND BINARY TRIM(name) = BINARY ? AND id != ?',
          [typeId, attrName, attr.id]
        );
        if (dup.length)
          return res.status(400).json({ message: `An attribute with the exact name "${attrName}" already exists for this asset type` });
        await db.query(
          'UPDATE asset_type_attributes SET name = ?, attr_type = ?, default_value = ? WHERE id = ? AND asset_type_id = ?',
          [attrName, attrType, defVal, attr.id, typeId]
        );
        if (attrType === 'list') {
          await db.query('DELETE FROM attribute_list_options WHERE attribute_id = ?', [attr.id]);
          if (attr.list_options && attr.list_options.length) {
            for (let i = 0; i < attr.list_options.length; i++) {
              await db.query(
                'INSERT INTO attribute_list_options (attribute_id, option_value, sort_order) VALUES (?, ?, ?)',
                [attr.id, attr.list_options[i], i]
              );
            }
          }
        }
      } else {
        const [dup] = await db.query(
          'SELECT id FROM asset_type_attributes WHERE asset_type_id = ? AND BINARY TRIM(name) = BINARY ?',
          [typeId, attrName]
        );
        if (dup.length)
          return res.status(400).json({ message: `An attribute with the exact name "${attrName}" already exists for this asset type` });
        const [ins] = await db.query(
          'INSERT INTO asset_type_attributes (asset_type_id, name, attr_type, default_value) VALUES (?, ?, ?, ?)',
          [typeId, attrName, attrType, defVal]
        );
        const attrId = ins.insertId;
        if (attrType === 'list' && attr.list_options && attr.list_options.length) {
          for (let i = 0; i < attr.list_options.length; i++) {
            await db.query(
              'INSERT INTO attribute_list_options (attribute_id, option_value, sort_order) VALUES (?, ?, ?)',
              [attrId, attr.list_options[i], i]
            );
          }
        }
        const [assets] = await db.query('SELECT id FROM assets WHERE asset_type_id = ?', [typeId]);
        for (const asset of assets) {
          await db.query(
            'INSERT IGNORE INTO asset_attribute_values (asset_id, attribute_id, value) VALUES (?, ?, NULL)',
            [asset.id, attrId]
          );
        }
      }
    }
  }

  await audit.log('Asset Type', 'Modified', `Asset type "${name}" was updated`, req.auditUser, req.auditUserId);
  res.json({ message: 'Updated', image_url: imageUrl });
  } catch (err) { next(err); }
});

router.delete('/bulk', requireDelete('asset_type'), async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ message: 'ids array is required' });

    for (const rawId of ids) {
      const typeErr = assertAssetTypeAccess(req.authz, res, rawId);
      if (typeErr) return typeErr;
    }

    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await db.query(`SELECT name FROM asset_types WHERE id IN (${placeholders})`, ids);
    await db.query(`DELETE FROM asset_types WHERE id IN (${placeholders})`, ids);

    for (const row of rows)
      await audit.log('Asset Type', 'Deleted', `Asset type "${row.name}" was deleted`, req.auditUser, req.auditUserId);

    res.json({ message: `${rows.length} asset type(s) deleted` });
  } catch (err) { next(err); }
});

router.delete('/:id', requireDelete('asset_type'), async (req, res, next) => {
  try {
    const id = req.params.id;
    const typeErr = assertAssetTypeAccess(req.authz, res, id);
    if (typeErr) return typeErr;
    const [[{ assetCount }]] = await db.query(
      'SELECT COUNT(*) AS assetCount FROM assets WHERE asset_type_id = ?',
      [id]
    );
    if (assetCount > 0) {
      return res.status(400).json({
        message: `Cannot delete asset type: ${assetCount} asset(s) are assigned to it.`,
      });
    }
    const [rows] = await db.query('SELECT name, image_url FROM asset_types WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Not found' });
    await cleanupAssetTypeImageOnDelete(rows[0]);
    await db.query('DELETE FROM asset_types WHERE id = ?', [id]);
    await audit.log('Asset Type', 'Deleted', `Asset type "${rows[0].name}" was deleted`, req.auditUser, req.auditUserId);
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

// --- Attributes ---

// Get all attributes for an asset type (with list options)
router.get('/:id/attributes', async (req, res) => {
  const typeErr = assertAssetTypeAccess(req.authz, res, req.params.id);
  if (typeErr) return typeErr;
  const [attrs] = await db.query(
    'SELECT * FROM asset_type_attributes WHERE asset_type_id = ? ORDER BY sort_order, id',
    [req.params.id]
  );
  const seen = new Set();
  const deduped = [];
  for (const attr of attrs) {
    const key = trimAttrName(attr.name);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(attr);
  }
  for (const attr of deduped) {
    if (attr.attr_type === 'list') {
      const [opts] = await db.query(
        'SELECT * FROM attribute_list_options WHERE attribute_id = ? ORDER BY sort_order, id',
        [attr.id]
      );
      attr.list_options = opts;
    } else {
      attr.list_options = [];
    }
  }
  res.json(deduped);
});

// Add attribute to asset type
router.post('/:id/attributes', requireModify('asset_type'), async (req, res) => {
  const typeErr = assertAssetTypeAccess(req.authz, res, req.params.id);
  if (typeErr) return typeErr;
  const { attr_type, default_value, list_options } = req.body;
  const name = trimAttrName(req.body.name);
  if (!name)
    return res.status(400).json({ message: 'Attribute name is required' });

  const [dup] = await db.query(
    'SELECT id FROM asset_type_attributes WHERE asset_type_id = ? AND BINARY TRIM(name) = BINARY ?',
    [req.params.id, name]
  );
  if (dup.length)
    return res.status(400).json({ message: `An attribute with the exact name "${name}" already exists for this asset type` });

  const [result] = await db.query(
    'INSERT INTO asset_type_attributes (asset_type_id, name, attr_type, default_value) VALUES (?, ?, ?, ?)',
    [req.params.id, name, attr_type, default_value || null]
  );
  const attrId = result.insertId;

  // Save list options if type is list
  if (attr_type === 'list' && list_options && list_options.length) {
    for (let i = 0; i < list_options.length; i++) {
      await db.query(
        'INSERT INTO attribute_list_options (attribute_id, option_value, sort_order) VALUES (?, ?, ?)',
        [attrId, list_options[i], i]
      );
    }
  }

  // Percolate: add empty value for all existing assets of this type
  const [assets] = await db.query('SELECT id FROM assets WHERE asset_type_id = ?', [req.params.id]);
  for (const asset of assets) {
    await db.query(
      'INSERT IGNORE INTO asset_attribute_values (asset_id, attribute_id, value) VALUES (?, ?, NULL)',
      [asset.id, attrId]
    );
  }

  res.status(201).json({ id: attrId, name, attr_type });
});

// Update attribute
router.put('/:typeId/attributes/:attrId', requireModify('asset_type'), async (req, res) => {
  const typeErr = assertAssetTypeAccess(req.authz, res, req.params.typeId);
  if (typeErr) return typeErr;
  const { attr_type, default_value, list_options } = req.body;
  const name = trimAttrName(req.body.name);
  if (!name)
    return res.status(400).json({ message: 'Attribute name is required' });

  const [dup] = await db.query(
    'SELECT id FROM asset_type_attributes WHERE asset_type_id = ? AND BINARY TRIM(name) = BINARY ? AND id != ?',
    [req.params.typeId, name, req.params.attrId]
  );
  if (dup.length)
    return res.status(400).json({ message: `An attribute with the exact name "${name}" already exists for this asset type` });

  await db.query(
    'UPDATE asset_type_attributes SET name = ?, attr_type = ?, default_value = ? WHERE id = ? AND asset_type_id = ?',
    [name, attr_type, default_value || null, req.params.attrId, req.params.typeId]
  );
  if (attr_type === 'list') {
    await db.query('DELETE FROM attribute_list_options WHERE attribute_id = ?', [req.params.attrId]);
    if (list_options && list_options.length) {
      for (let i = 0; i < list_options.length; i++) {
        await db.query(
          'INSERT INTO attribute_list_options (attribute_id, option_value, sort_order) VALUES (?, ?, ?)',
          [req.params.attrId, list_options[i], i]
        );
      }
    }
  }
  res.json({ message: 'Updated' });
});

// Delete attribute
router.delete('/:typeId/attributes/:attrId', requireDelete('asset_type'), async (req, res) => {
  const typeErr = assertAssetTypeAccess(req.authz, res, req.params.typeId);
  if (typeErr) return typeErr;
  // Remove all stored values for this attribute across all assets
  await db.query('DELETE FROM asset_attribute_values WHERE attribute_id = ?', [req.params.attrId]);
  // Remove list options
  await db.query('DELETE FROM attribute_list_options WHERE attribute_id = ?', [req.params.attrId]);
  // Remove the attribute definition
  await db.query('DELETE FROM asset_type_attributes WHERE id = ? AND asset_type_id = ?',
    [req.params.attrId, req.params.typeId]);
  res.json({ message: 'Deleted' });
});

module.exports = router;

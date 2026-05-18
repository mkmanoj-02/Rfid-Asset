const express = require('express');
const router = express.Router();
const db = require('../db');
const audit = require('../audit');

function parseAttributeIds(body) {
  const raw = body?.attribute_ids ?? body?.attributeIds;
  if (!Array.isArray(raw)) return null;
  return [...new Set(raw.map((id) => parseInt(id, 10)).filter((id) => Number.isInteger(id) && id > 0))];
}

async function getDeviceById(id) {
  const [rows] = await db.query(
    'SELECT id, name, description, is_active, created_at FROM handheld_devices WHERE id = ? LIMIT 1',
    [id]
  );
  return rows[0] || null;
}

async function getMappedAttributes(deviceId) {
  const [rows] = await db.query(
    `SELECT ata.id, ata.name, ata.attr_type, ata.asset_type_id
     FROM handheld_device_attributes hda
     JOIN asset_type_attributes ata ON ata.id = hda.attribute_id
     WHERE hda.device_id = ?
     ORDER BY ata.name ASC`,
    [deviceId]
  );
  return rows;
}

async function replaceMappings(deviceId, attributeIds) {
  await db.query('DELETE FROM handheld_device_attributes WHERE device_id = ?', [deviceId]);
  if (!attributeIds.length) return;
  const placeholders = attributeIds.map(() => '(?, ?)').join(', ');
  const params = attributeIds.flatMap((attrId) => [deviceId, attrId]);
  await db.query(
    `INSERT INTO handheld_device_attributes (device_id, attribute_id) VALUES ${placeholders}`,
    params
  );
}

/** Same unique attributes as GET /api/attribute-list — used as default mapping on new devices. */
async function getDefaultAttributeIds() {
  const [rows] = await db.query(
    `SELECT a.id
     FROM asset_type_attributes a
     INNER JOIN (
       SELECT MIN(id) AS id
       FROM asset_type_attributes
       GROUP BY BINARY TRIM(name)
     ) b ON a.id = b.id`
  );
  return rows.map((r) => r.id);
}

// GET all devices (with mapped attribute count)
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT d.id, d.name, d.description, d.is_active, d.created_at,
              COUNT(hda.attribute_id) AS mapped_attribute_count
       FROM handheld_devices d
       LEFT JOIN handheld_device_attributes hda ON hda.device_id = d.id
       GROUP BY d.id
       ORDER BY d.name ASC`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/handheld-devices/mobile/attributes?device_name=...
 * For Android handheld app — attributes visible for the selected device name.
 */
router.get('/mobile/attributes', async (req, res, next) => {
  try {
    const deviceName = (req.query.device_name || req.query.name || '').trim();
    if (!deviceName) {
      return res.status(400).json({ message: 'device_name query parameter is required' });
    }

    const [devices] = await db.query(
      `SELECT id, name, description, is_active FROM handheld_devices
       WHERE BINARY TRIM(name) = BINARY ? AND is_active = 1 LIMIT 1`,
      [deviceName]
    );
    if (!devices.length) {
      return res.status(404).json({ message: `Device "${deviceName}" not found or inactive` });
    }

    const device = devices[0];
    const attributes = await getMappedAttributes(device.id);
    res.json({ device, attributes });
  } catch (err) {
    next(err);
  }
});

// GET single device with mapped attributes
router.get('/:id', async (req, res, next) => {
  try {
    const device = await getDeviceById(req.params.id);
    if (!device) return res.status(404).json({ message: 'Device not found' });
    const attributes = await getMappedAttributes(device.id);
    const attribute_ids = attributes.map((a) => a.id);
    res.json({ ...device, attributes, attribute_ids });
  } catch (err) {
    next(err);
  }
});

// GET mapped attributes for device
router.get('/:id/attributes', async (req, res, next) => {
  try {
    const device = await getDeviceById(req.params.id);
    if (!device) return res.status(404).json({ message: 'Device not found' });
    const attributes = await getMappedAttributes(device.id);
    res.json({
      device_id: device.id,
      attribute_ids: attributes.map((a) => a.id),
      attributes,
    });
  } catch (err) {
    next(err);
  }
});

// CREATE device
router.post('/', async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    const description = req.body.description || null;
    const is_active = req.body.is_active !== undefined ? (req.body.is_active ? 1 : 0) : 1;

    if (!name) return res.status(400).json({ message: 'Device name is required' });

    const [existing] = await db.query(
      'SELECT id FROM handheld_devices WHERE BINARY TRIM(name) = BINARY ?',
      [name]
    );
    if (existing.length) {
      return res.status(400).json({ message: `Device "${name}" already exists` });
    }

    const [result] = await db.query(
      'INSERT INTO handheld_devices (name, description, is_active) VALUES (?, ?, ?)',
      [name, description, is_active]
    );

    const explicitIds = parseAttributeIds(req.body);
    const attributeIds = explicitIds !== null ? explicitIds : await getDefaultAttributeIds();
    await replaceMappings(result.insertId, attributeIds);

    await audit.log(
      'Handheld',
      'Added',
      `Handheld device "${name}" was created with ${attributeIds.length} attribute(s) mapped`,
      req.auditUser,
      req.auditUserId
    );
    res.status(201).json({
      id: result.insertId,
      name,
      description,
      is_active,
      mapped_attribute_count: attributeIds.length,
    });
  } catch (err) {
    next(err);
  }
});

// UPDATE device
router.put('/:id', async (req, res, next) => {
  try {
    const device = await getDeviceById(req.params.id);
    if (!device) return res.status(404).json({ message: 'Device not found' });

    const name = (req.body.name || '').trim();
    const description = req.body.description !== undefined ? (req.body.description || null) : device.description;
    const is_active = req.body.is_active !== undefined ? (req.body.is_active ? 1 : 0) : device.is_active;

    if (!name) return res.status(400).json({ message: 'Device name is required' });

    const [existing] = await db.query(
      'SELECT id FROM handheld_devices WHERE BINARY TRIM(name) = BINARY ? AND id != ?',
      [name, req.params.id]
    );
    if (existing.length) {
      return res.status(400).json({ message: `Device "${name}" already exists` });
    }

    await db.query(
      'UPDATE handheld_devices SET name = ?, description = ?, is_active = ? WHERE id = ?',
      [name, description, is_active, req.params.id]
    );

    const attributeIds = parseAttributeIds(req.body);
    if (attributeIds) await replaceMappings(req.params.id, attributeIds);

    await audit.log('Handheld', 'Modified', `Handheld device "${name}" was updated`, req.auditUser, req.auditUserId);
    res.json({ message: 'Updated' });
  } catch (err) {
    next(err);
  }
});

// REPLACE attribute mappings only
router.put('/:id/attributes', async (req, res, next) => {
  try {
    const device = await getDeviceById(req.params.id);
    if (!device) return res.status(404).json({ message: 'Device not found' });

    const attributeIds = parseAttributeIds(req.body);
    if (!attributeIds) {
      return res.status(400).json({ message: 'attribute_ids array is required' });
    }

    if (attributeIds.length) {
      const placeholders = attributeIds.map(() => '?').join(',');
      const [valid] = await db.query(
        `SELECT id FROM asset_type_attributes WHERE id IN (${placeholders})`,
        attributeIds
      );
      if (valid.length !== attributeIds.length) {
        return res.status(400).json({ message: 'One or more attribute IDs are invalid' });
      }
    }

    await replaceMappings(req.params.id, attributeIds);
    const attributes = await getMappedAttributes(req.params.id);

    await audit.log(
      'Handheld',
      'Modified',
      `Attribute mapping updated for device "${device.name}" (${attributeIds.length} attribute(s))`,
      req.auditUser,
      req.auditUserId
    );

    res.json({
      device_id: parseInt(req.params.id, 10),
      attribute_ids: attributeIds,
      attributes,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE device
router.delete('/:id', async (req, res, next) => {
  try {
    const device = await getDeviceById(req.params.id);
    if (!device) return res.status(404).json({ message: 'Device not found' });

    await db.query('DELETE FROM handheld_devices WHERE id = ?', [req.params.id]);
    await audit.log('Handheld', 'Deleted', `Handheld device "${device.name}" was deleted`, req.auditUser, req.auditUserId);
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

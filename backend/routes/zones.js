const express = require('express');
const router = express.Router();
const db = require('../db');
const audit = require('../audit');

function parseId(param) {
  const id = parseInt(param, 10);
  if (!Number.isInteger(id) || id < 1 || String(id) !== String(param).trim()) {
    return null;
  }
  return id;
}

/** Normalize and validate name; returns { name } or { error, status }. */
function parseName(body) {
  const name = String(body?.name ?? '').trim();
  if (!name) return { error: 'Name is required', status: 400 };
  if (name.length > 120) {
    return { error: 'Name is too long (max 120 characters)', status: 400 };
  }
  return { name };
}

async function findById(id) {
  const [rows] = await db.query(
    'SELECT id, name FROM zones WHERE id = ? LIMIT 1',
    [id]
  );
  return rows[0] || null;
}

async function findDuplicateName(name, excludeId = null) {
  if (excludeId) {
    const [rows] = await db.query(
      'SELECT id FROM zones WHERE LOWER(name) = LOWER(?) AND id != ? LIMIT 1',
      [name, excludeId]
    );
    return rows[0] || null;
  }
  const [rows] = await db.query(
    'SELECT id FROM zones WHERE LOWER(name) = LOWER(?) LIMIT 1',
    [name]
  );
  return rows[0] || null;
}

/** True when a `readers` table with a `zone_type` column exists (cascade target). */
async function readersZoneTypeColumnExists(conn = db) {
  const [rows] = await conn.query(
    `SELECT 1 AS ok
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'readers'
       AND column_name = 'zone_type'
     LIMIT 1`
  );
  return rows.length > 0;
}

/** Rename zone_type on every reader still using the old name. */
async function cascadeRenameOnReaders(conn, oldName, newName) {
  if (!(await readersZoneTypeColumnExists(conn))) return;
  await conn.query(
    'UPDATE readers SET zone_type = ? WHERE zone_type = ?',
    [newName, oldName]
  );
}

/** Clear zone_type to empty string on readers that used this name. */
async function cascadeClearOnReaders(conn, oldName) {
  if (!(await readersZoneTypeColumnExists(conn))) return;
  await conn.query(
    "UPDATE readers SET zone_type = '' WHERE zone_type = ?",
    [oldName]
  );
}

// GET /api/zones → [{ id, name }]
router.get('/', async (req, res) => {
  const [rows] = await db.query(
    'SELECT id, name FROM zones ORDER BY name ASC'
  );
  res.json(rows);
});

// POST /api/zones → 201 { id, name }
router.post('/', async (req, res) => {
  const parsed = parseName(req.body);
  if (parsed.error) {
    return res.status(parsed.status).json({ message: parsed.error });
  }

  const dup = await findDuplicateName(parsed.name);
  if (dup) {
    return res.status(409).json({ message: `Zone "${parsed.name}" already exists` });
  }

  let result;
  try {
    [result] = await db.query(
      'INSERT INTO zones (name) VALUES (?)',
      [parsed.name]
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: `Zone "${parsed.name}" already exists` });
    }
    throw err;
  }

  await audit.log(
    'Settings',
    'Added',
    `Zone "${parsed.name}" was created`,
    req.auditUser,
    req.auditUserId
  );

  res.status(201).json({ id: result.insertId, name: parsed.name });
});

// PUT /api/zones/:id → 200 { id, name }
router.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(404).json({ message: 'Zone not found' });

  const parsed = parseName(req.body);
  if (parsed.error) {
    return res.status(parsed.status).json({ message: parsed.error });
  }

  const existing = await findById(id);
  if (!existing) return res.status(404).json({ message: 'Zone not found' });

  const dup = await findDuplicateName(parsed.name, id);
  if (dup) {
    return res.status(409).json({ message: `Zone "${parsed.name}" already exists` });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      'UPDATE zones SET name = ? WHERE id = ?',
      [parsed.name, id]
    );

    if (existing.name !== parsed.name) {
      await cascadeRenameOnReaders(conn, existing.name, parsed.name);
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: `Zone "${parsed.name}" already exists` });
    }
    throw err;
  } finally {
    conn.release();
  }

  await audit.log(
    'Settings',
    'Modified',
    `Zone renamed "${existing.name}" → "${parsed.name}"`,
    req.auditUser,
    req.auditUserId
  );

  res.json({ id, name: parsed.name });
});

// DELETE /api/zones/:id → 204
router.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(404).json({ message: 'Zone not found' });

  const existing = await findById(id);
  if (!existing) return res.status(404).json({ message: 'Zone not found' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await cascadeClearOnReaders(conn, existing.name);
    await conn.query('DELETE FROM zones WHERE id = ?', [id]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await audit.log(
    'Settings',
    'Deleted',
    `Zone "${existing.name}" was deleted`,
    req.auditUser,
    req.auditUserId
  );

  res.status(204).send();
});

module.exports = router;

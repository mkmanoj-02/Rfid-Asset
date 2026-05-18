const express  = require('express');
const router   = express.Router();
const db       = require('../db');
const bcrypt   = require('bcryptjs');
const audit    = require('../audit');
const refreshTokenService = require('../services/refreshTokenService');

const SELECT_COLS = `
  id, username, email, profile_type,
  location_privileges, location_can_modify, location_can_delete,
  location_type_privileges, location_type_can_modify, location_type_can_delete,
  asset_type_privileges, asset_type_can_modify, asset_type_can_delete,
  asset_privileges, asset_can_modify, asset_can_delete,
  created_at
`;

// GET all users
router.get('/', async (req, res) => {
  const [rows] = await db.query(`SELECT ${SELECT_COLS} FROM users ORDER BY username`);
  res.json(rows);
});

// GET single user
router.get('/:id', async (req, res) => {
  const [rows] = await db.query(`SELECT ${SELECT_COLS} FROM users WHERE id = ?`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: 'Not found' });
  res.json(rows[0]);
});

// POST create user
router.post('/', async (req, res) => {
  const {
    username, email, password, profile_type,
    location_privileges, location_can_modify, location_can_delete,
    location_type_privileges, location_type_can_modify, location_type_can_delete,
    asset_type_privileges, asset_type_can_modify, asset_type_can_delete,
    asset_privileges, asset_can_modify, asset_can_delete,
  } = req.body;

  if (!username || !password)
    return res.status(400).json({ message: 'Username and password are required' });

  // Email validation
  if (!email || !email.toString().trim())
    return res.status(400).json({ message: 'Email is required' });
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.toString().trim()))
    return res.status(400).json({ message: 'Invalid email address' });

  const password_hash = await bcrypt.hash(password, 10);

  try {
    const [result] = await db.query(
      `INSERT INTO users (
        username, email, password_hash, profile_type,
        location_privileges, location_can_modify, location_can_delete,
        location_type_privileges, location_type_can_modify, location_type_can_delete,
        asset_type_privileges, asset_type_can_modify, asset_type_can_delete,
        asset_privileges, asset_can_modify, asset_can_delete
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        username, email || null, password_hash, profile_type || 'admin',
        location_privileges      ? JSON.stringify(location_privileges)      : null,
        location_can_modify      !== false ? 1 : 0,
        location_can_delete      !== false ? 1 : 0,
        location_type_privileges ? JSON.stringify(location_type_privileges) : null,
        location_type_can_modify !== false ? 1 : 0,
        location_type_can_delete !== false ? 1 : 0,
        asset_type_privileges    ? JSON.stringify(asset_type_privileges)    : null,
        asset_type_can_modify    !== false ? 1 : 0,
        asset_type_can_delete    !== false ? 1 : 0,
        asset_privileges         ? JSON.stringify(asset_privileges)         : null,
        asset_can_modify         !== false ? 1 : 0,
        asset_can_delete         !== false ? 1 : 0,
      ]
    );
    await audit.log('User', 'Added', `User "${username}" (${profile_type || 'admin'}) was created`, req.auditUser, req.auditUserId);
    res.status(201).json({ id: result.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'Username or email already exists' });
    throw e;
  }
});

// PUT update user
router.put('/:id', async (req, res) => {
  const {
    username, email, password, profile_type,
    location_privileges, location_can_modify, location_can_delete,
    location_type_privileges, location_type_can_modify, location_type_can_delete,
    asset_type_privileges, asset_type_can_modify, asset_type_can_delete,
    asset_privileges, asset_can_modify, asset_can_delete,
  } = req.body;

  // Email validation
  if (!email || !email.toString().trim())
    return res.status(400).json({ message: 'Email is required' });
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.toString().trim()))
    return res.status(400).json({ message: 'Invalid email address' });

  const privCols = [
    ['location_privileges',      location_privileges      ? JSON.stringify(location_privileges)      : null],
    ['location_can_modify',      location_can_modify      ? 1 : 0],
    ['location_can_delete',      location_can_delete      ? 1 : 0],
    ['location_type_privileges', location_type_privileges ? JSON.stringify(location_type_privileges) : null],
    ['location_type_can_modify', location_type_can_modify ? 1 : 0],
    ['location_type_can_delete', location_type_can_delete ? 1 : 0],
    ['asset_type_privileges',    asset_type_privileges    ? JSON.stringify(asset_type_privileges)    : null],
    ['asset_type_can_modify',    asset_type_can_modify    ? 1 : 0],
    ['asset_type_can_delete',    asset_type_can_delete    ? 1 : 0],
    ['asset_privileges',         asset_privileges         ? JSON.stringify(asset_privileges)         : null],
    ['asset_can_modify',         asset_can_modify         ? 1 : 0],
    ['asset_can_delete',         asset_can_delete         ? 1 : 0],
  ];

  try {
    if (password) {
      const password_hash = await bcrypt.hash(password, 10);
      await db.query(
        `UPDATE users SET username=?, email=?, password_hash=?, profile_type=?,
          ${privCols.map(([c]) => `${c}=?`).join(', ')}
         WHERE id=?`,
        [username, email || null, password_hash, profile_type, ...privCols.map(([, v]) => v), req.params.id]
      );
    } else {
      await db.query(
        `UPDATE users SET username=?, email=?, profile_type=?,
          ${privCols.map(([c]) => `${c}=?`).join(', ')}
         WHERE id=?`,
        [username, email || null, profile_type, ...privCols.map(([, v]) => v), req.params.id]
      );
    }
    await audit.log('User', 'Modified', `User "${username}" was updated`, req.auditUser, req.auditUserId);
    res.json({ message: 'Updated' });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'Username or email already exists' });
    throw e;
  }
});

// BULK DELETE users
router.delete('/bulk', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length)
      return res.status(400).json({ message: 'ids array is required' });

    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await db.query(`SELECT username FROM users WHERE id IN (${placeholders})`, ids);
    for (const id of ids) {
      await refreshTokenService.revokeAllForUser(id);
    }
    await db.query(`DELETE FROM users WHERE id IN (${placeholders})`, ids);

    for (const row of rows)
      await audit.log('User', 'Deleted', `User "${row.username}" was deleted`, req.auditUser, req.auditUserId);

    res.json({ message: `${rows.length} user(s) deleted` });
  } catch (e) { next(e); }
});

// DELETE user
router.delete('/:id', async (req, res) => {
  const [rows] = await db.query('SELECT username FROM users WHERE id=?', [req.params.id]);
  await refreshTokenService.revokeAllForUser(req.params.id);
  await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
  if (rows.length) await audit.log('User', 'Deleted', `User "${rows[0].username}" was deleted`, req.auditUser, req.auditUserId);
  res.json({ message: 'Deleted' });
});

module.exports = router;

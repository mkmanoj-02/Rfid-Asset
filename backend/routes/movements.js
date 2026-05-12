const express = require('express');
const router = express.Router();
const db = require('../db');

// Get all movements (optionally filter by asset)
router.get('/', async (req, res) => {
  const { asset_id } = req.query;
  let query = `
    SELECT mh.*, a.name AS asset_name, a.rfid_tag,
      fl.name AS from_location, tl.name AS to_location
    FROM movement_history mh
    JOIN assets a ON mh.asset_id = a.id
    LEFT JOIN locations fl ON mh.from_location_id = fl.id
    JOIN locations tl ON mh.to_location_id = tl.id
  `;
  const params = [];
  if (asset_id) {
    query += ' WHERE mh.asset_id = ?';
    params.push(asset_id);
  }
  query += ' ORDER BY mh.moved_at DESC';
  const [rows] = await db.query(query, params);
  res.json(rows);
});

// Get movement history for a specific asset
router.get('/asset/:asset_id', async (req, res) => {
  const [rows] = await db.query(`
    SELECT mh.*, fl.name AS from_location, tl.name AS to_location
    FROM movement_history mh
    LEFT JOIN locations fl ON mh.from_location_id = fl.id
    JOIN locations tl ON mh.to_location_id = tl.id
    WHERE mh.asset_id = ?
    ORDER BY mh.moved_at DESC
  `, [req.params.asset_id]);
  res.json(rows);
});

module.exports = router;

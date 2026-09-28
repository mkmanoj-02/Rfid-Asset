const express = require('express');
const router = express.Router();
const db = require('../db');
const { RFID_TAG_MOVEMENT_NOTE } = require('../lib/rfidMovements');
const { scopeAssetWhere } = require('../lib/userAuthz');

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @returns {{ ok: true, fromDate: string, toDate: string } | { ok: false, message: string }}
 */
function parseReportRange(query) {
  const fromRaw = query.from ?? query.start_date ?? query.start;
  const toRaw = query.to ?? query.end_date ?? query.end;
  const defaultTo = new Date().toISOString().split('T')[0];
  const defaultFrom = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0];

  const fromStr = String(fromRaw || defaultFrom).trim().split('T')[0];
  const toStr = String(toRaw || defaultTo).trim().split('T')[0];

  if (!DATE_ONLY.test(fromStr)) return { ok: false, message: 'from must be YYYY-MM-DD' };
  if (!DATE_ONLY.test(toStr)) return { ok: false, message: 'to must be YYYY-MM-DD' };

  const dFrom = new Date(`${fromStr}T12:00:00Z`);
  const dTo = new Date(`${toStr}T12:00:00Z`);
  if (Number.isNaN(dFrom.getTime()) || Number.isNaN(dTo.getTime())) {
    return { ok: false, message: 'Invalid from or to date' };
  }
  if (fromStr > toStr) return { ok: false, message: 'from must be on or before to' };

  return { ok: true, fromDate: fromStr, toDate: toStr };
}

function formatDate(value) {
  if (!value) return value;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value).split('T')[0];
}

/** Detail row for report `assets` arrays (table / export / drill-down). */
function sqlReportAssetsSelect() {
  return `
    SELECT
      a.id AS asset_id,
      COALESCE(NULLIF(TRIM(a.asset_code), ''), NULLIF(TRIM(a.asset_serial), ''), NULLIF(TRIM(a.rfid_tag), ''), CONCAT('#', a.id)) AS asset_code,
      a.name AS asset_name,
      COALESCE(at.name, '') AS asset_type,
      COALESCE(l.name, '') AS location,
      CAST(NULL AS CHAR(255)) AS assigned_to,
      a.status AS asset_status,
      a.created_at AS created_at
  `;
}

function sqlReportAssetsFrom() {
  return `
    FROM assets a
    LEFT JOIN asset_types at ON a.asset_type_id = at.id
    LEFT JOIN locations l ON a.current_location_id = l.id
  `;
}

function mapReportAssetRow(r) {
  return {
    asset_id: r.asset_id,
    asset_code: r.asset_code,
    asset_name: r.asset_name,
    asset_type: r.asset_type,
    location: r.location,
    assigned_to: r.assigned_to,
    asset_status: r.asset_status,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}

// Dashboard report data

// Inventory vs Missing - "missing" = no movement recorded in [from, to]; total = all assets.
router.get('/inventory-missing', async (req, res) => {
  const range = parseReportRange(req.query);
  if (!range.ok) return res.status(400).json({ message: range.message });
  const { fromDate, toDate } = range;

  const missingWhere = `
    NOT EXISTS (
      SELECT 1 FROM movement_history mh
      WHERE mh.asset_id = a.id
        AND mh.moved_at >= ?
        AND mh.moved_at < DATE_ADD(?, INTERVAL 1 DAY)
    )
  `;

  const totalScope = scopeAssetWhere(req.authz, 'a', [], []);
  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM assets a ${totalScope.sql}`,
    totalScope.params
  );
  const missingScope = scopeAssetWhere(req.authz, 'a', [missingWhere], [fromDate, toDate]);
  const [[{ missing }]] = await db.query(
    `SELECT COUNT(*) AS missing FROM assets a ${missingScope.sql}`,
    missingScope.params
  );
  const inventory = total - missing;

  const [assetRows] = await db.query(
    `
    SELECT
      a.id AS asset_id,
      COALESCE(NULLIF(TRIM(a.asset_code), ''), NULLIF(TRIM(a.asset_serial), ''), NULLIF(TRIM(a.rfid_tag), ''), CONCAT('#', a.id)) AS asset_code,
      a.name AS asset_name,
      COALESCE(at.name, '') AS asset_type,
      COALESCE(l.name, '') AS location,
      CAST(NULL AS CHAR(255)) AS assigned_to,
      a.status AS asset_status,
      a.created_at AS created_at,
      CASE WHEN COUNT(mh.id) > 0 THEN 'In Stock' ELSE 'Missing' END AS report_status,
      COUNT(mh.id) AS movement_count,
      MAX(mh.moved_at) AS last_movement_at
    FROM assets a
    LEFT JOIN asset_types at ON a.asset_type_id = at.id
    LEFT JOIN locations l ON a.current_location_id = l.id
    LEFT JOIN movement_history mh ON mh.asset_id = a.id
      AND mh.moved_at >= ?
      AND mh.moved_at < DATE_ADD(?, INTERVAL 1 DAY)
    ${totalScope.active ? `WHERE ${totalScope.sql.replace(/^WHERE /, '')}` : ''}
    GROUP BY a.id, at.name, l.name
    ORDER BY report_status ASC, a.id DESC`,
    [...totalScope.params, fromDate, toDate]
  );
  const assets = assetRows.map((r) => ({
    ...mapReportAssetRow(r),
    report_status: r.report_status,
    movement_count: Number(r.movement_count || 0),
    last_movement_at: r.last_movement_at instanceof Date ? r.last_movement_at.toISOString() : r.last_movement_at,
  }));

  res.json({
    inventory,
    missing,
    total,
    from: fromDate,
    to: toDate,
    assets,
    inventory_assets: assets.filter((asset) => asset.report_status === 'In Stock'),
    missing_assets: assets.filter((asset) => asset.report_status === 'Missing'),
  });
});

// Most transacted assets (most location changes)
router.get('/most-transacted', async (req, res) => {
  const [rows] = await db.query(`
    SELECT a.name AS asset_name, a.asset_serial,
      SUM(CASE WHEN mh.from_location_id IS NOT NULL THEN 1 ELSE 0 END) AS out_count,
      COUNT(mh.id) AS in_count
    FROM movement_history mh
    JOIN assets a ON mh.asset_id = a.id
    GROUP BY a.id
    ORDER BY in_count DESC
    LIMIT 10
  `);
  res.json(rows);
});

// Top unscanned locations (locations where assets have not moved recently)
router.get('/unscanned-locations', async (req, res) => {
  const [rows] = await db.query(`
    SELECT l.name AS location,
      MIN(mh.moved_at) AS last_scan,
      TIMESTAMPDIFF(DAY, MIN(mh.moved_at), NOW()) AS days_since
    FROM locations l
    JOIN assets a ON a.current_location_id = l.id
    JOIN movement_history mh ON mh.asset_id = a.id
    GROUP BY l.id
    ORDER BY days_since DESC
    LIMIT 10
  `);
  res.json(rows);
});

// Assets by type - counts assets created in [from, to]
router.get('/assets-by-type', async (req, res) => {
  const range = parseReportRange(req.query);
  if (!range.ok) return res.status(400).json({ message: range.message });
  const { fromDate, toDate } = range;

  const [rows] = await db.query(
    `
    SELECT at.name AS type, COUNT(a.id) AS count
    FROM asset_types at
    LEFT JOIN assets a ON a.asset_type_id = at.id
      AND a.created_at >= ?
      AND a.created_at < DATE_ADD(?, INTERVAL 1 DAY)
    GROUP BY at.id
    ORDER BY count DESC
  `,
    [fromDate, toDate]
  );

  const createdClause = ' a.created_at >= ? AND a.created_at < DATE_ADD(?, INTERVAL 1 DAY) ';
  const [assetRows] = await db.query(
    `${sqlReportAssetsSelect()}
     ${sqlReportAssetsFrom()}
     WHERE ${createdClause}
     ORDER BY a.id DESC`,
    [fromDate, toDate]
  );

  res.json({
    from: fromDate,
    to: toDate,
    data: rows,
    assets: assetRows.map(mapReportAssetRow),
  });
});

// Assets by location - counts assets at that location created in [from, to]
router.get('/assets-by-location', async (req, res) => {
  const range = parseReportRange(req.query);
  if (!range.ok) return res.status(400).json({ message: range.message });
  const { fromDate, toDate } = range;

  const [rows] = await db.query(
    `
    SELECT l.name AS location, COUNT(a.id) AS count
    FROM locations l
    LEFT JOIN assets a ON a.current_location_id = l.id
      AND a.created_at >= ?
      AND a.created_at < DATE_ADD(?, INTERVAL 1 DAY)
    GROUP BY l.id
    ORDER BY count DESC
    LIMIT 10
  `,
    [fromDate, toDate]
  );

  const createdClause = ' a.created_at >= ? AND a.created_at < DATE_ADD(?, INTERVAL 1 DAY) ';
  const [assetRows] = await db.query(
    `${sqlReportAssetsSelect()}
     ${sqlReportAssetsFrom()}
     WHERE ${createdClause}
     ORDER BY a.id DESC`,
    [fromDate, toDate]
  );

  res.json({
    from: fromDate,
    to: toDate,
    data: rows,
    assets: assetRows.map(mapReportAssetRow),
  });
});

// Tagging Progress Report — assets that received an RFID tag (movement note "RFID tagged")
router.get('/tagging-progress', async (req, res) => {
  const range = parseReportRange(req.query);
  if (!range.ok) return res.status(400).json({ message: range.message });
  const { fromDate, toDate } = range;

  const [rows] = await db.query(
    `
    SELECT DATE(mh.moved_at) AS date, COUNT(DISTINCT mh.asset_id) AS count
    FROM movement_history mh
    INNER JOIN assets a ON a.id = mh.asset_id
    WHERE mh.notes = ?
      AND a.rfid_tag IS NOT NULL AND TRIM(a.rfid_tag) != ''
      AND CHAR_LENGTH(TRIM(a.rfid_tag)) = 24
      AND mh.moved_at >= ?
      AND mh.moved_at < DATE_ADD(?, INTERVAL 1 DAY)
    GROUP BY DATE(mh.moved_at)
    ORDER BY date ASC
  `,
    [RFID_TAG_MOVEMENT_NOTE, fromDate, toDate]
  );

  let cumulative = 0;
  const result = rows.map((r) => {
    cumulative += r.count;
    return { date: formatDate(r.date), count: r.count, cumulative };
  });

  res.json({ from: fromDate, to: toDate, data: result });
});

// Movement trend - last 14 days
router.get('/movement-trend', async (req, res) => {
  const [rows] = await db.query(`
    SELECT DATE(moved_at) AS date, COUNT(*) AS count
    FROM movement_history
    WHERE moved_at >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
    GROUP BY DATE(moved_at)
    ORDER BY date ASC
  `);
  res.json(rows);
});

// Status breakdown
router.get('/status-breakdown', async (req, res) => {
  const scope = scopeAssetWhere(req.authz, 'a', [], []);
  const [rows] = await db.query(
    `SELECT a.status, COUNT(*) AS count FROM assets a ${scope.sql} GROUP BY a.status`,
    scope.params
  );
  res.json(rows);
});

// Missing by location - inventory_status = missing, created in [from, to]
router.get('/missing-by-location', async (req, res) => {
  const range = parseReportRange(req.query);
  if (!range.ok) return res.status(400).json({ message: range.message });
  const { fromDate, toDate } = range;

  const [rows] = await db.query(
    `
    SELECT l.name AS location, COUNT(a.id) AS missing_count
    FROM assets a
    JOIN locations l ON a.current_location_id = l.id
    WHERE a.asset_inventory_status = 'missing'
      AND a.created_at >= ?
      AND a.created_at < DATE_ADD(?, INTERVAL 1 DAY)
    GROUP BY l.id
    ORDER BY missing_count DESC
    LIMIT 10
  `,
    [fromDate, toDate]
  );

  const baseWhere = `
    a.asset_inventory_status = 'missing'
    AND a.created_at >= ? AND a.created_at < DATE_ADD(?, INTERVAL 1 DAY)
  `;
  const [assetRows] = await db.query(
    `${sqlReportAssetsSelect()}
     ${sqlReportAssetsFrom()}
     WHERE ${baseWhere}
     ORDER BY a.id DESC`,
    [fromDate, toDate]
  );

  res.json({
    from: fromDate,
    to: toDate,
    data: rows,
    assets: assetRows.map(mapReportAssetRow),
  });
});

// Most active users - logins in [from, to] on logged_in_at
router.get('/most-active-users', async (req, res) => {
  const range = parseReportRange(req.query);
  if (!range.ok) return res.status(400).json({ message: range.message });
  const { fromDate, toDate } = range;

  const [rows] = await db.query(
    `
    SELECT u.username, COUNT(l.id) AS login_count
    FROM users u
    LEFT JOIN login_logs l ON l.user_id = u.id
      AND l.logged_in_at >= ?
      AND l.logged_in_at < DATE_ADD(?, INTERVAL 1 DAY)
    GROUP BY u.id
    ORDER BY login_count DESC
    LIMIT 10
  `,
    [fromDate, toDate]
  );

  res.json({
    from: fromDate,
    to: toDate,
    data: rows,
    assets: [],
  });
});

module.exports = router;

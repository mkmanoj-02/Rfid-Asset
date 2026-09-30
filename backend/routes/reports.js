const express = require('express');
const router = express.Router();
const db = require('../db');
const { RFID_TAG_MOVEMENT_NOTE } = require('../lib/rfidMovements');
const { scopeAssetWhere, filterEmbeddedAssetAttributes } = require('../lib/userAuthz');
const { attachAssetAttributeValues } = require('../services/assetQueryService');

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

/* ─── Overall report (filterable asset list) ─────────────────── */

const OVERALL_LAST_SEEN = '(SELECT MAX(mh.moved_at) FROM movement_history mh WHERE mh.asset_id = a.id)';

const OVERALL_DATE_FIELDS = {
  created: 'a.created_at',
  updated: 'a.updated_at',
  lastseen: OVERALL_LAST_SEEN,
};

const OVERALL_SORT_MAP = {
  name: 'a.name',
  asset_code: 'a.asset_code',
  asset_serial: 'a.asset_serial',
  asset_type_name: 'at.name',
  location_name: 'l.name',
  tag_type_name: 'tt.name',
  asset_inventory_status: 'a.asset_inventory_status',
  created_at: 'a.created_at',
  lastseen: OVERALL_LAST_SEEN,
};

const OVERALL_PRESETS = {
  missing: "a.asset_inventory_status = 'missing'",
  not_seen_30: `(${OVERALL_LAST_SEEN} IS NULL OR ${OVERALL_LAST_SEEN} < DATE_SUB(NOW(), INTERVAL 30 DAY))`,
  untagged: "(a.rfid_tag IS NULL OR TRIM(a.rfid_tag) = '')",
  this_month: "a.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')",
};

const OVERALL_INVENTORY_STATUSES = ['in_inventory', 'missing', 'not_in_inventory'];
const OVERALL_EXPORT_MAX = 20000;

const NUMERIC_VALUE_SQL = "TRIM(aav.value) REGEXP '^-?[0-9]+(\\\\.[0-9]+)?$'";
const NUMBER_SQL = 'CAST(TRIM(aav.value) AS DECIMAL(18,4))';
const DATE_VALUE_SQL = "TRIM(aav.value) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}'";
const DATE_SQL = "STR_TO_DATE(LEFT(TRIM(aav.value), 10), '%Y-%m-%d')";

function isBlank(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

/** Accepts a single value or an array; returns trimmed, non-empty, de-duplicated strings. */
function toValueList(v) {
  const list = Array.isArray(v) ? v : [v];
  return [...new Set(list.filter((x) => !isBlank(x)).map((x) => String(x).trim()))];
}

function toFiniteNumber(v) {
  if (isBlank(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDateOnly(v) {
  if (isBlank(v)) return null;
  const s = String(v).trim().split('T')[0];
  return DATE_ONLY.test(s) ? s : null;
}

/**
 * One advanced-filter row → SQL predicate on `aav.value` (inside EXISTS) + params.
 * @returns {{ sql: string, params: unknown[] } | null} null when the row is incomplete.
 */
function buildAttrPredicate(f) {
  const type = String(f.attr_type || 'string');
  const op = String(f.op || '');

  if (type === 'double') {
    const a = toFiniteNumber(f.value);
    if (op === 'between') {
      const b = toFiniteNumber(f.value2);
      if (a == null || b == null) return null;
      return { sql: `${NUMERIC_VALUE_SQL} AND ${NUMBER_SQL} BETWEEN ? AND ?`, params: [Math.min(a, b), Math.max(a, b)] };
    }
    const cmp = { eq: '=', gt: '>', lt: '<' }[op];
    if (!cmp || a == null) return null;
    return { sql: `${NUMERIC_VALUE_SQL} AND ${NUMBER_SQL} ${cmp} ?`, params: [a] };
  }

  if (type === 'date') {
    const a = toDateOnly(f.value);
    if (op === 'between') {
      const b = toDateOnly(f.value2);
      if (!a || !b) return null;
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      return { sql: `${DATE_VALUE_SQL} AND ${DATE_SQL} BETWEEN ? AND ?`, params: [lo, hi] };
    }
    const cmp = { on: '=', before: '<', after: '>' }[op];
    if (!cmp || !a) return null;
    return { sql: `${DATE_VALUE_SQL} AND ${DATE_SQL} ${cmp} ?`, params: [a] };
  }

  if (type === 'list') {
    const values = (Array.isArray(f.values) ? f.values : [])
      .map((v) => String(v ?? '').trim().toLowerCase())
      .filter(Boolean);
    if (op !== 'in' || !values.length) return null;
    return { sql: `LOWER(TRIM(aav.value)) IN (${values.map(() => '?').join(',')})`, params: values };
  }

  if (op === 'empty') return { sql: "(aav.value IS NULL OR TRIM(aav.value) = '')", params: [] };
  if (op === 'not_empty') return { sql: "(aav.value IS NOT NULL AND TRIM(aav.value) <> '')", params: [] };
  if (isBlank(f.value)) return null;
  const v = String(f.value).trim();
  if (op === 'equals') return { sql: 'LOWER(TRIM(aav.value)) = LOWER(?)', params: [v] };
  if (op === 'contains') return { sql: 'aav.value LIKE ?', params: [`%${v}%`] };
  return null;
}

function buildAttrCondition(f) {
  const name = String(f?.name || '').trim();
  if (!name) return null;
  const pred = buildAttrPredicate(f);
  if (!pred) return null;
  const exists = `EXISTS (
    SELECT 1 FROM asset_attribute_values aav
    JOIN asset_type_attributes ata ON aav.attribute_id = ata.id
    WHERE aav.asset_id = a.id AND LOWER(TRIM(ata.name)) = LOWER(?) AND ${pred.sql}
  )`;
  // "is empty" also matches assets that have no row for the attribute at all.
  if (String(f.attr_type || 'string') === 'string' && f.op === 'empty') {
    return {
      sql: `(${exists} OR NOT EXISTS (
        SELECT 1 FROM asset_attribute_values aav
        JOIN asset_type_attributes ata ON aav.attribute_id = ata.id
        WHERE aav.asset_id = a.id AND LOWER(TRIM(ata.name)) = LOWER(?)
      ))`,
      params: [name, ...pred.params, name],
    };
  }
  return { sql: exists, params: [name, ...pred.params] };
}

/** @returns {{ ok: true, conditions: string[], params: unknown[] } | { ok: false, message: string }} */
function buildOverallConditions(body) {
  const conditions = [];
  const params = [];

  const dateField = String(body.date_field || 'created');
  const dateCol = OVERALL_DATE_FIELDS[dateField];
  if (!dateCol) return { ok: false, message: 'date_field must be created, updated or lastseen' };
  const from = isBlank(body.from) ? null : toDateOnly(body.from);
  const to = isBlank(body.to) ? null : toDateOnly(body.to);
  if (!isBlank(body.from) && !from) return { ok: false, message: 'from must be YYYY-MM-DD' };
  if (!isBlank(body.to) && !to) return { ok: false, message: 'to must be YYYY-MM-DD' };
  if (from && to && from > to) return { ok: false, message: 'from must be on or before to' };
  if (from) { conditions.push(`${dateCol} >= ?`); params.push(from); }
  if (to) { conditions.push(`${dateCol} < DATE_ADD(?, INTERVAL 1 DAY)`); params.push(to); }

  const search = String(body.search || '').trim();
  if (search) {
    const s = `%${search}%`;
    conditions.push('(a.asset_code LIKE ? OR a.asset_serial LIKE ? OR a.rfid_tag LIKE ? OR a.name LIKE ?)');
    params.push(s, s, s, s);
  }

  const presets = Array.isArray(body.presets) ? body.presets : [];
  for (const p of presets) {
    if (OVERALL_PRESETS[p]) conditions.push(OVERALL_PRESETS[p]);
  }

  const idFilters = [
    ['asset_type_id', 'a.asset_type_id'],
    ['location_id', 'a.current_location_id'],
    ['tag_type_id', 'a.tag_type_id'],
    ['vendor_id', 'a.vendor_id'],
  ];
  for (const [key, col] of idFilters) {
    const raw = toValueList(body[key]);
    if (!raw.length) continue;
    const ids = raw.map(Number);
    if (ids.some((id) => !Number.isInteger(id))) return { ok: false, message: `${key} must contain integers` };
    conditions.push(`${col} IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }

  const statuses = toValueList(body.asset_inventory_status);
  if (statuses.length) {
    if (statuses.some((st) => !OVERALL_INVENTORY_STATUSES.includes(st))) {
      return { ok: false, message: `asset_inventory_status must be one of ${OVERALL_INVENTORY_STATUSES.join(', ')}` };
    }
    conditions.push(`a.asset_inventory_status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses);
  }

  const attrFilters = Array.isArray(body.attr_filters) ? body.attr_filters : [];
  const attrParts = attrFilters.map(buildAttrCondition).filter(Boolean);
  if (attrParts.length) {
    const joiner = body.attr_match === 'any' ? ' OR ' : ' AND ';
    conditions.push(`(${attrParts.map((p) => p.sql).join(joiner)})`);
    for (const p of attrParts) params.push(...p.params);
  }

  return { ok: true, conditions, params };
}

router.post('/overall', async (req, res, next) => {
  try {
    const body = req.body || {};
    const built = buildOverallConditions(body);
    if (!built.ok) return res.status(400).json({ message: built.message });

    const scope = scopeAssetWhere(req.authz, 'a', built.conditions, built.params);
    const baseFrom = `FROM assets a
      LEFT JOIN asset_types at ON a.asset_type_id = at.id
      LEFT JOIN locations l ON a.current_location_id = l.id
      LEFT JOIN tag_types tt ON a.tag_type_id = tt.id
      LEFT JOIN vendors v ON a.vendor_id = v.id
      ${scope.sql}`;

    const [[summaryRow]] = await db.query(
      `SELECT COUNT(*) AS total,
        SUM(a.asset_inventory_status = 'in_inventory') AS in_inventory,
        SUM(a.asset_inventory_status = 'missing') AS missing
       ${baseFrom}`,
      scope.params
    );
    const summary = {
      total: Number(summaryRow.total || 0),
      in_inventory: Number(summaryRow.in_inventory || 0),
      missing: Number(summaryRow.missing || 0),
    };

    const sortCol = OVERALL_SORT_MAP[String(body.sort || '').trim()] || 'a.created_at';
    const sortDir = String(body.sort_dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const isExport = Boolean(body.export);
    const pageSize = isExport ? OVERALL_EXPORT_MAX : Math.min(500, Math.max(1, parseInt(body.limit, 10) || 25));
    const pageNum = isExport ? 1 : Math.max(1, parseInt(body.page, 10) || 1);

    const [rows] = await db.query(
      `SELECT a.*, at.name AS asset_type_name, l.name AS location_name,
        tt.name AS tag_type_name, v.name AS vendor_name, ${OVERALL_LAST_SEEN} AS lastseen
       ${baseFrom}
       ORDER BY ${sortCol} ${sortDir}, a.id DESC
       LIMIT ? OFFSET ?`,
      [...scope.params, pageSize, (pageNum - 1) * pageSize]
    );

    await attachAssetAttributeValues(rows);
    filterEmbeddedAssetAttributes(rows, req.authz);

    res.json({
      data: rows,
      summary,
      truncated: isExport && summary.total > OVERALL_EXPORT_MAX,
      pagination: {
        total: summary.total,
        page: pageNum,
        limit: pageSize,
        totalPages: Math.max(1, Math.ceil(summary.total / pageSize)),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

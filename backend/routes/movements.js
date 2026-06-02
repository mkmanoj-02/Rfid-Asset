const express = require("express");
const router = express.Router();
const db = require("../db");

const {
  buildMovementScopeWhere,

  assertAssetInScope,
} = require("../lib/userAuthz");

const MOVEMENT_FROM = `FROM movement_history mh
  JOIN assets a ON mh.asset_id = a.id
  LEFT JOIN locations fl ON mh.from_location_id = fl.id
  LEFT JOIN locations tl ON mh.to_location_id = tl.id`;
  
const MOVEMENT_SELECT = `SELECT mh.*, a.name AS asset_name, a.rfid_tag,

  fl.name AS from_location, tl.name AS to_location`;

function combineWhere(clauses) {
  const parts = clauses.filter((c) => c && c.sql);

  if (!parts.length) return { sql: "", params: [] };

  return {
    sql: ` WHERE ${parts.map((c) => c.sql).join(" AND ")}`,

    params: parts.flatMap((c) => c.params),
  };
}

function buildMovementClauses(authz, { asset_id, search } = {}) {
  const clauses = [];

  const scope = buildMovementScopeWhere(authz);

  if (scope.active) {
    clauses.push({
      sql: scope.clause.replace(/^ WHERE /, ""),
      params: scope.params,
    });
  }

  if (asset_id !== undefined && asset_id !== "") {
    clauses.push({ sql: "mh.asset_id = ?", params: [asset_id] });
  }

  const searchTerm = search != null ? String(search).trim() : "";

  if (searchTerm) {
    const s = `%${searchTerm}%`;

    clauses.push({
      sql: `(a.name LIKE ? OR a.rfid_tag LIKE ? OR a.asset_serial LIKE ? OR fl.name LIKE ? OR tl.name LIKE ? OR mh.notes LIKE ?)`,

      params: [s, s, s, s, s, s],
    });
  }

  return clauses;
}

async function fetchMovements(clauses, { paginate, pageNum, pageSize }) {
  const where = combineWhere(clauses);

  const orderSql = " ORDER BY mh.moved_at DESC, mh.id DESC";

  if (paginate) {
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total ${MOVEMENT_FROM}${where.sql}`,
      where.params,
    );

    const offset = (pageNum - 1) * pageSize;

    const [rows] = await db.query(
      `${MOVEMENT_SELECT} ${MOVEMENT_FROM}${where.sql}${orderSql} LIMIT ? OFFSET ?`,

      [...where.params, pageSize, offset],
    );

    return {
      rows,

      pagination: {
        total,
        page: pageNum,
        limit: pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  const [rows] = await db.query(
    `${MOVEMENT_SELECT} ${MOVEMENT_FROM}${where.sql}${orderSql}`,

    where.params,
  );

  return { rows };
}

// Get all movements (optionally filter by asset; optional pagination)

router.get("/", async (req, res, next) => {
  try {
    const { asset_id, search, page, limit } = req.query;
    if (asset_id) {
      const scopeErr = await assertAssetInScope(req.authz, res, asset_id);
      if (scopeErr) return scopeErr;
    }

    const paginate = page !== undefined && limit !== undefined;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(limit, 10) || 25));
    const clauses = buildMovementClauses(req.authz, { asset_id, search });

    const result = await fetchMovements(clauses, {
      paginate,
      pageNum,
      pageSize,
    });

    if (paginate) {
      return res.json({ data: result.rows, pagination: result.pagination });
    }

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Get movement history for a specific asset

router.get("/asset/:asset_id", async (req, res, next) => {
  try {
    const assetId = req.params.asset_id;
    const scopeErr = await assertAssetInScope(req.authz, res, assetId);
    if (scopeErr) return scopeErr;
    const { search, page, limit } = req.query;
    const paginate = page !== undefined && limit !== undefined;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(limit, 10) || 25));
    const clauses = buildMovementClauses(req.authz, {
      asset_id: assetId,
      search,
    });

    const result = await fetchMovements(clauses, {
      paginate,
      pageNum,
      pageSize,
    });

    if (paginate) {
      return res.json({ data: result.rows, pagination: result.pagination });
    }

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

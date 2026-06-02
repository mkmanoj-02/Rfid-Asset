const express = require("express");
const router = express.Router();
const db = require("../db");

// Get audit logs with optional filters
router.get("/", async (req, res) => {
  const { from, to, search, type, page, limit } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * pageSize;
  let query = "SELECT * FROM audit_logs WHERE 1=1";
  const params = [];

  if (from) {
    query += " AND logged_at >= ?";
    params.push(from);
  }
  if (to) {
    query += " AND logged_at <= DATE_ADD(?, INTERVAL 1 DAY)";
    params.push(to);
  }
  if (type && type !== "all") {
    query += " AND type = ?";
    params.push(type);
  }
  if (search) {
    query += " AND (description LIKE ? OR username LIKE ? OR action LIKE ?)";
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  query += " ORDER BY logged_at DESC";
  if (page && limit) {
    query += " LIMIT ? OFFSET ?";
    params.push(pageSize, offset);
  }
  const [rows] = await db.query(query, params);
  const [[{ total }]] = await db.query(
    "SELECT COUNT(*) AS total FROM audit_logs",
  );
  res.json({
    data: rows,
    pagination: {
      total: total || 0,
      page: pageNum,
      limit: pageSize,
    },
  });
});

// Get total count
router.get("/count", async (req, res) => {
  const [[{ count }]] = await db.query(
    "SELECT COUNT(*) AS count FROM audit_logs",
  );
  res.json({ count });
});

module.exports = router;

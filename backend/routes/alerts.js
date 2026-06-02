const express = require('express');
const router = express.Router();
const db = require('../db');
const { buildAlertScopeWhere, assertAlertInScope } = require('../lib/userAuthz');

async function scopedAlertsQuery(authz, extraClause = '', extraParams = []) {
  const scope = await buildAlertScopeWhere(authz, 'al');
  let sql = `SELECT al.* FROM alerts al ${scope.joins} ${scope.clause}`;
  const params = [...scope.params];

  if (extraClause) {
    if (scope.active) {
      sql += ` AND (${extraClause})`;
    } else {
      sql += ` WHERE ${extraClause}`;
    }
    params.push(...extraParams);
  }

  return { sql, params };
}

// Get alerts, optionally filtered by type
router.get('/', async (req, res, next) => {
  try {
    const { filter_type } = req.query;
    const extra = filter_type ? 'al.filter_type = ?' : '';
    const extraParams = filter_type ? [filter_type] : [];
    const { sql, params } = await scopedAlertsQuery(req.authz, extra, extraParams);
    const [rows] = await db.query(`${sql} ORDER BY al.alert_time DESC LIMIT 500`, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Get unread count
router.get('/unread-count', async (req, res, next) => {
  try {
    const { sql, params } = await scopedAlertsQuery(req.authz, 'al.is_read = 0', []);
    const [[{ count }]] = await db.query(
      `SELECT COUNT(*) AS count FROM (${sql}) AS scoped`,
      params
    );
    res.json({ count });
  } catch (err) {
    next(err);
  }
});

// Mark all as read (scoped alerts only; optional filter_type matches GET /alerts)
router.put('/mark-read', async (req, res, next) => {
  try {
    const filter_type = req.query.filter_type ?? req.body?.filter_type;
    const scope = await buildAlertScopeWhere(req.authz, 'al');
    if (!scope.active) {
      if (filter_type) {
        await db.query('UPDATE alerts SET is_read = 1 WHERE filter_type = ?', [filter_type]);
      } else {
        await db.query('UPDATE alerts SET is_read = 1');
      }
    } else {
      let sql = `UPDATE alerts al ${scope.joins} SET al.is_read = 1 ${scope.clause}`;
      const params = [...scope.params];
      if (filter_type) {
        sql += ' AND al.filter_type = ?';
        params.push(filter_type);
      }
      await db.query(sql, params);
    }
    res.json({ message: 'Marked read' });
  } catch (err) {
    next(err);
  }
});

// Mark single as read
router.put('/:id/read', async (req, res, next) => {
  try {
    const scopeErr = await assertAlertInScope(req.authz, res, req.params.id);
    if (scopeErr) return scopeErr;
    await db.query('UPDATE alerts SET is_read = 1 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Marked read' });
  } catch (err) {
    next(err);
  }
});

// Bulk delete alerts
router.delete('/bulk', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ message: 'ids array is required' });
    }

    for (const rawId of ids) {
      const scopeErr = await assertAlertInScope(req.authz, res, rawId);
      if (scopeErr) return scopeErr;
    }

    const placeholders = ids.map(() => '?').join(',');
    await db.query(`DELETE FROM alerts WHERE id IN (${placeholders})`, ids);
    res.json({ message: `${ids.length} alert(s) deleted` });
  } catch (err) {
    next(err);
  }
});

// Delete alert
router.delete('/:id', async (req, res, next) => {
  try {
    const scopeErr = await assertAlertInScope(req.authz, res, req.params.id);
    if (scopeErr) return scopeErr;
    await db.query('DELETE FROM alerts WHERE id = ?', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    next(err);
  }
});

// Clear all alerts (scoped only)
router.delete('/', async (req, res, next) => {
  try {
    const scope = await buildAlertScopeWhere(req.authz, 'al');
    if (!scope.active) {
      await db.query('DELETE FROM alerts');
    } else {
      const [rows] = await db.query(
        `SELECT al.id FROM alerts al ${scope.joins} ${scope.clause}`,
        scope.params
      );
      if (rows.length) {
        const ids = rows.map((r) => r.id);
        const ph = ids.map(() => '?').join(',');
        await db.query(`DELETE FROM alerts WHERE id IN (${ph})`, ids);
      }
    }
    res.json({ message: 'Cleared' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

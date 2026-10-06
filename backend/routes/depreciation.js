const express = require('express');
const router = express.Router();
const db = require('../db');

// ── Helper: generate run code ──────────────────────────────────
async function nextRunCode() {
  const [[{ cnt }]] = await db.query('SELECT COUNT(*) AS cnt FROM depreciation_history');
  return `RUN-${String(cnt + 1).padStart(4, '0')}`;
}

async function nextRuleCode() {
  const [[{ cnt }]] = await db.query('SELECT COUNT(*) AS cnt FROM depreciation_rules');
  return `R${String(cnt + 1).padStart(3, '0')}`;
}

// ── RULES ──────────────────────────────────────────────────────
router.get('/rules', async (req, res) => {
  const [rows] = await db.query(`
    SELECT dr.*, at.name AS asset_type_name
    FROM depreciation_rules dr
    JOIN asset_types at ON dr.asset_type_id = at.id
    ORDER BY dr.created_at DESC
  `);
  res.json(rows);
});

router.post('/rules', async (req, res) => {
  const { asset_type_id, method, useful_life_years, depreciation_rate, salvage_value, effective_from, stop_on_disposal, partial_year } = req.body;
  const rule_code = await nextRuleCode();
  const [result] = await db.query(
    `INSERT INTO depreciation_rules (rule_code, asset_type_id, method, useful_life_years, depreciation_rate, salvage_value, effective_from, stop_on_disposal, partial_year, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [rule_code, asset_type_id, method, useful_life_years, depreciation_rate, salvage_value || 0, effective_from, stop_on_disposal ? 1 : 0, partial_year ? 1 : 0, req.auditUser]
  );
  await db.query('INSERT INTO depreciation_audit (action, target, performed_by, details) VALUES (?,?,?,?)',
    ['Rule created', `${rule_code} — ${req.body.asset_type_name || asset_type_id}`, req.auditUser, JSON.stringify(req.body)]);
  res.status(201).json({ id: result.insertId, rule_code });
});

router.put('/rules/:id', async (req, res) => {
  const { method, useful_life_years, depreciation_rate, salvage_value, effective_from, stop_on_disposal, partial_year, is_active } = req.body;
  await db.query(
    `UPDATE depreciation_rules SET method=?, useful_life_years=?, depreciation_rate=?, salvage_value=?, effective_from=?, stop_on_disposal=?, partial_year=?, is_active=? WHERE id=?`,
    [method, useful_life_years, depreciation_rate, salvage_value || 0, effective_from, stop_on_disposal ? 1 : 0, partial_year ? 1 : 0, is_active ? 1 : 0, req.params.id]
  );
  const [[rule]] = await db.query('SELECT rule_code FROM depreciation_rules WHERE id=?', [req.params.id]);
  await db.query('INSERT INTO depreciation_audit (action, target, performed_by, details) VALUES (?,?,?,?)',
    [is_active === false ? 'Rule deactivated' : 'Rule updated', rule?.rule_code, req.auditUser, JSON.stringify(req.body)]);
  res.json({ message: 'Updated' });
});

router.delete('/rules/:id', async (req, res) => {
  const [[rule]] = await db.query('SELECT rule_code, asset_type_id FROM depreciation_rules WHERE id=?', [req.params.id]);
  await db.query('DELETE FROM depreciation_rules WHERE id=?', [req.params.id]);
  await db.query('INSERT INTO depreciation_audit (action, target, performed_by, details) VALUES (?,?,?,?)',
    ['Rule deleted', rule?.rule_code, req.auditUser, '']);
  res.json({ message: 'Deleted' });
});

// ── ASSET FINANCIALS ───────────────────────────────────────────
router.get('/financials/:asset_id', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM asset_financials WHERE asset_id=?', [req.params.asset_id]);
  res.json(rows[0] || null);
});

router.post('/financials', async (req, res) => {
  const { asset_id, purchase_cost, salvage_value, purchase_date } = req.body;
  await db.query(
    `INSERT INTO asset_financials (asset_id, purchase_cost, salvage_value, purchase_date, current_book_value)
     VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE purchase_cost=?, salvage_value=?, purchase_date=?, current_book_value=?`,
    [asset_id, purchase_cost, salvage_value || 0, purchase_date || null, purchase_cost,
     purchase_cost, salvage_value || 0, purchase_date || null, purchase_cost]
  );
  res.json({ message: 'Saved' });
});

// ── BULK SET FINANCIALS for all assets of a type ──────────────
router.post('/financials/bulk', async (req, res) => {
  const { asset_type_id, purchase_cost, salvage_value, purchase_date } = req.body;
  const [assets] = await db.query('SELECT id FROM assets WHERE asset_type_id=?', [asset_type_id]);
  let count = 0;
  for (const a of assets) {
    await db.query(
      `INSERT INTO asset_financials (asset_id, purchase_cost, salvage_value, purchase_date, current_book_value)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE purchase_cost=?, salvage_value=?, purchase_date=?, current_book_value=IF(current_book_value=purchase_cost OR current_book_value IS NULL, ?, current_book_value)`,
      [a.id, purchase_cost, salvage_value || 0, purchase_date || null, purchase_cost,
       purchase_cost, salvage_value || 0, purchase_date || null, purchase_cost]
    );
    count++;
  }
  res.json({ updated: count });
});
router.post('/run-monthly', async (req, res) => {
  const { asset_type_id, run_date } = req.body;
  const runDate = run_date || new Date().toISOString().split('T')[0];
  const runCode = await nextRunCode();

  // Get active rule for this asset type
  const [rules] = await db.query(
    'SELECT * FROM depreciation_rules WHERE asset_type_id=? AND is_active=1 ORDER BY effective_from DESC LIMIT 1',
    [asset_type_id]
  );
  if (!rules.length) return res.status(400).json({ message: 'No active rule for this asset type' });
  const rule = rules[0];

  // Get asset type name
  const [[at]] = await db.query('SELECT name FROM asset_types WHERE id=?', [asset_type_id]);

  // Get all assets of this type with financials
  const [assets] = await db.query(`
    SELECT a.id, a.asset_code AS asset_serial, a.name, a.status, af.purchase_cost, af.salvage_value,
      af.current_book_value, af.is_disposed
    FROM assets a
    JOIN asset_financials af ON af.asset_id = a.id
    WHERE a.asset_type_id = ? AND af.purchase_cost > 0
  `, [asset_type_id]);

  if (!assets.length) {
    return res.status(400).json({
      message: `No assets found with financial data for this asset type. Please set Purchase Cost for each asset via the asset detail screen (💰 Financial Info tab).`
    });
  }

  let totalDepreciation = 0;
  let processed = 0;
  let runId;

  try {
    // Create run record
    const [runResult] = await db.query(
      `INSERT INTO depreciation_history (run_code, run_date, asset_type_id, asset_type_name, rule_id, triggered_by)
       VALUES (?,?,?,?,?,?)`,
      [runCode, runDate, asset_type_id, at?.name, rule.id, req.auditUser || 'manual']
    );
    runId = runResult.insertId;

    for (const asset of assets) {
      if (rule.stop_on_disposal && asset.is_disposed) continue;

      const openingValue = parseFloat(asset.current_book_value || asset.purchase_cost);
      const salvage = parseFloat(asset.salvage_value || rule.salvage_value || 0);
      const rate = parseFloat(rule.depreciation_rate) / 100;

      if (openingValue <= salvage) continue; // fully depreciated

      let depAmount = 0;
      if (rule.method === 'SLM') {
        const annualDep = (parseFloat(asset.purchase_cost) - salvage) / parseFloat(rule.useful_life_years);
        depAmount = annualDep / 12; // monthly
      } else if (rule.method === 'WDV' || rule.method === 'Declining Balance') {
        depAmount = (openingValue * rate) / 12;
      }

      depAmount = Math.min(depAmount, openingValue - salvage);
      depAmount = Math.round(depAmount * 100) / 100;
      const closingValue = Math.round((openingValue - depAmount) * 100) / 100;

      // Update asset financials
      await db.query(
        `UPDATE asset_financials SET current_book_value=?, total_depreciation=total_depreciation+?, last_depreciation_date=? WHERE asset_id=?`,
        [closingValue, depAmount, runDate, asset.id]
      );

      // Insert entry
      await db.query(
        `INSERT INTO depreciation_entries (run_id, asset_id, asset_serial, asset_name, opening_value, depreciation_amount, closing_value, method)
         VALUES (?,?,?,?,?,?,?,?)`,
        [runId, asset.id, asset.asset_serial, asset.name, openingValue, depAmount, closingValue, rule.method]
      );

      totalDepreciation += depAmount;
      processed++;
    }

    // Update run totals
    await db.query(
      'UPDATE depreciation_history SET assets_processed=?, total_depreciation=?, status=? WHERE id=?',
      [processed, Math.round(totalDepreciation * 100) / 100, 'success', runId]
    );

    await db.query('INSERT INTO depreciation_audit (action, target, performed_by, details) VALUES (?,?,?,?)',
      ['Monthly run triggered', runCode, req.auditUser || 'scheduler', `${processed} assets, ₹${totalDepreciation.toFixed(2)}`]);

    res.json({ run_code: runCode, processed, total_depreciation: totalDepreciation.toFixed(2), status: 'success' });
  } catch (e) {
    if (runId) await db.query('UPDATE depreciation_history SET status=?, error_message=? WHERE id=?', ['failed', e.message, runId]);
    res.status(500).json({ message: e.message });
  }
});

// ── RUN HISTORY ────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM depreciation_history ORDER BY created_at DESC LIMIT 100');
  res.json(rows);
});

router.get('/history/:id/entries', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM depreciation_entries WHERE run_id=? ORDER BY id', [req.params.id]);
  res.json(rows);
});

// ── AUDIT LOG ──────────────────────────────────────────────────
router.get('/audit', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM depreciation_audit ORDER BY logged_at DESC LIMIT 200');
  res.json(rows);
});

// ── CALCULATOR (no DB write) ───────────────────────────────────
router.post('/calculate', async (req, res) => {
  const { purchase_cost, salvage_value, method, depreciation_rate, useful_life_years, project_years } = req.body;
  const cost = parseFloat(purchase_cost);
  const salvage = parseFloat(salvage_value || 0);
  const rate = parseFloat(depreciation_rate) / 100;
  const life = parseFloat(useful_life_years);
  const years = parseInt(project_years || life);

  const schedule = [];
  let bookValue = cost;

  for (let y = 1; y <= years; y++) {
    let dep = 0;
    if (method === 'SLM') dep = (cost - salvage) / life;
    else if (method === 'WDV' || method === 'Declining Balance') dep = bookValue * rate;
    dep = Math.min(dep, bookValue - salvage);
    dep = Math.round(dep * 100) / 100;
    const closing = Math.round((bookValue - dep) * 100) / 100;
    schedule.push({ year: y, opening: bookValue, depreciation: dep, closing });
    bookValue = closing;
    if (bookValue <= salvage) break;
  }

  res.json(schedule);
});

module.exports = router;

import React, { useEffect, useState } from 'react';
import api from '../api';
import { toastApiFailure } from '../apiErrorHandling';

const METHODS = ['SLM', 'WDV', 'Declining Balance'];
const METHOD_DESC = {
  SLM: 'Equal charge every year. Best for assets with consistent use.',
  WDV: 'Higher early depreciation. Best for technology assets.',
  'Declining Balance': 'Fixed % on reducing balance. Aggressive early write-off.',
};

const STATUS_COLORS = { success: '#10b981', failed: '#ef4444', partial: '#f59e0b' };

// ── Depreciation Rules Tab ─────────────────────────────────────
function RulesTab({ assetTypes }) {
  const [rules, setRules] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editRule, setEditRule] = useState(null);
  const [form, setForm] = useState({ asset_type_id: '', method: 'SLM', useful_life_years: '', depreciation_rate: '', salvage_value: '', effective_from: new Date().toISOString().split('T')[0], stop_on_disposal: true, partial_year: true });

  const load = () => api.get('/depreciation/rules').then(r => setRules(r.data))
    .catch((e) => toastApiFailure(e, 'Depreciation rules'));

  useEffect(() => { load(); }, []);

  const openAdd = () => { setForm({ asset_type_id: '', method: 'SLM', useful_life_years: '', depreciation_rate: '', salvage_value: '', effective_from: new Date().toISOString().split('T')[0], stop_on_disposal: true, partial_year: true }); setEditRule(null); setShowForm(true); };
  const openEdit = (r) => { setForm({ asset_type_id: r.asset_type_id, method: r.method, useful_life_years: r.useful_life_years, depreciation_rate: r.depreciation_rate, salvage_value: r.salvage_value, effective_from: r.effective_from?.split('T')[0] || '', stop_on_disposal: !!r.stop_on_disposal, partial_year: !!r.partial_year }); setEditRule(r); setShowForm(true); };

  const save = async () => {
    try {
    const at = assetTypes.find(t => String(t.id) === String(form.asset_type_id));
    const payload = { ...form, asset_type_name: at?.name };
    if (editRule) await api.put(`/depreciation/rules/${editRule.id}`, { ...payload, is_active: editRule.is_active });
    else await api.post('/depreciation/rules', payload);
    setShowForm(false); load();
    } catch (e) {
      toastApiFailure(e, 'Depreciation rule');
    }
  };

  const toggleActive = async (rule) => {
    try {
      await api.put(`/depreciation/rules/${rule.id}`, { ...rule, is_active: !rule.is_active });
      load();
    } catch (e) {
      toastApiFailure(e, 'Depreciation rule');
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this rule?')) return;
    try {
      await api.delete(`/depreciation/rules/${id}`);
      load();
    } catch (e) {
      toastApiFailure(e, 'Depreciation rule');
    }
  };

  // Auto-calculate rate from useful life for SLM
  const handleLifeChange = (val) => {
    const newForm = { ...form, useful_life_years: val };
    if (form.method === 'SLM' && val) newForm.depreciation_rate = (100 / parseFloat(val)).toFixed(2);
    setForm(newForm);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={openAdd}>+ Create Rule</button>
      </div>
      <table>
        <thead>
          <tr><th>Rule</th><th>Asset Type</th><th>Method</th><th>Life (yrs)</th><th>Rate %</th><th>Salvage</th><th>Effective From</th><th>Active</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {rules.length === 0 && <tr><td colSpan={9} style={{ textAlign: 'center', color: '#aaa', padding: 32 }}>No rules yet. Click "+ Create Rule" to start.</td></tr>}
          {rules.map(r => (
            <tr key={r.id}>
              <td style={{ fontWeight: 600, color: '#1565c0' }}>{r.rule_code}</td>
              <td>{r.asset_type_name}</td>
              <td><span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '2px 8px', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>{r.method}</span></td>
              <td>{r.useful_life_years} yrs</td>
              <td>{r.depreciation_rate}%</td>
              <td>₹{parseFloat(r.salvage_value).toLocaleString()}</td>
              <td style={{ fontSize: 12 }}>{r.effective_from?.split('T')[0]}</td>
              <td>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!r.is_active} onChange={() => toggleActive(r)} />
                  <span style={{ fontSize: 12, color: r.is_active ? '#10b981' : '#9ca3af' }}>{r.is_active ? 'On' : 'Off'}</span>
                </label>
              </td>
              <td>
                <button className="btn btn-secondary btn-sm" style={{ marginRight: 6 }} onClick={() => openEdit(r)}>Edit</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(r.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showForm && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 520, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2>{editRule ? 'Edit Rule' : 'Create Rule'}</h2>
            <div className="add-asset-form">
              <div className="form-row">
                <label>Asset Type <span className="required">*</span></label>
                <div className="field-wrap">
                  <select value={form.asset_type_id} onChange={e => setForm({ ...form, asset_type_id: e.target.value })}>
                    <option value="">e.g. Server Rack, AC Unit...</option>
                    {assetTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <label>Method <span className="required">*</span></label>
                <div className="field-wrap">
                  <select value={form.method} onChange={e => setForm({ ...form, method: e.target.value })}>
                    {METHODS.map(m => <option key={m} value={m}>{m === 'SLM' ? 'Straight Line (SLM)' : m}</option>)}
                  </select>
                  <span style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{METHOD_DESC[form.method]}</span>
                </div>
              </div>
              <div className="form-row">
                <label>Useful Life (yrs) <span className="required">*</span></label>
                <div className="field-wrap">
                  <input type="number" min="1" value={form.useful_life_years} onChange={e => handleLifeChange(e.target.value)} placeholder="e.g. 5" />
                </div>
              </div>
              <div className="form-row">
                <label>Rate (% / year) <span className="required">*</span></label>
                <div className="field-wrap">
                  <input type="number" step="0.01" value={form.depreciation_rate} onChange={e => setForm({ ...form, depreciation_rate: e.target.value })} placeholder="e.g. 20" />
                </div>
              </div>
              <div className="form-row">
                <label>Salvage Value (₹)</label>
                <div className="field-wrap">
                  <input type="number" value={form.salvage_value} onChange={e => setForm({ ...form, salvage_value: e.target.value })} placeholder="e.g. 5000" />
                </div>
              </div>
              <div className="form-row">
                <label>Effective From <span className="required">*</span></label>
                <div className="field-wrap">
                  <input type="date" value={form.effective_from} onChange={e => setForm({ ...form, effective_from: e.target.value })} />
                </div>
              </div>
              <div className="form-row">
                <label>Options</label>
                <div className="field-wrap" style={{ gap: 8 }}>
                  <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={form.stop_on_disposal} onChange={e => setForm({ ...form, stop_on_disposal: e.target.checked })} />
                    Stop depreciation on disposal
                  </label>
                  <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={form.partial_year} onChange={e => setForm({ ...form, partial_year: e.target.checked })} />
                    Support partial-year depreciation
                  </label>
                </div>
              </div>
            </div>
            <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '10px 14px', marginTop: 12, fontSize: 12, color: '#0369a1' }}>
              <strong>Method guide:</strong><br />
              SLM — Equal charge every year. Best for assets with consistent use.<br />
              WDV — Higher early depreciation. Best for technology assets.<br />
              Declining Balance — Fixed % on reducing balance. Aggressive early write-off.
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>{editRule ? 'Save' : 'Create Rule'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Run History Tab ────────────────────────────────────────────
function RunHistoryTab({ assetTypes }) {
  const [history, setHistory] = useState([]);
  const [running, setRunning] = useState(false);
  const [runForm, setRunForm] = useState({ asset_type_id: '', run_date: new Date().toISOString().split('T')[0] });
  const [expandedRun, setExpandedRun] = useState(null);
  const [entries, setEntries] = useState([]);
  const [bulkForm, setBulkForm] = useState({ asset_type_id: '', purchase_cost: '', salvage_value: '', purchase_date: '' });
  const [bulkSaving, setBulkSaving] = useState(false);

  const load = () => api.get('/depreciation/history').then(r => setHistory(r.data))
    .catch((e) => toastApiFailure(e, 'Depreciation history'));
  useEffect(() => { load(); }, []);

  const runMonthly = async () => {
    if (!runForm.asset_type_id) return alert('Select an asset type');
    setRunning(true);
    try {
      const r = await api.post('/depreciation/run-monthly', runForm);
      alert(`✅ ${r.data.run_code}: ${r.data.processed} assets processed, ₹${parseFloat(r.data.total_depreciation).toLocaleString()} depreciated`);
      load();
    } catch (e) {
      toastApiFailure(e, 'Monthly depreciation run');
    }
    setRunning(false);
  };

  const bulkSetCost = async () => {
    if (!bulkForm.asset_type_id || !bulkForm.purchase_cost) return alert('Select asset type and enter purchase cost');
    setBulkSaving(true);
    try {
      const r = await api.post('/depreciation/financials/bulk', bulkForm);
      alert(`✅ Purchase cost set for ${r.data.updated} assets`);
    } catch (e) {
      toastApiFailure(e, 'Bulk purchase cost');
    }
    setBulkSaving(false);
  };

  const viewEntries = async (run) => {
    if (expandedRun === run.id) { setExpandedRun(null); return; }
    try {
      const r = await api.get(`/depreciation/history/${run.id}/entries`);
      setEntries(r.data);
      setExpandedRun(run.id);
    } catch (e) {
      toastApiFailure(e, 'Run entries');
    }
  };

  return (
    <div>
      {/* Bulk set purchase cost */}
      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: '#92400e', marginBottom: 10 }}>
          ⚡ Quick Setup — Set Purchase Cost for All Assets of a Type
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase' }}>Asset Type</div>
            <select value={bulkForm.asset_type_id} onChange={e => setBulkForm({ ...bulkForm, asset_type_id: e.target.value })}
              style={{ padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, minWidth: 160 }}>
              <option value="">— Select —</option>
              {assetTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase' }}>Purchase Cost (₹)</div>
            <input type="number" value={bulkForm.purchase_cost} onChange={e => setBulkForm({ ...bulkForm, purchase_cost: e.target.value })}
              placeholder="e.g. 80000" style={{ padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, width: 130 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase' }}>Salvage Value (₹)</div>
            <input type="number" value={bulkForm.salvage_value} onChange={e => setBulkForm({ ...bulkForm, salvage_value: e.target.value })}
              placeholder="e.g. 5000" style={{ padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, width: 120 }} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase' }}>Purchase Date</div>
            <input type="date" value={bulkForm.purchase_date} onChange={e => setBulkForm({ ...bulkForm, purchase_date: e.target.value })}
              style={{ padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13 }} />
          </div>
          <button className="btn btn-primary" onClick={bulkSetCost} disabled={bulkSaving}>
            {bulkSaving ? 'Setting...' : 'Set for All Assets'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: '#92400e', marginTop: 8 }}>
          * Only sets cost for assets that don't already have a different book value (won't overwrite existing depreciated values)
        </div>
      </div>

      {/* Run trigger */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-end', border: '1px solid #e8edf2' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Asset Type</div>
          <select value={runForm.asset_type_id} onChange={e => setRunForm({ ...runForm, asset_type_id: e.target.value })}
            style={{ padding: '8px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, minWidth: 180 }}>
            <option value="">— Select —</option>
            {assetTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Run Date</div>
          <input type="date" value={runForm.run_date} onChange={e => setRunForm({ ...runForm, run_date: e.target.value })}
            style={{ padding: '8px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13 }} />
        </div>
        <button className="btn btn-primary" onClick={runMonthly} disabled={running}>
          {running ? '⏳ Running...' : '▶ Run Monthly Depreciation'}
        </button>
      </div>

      <table>
        <thead>
          <tr><th>Run ID</th><th>Date</th><th>Asset Type</th><th>Assets</th><th>Total Depreciation</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {history.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: '#aaa', padding: 32 }}>No runs yet</td></tr>}
          {history.map(h => (
            <React.Fragment key={h.id}>
              <tr>
                <td style={{ fontWeight: 600, color: '#1565c0', cursor: 'pointer' }} onClick={() => viewEntries(h)}>{h.run_code}</td>
                <td style={{ fontSize: 13 }}>{h.run_date?.split('T')[0]}</td>
                <td>{h.asset_type_name}</td>
                <td>{h.assets_processed} assets</td>
                <td style={{ fontWeight: 600 }}>₹{parseFloat(h.total_depreciation || 0).toLocaleString()}</td>
                <td>
                  <span style={{ background: STATUS_COLORS[h.status] + '22', color: STATUS_COLORS[h.status], padding: '2px 10px', borderRadius: 10, fontSize: 12, fontWeight: 600 }}>
                    {h.status}
                  </span>
                </td>
                <td>
                  <button className="btn btn-secondary btn-sm" onClick={() => viewEntries(h)}>
                    {expandedRun === h.id ? '▲ Hide' : '▼ Details'}
                  </button>
                </td>
              </tr>
              {expandedRun === h.id && (
                <tr>
                  <td colSpan={7} style={{ padding: 0, background: '#f8fafc' }}>
                    <div style={{ padding: '12px 20px' }}>
                      <table style={{ boxShadow: 'none', border: '1px solid #e8edf2' }}>
                        <thead><tr><th>Asset</th><th>Serial</th><th>Opening Value</th><th>Depreciation</th><th>Closing Value</th><th>Method</th></tr></thead>
                        <tbody>
                          {entries.map(e => (
                            <tr key={e.id}>
                              <td style={{ fontSize: 13 }}>{e.asset_name}</td>
                              <td style={{ fontSize: 13 }}>{e.asset_serial || '—'}</td>
                              <td>₹{parseFloat(e.opening_value).toLocaleString()}</td>
                              <td style={{ color: '#ef4444', fontWeight: 500 }}>-₹{parseFloat(e.depreciation_amount).toLocaleString()}</td>
                              <td style={{ color: '#10b981', fontWeight: 500 }}>₹{parseFloat(e.closing_value).toLocaleString()}</td>
                              <td><span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '1px 6px', borderRadius: 6, fontSize: 11 }}>{e.method}</span></td>
                            </tr>
                          ))}
                          {entries.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: '#aaa' }}>No entries</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Calculator Tab ─────────────────────────────────────────────
function CalculatorTab({ rules }) {
  const [form, setForm] = useState({ purchase_cost: '', salvage_value: '', method: 'SLM', depreciation_rate: '', useful_life_years: '', project_years: '' });
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadFromRule = (ruleId) => {
    if (!ruleId) return;
    const rule = rules.find(r => String(r.id) === ruleId);
    if (rule) setForm(f => ({ ...f, method: rule.method, depreciation_rate: rule.depreciation_rate, useful_life_years: rule.useful_life_years, salvage_value: rule.salvage_value, project_years: rule.useful_life_years }));
  };

  const calculate = async () => {
    if (!form.purchase_cost || !form.depreciation_rate || !form.useful_life_years) return alert('Fill in Purchase Cost, Rate, and Useful Life');
    setLoading(true);
    try {
      const r = await api.post('/depreciation/calculate', form);
      setSchedule(r.data);
    } catch (e) {
      toastApiFailure(e, 'Depreciation calculator');
    }
    setLoading(false);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 20 }}>
      {/* Input panel */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #e8edf2' }}>
        <h3 style={{ marginBottom: 20, fontSize: 15, fontWeight: 700 }}>Depreciation Calculator</h3>
        <div className="add-asset-form">
          <div className="form-row">
            <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280' }}>Load from Rule</label>
            <div className="field-wrap">
              <select onChange={e => loadFromRule(e.target.value)}>
                <option value="">-- or enter manually --</option>
                {rules.map(r => <option key={r.id} value={r.id}>{r.rule_code} — {r.asset_type_name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <label style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280' }}>Purchase Cost (₹) *</label>
            <div className="field-wrap">
              <input type="number" value={form.purchase_cost} onChange={e => setForm({ ...form, purchase_cost: e.target.value })} placeholder="80000" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', marginBottom: 6 }}>Method</div>
              <select value={form.method} onChange={e => setForm({ ...form, method: e.target.value })} style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13 }}>
                {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', marginBottom: 6 }}>Rate (% / Year)</div>
              <input type="number" step="0.01" value={form.depreciation_rate} onChange={e => setForm({ ...form, depreciation_rate: e.target.value })} placeholder="33.33" style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13 }} />
            </div>
            <div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', marginBottom: 6 }}>Useful Life (Years)</div>
              <input type="number" value={form.useful_life_years} onChange={e => setForm({ ...form, useful_life_years: e.target.value })} placeholder="3" style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13 }} />
            </div>
            <div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', marginBottom: 6 }}>Salvage Value (₹)</div>
              <input type="number" value={form.salvage_value} onChange={e => setForm({ ...form, salvage_value: e.target.value })} placeholder="5000" style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13 }} />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#6b7280', marginBottom: 6 }}>Project for (Years)</div>
            <input type="number" value={form.project_years} onChange={e => setForm({ ...form, project_years: e.target.value })} placeholder="3" style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13 }} />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={calculate} disabled={loading}>
            {loading ? 'Calculating...' : 'Calculate'}
          </button>
        </div>
      </div>

      {/* Result panel */}
      <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #e8edf2' }}>
        <h3 style={{ marginBottom: 20, fontSize: 15, fontWeight: 700 }}>Depreciation Schedule</h3>
        {schedule.length === 0 ? (
          <div style={{ color: '#9ca3af', fontFamily: 'monospace', fontSize: 13, padding: 20, background: '#f8fafc', borderRadius: 8 }}>
            // Configure inputs and click Calculate
          </div>
        ) : (
          <table style={{ boxShadow: 'none', border: '1px solid #e8edf2' }}>
            <thead><tr><th>Year</th><th>Opening Value (₹)</th><th>Depreciation (₹)</th><th>Closing Value (₹)</th></tr></thead>
            <tbody>
              {schedule.map(s => (
                <tr key={s.year}>
                  <td style={{ fontWeight: 600 }}>Year {s.year}</td>
                  <td>₹{s.opening.toLocaleString()}</td>
                  <td style={{ color: '#ef4444', fontWeight: 500 }}>-₹{s.depreciation.toLocaleString()}</td>
                  <td style={{ color: '#10b981', fontWeight: 600 }}>₹{s.closing.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Audit Log Tab ──────────────────────────────────────────────
function AuditTab() {
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    api.get('/depreciation/audit').then(r => setLogs(r.data)).catch((e) => toastApiFailure(e, 'Depreciation audit'));
  }, []);

  return (
    <table>
      <thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
      <tbody>
        {logs.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: '#aaa', padding: 32 }}>No audit entries yet</td></tr>}
        {logs.map(l => (
          <tr key={l.id}>
            <td style={{ fontSize: 12, color: '#6b7280' }}>{new Date(l.logged_at).toLocaleString()}</td>
            <td style={{ fontSize: 13, color: '#1565c0', fontFamily: 'monospace' }}>{l.performed_by || '—'}</td>
            <td style={{ fontWeight: 600, fontSize: 13 }}>{l.action}</td>
            <td style={{ fontSize: 13, color: '#6b7280' }}>{l.target || '—'}</td>
            <td style={{ fontSize: 12, color: '#9ca3af' }}>{l.details || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Main Page ──────────────────────────────────────────────────
export default function Depreciation() {
  const [tab, setTab] = useState('rules');
  const [assetTypes, setAssetTypes] = useState([]);
  const [rules, setRules] = useState([]);

  useEffect(() => {
    api.get('/asset-types').then(r => setAssetTypes(r.data)).catch((e) => toastApiFailure(e, 'Asset types'));
    api.get('/depreciation/rules').then(r => setRules(r.data)).catch((e) => toastApiFailure(e, 'Depreciation rules'));
  }, []);

  return (
    <div>
      <div className="page-header">
        <h1>Depreciation</h1>
        <span style={{ fontSize: 13, color: '#6b7280' }}>Asset depreciation rule engine</span>
      </div>

      <div className="detail-tabs" style={{ marginBottom: 24 }}>
        {[['rules', 'Depreciation Rules'], ['history', 'Run History'], ['calculator', 'Calculator'], ['audit', 'Audit Log']].map(([key, label]) => (
          <button key={key} className={`tab-btn ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === 'rules' && <RulesTab assetTypes={assetTypes} />}
      {tab === 'history' && <RunHistoryTab assetTypes={assetTypes} />}
      {tab === 'calculator' && <CalculatorTab rules={rules} />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}

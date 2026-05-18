import React, { useEffect, useState, useMemo } from 'react';
import api from '../api';
import { toastApiFailure } from '../apiErrorHandling';

const FILTER_LABELS = { asset: 'Asset', inventory: 'Inventory', attribute: 'Attribute', maintenance: 'Maintenance' };
const FILTER_COLORS = { asset: '#7c8cf8', inventory: '#68d391', attribute: '#f6ad55', maintenance: '#fc8181' };

// ── Alert Badge ────────────────────────────────────────────────
function FilterBadge({ type }) {
  return (
    <span style={{ background: FILTER_COLORS[type] + '22', color: FILTER_COLORS[type], padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
      {FILTER_LABELS[type]}
    </span>
  );
}

// ── Step Wizard for Rule Creation ──────────────────────────────
function RuleWizard({ locations, assetTypes, onClose, onSaved, editRule }) {
  const [step, setStep] = useState(1);
  const [filterType, setFilterType] = useState(editRule?.filter_type || '');
  const [form, setForm] = useState({
    location_id: editRule?.location_id || '',
    include_sub_locations: editRule?.include_sub_locations || false,
    asset_type_id: editRule?.asset_type_id || '',
    asset_action: editRule?.asset_action || '',
    duration_value: editRule?.duration_value || '',
    duration_unit: editRule?.duration_unit || 'hours',
    duration_condition: editRule?.duration_condition || 'more_than',
    inventory_condition: editRule?.inventory_condition || 'greater_than',
    inventory_value: editRule?.inventory_value || '',
    attribute_id: editRule?.attribute_id || '',
    attribute_condition: editRule?.attribute_condition || 'is',
    attribute_value: editRule?.attribute_value || '',
    maintenance_alert_value: editRule?.maintenance_alert_value || '',
    maintenance_alert_unit: editRule?.maintenance_alert_unit || 'days',
    maintenance_condition: editRule?.maintenance_condition || 'before',
    action_type: editRule?.action_type || 'system_alert',
    action_email: editRule?.action_email || '',
    name: editRule?.name || '',
    description: editRule?.description || '',
  });
  const [allAttrs, setAllAttrs] = useState([]);
  const [allDateAttrs, setAllDateAttrs] = useState([]);

  // Load attributes when asset type selected (for attribute filter)
  useEffect(() => {
    if (!form.asset_type_id) { setAllAttrs([]); return; }
    api.get(`/asset-types/${form.asset_type_id}/attributes`).then(r => setAllAttrs(r.data))
      .catch((e) => toastApiFailure(e, 'Rule wizard · attributes'));
  }, [form.asset_type_id]);

  // Load ALL date attributes across all asset types (for maintenance filter)
  useEffect(() => {
    if (filterType !== 'maintenance') return;
    api.get('/asset-types').then(async r => {
      const types = r.data;
      const seen = new Set();
      const attrs = [];
      for (const t of types) {
        const ar = await api.get(`/asset-types/${t.id}/attributes`);
        ar.data.filter(a => a.attr_type === 'date').forEach(a => {
          if (!seen.has(a.name.toLowerCase())) {
            seen.add(a.name.toLowerCase());
            attrs.push({ ...a, type_name: t.name });
          }
        });
      }
      setAllDateAttrs(attrs);
    }).catch((e) => toastApiFailure(e, 'Rule wizard · attributes'));
  }, [filterType]);

  const needsDuration = ['stays_at', 'not_scanned', 'is_missing'].includes(form.asset_action);

  const save = async () => {
    if (!form.name.trim()) {
      toastApiFailure('Rule name is required', 'Rules');
      return;
    }
    const payload = { ...form, filter_type: filterType };
    try {
      if (editRule) await api.put(`/rules/${editRule.id}`, payload);
      else await api.post('/rules', payload);
      onSaved();
      onClose();
    } catch (e) {
      toastApiFailure(e, 'Rules');
    }
  };

  const totalSteps = filterType === 'asset' ? 4 : filterType === 'inventory' ? 4 : filterType === 'maintenance' ? 4 : 1;

  return (
    <div className="modal-overlay" style={{ zIndex: 200 }}>
      <div className="modal" style={{ width: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <h2>{editRule ? 'Edit Rule' : 'Create Rule'}</h2>

        {/* Step indicators */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
          {['Filter', 'Location & Type', 'Condition', 'Action & Save'].map((label, i) => (
            <span key={i} style={{ flex: 1, textAlign: 'center', padding: '4px 0', borderRadius: 6, fontSize: 12,
              background: step === i + 1 ? '#7c8cf8' : step > i + 1 ? '#c6f6d5' : '#f0f2f5',
              color: step === i + 1 ? '#fff' : step > i + 1 ? '#276749' : '#888' }}>
              {label}
            </span>
          ))}
        </div>

        {/* Step 1: Choose filter type */}
        {step === 1 && (
          <div>
            <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>Select the type of rule you want to create:</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { key: 'asset', label: 'Asset Filter', desc: 'Alert when asset enters, exits, stays, or is missing' },
                { key: 'inventory', label: 'Inventory Filter', desc: 'Alert based on asset count at a location' },
                { key: 'maintenance', label: 'Maintenance Filter', desc: 'Alert based on date attributes (warranty, maintenance)' },
              ].map(f => (
                <div key={f.key} onClick={() => setFilterType(f.key)}
                  style={{ padding: 16, border: `2px solid ${filterType === f.key ? '#7c8cf8' : '#e2e8f0'}`, borderRadius: 8, cursor: 'pointer', background: filterType === f.key ? '#f0f2ff' : '#fff' }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: FILTER_COLORS[f.key], marginBottom: 4 }}>{f.label}</div>
                  <div style={{ fontSize: 12, color: '#888' }}>{f.desc}</div>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={!filterType} onClick={() => setStep(2)}>Next →</button>
            </div>
          </div>
        )}

        {/* Step 2: Location & Asset Type */}
        {step === 2 && (
          <div>
            <div className="add-asset-form">
              <div className="form-row">
                <label>Location</label>
                <div className="field-wrap">
                  <select value={form.location_id} onChange={e => setForm({ ...form, location_id: e.target.value })}>
                    <option value="">— Any Location —</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
              </div>
              {form.location_id && (
                <div className="form-row">
                  <label />
                  <div className="field-wrap">
                    <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input type="checkbox" checked={form.include_sub_locations} onChange={e => setForm({ ...form, include_sub_locations: e.target.checked })} />
                      Include Sub-Locations
                    </label>
                  </div>
                </div>
              )}
              <div className="form-row">
                <label>Asset Type</label>
                <div className="field-wrap">
                  <select value={form.asset_type_id} onChange={e => setForm({ ...form, asset_type_id: e.target.value })}>
                    <option value="">— Any Asset Type —</option>
                    {assetTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setStep(1)}>← Back</button>
              <button className="btn btn-primary" onClick={() => setStep(3)}>Next →</button>
            </div>
          </div>
        )}

        {/* Step 3: Condition */}
        {step === 3 && (
          <div>
            <div className="add-asset-form">
              {filterType === 'asset' && (
                <>
                  <div className="form-row">
                    <label>Asset Action</label>
                    <div className="field-wrap">
                      <select value={form.asset_action} onChange={e => setForm({ ...form, asset_action: e.target.value })}>
                        <option value="">— Select —</option>
                        <option value="enters">Enters</option>
                        <option value="exits">Exits</option>
                        <option value="stays_at">Stays At</option>
                        <option value="not_scanned">Not Scanned</option>
                        <option value="is_missing">Is Missing</option>
                        <option value="is_added">Is Added</option>
                        <option value="is_deleted">Is Deleted</option>
                      </select>
                    </div>
                  </div>
                  {needsDuration && (
                    <>
                      <div className="form-row">
                        <label>Condition</label>
                        <div className="field-wrap">
                          <select value={form.duration_condition} onChange={e => setForm({ ...form, duration_condition: e.target.value })}>
                            <option value="more_than">More than</option>
                            <option value="less_than">Less than</option>
                          </select>
                        </div>
                      </div>
                      <div className="form-row">
                        <label>Duration</label>
                        <div className="field-wrap" style={{ flexDirection: 'row', gap: 8 }}>
                          <input type="number" min="1" value={form.duration_value} onChange={e => setForm({ ...form, duration_value: e.target.value })} placeholder="e.g. 2" style={{ width: 80 }} />
                          <select value={form.duration_unit} onChange={e => setForm({ ...form, duration_unit: e.target.value })}>
                            <option value="minutes">Minutes</option>
                            <option value="hours">Hours</option>
                            <option value="days">Days</option>
                            <option value="weeks">Weeks</option>
                            <option value="months">Months</option>
                            <option value="years">Years</option>
                          </select>
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}

              {filterType === 'inventory' && (
                <>
                  <div className="form-row">
                    <label>Inventory is</label>
                    <div className="field-wrap" style={{ flexDirection: 'row', gap: 8 }}>
                      <select value={form.inventory_condition} onChange={e => setForm({ ...form, inventory_condition: e.target.value })}>
                        <option value="equal_to">Equal to</option>
                        <option value="greater_than">Greater than</option>
                        <option value="less_than">Less than</option>
                      </select>
                      <input type="number" min="0" value={form.inventory_value} onChange={e => setForm({ ...form, inventory_value: e.target.value })} placeholder="Count" style={{ width: 80 }} />
                    </div>
                  </div>
                </>
              )}

              {filterType === 'maintenance' && (
                <>
                  <div className="form-row">
                    <label>Date Attribute</label>
                    <div className="field-wrap">
                      <select value={form.attribute_id} onChange={e => setForm({ ...form, attribute_id: e.target.value })}>
                        <option value="">— Select date attribute —</option>
                        {allDateAttrs.map(a => (
                          <option key={a.id} value={a.id}>{a.name} ({a.type_name})</option>
                        ))}
                      </select>
                      {allDateAttrs.length === 0 && <span style={{ fontSize: 12, color: '#e53e3e' }}>No date attributes found. Add date-type attributes to asset types first.</span>}
                    </div>
                  </div>
                  <div className="form-row">
                    <label>Alert</label>
                    <div className="field-wrap" style={{ flexDirection: 'row', gap: 8 }}>
                      <input type="number" min="1" value={form.maintenance_alert_value} onChange={e => setForm({ ...form, maintenance_alert_value: e.target.value })} placeholder="e.g. 7" style={{ width: 80 }} />
                      <select value={form.maintenance_alert_unit} onChange={e => setForm({ ...form, maintenance_alert_unit: e.target.value })}>
                        <option value="minutes">Minutes</option>
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                        <option value="weeks">Weeks</option>
                        <option value="months">Months</option>
                        <option value="years">Years</option>
                      </select>
                      <select value={form.maintenance_condition} onChange={e => setForm({ ...form, maintenance_condition: e.target.value })}>
                        <option value="before">Before</option>
                        <option value="after">After</option>
                      </select>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setStep(2)}>← Back</button>
              <button className="btn btn-primary" onClick={() => setStep(4)}>Next →</button>
            </div>
          </div>
        )}

        {/* Step 4: Action + Name + Save */}
        {step === 4 && (
          <div>
            <div className="add-asset-form">
              <div className="form-row">
                <label>Action</label>
                <div className="field-wrap">
                  <select value={form.action_type} onChange={e => setForm({ ...form, action_type: e.target.value })}>
                    <option value="system_alert">System Alert (in-app)</option>
                    <option value="email_alert">Email Alert</option>
                    <option value="both">Both</option>
                  </select>
                </div>
              </div>
              {(form.action_type === 'email_alert' || form.action_type === 'both') && (
                <div className="form-row">
                  <label>Email Address</label>
                  <div className="field-wrap">
                    <input type="email" value={form.action_email} onChange={e => setForm({ ...form, action_email: e.target.value })} placeholder="alerts@example.com" />
                  </div>
                </div>
              )}
              <div className="form-row">
                <label>Rule Name <span className="required">*</span></label>
                <div className="field-wrap">
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Enter rule name" />
                </div>
              </div>
              <div className="form-row">
                <label>Description</label>
                <div className="field-wrap">
                  <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} placeholder="Optional description" />
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setStep(3)}>← Back</button>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>Save Rule</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Alerts Tab ─────────────────────────────────────────────────
function AlertsTab() {
  const [alerts, setAlerts] = useState([]);
  const [activeTab, setActiveTab] = useState('asset');
  const loadFailRef = React.useRef(0);

  const load = () => api.get('/alerts', { params: { filter_type: activeTab } }).then(r => setAlerts(r.data))
    .catch((e) => {
      const now = Date.now();
      if (now - loadFailRef.current > 12000) {
        loadFailRef.current = now;
        toastApiFailure(e, 'Alerts');
      }
    });

  useEffect(() => {
    load();
    // Poll every 3 seconds for real-time alert updates
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [activeTab]);

  const markAllRead = async () => {
    try {
      await api.put('/alerts/mark-read');
      load();
    } catch (e) {
      toastApiFailure(e, 'Alerts');
    }
  };
  const clearAll = async () => {
    if (!window.confirm('Clear all alerts?')) return;
    try {
      await api.delete('/alerts');
      load();
    } catch (e) {
      toastApiFailure(e, 'Alerts');
    }
  };
  const deleteAlert = async (id) => {
    try {
      await api.delete(`/alerts/${id}`);
      load();
    } catch (e) {
      toastApiFailure(e, 'Alerts');
    }
  };

  const unread = alerts.filter(a => !a.is_read).length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {['asset', 'inventory', 'maintenance'].map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={`tab-btn ${activeTab === t ? 'active' : ''}`}>
              {FILTER_LABELS[t]} Alerts
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {unread > 0 && <button className="btn btn-secondary btn-sm" onClick={markAllRead}>Mark All Read ({unread})</button>}
          <button className="btn btn-secondary btn-sm" onClick={clearAll}>Clear All</button>
          <button className="btn btn-secondary btn-sm" onClick={load}>↻ Refresh</button>
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Rule</th>
              <th>Alert Time</th>
              <th>Description</th>
              <th>Asset Serial</th>
              <th>Asset Type</th>
              <th>Last Location</th>
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {alerts.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: '#aaa', padding: 32 }}>No alerts</td></tr>
            )}
            {alerts.map(a => (
              <tr key={a.id} style={{ background: a.is_read ? 'inherit' : '#fffbeb', fontWeight: a.is_read ? 400 : 500 }}>
                <td><FilterBadge type={a.filter_type} /><span style={{ marginLeft: 6, fontSize: 13 }}>{a.rule_name}</span></td>
                <td style={{ fontSize: 12, color: '#666' }}>{new Date(a.alert_time).toLocaleString()}</td>
                <td style={{ fontSize: 13 }}>{a.description}</td>
                <td style={{ fontSize: 13 }}>{a.asset_serial || '—'}</td>
                <td style={{ fontSize: 13 }}>{a.asset_type || '—'}</td>
                <td style={{ fontSize: 13 }}>{a.last_known_location || '—'}</td>
                <td>
                  <button onClick={() => deleteAlert(a.id)} style={{ background: 'none', border: 'none', color: '#e53e3e', cursor: 'pointer', fontSize: 16 }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ruleMatchesSearch(rule, query) {
  if (!query) return true;
  const action =
    rule.action_type === 'system_alert' ? 'system' :
    rule.action_type === 'email_alert' ? 'email' : 'both';
  const haystack = [
    rule.name,
    rule.description,
    rule.location_name,
    rule.asset_type_name,
    FILTER_LABELS[rule.filter_type],
    action,
    rule.is_active ? 'active on' : 'inactive off',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

// ── Rules Tab ──────────────────────────────────────────────────
function RulesTab({ locations, assetTypes }) {
  const [rules, setRules] = useState([]);
  const [showWizard, setShowWizard] = useState(false);
  const [editRule, setEditRule] = useState(null);
  const [search, setSearch] = useState('');

  const searchQuery = search.trim().toLowerCase();
  const filteredRules = useMemo(
    () => rules.filter((r) => ruleMatchesSearch(r, searchQuery)),
    [rules, searchQuery]
  );

  const load = () => api.get('/rules').then(r => setRules(r.data))
    .catch((e) => toastApiFailure(e, 'Rules'));
  useEffect(() => { load(); }, []);

  const deleteRule = async (id) => {
    if (!window.confirm('Delete this rule?')) return;
    try {
      await api.delete(`/rules/${id}`);
      load();
    } catch (e) {
      toastApiFailure(e, 'Rules');
    }
  };

  const toggleActive = async (rule) => {
    try {
      await api.put(`/rules/${rule.id}`, { ...rule, is_active: !rule.is_active });
      load();
    } catch (e) {
      toastApiFailure(e, 'Rules');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 360 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none', display: 'flex' }}>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search rules…"
            aria-label="Search rules"
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px 8px 34px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13 }}
          />
        </div>
        <button type="button" className="btn btn-primary" onClick={() => { setEditRule(null); setShowWizard(true); }}>+ Create Rule</button>
      </div>

      <div style={{ background: '#fff', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
        <table>
          <thead>
            <tr><th>Rule Name</th><th>Type</th><th>Location</th><th>Asset Type</th><th>Action</th><th>Active</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rules.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: '#aaa', padding: 32 }}>No rules yet. Click "+ Create Rule" to get started.</td></tr>
            )}
            {rules.length > 0 && filteredRules.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: '#aaa', padding: 32 }}>No rules match your search.</td></tr>
            )}
            {filteredRules.map(r => (
              <tr key={r.id}>
                <td>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{r.name}</div>
                  {r.description && <div style={{ fontSize: 12, color: '#888' }}>{r.description}</div>}
                </td>
                <td><FilterBadge type={r.filter_type} /></td>
                <td style={{ fontSize: 13 }}>{r.location_name || 'Any'}</td>
                <td style={{ fontSize: 13 }}>{r.asset_type_name || 'Any'}</td>
                <td style={{ fontSize: 13 }}>
                  {r.action_type === 'system_alert' ? '🔔 System' : r.action_type === 'email_alert' ? '📧 Email' : '🔔📧 Both'}
                </td>
                <td>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!r.is_active} onChange={() => toggleActive(r)} />
                    <span style={{ fontSize: 12, color: r.is_active ? '#276749' : '#888' }}>{r.is_active ? 'On' : 'Off'}</span>
                  </label>
                </td>
                <td>
                  <button className="btn btn-secondary btn-sm" style={{ marginRight: 6 }} onClick={() => { setEditRule(r); setShowWizard(true); }}>Edit</button>
                  <button className="btn btn-danger btn-sm" onClick={() => deleteRule(r.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showWizard && (
        <RuleWizard
          locations={locations} assetTypes={assetTypes}
          editRule={editRule}
          onClose={() => setShowWizard(false)}
          onSaved={load}
        />
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────
export default function RulesAlerts() {
  const [tab, setTab] = useState('alerts');
  const [locations, setLocations] = useState([]);
  const [assetTypes, setAssetTypes] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const unreadFailRef = React.useRef(0);

  useEffect(() => {
    api.get('/locations').then(r => setLocations(r.data)).catch((e) => toastApiFailure(e, 'Locations'));
    api.get('/asset-types').then(r => setAssetTypes(r.data)).catch((e) => toastApiFailure(e, 'Asset types'));
    // Poll unread count every 3s
    const loadCount = () => api.get('/alerts/unread-count').then(r => setUnreadCount(r.data.count)).catch((e) => {
      const now = Date.now();
      if (now - unreadFailRef.current > 12000) {
        unreadFailRef.current = now;
        toastApiFailure(e, 'Unread alerts');
      }
    });
    loadCount();
    const interval = setInterval(loadCount, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <div className="page-header"><h1>Rules & Alerts</h1></div>

      <div className="detail-tabs" style={{ marginBottom: 24 }}>
        <button className={`tab-btn ${tab === 'alerts' ? 'active' : ''}`} onClick={() => setTab('alerts')}>
          Alerts {unreadCount > 0 && <span style={{ background: '#e53e3e', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 11, marginLeft: 6 }}>{unreadCount}</span>}
        </button>
        <button className={`tab-btn ${tab === 'rules' ? 'active' : ''}`} onClick={() => setTab('rules')}>Rules</button>
      </div>

      {tab === 'alerts' && <AlertsTab />}
      {tab === 'rules' && <RulesTab locations={locations} assetTypes={assetTypes} />}
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import api from '../api';
import { toastApiFailure } from '../apiErrorHandling';
import ConfirmModal from '../components/ConfirmModal';

const PROFILE_LABELS = {
  super_admin: 'Super Administrator',
  admin: 'Administrator',
  normal: 'Normal',
};

const PROFILE_DESC = {
  super_admin: 'All rights including user management.',
  admin: 'All rights except user management, import and reorganize.',
  normal: 'Read-only access. Cannot add, edit or delete.',
};

function parsePriv(val) {
  if (!val) return null;
  if (Array.isArray(val)) return val.length ? val : null;
  try { const p = JSON.parse(val); return p && p.length ? p : null; } catch { return null; }
}

function userMatchesSearch(user, q) {
  if (!q) return true;
  const hay = [
    user.username,
    user.email,
    PROFILE_LABELS[user.profile_type],
    user.profile_type,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

// ── Location Tree Privilege Picker ────────────────────────────
// Shows the full location hierarchy as a tree with checkboxes
function LocationTreePicker({ locations, selected, onClose, onSave }) {
  const [sel, setSel] = useState(selected || null); // null = Any, or array of ids
  const [expanded, setExpanded] = useState({}); // { id: bool }

  // Build tree from flat list
  const buildTree = (items, parentId = null) =>
    items
      .filter(i => (i.parent_id || null) == parentId)
      .map(i => ({ ...i, children: buildTree(items, i.id) }));
  const tree = buildTree(locations);

  // Default all parents expanded
  useEffect(() => {
    const exp = {};
    locations.forEach(l => { if (l.parent_id === null || l.parent_id === undefined) exp[l.id] = true; });
    setExpanded(exp);
  }, [locations]);

  const toggle = (id) => {
    if (sel === null) { setSel([id]); return; }
    const next = sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id];
    setSel(next.length ? next : null);
  };

  const toggleExpand = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  const isChecked = (id) => sel === null || sel.includes(id);

  const renderNode = (node, depth = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const isOpen = expanded[node.id] !== false; // default open

    return (
      <div key={node.id}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 0,
            padding: `7px 12px 7px ${12 + depth * 20}px`,
            cursor: 'pointer', fontSize: 13,
            borderBottom: '1px solid #f1f5f9',
            background: isChecked(node.id) && sel !== null ? '#eff6ff' : 'transparent',
            transition: 'background 0.1s',
          }}
          onMouseEnter={e => { if (!isChecked(node.id) || sel === null) e.currentTarget.style.background = '#f8fafc'; }}
          onMouseLeave={e => { e.currentTarget.style.background = isChecked(node.id) && sel !== null ? '#eff6ff' : 'transparent'; }}
        >
          {/* Expand/collapse — only for nodes with children */}
          <span
            onClick={e => { e.stopPropagation(); if (hasChildren) toggleExpand(node.id); }}
            style={{
              width: 18, flexShrink: 0, textAlign: 'center',
              color: '#94a3b8', fontSize: 10,
              cursor: hasChildren ? 'pointer' : 'default',
              userSelect: 'none',
            }}
          >
            {hasChildren ? (isOpen ? '▾' : '▸') : ''}
          </span>

          {/* Checkbox + name */}
          <span
            onClick={() => toggle(node.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}
          >
            <input
              type="checkbox"
              readOnly
              checked={isChecked(node.id)}
              style={{ pointerEvents: 'none', accentColor: '#2563EB', flexShrink: 0 }}
            />
            <span style={{
              fontWeight: depth === 0 ? 600 : 400,
              color: isChecked(node.id) && sel !== null ? '#1d4ed8' : '#1e293b',
            }}>
              {node.name}
            </span>
            {node.location_type_name && (
              <span style={{ fontSize: 10, background: '#e0e7ff', color: '#4338ca', padding: '1px 6px', borderRadius: 8, flexShrink: 0 }}>
                {node.location_type_name}
              </span>
            )}
            {hasChildren && (
              <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 'auto', flexShrink: 0 }}>
                {node.children.length} sub
              </span>
            )}
          </span>
        </div>

        {/* Children */}
        {isOpen && hasChildren && node.children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  };

  const selectedCount = sel ? sel.length : 0;

  return (
    <div className="modal-overlay" style={{ zIndex: 400 }}>
      <div className="modal" style={{ width: 440 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Location Privileges</h2>
          {sel !== null && (
            <span style={{ fontSize: 12, color: '#2563EB', fontWeight: 600, background: '#eff6ff', padding: '2px 8px', borderRadius: 5 }}>
              {selectedCount} selected
            </span>
          )}
        </div>
        <p style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
          Select locations. Sub-locations are automatically included at runtime.
        </p>

        {/* Any (All) option */}
        <div
          onClick={() => setSel(null)}
          style={{
            padding: '9px 12px', cursor: 'pointer', fontSize: 13,
            background: sel === null ? '#eff6ff' : '#fafbfc',
            fontWeight: sel === null ? 600 : 400,
            color: sel === null ? '#2563EB' : '#374151',
            borderBottom: '2px solid #e2e8f0',
            borderRadius: '6px 6px 0 0',
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <input type="checkbox" readOnly checked={sel === null} style={{ pointerEvents: 'none', accentColor: '#2563EB' }} />
          — Any Location (All) —
        </div>

        {/* Tree */}
        <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 6px 6px', marginBottom: 16 }}>
          {locations.length === 0
            ? <div style={{ padding: 16, color: '#aaa', fontSize: 13, textAlign: 'center' }}>No locations found</div>
            : tree.map(node => renderNode(node))
          }
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(sel)}>
            {sel === null ? 'Allow All' : `Allow ${selectedCount} Location${selectedCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Asset Type Tree Privilege Picker ──────────────────────────
// Mirrors LocationTreePicker — shows asset types in parent/child hierarchy
function AssetTypeTreePicker({ assetTypes, selected, onClose, onSave }) {
  const [sel, setSel] = useState(selected || null); // null = Any, array of ids = restricted
  const [expanded, setExpanded] = useState({});

  // Build tree from flat list using parent_id
  const buildTree = (items, parentId = null) =>
    items
      .filter(i => (i.parent_id || null) == parentId)
      .map(i => ({ ...i, children: buildTree(items, i.id) }));
  const tree = buildTree(assetTypes);

  // Default: expand all root nodes
  useEffect(() => {
    const exp = {};
    assetTypes.forEach(t => { if (!t.parent_id) exp[t.id] = true; });
    setExpanded(exp);
  }, [assetTypes]);

  const toggle = (id) => {
    if (sel === null) { setSel([id]); return; }
    const next = sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id];
    setSel(next.length ? next : null);
  };

  const toggleExpand = (id) =>
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  const isChecked = (id) => sel === null || sel.includes(id);

  const renderNode = (node, depth = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const isOpen = expanded[node.id] !== false;

    return (
      <div key={node.id}>
        <div
          style={{
            display: 'flex', alignItems: 'center',
            padding: `7px 12px 7px ${12 + depth * 20}px`,
            borderBottom: '1px solid #f1f5f9',
            background: isChecked(node.id) && sel !== null ? '#eff6ff' : 'transparent',
            transition: 'background 0.1s',
          }}
          onMouseEnter={e => { if (!isChecked(node.id) || sel === null) e.currentTarget.style.background = '#f8fafc'; }}
          onMouseLeave={e => { e.currentTarget.style.background = isChecked(node.id) && sel !== null ? '#eff6ff' : 'transparent'; }}
        >
          {/* Expand/collapse — only for nodes with children */}
          <span
            onClick={e => { e.stopPropagation(); if (hasChildren) toggleExpand(node.id); }}
            style={{
              width: 18, flexShrink: 0, textAlign: 'center',
              color: '#94a3b8', fontSize: 10,
              cursor: hasChildren ? 'pointer' : 'default',
              userSelect: 'none',
            }}
          >
            {hasChildren ? (isOpen ? '▾' : '▸') : ''}
          </span>

          {/* Checkbox + name */}
          <span
            onClick={() => toggle(node.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              readOnly
              checked={isChecked(node.id)}
              style={{ pointerEvents: 'none', accentColor: '#2563EB', flexShrink: 0 }}
            />
            <span style={{
              fontWeight: depth === 0 ? 600 : 400,
              fontSize: 13,
              color: isChecked(node.id) && sel !== null ? '#1d4ed8' : '#1e293b',
            }}>
              {node.name}
            </span>
            {node.parent_name && depth === 0 && (
              <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 2 }}>
                (sub of {node.parent_name})
              </span>
            )}
            {hasChildren && (
              <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 'auto', flexShrink: 0 }}>
                {node.children.length} sub
              </span>
            )}
          </span>
        </div>

        {/* Children */}
        {isOpen && hasChildren && node.children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  };

  const selectedCount = sel ? sel.length : 0;

  return (
    <div className="modal-overlay" style={{ zIndex: 400 }}>
      <div className="modal" style={{ width: 440 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Asset Type Privileges</h2>
          {sel !== null && (
            <span style={{ fontSize: 12, color: '#2563EB', fontWeight: 600, background: '#eff6ff', padding: '2px 8px', borderRadius: 5 }}>
              {selectedCount} selected
            </span>
          )}
        </div>
        <p style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
          Select asset types. Child types under a selected parent are included automatically.
        </p>

        {/* Any (All) option */}
        <div
          onClick={() => setSel(null)}
          style={{
            padding: '9px 12px', cursor: 'pointer', fontSize: 13,
            background: sel === null ? '#eff6ff' : '#fafbfc',
            fontWeight: sel === null ? 600 : 400,
            color: sel === null ? '#2563EB' : '#374151',
            borderBottom: '2px solid #e2e8f0',
            borderRadius: '6px 6px 0 0',
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <input type="checkbox" readOnly checked={sel === null} style={{ pointerEvents: 'none', accentColor: '#2563EB' }} />
          — Any Asset Type (All) —
        </div>

        {/* Tree */}
        <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 6px 6px', marginBottom: 16 }}>
          {assetTypes.length === 0
            ? <div style={{ padding: 16, color: '#aaa', fontSize: 13, textAlign: 'center' }}>No asset types found</div>
            : tree.map(node => renderNode(node))
          }
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(sel)}>
            {sel === null ? 'Allow All' : `Allow ${selectedCount} Type${selectedCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Attribute-based Asset Privilege Picker ─────────────────────
// Shows all attributes from all asset types, user picks attribute + enters value
function AssetPrivilegePicker({ current, onClose, onSave }) {
  // current: array of { attribute_id, attribute_name, value } or null
  const [allAttrs, setAllAttrs] = useState([]);
  const [entries, setEntries] = useState(current || []); // [{ attribute_id, attribute_name, value }]
  const [selAttr, setSelAttr] = useState('');
  const [selVal, setSelVal] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/asset-types').then(async r => {
      const types = r.data;
      const attrs = [];
      for (const t of types) {
        const ar = await api.get(`/asset-types/${t.id}/attributes`);
        ar.data.forEach(a => {
          if (!attrs.find(x => x.id === a.id)) {
            attrs.push({ ...a, type_name: t.name });
          }
        });
      }
      setAllAttrs(attrs);
      setLoading(false);
    }).catch((e) => {
      toastApiFailure(e, 'Privileges · attributes');
      setLoading(false);
    });
  }, []);

  const addEntry = () => {
    if (!selAttr) return;
    const attr = allAttrs.find(a => String(a.id) === String(selAttr));
    if (!attr) return;
    // avoid duplicate attribute
    if (entries.find(e => String(e.attribute_id) === String(selAttr))) return;
    setEntries([...entries, { attribute_id: attr.id, attribute_name: attr.name, value: selVal }]);
    setSelAttr('');
    setSelVal('');
  };

  const removeEntry = (idx) => setEntries(entries.filter((_, i) => i !== idx));

  const selectedAttr = allAttrs.find(a => String(a.id) === String(selAttr));

  return (
    <div className="modal-overlay" style={{ zIndex: 400 }}>
      <div className="modal" style={{ width: 500 }}>
        <h2 style={{ fontSize: 15, marginBottom: 4 }}>Attribute based Asset Privilege</h2>
        <p style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>Select an attribute and enter a value. Only assets matching ALL entries will be visible.</p>

        {/* Attribute selector + value + Add */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          <select
            value={selAttr}
            onChange={e => { setSelAttr(e.target.value); setSelVal(''); }}
            style={{ flex: 1, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
          >
            <option value="">- Select attribute -</option>
            {allAttrs.map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.type_name})</option>
            ))}
          </select>

          {selectedAttr && (
            selectedAttr.attr_type === 'list' ? (
              <select value={selVal} onChange={e => setSelVal(e.target.value)}
                style={{ flex: 1, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}>
                <option value="">- Select value -</option>
                {(selectedAttr.list_options || []).map(o => <option key={o.id} value={o.option_value}>{o.option_value}</option>)}
              </select>
            ) : (
              <input
                value={selVal}
                onChange={e => setSelVal(e.target.value)}
                placeholder="Enter value"
                type={selectedAttr.attr_type === 'double' ? 'number' : selectedAttr.attr_type === 'date' ? 'date' : 'text'}
                style={{ flex: 1, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
              />
            )
          )}

          <button className="btn btn-secondary btn-sm" onClick={addEntry} disabled={!selAttr || !selVal}>
            Add Attribute
          </button>
        </div>

        {loading && <div style={{ color: '#aaa', fontSize: 13, marginBottom: 12 }}>Loading attributes...</div>}

        {/* Added entries */}
        {entries.length > 0 && (
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: 16, overflow: 'hidden' }}>
            <table style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f7f8fc' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Attribute</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left' }}>Value</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #f0f2f5' }}>
                    <td style={{ padding: '7px 12px' }}>{e.attribute_name}</td>
                    <td style={{ padding: '7px 12px' }}>{e.value}</td>
                    <td style={{ padding: '7px 12px', textAlign: 'center' }}>
                      <button onClick={() => removeEntry(i)} style={{ background: 'none', border: 'none', color: '#e53e3e', cursor: 'pointer', fontSize: 16 }}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave(entries.length ? entries : null)}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ── User Form ──────────────────────────────────────────────────
function UserForm({ user, locations, assetTypes, onClose, onSaved }) {
  const isEdit = !!user;
  const [form, setForm] = useState({
    username: user?.username || '',
    email: user?.email || '',
    profile_type: user?.profile_type || 'admin',
    password: '',
    confirm_password: '',
    location_privileges: parsePriv(user?.location_privileges),
    location_can_modify: user?.location_can_modify !== 0,
    location_can_delete: user?.location_can_delete !== 0,
    asset_type_privileges: parsePriv(user?.asset_type_privileges),
    asset_type_can_modify: user?.asset_type_can_modify !== 0,
    asset_type_can_delete: user?.asset_type_can_delete !== 0,
    asset_privileges: user?.asset_privileges ? (typeof user.asset_privileges === 'string' ? JSON.parse(user.asset_privileges) : user.asset_privileges) : null,
    asset_can_modify: user?.asset_can_modify !== 0,
    asset_can_delete: user?.asset_can_delete !== 0,
  });
  const [errors, setErrors] = useState({});
  const [showLocPicker, setShowLocPicker] = useState(false);
  const [showAssetTypePicker, setShowAssetTypePicker] = useState(false);
  const [assetPrivPicker, setAssetPrivPicker] = useState(false);

  const validate = () => {
    const e = {};
    if (!form.username.trim()) e.username = 'Required';
    if (!isEdit && !form.password) e.password = 'Required';
    if (form.password && form.password !== form.confirm_password) e.confirm_password = 'Passwords do not match';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    const payload = { ...form };
    delete payload.confirm_password;
    if (!payload.password) delete payload.password;
    try {
      if (isEdit) await api.put(`/users/${user.id}`, payload);
      else await api.post('/users', payload);
      onSaved();
      onClose();
    } catch (e) {
      toastApiFailure(e, 'Users');
      setErrors({ submit: e.response?.data?.message || e.message || 'Save failed' });
    }
  };

  const privLabel = (val, allLabel) => {
    if (!val) return allLabel;
    const arr = Array.isArray(val) ? val : [];
    if (!arr.length) return allLabel;
    return `${arr.length} selected`;
  };

  const locPrivLabel = (val) => {
    if (!val || !val.length) return '— Any Location —';
    // Show names of selected locations
    const names = val.map(id => locations.find(l => l.id === id)?.name || `#${id}`);
    if (names.length <= 2) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
  };

  const assetPrivLabel = (val) => {
    if (!val || !val.length) return '-Any Asset-';
    return val.map(e => `${e.attribute_name}=${e.value}`).join(', ');
  };

  const assetTypePrivLabel = (val) => {
    if (!val || !val.length) return '— Any Asset Type —';
    const names = val.map(id => assetTypes.find(t => t.id === id)?.name || `#${id}`);
    if (names.length <= 2) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 200 }}>
      <div className="modal add-asset-modal" style={{ width: 600, maxHeight: '90vh', overflowY: 'auto' }}>
        <h2>{isEdit ? 'Edit User' : 'Add User'}</h2>
        {errors.submit && <div style={{ color: '#e53e3e', fontSize: 13, marginBottom: 12 }}>{errors.submit}</div>}

        <form className="add-asset-form" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
          {/* Username */}
          <div className="form-row">
            <label>User Name <span className="required">*</span></label>
            <div className="field-wrap">
              <input
                name="rfid-user-username"
                autoComplete="off"
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                placeholder="Enter username"
              />
              {errors.username && <span className="field-error">{errors.username}</span>}
            </div>
          </div>

          {/* Email */}
          <div className="form-row">
            <label>Email</label>
            <div className="field-wrap">
              <input
                type="text"
                inputMode="email"
                name="rfid-user-email"
                autoComplete="off"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="Enter email (optional)"
              />
            </div>
          </div>

          {/* Profile Type */}
          <div className="form-row">
            <label>Profile Type <span className="required">*</span></label>
            <div className="field-wrap">
              <select value={form.profile_type} onChange={e => setForm({ ...form, profile_type: e.target.value })}>
                <option value="super_admin">Super Administrator</option>
                <option value="admin">Administrator</option>
                <option value="normal">Normal</option>
              </select>
              <span style={{ fontSize: 12, color: '#888', marginTop: 4 }}>{PROFILE_DESC[form.profile_type]}</span>
            </div>
          </div>

          {/* Password */}
          <div className="form-row">
            <label>Password{!isEdit && <span className="required"> *</span>}</label>
            <div className="field-wrap">
              <input
                type="password"
                name="rfid-user-password"
                autoComplete="new-password"
                value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                placeholder={isEdit ? 'Leave blank to keep current' : 'Enter password'}
              />
              {errors.password && <span className="field-error">{errors.password}</span>}
            </div>
          </div>
          <div className="form-row">
            <label>Confirm Password</label>
            <div className="field-wrap">
              <input
                type="password"
                name="rfid-user-password-confirm"
                autoComplete="new-password"
                value={form.confirm_password}
                onChange={e => setForm({ ...form, confirm_password: e.target.value })}
                placeholder="Retype password"
              />
              {errors.confirm_password && <span className="field-error">{errors.confirm_password}</span>}
            </div>
          </div>

          {/* Privileges header */}
          <div className="form-row" style={{ marginTop: 8 }}>
            <label style={{ fontWeight: 700, color: '#333', fontSize: 14 }}>Privileges</label>
            <div className="field-wrap" />
          </div>

          {/* Location Privileges — tree picker */}
          <div className="form-row">
            <label>Location Privileges</label>
            <div className="field-wrap">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  readOnly
                  value={locPrivLabel(form.location_privileges)}
                  style={{ flex: 1, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, background: '#f7f8fc', cursor: 'pointer' }}
                  onClick={() => setShowLocPicker(true)}
                />
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={form.location_can_modify} onChange={e => setForm({ ...form, location_can_modify: e.target.checked })} /> Modify
                </label>
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={form.location_can_delete} onChange={e => setForm({ ...form, location_can_delete: e.target.checked })} /> Delete
                </label>
              </div>
              {form.location_privileges && form.location_privileges.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 11.5, color: '#2563EB', background: '#eff6ff', padding: '4px 8px', borderRadius: 5 }}>
                  ✓ Restricted to {form.location_privileges.length} location{form.location_privileges.length > 1 ? 's' : ''} — sub-locations are automatically included
                </div>
              )}
            </div>
          </div>

          {/* Asset Type Privileges — tree picker */}
          <div className="form-row">
            <label>Asset Type Privileges</label>
            <div className="field-wrap">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  readOnly
                  value={assetTypePrivLabel(form.asset_type_privileges)}
                  style={{ flex: 1, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, background: '#f7f8fc', cursor: 'pointer' }}
                  onClick={() => setShowAssetTypePicker(true)}
                />
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={form.asset_type_can_modify} onChange={e => setForm({ ...form, asset_type_can_modify: e.target.checked })} /> Modify
                </label>
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={form.asset_type_can_delete} onChange={e => setForm({ ...form, asset_type_can_delete: e.target.checked })} /> Delete
                </label>
              </div>
              {form.asset_type_privileges && form.asset_type_privileges.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 11.5, color: '#2563EB', background: '#eff6ff', padding: '4px 8px', borderRadius: 5 }}>
                  ✓ Restricted to {form.asset_type_privileges.length} asset type{form.asset_type_privileges.length > 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>

          {/* Asset Privileges — attribute-based */}
          <div className="form-row">
            <label>Asset Privileges</label>
            <div className="field-wrap">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input readOnly value={assetPrivLabel(form.asset_privileges)}
                  style={{ flex: 1, padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, background: '#f7f8fc' }} />
                <button className="btn btn-secondary btn-sm" onClick={() => setAssetPrivPicker(true)}>...</button>
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={form.asset_can_modify} onChange={e => setForm({ ...form, asset_can_modify: e.target.checked })} /> Modify
                </label>
                <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={form.asset_can_delete} onChange={e => setForm({ ...form, asset_can_delete: e.target.checked })} /> Delete
                </label>
              </div>
            </div>
          </div>
        </form>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>{isEdit ? 'Save' : 'Add User'}</button>
        </div>
      </div>

      {/* Location tree picker */}
      {showLocPicker && (
        <LocationTreePicker
          locations={locations}
          selected={form.location_privileges}
          onClose={() => setShowLocPicker(false)}
          onSave={val => { setForm({ ...form, location_privileges: val }); setShowLocPicker(false); }}
        />
      )}

      {/* Asset Type tree picker */}
      {showAssetTypePicker && (
        <AssetTypeTreePicker
          assetTypes={assetTypes}
          selected={form.asset_type_privileges}
          onClose={() => setShowAssetTypePicker(false)}
          onSave={val => { setForm({ ...form, asset_type_privileges: val }); setShowAssetTypePicker(false); }}
        />
      )}

      {/* Attribute-based asset privilege picker */}
      {assetPrivPicker && (
        <AssetPrivilegePicker
          current={form.asset_privileges}
          onClose={() => setAssetPrivPicker(false)}
          onSave={val => { setForm({ ...form, asset_privileges: val }); setAssetPrivPicker(false); }}
        />
      )}
    </div>
  );
}

function UserPageEmpty({ icon, title, hint }) {
  return (
    <div className="empty-state" role="status">
      <div className="empty-state-icon" aria-hidden>{icon}</div>
      <p className="empty-state-title">{title}</p>
      <p className="empty-state-hint">{hint}</p>
    </div>
  );
}

// ── User Detail Panel ──────────────────────────────────────────
function UserDetail({ user, locations, assetTypes, onEdit, onDelete }) {
  const privLabel = (val, allLabel, items) => {
    if (!val) return allLabel;
    let arr = val;
    if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { return allLabel; } }
    if (!arr || !arr.length) return allLabel;
    if (items) return arr.map(id => items.find(i => i.id === id)?.name || id).join(', ');
    // attribute-based
    return arr.map(e => `${e.attribute_name}=${e.value}`).join(', ');
  };

  return (
    <div className="location-types-main">
      <div className="location-types-main-body">
        <div style={{ fontWeight: 700, fontSize: 15, textAlign: 'center', marginBottom: 24, borderBottom: '1px solid #f0f2f5', paddingBottom: 12 }}>
          Details of User
        </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[
          { label: 'User Name', value: user.username },
          { label: 'Email', value: user.email || '—' },
          { label: 'User Type', value: PROFILE_LABELS[user.profile_type] },
          { label: 'Location Privileges', value: privLabel(user.location_privileges, 'Any Location', locations) },
          { label: 'Asset Type Privileges', value: privLabel(user.asset_type_privileges, 'Any Asset Type', assetTypes) },
          { label: 'Asset Privileges', value: privLabel(user.asset_privileges, 'Any Asset', null) },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: 'flex', fontSize: 14 }}>
            <span style={{ minWidth: 200, fontWeight: 500, color: '#555' }}>{label}</span>
            <span>: {value}</span>
          </div>
        ))}
      </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 32 }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onEdit}>Edit</button>
          <button type="button" className="btn btn-danger btn-sm" onClick={onDelete}>Delete</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Users Page ────────────────────────────────────────────
export default function Users() {
  const [users, setUsers]         = useState([]);
  const [locations, setLocations] = useState([]);
  const [assetTypes, setAssetTypes] = useState([]);
  const [selected, setSelected]   = useState(null);
  const [showForm, setShowForm]   = useState(false);
  const [editUser, setEditUser]   = useState(null);
  const [myProfile, setMyProfile] = useState(null);
  const [userSearch, setUserSearch] = useState('');
  const [confirmDialog, setConfirmDialog] = useState(null);

  const currentUser  = (() => { try { return JSON.parse(sessionStorage.getItem('rfid_user') || 'null'); } catch { return null; } })();
  const isSuperAdmin = currentUser?.profile_type === 'super_admin';

  const userSearchQuery = userSearch.trim().toLowerCase();
  const filteredUsers = useMemo(
    () => users.filter((u) => userMatchesSearch(u, userSearchQuery)),
    [users, userSearchQuery],
  );

  useEffect(() => {
    if (isSuperAdmin) {
      Promise.all([
        api.get('/users'),
        api.get('/locations'),
        api.get('/asset-types'),
      ]).then(([u, l, at]) => {
        setUsers(u.data);
        setLocations(l.data);
        setAssetTypes(at.data);
      }).catch((e) => toastApiFailure(e, 'Users'));
    } else {
      Promise.all([
        api.get('/users'),
        api.get('/locations'),
        api.get('/asset-types'),
      ]).then(([u, l, at]) => {
        const me = u.data.find(x => x.id === currentUser?.id) || null;
        setMyProfile(me);
        setLocations(l.data);
        setAssetTypes(at.data);
      }).catch((e) => toastApiFailure(e, 'Users'));
    }
  }, []);

  const reload = async () => {
    try {
      const [u, l, at] = await Promise.all([
        api.get('/users'),
        api.get('/locations'),
        api.get('/asset-types'),
      ]);
      setUsers(u.data);
      setLocations(l.data);
      setAssetTypes(at.data);
      if (selected) {
        const updated = u.data.find(x => x.id === selected.id);
        setSelected(updated || null);
      }
    } catch (e) {
      toastApiFailure(e, 'Users');
    }
  };

  const handleDelete = () => {
    if (!selected || !isSuperAdmin) return;
    const user = selected;
    setConfirmDialog({
      title: 'Delete User',
      message: `Are you sure you want to delete "${user.username}"?`,
      subMessage: 'This action cannot be undone. The user will lose access to the system immediately.',
      confirmLabel: 'Delete',
      confirmStyle: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/users/${user.id}`);
          setSelected(null);
          reload();
        } catch (e) {
          toastApiFailure(e, 'Delete user');
        }
      },
    });
  };

  // ── Non-super-admin: show ONLY their own profile, read-only ──
  if (!isSuperAdmin) {
    const privLabel = (val, allLabel, items) => {
      if (!val) return allLabel;
      let arr = val;
      if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { return allLabel; } }
      if (!arr || !arr.length) return allLabel;
      if (items) return arr.map(id => items.find(i => i.id === id)?.name || id).join(', ');
      return arr.map(e => `${e.attribute_name}=${e.value}`).join(', ');
    };

    return (
      <div>
        <div className="page-header"><h1>My Profile</h1></div>
        {myProfile ? (
          <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', padding: 32, maxWidth: 600, border: '1px solid #e8edf2' }}>
            <div style={{ fontWeight: 700, fontSize: 16, textAlign: 'center', marginBottom: 24, borderBottom: '1px solid #f0f4f8', paddingBottom: 12 }}>
              My Account Details
            </div>
            {[
              { label: 'User Name',              value: myProfile.username },
              { label: 'Email',                  value: myProfile.email || '—' },
              { label: 'Profile Type',           value: PROFILE_LABELS[myProfile.profile_type] },
              { label: 'Location Privileges',    value: privLabel(myProfile.location_privileges, 'Any Location', locations) },
              { label: 'Asset Type Privileges',  value: privLabel(myProfile.asset_type_privileges, 'Any Asset Type', assetTypes) },
              { label: 'Asset Privileges',       value: privLabel(myProfile.asset_privileges, 'Any Asset', null) },
              { label: 'Can Modify Locations',   value: myProfile.location_can_modify  ? '✅ Yes' : '❌ No' },
              { label: 'Can Delete Locations',   value: myProfile.location_can_delete  ? '✅ Yes' : '❌ No' },
              { label: 'Can Modify Asset Types', value: myProfile.asset_type_can_modify ? '✅ Yes' : '❌ No' },
              { label: 'Can Delete Asset Types', value: myProfile.asset_type_can_delete ? '✅ Yes' : '❌ No' },
              { label: 'Can Modify Assets',      value: myProfile.asset_can_modify     ? '✅ Yes' : '❌ No' },
              { label: 'Can Delete Assets',      value: myProfile.asset_can_delete     ? '✅ Yes' : '❌ No' },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', fontSize: 14, padding: '8px 0', borderBottom: '1px solid #f8fafc' }}>
                <span style={{ minWidth: 220, fontWeight: 500, color: '#6b7280' }}>{label}</span>
                <span style={{ color: '#1a202c' }}>: {value}</span>
              </div>
            ))}
            <div style={{ marginTop: 16, padding: '12px 16px', background: '#fef3c7', borderRadius: 8, fontSize: 13, color: '#92400e' }}>
              ⚠️ User management is restricted to Super Administrators only. Contact your administrator to make changes.
            </div>
          </div>
        ) : (
          <div style={{ color: '#aaa', padding: 32 }}>Loading...</div>
        )}
      </div>
    );
  }

  // ── Super Admin: full user management ───────────────────────
  return (
    <div>
      <div className="page-header"><h1>Manage Users</h1></div>
      <div className="locations-layout">
        <div className="location-tree-panel">
          <div className="panel-header">
            <span>Users</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { setEditUser(null); setShowForm(true); }}>+ Add</button>
          </div>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #e2e8f0', background: '#fafbfc' }}>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none', display: 'flex' }}>
                <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                </svg>
              </span>
              <input
                type="search"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search users…"
                aria-label="Search users"
                style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px 6px 28px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12 }}
              />
            </div>
            {userSearchQuery && (
              <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 6, width: '100%' }} onClick={() => setUserSearch('')}>
                Clear search
              </button>
            )}
          </div>
          <div className="tree-container">
            {users.length > 0 && filteredUsers.length === 0 && userSearchQuery && (
              <p style={{ color: '#aaa', padding: 12, fontSize: 13, margin: 0 }}>No users match your search.</p>
            )}
            {filteredUsers.map((u) => (
              <div key={u.id} onClick={() => setSelected(u)}
                style={{ padding: '9px 14px', cursor: 'pointer', fontSize: 14, background: selected?.id === u.id ? '#dbeafe' : 'inherit', color: selected?.id === u.id ? '#1d4ed8' : '#374151', fontWeight: selected?.id === u.id ? 600 : 400, borderBottom: '1px solid #f8fafc' }}>
                {u.username}
                <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>{PROFILE_LABELS[u.profile_type]}</div>
              </div>
            ))}
            {users.length === 0 && <p style={{ color: '#aaa', padding: 12, fontSize: 13, margin: 0 }}>No users yet</p>}
          </div>
        </div>

        <div className="location-detail-panel">
          {selected ? (
            <UserDetail
              user={selected}
              locations={locations}
              assetTypes={assetTypes}
              onEdit={() => { setEditUser(selected); setShowForm(true); }}
              onDelete={handleDelete}
            />
          ) : (
            <UserPageEmpty
              title="Select a user from the list to view details"
              hint="Choose a user on the left to see profile, privileges, and actions."
              icon={(
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              )}
            />
          )}
        </div>
      </div>

      {showForm && (
        <UserForm user={editUser} locations={locations} assetTypes={assetTypes}
          onClose={() => setShowForm(false)}
          onSaved={() => { reload(); setShowForm(false); }} />
      )}

      {confirmDialog && (
        <ConfirmModal
          title={confirmDialog.title}
          message={confirmDialog.message}
          subMessage={confirmDialog.subMessage}
          confirmLabel={confirmDialog.confirmLabel}
          confirmStyle={confirmDialog.confirmStyle}
          onConfirm={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}

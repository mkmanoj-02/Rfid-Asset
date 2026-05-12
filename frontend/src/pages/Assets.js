import React, { useEffect, useState, useCallback } from 'react';
import {
  getAssets, createAsset, updateAsset, deleteAsset, bulkDeleteAssets,
  getAssetTypes, getLocations,
  getAssetAttributes, saveAssetAttributes, getAssetMovements,
  getRfidTags, removeRfidTag, getAttributes,
  getTagTypes, createTagType, updateTagType, deleteTagType,
  getVendors, createVendor, updateVendor, deleteVendor
} from '../api';
import { useToast } from '../Toast';
import { exportExcel, exportPDF, ExportButtons } from '../export';

// ── Confirm Dialog ─────────────────────────────────────────────
function ConfirmModal({ title, message, subMessage, confirmLabel = 'Delete', confirmStyle = 'danger', onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" style={{ zIndex: 300 }}>
      <div style={{
        background: '#fff',
        borderRadius: 16,
        width: 420,
        maxWidth: '92vw',
        boxShadow: '0 24px 64px rgba(0,0,0,0.22)',
        overflow: 'hidden',
        animation: 'confirmPop 0.18s ease',
      }}>
        {/* Top accent bar */}
        <div style={{
          height: 5,
          background: confirmStyle === 'danger'
            ? 'linear-gradient(90deg,#ef4444,#dc2626)'
            : 'linear-gradient(90deg,#1565c0,#1976d2)',
        }} />

        <div style={{ padding: '28px 28px 24px' }}>
          {/* Icon + Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: confirmStyle === 'danger' ? '#fef2f2' : '#eff6ff',
              fontSize: 22,
            }}>
              {confirmStyle === 'danger' ? '🗑️' : '⚠️'}
            </div>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: '#111827', margin: 0 }}>{title}</h3>
          </div>

          {/* Message */}
          <p style={{ fontSize: 14, color: '#374151', margin: '0 0 8px', lineHeight: 1.6 }}>{message}</p>
          {subMessage && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              background: '#fffbeb', border: '1px solid #fde68a',
              borderRadius: 8, padding: '10px 12px', marginTop: 10,
            }}>
              <span style={{ fontSize: 15, flexShrink: 0 }}>⚠️</span>
              <p style={{ fontSize: 13, color: '#92400e', margin: 0, lineHeight: 1.5 }}>{subMessage}</p>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
            <button
              className="btn btn-secondary"
              onClick={onCancel}
              style={{ minWidth: 90 }}
            >Cancel</button>
            <button
              className={`btn btn-${confirmStyle === 'danger' ? 'danger' : 'primary'}`}
              onClick={onConfirm}
              style={{ minWidth: 90 }}
            >{confirmLabel}</button>
          </div>
        </div>
      </div>
      <style>{`@keyframes confirmPop { from { opacity:0; transform:scale(0.93) translateY(10px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>
    </div>
  );
}

// ── Add Asset Form ─────────────────────────────────────────────
function AddAssetModal({ types, locations, tagTypes, vendors, onClose, onSaved }) {
  const { showToast } = useToast();
  const [form, setForm] = useState({
    asset_serial: '', name: '', rfid_tag: '',
    tag_type_id: '', vendor_id: '',
    asset_type_id: '', current_location_id: '', status: 'active', description: ''
  });
  const [rfidTags, setRfidTags] = useState([]);
  const [rfidPickerOpen, setRfidPickerOpen] = useState(false);
  const [errors, setErrors] = useState({});
  const [typeAttrs, setTypeAttrs] = useState([]);
  const [attrValues, setAttrValues] = useState({});

  // Fetch attributes when asset type changes
  useEffect(() => {
    if (!form.asset_type_id) { setTypeAttrs([]); setAttrValues({}); return; }
    getAttributes(form.asset_type_id).then(r => {
      setTypeAttrs(r.data);
      const defaults = {};
      r.data.forEach(a => { defaults[a.id] = a.default_value || ''; });
      setAttrValues(defaults);
    }).catch(() => {});
  }, [form.asset_type_id]);

  // Poll RFID tags every 2s when picker is open
  useEffect(() => {
    if (!rfidPickerOpen) return;
    const load = () => getRfidTags().then(r => setRfidTags(r.data)).catch(() => {});
    load();
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, [rfidPickerOpen]);

  const selectRfid = async (tag) => {
    setForm({ ...form, rfid_tag: tag });
    await removeRfidTag(tag);
    setRfidPickerOpen(false);
  };

  const validate = () => {
    const e = {};
    if (!form.asset_serial.trim()) e.asset_serial = 'Asset Serial is required';
    if (!form.name.trim()) e.name = 'Asset Name is required';
    if (!form.tag_type_id) e.tag_type_id = 'Tag Type is required';
    if (!form.vendor_id) e.vendor_id = 'Vendor is required';
    if (!form.current_location_id) e.current_location_id = 'Location is required';
    if (!form.asset_type_id) e.asset_type_id = 'Asset Type is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    const result = await createAsset(form);
    const assetId = result.data.id;
    // Save attribute values if any
    if (typeAttrs.length > 0) {
      const values = Object.entries(attrValues).map(([attribute_id, value]) => ({ attribute_id, value }));
      await saveAssetAttributes(assetId, values);
    }
    onSaved();
    onClose();
  };

  const reset = () => {
    setForm({ asset_serial: '', name: '', rfid_tag: '', tag_type_id: '', asset_type_id: '', current_location_id: '', status: 'active', description: '' });
    setTypeAttrs([]);
    setAttrValues({});
  };

  const saveRef = React.useRef(null);

  const handleKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    if (e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();

    // Collect all focusable fields inside the form + the save button
    const form = e.currentTarget;
    const focusable = [
      ...form.querySelectorAll('input:not([readonly]), select, textarea'),
      saveRef.current,
    ].filter(Boolean);

    const idx = focusable.indexOf(e.target);
    if (idx >= 0 && idx < focusable.length - 1) {
      focusable[idx + 1].focus();
    } else {
      saveRef.current?.focus();
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal add-asset-modal" style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <h2>Add Asset</h2>
        <div className="add-asset-form" onKeyDown={handleKeyDown}>
          <div className="form-row">
            <label>Asset Serial <span className="required">*</span></label>
            <div className="field-wrap">
              <input value={form.asset_serial} onChange={e => setForm({ ...form, asset_serial: e.target.value })} placeholder="Unique serial number" />
              {errors.asset_serial && <span className="field-error">{errors.asset_serial}</span>}
            </div>
          </div>
          <div className="form-row">
            <label>Asset Name <span className="required">*</span></label>
            <div className="field-wrap">
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Asset name" />
              {errors.name && <span className="field-error">{errors.name}</span>}
            </div>
          </div>
          <div className="form-row">
            <label>RFID</label>
            <div className="field-wrap rfid-field">
              <input value={form.rfid_tag} readOnly placeholder="Select from reader..." />
              <button className="btn btn-secondary btn-sm picker-btn" onClick={() => setRfidPickerOpen(true)}>...</button>
            </div>
          </div>
          <div className="form-row">
            <label>Tag Type <span className="required">*</span></label>
            <div className="field-wrap">
              <select value={form.tag_type_id} onChange={e => setForm({ ...form, tag_type_id: e.target.value })}>
                <option value="">— Select tag type —</option>
                {tagTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {errors.tag_type_id && <span className="field-error">{errors.tag_type_id}</span>}
            </div>
          </div>
          <div className="form-row">
            <label>Vendor <span className="required">*</span></label>
            <div className="field-wrap">
              <select value={form.vendor_id} onChange={e => setForm({ ...form, vendor_id: e.target.value })}>
                <option value="">— Select vendor —</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              {errors.vendor_id && <span className="field-error">{errors.vendor_id}</span>}
            </div>
          </div>
          <div className="form-row">
            <label>Location <span className="required">*</span></label>
            <div className="field-wrap rfid-field">
              <select value={form.current_location_id} onChange={e => setForm({ ...form, current_location_id: e.target.value })}>
                <option value="">— Select location —</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              {errors.current_location_id && <span className="field-error">{errors.current_location_id}</span>}
            </div>
          </div>
          <div className="form-row">
            <label>Asset Type <span className="required">*</span></label>
            <div className="field-wrap rfid-field">
              <select value={form.asset_type_id} onChange={e => setForm({ ...form, asset_type_id: e.target.value })}>
                <option value="">-- Select --</option>
                {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {errors.asset_type_id && <span className="field-error">{errors.asset_type_id}</span>}
            </div>
          </div>
          <div className="form-row">
            <label>Status</label>
            <div className="field-wrap">
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>
          </div>
          {typeAttrs.length > 0 && (
            <>
              <div className="form-row" style={{ marginTop: 8 }}>
                <label style={{ fontWeight: 600, color: '#7c8cf8' }}>Attributes</label>
                <div className="field-wrap" />
              </div>
              {typeAttrs.map(attr => (
                <div className="form-row" key={attr.id}>
                  <label>{attr.name}</label>
                  <div className="field-wrap">
                    {attr.attr_type === 'list' ? (
                      <select value={attrValues[attr.id] || ''} onChange={e => setAttrValues({ ...attrValues, [attr.id]: e.target.value })}>
                        <option value="">-- Select --</option>
                        {(attr.list_options || []).map(o => <option key={o.id} value={o.option_value}>{o.option_value}</option>)}
                      </select>
                    ) : attr.attr_type === 'date' ? (
                      <input type="date" value={attrValues[attr.id] || ''} onChange={e => setAttrValues({ ...attrValues, [attr.id]: e.target.value })} />
                    ) : (
                      <input type={attr.attr_type === 'double' ? 'number' : 'text'} value={attrValues[attr.id] || ''} onChange={e => setAttrValues({ ...attrValues, [attr.id]: e.target.value })} />
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
          <div className="form-row">
            <label>Description</label>
            <div className="field-wrap">
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} />
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={reset}>Reset</button>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button ref={saveRef} className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>

      {/* RFID Tag Picker */}
      {rfidPickerOpen && (
        <div className="modal-overlay" style={{ zIndex: 200 }}>
          <div className="modal" style={{ width: 380 }}>
            <h2>Select RFID Tag</h2>
            <p style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>
              Scan with handheld/fixed reader. Tags appear below automatically.
            </p>
            {rfidTags.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: '#aaa' }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>📡</div>
                Waiting for RFID reader...
              </div>
            ) : (
              <div className="rfid-tag-list">
                {rfidTags.map(tag => (
                  <div key={tag} className="rfid-tag-item" onClick={() => selectRfid(tag)}>
                    <code>{tag}</code>
                    <span className="btn btn-primary btn-sm">Select</span>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setRfidPickerOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Asset Detail View ──────────────────────────────────────────
function AssetDetail({ asset, types, locations, tagTypes, vendors, onBack, onRefresh, canModify, canDelete }) {
  const { showToast } = useToast();
  const [tab, setTab] = useState('trace');
  const [attrs, setAttrs] = useState([]);
  const [attrValues, setAttrValues] = useState({});
  const [trace, setTrace] = useState([]);
  const [editModal, setEditModal] = useState(false);
  const [locationModal, setLocationModal] = useState(false);
  const [editForm, setEditForm] = useState({
    asset_serial: asset.asset_serial || '',
    rfid_tag: asset.rfid_tag,
    tag_type_id: asset.tag_type_id || '',
    vendor_id: asset.vendor_id || '',
    name: asset.name,
    asset_type_id: asset.asset_type_id || '',
    current_location_id: asset.current_location_id || '',
    status: asset.status,
  });
  const [newLocationId, setNewLocationId] = useState('');
  const [locationNotes, setLocationNotes] = useState('');
  const [editErrors, setEditErrors] = useState({});
  const [confirmDialog, setConfirmDialog] = useState(null); // { onConfirm }

  useEffect(() => {
    getAssetAttributes(asset.id).then(r => {
      setAttrs(r.data);
      const v = {};
      r.data.forEach(a => { v[a.attribute_id] = a.value || ''; });
      setAttrValues(v);
    });
    getAssetMovements(asset.id).then(r => setTrace(r.data));
  }, [asset.id]);

  const saveEdit = async () => {
    if (!canModify) { showToast('You do not have permission to modify assets', 'error'); return; }
    const e = {};
    if (!editForm.asset_serial.trim()) e.asset_serial = 'Asset Serial is required';
    if (!editForm.name.trim()) e.name = 'Asset Name is required';
    if (!editForm.tag_type_id) e.tag_type_id = 'Tag Type is required';
    if (!editForm.vendor_id) e.vendor_id = 'Vendor is required';
    if (!editForm.current_location_id) e.current_location_id = 'Location is required';
    if (!editForm.asset_type_id) e.asset_type_id = 'Asset Type is required';
    setEditErrors(e);
    if (Object.keys(e).length > 0) return;
    await updateAsset(asset.id, editForm);
    showToast('Asset updated successfully', 'success');
    setEditModal(false);
    onRefresh();
  };

  const saveAttrValues = async () => {
    const payload = Object.entries(attrValues).map(([attribute_id, value]) => ({ attribute_id, value }));
    await saveAssetAttributes(asset.id, payload);
    showToast('Attributes saved successfully', 'success');
  };

  const changeLocation = async () => {
    if (!newLocationId) return;
    await updateAsset(asset.id, { ...editForm, current_location_id: newLocationId, notes: locationNotes });
    setLocationModal(false);
    setLocationNotes('');
    onRefresh();
  };

  const typeName     = types.find(t => t.id === asset.asset_type_id)?.name || '—';
  const locationName = locations.find(l => l.id === asset.current_location_id)?.name || '—';
  const tagTypeName  = asset.tag_type_name || '—';
  const vendorName   = asset.vendor_name || '—';

  return (
    <div className="asset-detail">
      {/* Back + actions */}
      <div className="detail-topbar">
        <button className="btn btn-secondary btn-sm" onClick={onBack}>← Back to Assets</button>
        <div style={{ display: 'flex', gap: 8 }}>
          {canModify && <button className="btn btn-secondary" onClick={() => setEditModal(true)}>Edit Asset</button>}
          {canModify && <button className="btn btn-primary" onClick={() => { setNewLocationId(asset.current_location_id || ''); setLocationModal(true); }}>Change Location</button>}
        </div>
      </div>

      {/* Asset info card */}
      <div className="detail-info-card">
        <div className="detail-fields">
          <div className="detail-row"><span className="detail-label">Asset Name</span><span>: {asset.name}</span></div>
          <div className="detail-row"><span className="detail-label">RFID Tag</span><span>: <code>{asset.rfid_tag}</code></span></div>
          <div className="detail-row"><span className="detail-label">Tag Type</span><span>: {tagTypeName}</span></div>
          <div className="detail-row"><span className="detail-label">Vendor</span><span>: {vendorName}</span></div>
          <div className="detail-row"><span className="detail-label">Asset Type</span><span>: {typeName}</span></div>
          <div className="detail-row"><span className="detail-label">Last Known Location</span><span>: {locationName}</span></div>
          <div className="detail-row"><span className="detail-label">Status</span><span>: {statusBadge(asset.status)}</span></div>
          <div className="detail-row"><span className="detail-label">Created</span><span>: {new Date(asset.created_at).toLocaleString()}</span></div>
        </div>
      </div>

      {/* Tabs */}
      <div className="detail-tabs">
        <button className={`tab-btn ${tab === 'trace' ? 'active' : ''}`} onClick={() => setTab('trace')}>Trace History</button>
        <button className={`tab-btn ${tab === 'attrs' ? 'active' : ''}`} onClick={() => setTab('attrs')}>Attributes</button>
      </div>

      {/* Trace History */}
      {tab === 'trace' && (
        <div className="tab-content">
          <table>
            <thead>
              <tr><th>From</th><th>To</th><th>Moved At</th><th>Duration</th></tr>
            </thead>
            <tbody>
              {trace.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: '#aaa', padding: 24 }}>No trace history yet.</td></tr>}
              {trace.map((t, i) => {
                const movedAt = new Date(t.moved_at);
                const nextMove = trace[i - 1];
                const nextMoveAt = nextMove ? new Date(nextMove.moved_at) : new Date();
                const diffMs = nextMoveAt - movedAt;
                const months = Math.floor(diffMs / 2592000000);
                const weeks = Math.floor((diffMs % 2592000000) / 604800000);
                const days = Math.floor((diffMs % 604800000) / 86400000);
                const hours = Math.floor((diffMs % 86400000) / 3600000);
                const mins = Math.floor((diffMs % 3600000) / 60000);
                const secs = Math.floor((diffMs % 60000) / 1000);
                let duration = '';
                if (months > 0) { duration = `${months} Month${months > 1 ? 's' : ''} ${weeks > 0 ? weeks + ' Week' + (weeks > 1 ? 's' : '') : ''}`; }
                else if (weeks > 0) { duration = `${weeks} Week${weeks > 1 ? 's' : ''} ${days > 0 ? days + ' Day' + (days > 1 ? 's' : '') : ''}`; }
                else if (days > 0) { duration = `${days} Day${days > 1 ? 's' : ''} ${hours > 0 ? hours + ' Hour' + (hours > 1 ? 's' : '') : ''}`; }
                else if (hours > 0) { duration = `${hours} Hour${hours > 1 ? 's' : ''} ${mins > 0 ? mins + ' Min' + (mins > 1 ? 's' : '') : ''}`; }
                else if (mins > 0) { duration = `${mins} Min${mins > 1 ? 's' : ''} ${secs > 0 ? secs + ' Sec' + (secs > 1 ? 's' : '') : ''}`; }
                else { duration = `${secs} Sec${secs !== 1 ? 's' : ''}`; }
                const isCurrent = !nextMove;
                return (
                  <tr key={t.id}>
                    <td>{t.from_location || '—'}</td>
                    <td style={{ fontWeight: 500 }}>{t.to_location}</td>
                    <td>{movedAt.toLocaleString()}</td>
                    <td style={{ color: isCurrent ? '#7c8cf8' : '#555', fontSize: 13, fontWeight: isCurrent ? 500 : 400 }}>
                      {isCurrent ? `${duration.trim()} (now)` : duration.trim()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Attributes */}
      {tab === 'attrs' && (
        <div className="tab-content">
          {attrs.length === 0 && <p style={{ color: '#aaa' }}>No attributes defined for this asset type.</p>}
          {attrs.length > 0 && (
            <>
              <table>
                <thead><tr><th>Attribute</th><th>Type</th><th>Value</th></tr></thead>
                <tbody>
                  {attrs.map(attr => (
                    <tr key={attr.attribute_id}>
                      <td>{attr.name}</td>
                      <td><span className="attr-type-badge">{attr.attr_type}</span></td>
                      <td>
                        {attr.attr_type === 'list' ? (
                          <select value={attrValues[attr.attribute_id] || ''} onChange={e => setAttrValues({ ...attrValues, [attr.attribute_id]: e.target.value })}>
                            <option value="">-- Select --</option>
                            {attr.list_options.map(o => <option key={o.id} value={o.option_value}>{o.option_value}</option>)}
                          </select>
                        ) : attr.attr_type === 'date' ? (
                          <input type="date" value={attrValues[attr.attribute_id] || ''} onChange={e => setAttrValues({ ...attrValues, [attr.attribute_id]: e.target.value })} />
                        ) : (
                          <input type={attr.attr_type === 'double' ? 'number' : 'text'} value={attrValues[attr.attribute_id] || ''} onChange={e => setAttrValues({ ...attrValues, [attr.attribute_id]: e.target.value })} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 16 }}>
                {canModify && <button className="btn btn-primary" onClick={saveAttrValues}>Save Attributes</button>}
              </div>
            </>
          )}
        </div>
      )}

      {/* Edit Modal */}
      {editModal && (
        <div className="modal-overlay">
          <div className="modal add-asset-modal">
            <h2>Edit Asset</h2>
            <div className="add-asset-form" onKeyDown={e => {
              if (e.key !== 'Enter') return;
              if (e.target.tagName === 'TEXTAREA') return;
              e.preventDefault();
              const focusable = [
                ...e.currentTarget.querySelectorAll('input:not([readonly]), select, textarea'),
                e.currentTarget.closest('.modal').querySelector('.btn-primary'),
              ].filter(Boolean);
              const idx = focusable.indexOf(e.target);
              if (idx >= 0 && idx < focusable.length - 1) focusable[idx + 1].focus();
              else focusable[focusable.length - 1]?.focus();
            }}>
              <div className="form-row">
                <label>Asset Serial <span className="required">*</span></label>
                <div className="field-wrap">
                  <input value={editForm.asset_serial} onChange={e => setEditForm({ ...editForm, asset_serial: e.target.value })} placeholder="Unique serial number" />
                </div>
              </div>
              <div className="form-row">
                <label>Asset Name <span className="required">*</span></label>
                <div className="field-wrap">
                  <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} placeholder="Asset name" />
                </div>
              </div>
              <div className="form-row">
                <label>RFID</label>
                <div className="field-wrap">
                  <input value={editForm.rfid_tag || ''} onChange={e => setEditForm({ ...editForm, rfid_tag: e.target.value })} placeholder="RFID tag" />
                </div>
              </div>
              <div className="form-row">
                <label>Tag Type <span className="required">*</span></label>
                <div className="field-wrap">
                  <select value={editForm.tag_type_id} onChange={e => setEditForm({ ...editForm, tag_type_id: e.target.value })}>
                    <option value="">— Select tag type —</option>
                    {tagTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  {editErrors.tag_type_id && <span className="field-error">{editErrors.tag_type_id}</span>}
                </div>
              </div>
              <div className="form-row">
                <label>Vendor <span className="required">*</span></label>
                <div className="field-wrap">
                  <select value={editForm.vendor_id} onChange={e => setEditForm({ ...editForm, vendor_id: e.target.value })}>
                    <option value="">— Select vendor —</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                  {editErrors.vendor_id && <span className="field-error">{editErrors.vendor_id}</span>}
                </div>
              </div>
              <div className="form-row">
                <label>Location <span className="required">*</span></label>
                <div className="field-wrap">
                  <select value={editForm.current_location_id} onChange={e => setEditForm({ ...editForm, current_location_id: e.target.value })}>
                    <option value="">— Select location —</option>
                    {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  {editErrors.current_location_id && <span className="field-error">{editErrors.current_location_id}</span>}
                </div>
              </div>
              <div className="form-row">
                <label>Asset Type <span className="required">*</span></label>
                <div className="field-wrap">
                  <select value={editForm.asset_type_id} onChange={e => setEditForm({ ...editForm, asset_type_id: e.target.value })}>
                    <option value="">-- Select --</option>
                    {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  {editErrors.asset_type_id && <span className="field-error">{editErrors.asset_type_id}</span>}
                </div>
              </div>
              <div className="form-row">
                <label>Status</label>
                <div className="field-wrap">
                  <select value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })}>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="maintenance">Maintenance</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setEditModal(false); setEditErrors({}); }}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEdit}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Change Location Modal */}
      {locationModal && (
        <div className="modal-overlay">
          <div className="modal" onKeyDown={e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const modal = e.currentTarget;
            const focusable = [
              ...modal.querySelectorAll('select, textarea'),
              modal.querySelector('.btn-primary'),
            ].filter(Boolean);
            const idx = focusable.indexOf(e.target);
            if (idx >= 0 && idx < focusable.length - 1) focusable[idx + 1].focus();
            else modal.querySelector('.btn-primary')?.focus();
          }}>
            <h2>Change Location</h2>
            <div className="form-group"><label>New Location</label>
              <select value={newLocationId} onChange={e => setNewLocationId(e.target.value)}>
                <option value="">-- Select --</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Notes (optional)</label>
              <textarea value={locationNotes} onChange={e => setLocationNotes(e.target.value)} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setLocationModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={changeLocation}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
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

const statusBadge = (s) => <span className={`badge badge-${s}`}>{s}</span>;

// ── Bulk Change Location Modal ─────────────────────────────────
function BulkChangeLocationModal({ selectedAssets, locations, onClose, onSaved }) {
  const [newLocationId, setNewLocationId] = useState('');
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (!newLocationId) return;
    setLoading(true);
    for (const asset of selectedAssets) {
      try {
        await updateAsset(asset.id, {
          ...asset,
          current_location_id: newLocationId,
        });
      } catch {}
    }
    setLoading(false);
    onSaved();
    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 420 }}>
        <h2>Change Location</h2>
        <p style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
          Changing location for {selectedAssets.length} selected asset{selectedAssets.length > 1 ? 's' : ''}.
        </p>
        <div className="add-asset-form">
          <div className="form-row">
            <label>New Location <span className="required">*</span></label>
            <div className="field-wrap">
              <select value={newLocationId} onChange={e => setNewLocationId(e.target.value)}>
                <option value="">-- Select Location --</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={loading || !newLocationId}>
            {loading ? 'Saving...' : 'Change Location'}
          </button>
        </div>
      </div>
    </div>
  );
}
function UpdateAttributeModal({ selectedAssets, onClose, onSaved }) {
  const [allAttrs, setAllAttrs] = useState([]);
  const [selAttrId, setSelAttrId] = useState('');
  const [attrType, setAttrType] = useState('');
  const [attrValue, setAttrValue] = useState('');
  const [listOptions, setListOptions] = useState([]);
  const [loading, setLoading] = useState(false);

  // Load all unique attributes across selected assets' types
  useEffect(() => {
    const typeIds = [...new Set(selectedAssets.map(a => a.asset_type_id).filter(Boolean))];
    if (!typeIds.length) return;
    Promise.all(typeIds.map(id => getAttributes(id))).then(results => {
      const seen = new Set();
      const attrs = [];
      results.forEach(r => r.data.forEach(a => {
        if (!seen.has(a.name.toLowerCase())) {
          seen.add(a.name.toLowerCase());
          attrs.push(a);
        }
      }));
      setAllAttrs(attrs);
    });
  }, []);

  const handleAttrChange = (id) => {
    setSelAttrId(id);
    setAttrValue('');
    const attr = allAttrs.find(a => String(a.id) === String(id));
    if (attr) {
      setAttrType(attr.attr_type);
      setListOptions(attr.list_options || []);
    }
  };

  const save = async () => {
    if (!selAttrId || attrValue === '') return;
    setLoading(true);
    const attr = allAttrs.find(a => String(a.id) === String(selAttrId));
    // For each selected asset, find the matching attribute by name and update
    for (const asset of selectedAssets) {
      try {
        // Get this asset's attributes to find the right attribute_id
        const r = await getAssetAttributes(asset.id);
        const match = r.data.find(a => a.name.toLowerCase() === attr.name.toLowerCase());
        if (match) {
          await saveAssetAttributes(asset.id, [{ attribute_id: match.attribute_id, value: attrValue }]);
        }
      } catch {}
    }
    setLoading(false);
    onSaved();
    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 460 }}>
        <h2>Update Attribute</h2>
        <p style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
          Updating {selectedAssets.length} selected asset{selectedAssets.length > 1 ? 's' : ''}.
        </p>
        <div className="add-asset-form">
          <div className="form-row">
            <label>Attribute Name</label>
            <div className="field-wrap">
              <select value={selAttrId} onChange={e => handleAttrChange(e.target.value)}>
                <option value="">-- Select attribute --</option>
                {allAttrs.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
          {selAttrId && (
            <div className="form-row">
              <label>Attribute Type</label>
              <div className="field-wrap">
                <input readOnly value={attrType} style={{ background: '#f7f8fc' }} />
              </div>
            </div>
          )}
          {selAttrId && (
            <div className="form-row">
              <label>Attribute Value</label>
              <div className="field-wrap">
                {attrType === 'list' ? (
                  <select value={attrValue} onChange={e => setAttrValue(e.target.value)}>
                    <option value="">-- Select --</option>
                    {listOptions.map(o => <option key={o.id} value={o.option_value}>{o.option_value}</option>)}
                  </select>
                ) : attrType === 'date' ? (
                  <input type="date" value={attrValue} onChange={e => setAttrValue(e.target.value)} />
                ) : (
                  <input type={attrType === 'double' ? 'number' : 'text'} value={attrValue} onChange={e => setAttrValue(e.target.value)} placeholder="Enter value" />
                )}
              </div>
            </div>
          )}
          <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>* Showing common attributes of selected Asset(s)</p>
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={loading || !selAttrId || attrValue === ''}>
            {loading ? 'Saving...' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Assets List ────────────────────────────────────────────────
export default function Assets() {
  const [tab, setTab] = useState('manage');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [types, setTypes] = useState([]);
  const [locations, setLocations] = useState([]);
  const [tagTypes, setTagTypes] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(false);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [updateAttrModal, setUpdateAttrModal] = useState(false);
  const [changeLocModal, setChangeLocModal] = useState(false);
  const [sortKey, setSortKey] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [search, setSearch] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterType, setFilterType] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const searchTimer = React.useRef(null);

  // Privilege checks
  const { showToast } = useToast();
  const currentUser = (() => { try { return JSON.parse(sessionStorage.getItem('rfid_user') || 'null'); } catch { return null; } })();
  const isSuperAdmin = currentUser?.profile_type === 'super_admin';
  const canModify = isSuperAdmin || !!currentUser?.asset_can_modify;
  const canDelete = isSuperAdmin || !!currentUser?.asset_can_delete;

  const fetchAssets = (s, loc, typ, page, limit, sKey, sDir) => {
    const q = {
      search: s || '',
      location_id: loc || '',
      asset_type_id: typ || '',
      page: page || 1,
      limit: limit || 10,
      sort: sKey || 'created_at',
      sort_dir: sDir || 'desc',
    };
    setLoading(true);
    return getAssets(q).then(r => {
      const data = r.data;
      // Response shape: { pagination: { total, page, limit, totalPages }, data: [...] }
      if (data && data.pagination && Array.isArray(data.data)) {
        setItems(data.data);
        setTotal(data.pagination.total ?? data.data.length);
        setTotalPages(data.pagination.totalPages ?? 1);
      } else if (Array.isArray(data)) {
        setItems(data);
        setTotal(data.length);
        setTotalPages(1);
      } else if (data && Array.isArray(data.assets)) {
        setItems(data.assets);
        setTotal(data.pagination?.total ?? data.assets.length);
        setTotalPages(data.pagination?.totalPages ?? 1);
      } else {
        setItems([]);
        setTotal(0);
        setTotalPages(1);
      }
    }).finally(() => setLoading(false));
  };

  const load = useCallback(() => {
    fetchAssets(search, filterLocation, filterType, currentPage, pageSize, sortKey, sortDir);
  }, [search, filterLocation, filterType, currentPage, pageSize, sortKey, sortDir]);

  useEffect(() => {
    fetchAssets('', '', '', 1, 10, 'created_at', 'desc');
    getAssetTypes().then(r => setTypes(r.data));
    getLocations().then(r => setLocations(r.data));
    getTagTypes().then(r => setTagTypes(r.data)).catch(() => {});
    getVendors().then(r => setVendors(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    fetchAssets(search, filterLocation, filterType, currentPage, pageSize, sortKey, sortDir);
  }, [currentPage, pageSize, sortKey, sortDir]);

  const handleSearch = (val) => {
    setSearch(val);
    setCurrentPage(1);
    clearTimeout(searchTimer.current);
    if (val.length === 0 || val.length >= 2) {
      searchTimer.current = setTimeout(() => fetchAssets(val, filterLocation, filterType, 1, pageSize, sortKey, sortDir), 300);
    }
  };

  const handleLocationFilter = (val) => {
    setFilterLocation(val);
    setCurrentPage(1);
    fetchAssets(search, val, filterType, 1, pageSize, sortKey, sortDir);
  };

  const handleTypeFilter = (val) => {
    setFilterType(val);
    setCurrentPage(1);
    fetchAssets(search, filterLocation, val, 1, pageSize, sortKey, sortDir);
  };

  const clearFilters = () => {
    setSearch(''); setFilterLocation(''); setFilterType('');
    setCurrentPage(1);
    fetchAssets('', '', '', 1, pageSize, sortKey, sortDir);
  };

  // Fetch and auto-correct page if current page exceeds new totalPages after a delete
  const fetchAndClampPage = async (s, loc, typ, page, limit, sKey, sDir) => {
    const q = {
      search: s || '',
      location_id: loc || '',
      asset_type_id: typ || '',
      page: page || 1,
      limit: limit || 10,
      sort: sKey || 'created_at',
      sort_dir: sDir || 'desc',
    };
    setLoading(true);
    try {
      const r = await getAssets(q);
      const data = r.data;
      let list = [], tot = 0, totPages = 1;
      if (data && data.pagination && Array.isArray(data.data)) {
        list = data.data;
        tot = data.pagination.total ?? data.data.length;
        totPages = data.pagination.totalPages ?? 1;
      } else if (Array.isArray(data)) {
        list = data; tot = data.length; totPages = 1;
      }
      // If current page is now beyond totalPages, re-fetch the last valid page
      if (page > totPages && totPages >= 1) {
        setCurrentPage(totPages);
        setLoading(false);
        return fetchAndClampPage(s, loc, typ, totPages, limit, sKey, sDir);
      }
      setItems(list);
      setTotal(tot);
      setTotalPages(totPages);
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id) => {
    if (!canDelete) { showToast('You do not have permission to delete assets', 'error'); return; }
    setConfirmDialog({
      title: 'Delete Asset',
      message: 'Are you sure you want to delete this asset?',
      subMessage: 'This action cannot be undone. All trace history for this asset will also be removed.',
      confirmLabel: 'Delete',
      confirmStyle: 'danger',
      onConfirm: async () => {
        await deleteAsset(id);
        showToast('Asset deleted', 'success');
        fetchAndClampPage(search, filterLocation, filterType, currentPage, pageSize, sortKey, sortDir);
      },
    });
  };

  const bulkDelete = () => {
    if (!canDelete) { showToast('You do not have permission to delete assets', 'error'); return; }
    const ids = [...checkedIds];
    setConfirmDialog({
      title: `Delete ${ids.length} Asset${ids.length > 1 ? 's' : ''}`,
      message: `Are you sure you want to delete ${ids.length} selected asset${ids.length > 1 ? 's' : ''}?`,
      subMessage: 'This action cannot be undone. All trace history for these assets will also be removed.',
      confirmLabel: 'Delete',
      confirmStyle: 'danger',
      onConfirm: async () => {
        await bulkDeleteAssets(ids);
        showToast(`${ids.length} asset${ids.length > 1 ? 's' : ''} deleted`, 'success');
        setCheckedIds(new Set());
        fetchAndClampPage(search, filterLocation, filterType, currentPage, pageSize, sortKey, sortDir);
      },
    });
  };

  const toggleCheck = (id) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
    setCurrentPage(1);
  };

  // Server-side pagination: items already contains only the current page
  const pagedItems = items;

  const allPageChecked = pagedItems.length > 0 && pagedItems.every(i => checkedIds.has(i.id));
  const somePageChecked = pagedItems.some(i => checkedIds.has(i.id));

  const toggleAll = () => {
    if (allPageChecked) {
      setCheckedIds(prev => {
        const next = new Set(prev);
        pagedItems.forEach(i => next.delete(i.id));
        return next;
      });
    } else {
      setCheckedIds(prev => {
        const next = new Set(prev);
        pagedItems.forEach(i => next.add(i.id));
        return next;
      });
    }
  };

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return <span style={{ color: '#ccc', marginLeft: 4 }}>↕</span>;
    return <span style={{ color: '#7c8cf8', marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const SortTh = ({ col, label }) => (
    <th onClick={() => handleSort(col)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
      {label}<SortIcon col={col} />
    </th>
  );

  const selectedAssets = pagedItems.filter(i => checkedIds.has(i.id));
  const hasFilters = search || filterLocation || filterType;

  // Fetch all records (no pagination) for export
  const fetchAllForExport = () => {
    return getAssets({
      search: search || '',
      location_id: filterLocation || '',
      asset_type_id: filterType || '',
      page: 1,
      limit: total || 99999,
      sort: sortKey,
      sort_dir: sortDir,
    }).then(r => {
      const data = r.data;
      if (data && data.pagination && Array.isArray(data.data)) return data.data;
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.assets)) return data.assets;
      return [];
    });
  };

  if (selected) {
    return <AssetDetail asset={selected} types={types} locations={locations} tagTypes={tagTypes} vendors={vendors} onBack={() => setSelected(null)} onRefresh={load} canModify={canModify} canDelete={canDelete} />;
  }

  return (
    <div>
      <div className="page-header">
        <h1>Assets</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Export buttons */}
          <ExportButtons
            onExcel={async () => {
              const all = await fetchAllForExport();
              exportExcel(
                [
                  { header: '#',           key: '_idx' },
                  { header: 'Serial',      key: 'asset_serial' },
                  { header: 'Name',        key: 'name' },
                  { header: 'RFID Tag',    key: 'rfid_tag' },
                  { header: 'Tag Type',    key: 'tag_type_name' },
                  { header: 'Asset Type',  key: 'asset_type_name' },
                  { header: 'Vendor',      key: 'vendor_name' },
                  { header: 'Location',    key: 'location_name' },
                  { header: 'Status',      key: 'status' },
                ],
                all.map((item, i) => ({ ...item, _idx: i + 1 })),
                'assets'
              );
            }}
            onPDF={async () => {
              const all = await fetchAllForExport();
              exportPDF(
                [
                  { header: '#',           key: '_idx' },
                  { header: 'Serial',      key: 'asset_serial' },
                  { header: 'Name',        key: 'name' },
                  { header: 'RFID',        key: 'rfid_tag' },
                  { header: 'Type',        key: 'asset_type_name' },
                  { header: 'Vendor',      key: 'vendor_name' },
                  { header: 'Location',    key: 'location_name' },
                  { header: 'Status',      key: 'status' },
                ],
                all.map((item, i) => ({ ...item, _idx: i + 1 })),
                'Asset List',
                'assets'
              );
            }}
          />
          <span style={{ fontSize: 13, color: '#555' }}>Sorted By</span>
          <select value={sortKey} onChange={e => { setSortKey(e.target.value); setSortDir('asc'); setCurrentPage(1); }}
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}>
            <option value="name">Asset Name</option>
            <option value="asset_serial">Asset Serial</option>
            <option value="asset_type_name">Asset Type</option>
            <option value="location_name">Location</option>
            <option value="status">Status</option>
            <option value="created_at">Recently Added</option>
          </select>
          <button onClick={() => { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); setCurrentPage(1); }}
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, background: '#fff', cursor: 'pointer' }}>
            {sortDir === 'asc' ? '↑ Asc' : '↓ Desc'}
          </button>
          {checkedIds.size > 0 && canModify && (
            <>
              <button className="btn btn-secondary" onClick={() => setChangeLocModal(true)}>Change Location ({checkedIds.size})</button>
              <button className="btn btn-secondary" onClick={() => setUpdateAttrModal(true)}>Update Attribute ({checkedIds.size})</button>
            </>
          )}
          {checkedIds.size > 0 && canDelete && (
            <button className="btn btn-danger" onClick={bulkDelete}>Delete ({checkedIds.size})</button>
          )}
          {canModify && <button className="btn btn-primary" onClick={() => setModal(true)}>+ Add Asset</button>}
        </div>
      </div>

      {/* Search + Filter bar */}
      <div style={{ background: '#fff', borderRadius: 8, padding: '12px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#aaa', fontSize: 14 }}>🔍</span>
          <input
            value={search}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search serial, name, RFID, type, attribute..."
            style={{ width: '100%', padding: '7px 10px 7px 30px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
          />
        </div>
        <select value={filterLocation} onChange={e => handleLocationFilter(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, minWidth: 150 }}>
          <option value="">All Locations</option>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <select value={filterType} onChange={e => handleTypeFilter(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, minWidth: 150 }}>
          <option value="">All Asset Types</option>
          {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {hasFilters && <button className="btn btn-secondary btn-sm" onClick={clearFilters}>✕ Clear</button>}
        <span style={{ fontSize: 12, color: '#888', marginLeft: 'auto' }}>
          {total} asset{total !== 1 ? 's' : ''}{hasFilters ? ' (filtered)' : ''}
        </span>
      </div>

      <div style={{
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
        border: '1px solid #e8edf2',
        overflow: 'hidden',
      }}>
        <div style={{ overflowX: 'auto', width: '100%' }}>
          <table style={{ width: '100%', borderRadius: 0, boxShadow: 'none', border: 'none', minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{ width: 36, padding: '10px 12px' }}>
                  <input
                    type="checkbox"
                    ref={el => { if (el) el.indeterminate = somePageChecked && !allPageChecked; }}
                    checked={allPageChecked}
                    onChange={toggleAll}
                  />
                </th>
                <th style={{ width: 42, padding: '10px 8px' }}>#</th>
                <SortTh col="asset_serial" label="Asset Serial" />
                <SortTh col="name" label="Asset Name" />
                <th>RFID</th>
                <th>Tag Type</th>
                <SortTh col="asset_type_name" label="Type" />
                <th>Vendor</th>
                <SortTh col="location_name" label="Location" />
                <SortTh col="status" label="Status" />
                <th style={{ width: 130, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={11} style={{ textAlign: 'center', color: '#aaa', padding: 40 }}>Loading...</td></tr>
              )}
              {!loading && pagedItems.length === 0 && (
                <tr><td colSpan={11} style={{ textAlign: 'center', color: '#aaa', padding: 40 }}>
                  {hasFilters ? 'No assets match your search or filters.' : 'No assets yet.'}
                </td></tr>
              )}
              {!loading && pagedItems.map((item, i) => (
                <tr key={item.id} style={{ background: checkedIds.has(item.id) ? '#f0f4ff' : 'inherit' }}>
                  <td style={{ padding: '10px 12px' }}><input type="checkbox" checked={checkedIds.has(item.id)} onChange={() => toggleCheck(item.id)} /></td>
                  <td style={{ padding: '10px 8px', color: '#9ca3af', fontSize: 12 }}>{(currentPage - 1) * pageSize + i + 1}</td>
                  <td style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.asset_serial || ''}>{item.asset_serial || '—'}</td>
                  <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>
                    <span style={{ cursor: 'pointer', color: '#1565c0', fontWeight: 600 }} onClick={() => setSelected(item)}>{item.name}</span>
                  </td>
                  <td style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.rfid_tag || ''}>
                    <code style={{ fontSize: 12, background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>{item.rfid_tag || '—'}</code>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{item.tag_type_name || '—'}</td>
                  <td style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.asset_type_name || ''}>{item.asset_type_name || '—'}</td>
                  <td style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.vendor_name || ''}>{item.vendor_name || '—'}</td>
                  <td style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.location_name || ''}>{item.location_name || '—'}</td>
                  <td>{statusBadge(item.status)}</td>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => setSelected(item)}>View</button>
                      {canDelete && <button className="btn btn-danger btn-sm" onClick={() => remove(item.id)}>Delete</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination bar */}
        {total > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid #f0f4f8', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#555' }}>
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
              >
                {[10, 25, 50, 100].map((n, i, arr) => (
                  <option key={n} value={n} disabled={i > 0 && total <= arr[i - 1]}>
                    {n}
                  </option>
                ))}
              </select>
              <span style={{ marginLeft: 8 }}>
                {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, total)} of {total}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 6, background: currentPage === 1 ? '#f7f8fc' : '#fff', cursor: currentPage === 1 ? 'default' : 'pointer', color: currentPage === 1 ? '#bbb' : '#333', fontSize: 13 }}
              >«</button>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 6, background: currentPage === 1 ? '#f7f8fc' : '#fff', cursor: currentPage === 1 ? 'default' : 'pointer', color: currentPage === 1 ? '#bbb' : '#333', fontSize: 13 }}
              >‹</button>
              {Array.from({ length: totalPages }, (_, idx) => idx + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
                .reduce((acc, p, i, arr) => {
                  if (i > 0 && p - arr[i - 1] > 1) acc.push('...');
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, idx) =>
                  p === '...'
                    ? <span key={`ellipsis-${idx}`} style={{ padding: '5px 8px', fontSize: 13, color: '#aaa' }}>…</span>
                    : <button
                        key={p}
                        onClick={() => setCurrentPage(p)}
                        style={{
                          padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13,
                          background: currentPage === p ? '#1565c0' : '#fff',
                          color: currentPage === p ? '#fff' : '#333',
                          cursor: 'pointer', fontWeight: currentPage === p ? 600 : 400,
                        }}
                      >{p}</button>
                )}
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 6, background: currentPage === totalPages ? '#f7f8fc' : '#fff', cursor: currentPage === totalPages ? 'default' : 'pointer', color: currentPage === totalPages ? '#bbb' : '#333', fontSize: 13 }}
              >›</button>
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 6, background: currentPage === totalPages ? '#f7f8fc' : '#fff', cursor: currentPage === totalPages ? 'default' : 'pointer', color: currentPage === totalPages ? '#bbb' : '#333', fontSize: 13 }}
              >»</button>
            </div>
          </div>
        )}
      </div>
      {modal && <AddAssetModal types={types} locations={locations} tagTypes={tagTypes} vendors={vendors} onClose={() => setModal(false)} onSaved={() => fetchAssets(search, filterLocation, filterType, currentPage, pageSize, sortKey, sortDir)} />}
      {updateAttrModal && (
        <UpdateAttributeModal selectedAssets={selectedAssets} onClose={() => setUpdateAttrModal(false)}
          onSaved={() => { setCheckedIds(new Set()); fetchAssets(search, filterLocation, filterType, currentPage, pageSize, sortKey, sortDir); }} />
      )}
      {changeLocModal && (
        <BulkChangeLocationModal selectedAssets={selectedAssets} locations={locations}
          onClose={() => setChangeLocModal(false)}
          onSaved={() => { setCheckedIds(new Set()); fetchAssets(search, filterLocation, filterType, currentPage, pageSize, sortKey, sortDir); }} />
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

// ── Tag Types Master Tab ────────────────────────────────────────
function TagTypes({ tagTypes, onReload }) {
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [editing, setEditing] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);

  const openAdd = () => { setForm({ name: '', description: '' }); setEditing(null); setModal(true); };
  const openEdit = (item) => { setForm({ name: item.name, description: item.description || '' }); setEditing(item.id); setModal(true); };

  const save = async () => {
    try {
      if (editing) await updateTagType(editing, form);
      else await createTagType(form);
    } catch (e) { alert(e.response?.data?.message || 'Save failed'); return; }
    setModal(false);
    await onReload();
  };

  const remove = async (id) => {
    setConfirmDialog({
      title: 'Delete Tag Type',
      message: 'Are you sure you want to delete this tag type?',
      subMessage: 'Assets using this tag type will have their tag type cleared.',
      confirmLabel: 'Delete',
      confirmStyle: 'danger',
      onConfirm: async () => {
        await deleteTagType(id);
        if (selected?.id === id) setSelected(null);
        await onReload();
      },
    });
  };

  useEffect(() => {
    if (selected) {
      const updated = tagTypes.find(t => t.id === selected.id);
      setSelected(updated || null);
    }
  }, [tagTypes]);

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      {/* Left list */}
      <div style={{ width: 240, flexShrink: 0, background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
        <div style={{ fontWeight: 600, fontSize: 13, padding: '10px 14px', background: '#f7f8fc', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>
          — Tag Type List —
        </div>
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          {tagTypes.map(t => (
            <div key={t.id} onClick={() => setSelected(t)}
              style={{ padding: '9px 14px', cursor: 'pointer', fontSize: 14, borderBottom: '1px solid #f7f8fc',
                background: selected?.id === t.id ? '#e9ecff' : 'inherit',
                color: selected?.id === t.id ? '#5a67d8' : '#333',
                fontWeight: selected?.id === t.id ? 600 : 400 }}>
              {t.name}
            </div>
          ))}
          {tagTypes.length === 0 && <div style={{ padding: 16, color: '#aaa', fontSize: 13, textAlign: 'center' }}>No tag types yet</div>}
        </div>
        <div style={{ padding: '10px 14px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Tag Type</button>
        </div>
      </div>

      {/* Right detail */}
      {selected ? (
        <div style={{ flex: 1, background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', padding: 28 }}>
          <div style={{ fontWeight: 700, fontSize: 15, textAlign: 'center', marginBottom: 24, borderBottom: '1px solid #f0f2f5', paddingBottom: 12 }}>
            Tag Type Details
          </div>
          {[
            { label: 'Tag Type', value: selected.name },
            { label: 'Description', value: selected.description || '—' },
            { label: 'Created', value: new Date(selected.created_at).toLocaleString() },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', fontSize: 14, marginBottom: 14 }}>
              <span style={{ minWidth: 160, fontWeight: 500, color: '#555' }}>{label}</span>
              <span>: {value}</span>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => openEdit(selected)}>Edit</button>
            <button className="btn btn-danger btn-sm" onClick={() => remove(selected.id)}>Delete</button>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: '#aaa' }}>
          Select a tag type to view details
        </div>
      )}

      {modal && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>{editing ? 'Edit Tag Type' : 'Add Tag Type'}</h2>
            <div className="form-group">
              <label>Name <span style={{ color: '#e53e3e' }}>*</span></label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. RFID, Barcode, QR" />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>Save</button>
            </div>
          </div>
        </div>
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

// ── Vendors Master Tab ─────────────────────────────────────────
function Vendors({ vendors, onReload }) {
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: '', contact: '', email: '', phone: '', website: '', description: '' });
  const [editing, setEditing] = useState(null);
  const { showToast } = useToast();
  const [confirmDialog, setConfirmDialog] = useState(null);

  const openAdd = () => {
    setForm({ name: '', contact: '', email: '', phone: '', website: '', description: '' });
    setEditing(null); setModal(true);
  };
  const openEdit = (item) => {
    setForm({
      name: item.name, contact: item.contact || '', email: item.email || '',
      phone: item.phone || '', website: item.website || '', description: item.description || '',
    });
    setEditing(item.id); setModal(true);
  };

  const save = async () => {
    try {
      if (editing) { await updateVendor(editing, form); showToast('Vendor updated', 'success'); }
      else { await createVendor(form); showToast('Vendor added', 'success'); }
    } catch (e) {
      showToast(e.response?.data?.message || 'Save failed', 'error');
      return;
    }
    setModal(false);
    await onReload();
  };

  const remove = async (id) => {
    setConfirmDialog({
      title: 'Delete Vendor',
      message: 'Are you sure you want to delete this vendor?',
      subMessage: 'Assets linked to this vendor will have their vendor cleared.',
      confirmLabel: 'Delete',
      confirmStyle: 'danger',
      onConfirm: async () => {
        await deleteVendor(id);
        showToast('Vendor deleted', 'success');
        if (selected?.id === id) setSelected(null);
        await onReload();
      },
    });
  };

  useEffect(() => {
    if (selected) {
      const updated = vendors.find(v => v.id === selected.id);
      setSelected(updated || null);
    }
  }, [vendors]);

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      {/* Left list */}
      <div style={{ width: 240, flexShrink: 0, background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
        <div style={{ fontWeight: 600, fontSize: 13, padding: '10px 14px', background: '#f7f8fc', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>
          — Vendor List —
        </div>
        <div style={{ maxHeight: 480, overflowY: 'auto' }}>
          {vendors.map(v => (
            <div key={v.id} onClick={() => setSelected(v)}
              style={{
                padding: '9px 14px', cursor: 'pointer', fontSize: 14, borderBottom: '1px solid #f7f8fc',
                background: selected?.id === v.id ? '#e9ecff' : 'inherit',
                color: selected?.id === v.id ? '#5a67d8' : '#333',
                fontWeight: selected?.id === v.id ? 600 : 400,
              }}>
              {v.name}
            </div>
          ))}
          {vendors.length === 0 && (
            <div style={{ padding: 16, color: '#aaa', fontSize: 13, textAlign: 'center' }}>No vendors yet</div>
          )}
        </div>
        <div style={{ padding: '10px 14px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Vendor</button>
        </div>
      </div>

      {/* Right detail */}
      {selected ? (
        <div style={{ flex: 1, background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', padding: 28 }}>
          <div style={{ fontWeight: 700, fontSize: 15, textAlign: 'center', marginBottom: 24, borderBottom: '1px solid #f0f2f5', paddingBottom: 12 }}>
            Vendor Details
          </div>
          {[
            { label: 'Vendor Name',  value: selected.name },
            { label: 'Contact',      value: selected.contact || '—' },
            { label: 'Email',        value: selected.email || '—' },
            { label: 'Phone',        value: selected.phone || '—' },
            { label: 'Website',      value: selected.website || '—' },
            { label: 'Description',  value: selected.description || '—' },
            { label: 'Created',      value: new Date(selected.created_at).toLocaleString() },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', fontSize: 14, marginBottom: 12 }}>
              <span style={{ minWidth: 160, fontWeight: 500, color: '#555' }}>{label}</span>
              <span style={{ color: '#1a202c' }}>: {value}</span>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => openEdit(selected)}>Edit</button>
            <button className="btn btn-danger btn-sm" onClick={() => remove(selected.id)}>Delete</button>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: '#aaa' }}>
          Select a vendor to view details
        </div>
      )}

      {/* Add / Edit modal */}
      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 480 }}>
            <h2>{editing ? 'Edit Vendor' : 'Add Vendor'}</h2>
            <div className="add-asset-form">
              <div className="form-row">
                <label>Name <span className="required">*</span></label>
                <div className="field-wrap">
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Dell, HP, Cisco" />
                </div>
              </div>
              <div className="form-row">
                <label>Contact Person</label>
                <div className="field-wrap">
                  <input value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} placeholder="Contact name (optional)" />
                </div>
              </div>
              <div className="form-row">
                <label>Email</label>
                <div className="field-wrap">
                  <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="vendor@example.com" />
                </div>
              </div>
              <div className="form-row">
                <label>Phone</label>
                <div className="field-wrap">
                  <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 000 0000" />
                </div>
              </div>
              <div className="form-row">
                <label>Website</label>
                <div className="field-wrap">
                  <input value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} placeholder="https://vendor.com" />
                </div>
              </div>
              <div className="form-row">
                <label>Description</label>
                <div className="field-wrap">
                  <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} />
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>{editing ? 'Save' : 'Add Vendor'}</button>
            </div>
          </div>
        </div>
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

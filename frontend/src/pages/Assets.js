import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  getAssets, createAssetMultipart, updateAsset, updateAssetMultipart, deleteAsset, bulkDeleteAssets,
  getAssetTypes, getLocations,
  getAssetAttributes, saveAssetAttributes, getAssetMovements,
  getRfidTags, removeRfidTag, getAttributes, getAttributeList,
  getTagTypes, createTagType, updateTagType, deleteTagType, getTagRecommendationForAssetType,
  getVendors, createVendor, updateVendor, deleteVendor
} from '../api';
import { toastApiFailure } from '../apiErrorHandling';
import { useToast } from '../Toast';
import { exportExcel, exportPDF, ExportButtons } from '../export';
import ImageUploadField from '../components/ImageUploadField';
import { resolveImageUrl } from '../utils/imageUrl';

async function resolveRecommendedTagTypeId(assetTypeId, tagTypesList) {
  if (!assetTypeId) return null;
  try {
    const { data } = await getTagRecommendationForAssetType(assetTypeId);
    if (!data) return null;
    const recId = String(data.id ?? data.tag_type_id ?? '');
    if (!recId) return null;
    const inList = (tagTypesList || []).some((t) => String(t.id) === recId);
    return inList ? recId : null;
  } catch {
    return null;
  }
}

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
  const rfidPollErrLastRef = useRef(0);
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
  const [customImageFile, setCustomImageFile] = useState(null);
  const [saving, setSaving] = useState(false);

  // Fetch attributes when asset type changes
  useEffect(() => {
    if (!form.asset_type_id) { setTypeAttrs([]); setAttrValues({}); return; }
    getAttributes(form.asset_type_id).then(r => {
      setTypeAttrs(r.data);
      const defaults = {};
      r.data.forEach(a => { defaults[a.id] = a.default_value || ''; });
      setAttrValues(defaults);
    }).catch((e) => toastApiFailure(e, 'Attributes'));
  }, [form.asset_type_id]);

  // Poll RFID tags every 2s when picker is open
  useEffect(() => {
    if (!rfidPickerOpen) return;
    const load = () => getRfidTags().then(r => setRfidTags(r.data)).catch((e) => {
      const now = Date.now();
      if (now - rfidPollErrLastRef.current > 12000) {
        rfidPollErrLastRef.current = now;
        toastApiFailure(e, 'RFID tags');
      }
    });
    load();
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, [rfidPickerOpen]);

  const selectRfid = async (tag) => {
    setForm({ ...form, rfid_tag: tag });
    try {
      await removeRfidTag(tag);
    } catch (e) {
      toastApiFailure(e, 'RFID tag');
      return;
    }
    setRfidPickerOpen(false);
  };

  const pickAssetType = async (assetTypeId) => {
    const id = assetTypeId ? String(assetTypeId) : '';
    setCustomImageFile(null);
    const recTagId = id ? await resolveRecommendedTagTypeId(id, tagTypes) : null;
    setForm((prev) => ({
      ...prev,
      asset_type_id: id,
      ...(recTagId ? { tag_type_id: recTagId } : {}),
    }));
  };

  const handleAssetTypeChange = (e) => pickAssetType(e.target.value);

  const handleAssetTypeOptionPick = (typeId) => {
    if (String(form.asset_type_id) === String(typeId)) pickAssetType(typeId);
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

  const selectedType = types.find(t => String(t.id) === String(form.asset_type_id));
  const inheritedPreviewUrl = selectedType?.image_url ? resolveImageUrl(selectedType.image_url) : null;
  const imageSourceLabel = customImageFile
    ? 'Custom Image'
    : (inheritedPreviewUrl ? 'Inherited Image' : null);

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
    const result = await createAssetMultipart(form, customImageFile);
    const assetId = result.data.id;
    // Save attribute values if any
    if (typeAttrs.length > 0) {
      const values = Object.entries(attrValues).map(([attribute_id, value]) => ({ attribute_id, value }));
      await saveAssetAttributes(assetId, values);
    }
    onSaved();
    onClose();
    } catch (e) {
      showToast(e.response?.data?.message || 'Failed to create asset', 'error');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setForm({ asset_serial: '', name: '', rfid_tag: '', tag_type_id: '', vendor_id: '', asset_type_id: '', current_location_id: '', status: 'active', description: '' });
    setTypeAttrs([]);
    setAttrValues({});
    setCustomImageFile(null);
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
            <label>Asset Type <span className="required">*</span></label>
            <div className="field-wrap rfid-field">
              <select
                value={form.asset_type_id}
                onChange={handleAssetTypeChange}
              >
                <option value="">-- Select --</option>
                {types.map((t) => (
                  <option
                    key={t.id}
                    value={t.id}
                    onMouseDown={() => handleAssetTypeOptionPick(t.id)}
                  >
                    {t.name}
                  </option>
                ))}
              </select>
              {errors.asset_type_id && <span className="field-error">{errors.asset_type_id}</span>}
            </div>
          </div>
          <div className="form-row">
            <label>Asset Image</label>
            <div className="field-wrap" style={{ maxWidth: 420 }}>
              <ImageUploadField
                label=""
                previewUrl={!customImageFile ? inheritedPreviewUrl : null}
                sourceLabel={imageSourceLabel}
                file={customImageFile}
                onFileChange={setCustomImageFile}
                onClear={() => setCustomImageFile(null)}
                disabled={!form.asset_type_id}
                hint={form.asset_type_id ? 'Optional — inherits type image if empty' : 'Select asset type first'}
              />
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
          <button ref={saveRef} className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
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

// ── Financial Info Tab ─────────────────────────────────────────
function FinancialInfoTab({ assetId, assetName }) {
  const [financials, setFinancials] = useState(null);
  const [form, setForm] = useState({ purchase_cost: '', salvage_value: '', purchase_date: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    import('axios').then(({ default: axios }) => {
      axios.create({ baseURL: '/api' }).get(`/depreciation/financials/${assetId}`)
        .then(r => {
          if (r.data) {
            setFinancials(r.data);
            setForm({
              purchase_cost: r.data.purchase_cost || '',
              salvage_value: r.data.salvage_value || '',
              purchase_date: r.data.purchase_date?.split('T')[0] || '',
            });
          }
        }).catch((e) => toastApiFailure(e, 'Financial details'));
    });
  }, [assetId]);

  const save = async () => {
    setSaving(true);
    try {
      const { default: axios } = await import('axios');
      const http = axios.create({ baseURL: '/api' });
      await http.post('/depreciation/financials', { asset_id: assetId, ...form });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      const r = await http.get(`/depreciation/financials/${assetId}`);
      setFinancials(r.data);
    } catch (e) {
      toastApiFailure(e, 'Financial details');
    } finally {
      setSaving(false);
    }
  };

  const bookValue = financials?.current_book_value;
  const totalDep = financials?.total_depreciation;

  return (
    <div className="tab-content">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Input form */}
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: '#374151' }}>Purchase Details</h3>
          <div className="add-asset-form">
            <div className="form-row">
              <label>Purchase Cost (₹) <span className="required">*</span></label>
              <div className="field-wrap">
                <input type="number" value={form.purchase_cost} onChange={e => setForm({ ...form, purchase_cost: e.target.value })} placeholder="e.g. 80000" />
              </div>
            </div>
            <div className="form-row">
              <label>Salvage Value (₹)</label>
              <div className="field-wrap">
                <input type="number" value={form.salvage_value} onChange={e => setForm({ ...form, salvage_value: e.target.value })} placeholder="e.g. 5000" />
              </div>
            </div>
            <div className="form-row">
              <label>Purchase Date</label>
              <div className="field-wrap">
                <input type="date" value={form.purchase_date} onChange={e => setForm({ ...form, purchase_date: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <label />
              <div className="field-wrap">
                <button className="btn btn-primary" onClick={save} disabled={saving || !form.purchase_cost}>
                  {saving ? 'Saving...' : saved ? '✅ Saved!' : 'Save Financial Info'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Current book value summary */}
        {financials && (
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: '#374151' }}>Book Value Summary</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { label: 'Purchase Cost', value: `₹${parseFloat(financials.purchase_cost).toLocaleString()}`, color: '#1a202c' },
                { label: 'Total Depreciation', value: `-₹${parseFloat(totalDep || 0).toLocaleString()}`, color: '#ef4444' },
                { label: 'Current Book Value', value: `₹${parseFloat(bookValue || financials.purchase_cost).toLocaleString()}`, color: '#10b981', bold: true },
                { label: 'Salvage Value', value: `₹${parseFloat(financials.salvage_value || 0).toLocaleString()}`, color: '#6b7280' },
                { label: 'Last Depreciation', value: financials.last_depreciation_date?.split('T')[0] || 'Not run yet', color: '#6b7280' },
              ].map(({ label, value, color, bold }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#f8fafc', borderRadius: 8, fontSize: 14 }}>
                  <span style={{ color: '#6b7280' }}>{label}</span>
                  <span style={{ color, fontWeight: bold ? 700 : 500 }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
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
  const [editImageFile, setEditImageFile] = useState(null);
  const [revertToInherited, setRevertToInherited] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
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
    setEditSaving(true);
    try {
      await updateAssetMultipart(asset.id, editForm, editImageFile, { removeCustomImage: revertToInherited });
      showToast('Asset updated successfully', 'success');
      setEditModal(false);
      setEditImageFile(null);
      setRevertToInherited(false);
      onRefresh();
    } catch (e) {
      showToast(e.response?.data?.message || 'Update failed', 'error');
    } finally {
      setEditSaving(false);
    }
  };

  const editSelectedType = types.find(t => String(t.id) === String(editForm.asset_type_id));
  const editInheritedUrl = editSelectedType?.image_url ? resolveImageUrl(editSelectedType.image_url) : null;
  const editPreviewUrl = asset.image_url && Number(asset.is_custom_image) === 1 && !revertToInherited && !editImageFile
    ? resolveImageUrl(asset.image_url)
    : (!editImageFile && !revertToInherited ? (editInheritedUrl || resolveImageUrl(asset.image_url)) : null);
  const editImageSource = editImageFile
    ? 'Custom Image'
    : (Number(asset.is_custom_image) === 1 && !revertToInherited ? 'Custom Image' : (editInheritedUrl ? 'Inherited Image' : null));

  const saveAttrValues = async () => {
    const payload = Object.entries(attrValues).map(([attribute_id, value]) => ({ attribute_id, value }));
    await saveAssetAttributes(asset.id, payload);
    showToast('Attributes saved successfully', 'success');
  };

  const pickEditAssetType = async (assetTypeId) => {
    const id = assetTypeId ? String(assetTypeId) : '';
    setEditImageFile(null);
    setRevertToInherited(false);
    const recTagId = id ? await resolveRecommendedTagTypeId(id, tagTypes) : null;
    setEditForm((prev) => ({
      ...prev,
      asset_type_id: id,
      ...(recTagId ? { tag_type_id: recTagId } : {}),
    }));
  };

  const handleEditAssetTypeChange = (e) => pickEditAssetType(e.target.value);

  const handleEditAssetTypeOptionPick = (typeId) => {
    if (String(editForm.asset_type_id) === String(typeId)) pickEditAssetType(typeId);
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
      <div className="detail-info-card" style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {asset.image_url && (
          <div style={{ flexShrink: 0 }}>
            <img
              src={resolveImageUrl(asset.image_url)}
              alt={asset.name}
              style={{ width: 140, height: 105, objectFit: 'cover', borderRadius: 10, border: '1px solid #e2e8f0' }}
            />
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6, textAlign: 'center' }}>
              {Number(asset.is_custom_image) === 1 ? 'Custom Image' : 'Inherited Image'}
            </div>
          </div>
        )}
        <div className="detail-fields" style={{ flex: 1, minWidth: 240 }}>
          <div className="detail-row"><span className="detail-label">Asset Name</span><span>: {asset.name}</span></div>
          <div className="detail-row"><span className="detail-label">RFID Tag</span><span>: <code>{asset.rfid_tag}</code></span></div>
          <div className="detail-row"><span className="detail-label">Asset Type</span><span>: {typeName}</span></div>
          <div className="detail-row"><span className="detail-label">Tag Type</span><span>: {tagTypeName}</span></div>
          <div className="detail-row"><span className="detail-label">Vendor</span><span>: {vendorName}</span></div>
          <div className="detail-row"><span className="detail-label">Last Known Location</span><span>: {locationName}</span></div>
          <div className="detail-row"><span className="detail-label">Status</span><span>: {statusBadge(asset.status)}</span></div>
          <div className="detail-row"><span className="detail-label">Created</span><span>: {new Date(asset.created_at).toLocaleString()}</span></div>
        </div>
      </div>

      {/* Tabs */}
      <div className="detail-tabs">
        <button className={`tab-btn ${tab === 'trace' ? 'active' : ''}`} onClick={() => setTab('trace')}>Trace History</button>
        <button className={`tab-btn ${tab === 'attrs' ? 'active' : ''}`} onClick={() => setTab('attrs')}>Attributes</button>
       <button className={`tab-btn ${tab === 'finance' ? 'active' : ''}`} onClick={() => setTab('finance')}>Financial Info</button>
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

      {/* Financial Info Tab */}
      {tab === 'finance' && (
        <FinancialInfoTab assetId={asset.id} assetName={asset.name} />
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
                <label>Asset Type <span className="required">*</span></label>
                <div className="field-wrap">
                  <select
                    value={editForm.asset_type_id}
                    onChange={handleEditAssetTypeChange}
                  >
                    <option value="">-- Select --</option>
                    {types.map((t) => (
                      <option
                        key={t.id}
                        value={t.id}
                        onMouseDown={() => handleEditAssetTypeOptionPick(t.id)}
                      >
                        {t.name}
                      </option>
                    ))}
                  </select>
                  {editErrors.asset_type_id && <span className="field-error">{editErrors.asset_type_id}</span>}
                </div>
              </div>
              <div className="form-row">
                <label>Asset Image</label>
                <div className="field-wrap" style={{ maxWidth: 420 }}>
                  <ImageUploadField
                    label=""
                    previewUrl={editPreviewUrl}
                    sourceLabel={editImageSource}
                    file={editImageFile}
                    onFileChange={(f) => { setEditImageFile(f); setRevertToInherited(false); }}
                    onClear={() => {
                      if (Number(asset.is_custom_image) === 1 || editImageFile) {
                        setEditImageFile(null);
                        setRevertToInherited(true);
                      }
                    }}
                  />
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
              <button className="btn btn-secondary" onClick={() => {
                setEditModal(false);
                setEditErrors({});
                setEditImageFile(null);
                setRevertToInherited(false);
              }}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEdit} disabled={editSaving}>
                {editSaving ? 'Saving…' : 'Save'}
              </button>
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

const INVENTORY_STATUS_LABELS = {
  in_inventory: 'Inventory',
  missing: 'Missing',
  not_in_inventory: 'Not in inventory',
};

function inventoryStatusLabel(st) {
  const k = String(st || 'in_inventory').toLowerCase();
  return INVENTORY_STATUS_LABELS[k] || k.replace(/_/g, ' ');
}

const assetTableThumbStyle = {
  width: 32,
  height: 32,
  borderRadius: 6,
  flexShrink: 0,
  overflow: 'hidden',
  background: '#f1f5f9',
  border: '1px solid #e2e8f0',
};

function AssetTableThumb({ imageUrl, name }) {
  const [broken, setBroken] = useState(false);
  const url = imageUrl?.trim();
  if (!url || broken) {
    return (
      <div
        style={{
          ...assetTableThumbStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
          color: '#cbd5e1',
        }}
        aria-hidden
      >
        —
      </div>
    );
  }
  return (
    <div style={assetTableThumbStyle}>
      <img
        src={resolveImageUrl(url)}
        alt={name ? `${name} image` : 'Asset'}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        onError={() => setBroken(true)}
      />
    </div>
  );
}

function InventoryStatusCell({ status }) {
  const st = String(status || 'in_inventory').toLowerCase();
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 32,
    height: 30,
    padding: '0 8px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
  };
  if (st === 'missing') {
    return (
      <span title="Missing" style={{ ...base, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }} aria-label="Missing">!</span>
    );
  }
  if (st === 'not_in_inventory') {
    return (
      <span title="Not in inventory" style={{ ...base, background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0' }} aria-label="Not in inventory">—</span>
    );
  }
  return (
    <span title="Inventory" style={{ ...base, background: '#ecfdf5', color: '#047857', border: '1px solid #bbf7d0' }} aria-label="Inventory">✓</span>
  );
}

// ── Bulk Change Location Modal ─────────────────────────────────
function BulkChangeLocationModal({ selectedAssets, locations, onClose, onSaved }) {
  const [newLocationId, setNewLocationId] = useState('');
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (!newLocationId) return;
    setLoading(true);
    let firstErr = null;
    for (const asset of selectedAssets) {
      try {
        await updateAsset(asset.id, {
          ...asset,
          current_location_id: newLocationId,
        });
      } catch (e) {
        if (!firstErr) firstErr = e;
      }
    }
    if (firstErr) toastApiFailure(firstErr, 'Bulk change location');
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
    }).catch((e) => toastApiFailure(e, 'Attributes'));
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
    let firstErr = null;
    // For each selected asset, find the matching attribute by name and update
    for (const asset of selectedAssets) {
      try {
        // Get this asset's attributes to find the right attribute_id
        const r = await getAssetAttributes(asset.id);
        const match = r.data.find(a => a.name.toLowerCase() === attr.name.toLowerCase());
        if (match) {
          await saveAssetAttributes(asset.id, [{ attribute_id: match.attribute_id, value: attrValue }]);
        }
      } catch (e) {
        if (!firstErr) firstErr = e;
      }
    }
    if (firstErr) toastApiFailure(firstErr, 'Bulk update attributes');
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

const ASSET_TABLE_ATTR_STORAGE_KEY = 'rfid_assets_table_attr_columns_v1';
const MAX_ASSET_TABLE_ATTR_COLUMNS = 5;

function loadStoredAssetTableAttrColumns() {
  try {
    const raw = localStorage.getItem(ASSET_TABLE_ATTR_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(x => x && typeof x.name === 'string')
      .map(x => ({ id: x.id, name: x.name, attr_type: x.attr_type || '' }))
      .slice(0, MAX_ASSET_TABLE_ATTR_COLUMNS);
  } catch {
    return [];
  }
}

function saveStoredAssetTableAttrColumns(cols) {
  try {
    localStorage.setItem(ASSET_TABLE_ATTR_STORAGE_KEY, JSON.stringify(cols.slice(0, MAX_ASSET_TABLE_ATTR_COLUMNS)));
  } catch { /* ignore quota */ }
}

/** Match list values by attribute name (ids can differ per asset type). */
function getAssetAttrValueDisplay(asset, attrName) {
  const attrs = asset.attributes || [];
  const row = attrs.find(a => a.name === attrName);
  if (!row) return '—';
  const v = row.value;
  if (v === null || v === undefined || String(v).trim() === '') return '—';
  if (row.attr_type === 'date' && v) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }
  }
  return String(v);
}

/** `lastseen` from API — last seen time (latest movement) for the asset. */
function formatAssetLastSeenDisplay(raw) {
  const v = raw ?? null;
  if (v === null || v === undefined || String(v).trim() === '') return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function AssetTableAttrColumnToggle({ expanded, onToggle, selectedCount }) {
  return (
    <button
      type="button"
      className="assets-attr-toolbar-btn"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls="asset-extra-columns-panel"
      title={expanded ? 'Hide extra column picker' : 'Pick optional columns for this table (up to 5)'}
    >
      <span className="assets-attr-toolbar-btn-icon" aria-hidden>
        <svg
          className="assets-attr-toolbar-attr-svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="3.5" y="4.5" width="12" height="15" rx="2.25" />
          <path d="M7 9.25h5.5M7 12.75h4.75M7 16.25h3.75" strokeOpacity="0.4" />
          <circle cx="17.5" cy="8.75" r="3.85" />
          <path d="M17.5 6.35v4.8M15.2 8.75h4.6" />
        </svg>
      </span>
      {selectedCount > 0 && (
        <span className="assets-attr-toolbar-btn-count" aria-hidden>{selectedCount}</span>
      )}
    </button>
  );
}

function AssetTableAttrColumnsPanel({ open, onClose, filterType, selectedCols, onSelectedChange, showToast }) {
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    setLoading(true);
    getAttributeList(filterType ? { asset_type_id: filterType } : {})
      .then(r => setCatalog(Array.isArray(r.data) ? r.data : []))
      .catch(() => {
        showToast('Could not load attribute list.', 'error');
        setCatalog([]);
      })
      .finally(() => setLoading(false));
  }, [open, filterType, showToast]);

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return catalog;
    return catalog.filter(r =>
      String(r.name || '').toLowerCase().includes(qq) ||
      String(r.attr_type || '').toLowerCase().includes(qq)
    );
  }, [catalog, q]);

  const selectedByName = useMemo(() => new Set(selectedCols.map(c => c.name)), [selectedCols]);

  const toggle = (row) => {
    const name = row.name;
    if (selectedByName.has(name)) {
      onSelectedChange(selectedCols.filter(c => c.name !== name));
      return;
    }
    if (selectedCols.length >= MAX_ASSET_TABLE_ATTR_COLUMNS) {
      showToast('You can show at most 5 attribute columns.', 'error');
      return;
    }
    onSelectedChange([
      ...selectedCols,
      { id: row.id, name: row.name, attr_type: row.attr_type || '' },
    ]);
  };

  const hasSelection = selectedCols.length > 0;

  return (
    <div
      id="asset-extra-columns-panel"
      className="assets-attr-inline-card"
      role="region"
      aria-label="Optional asset attribute columns"
      aria-hidden={!open}
    >
      <div className="assets-attr-inline-head">
        <div>
          <h3 className="assets-attr-inline-title">Extra columns in this table</h3>
          <p className="assets-attr-inline-sub">
            Choose attributes to show as extra columns (max five). Values come from each asset; empty cells show —.
            {filterType ? ' Only attributes for the selected asset type are listed.' : ''}
          </p>
        </div>
        <div className="assets-attr-inline-head-actions">
          <span className="assets-attr-inline-pill" aria-live="polite">
            <strong>{selectedCols.length}</strong> / {MAX_ASSET_TABLE_ATTR_COLUMNS} selected
          </span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={!hasSelection} onClick={() => onSelectedChange([])}>Clear all</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
        </div>
      </div>
      <div className="assets-attr-inline-search">
        <span className="assets-attr-inline-search-icon" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
          </svg>
        </span>
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search by attribute name or type…"
          aria-label="Filter attribute list"
        />
      </div>
      <div className="assets-attr-inline-grid-wrap">
        {loading && <div className="assets-attr-inline-loading">Loading attributes…</div>}
        {!loading && filtered.length === 0 && (
          <div className="assets-attr-inline-loading">
            {catalog.length === 0 ? 'No attributes are defined yet.' : 'No attributes match your search.'}
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <div className="assets-attr-inline-grid">
            {filtered.map(row => {
              const checked = selectedByName.has(row.name);
              const atMax = selectedCols.length >= MAX_ASSET_TABLE_ATTR_COLUMNS && !checked;
              return (
                <label
                  key={`${row.id}-${row.name}`}
                  className={`assets-attr-inline-tile${checked ? ' is-checked' : ''}${atMax ? ' is-max' : ''}`}
                  title={atMax ? 'Maximum five columns — remove one to add another.' : undefined}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggle(row)} />
                  <span className="assets-attr-inline-tile-name">{row.name}</span>
                  {row.attr_type && <span className="assets-attr-inline-tile-type">{row.attr_type}</span>}
                </label>
              );
            })}
          </div>
        )}
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
  /** `''` | `in_inventory` | `missing` — GET `asset_inventory_status` */
  const [filterInventoryStatus, setFilterInventoryStatus] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [tableAttrColumns, setTableAttrColumns] = useState(() => loadStoredAssetTableAttrColumns());
  const [attrColumnsPanelOpen, setAttrColumnsPanelOpen] = useState(false);
  const searchTimer = React.useRef(null);

  // Privilege checks
  const { showToast } = useToast();
  const currentUser = (() => { try { return JSON.parse(sessionStorage.getItem('rfid_user') || 'null'); } catch { return null; } })();
  const isSuperAdmin = currentUser?.profile_type === 'super_admin';
  const canModify = isSuperAdmin || !!currentUser?.asset_can_modify;
  const canDelete = isSuperAdmin || !!currentUser?.asset_can_delete;

  const PAGE_SIZES = [10, 25, 50, 100];

  // Auto-correct pageSize downward only — if selected limit exceeds what's meaningful
  // e.g. total=8, limit=25 → correct to 10. But never force upward (10→25).
  const clampPageSize = (tot, currentLimit) => {
    const prev = PAGE_SIZES[PAGE_SIZES.indexOf(currentLimit) - 1];
    // If there's a smaller option and total fits within it, step down
    if (prev !== undefined && tot <= prev) {
      return clampPageSize(tot, prev); // recurse to find the right size
    }
    return currentLimit;
  };

  const fetchAssets = (s, loc, typ, page, limit, sKey, sDir, invOverride) => {
    const inv = invOverride !== undefined ? invOverride : filterInventoryStatus;
    const q = {
      search: s || '',
      location_id: loc || '',
      asset_type_id: typ || '',
      page: page || 1,
      limit: limit || 10,
      sort: sKey || 'created_at',
      sort_dir: sDir || 'desc',
    };
    if (inv) q.asset_inventory_status = inv;
    setLoading(true);
    return getAssets(q).then(r => {
      const data = r.data;
      let tot = 0, totPages = 1, list = [];
      // Response shape: { pagination: { total, page, limit, totalPages }, data: [...] }
      if (data && data.pagination && Array.isArray(data.data)) {
        list = data.data;
        tot = data.pagination.total ?? data.data.length;
        totPages = data.pagination.totalPages ?? 1;
      } else if (Array.isArray(data)) {
        list = data; tot = data.length; totPages = 1;
      } else if (data && Array.isArray(data.assets)) {
        list = data.assets;
        tot = data.pagination?.total ?? data.assets.length;
        totPages = data.pagination?.totalPages ?? 1;
      }
      setItems(list);
      setTotal(tot);
      setTotalPages(totPages);
      // Auto-correct pageSize if current limit is now disabled for this total
      const corrected = clampPageSize(tot, limit);
      if (corrected !== limit) {
        setPageSize(corrected);
      }
    }).catch((e) => toastApiFailure(e, 'Assets list')).finally(() => setLoading(false));
  };

  const load = useCallback(() => {
    fetchAssets(search, filterLocation, filterType, currentPage, pageSize, sortKey, sortDir);
  }, [search, filterLocation, filterType, filterInventoryStatus, currentPage, pageSize, sortKey, sortDir]);

  useEffect(() => {
    fetchAssets('', '', '', 1, 10, 'created_at', 'desc');
    getAssetTypes().then(r => setTypes(r.data)).catch((e) => toastApiFailure(e, 'Asset types'));
    getLocations().then(r => setLocations(r.data)).catch((e) => toastApiFailure(e, 'Locations'));
    getTagTypes().then(r => setTagTypes(r.data)).catch((e) => toastApiFailure(e, 'Tag types'));
    getVendors().then(r => setVendors(r.data)).catch((e) => toastApiFailure(e, 'Vendors'));
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

  const handleInventoryStatusFilter = (val) => {
    setFilterInventoryStatus(val);
    setCurrentPage(1);
    fetchAssets(search, filterLocation, filterType, 1, pageSize, sortKey, sortDir, val);
  };

  const clearFilters = () => {
    setSearch(''); setFilterLocation(''); setFilterType(''); setFilterInventoryStatus('');
    setCurrentPage(1);
    fetchAssets('', '', '', 1, pageSize, sortKey, sortDir, '');
  };

  // Fetch and auto-correct page if current page exceeds new totalPages after a delete
  const fetchAndClampPage = async (s, loc, typ, page, limit, sKey, sDir, invOverride) => {
    const inv = invOverride !== undefined ? invOverride : filterInventoryStatus;
    const q = {
      search: s || '',
      location_id: loc || '',
      asset_type_id: typ || '',
      page: page || 1,
      limit: limit || 10,
      sort: sKey || 'created_at',
      sort_dir: sDir || 'desc',
    };
    if (inv) q.asset_inventory_status = inv;
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
        return fetchAndClampPage(s, loc, typ, totPages, limit, sKey, sDir, inv);
      }
      setItems(list);
      setTotal(tot);
      setTotalPages(totPages);
    } catch (e) {
      toastApiFailure(e, 'Assets list');
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
        try {
          await deleteAsset(id);
          showToast('Asset deleted', 'success');
          fetchAndClampPage(search, filterLocation, filterType, currentPage, pageSize, sortKey, sortDir);
        } catch (e) {
          toastApiFailure(e, 'Delete asset');
        }
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
        try {
          await bulkDeleteAssets(ids);
          showToast(`${ids.length} asset${ids.length > 1 ? 's' : ''} deleted`, 'success');
          setCheckedIds(new Set());
          fetchAndClampPage(search, filterLocation, filterType, currentPage, pageSize, sortKey, sortDir);
        } catch (e) {
          toastApiFailure(e, 'Bulk delete assets');
        }
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

  const SortTh = ({ col, label, align = 'left' }) => (
    <th
      onClick={() => handleSort(col)}
      style={{
        cursor: 'pointer',
        userSelect: 'none',
        whiteSpace: 'nowrap',
        textAlign: align === 'center' ? 'center' : undefined,
        ...(align === 'center' ? { minWidth: 108 } : {}),
      }}
    >
      {label}<SortIcon col={col} />
    </th>
  );

  const selectedAssets = pagedItems.filter(i => checkedIds.has(i.id));
  const hasFilters = search || filterLocation || filterType || filterInventoryStatus;
  const tableColSpan = 12 + tableAttrColumns.length;
  const tableMinWidth = 1120 + tableAttrColumns.length * 132;

  const handleTableAttrColumnsChange = useCallback((next) => {
    const cleaned = (Array.isArray(next) ? next : []).slice(0, MAX_ASSET_TABLE_ATTR_COLUMNS);
    setTableAttrColumns(cleaned);
    saveStoredAssetTableAttrColumns(cleaned);
  }, []);

  const buildExportRowExtras = useCallback((all) => {
    return all.map((item, i) => {
      const row = {
        ...item,
        _idx: i + 1,
        _invLabel: inventoryStatusLabel(item.asset_inventory_status),
        _lastSeenTime: formatAssetLastSeenDisplay(item.lastseen ?? item.lastSeen),
      };
      tableAttrColumns.forEach((col, j) => {
        row[`_attrCol_${j}`] = getAssetAttrValueDisplay(item, col.name);
      });
      return row;
    });
  }, [tableAttrColumns]);

  const exportBaseColumns = [
    { header: '#', key: '_idx' },
    { header: 'Asset Serial', key: 'asset_serial' },
    { header: 'Asset Name', key: 'name' },
    { header: 'RFID Tag', key: 'rfid_tag' },
    { header: 'Tag Type', key: 'tag_type_name' },
    { header: 'Asset Type', key: 'asset_type_name' },
    { header: 'Location', key: 'location_name' },
    { header: 'Last Seen Time', key: '_lastSeenTime' },
  ];
  const exportAttrColumns = tableAttrColumns.map((col, j) => ({ header: col.name, key: `_attrCol_${j}` }));
  const exportTailColumns = [{ header: 'Inv / Missing', key: '_invLabel' }];
  const exportExcelColumns = [...exportBaseColumns, ...exportAttrColumns, ...exportTailColumns];
  const exportPDFColumns = [
    { header: '#', key: '_idx' },
    { header: 'Asset Serial', key: 'asset_serial' },
    { header: 'Asset Name', key: 'name' },
    { header: 'RFID', key: 'rfid_tag' },
    { header: 'Tag Type', key: 'tag_type_name' },
    { header: 'Asset Type', key: 'asset_type_name' },
    { header: 'Location', key: 'location_name' },
    { header: 'Last Seen Time', key: '_lastSeenTime' },
    ...exportAttrColumns,
    { header: 'Inventory / Missing', key: '_invLabel' },
  ];
  const fetchAllForExport = () =>
    getAssets({
      search: search || '',
      location_id: filterLocation || '',
      asset_type_id: filterType || '',
      ...(filterInventoryStatus ? { asset_inventory_status: filterInventoryStatus } : {}),
      page: 1,
      limit: total || 99999,
      sort: sortKey,
      sort_dir: sortDir,
    })
      .then((r) => {
        const data = r.data;
        if (data && data.pagination && Array.isArray(data.data)) return data.data;
        if (Array.isArray(data)) return data;
        if (data && Array.isArray(data.assets)) return data.assets;
        return [];
      })
      .catch((e) => {
        toastApiFailure(e, 'Export');
        return [];
      });

  if (selected) {
    return <AssetDetail asset={selected} types={types} locations={locations} tagTypes={tagTypes} vendors={vendors} onBack={() => setSelected(null)} onRefresh={load} canModify={canModify} canDelete={canDelete} />;
  }

  return (
    <div className="assets-page">
      <div className="assets-page-top">
      <div className="page-header">
        <h1>Assets</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Export buttons */}
          <ExportButtons
            onExcel={async () => {
              const all = await fetchAllForExport();
              exportExcel(exportExcelColumns, buildExportRowExtras(all), 'assets');
            }}
            onPDF={async () => {
              const all = await fetchAllForExport();
              exportPDF(exportPDFColumns, buildExportRowExtras(all), 'Asset List', 'assets');
            }}
          />
          <span style={{ fontSize: 13, color: '#555' }}>Sorted By</span>
          <select value={sortKey} onChange={e => { setSortKey(e.target.value); setSortDir('asc'); setCurrentPage(1); }}
            style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}>
            <option value="name">Asset Name</option>
            <option value="asset_serial">Asset Serial</option>
            <option value="asset_type_name">Asset Type</option>
            <option value="location_name">Location</option>
            <option value="lastseen">Last Seen Time</option>
            <option value="asset_inventory_status">Inv / Missing</option>
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
      <div className="assets-page-filters">
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
            </svg>
          </span>
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
        <select
          value={filterInventoryStatus}
          onChange={e => handleInventoryStatusFilter(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, minWidth: 158 }}
          aria-label="Filter by inventory status"
        >
          <option value="">Inventory status</option>
          <option value="in_inventory">Inventory</option>
          <option value="missing">Missing</option>
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <AssetTableAttrColumnToggle
            expanded={attrColumnsPanelOpen}
            onToggle={() => setAttrColumnsPanelOpen(v => !v)}
            selectedCount={tableAttrColumns.length}
          />
        </div>
        {hasFilters && <button className="btn btn-secondary btn-sm" onClick={clearFilters}>✕ Clear</button>}
        <span style={{ fontSize: 12, color: '#888', marginLeft: 'auto' }}>
          {total} asset{total !== 1 ? 's' : ''}{hasFilters ? ' (filtered)' : ''}
        </span>
      </div>

      <div
        className={`assets-attr-inline-outer ${attrColumnsPanelOpen ? 'is-open' : ''}`}
        aria-hidden={!attrColumnsPanelOpen}
      >
        <div className="assets-attr-inner">
          <AssetTableAttrColumnsPanel
            open={attrColumnsPanelOpen}
            onClose={() => setAttrColumnsPanelOpen(false)}
            filterType={filterType}
            selectedCols={tableAttrColumns}
            onSelectedChange={handleTableAttrColumnsChange}
            showToast={showToast}
          />
        </div>
      </div>

      </div>

      <div className="assets-page-table-wrap">
      <div className="assets-page-table-card">
        <div className="assets-table-scroll">
          <table className="assets-data-table" style={{ minWidth: tableMinWidth }}>
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
                <SortTh col="asset_type_name" label="Asset Type" />
                <SortTh col="location_name" label="Location" />
                <SortTh col="lastseen" label="Last Seen Time" />
                {tableAttrColumns.map(col => (
                  <th key={col.name} className="assets-attr-th" title={col.attr_type ? `${col.name} (${col.attr_type})` : col.name}>
                    {col.name}
                  </th>
                ))}
                <SortTh col="asset_inventory_status" label="Inv / Missing" align="center" />
                <th style={{ width: 52, padding: '10px 8px', textAlign: 'center' }}>Image</th>
                <th style={{ width: 130, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={tableColSpan} style={{ textAlign: 'center', color: '#aaa', padding: 40 }}>Loading...</td></tr>
              )}
              {!loading && pagedItems.length === 0 && (
                <tr><td colSpan={tableColSpan} style={{ textAlign: 'center', color: '#aaa', padding: 40 }}>
                  {hasFilters ? 'No assets match your search or filters.' : 'No assets yet.'}
                </td></tr>
              )}
              {!loading && pagedItems.map((item, i) => {
                const lastSeenRaw = item.lastseen ?? item.lastSeen;
                const lastSeenDisp = formatAssetLastSeenDisplay(lastSeenRaw);
                return (
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
                  <td style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.location_name || ''}>{item.location_name || '—'}</td>
                  <td style={{ maxWidth: 152, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: '#475569' }} title={lastSeenDisp === '—' ? undefined : String(lastSeenRaw ?? '')}>
                    {lastSeenDisp}
                  </td>
                  {tableAttrColumns.map(col => {
                    const cell = getAssetAttrValueDisplay(item, col.name);
                    return (
                      <td key={col.name} className="assets-attr-td" title={cell === '—' ? undefined : cell}>{cell}</td>
                    );
                  })}
                  <td style={{ textAlign: 'center', verticalAlign: 'middle' }} title={inventoryStatusLabel(item.asset_inventory_status)}>
                    <InventoryStatusCell status={item.asset_inventory_status} />
                  </td>
                  <td style={{ padding: '10px 8px', textAlign: 'center', verticalAlign: 'middle' }}>
                    <AssetTableThumb imageUrl={item.image_url} name={item.name} />
                  </td>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => setSelected(item)}>View</button>
                      {canDelete && <button className="btn btn-danger btn-sm" onClick={() => remove(item.id)}>Delete</button>}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination bar */}
        {total > 0 && (
          <div className="assets-page-pagination">
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
    } catch (e) {
      toastApiFailure(e, 'Tag types');
      return;
    }
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
        try {
          await deleteTagType(id);
          if (selected?.id === id) setSelected(null);
          await onReload();
        } catch (e) {
          toastApiFailure(e, 'Tag types');
        }
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
      toastApiFailure(e, 'Vendors');
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
        try {
          await deleteVendor(id);
          showToast('Vendor deleted', 'success');
          if (selected?.id === id) setSelected(null);
          await onReload();
        } catch (e) {
          toastApiFailure(e, 'Vendors');
        }
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

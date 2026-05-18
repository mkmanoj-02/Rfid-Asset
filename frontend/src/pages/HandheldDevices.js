import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  getHandheldDevices,
  createHandheldDevice,
  updateHandheldDevice,
  deleteHandheldDevice,
  getHandheldDeviceAttributes,
  saveHandheldDeviceAttributes,
  getAttributeList,
} from '../api';
import { toastApiFailure } from '../apiErrorHandling';
import ConfirmModal from '../components/ConfirmModal';
import { useToast } from '../Toast';

function PageEmpty({ icon, title, hint }) {
  return (
    <div className="empty-state" role="status">
      <div className="empty-state-icon" aria-hidden>{icon}</div>
      <p className="empty-state-title">{title}</p>
      <p className="empty-state-hint">{hint}</p>
    </div>
  );
}

// ── Tab 1: Device CRUD ─────────────────────────────────────────
function ManageDevices() {
  const [devices, setDevices] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', is_active: true });
  const [errors, setErrors] = useState({});
  const [editing, setEditing] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const { showToast } = useToast();

  const currentUser = (() => {
    try { return JSON.parse(sessionStorage.getItem('rfid_user') || 'null'); } catch { return null; }
  })();
  const isAdmin = currentUser?.profile_type === 'super_admin' || currentUser?.profile_type === 'admin';

  const load = async () => {
    try {
      const { data } = await getHandheldDevices();
      setDevices(data);
      if (selected) {
        const updated = data.find((d) => d.id === selected.id);
        setSelected(updated || null);
      }
    } catch (e) {
      toastApiFailure(e, 'Handheld devices');
    }
  };

  useEffect(() => { load(); }, []);

  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!query) return devices;
    return devices.filter((d) => {
      const hay = [d.name, d.description, d.is_active ? 'active' : 'inactive'].join(' ').toLowerCase();
      return hay.includes(query);
    });
  }, [devices, query]);

  useEffect(() => {
    if (selected && !filtered.some((d) => d.id === selected.id)) setSelected(null);
  }, [filtered, selected]);

  const openAdd = () => {
    setForm({ name: '', description: '', is_active: true });
    setErrors({});
    setEditing(null);
    setModal(true);
  };

  const openEdit = (item) => {
    setForm({
      name: item.name,
      description: item.description || '',
      is_active: !!item.is_active,
    });
    setErrors({});
    setEditing(item.id);
    setModal(true);
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Device name is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    const name = form.name.trim();
    try {
      const payload = {
        name,
        description: form.description.trim() || null,
        is_active: form.is_active,
      };
      if (editing) {
        await updateHandheldDevice(editing, payload);
        showToast('Device updated', 'success');
      } else {
        const res = await createHandheldDevice(payload);
        const count = res.data?.mapped_attribute_count;
        showToast(
          count != null
            ? `Device added — ${count} attribute${count !== 1 ? 's' : ''} mapped by default`
            : 'Device added — all attributes mapped by default',
          'success',
        );
      }
      setModal(false);
      load();
    } catch (e) {
      toastApiFailure(e, 'Save device');
    }
  };

  const remove = (id) => {
    const item = devices.find((d) => d.id === id);
    setConfirmDialog({
      title: 'Delete Device',
      message: `Are you sure you want to delete "${item?.name || 'this device'}"?`,
      subMessage: 'Attribute mappings for this device will also be removed.',
      confirmLabel: 'Delete',
      confirmStyle: 'danger',
      onConfirm: async () => {
        try {
          await deleteHandheldDevice(id);
          showToast('Device deleted', 'success');
          if (selected?.id === id) setSelected(null);
          load();
        } catch (e) {
          toastApiFailure(e, 'Delete device');
        }
      },
    });
  };

  const leftRef = useRef(null);
  const rightRef = useRef(null);

  useLayoutEffect(() => {
    const L = leftRef.current;
    const R = rightRef.current;
    if (!L || !R) return;
    const sync = () => { R.style.minHeight = `${L.offsetHeight}px`; };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(L);
    window.addEventListener('resize', sync);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [devices.length, filtered.length, query, selected?.id, isAdmin]);

  return (
    <>
      <div className="location-types-split">
        <div
          ref={leftRef}
          className="location-tree-panel"
          style={{ marginRight: 0 }}
        >
          <div className="panel-header">
            <span>Devices</span>
            {isAdmin && (
              <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>+ Add</button>
            )}
          </div>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #e2e8f0', background: '#fafbfc' }}>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none', display: 'flex' }}>
                <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                </svg>
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search devices…"
                style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px 6px 28px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12 }}
              />
            </div>
            {query && (
              <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 6, width: '100%' }} onClick={() => setSearch('')}>
                Clear search
              </button>
            )}
          </div>
          <div className="tree-container">
            {filtered.map((d) => (
              <div
                key={d.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(d)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(d); } }}
                style={{
                  padding: '9px 14px',
                  cursor: 'pointer',
                  fontSize: 14,
                  background: selected?.id === d.id ? '#dbeafe' : 'inherit',
                  color: selected?.id === d.id ? '#1d4ed8' : '#374151',
                  fontWeight: selected?.id === d.id ? 600 : 400,
                  borderBottom: '1px solid #f8fafc',
                }}
              >
                {d.name}
                <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>
                  {d.mapped_attribute_count || 0} attribute{(d.mapped_attribute_count || 0) !== 1 ? 's' : ''} mapped
                  {!d.is_active && ' · Inactive'}
                </div>
              </div>
            ))}
            {devices.length === 0 && <p style={{ color: '#aaa', padding: 12, fontSize: 13, margin: 0 }}>No devices yet</p>}
            {devices.length > 0 && filtered.length === 0 && query && (
              <p style={{ color: '#aaa', padding: 12, fontSize: 13, margin: 0 }}>No devices match your search.</p>
            )}
          </div>
        </div>

        <div ref={rightRef} className="location-types-main">
          {selected ? (
            <div className="location-types-main-body">
              <div style={{ fontWeight: 700, fontSize: 15, textAlign: 'center', marginBottom: 24, borderBottom: '1px solid #f0f2f5', paddingBottom: 12 }}>
                Device Details
              </div>
              {[
                { label: 'Device Name', value: selected.name },
                { label: 'Description', value: selected.description || '—' },
                { label: 'Status', value: selected.is_active ? 'Active' : 'Inactive' },
                { label: 'Mapped Attributes', value: String(selected.mapped_attribute_count || 0) },
                { label: 'Created', value: selected.created_at ? new Date(selected.created_at).toLocaleString() : '—' },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', fontSize: 14, marginBottom: 14 }}>
                  <span style={{ minWidth: 160, fontWeight: 500, color: '#555' }}>{label}</span>
                  <span>: {value}</span>
                </div>
              ))}
              {isAdmin && (
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(selected)}>Edit</button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(selected.id)}>Delete</button>
                </div>
              )}
            </div>
          ) : (
            <PageEmpty
              title="Select a device to view details"
              hint="Choose a device from the list on the left, or add a new handheld reader device."
              icon={(
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                  <path d="M12 18h.01" />
                </svg>
              )}
            />
          )}
        </div>
      </div>

      {modal && (
        <div className="modal-overlay" style={{ zIndex: 200 }}>
          <div className="modal" style={{ width: 440 }}>
            <h2>{editing ? 'Edit Device' : 'Add Device'}</h2>
            <div className="form-group">
              <label>Device Name <span className="required">*</span></label>
              <input
                value={form.name}
                onChange={(e) => {
                  setForm({ ...form, name: e.target.value });
                  if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
                }}
                placeholder="e.g. Warehouse Reader 1"
                autoComplete="off"
                aria-invalid={!!errors.name}
              />
              {errors.name && <span className="field-error">{errors.name}</span>}
            </div>
            <div className="form-group">
              <label>Description</label>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional notes"
              />
            </div>
            <div className="form-group" style={{ marginBottom: 8 }}>
              <label
                htmlFor="handheld-device-active"
                style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 0, cursor: 'pointer' }}
              >
                <input
                  id="handheld-device-active"
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  style={{ width: 'auto', margin: 0 }}
                />
                <span>Active (visible to mobile app)</span>
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => { setModal(false); setErrors({}); }}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={save}>{editing ? 'Save' : 'Add Device'}</button>
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
    </>
  );
}

// ── Tab 2: Map attributes per device ───────────────────────────
function AttributeMapping() {
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [allAttributes, setAllAttributes] = useState([]);
  const [mappedIds, setMappedIds] = useState(new Set());
  const [attrSearch, setAttrSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const currentUser = (() => {
    try { return JSON.parse(sessionStorage.getItem('rfid_user') || 'null'); } catch { return null; }
  })();
  const isAdmin = currentUser?.profile_type === 'super_admin' || currentUser?.profile_type === 'admin';

  useEffect(() => {
    Promise.all([getHandheldDevices(), getAttributeList()])
      .then(([devRes, attrRes]) => {
        setDevices(devRes.data.filter((d) => d.is_active));
        setAllAttributes(attrRes.data);
      })
      .catch((e) => toastApiFailure(e, 'Attribute mapping'));
  }, []);

  useEffect(() => {
    if (!selectedDeviceId) {
      setMappedIds(new Set());
      return;
    }
    setLoading(true);
    getHandheldDeviceAttributes(selectedDeviceId)
      .then((res) => {
        setMappedIds(new Set(res.data.attribute_ids || []));
      })
      .catch((e) => toastApiFailure(e, 'Load mappings'))
      .finally(() => setLoading(false));
  }, [selectedDeviceId]);

  const attrQuery = attrSearch.trim().toLowerCase();
  const filteredAttrs = useMemo(() => {
    if (!attrQuery) return allAttributes;
    return allAttributes.filter((a) => {
      const hay = [a.name, a.attr_type].join(' ').toLowerCase();
      return hay.includes(attrQuery);
    });
  }, [allAttributes, attrQuery]);

  const toggle = (id) => {
    setMappedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setMappedIds((prev) => {
      const next = new Set(prev);
      filteredAttrs.forEach((a) => next.add(a.id));
      return next;
    });
  };

  const clearAll = () => setMappedIds(new Set());

  const save = async () => {
    if (!selectedDeviceId) {
      showToast('Select a device first', 'error');
      return;
    }
    setSaving(true);
    try {
      await saveHandheldDeviceAttributes(selectedDeviceId, [...mappedIds]);
      showToast('Attribute mapping saved', 'success');
    } catch (e) {
      toastApiFailure(e, 'Save mapping');
    } finally {
      setSaving(false);
    }
  };

  const selectedDevice = devices.find((d) => String(d.id) === String(selectedDeviceId));

  return (
    <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', border: '1px solid #e8edf2', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #e8edf2', background: '#f8fafc' }}>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>
          Map asset attributes to each handheld device. The Android app uses the device name from the header and shows only mapped attributes for that device.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Device</label>
          <select
            value={selectedDeviceId}
            onChange={(e) => setSelectedDeviceId(e.target.value)}
            style={{ minWidth: 220, padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}
          >
            <option value="">— Select device —</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          {selectedDevice && (
            <span style={{ fontSize: 12, color: '#2563eb', background: '#eff6ff', padding: '4px 10px', borderRadius: 8 }}>
              {mappedIds.size} of {allAttributes.length} attributes selected
            </span>
          )}
        </div>
      </div>

      {!selectedDeviceId ? (
        <PageEmpty
          title="Select a device to map attributes"
          hint="Choose a handheld device above, then check the asset attributes that should appear on that reader."
          icon={(
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h16M4 12h10M4 18h6" />
              <circle cx="17" cy="12" r="3" />
            </svg>
          )}
        />
      ) : (
        <>
          <div style={{ padding: '12px 20px', borderBottom: '1px solid #e8edf2', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 320 }}>
              <input
                value={attrSearch}
                onChange={(e) => setAttrSearch(e.target.value)}
                placeholder="Search attributes…"
                style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12 }}
              />
            </div>
            {isAdmin && (
              <>
                <button type="button" className="btn btn-secondary btn-sm" onClick={selectAllVisible}>Select visible</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={clearAll}>Clear all</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving || loading}>
                  {saving ? 'Saving…' : 'Save mapping'}
                </button>
              </>
            )}
          </div>
          <div style={{ maxHeight: 'calc(100vh - 340px)', overflowY: 'auto', padding: '8px 0' }}>
            {loading && <p style={{ padding: 16, color: '#888', fontSize: 13 }}>Loading mappings…</p>}
            {!loading && filteredAttrs.length === 0 && (
              <p style={{ padding: 16, color: '#888', fontSize: 13, textAlign: 'center' }}>No attributes found.</p>
            )}
            {!loading && filteredAttrs.map((attr) => (
              <label
                key={attr.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 20px',
                  cursor: isAdmin ? 'pointer' : 'default',
                  borderBottom: '1px solid #f8fafc',
                  background: mappedIds.has(attr.id) ? '#f0f9ff' : 'transparent',
                }}
              >
                <input
                  type="checkbox"
                  checked={mappedIds.has(attr.id)}
                  disabled={!isAdmin}
                  onChange={() => toggle(attr.id)}
                />
                <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: '#374151' }}>{attr.name}</span>
                <span style={{ fontSize: 11, background: '#e9ecff', color: '#5a67d8', padding: '2px 8px', borderRadius: 8 }}>
                  {attr.attr_type}
                </span>
              </label>
            ))}
          </div>
          <div style={{ padding: '12px 20px', borderTop: '1px solid #e8edf2', fontSize: 12, color: '#6b7280', background: '#fafbfc' }}>
            Mobile API: <code style={{ fontSize: 11 }}>GET /api/handheld-devices/mobile/attributes?device_name={selectedDevice?.name || 'DeviceName'}</code>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────
export default function HandheldDevices() {
  const [tab, setTab] = useState('devices');

  return (
    <div>
      <div className="page-header"><h1>Handheld Devices</h1></div>
      <p style={{ margin: '-8px 0 20px', fontSize: 14, color: '#6b7280', maxWidth: 720 }}>
        Configure mobile reader devices and control which asset attributes appear on each handheld when scanning.
      </p>
      <div className="detail-tabs" style={{ marginBottom: 20 }}>
        <button type="button" className={`tab-btn ${tab === 'devices' ? 'active' : ''}`} onClick={() => setTab('devices')}>
          Devices
        </button>
        <button type="button" className={`tab-btn ${tab === 'mapping' ? 'active' : ''}`} onClick={() => setTab('mapping')}>
          Attribute Mapping
        </button>
      </div>
      {tab === 'devices' && <ManageDevices />}
      {tab === 'mapping' && <AttributeMapping />}
    </div>
  );
}



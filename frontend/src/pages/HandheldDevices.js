import React, { useEffect, useMemo, useState } from 'react';
import {
  getHandheldDevices,
  createHandheldDevice,
  updateHandheldDevice,
  deleteHandheldDevice,
  getHandheldDeviceAttributes,
  saveHandheldDeviceAttributes,
  getAttributeList,
  getReaders,
  createReader,
  updateReader,
  deleteReader,
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

const PLATFORM_OPTIONS = ['Android', 'iOS', 'Windows', 'Other'];
const READER_TYPE_OPTIONS = ['IR-Reader', '4-Port Reader'];
const READER_MODE_OPTIONS = ['IN', 'OUT', 'MONITORING'];

function SearchBox({ value, onChange, placeholder }) {
  return (
    <div style={{ padding: '8px 10px', borderBottom: '1px solid #e2e8f0', background: '#fafbfc' }}>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none', display: 'flex' }}>
          <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
          </svg>
        </span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px 6px 28px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12 }}
        />
      </div>
      {value.trim() && (
        <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 6, width: '100%' }} onClick={() => onChange('')}>
          Clear search
        </button>
      )}
    </div>
  );
}

function DetailRows({ rows }) {
  return rows.map(({ label, value }) => (
    <div key={label} style={{ display: 'flex', fontSize: 14, marginBottom: 14 }}>
      <span style={{ minWidth: 160, fontWeight: 500, color: '#555' }}>{label}</span>
      <span>: {value}</span>
    </div>
  ));
}

function useIsAdmin() {
  const currentUser = (() => {
    try { return JSON.parse(sessionStorage.getItem('rfid_user') || 'null'); } catch { return null; }
  })();
  return currentUser?.profile_type === 'super_admin' || currentUser?.profile_type === 'admin';
}

// ── Tab 1a: Handheld device CRUD ───────────────────────────────
function HandheldDeviceList() {
  const [devices, setDevices] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', platform: '', is_active: true });
  const [errors, setErrors] = useState({});
  const [editing, setEditing] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const { showToast } = useToast();
  const isAdmin = useIsAdmin();

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
      const hay = [d.name, d.description, d.platform, d.is_active ? 'active' : 'inactive'].join(' ').toLowerCase();
      return hay.includes(query);
    });
  }, [devices, query]);

  useEffect(() => {
    if (selected && !filtered.some((d) => d.id === selected.id)) setSelected(null);
  }, [filtered, selected]);

  const openAdd = () => {
    setForm({ name: '', description: '', platform: '', is_active: true });
    setErrors({});
    setEditing(null);
    setModal(true);
  };

  const openEdit = (item) => {
    setForm({
      name: item.name,
      description: item.description || '',
      platform: item.platform || '',
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
        platform: form.platform || null,
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

  return (
    <>
      <div className="locations-layout">
        <div className="location-tree-panel">
          <div className="panel-header">
            <span>Handheld Devices</span>
            {isAdmin && (
              <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>+ Add</button>
            )}
          </div>
          <SearchBox value={search} onChange={setSearch} placeholder="Search devices…" />
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
                  {d.platform && `${d.platform} · `}
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

        <div className="location-detail-panel">
          {selected ? (
            <div className="location-types-main">
            <div className="location-types-main-body">
              <div style={{ fontWeight: 700, fontSize: 15, textAlign: 'center', marginBottom: 24, borderBottom: '1px solid #f0f2f5', paddingBottom: 12 }}>
                Device Details
              </div>
              <DetailRows
                rows={[
                  { label: 'Device Name', value: selected.name },
                  { label: 'Description', value: selected.description || '—' },
                  { label: 'Platform', value: selected.platform || '—' },
                  { label: 'Status', value: selected.is_active ? 'Active' : 'Inactive' },
                  { label: 'Mapped Attributes', value: String(selected.mapped_attribute_count || 0) },
                  { label: 'Created', value: selected.created_at ? new Date(selected.created_at).toLocaleString() : '—' },
                ]}
              />
              {isAdmin && (
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(selected)}>Edit</button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(selected.id)}>Delete</button>
                </div>
              )}
            </div>
            </div>
          ) : (
            <PageEmpty
              title="Select a handheld device to view details"
              hint="Choose a device on the left to see its details, or add a new handheld device."
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
            <h2>{editing ? 'Edit Handheld Device' : 'Add Handheld Device'}</h2>
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
            <div className="form-group">
              <label>Platform</label>
              <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                <option value="">— Select platform —</option>
                {PLATFORM_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                {form.platform && !PLATFORM_OPTIONS.includes(form.platform) && (
                  <option value={form.platform}>{form.platform}</option>
                )}
              </select>
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

// ── Tab 1b: Fixed reader CRUD ──────────────────────────────────
const EMPTY_READER_FORM = {
  name: '',
  readerType: '',
  ipAddress: '',
  port: 2022,
  mode: 'IN',
  antennaCount: 4,
  txPower: 30,
  readDuration: 1000,
  itemSeen: 20,
  itemSeenEnabled: true,
  antennas: [],
};

function resizeAntennas(antennas, count, defaultTxPower) {
  const n = Math.max(0, Math.min(32, Number(count) || 0));
  const byNumber = new Map(antennas.map((a) => [a.number, a]));
  return Array.from({ length: n }, (_, i) => {
    const number = i + 1;
    return byNumber.get(number) || { number, txPower: defaultTxPower, enabled: true };
  });
}

function StatusBadge({ status }) {
  const connected = status === 'CONNECTED';
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: '1px 6px',
        borderRadius: 8,
        background: connected ? '#dcfce7' : '#f1f5f9',
        color: connected ? '#15803d' : '#64748b',
      }}
    >
      {connected ? 'Connected' : 'Disconnected'}
    </span>
  );
}

function FixedReaderList() {
  const [readers, setReaders] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY_READER_FORM);
  const [errors, setErrors] = useState({});
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const { showToast } = useToast();
  const isAdmin = useIsAdmin();

  const load = async () => {
    try {
      const { data: body } = await getReaders();
      const data = Array.isArray(body) ? body : body?.data?.readers || [];
      setReaders(data);
      setSelected((prev) => (prev ? data.find((r) => r.id === prev.id) || null : null));
    } catch (e) {
      toastApiFailure(e, 'Fixed readers');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!query) return readers;
    return readers.filter((r) => {
      const hay = [r.name, r.readerType, r.ipAddress, r.mode, r.connectionStatus]
        .join(' ')
        .toLowerCase();
      return hay.includes(query);
    });
  }, [readers, query]);

  useEffect(() => {
    if (selected && !filtered.some((r) => r.id === selected.id)) setSelected(null);
  }, [filtered, selected]);

  const openAdd = () => {
    setForm({
      ...EMPTY_READER_FORM,
      antennas: resizeAntennas([], EMPTY_READER_FORM.antennaCount, EMPTY_READER_FORM.txPower),
    });
    setErrors({});
    setEditing(null);
    setModal(true);
  };

  const openEdit = (r) => {
    setForm({
      name: r.name,
      readerType: r.readerType || '',
      ipAddress: r.ipAddress || '',
      port: r.port,
      mode: r.mode || 'IN',
      antennaCount: r.antennaCount,
      txPower: r.txPower,
      readDuration: r.readDuration,
      itemSeen: r.itemSeen,
      itemSeenEnabled: !!r.itemSeenEnabled,
      antennas: resizeAntennas(
        (r.antennas || []).map((a) => ({ number: a.number, txPower: a.txPower, enabled: !!a.enabled })),
        r.antennaCount,
        r.txPower,
      ),
    });
    setErrors({});
    setEditing(r.id);
    setModal(true);
  };

  const setField = (key, value) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'antennaCount') next.antennas = resizeAntennas(prev.antennas, value, prev.txPower);
      return next;
    });
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: '' }));
  };

  const setAntenna = (number, patch) => {
    setForm((prev) => ({
      ...prev,
      antennas: prev.antennas.map((a) => (a.number === number ? { ...a, ...patch } : a)),
    }));
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Reader name is required';
    if (!form.readerType) e.readerType = 'Reader type is required';
    if (!form.ipAddress.trim()) e.ipAddress = 'IP address is required';
    const port = Number(form.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) e.port = 'Port must be between 1 and 65535';
    const count = Number(form.antennaCount);
    if (!Number.isInteger(count) || count < 1 || count > 32) e.antennaCount = 'Antenna count must be between 1 and 32';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    const payload = {
      name: form.name.trim(),
      readerType: form.readerType,
      ipAddress: form.ipAddress.trim(),
      port: Number(form.port),
      mode: form.mode,
      antennaCount: Number(form.antennaCount),
      txPower: Number(form.txPower),
      readDuration: Number(form.readDuration),
      itemSeen: Number(form.itemSeen),
      itemSeenEnabled: form.itemSeenEnabled,
      antennas: form.antennas.map((a) => ({ number: a.number, txPower: Number(a.txPower), enabled: a.enabled })),
    };
    setSaving(true);
    try {
      if (editing) {
        await updateReader(editing, payload);
        showToast('Reader updated', 'success');
      } else {
        const { data: body } = await createReader(payload);
        const created = body?.data || body;
        showToast('Reader added', 'success');
        if (created?.id) setSelected(created);
      }
      setModal(false);
      load();
    } catch (e) {
      toastApiFailure(e, 'Save reader');
    } finally {
      setSaving(false);
    }
  };

  const remove = (r) => {
    setConfirmDialog({
      title: 'Delete Reader',
      message: `Are you sure you want to delete "${r.name}"?`,
      subMessage: 'Antenna settings for this reader will also be removed.',
      confirmLabel: 'Delete',
      confirmStyle: 'danger',
      onConfirm: async () => {
        try {
          await deleteReader(r.id);
          showToast('Reader deleted', 'success');
          if (selected?.id === r.id) setSelected(null);
          load();
        } catch (e) {
          toastApiFailure(e, 'Delete reader');
        }
      },
    });
  };

  const fmtDate = (v) => (v ? new Date(v).toLocaleString() : '—');
  const numInput = (key, props = {}) => (
    <input
      type="number"
      value={form[key]}
      onChange={(e) => setField(key, e.target.value)}
      aria-invalid={!!errors[key]}
      {...props}
    />
  );

  return (
    <>
      <div className="locations-layout">
        <div className="location-tree-panel">
          <div className="panel-header">
            <span>Fixed Readers</span>
            {isAdmin && (
              <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>+ Add</button>
            )}
          </div>
          <SearchBox value={search} onChange={setSearch} placeholder="Search readers…" />
          <div className="tree-container">
            {filtered.map((r) => (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(r)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(r); } }}
                style={{
                  padding: '9px 14px',
                  cursor: 'pointer',
                  fontSize: 14,
                  background: selected?.id === r.id ? '#dbeafe' : 'inherit',
                  color: selected?.id === r.id ? '#1d4ed8' : '#374151',
                  fontWeight: selected?.id === r.id ? 600 : 400,
                  borderBottom: '1px solid #f8fafc',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span>{r.name}</span>
                  <StatusBadge status={r.connectionStatus} />
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>
                  {r.readerType} · {r.ipAddress}:{r.port} · {r.mode}
                </div>
              </div>
            ))}
            {readers.length === 0 && <p style={{ color: '#aaa', padding: 12, fontSize: 13, margin: 0 }}>No fixed readers yet</p>}
            {readers.length > 0 && filtered.length === 0 && query && (
              <p style={{ color: '#aaa', padding: 12, fontSize: 13, margin: 0 }}>No readers match your search.</p>
            )}
          </div>
        </div>

        <div className="location-detail-panel">
          {selected ? (
            <div className="location-types-main">
              <div className="location-types-main-body">
                <div style={{ fontWeight: 700, fontSize: 15, textAlign: 'center', marginBottom: 24, borderBottom: '1px solid #f0f2f5', paddingBottom: 12 }}>
                  Reader Details
                </div>
                <DetailRows
                  rows={[
                    { label: 'Reader Name', value: selected.name },
                    { label: 'Reader Type', value: selected.readerType || '—' },
                    { label: 'IP Address', value: selected.ipAddress || '—' },
                    { label: 'Port', value: String(selected.port) },
                    { label: 'Mode', value: selected.mode },
                    { label: 'Antenna Count', value: String(selected.antennaCount) },
                    { label: 'TX Power', value: String(selected.txPower) },
                    { label: 'Read Duration (ms)', value: String(selected.readDuration) },
                    { label: 'Item Seen', value: `${selected.itemSeen} (${selected.itemSeenEnabled ? 'Enabled' : 'Disabled'})` },
                    { label: 'Connection Status', value: <StatusBadge status={selected.connectionStatus} /> },
                    { label: 'Created', value: fmtDate(selected.createdAt) },
                    { label: 'Updated', value: fmtDate(selected.updatedAt) },
                  ]}
                />

                <div style={{ fontWeight: 600, fontSize: 14, margin: '20px 0 10px', color: '#374151' }}>Antennas</div>
                {(selected.antennas || []).length === 0 ? (
                  <p style={{ color: '#aaa', fontSize: 13, margin: 0 }}>No antennas configured.</p>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                        <th style={{ padding: '8px 10px', borderBottom: '1px solid #e2e8f0' }}>Antenna #</th>
                        <th style={{ padding: '8px 10px', borderBottom: '1px solid #e2e8f0' }}>TX Power</th>
                        <th style={{ padding: '8px 10px', borderBottom: '1px solid #e2e8f0' }}>Enabled</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.antennas.map((a) => (
                        <tr key={a.id || a.number}>
                          <td style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9' }}>{a.number}</td>
                          <td style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9' }}>{a.txPower}</td>
                          <td style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9' }}>{a.enabled ? 'Yes' : 'No'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {isAdmin && (
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(selected)}>Edit</button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => remove(selected)}>Delete</button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <PageEmpty
              title="Select a fixed reader to view details"
              hint="Choose a reader on the left to see its details, or add a new fixed reader."
              icon={(
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="7" width="18" height="12" rx="2" />
                  <path d="M8 7V4M16 7V4M7 13h.01M11 13h6" />
                </svg>
              )}
            />
          )}
        </div>
      </div>

      {modal && (
        <div className="modal-overlay" style={{ zIndex: 200 }}>
          <div className="modal" style={{ width: 620, maxHeight: '90vh', overflowY: 'auto' }}>
            <h2>{editing ? 'Edit Fixed Reader' : 'Add Fixed Reader'}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
              <div className="form-group">
                <label>Reader Name <span className="required">*</span></label>
                <input
                  value={form.name}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder="e.g. Gate Reader 1"
                  autoComplete="off"
                  aria-invalid={!!errors.name}
                />
                {errors.name && <span className="field-error">{errors.name}</span>}
              </div>
              <div className="form-group">
                <label>Reader Type <span className="required">*</span></label>
                <select value={form.readerType} onChange={(e) => setField('readerType', e.target.value)} aria-invalid={!!errors.readerType}>
                  <option value="">— Select type —</option>
                  {READER_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {errors.readerType && <span className="field-error">{errors.readerType}</span>}
              </div>
              <div className="form-group">
                <label>IP Address <span className="required">*</span></label>
                <input
                  value={form.ipAddress}
                  onChange={(e) => setField('ipAddress', e.target.value)}
                  placeholder="e.g. 192.168.1.10"
                  autoComplete="off"
                  aria-invalid={!!errors.ipAddress}
                />
                {errors.ipAddress && <span className="field-error">{errors.ipAddress}</span>}
              </div>
              <div className="form-group">
                <label>Port</label>
                {numInput('port', { min: 1, max: 65535 })}
                {errors.port && <span className="field-error">{errors.port}</span>}
              </div>
              <div className="form-group">
                <label>Mode</label>
                <select value={form.mode} onChange={(e) => setField('mode', e.target.value)}>
                  {READER_MODE_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Antenna Count</label>
                {numInput('antennaCount', { min: 1, max: 32 })}
                {errors.antennaCount && <span className="field-error">{errors.antennaCount}</span>}
              </div>
              <div className="form-group">
                <label>TX Power</label>
                {numInput('txPower')}
              </div>
              <div className="form-group">
                <label>Read Duration (ms)</label>
                {numInput('readDuration', { min: 0 })}
              </div>
              <div className="form-group">
                <label>Item Seen</label>
                {numInput('itemSeen', { min: 0 })}
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
                <label
                  htmlFor="reader-item-seen-enabled"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer' }}
                >
                  <input
                    id="reader-item-seen-enabled"
                    type="checkbox"
                    checked={form.itemSeenEnabled}
                    onChange={(e) => setField('itemSeenEnabled', e.target.checked)}
                    style={{ width: 'auto', margin: 0 }}
                  />
                  <span>Item Seen enabled</span>
                </label>
              </div>
            </div>

            {form.antennas.length > 0 && (
              <div className="form-group">
                <label>Antennas</label>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid #e2e8f0' }}>Antenna #</th>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid #e2e8f0' }}>TX Power</th>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid #e2e8f0' }}>Enabled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.antennas.map((a) => (
                      <tr key={a.number}>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1f5f9' }}>{a.number}</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1f5f9' }}>
                          <input
                            type="number"
                            value={a.txPower}
                            onChange={(e) => setAntenna(a.number, { txPower: e.target.value })}
                            style={{ width: 100 }}
                          />
                        </td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #f1f5f9' }}>
                          <input
                            type="checkbox"
                            checked={a.enabled}
                            onChange={(e) => setAntenna(a.number, { enabled: e.target.checked })}
                            style={{ width: 'auto', margin: 0 }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => { setModal(false); setErrors({}); }}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save' : 'Add Reader'}
              </button>
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

// ── Tab 1: Devices (handheld vs fixed) ─────────────────────────
function ManageDevices() {
  const [deviceType, setDeviceType] = useState('handheld');
  const options = [
    { id: 'handheld', label: 'Handheld' },
    { id: 'fixed', label: 'Fixed Readers' },
  ];

  return (
    <>
      <div
        role="tablist"
        aria-label="Device type"
        style={{ display: 'inline-flex', gap: 4, padding: 4, marginBottom: 16, background: '#f1f5f9', borderRadius: 8 }}
      >
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={deviceType === o.id}
            onClick={() => setDeviceType(o.id)}
            style={{
              border: 'none',
              cursor: 'pointer',
              padding: '6px 16px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              background: deviceType === o.id ? '#fff' : 'transparent',
              color: deviceType === o.id ? '#1d4ed8' : '#64748b',
              boxShadow: deviceType === o.id ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {deviceType === 'handheld' ? <HandheldDeviceList /> : <FixedReaderList />}
    </>
  );
}

// ── Tab 2: Field configuration per device ──────────────────────
function AttributeMapping() {
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [allAttributes, setAllAttributes] = useState([]);
  const [mappedIds, setMappedIds] = useState(new Set());
  const [attrSearch, setAttrSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();
  const isAdmin = useIsAdmin();

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

  const selectAll = () => {
    setMappedIds(new Set(allAttributes.map((a) => a.id)));
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
      showToast('Display fields saved', 'success');
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
          Choose which asset attributes appear on each handheld device when scanning. Display fields apply to handheld devices only.
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
          title="Select a device to set display fields"
          hint="Choose a handheld device above, then select which fields should appear when using that reader."
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
                <button type="button" className="btn btn-secondary btn-sm" onClick={selectAll}>Select all</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={clearAll}>Clear all</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={saving || loading}>
                  {saving ? 'Saving…' : 'Save'}
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
      <div className="page-header"><h1>Reader Setup</h1></div>
      <p style={{ margin: '-8px 0 20px', fontSize: 14, color: '#6b7280', maxWidth: 720 }}>
        Register handheld and fixed RFID readers, and choose which fields each handheld device displays during scanning.
      </p>
      <div className="detail-tabs" style={{ marginBottom: 20 }}>
        <button type="button" className={`tab-btn ${tab === 'devices' ? 'active' : ''}`} onClick={() => setTab('devices')}>
          Devices
        </button>
        <button type="button" className={`tab-btn ${tab === 'mapping' ? 'active' : ''}`} onClick={() => setTab('mapping')}>
          Display Fields
        </button>
      </div>
      {tab === 'devices' && <ManageDevices />}
      {tab === 'mapping' && <AttributeMapping />}
    </div>
  );
}



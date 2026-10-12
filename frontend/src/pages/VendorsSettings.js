import { useEffect, useState } from 'react';
import { getVendors, createVendor, updateVendor, deleteVendor, bulkDeleteVendors } from '../api';
import { useToast } from '../Toast';
import { toastApiFailure } from '../apiErrorHandling';
import CheckableMasterList from '../components/CheckableMasterList';
import ConfirmModal from '../components/ConfirmModal';

export default function VendorsSettings() {
  const [items, setItems]     = useState([]);
  const [selected, setSelected] = useState(null);
  const [modal, setModal]     = useState(false);
  const [form, setForm]       = useState({ name: '', contact: '', email: '', phone: '', website: '', description: '' });
  const [editing, setEditing] = useState(null);
  const [checkedIds, setCheckedIds] = useState(() => new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { showToast } = useToast();

  const load = () => getVendors().then(r => {
    setItems(r.data);
    setSelected((cur) => (cur ? r.data.find(v => v.id === cur.id) || null : null));
    const ids = new Set(r.data.map((v) => v.id));
    setCheckedIds((cur) => new Set([...cur].filter((id) => ids.has(id))));
  }).catch((e) => toastApiFailure(e, 'Vendors'));

  const bulkRemove = async () => {
    const ids = [...checkedIds];
    if (!ids.length || deleting) return;
    setDeleting(true);
    try {
      const { data } = await bulkDeleteVendors(ids);
      showToast(data?.message || `${ids.length} vendor(s) deleted`, 'success');
      if (selected && checkedIds.has(selected.id)) setSelected(null);
      setCheckedIds(new Set());
      setConfirmBulk(false);
      load();
    } catch (e) {
      toastApiFailure(e, 'Vendors');
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openAdd  = () => { setForm({ name: '', contact: '', email: '', phone: '', website: '', description: '' }); setEditing(null); setModal(true); };
  const openEdit = (item) => {
    setForm({ name: item.name, contact: item.contact || '', email: item.email || '', phone: item.phone || '', website: item.website || '', description: item.description || '' });
    setEditing(item.id); setModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) { showToast('Name is required', 'warning'); return; }
    try {
      if (editing) { await updateVendor(editing, form); showToast('Vendor updated', 'success'); }
      else         { await createVendor(form);          showToast('Vendor added',   'success'); }
    } catch (e) {
      toastApiFailure(e, 'Vendors');
      return;
    }
    setModal(false); load();
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this vendor?')) return;
    try {
      await deleteVendor(id);
      showToast('Vendor deleted', 'success');
      if (selected?.id === id) setSelected(null);
      setCheckedIds((cur) => { const next = new Set(cur); next.delete(id); return next; });
      load();
    } catch (e) {
      toastApiFailure(e, 'Vendors');
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Vendors</h1>
        <button className="btn btn-primary" onClick={openAdd}>+ Add Vendor</button>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <CheckableMasterList
          title="Vendor List"
          items={items}
          selectedId={selected?.id}
          onSelect={setSelected}
          checkedIds={checkedIds}
          onCheckedChange={setCheckedIds}
          onBulkDelete={() => setConfirmBulk(true)}
          emptyLabel="No vendors yet"
        />

        {/* Detail */}
        {selected ? (
          <div style={{ flex: 1, background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', padding: 28, border: '1px solid #e8edf2' }}>
            <div style={{ fontWeight: 700, fontSize: 15, textAlign: 'center', marginBottom: 24, borderBottom: '1px solid #f0f4f8', paddingBottom: 12 }}>
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
                <span style={{ minWidth: 160, fontWeight: 500, color: '#6b7280' }}>{label}</span>
                <span style={{ color: '#1a202c' }}>: {value}</span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 28 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => openEdit(selected)}>Edit</button>
              <button className="btn btn-danger btn-sm"    onClick={() => remove(selected.id)}>Delete</button>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 240, color: '#aaa', fontSize: 15, border: '1px solid #e8edf2' }}>
            Select a vendor to view details
          </div>
        )}
      </div>

      {confirmBulk && (
        <ConfirmModal
          title="Delete vendors"
          message={`Delete ${checkedIds.size} selected vendor${checkedIds.size !== 1 ? 's' : ''}? This cannot be undone.`}
          subMessage="Assets linked to these vendors will have their Vendor cleared."
          confirmLabel={deleting ? 'Deleting…' : 'Delete'}
          onConfirm={bulkRemove}
          onCancel={() => { if (!deleting) setConfirmBulk(false); }}
        />
      )}

      {modal && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 480 }}>
            <h2>{editing ? 'Edit Vendor' : 'Add Vendor'}</h2>
            <div className="add-asset-form">
              {[
                { key: 'name',        label: 'Name',           required: true,  placeholder: 'e.g. Dell, HP, Cisco' },
                { key: 'contact',     label: 'Contact Person', required: false, placeholder: 'Contact name' },
                { key: 'email',       label: 'Email',          required: false, placeholder: 'vendor@example.com', type: 'email' },
                { key: 'phone',       label: 'Phone',          required: false, placeholder: '+1 555 000 0000' },
                { key: 'website',     label: 'Website',        required: false, placeholder: 'https://vendor.com' },
              ].map(({ key, label, required, placeholder, type }) => (
                <div className="form-row" key={key}>
                  <label>{label}{required && <span className="required"> *</span>}</label>
                  <div className="field-wrap">
                    <input type={type || 'text'} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} placeholder={placeholder} autoFocus={key === 'name'} />
                  </div>
                </div>
              ))}
              <div className="form-row">
                <label>Description</label>
                <div className="field-wrap">
                  <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} />
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary"   onClick={save}>{editing ? 'Save' : 'Add Vendor'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

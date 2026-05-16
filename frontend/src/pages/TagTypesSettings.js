import { useEffect, useState } from 'react';
import { getTagTypes, createTagType, updateTagType, deleteTagType } from '../api';
import { useToast } from '../Toast';
import { toastApiFailure } from '../apiErrorHandling';

export default function TagTypesSettings() {
  const [items, setItems]     = useState([]);
  const [selected, setSelected] = useState(null);
  const [modal, setModal]     = useState(false);
  const [form, setForm]       = useState({ name: '', description: '' });
  const [editing, setEditing] = useState(null);
  const { showToast } = useToast();

  const load = () => getTagTypes().then(r => {
    setItems(r.data);
    if (selected) {
      const updated = r.data.find(t => t.id === selected.id);
      setSelected(updated || null);
    }
  }).catch((e) => toastApiFailure(e, 'Tag types'));

  useEffect(() => { load(); }, []);

  const openAdd  = () => { setForm({ name: '', description: '' }); setEditing(null); setModal(true); };
  const openEdit = (item) => { setForm({ name: item.name, description: item.description || '' }); setEditing(item.id); setModal(true); };

  const save = async () => {
    if (!form.name.trim()) { showToast('Name is required', 'warning'); return; }
    try {
      if (editing) { await updateTagType(editing, form); showToast('Tag type updated', 'success'); }
      else         { await createTagType(form);          showToast('Tag type added',   'success'); }
    } catch (e) {
      toastApiFailure(e, 'Tag types');
      return;
    }
    setModal(false); load();
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this tag type?')) return;
    try {
      await deleteTagType(id);
      showToast('Tag type deleted', 'success');
      if (selected?.id === id) setSelected(null);
      load();
    } catch (e) {
      toastApiFailure(e, 'Tag types');
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Tag Types</h1>
        <button className="btn btn-primary" onClick={openAdd}>+ Add Tag Type</button>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        {/* List */}
        <div style={{ width: 260, flexShrink: 0, background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflow: 'hidden', border: '1px solid #e8edf2' }}>
          <div style={{ fontWeight: 600, fontSize: 13, padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e8edf2', textAlign: 'center' }}>
            Tag Type List
          </div>
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            {items.map(t => (
              <div key={t.id} onClick={() => setSelected(t)} style={{
                padding: '10px 16px', cursor: 'pointer', fontSize: 14,
                borderBottom: '1px solid #f8fafc',
                background: selected?.id === t.id ? '#dbeafe' : 'inherit',
                color:      selected?.id === t.id ? '#1d4ed8' : '#374151',
                fontWeight: selected?.id === t.id ? 600 : 400,
              }}>
                {t.name}
              </div>
            ))}
            {items.length === 0 && <div style={{ padding: 20, color: '#aaa', fontSize: 13, textAlign: 'center' }}>No tag types yet</div>}
          </div>
        </div>

        {/* Detail */}
        {selected ? (
          <div style={{ flex: 1, background: '#fff', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', padding: 28, border: '1px solid #e8edf2' }}>
            <div style={{ fontWeight: 700, fontSize: 15, textAlign: 'center', marginBottom: 24, borderBottom: '1px solid #f0f4f8', paddingBottom: 12 }}>
              Tag Type Details
            </div>
            {[
              { label: 'Name',        value: selected.name },
              { label: 'Description', value: selected.description || '—' },
              { label: 'Created',     value: new Date(selected.created_at).toLocaleString() },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', fontSize: 14, marginBottom: 14 }}>
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
            Select a tag type to view details
          </div>
        )}
      </div>

      {modal && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>{editing ? 'Edit Tag Type' : 'Add Tag Type'}</h2>
            <div className="form-group">
              <label>Name <span style={{ color: '#ef4444' }}>*</span></label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. RFID, Barcode, QR" autoFocus />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary"   onClick={save}>{editing ? 'Save' : 'Add'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

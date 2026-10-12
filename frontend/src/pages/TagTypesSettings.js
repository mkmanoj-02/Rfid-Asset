import { useEffect, useState } from 'react';
import { getTagTypes, createTagType, updateTagType, deleteTagType, bulkDeleteTagTypes } from '../api';
import { useToast } from '../Toast';
import { toastApiFailure } from '../apiErrorHandling';
import CheckableMasterList from '../components/CheckableMasterList';
import ConfirmModal from '../components/ConfirmModal';

export default function TagTypesSettings() {
  const [items, setItems]     = useState([]);
  const [selected, setSelected] = useState(null);
  const [modal, setModal]     = useState(false);
  const [form, setForm]       = useState({ name: '', description: '' });
  const [editing, setEditing] = useState(null);
  const [checkedIds, setCheckedIds] = useState(() => new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { showToast } = useToast();

  const load = () => getTagTypes().then(r => {
    setItems(r.data);
    setSelected((cur) => (cur ? r.data.find(t => t.id === cur.id) || null : null));
    const ids = new Set(r.data.map((t) => t.id));
    setCheckedIds((cur) => new Set([...cur].filter((id) => ids.has(id))));
  }).catch((e) => toastApiFailure(e, 'Tag types'));

  const bulkRemove = async () => {
    const ids = [...checkedIds];
    if (!ids.length || deleting) return;
    setDeleting(true);
    try {
      const { data } = await bulkDeleteTagTypes(ids);
      showToast(data?.message || `${ids.length} tag type(s) deleted`, 'success');
      if (selected && checkedIds.has(selected.id)) setSelected(null);
      setCheckedIds(new Set());
      setConfirmBulk(false);
      load();
    } catch (e) {
      toastApiFailure(e, 'Tag types');
    } finally {
      setDeleting(false);
    }
  };

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
      setCheckedIds((cur) => { const next = new Set(cur); next.delete(id); return next; });
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
        <CheckableMasterList
          title="Tag Type List"
          items={items}
          selectedId={selected?.id}
          onSelect={setSelected}
          checkedIds={checkedIds}
          onCheckedChange={setCheckedIds}
          onBulkDelete={() => setConfirmBulk(true)}
          emptyLabel="No tag types yet"
        />

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

      {confirmBulk && (
        <ConfirmModal
          title="Delete tag types"
          message={`Delete ${checkedIds.size} selected tag type${checkedIds.size !== 1 ? 's' : ''}? This cannot be undone.`}
          subMessage="Assets using these tag types will have their Tag Type cleared."
          confirmLabel={deleting ? 'Deleting…' : 'Delete'}
          onConfirm={bulkRemove}
          onCancel={() => { if (!deleting) setConfirmBulk(false); }}
        />
      )}

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

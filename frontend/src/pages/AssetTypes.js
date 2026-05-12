import React, { useEffect, useState } from 'react';
import {
  getAssetTypes, createAssetType, updateAssetType, deleteAssetType,
  getAttributes, createAttribute, updateAttribute, deleteAttribute
} from '../api';
import { useToast } from '../Toast';

const ATTR_TYPES = ['string', 'double', 'date', 'list'];

// ── Attribute Row ──────────────────────────────────────────────
function AttributeRow({ attr, typeId, onSaved, onDeleted, canModify, canDelete }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: attr.name, attr_type: attr.attr_type, default_value: attr.default_value || '', list_options: (attr.list_options || []).map(o => o.option_value) });
  const [newOption, setNewOption] = useState('');
  const { showToast } = useToast();

  const save = async () => {
    if (!canModify) { showToast('You do not have permission to modify asset types', 'error'); return; }
    await updateAttribute(typeId, attr.id, form);
    setEditing(false);
    showToast('Attribute updated', 'success');
    onSaved();
  };
  const remove = async () => {
    if (!canDelete) { showToast('You do not have permission to delete asset types', 'error'); return; }
    if (window.confirm('Delete this attribute?')) {
      await deleteAttribute(typeId, attr.id);
      showToast('Attribute deleted', 'success');
      onDeleted();
    }
  };
  const addOption = () => { if (newOption.trim()) { setForm({ ...form, list_options: [...form.list_options, newOption.trim()] }); setNewOption(''); } };
  const removeOption = (i) => setForm({ ...form, list_options: form.list_options.filter((_, idx) => idx !== i) });

  if (!editing) return (
    <div className="attr-row">
      <span className="attr-name">{attr.name}</span>
      <span className="attr-type-badge">{attr.attr_type}</span>
      {attr.default_value && <span style={{ fontSize: 12, color: '#888' }}>default: {attr.default_value}</span>}
      {attr.attr_type === 'list' && attr.list_options && (
        <span className="attr-options">[{attr.list_options.map(o => o.option_value).join(', ')}]</span>
      )}
      <div className="attr-actions">
        {canModify && <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>Edit</button>}
        {canDelete && <button className="btn btn-danger btn-sm" onClick={remove}>Delete</button>}
      </div>
    </div>
  );

  return (
    <div className="attr-row editing">
      <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Attribute name" />
      <select value={form.attr_type} onChange={e => setForm({ ...form, attr_type: e.target.value, list_options: [], default_value: '' })}>
        {ATTR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      {form.attr_type !== 'list' && (
        <input type={form.attr_type === 'double' ? 'number' : form.attr_type === 'date' ? 'date' : 'text'}
          value={form.default_value} onChange={e => setForm({ ...form, default_value: e.target.value })}
          placeholder="Default value (optional)" style={{ maxWidth: 160 }} />
      )}
      {form.attr_type === 'list' && (
        <div className="list-options-editor">
          {form.list_options.map((o, i) => (
            <span key={i} className="list-option-tag">{o} <button onClick={() => removeOption(i)}>×</button></span>
          ))}
          <div className="list-option-input">
            <input value={newOption} onChange={e => setNewOption(e.target.value)} placeholder="Add option..." onKeyDown={e => e.key === 'Enter' && addOption()} />
            <button className="btn btn-secondary btn-sm" onClick={addOption}>Add</button>
          </div>
        </div>
      )}
      <div className="attr-actions">
        <button className="btn btn-primary btn-sm" onClick={save}>Save</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
  );
}

// ── Add Attribute Form ─────────────────────────────────────────
function AddAttributeForm({ typeId, onSaved }) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: '', attr_type: 'string', default_value: '', list_options: [] });
  const [newOption, setNewOption] = useState('');
  const { showToast } = useToast();

  const addOption = () => { if (newOption.trim()) { setForm({ ...form, list_options: [...form.list_options, newOption.trim()] }); setNewOption(''); } };
  const removeOption = (i) => setForm({ ...form, list_options: form.list_options.filter((_, idx) => idx !== i) });
  const save = async () => {
    if (!form.name.trim()) return;
    await createAttribute(typeId, form);
    showToast('Attribute added', 'success');
    setForm({ name: '', attr_type: 'string', default_value: '', list_options: [] });
    setShow(false); onSaved();
  };

  if (!show) return <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => setShow(true)}>+ Add Attribute</button>;

  return (
    <div className="attr-row editing" style={{ marginTop: 8 }}>
      <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Attribute name" />
      <select value={form.attr_type} onChange={e => setForm({ ...form, attr_type: e.target.value, list_options: [], default_value: '' })}>
        {ATTR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      {form.attr_type !== 'list' && (
        <input type={form.attr_type === 'double' ? 'number' : form.attr_type === 'date' ? 'date' : 'text'}
          value={form.default_value} onChange={e => setForm({ ...form, default_value: e.target.value })}
          placeholder="Default value (optional)" style={{ maxWidth: 160 }} />
      )}
      {form.attr_type === 'list' && (
        <div className="list-options-editor">
          {form.list_options.map((o, i) => (
            <span key={i} className="list-option-tag">{o} <button onClick={() => removeOption(i)}>×</button></span>
          ))}
          <div className="list-option-input">
            <input value={newOption} onChange={e => setNewOption(e.target.value)} placeholder="Add option..." onKeyDown={e => e.key === 'Enter' && addOption()} />
            <button className="btn btn-secondary btn-sm" onClick={addOption}>Add</button>
          </div>
        </div>
      )}
      <div className="attr-actions">
        <button className="btn btn-primary btn-sm" onClick={save}>Save</button>
        <button className="btn btn-secondary btn-sm" onClick={() => setShow(false)}>Cancel</button>
      </div>
    </div>
  );
}

// ── Asset Type Card (with attributes + sub-types) ──────────────
function AssetTypeCard({ item, allTypes, onEdit, onDelete, onAddSub, level = 0, canModify, canDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [attrs, setAttrs] = useState([]);

  const loadAttrs = async () => {
    const r = await getAttributes(item.id);
    setAttrs(r.data);
  };

  useEffect(() => { if (expanded) loadAttrs(); }, [expanded]);

  const children = allTypes.filter(t => t.parent_id === item.id);

  return (
    <div style={{ marginLeft: level * 24, marginBottom: 8 }}>
      <div className="type-card">
        <div className="type-card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {level > 0 && <span style={{ color: '#7c8cf8', fontSize: 12 }}>{'└─'}</span>}
            <div>
              <strong style={{ fontSize: level === 0 ? 15 : 14 }}>{item.name}</strong>
              {item.parent_name && level === 0 && (
                <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>sub of {item.parent_name}</span>
              )}
              {item.description && <span style={{ color: '#888', marginLeft: 8, fontSize: 13 }}>{item.description}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => { setExpanded(!expanded); }}>
              {expanded ? 'Hide Attrs' : 'Attributes'}
            </button>
            {canModify && <button className="btn btn-secondary btn-sm" onClick={() => onAddSub(item.id)}>+ Sub Type</button>}
            {canModify && <button className="btn btn-secondary btn-sm" onClick={() => onEdit(item)}>Edit</button>}
            {canDelete && <button className="btn btn-danger btn-sm" onClick={() => onDelete(item.id)}>Delete</button>}
          </div>
        </div>

        {expanded && (
          <div className="attr-list">
            {attrs.length === 0 && <p style={{ color: '#aaa', fontSize: 13 }}>No attributes yet.</p>}
            {attrs.map(attr => (
              <AttributeRow key={attr.id} attr={attr} typeId={item.id} onSaved={loadAttrs} onDeleted={loadAttrs} canModify={canModify} canDelete={canDelete} />
            ))}
            {canModify && <AddAttributeForm typeId={item.id} onSaved={loadAttrs} />}
          </div>
        )}
      </div>

      {children.map(child => (
        <AssetTypeCard key={child.id} item={child} allTypes={allTypes}
          onEdit={onEdit} onDelete={onDelete} onAddSub={onAddSub} level={level + 1}
          canModify={canModify} canDelete={canDelete} />
      ))}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────
export default function AssetTypes() {
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', parent_id: '' });
  const [editing, setEditing] = useState(null);
  const { showToast } = useToast();

  const currentUser = (() => { try { return JSON.parse(sessionStorage.getItem('rfid_user') || 'null'); } catch { return null; } })();
  const isSuperAdmin = currentUser?.profile_type === 'super_admin';
  const canModify = isSuperAdmin || !!currentUser?.asset_type_can_modify;
  const canDelete = isSuperAdmin || !!currentUser?.asset_type_can_delete;

  const load = () => getAssetTypes().then(r => setItems(r.data));
  useEffect(() => { load(); }, []);

  const openAdd = (parentId = '') => {
    setForm({ name: '', description: '', parent_id: parentId });
    setEditing(null); setModal(true);
  };

  const openEdit = (item) => {
    setForm({ name: item.name, description: item.description || '', parent_id: item.parent_id || '' });
    setEditing(item.id); setModal(true);
  };

  const save = async () => {
    try {
      if (editing) { await updateAssetType(editing, form); showToast('Asset type updated', 'success'); }
      else { await createAssetType(form); showToast('Asset type added', 'success'); }
    } catch (e) {
      const msg = e.response?.data?.message || 'Save failed';
      showToast(msg, 'error');
      return;
    }
    setModal(false); load();
  };

  const remove = async (id) => {
    if (!canDelete) { showToast('You do not have permission to delete asset types', 'error'); return; }
    if (window.confirm('Delete this asset type?')) {
      await deleteAssetType(id);
      showToast('Asset type deleted', 'success');
      load();
    }
  };

  const rootTypes = items.filter(t => !t.parent_id);

  return (
    <div>
      <div className="page-header">
        <h1>Asset Types</h1>
        {canModify && <button className="btn btn-primary" onClick={() => openAdd()}>+ Add Asset Type</button>}
      </div>

      <div className="type-cards">
        {rootTypes.length === 0 && (
          <div style={{ textAlign: 'center', color: '#aaa', padding: 32 }}>No asset types yet.</div>
        )}
        {rootTypes.map(item => (
          <AssetTypeCard key={item.id} item={item} allTypes={items}
            onEdit={openEdit} onDelete={remove} onAddSub={(parentId) => openAdd(parentId)}
            canModify={canModify} canDelete={canDelete} />
        ))}
      </div>

      {modal && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>{editing ? 'Edit Asset Type' : form.parent_id ? 'Add Sub Asset Type' : 'Add Asset Type'}</h2>
            {form.parent_id && (
              <div style={{ fontSize: 13, color: '#7c8cf8', marginBottom: 12, background: '#f0f2ff', padding: '6px 10px', borderRadius: 6 }}>
                Sub type of: <strong>{items.find(t => t.id === parseInt(form.parent_id))?.name}</strong>
              </div>
            )}
            <div className="form-group">
              <label>Name</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Canon Printer" />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Parent Asset Type</label>
              <select value={form.parent_id} onChange={e => setForm({ ...form, parent_id: e.target.value })}>
                <option value="">— None (top level) —</option>
                {items.filter(t => t.id !== editing).map(t => (
                  <option key={t.id} value={t.id}>{t.parent_name ? `${t.parent_name} › ${t.name}` : t.name}</option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

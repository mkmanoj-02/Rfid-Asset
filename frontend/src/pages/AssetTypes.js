import React, { useEffect, useMemo, useState } from 'react';
import {
  getAssetTypes, createAssetTypeMultipart, updateAssetTypeMultipart, deleteAssetType,
  getAttributes, createAttribute, updateAttribute, deleteAttribute
} from '../api';
import { ChevronRight, ChevronDown, Layers, Pencil, Trash2, Plus, List, Search } from 'lucide-react';
import { useToast } from '../Toast';
import { toastApiFailure } from '../apiErrorHandling';
import ImageUploadField from '../components/ImageUploadField';
import { resolveImageUrl } from '../utils/imageUrl';

const ATTR_TYPES = ['string', 'double', 'date', 'list'];

function matchesAssetTypeQuery(item, q) {
  if (!q) return true;
  const hay = [item.name || '', item.description || '', item.parent_name || ''].join(' ').toLowerCase();
  return hay.includes(q);
}

/** Include this type if it matches `q` or any descendant matches (recursive). */
function visibleInAssetTypeSearch(item, allTypes, q) {
  if (!q) return true;
  if (matchesAssetTypeQuery(item, q)) return true;
  return allTypes
    .filter(t => t.parent_id === item.id)
    .some(c => visibleInAssetTypeSearch(c, allTypes, q));
}

// ── Confirm Dialog (same pattern as Assets delete modal) ────────
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
        <div style={{
          height: 5,
          background: confirmStyle === 'danger'
            ? 'linear-gradient(90deg,#ef4444,#dc2626)'
            : 'linear-gradient(90deg,#1565c0,#1976d2)',
        }} />
        <div style={{ padding: '28px 28px 24px' }}>
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
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
            <button type="button" className="btn btn-secondary" onClick={onCancel} style={{ minWidth: 90 }}>Cancel</button>
            <button
              type="button"
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

/** Single-action dialog (replaces browser `alert` for messages). */
function InfoModal({ title, message, onClose }) {
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
        <div style={{ height: 5, background: 'linear-gradient(90deg,#2563EB,#1d4ed8)' }} />
        <div style={{ padding: '28px 28px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
            <div style={{
              width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#eff6ff', fontSize: 22,
            }}>ℹ️</div>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: '#111827', margin: 0 }}>{title}</h3>
          </div>
          <p style={{ fontSize: 14, color: '#374151', margin: 0, lineHeight: 1.6 }}>{message}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
            <button type="button" className="btn btn-primary" onClick={onClose} style={{ minWidth: 90 }}>OK</button>
          </div>
        </div>
      </div>
      <style>{`@keyframes confirmPop { from { opacity:0; transform:scale(0.93) translateY(10px); } to { opacity:1; transform:scale(1) translateY(0); } }`}</style>
    </div>
  );
}

// ── Attribute Row ──────────────────────────────────────────────
function AttributeRow({ attr, typeId, onSaved, onRequestDelete, showInfo, canModify, canDelete }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: attr.name, attr_type: attr.attr_type, default_value: attr.default_value || '', list_options: (attr.list_options || []).map(o => o.option_value) });
  const [newOption, setNewOption] = useState('');
  const { showToast } = useToast();

  const save = async () => {
    if (!canModify) { showToast('You do not have permission to modify asset types', 'error'); return; }
    if (!form.name.trim()) {
      showInfo('Missing name', 'Please enter an attribute name before saving.');
      return;
    }
    try {
      await updateAttribute(typeId, attr.id, form);
      setEditing(false);
      showToast('Attribute updated', 'success');
      onSaved();
    } catch (e) {
      showInfo('Save failed', e.response?.data?.message || e.message || 'Could not update attribute.');
    }
  };
  const requestRemove = () => {
    if (!canDelete) { showToast('You do not have permission to delete asset types', 'error'); return; }
    onRequestDelete();
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
        {canDelete && <button type="button" className="btn btn-danger btn-sm" onClick={requestRemove}>Delete</button>}
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
function AddAttributeForm({ typeId, onSaved, showInfo }) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ name: '', attr_type: 'string', default_value: '', list_options: [] });
  const [newOption, setNewOption] = useState('');
  const { showToast } = useToast();

  const addOption = () => { if (newOption.trim()) { setForm({ ...form, list_options: [...form.list_options, newOption.trim()] }); setNewOption(''); } };
  const removeOption = (i) => setForm({ ...form, list_options: form.list_options.filter((_, idx) => idx !== i) });
  const save = async () => {
    if (!form.name.trim()) {
      showInfo?.('Attribute name required', 'Please enter a name before saving.');
      return;
    }
    try {
      await createAttribute(typeId, form);
      showToast('Attribute added', 'success');
      setForm({ name: '', attr_type: 'string', default_value: '', list_options: [] });
      setShow(false);
      onSaved();
    } catch (e) {
      showInfo?.('Save failed', e.response?.data?.message || e.message || 'Could not add attribute.');
    }
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

function AssetTypeThumb({ imageUrl, name }) {
  const [broken, setBroken] = useState(false);
  if (!imageUrl || broken) {
    return (
      <div className="asset-type-thumb" aria-hidden>
        <Layers size={18} strokeWidth={1.75} />
      </div>
    );
  }
  return (
    <div className="asset-type-thumb">
      <img
        src={resolveImageUrl(imageUrl)}
        alt={name ? `${name} image` : 'Asset type'}
        onError={() => setBroken(true)}
      />
    </div>
  );
}

// ── Asset Type row (hierarchy table) ───────────────────────────
function AssetTypeRow({
  item,
  allTypes,
  onEdit,
  onDelete,
  onAddSub,
  onAttributeDeleteRequest,
  level = 0,
  canModify,
  canDelete,
  searchQuery = '',
  expandAll = null,
  onManualBranchToggle,
  isLast = false,
}) {
  const [attrsOpen, setAttrsOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [attrs, setAttrs] = useState([]);

  const children = allTypes.filter(
    (t) => t.parent_id === item.id && visibleInAssetTypeSearch(t, allTypes, searchQuery)
  );
  const hasChildren = children.length > 0;
  const childCount = allTypes.filter((t) => t.parent_id === item.id).length;
  const branchExpanded = !!searchQuery
    || (expandAll === true ? true : expandAll === false ? false : branchOpen);

  const loadAttrs = async () => {
    try {
      const r = await getAttributes(item.id);
      setAttrs(r.data);
    } catch (e) {
      toastApiFailure(e, 'Attributes');
      setAttrs([]);
    }
  };

  useEffect(() => {
    if (attrsOpen) loadAttrs();
  }, [attrsOpen]);

  useEffect(() => {
    if (searchQuery) setBranchOpen(true);
  }, [searchQuery]);

  useEffect(() => {
    if (expandAll === true) setBranchOpen(true);
    else if (expandAll === false) setBranchOpen(false);
  }, [expandAll]);

  const depth = Math.min(level, 3);
  const depthClass = `asset-type-row--depth-${depth}`;
  const parentItem = level > 0 ? allTypes.find((t) => t.id === item.parent_id) : null;

  return (
    <li
      className={`asset-type-tree-item ${isLast ? 'asset-type-tree-item--last' : ''} ${level === 0 ? 'asset-type-tree-item--root' : ''} ${hasChildren && branchExpanded ? 'asset-type-tree-item--branch-open' : ''}`}
    >
      <div className="asset-type-row-wrap">
        <div className={`asset-type-row ${depthClass} ${hasChildren ? 'asset-type-row--parent' : ''}`}>
        <div className="asset-type-tree-col">
          {hasChildren ? (
            <button
              type="button"
              className={`asset-type-expand-btn ${branchExpanded ? 'is-open' : ''}`}
              onClick={() => {
                if (expandAll !== null) onManualBranchToggle?.();
                setBranchOpen((o) => !o);
              }}
              aria-expanded={branchExpanded}
              aria-label={branchExpanded ? 'Collapse sub-types' : 'Expand sub-types'}
              title={branchExpanded ? 'Collapse sub-types' : 'Expand sub-types'}
            >
              {branchExpanded ? <ChevronDown size={16} strokeWidth={2.5} /> : <ChevronRight size={16} strokeWidth={2.5} />}
            </button>
          ) : (
            <span className="asset-type-tree-leaf" aria-hidden />
          )}
        </div>

        <div className="asset-type-row-lead">
          <AssetTypeThumb imageUrl={item.image_url} name={item.name} />
          <div className="asset-type-info">
            <div className="asset-type-name-row">
              <span className="asset-type-name" title={item.name}>{item.name}</span>
              {level === 0 ? (
                <span className="asset-type-level-tag asset-type-level-tag--root">Root</span>
              ) : (
                <span className="asset-type-level-tag asset-type-level-tag--child">Level {level + 1}</span>
              )}
            </div>
            {item.description ? (
              <span className="asset-type-desc" title={item.description}>{item.description}</span>
            ) : level > 0 && (parentItem?.name || item.parent_name) ? (
              <span className="asset-type-desc asset-type-desc--parent">
                Under <strong>{parentItem?.name || item.parent_name}</strong>
              </span>
            ) : null}
          </div>
        </div>

        <div className="asset-type-row-end">
          {childCount > 0 && (
            <span className="asset-type-meta-pill asset-type-meta-pill--subs">{childCount} sub-type{childCount !== 1 ? 's' : ''}</span>
          )}
          <div className="asset-type-actions">
            <button
              type="button"
              className={`asset-type-icon-btn ${attrsOpen ? 'asset-type-icon-btn--attrs-active' : ''}`}
              title="Attributes"
              onClick={() => setAttrsOpen((o) => !o)}
              aria-expanded={attrsOpen}
            >
              <List size={16} />
            </button>
            {canModify && (
              <button type="button" className="asset-type-icon-btn asset-type-icon-btn--primary" title="Add sub-type" onClick={() => onAddSub(item.id)}>
                <Plus size={16} />
              </button>
            )}
            {canModify && (
              <button type="button" className="asset-type-icon-btn" title="Edit" onClick={() => onEdit(item)}>
                <Pencil size={15} />
              </button>
            )}
            {canDelete && (
              <button type="button" className="asset-type-icon-btn asset-type-icon-btn--danger" title="Delete" onClick={() => onDelete(item.id)}>
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>
        </div>

        {branchExpanded && children.length > 0 && (
          <div className="asset-type-tree-children">
            <ul className="asset-type-tree-list">
              {children.map((child, idx) => (
                <AssetTypeRow
                  key={child.id}
                  item={child}
                  allTypes={allTypes}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onAddSub={onAddSub}
                  onAttributeDeleteRequest={onAttributeDeleteRequest}
                  level={level + 1}
                  canModify={canModify}
                  canDelete={canDelete}
                  searchQuery={searchQuery}
                  expandAll={expandAll}
                  onManualBranchToggle={onManualBranchToggle}
                  isLast={idx === children.length - 1}
                />
              ))}
            </ul>
          </div>
        )}

        {attrsOpen && (
          <div className="asset-type-attrs-panel">
            {attrs.length === 0 && (
              <p style={{ color: '#94a3b8', fontSize: 13, margin: '0 0 10px' }}>No attributes defined yet.</p>
            )}
            {attrs.map((attr) => (
              <AttributeRow
                key={attr.id}
                attr={attr}
                typeId={item.id}
                onSaved={loadAttrs}
                onRequestDelete={() => onAttributeDeleteRequest(item.id, attr, loadAttrs)}
                canModify={canModify}
                canDelete={canDelete}
              />
            ))}
            {canModify && <AddAttributeForm typeId={item.id} onSaved={loadAttrs} />}
          </div>
        )}
      </div>
    </li>
  );
}

// ── Main Page ──────────────────────────────────────────────────
export default function AssetTypes() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', parent_id: '' });
  const [editing, setEditing] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [expandAll, setExpandAll] = useState(null);
  const { showToast } = useToast();

  const currentUser = (() => { try { return JSON.parse(sessionStorage.getItem('rfid_user') || 'null'); } catch { return null; } })();
  const isSuperAdmin = currentUser?.profile_type === 'super_admin';
  const canModify = isSuperAdmin || !!currentUser?.asset_type_can_modify;
  const canDelete = isSuperAdmin || !!currentUser?.asset_type_can_delete;

  const load = () => getAssetTypes().then(r => setItems(r.data)).catch((e) => toastApiFailure(e, 'Asset types'));
  useEffect(() => { load(); }, []);

  const openAdd = (parentId = '') => {
    setForm({ name: '', description: '', parent_id: parentId });
    setEditing(null);
    setImageFile(null);
    setRemoveImage(false);
    setModal(true);
  };

  const openEdit = (item) => {
    setForm({ name: item.name, description: item.description || '', parent_id: item.parent_id || '' });
    setEditing(item.id);
    setImageFile(null);
    setRemoveImage(false);
    setModal(true);
  };

  const editingItem = editing ? items.find(t => t.id === editing) : null;
  const typePreviewUrl = editingItem?.image_url ? resolveImageUrl(editingItem.image_url) : null;

  const save = async () => {
    if (!form.name?.trim()) {
      showToast('Name is required', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateAssetTypeMultipart(editing, form, imageFile, { removeImage });
        showToast('Asset type updated', 'success');
      } else {
        await createAssetTypeMultipart(form, imageFile);
        showToast('Asset type added', 'success');
      }
      setModal(false);
      load();
    } catch (e) {
      showToast(e.response?.data?.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const openAttributeDeleteConfirm = (typeId, attr, reloadAttrs) => {
    setConfirmDialog({
      title: 'Delete Attribute',
      message: `Are you sure you want to delete the attribute "${attr.name}"?`,
      subMessage: 'This action cannot be undone. All values saved on assets for this attribute will also be removed.',
      confirmLabel: 'Delete',
      confirmStyle: 'danger',
      onConfirm: async () => {
        try {
          await deleteAttribute(typeId, attr.id);
          showToast('Attribute deleted', 'success');
          reloadAttrs();
        } catch (e) {
          showToast(e.response?.data?.message || 'Delete failed', 'error');
        }
      },
    });
  };

  const removeAssetType = (id) => {
    if (!canDelete) { showToast('You do not have permission to delete asset types', 'error'); return; }
    const item = items.find(t => t.id === id);
    setConfirmDialog({
      title: 'Delete Asset Type',
      message: item?.name
        ? `Are you sure you want to delete «${item.name}»?`
        : 'Are you sure you want to delete this asset type?',
      subMessage: 'This action cannot be undone. Sub-types, attributes, and assets using this type may be affected.',
      confirmLabel: 'Delete',
      confirmStyle: 'danger',
      onConfirm: async () => {
        try {
          await deleteAssetType(id);
          showToast('Asset type deleted', 'success');
          load();
        } catch (e) {
          showToast(e.response?.data?.message || 'Delete failed', 'error');
        }
      },
    });
  };

  const searchQuery = search.trim().toLowerCase();
  const rootTypes = useMemo(
    () => items.filter(t => !t.parent_id && visibleInAssetTypeSearch(t, items, searchQuery)),
    [items, searchQuery],
  );
  const visibleTypeCount = useMemo(
    () => items.filter(t => visibleInAssetTypeSearch(t, items, searchQuery)).length,
    [items, searchQuery],
  );

  return (
    <div>
      <div className="page-header">
        <h1>Asset Types</h1>
        {canModify && <button className="btn btn-primary" onClick={() => openAdd()}>+ Add Asset Type</button>}
      </div>

      <div className="asset-types-panel" style={{ marginBottom: 16 }}>
        <div className="asset-types-toolbar">
          <div className="asset-types-toolbar-search">
            <span className="asset-types-toolbar-search-icon" aria-hidden><Search size={16} /></span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, description, parent…" aria-label="Search asset types" />
          </div>
          <div className="asset-types-toolbar-links">
            <button type="button" onClick={() => setExpandAll(true)}>Expand all</button>
            <button type="button" onClick={() => setExpandAll(false)}>Collapse all</button>
          </div>
          <span className="asset-types-toolbar-meta">
            {searchQuery ? `${visibleTypeCount} matching type${visibleTypeCount !== 1 ? 's' : ''}` : `${items.length} type${items.length !== 1 ? 's' : ''}`}
          </span>
        </div>
        <div className="asset-types-shell">
          <div className="asset-types-table-head">
            <span>Hierarchy / Type</span>
            <span>Actions</span>
          </div>
          <div className="asset-types-body">
            {items.length === 0 && (
              <div className="asset-types-empty">
                <Layers size={40} strokeWidth={1.25} color="#cbd5e1" />
                <p className="asset-types-empty-title">No asset types yet</p>
                <p className="asset-types-empty-hint">Add a top-level type to organize your assets.</p>
              </div>
            )}
            {items.length > 0 && rootTypes.length === 0 && searchQuery && (
              <div className="asset-types-empty">
                <Search size={40} strokeWidth={1.25} color="#cbd5e1" />
                <p className="asset-types-empty-title">No matches</p>
                <p className="asset-types-empty-hint">Try a different search term.</p>
              </div>
            )}
            <ul className="asset-type-tree-root">
              {rootTypes.map((item, idx) => (
                <AssetTypeRow
                  key={item.id}
                  item={item}
                  allTypes={items}
                  onEdit={openEdit}
                  onDelete={removeAssetType}
                  onAddSub={(parentId) => openAdd(parentId)}
                  onAttributeDeleteRequest={openAttributeDeleteConfirm}
                  canModify={canModify}
                  canDelete={canDelete}
                  searchQuery={searchQuery}
                  expandAll={expandAll}
                  onManualBranchToggle={() => setExpandAll(null)}
                  isLast={idx === rootTypes.length - 1}
                />
              ))}
            </ul>
          </div>
        </div>
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
            <div className="form-group" style={{ marginTop: 16 }}>
              <ImageUploadField
                label="Default type image"
                previewUrl={!imageFile && !removeImage ? typePreviewUrl : null}
                sourceLabel={imageFile ? 'New upload' : (typePreviewUrl ? 'Current image' : null)}
                file={imageFile}
                onFileChange={(f) => { setImageFile(f); setRemoveImage(false); }}
                onClear={() => { setImageFile(null); setRemoveImage(true); }}
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setModal(false)} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
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
    </div>
  );
}

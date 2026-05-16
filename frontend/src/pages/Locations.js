import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  getLocationTree, getLocations, createLocationMultipart, updateLocationMultipart, deleteLocation,
  getLocationTypes, createLocationType, updateLocationType, deleteLocationType,
} from '../api';
import { useToast } from '../Toast';
import { toastApiFailure } from '../apiErrorHandling';
import ImageUploadField from '../components/ImageUploadField';
import { resolveImageUrl } from '../utils/imageUrl';

function locationNodeMatches(node, q) {
  if (!q) return true;
  const hay = [node.name || '', node.location_type_name || '', node.description || '', node.parent_name || ''].join(' ').toLowerCase();
  return hay.includes(q);
}

/** Return tree nodes that match `q` or contain a matching descendant (structure preserved). */
function filterLocationTree(nodes, q) {
  if (!q) return nodes || [];
  const walk = (list) => {
    if (!list || !list.length) return [];
    const out = [];
    for (const node of list) {
      const children = walk(node.children);
      if (locationNodeMatches(node, q) || children.length) {
        out.push({ ...node, children });
      }
    }
    return out;
  };
  return walk(nodes || []);
}

// ── Tree Node ──────────────────────────────────────────────────
function TreeNode({ node, selectedId, onSelect, level = 0 }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  return (
    <div>
      <div className={`tree-node ${selectedId === node.id ? 'selected' : ''}`}
        style={{ paddingLeft: 12 + level * 20 }} onClick={() => onSelect(node)}>
        {hasChildren
          ? <span className="tree-toggle" onClick={e => { e.stopPropagation(); setExpanded(!expanded); }}>{expanded ? '▾' : '▸'}</span>
          : <span style={{ display: 'inline-block', width: 16 }} />}
        <span>{node.name}</span>
        {node.location_type_name && (
          <span style={{ marginLeft: 6, fontSize: 11, background: '#e9ecff', color: '#5a67d8', padding: '1px 6px', borderRadius: 8 }}>
            {node.location_type_name}
          </span>
        )}
      </div>
      {expanded && hasChildren && node.children.map(child => (
        <TreeNode key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} level={level + 1} />
      ))}
    </div>
  );
}

function LocationPageEmpty({ icon, title, hint }) {
  return (
    <div className="empty-state" role="status">
      <div className="empty-state-icon" aria-hidden>{icon}</div>
      <p className="empty-state-title">{title}</p>
      <p className="empty-state-hint">{hint}</p>
    </div>
  );
}

// ── Manage Location Tab ────────────────────────────────────────
function ManageLocations() {
  const [tree, setTree] = useState([]);
  const [flatList, setFlatList] = useState([]);
  const [locationTypes, setLocationTypes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', parent_id: '', location_type_id: '' });
  const [editing, setEditing] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manageSearch, setManageSearch] = useState('');
  const { showToast } = useToast();

  const manageQuery = manageSearch.trim().toLowerCase();
  const filteredTree = useMemo(() => filterLocationTree(tree, manageQuery), [tree, manageQuery]);

  const currentUser = (() => { try { return JSON.parse(sessionStorage.getItem('rfid_user') || 'null'); } catch { return null; } })();
  const isSuperAdmin = currentUser?.profile_type === 'super_admin';
  const canModify = isSuperAdmin || !!currentUser?.location_can_modify;
  const canDelete = isSuperAdmin || !!currentUser?.location_can_delete;

  const load = async () => {
    try {
      const [treeRes, flatRes, typesRes] = await Promise.all([getLocationTree(), getLocations(), getLocationTypes()]);
      setTree(treeRes.data);
      setFlatList(flatRes.data);
      setLocationTypes(typesRes.data);
      if (selected) {
        const updated = flatRes.data.find(l => l.id === selected.id);
        setSelected(updated || null);
      }
    } catch (e) {
      toastApiFailure(e, 'Locations');
    }
  };

  useEffect(() => { load(); }, []);

  const openAdd = (parentId = '') => {
    setForm({ name: '', description: '', parent_id: parentId, location_type_id: '' });
    setEditing(null);
    setImageFile(null);
    setRemoveImage(false);
    setModal(true);
  };

  const openEdit = (item) => {
    setForm({
      name: item.name,
      description: item.description || '',
      parent_id: item.parent_id || '',
      location_type_id: item.location_type_id || '',
    });
    setEditing(item.id);
    setImageFile(null);
    setRemoveImage(false);
    setModal(true);
  };

  const editingItem = editing ? flatList.find(l => l.id === editing) : null;
  const locationPreviewUrl = editingItem?.image_url && !removeImage
    ? resolveImageUrl(editingItem.image_url)
    : null;

  const save = async () => {
    if (!form.name?.trim()) {
      showToast('Location name is required', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateLocationMultipart(editing, form, imageFile, { removeImage });
        showToast('Location updated', 'success');
      } else {
        await createLocationMultipart(form, imageFile);
        showToast('Location added', 'success');
      }
      setModal(false);
      load();
    } catch (e) {
      showToast(e.response?.data?.message || 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this location and all its children?')) return;
    try {
      await deleteLocation(id);
      showToast('Location deleted', 'success');
      if (selected?.id === id) setSelected(null);
      load();
    } catch (e) {
      toastApiFailure(e, 'Delete location');
    }
  };

  const children = selected ? flatList.filter(l => l.parent_id === selected.id) : [];
  const filteredChildren = useMemo(() => {
    if (!manageQuery) return children;
    return children.filter(c => locationNodeMatches(c, manageQuery));
  }, [children, manageQuery]);

  return (
    <div className="locations-layout">
      <div className="location-tree-panel">
        <div className="panel-header">
          <span>Locations</span>
          {canModify && <button className="btn btn-primary btn-sm" onClick={() => openAdd()}>+ Add</button>}
        </div>
        <div style={{ padding: '8px 10px', borderBottom: '1px solid #e2e8f0', background: '#fafbfc' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none', display: 'flex' }}>
              <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
              </svg>
            </span>
            <input
              value={manageSearch}
              onChange={e => setManageSearch(e.target.value)}
              placeholder="Search tree & sub-locations…"
              style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px 6px 28px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12 }}
            />
          </div>
          {manageQuery && (
            <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 6, width: '100%' }} onClick={() => setManageSearch('')}>Clear search</button>
          )}
        </div>
        <div className="tree-container">
          {tree.length === 0 && <p style={{ color: '#aaa', padding: 12, fontSize: 13 }}>No locations yet.</p>}
          {tree.length > 0 && filteredTree.length === 0 && manageQuery && (
            <p style={{ color: '#aaa', padding: 12, fontSize: 13 }}>No locations match your search.</p>
          )}
          {filteredTree.map(node => (
            <TreeNode key={node.id} node={node} selectedId={selected?.id} onSelect={setSelected} />
          ))}
        </div>
      </div>

      <div className="location-detail-panel">
        {!selected ? (
          <LocationPageEmpty
            title="Select a location from the tree to view details"
            hint="Choose a location in the tree on the left to see its details, sub-locations, and actions."
            icon={(
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 21s-8-4.5-8-11a8 8 0 1116 0c0 6.5-8 11-8 11z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            )}
          />
        ) : (
          <div className="location-detail-body">
            <div className="page-header">
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              {selected.image_url && (
                <img
                  src={resolveImageUrl(selected.image_url)}
                  alt={selected.name}
                  style={{ width: 100, height: 75, objectFit: 'cover', borderRadius: 8, border: '1px solid #e2e8f0' }}
                />
              )}
              <div>
                <h1>{selected.name}</h1>
                {selected.location_type_name && (
                  <span style={{ fontSize: 12, background: '#e9ecff', color: '#5a67d8', padding: '2px 8px', borderRadius: 8, marginRight: 8 }}>
                    {selected.location_type_name}
                  </span>
                )}
                {selected.parent_name && <p style={{ color: '#888', fontSize: 13, marginTop: 4 }}>Parent: {selected.parent_name}</p>}
                {selected.description && <p style={{ color: '#555', marginTop: 4 }}>{selected.description}</p>}
              </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {canModify && <button className="btn btn-primary" onClick={() => openAdd(selected.id)}>+ Add Child</button>}
                {canModify && <button className="btn btn-secondary" onClick={() => openEdit(selected)}>Edit</button>}
                {canDelete && <button className="btn btn-danger" onClick={() => remove(selected.id)}>Delete</button>}
              </div>
            </div>
            <h3 style={{ marginBottom: 12, fontSize: 15, color: '#555' }}>Sub-locations</h3>
            {children.length === 0 ? <p style={{ color: '#aaa' }}>No sub-locations.</p> : filteredChildren.length === 0 ? (
              <p style={{ color: '#aaa' }}>No sub-locations match your search.</p>
            ) : (
              <table>
                <thead><tr><th>Name</th><th>Type</th><th>Description</th><th>Actions</th></tr></thead>
                <tbody>
                  {filteredChildren.map(child => (
                    <tr key={child.id}>
                      <td><span style={{ cursor: 'pointer', color: '#7c8cf8' }} onClick={() => setSelected(child)}>{child.name}</span></td>
                      <td><span style={{ fontSize: 12, background: '#e9ecff', color: '#5a67d8', padding: '1px 6px', borderRadius: 8 }}>{child.location_type_name || '—'}</span></td>
                      <td>{child.description || '—'}</td>
                      <td>
                        {canModify && <button className="btn btn-secondary btn-sm" style={{ marginRight: 6 }} onClick={() => openEdit(child)}>Edit</button>}
                        {canDelete && <button className="btn btn-danger btn-sm" onClick={() => remove(child.id)}>Delete</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {modal && (
        <div className="modal-overlay">
          <div className="modal location-form-modal">
            <h2>{editing ? 'Edit Location' : 'Add Location'}</h2>
            <div className="location-form-body">
            <div className="form-group">
              <label>Location Name <span style={{ color: '#e53e3e' }}>*</span></label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Enter location name" />
            </div>
            <div className="form-group">
              <label>Location Type</label>
              <select value={form.location_type_id} onChange={e => setForm({ ...form, location_type_id: e.target.value })}>
                <option value="">— Select type —</option>
                {locationTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Parent Location</label>
              <select value={form.parent_id} onChange={e => setForm({ ...form, parent_id: e.target.value })}>
                <option value="">— None (top level) —</option>
                {flatList.filter(l => l.id !== editing).map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="form-group" style={{ marginTop: 16 }}>
              <ImageUploadField
                label="Location image"
                previewUrl={!imageFile && !removeImage ? locationPreviewUrl : null}
                sourceLabel={imageFile ? 'New upload' : (locationPreviewUrl ? 'Current image' : null)}
                file={imageFile}
                onFileChange={(f) => { setImageFile(f); setRemoveImage(false); }}
                onClear={() => { setImageFile(null); setRemoveImage(true); }}
              />
            </div>
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
    </div>
  );
}

// ── Location Types Tab ─────────────────────────────────────────
function LocationTypes() {
  const [types, setTypes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [editing, setEditing] = useState(null);
  const [typesSearch, setTypesSearch] = useState('');
  const { showToast } = useToast();

  const currentUser = (() => { try { return JSON.parse(sessionStorage.getItem('rfid_user') || 'null'); } catch { return null; } })();
  const isSuperAdmin = currentUser?.profile_type === 'super_admin';
  const canModify = isSuperAdmin || !!currentUser?.location_type_can_modify;
  const canDelete = isSuperAdmin || !!currentUser?.location_type_can_delete;

  const load = () => getLocationTypes().then(r => {
    setTypes(r.data);
    if (selected) {
      const updated = r.data.find(t => t.id === selected.id);
      setSelected(updated || null);
    }
  }).catch((e) => toastApiFailure(e, 'Location types'));

  useEffect(() => { load(); }, []);

  const typesQuery = typesSearch.trim().toLowerCase();
  const filteredTypes = useMemo(() => {
    if (!typesQuery) return types;
    return types.filter(t => {
      const hay = [t.name || '', t.description || ''].join(' ').toLowerCase();
      return hay.includes(typesQuery);
    });
  }, [types, typesQuery]);

  useEffect(() => {
    if (selected && !filteredTypes.some(t => t.id === selected.id)) setSelected(null);
  }, [filteredTypes, selected]);

  const openAdd = () => { setForm({ name: '', description: '' }); setEditing(null); setModal(true); };
  const openEdit = (item) => { setForm({ name: item.name, description: item.description || '' }); setEditing(item.id); setModal(true); };

  const save = async () => {
    try {
      if (editing) { await updateLocationType(editing, form); showToast('Location type updated', 'success'); }
      else { await createLocationType(form); showToast('Location type added', 'success'); }
    } catch (e) {
      const msg = e.response?.data?.message || 'Save failed';
      showToast(msg, 'error');
      return;
    }
    setModal(false); load();
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this location type?')) return;
    try {
      await deleteLocationType(id);
      showToast('Location type deleted', 'success');
      if (selected?.id === id) setSelected(null);
      load();
    } catch (e) {
      toastApiFailure(e, 'Location types');
    }
  };

  const typesLeftRef = useRef(null);
  const typesRightRef = useRef(null);

  useLayoutEffect(() => {
    const L = typesLeftRef.current;
    const R = typesRightRef.current;
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
  }, [types.length, filteredTypes.length, typesQuery, selected?.id, canModify, canDelete]);

  return (
    <div className="location-types-split">
      <div
        ref={typesLeftRef}
        style={{
          width: 260,
          flexShrink: 0,
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          border: '1px solid #e8edf2',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="panel-header">
          <span>Location Types</span>
          {canModify && <button type="button" className="btn btn-primary btn-sm" onClick={openAdd}>+ Add</button>}
        </div>
        <div style={{ padding: '8px 10px', borderBottom: '1px solid #e2e8f0', background: '#fafbfc' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none', display: 'flex' }}>
              <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
              </svg>
            </span>
            <input
              value={typesSearch}
              onChange={e => setTypesSearch(e.target.value)}
              placeholder="Search name, description…"
              style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px 6px 28px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12 }}
            />
          </div>
          {typesQuery && (
            <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 6, width: '100%' }} onClick={() => setTypesSearch('')}>Clear search</button>
          )}
        </div>
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          {filteredTypes.map(t => (
            <div key={t.id} onClick={() => setSelected(t)}
              style={{ padding: '9px 14px', cursor: 'pointer', fontSize: 14, borderBottom: '1px solid #f7f8fc',
                background: selected?.id === t.id ? '#e9ecff' : 'inherit',
                color: selected?.id === t.id ? '#5a67d8' : '#333',
                fontWeight: selected?.id === t.id ? 600 : 400 }}>
              {t.name}
            </div>
          ))}
          {types.length === 0 && <div style={{ padding: 16, color: '#aaa', fontSize: 13, textAlign: 'center' }}>No types yet</div>}
          {types.length > 0 && filteredTypes.length === 0 && typesQuery && (
            <div style={{ padding: 16, color: '#aaa', fontSize: 13, textAlign: 'center' }}>No types match your search.</div>
          )}
        </div>
      </div>

      <div ref={typesRightRef} className="location-types-main">
        {selected ? (
          <div className="location-types-main-body">
            <div style={{ fontWeight: 700, fontSize: 15, textAlign: 'center', marginBottom: 24, borderBottom: '1px solid #f0f2f5', paddingBottom: 12 }}>
              Location Type Details
            </div>
            {[
              { label: 'Location Type', value: selected.name },
              { label: 'Description', value: selected.description || '—' },
              { label: 'Created', value: new Date(selected.created_at).toLocaleString() },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', fontSize: 14, marginBottom: 14 }}>
                <span style={{ minWidth: 160, fontWeight: 500, color: '#555' }}>{label}</span>
                <span>: {value}</span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24 }}>
              {canModify && <button className="btn btn-secondary btn-sm" onClick={() => openEdit(selected)}>Edit</button>}
              {canDelete && <button className="btn btn-danger btn-sm" onClick={() => remove(selected.id)}>Delete</button>}
            </div>
          </div>
        ) : (
          <LocationPageEmpty
            title="Select a location type to view details"
            hint="Pick a type from the list on the left to view its description and edit or delete options."
            icon={(
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
              </svg>
            )}
          />
        )}
      </div>

      {modal && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>{editing ? 'Edit Location Type' : 'Add Location Type'}</h2>
            <div className="form-group">
              <label>Name <span style={{ color: '#e53e3e' }}>*</span></label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Building, Floor, Room" />
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
    </div>
  );
}

// ── Reorganize Tab ─────────────────────────────────────────────
function ReorganizeLocations() {
  const [flatList, setFlatList] = useState([]);
  const [selectedLocations, setSelectedLocations] = useState([]);
  const [newParentId, setNewParentId] = useState('');
  const [locPickerOpen, setLocPickerOpen] = useState(false);
  const [parentPickerOpen, setParentPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const load = () => getLocations().then(r => setFlatList(r.data)).catch((e) => toastApiFailure(e, 'Locations'));

  useEffect(() => { load(); }, []);

  const toggleSelect = (loc) => {
    setSelectedLocations(prev =>
      prev.find(l => l.id === loc.id) ? prev.filter(l => l.id !== loc.id) : [...prev, loc]
    );
  };

  const update = async () => {
    if (!selectedLocations.length) { toastApiFailure('Please select at least one location.', 'Reorganize'); return; }
    setSaving(true);
    try {
      for (const loc of selectedLocations) {
        await updateLocation(loc.id, { ...loc, parent_id: newParentId || null });
      }
      showToast(`${selectedLocations.length} location(s) moved successfully.`, 'success');
      setSelectedLocations([]);
      setNewParentId('');
      load();
    } catch (e) {
      toastApiFailure(e, 'Reorganize');
    }
    setSaving(false);
  };

  const newParentName = newParentId ? flatList.find(l => l.id == newParentId)?.name : '(Top Level)';

  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', padding: 32 }}>
        <h3 style={{ marginBottom: 24, fontSize: 16, fontWeight: 600 }}>Reorganize Locations</h3>

        {/* Selected Locations */}
        <div className="form-row" style={{ marginBottom: 20 }}>
          <label style={{ minWidth: 160, paddingTop: 8, fontWeight: 500, color: '#555' }}>Selected Location(s) :</label>
          <div className="field-wrap rfid-field">
            <input
              readOnly
              value={selectedLocations.map(l => l.name).join(', ') || ''}
              placeholder="Click ... to select"
              style={{ flex: 1 }}
            />
            <button className="btn btn-secondary btn-sm picker-btn" onClick={() => setLocPickerOpen(true)}>...</button>
          </div>
        </div>

        {/* Move to new parent */}
        <div className="form-row" style={{ marginBottom: 28 }}>
          <label style={{ minWidth: 160, paddingTop: 8, fontWeight: 500, color: '#555' }}>Move to new parent :</label>
          <div className="field-wrap rfid-field">
            <input
              readOnly
              value={newParentId ? (flatList.find(l => l.id == newParentId)?.name || '') : ''}
              placeholder="Click ... to select (blank = top level)"
              style={{ flex: 1 }}
            />
            <button className="btn btn-secondary btn-sm picker-btn" onClick={() => setParentPickerOpen(true)}>...</button>
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <button className="btn btn-primary" onClick={update} disabled={saving} style={{ minWidth: 120 }}>
            {saving ? 'Updating...' : 'Update'}
          </button>
        </div>
      </div>

      {/* Location picker modal */}
      {locPickerOpen && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 420 }}>
            <h2>Select Location(s)</h2>
            <p style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>Click to toggle selection. Multiple allowed.</p>
            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
              {flatList.map(loc => {
                const isSelected = selectedLocations.find(l => l.id === loc.id);
                return (
                  <div key={loc.id} onClick={() => toggleSelect(loc)}
                    style={{
                      padding: '10px 14px', cursor: 'pointer', fontSize: 14,
                      borderBottom: '1px solid #f7f8fc',
                      background: isSelected ? '#e9ecff' : 'inherit',
                      color: isSelected ? '#5a67d8' : '#333',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}>
                    <span>{loc.name}</span>
                    {loc.parent_name && <span style={{ fontSize: 12, color: '#aaa' }}>under {loc.parent_name}</span>}
                    {isSelected && <span style={{ color: '#5a67d8', fontWeight: 700 }}>✓</span>}
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 12, fontSize: 13, color: '#666' }}>
              {selectedLocations.length} selected
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setSelectedLocations([])}>Clear</button>
              <button className="btn btn-primary" onClick={() => setLocPickerOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Parent picker modal */}
      {parentPickerOpen && (
        <div className="modal-overlay">
          <div className="modal" style={{ width: 420 }}>
            <h2>Select New Parent</h2>
            <p style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>Select a parent location, or choose Top Level.</p>
            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
              <div onClick={() => { setNewParentId(''); setParentPickerOpen(false); }}
                style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 14, borderBottom: '1px solid #f7f8fc',
                  background: !newParentId ? '#e9ecff' : 'inherit', color: !newParentId ? '#5a67d8' : '#333', fontWeight: !newParentId ? 600 : 400 }}>
                — Top Level (no parent) —
              </div>
              {flatList
                .filter(l => !selectedLocations.find(s => s.id === l.id)) // can't move to itself
                .map(loc => (
                  <div key={loc.id} onClick={() => { setNewParentId(loc.id); setParentPickerOpen(false); }}
                    style={{
                      padding: '10px 14px', cursor: 'pointer', fontSize: 14,
                      borderBottom: '1px solid #f7f8fc',
                      background: newParentId == loc.id ? '#e9ecff' : 'inherit',
                      color: newParentId == loc.id ? '#5a67d8' : '#333',
                      display: 'flex', justifyContent: 'space-between'
                    }}>
                    <span>{loc.name}</span>
                    {loc.parent_name && <span style={{ fontSize: 12, color: '#aaa' }}>under {loc.parent_name}</span>}
                  </div>
                ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setParentPickerOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Locations Page ────────────────────────────────────────
export default function Locations() {
  const [tab, setTab] = useState('manage');
  return (
    <div>
      <div className="page-header"><h1>Locations</h1></div>
      <div className="detail-tabs" style={{ marginBottom: 20 }}>
        <button className={`tab-btn ${tab === 'manage' ? 'active' : ''}`} onClick={() => setTab('manage')}>Manage Location</button>
        <button className={`tab-btn ${tab === 'types' ? 'active' : ''}`} onClick={() => setTab('types')}>Location Type</button>
        <button className={`tab-btn ${tab === 'reorganize' ? 'active' : ''}`} onClick={() => setTab('reorganize')}>Reorganize</button>
      </div>
      {tab === 'manage' && <ManageLocations />}
      {tab === 'types' && <LocationTypes />}
      {tab === 'reorganize' && <ReorganizeLocations />}
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  getTagTypes, createTagType, updateTagType, deleteTagType,
  getTagRecommendations, saveTagRecommendation, deleteTagRecommendation,
  getAssetTypes
} from '../api';
import { toastApiFailure } from '../apiErrorHandling';

// ── Tag Types Management ───────────────────────────────────────
function TagTypesTab() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');

  const searchQuery = search.trim().toLowerCase();
  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    return items.filter((item) => {
      const name = String(item.name ?? '').toLowerCase();
      const desc = String(item.description ?? '').toLowerCase();
      return name.includes(searchQuery) || desc.includes(searchQuery);
    });
  }, [items, searchQuery]);

  const load = () => getTagTypes().then(r => setItems(r.data)).catch((e) => toastApiFailure(e, 'Tag types'));
  useEffect(() => { load(); }, []);

  const openAdd = () => { setForm({ name: '', description: '' }); setEditing(null); setError(''); setModal(true); };
  const openEdit = (item) => { setForm({ name: item.name, description: item.description || '' }); setEditing(item.id); setError(''); setModal(true); };

  const save = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    try {
      if (editing) await updateTagType(editing, form);
      else await createTagType(form);
      setModal(false); load();
    } catch (e) {
      toastApiFailure(e, 'Tag types');
      setError(e.response?.data?.message || 'Save failed');
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this tag type?')) return;
    try {
      await deleteTagType(id);
      load();
    } catch (e) {
      toastApiFailure(e, 'Tag types');
    }
  };

  return (
    <div>
      <div className="tag-mgmt-toolbar" style={{ marginBottom: 16 }}>
        <div className="asset-types-toolbar-search">
          <span className="asset-types-toolbar-search-icon" aria-hidden><Search size={16} /></span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or description…"
            aria-label="Search tag types"
          />
        </div>
        <div className="tag-mgmt-toolbar-actions">
          <span className="tag-mgmt-toolbar-meta">
            {searchQuery
              ? `${filteredItems.length} of ${items.length}`
              : `${items.length} type${items.length !== 1 ? 's' : ''}`}
          </span>
          <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Tag Type</button>
        </div>
      </div>
      <table>
        <thead><tr><th>#</th><th>Name</th><th>Description</th><th>Actions</th></tr></thead>
        <tbody>
          {filteredItems.map((item, i) => (
            <tr key={item.id}>
              <td>{i + 1}</td>
              <td><strong>{item.name}</strong></td>
              <td style={{ color: '#888', fontSize: 13 }}>{item.description || '—'}</td>
              <td>
                <button className="btn btn-secondary btn-sm" style={{ marginRight: 6 }} onClick={() => openEdit(item)}>Edit</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(item.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={4} style={{ textAlign: 'center', color: '#aaa', padding: 24 }}>No tag types yet</td></tr>
          )}
          {items.length > 0 && filteredItems.length === 0 && (
            <tr><td colSpan={4} style={{ textAlign: 'center', color: '#aaa', padding: 24 }}>No tag types match your search</td></tr>
          )}
        </tbody>
      </table>

      {modal && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>{editing ? 'Edit Tag Type' : 'Add Tag Type'}</h2>
            <div className="form-group">
              <label>Name <span style={{ color: '#e53e3e' }}>*</span></label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. On-metal tag, Label tag" />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="When to use this tag type..." />
            </div>
            {error && <p style={{ color: '#e53e3e', fontSize: 13, marginBottom: 10 }}>⚠ {error}</p>}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save}>Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tag Recommendations ────────────────────────────────────────
function TagRecommendationsTab() {
  const [recommendations, setRecommendations] = useState([]);
  const [assetTypes, setAssetTypes] = useState([]);
  const [tagTypes, setTagTypes] = useState([]);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ tag_type_id: '', reason: '' });
  const [addForm, setAddForm] = useState({ asset_type_id: '', tag_type_id: '', reason: '' });
  const [showAdd, setShowAdd] = useState(false);

  const searchQuery = search.trim().toLowerCase();
  const filteredRecommendations = useMemo(() => {
    if (!searchQuery) return recommendations;
    return recommendations.filter((rec) => {
      const asset = String(rec.asset_type_name ?? '').toLowerCase();
      const tag = String(rec.tag_type_name ?? '').toLowerCase();
      const reason = String(rec.reason ?? '').toLowerCase();
      return asset.includes(searchQuery) || tag.includes(searchQuery) || reason.includes(searchQuery);
    });
  }, [recommendations, searchQuery]);

  const load = async () => {
    try {
      const [rec, at, tt] = await Promise.all([getTagRecommendations(), getAssetTypes(), getTagTypes()]);
      setRecommendations(rec.data);
      setAssetTypes(at.data);
      setTagTypes(tt.data);
    } catch (e) {
      toastApiFailure(e, 'Tag recommendations');
    }
  };
  useEffect(() => { load(); }, []);

  const saveEdit = async (asset_type_id) => {
    try {
      await saveTagRecommendation({ asset_type_id, ...editForm });
      setEditingId(null);
      load();
    } catch (e) {
      toastApiFailure(e, 'Tag recommendation');
    }
  };

  const saveAdd = async () => {
    if (!addForm.asset_type_id || !addForm.tag_type_id) return;
    try {
      await saveTagRecommendation(addForm);
      setShowAdd(false);
      setAddForm({ asset_type_id: '', tag_type_id: '', reason: '' });
      load();
    } catch (e) {
      toastApiFailure(e, 'Tag recommendation');
    }
  };

  const remove = async (asset_type_id) => {
    if (!window.confirm('Remove this recommendation?')) return;
    try {
      await deleteTagRecommendation(asset_type_id);
      load();
    } catch (e) {
      toastApiFailure(e, 'Tag recommendation');
    }
  };

  // Asset types that don't have a recommendation yet
  const mappedIds = recommendations.map(r => r.asset_type_id);
  const unmappedTypes = assetTypes.filter(at => !mappedIds.includes(at.id));

  return (
    <div>
      <div className="tag-mgmt-toolbar" style={{ marginBottom: 16 }}>
        <div className="asset-types-toolbar-search">
          <span className="asset-types-toolbar-search-icon" aria-hidden><Search size={16} /></span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search asset type, tag type, or reason…"
            aria-label="Search tag recommendations"
          />
        </div>
        <div className="tag-mgmt-toolbar-actions">
          <span className="tag-mgmt-toolbar-meta">
            {searchQuery
              ? `${filteredRecommendations.length} of ${recommendations.length}`
              : `${recommendations.length} mapping${recommendations.length !== 1 ? 's' : ''}`}
          </span>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Add Mapping</button>
        </div>
      </div>

      <table>
        <thead>
          <tr><th>Asset Type</th><th>Recommended Tag Type</th><th>Reason / Why</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {filteredRecommendations.map(rec => (
            <tr key={rec.id}>
              <td><strong>{rec.asset_type_name}</strong></td>
              <td>
                {editingId === rec.asset_type_id ? (
                  <select value={editForm.tag_type_id} onChange={e => setEditForm({ ...editForm, tag_type_id: e.target.value })}
                    style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13 }}>
                    <option value="">-- Select --</option>
                    {tagTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                ) : (
                  <span style={{ background: '#e9ecff', color: '#5a67d8', padding: '3px 10px', borderRadius: 12, fontSize: 13, fontWeight: 500 }}>
                    {rec.tag_type_name}
                  </span>
                )}
              </td>
              <td>
                {editingId === rec.asset_type_id ? (
                  <input value={editForm.reason} onChange={e => setEditForm({ ...editForm, reason: e.target.value })}
                    style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, width: '100%' }} />
                ) : (
                  <span style={{ color: '#666', fontSize: 13 }}>{rec.reason || '—'}</span>
                )}
              </td>
              <td>
                {editingId === rec.asset_type_id ? (
                  <>
                    <button className="btn btn-primary btn-sm" style={{ marginRight: 6 }} onClick={() => saveEdit(rec.asset_type_id)}>Save</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-secondary btn-sm" style={{ marginRight: 6 }}
                      onClick={() => { setEditingId(rec.asset_type_id); setEditForm({ tag_type_id: rec.tag_type_id, reason: rec.reason || '' }); }}>
                      Edit
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => remove(rec.asset_type_id)}>Remove</button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {recommendations.length === 0 && (
            <tr><td colSpan={4} style={{ textAlign: 'center', color: '#aaa', padding: 24 }}>No recommendations yet</td></tr>
          )}
          {recommendations.length > 0 && filteredRecommendations.length === 0 && (
            <tr><td colSpan={4} style={{ textAlign: 'center', color: '#aaa', padding: 24 }}>No recommendations match your search</td></tr>
          )}
        </tbody>
      </table>

      {showAdd && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Add Tag Recommendation</h2>
            <div className="form-group">
              <label>Asset Type</label>
              <select value={addForm.asset_type_id} onChange={e => setAddForm({ ...addForm, asset_type_id: e.target.value })}>
                <option value="">-- Select Asset Type --</option>
                {unmappedTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                {/* Also show all if user wants to override */}
                {unmappedTypes.length === 0 && assetTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Recommended Tag Type</label>
              <select value={addForm.tag_type_id} onChange={e => setAddForm({ ...addForm, tag_type_id: e.target.value })}>
                <option value="">-- Select Tag Type --</option>
                {tagTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Reason / Why</label>
              <input value={addForm.reason} onChange={e => setAddForm({ ...addForm, reason: e.target.value })} placeholder="e.g. Metal body causes interference" />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveAdd} disabled={!addForm.asset_type_id || !addForm.tag_type_id}>Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Settings Page ─────────────────────────────────────────
export default function Settings() {
  const [tab, setTab] = useState('tag-types');

  return (
    <div>
      <div className="page-header"><h1>Tag Management</h1></div>
      <div className="detail-tabs" style={{ marginBottom: 24 }}>
        <button className={`tab-btn ${tab === 'tag-types' ? 'active' : ''}`} onClick={() => setTab('tag-types')}>
          🏷️ Tag Types
        </button>
        <button className={`tab-btn ${tab === 'recommendations' ? 'active' : ''}`} onClick={() => setTab('recommendations')}>
          📋 Tag Recommendations
        </button>
      </div>
      {tab === 'tag-types' && <TagTypesTab />}
      {tab === 'recommendations' && <TagRecommendationsTab />}
    </div>
  );
}

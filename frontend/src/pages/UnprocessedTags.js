import { useEffect, useState, useCallback } from 'react';
import { getUnprocessedTags, deleteUnprocessedTag } from '../api';
import { useToast } from '../Toast';
import { toastApiFailure } from '../apiErrorHandling';

export default function UnprocessedTags() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  const searchQuery = search.trim();

  const load = useCallback(() => {
    setLoading(true);
    const params = {};
    if (searchQuery) params.search = searchQuery;
    return getUnprocessedTags(params)
      .then((r) => setItems(Array.isArray(r.data) ? r.data : []))
      .catch((e) => toastApiFailure(e, 'Unprocessed tags'))
      .finally(() => setLoading(false));
  }, [searchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => { load(); }, searchQuery ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, searchQuery]);

  const remove = async (row) => {
    if (!window.confirm(`Delete unprocessed tag "${row.tag_value}"?`)) return;
    try {
      await deleteUnprocessedTag(row.id);
      showToast('Tag deleted', 'success');
      load();
    } catch (e) {
      toastApiFailure(e, 'Unprocessed tags');
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Unprocessed Tags</h1>
        <span style={{ fontSize: 13, color: '#888' }}>Total: {items.length}</span>
      </div>

      <div style={{
        background: '#fff', borderRadius: 8, padding: '12px 16px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 16,
        display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#aaa' }}>🔍</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tag, source, reader, notes..."
            style={{
              width: '100%', padding: '7px 10px 7px 30px',
              border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
            }}
          />
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>

      <div style={{
        background: '#fff', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        overflow: 'hidden',
      }}>
        <table>
          <thead>
            <tr>
              <th>Tag Value</th>
              <th style={{ width: 140 }}>Source</th>
              <th style={{ width: 140 }}>Reader</th>
              <th>Notes</th>
              <th style={{ width: 180 }}>Created</th>
              <th style={{ width: 100 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', color: '#aaa', padding: 32 }}>Loading…</td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', color: '#aaa', padding: 32 }}>
                  No unprocessed tags found
                </td>
              </tr>
            )}
            {items.map((row) => (
              <tr key={row.id}>
                <td style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}>
                  {row.tag_value}
                </td>
                <td>{row.source || '—'}</td>
                <td>{row.reader_id || '—'}</td>
                <td style={{ color: row.notes ? '#374151' : '#aaa' }}>{row.notes || '—'}</td>
                <td style={{ fontSize: 13, color: '#6b7280' }}>
                  {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                </td>
                <td>
                  <button className="btn btn-danger btn-sm" onClick={() => remove(row)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

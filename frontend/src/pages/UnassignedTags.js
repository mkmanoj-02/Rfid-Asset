import { useEffect, useState, useCallback } from 'react';
import {
  getUnassignedTags, assignUnassignedTag, deleteUnassignedTag,
  getZones, getAssetDropdown,
} from '../api';
import { useToast } from '../Toast';
import { toastApiFailure } from '../apiErrorHandling';

const PAGE_SIZES = [25, 50, 100, 500];

const monoStyle = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 };

function AssignTagModal({ tag, onClose, onAssigned }) {
  const [assets, setAssets] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [assigningId, setAssigningId] = useState(null);
  const { showToast } = useToast();

  const searchQuery = search.trim();

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      const params = { no_rfid: 1, limit: 500 };
      if (searchQuery) params.search = searchQuery;
      getAssetDropdown(params)
        .then((r) => { if (!cancelled) setAssets(Array.isArray(r.data) ? r.data : []); })
        .catch((e) => toastApiFailure(e, 'Assets'))
        .finally(() => { if (!cancelled) setLoading(false); });
    }, searchQuery ? 300 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchQuery]);

  const assign = async (asset) => {
    if (!window.confirm(`Assign tag "${tag.tag_value}" to asset "${asset.name}"?`)) return;
    setAssigningId(asset.id);
    try {
      await assignUnassignedTag(tag.id, asset.id);
      showToast(`Tag assigned to "${asset.name}"`, 'success');
      onAssigned();
    } catch (e) {
      toastApiFailure(e, 'Assign tag');
    } finally {
      setAssigningId(null);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 200 }}>
      <div className="modal" style={{ width: 560 }}>
        <h2>Assign Tag</h2>
        <p style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>
          Select an asset without an RFID tag to assign <code style={monoStyle}>{tag.tag_value}</code>.
        </p>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search asset name or serial..."
          autoFocus
          style={{
            width: '100%', padding: '7px 10px', marginBottom: 12,
            border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
          }}
        />

        <div className="rfid-tag-list" style={{ maxHeight: 360 }}>
          {loading && assets.length === 0 && (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#aaa' }}>Loading…</div>
          )}
          {!loading && assets.length === 0 && (
            <div style={{ textAlign: 'center', padding: '24px 0', color: '#aaa' }}>
              No assets without an RFID tag found
            </div>
          )}
          {assets.map((a) => (
            <div key={a.id} className="rfid-tag-item" onClick={() => assigningId == null && assign(a)}>
              <div>
                <div style={{ fontWeight: 500 }}>{a.name}</div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                  {a.asset_serial ? `Serial: ${a.asset_serial}` : 'No serial'}
                  {a.location_name ? ` · ${a.location_name}` : ''}
                </div>
              </div>
              <span className="btn btn-primary btn-sm">
                {assigningId === a.id ? 'Assigning…' : 'Assign'}
              </span>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default function UnassignedTags() {
  const [items, setItems] = useState([]);
  const [zones, setZones] = useState([]);
  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [assignTag, setAssignTag] = useState(null);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const { showToast } = useToast();

  const searchQuery = search.trim();

  const load = useCallback(() => {
    setLoading(true);
    const params = { page: currentPage, limit: pageSize };
    if (searchQuery) params.search = searchQuery;
    if (zoneFilter) params.zone_id = zoneFilter;
    return getUnassignedTags(params)
      .then((r) => {
        const body = r.data;
        const rows = Array.isArray(body?.data) ? body.data : [];
        const tot = body?.pagination?.total ?? rows.length;
        setItems(rows);
        setTotal(tot);
        setTotalPages(Math.max(1, Math.ceil(tot / (body?.pagination?.limit || pageSize))));
      })
      .catch((e) => toastApiFailure(e, 'Unassigned tags'))
      .finally(() => setLoading(false));
  }, [currentPage, pageSize, searchQuery, zoneFilter]);

  useEffect(() => {
    const timer = setTimeout(() => { load(); }, searchQuery ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, zoneFilter, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  useEffect(() => {
    getZones()
      .then((r) => setZones(Array.isArray(r.data) ? r.data : []))
      .catch((e) => toastApiFailure(e, 'Zones'));
  }, []);

  const remove = async (row) => {
    if (!window.confirm(`Delete unassigned tag "${row.tag_value}"?`)) return;
    try {
      await deleteUnassignedTag(row.id);
      showToast('Tag deleted', 'success');
      load();
    } catch (e) {
      toastApiFailure(e, 'Unassigned tags');
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>Unassigned Tags</h1>
        <span style={{ fontSize: 13, color: '#888' }}>Total: {total}</span>
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
            placeholder="Search tag, source, reader, zone, notes..."
            style={{
              width: '100%', padding: '7px 10px 7px 30px',
              border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box',
            }}
          />
        </div>
        <select
          value={zoneFilter}
          onChange={(e) => setZoneFilter(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
        >
          <option value="">All zones</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
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
              <th style={{ width: 120 }}>Source</th>
              <th style={{ width: 100 }}>Reader</th>
              <th style={{ width: 150 }}>Zone</th>
              <th>Notes</th>
              <th style={{ width: 180 }}>Created</th>
              <th style={{ width: 160 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: '#aaa', padding: 32 }}>Loading…</td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: '#aaa', padding: 32 }}>
                  No unassigned tags found
                </td>
              </tr>
            )}
            {items.map((row) => (
              <tr key={row.id}>
                <td style={monoStyle}>{row.tag_value}</td>
                <td>{row.source || '—'}</td>
                <td>{row.reader_id || '—'}</td>
                <td style={{ color: row.zone_name ? '#374151' : '#aaa' }}>{row.zone_name || '—'}</td>
                <td style={{ color: row.notes ? '#374151' : '#aaa' }}>{row.notes || '—'}</td>
                <td style={{ fontSize: 13, color: '#6b7280' }}>
                  {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => setAssignTag(row)} style={{ marginRight: 6 }}>
                    Assign
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => remove(row)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {total > 0 && (
          <div className="assets-page-pagination">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#555', flexWrap: 'wrap' }}>
              <span>Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <span style={{ marginLeft: 8 }}>
                {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, total)} of {total}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 6, background: currentPage === 1 ? '#f7f8fc' : '#fff', cursor: currentPage === 1 ? 'default' : 'pointer', color: currentPage === 1 ? '#bbb' : '#333', fontSize: 13 }}
              >«</button>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 6, background: currentPage === 1 ? '#f7f8fc' : '#fff', cursor: currentPage === 1 ? 'default' : 'pointer', color: currentPage === 1 ? '#bbb' : '#333', fontSize: 13 }}
              >‹</button>
              {Array.from({ length: totalPages }, (_, idx) => idx + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
                .reduce((acc, p, i, arr) => {
                  if (i > 0 && p - arr[i - 1] > 1) acc.push('...');
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, idx) =>
                  p === '...'
                    ? <span key={`ellipsis-${idx}`} style={{ padding: '5px 8px', fontSize: 13, color: '#aaa' }}>…</span>
                    : <button
                        key={p}
                        type="button"
                        onClick={() => setCurrentPage(p)}
                        style={{
                          padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13,
                          background: currentPage === p ? '#1565c0' : '#fff',
                          color: currentPage === p ? '#fff' : '#333',
                          cursor: 'pointer', fontWeight: currentPage === p ? 600 : 400,
                        }}
                      >{p}</button>
                )}
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 6, background: currentPage === totalPages ? '#f7f8fc' : '#fff', cursor: currentPage === totalPages ? 'default' : 'pointer', color: currentPage === totalPages ? '#bbb' : '#333', fontSize: 13 }}
              >›</button>
              <button
                type="button"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                style={{ padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 6, background: currentPage === totalPages ? '#f7f8fc' : '#fff', cursor: currentPage === totalPages ? 'default' : 'pointer', color: currentPage === totalPages ? '#bbb' : '#333', fontSize: 13 }}
              >»</button>
            </div>
          </div>
        )}
      </div>

      {assignTag && (
        <AssignTagModal
          tag={assignTag}
          onClose={() => setAssignTag(null)}
          onAssigned={() => { setAssignTag(null); load(); }}
        />
      )}
    </div>
  );
}

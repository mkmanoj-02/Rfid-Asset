import React, { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { getMovements, getAssetDropdown } from '../api';
import { toastApiFailure } from '../apiErrorHandling';

const PAGE_SIZES = [25, 50, 100, 500];

function formatDuration(movedAt, nextMoveAt) {
  const diffMs = nextMoveAt - movedAt;
  if (!Number.isFinite(diffMs) || diffMs < 0) return '—';
  const months = Math.floor(diffMs / 2592000000);
  const weeks = Math.floor((diffMs % 2592000000) / 604800000);
  const days = Math.floor((diffMs % 604800000) / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  const secs = Math.floor((diffMs % 60000) / 1000);
  if (months > 0) {
    return `${months} Month${months > 1 ? 's' : ''}${weeks > 0 ? ` ${weeks} Week${weeks > 1 ? 's' : ''}` : ''}`;
  }
  if (weeks > 0) {
    return `${weeks} Week${weeks > 1 ? 's' : ''}${days > 0 ? ` ${days} Day${days > 1 ? 's' : ''}` : ''}`;
  }
  if (days > 0) {
    return `${days} Day${days > 1 ? 's' : ''}${hours > 0 ? ` ${hours} Hour${hours > 1 ? 's' : ''}` : ''}`;
  }
  if (hours > 0) {
    return `${hours} Hour${hours > 1 ? 's' : ''}${mins > 0 ? ` ${mins} Min${mins > 1 ? 's' : ''}` : ''}`;
  }
  if (mins > 0) {
    return `${mins} Min${mins > 1 ? 's' : ''}${secs > 0 ? ` ${secs} Sec${secs > 1 ? 's' : ''}` : ''}`;
  }
  return `${secs} Sec${secs !== 1 ? 's' : ''}`;
}

export default function Movements() {
  const [movements, setMovements] = useState([]);
  const [assets, setAssets] = useState([]);
  const [assetFilter, setAssetFilter] = useState('');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const searchQuery = search.trim();

  const load = useCallback(() => {
    const params = {
      page: currentPage,
      limit: pageSize,
    };
    if (assetFilter) params.asset_id = assetFilter;
    if (searchQuery) params.search = searchQuery;

    return getMovements(params)
      .then((r) => {
        const body = r.data;
        if (body?.pagination && Array.isArray(body.data)) {
          const tot = body.pagination.total ?? body.data.length;
          const limit = body.pagination.limit || pageSize;
          setMovements(body.data);
          setTotal(tot);
          setTotalPages(Math.max(1, Math.ceil(tot / limit)));
        } else if (Array.isArray(body)) {
          setMovements(body);
          setTotal(body.length);
          setTotalPages(1);
        } else {
          setMovements([]);
          setTotal(0);
          setTotalPages(1);
        }
      })
      .catch((e) => toastApiFailure(e, 'Trace History'));
  }, [currentPage, pageSize, assetFilter, searchQuery]);

  useEffect(() => {
    getAssetDropdown({ limit: 500 })
      .then((r) => setAssets(Array.isArray(r.data) ? r.data : (r.data?.data || [])))
      .catch((e) => toastApiFailure(e, 'Assets'));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { load(); }, searchQuery ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, assetFilter, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const handleAssetFilter = (e) => {
    setAssetFilter(e.target.value);
  };

  const rangeStart = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = Math.min(currentPage * pageSize, total);

  return (
    <div>
      <div className="page-header">
        <h1>Trace History</h1>
        <span style={{ fontSize: 13, color: '#888' }}>Total: {total} record{total !== 1 ? 's' : ''}</span>
      </div>

      <div className="tag-mgmt-toolbar" style={{ marginBottom: 16 }}>
        <div className="asset-types-toolbar-search">
          <span className="asset-types-toolbar-search-icon" aria-hidden><Search size={16} /></span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by asset, RFID tag, from, to…"
            aria-label="Search trace history"
          />
        </div>
        <div className="tag-mgmt-toolbar-actions">
          <select
            value={assetFilter}
            onChange={handleAssetFilter}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, minWidth: 180 }}
            aria-label="Filter by asset"
          >
            <option value="">All Assets</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.name}{a.rfid_tag ? ` (${a.rfid_tag})` : ''}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>S.No</th>
              <th>Asset</th>
              <th>RFID Tag</th>
              <th>From</th>
              <th>To</th>
              <th>Date &amp; Time</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m, i) => {
              const movedAt = new Date(m.moved_at);
              const nextMoveAt = m.next_moved_at ? new Date(m.next_moved_at) : new Date();
              const duration = formatDuration(movedAt, nextMoveAt);
              const isCurrentLocation = !m.next_moved_at;
              return (
                <tr key={m.id}>
                  <td>{rangeStart + i}</td>
                  <td>{m.asset_name}</td>
                  <td><code>{m.rfid_tag}</code></td>
                  <td>{m.from_location || '—'}</td>
                  <td>{m.to_location || '—'}</td>
                  <td>{movedAt.toLocaleString()}</td>
                  <td style={{ color: isCurrentLocation ? '#7c8cf8' : '#555', fontSize: 13, fontWeight: isCurrentLocation ? 500 : 400 }}>
                    {isCurrentLocation ? `${duration.trim()} (now)` : duration.trim()}
                  </td>
                </tr>
              );
            })}
            {movements.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: '#888', padding: 24 }}>
                  {searchQuery || assetFilter ? 'No movements match your filters' : 'No movements found'}
                </td>
              </tr>
            )}
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
                {rangeStart}–{rangeEnd} of {total}
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
                    : (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setCurrentPage(p)}
                        style={{
                          padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13,
                          background: currentPage === p ? 'var(--theme-primary, #1565c0)' : '#fff',
                          color: currentPage === p ? '#fff' : '#333',
                          cursor: 'pointer', fontWeight: currentPage === p ? 600 : 400,
                        }}
                      >{p}</button>
                    )
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
    </div>
  );
}

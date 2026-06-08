import React, { useEffect, useState, useCallback } from 'react';
import api from '../api';
import { toastApiFailure } from '../apiErrorHandling';

const PAGE_SIZES = [25, 50, 100, 500];

const TYPE_COLORS = {
  'Login':        { bg: '#dbeafe', color: '#1a56db' },
  'Login Failure':{ bg: '#fed7d7', color: '#9b2c2c' },
  'Asset':        { bg: '#c6f6d5', color: '#276749' },
  'Asset Type':   { bg: '#e9d8fd', color: '#553c9a' },
  'Location':     { bg: '#fefcbf', color: '#744210' },
  'User':         { bg: '#bee3f8', color: '#2a69ac' },
  'Import':       { bg: '#fed7e2', color: '#97266d' },
  'Rule':         { bg: '#e2e8f0', color: '#4a5568' },
  'Alert':        { bg: '#feebc8', color: '#7b341e' },
};

const TYPE_ICONS = {
  'Login': '🔑',
  'Login Failure': '🚫',
  'Asset': '📦',
  'Asset Type': '🏷️',
  'Location': '📍',
  'User': '👤',
  'Import': '📥',
  'Rule': '📋',
  'Alert': '🔔',
};

const ALL_TYPES = ['all', 'Login', 'Login Failure', 'Asset', 'Asset Type', 'Location', 'User', 'Import', 'Rule', 'Alert'];

function defaultFromDate() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().split('T')[0];
}

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [fromDate, setFromDate] = useState(defaultFromDate);
  const [toDate, setToDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [appliedFrom, setAppliedFrom] = useState(defaultFromDate);
  const [appliedTo, setAppliedTo] = useState(() => new Date().toISOString().split('T')[0]);

  const searchQuery = search.trim();

  const load = useCallback(() => {
    const params = { page: currentPage, limit: pageSize };
    if (appliedFrom) params.from = appliedFrom;
    if (appliedTo) params.to = appliedTo;
    if (typeFilter && typeFilter !== 'all') params.type = typeFilter;
    if (searchQuery) params.search = searchQuery;

    return api.get('/audit-logs', { params }).then(r => {
      const body = r.data;
      if (body?.pagination && Array.isArray(body.data)) {
        const tot = body.pagination.total ?? body.data.length;
        const limit = body.pagination.limit || pageSize;
        setLogs(body.data);
        setTotal(tot);
        setTotalPages(Math.max(1, Math.ceil(tot / limit)));
      } else if (Array.isArray(body)) {
        setLogs(body);
        setTotal(body.length);
        setTotalPages(1);
      } else {
        setLogs([]);
        setTotal(0);
        setTotalPages(1);
      }
    }).catch((e) => toastApiFailure(e, 'Audit log'));
  }, [currentPage, pageSize, appliedFrom, appliedTo, typeFilter, searchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => { load(); }, searchQuery ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, typeFilter, appliedFrom, appliedTo, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const handleGo = () => {
    setAppliedFrom(fromDate);
    setAppliedTo(toDate);
    setCurrentPage(1);
  };

  return (
    <div>
      <div className="page-header">
        <h1>User Audit Log</h1>
        <span style={{ fontSize: 13, color: '#888' }}>Total: {total} log entries</span>
      </div>

      {/* Filters */}
      <div style={{ background: '#fff', borderRadius: 8, padding: '12px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: '1 1 200px' }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#aaa' }}>🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search description, user, action..."
            style={{ width: '100%', padding: '7px 10px 7px 30px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
        </div>

        {/* Type filter */}
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}>
          {ALL_TYPES.map(t => <option key={t} value={t}>{t === 'all' ? 'All Types' : t}</option>)}
        </select>

        {/* Date range */}
        <span style={{ fontSize: 13, fontWeight: 500 }}>From:</span>
        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
        <span style={{ fontSize: 13, fontWeight: 500 }}>To:</span>
        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
        <button className="btn btn-primary btn-sm" onClick={handleGo}>Go</button>
      </div>

      {/* Log table */}
      <div style={{ background: '#fff', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 36 }}></th>
              <th>Name / Description</th>
              <th style={{ width: 120 }}>Type</th>
              <th style={{ width: 120 }}>Action</th>
              <th style={{ width: 130 }}>User</th>
              <th style={{ width: 180 }}>Time</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: '#aaa', padding: 32 }}>No audit logs found</td></tr>
            )}
            {logs.map(log => {
              const tc = TYPE_COLORS[log.type] || { bg: '#e2e8f0', color: '#555' };
              return (
                <tr key={log.id} style={{ borderBottom: '1px solid #f7f8fc' }}>
                  <td style={{ textAlign: 'center', fontSize: 16 }}>{TYPE_ICONS[log.type] || '📝'}</td>
                  <td style={{ fontSize: 13 }}>{log.description}</td>
                  <td>
                    <span style={{ background: tc.bg, color: tc.color, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {log.type}
                    </span>
                  </td>
                  <td style={{ fontSize: 13 }}>{log.action}</td>
                  <td style={{ fontSize: 13, fontWeight: 500 }}>{log.username || '—'}</td>
                  <td style={{ fontSize: 12, color: '#666' }}>{new Date(log.logged_at).toLocaleString()}</td>
                </tr>
              );
            })}
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
    </div>
  );
}

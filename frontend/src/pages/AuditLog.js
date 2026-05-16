import React, { useEffect, useState, useRef } from 'react';
import api from '../api';
import { toastApiFailure } from '../apiErrorHandling';

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

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().split('T')[0]);
  const searchTimer = useRef(null);

  const load = (s, t, f, to) => {
    const params = {};
    if (f) params.from = f;
    if (to) params.to = to;
    if (t && t !== 'all') params.type = t;
    if (s) params.search = s;
    api.get('/audit-logs', { params }).then(r => setLogs(r.data)).catch((e) => toastApiFailure(e, 'Audit log'));
    api.get('/audit-logs/count').then(r => setTotal(r.data.count)).catch((e) => toastApiFailure(e, 'Audit log count'));
  };

  useEffect(() => { load(search, typeFilter, fromDate, toDate); }, []);

  const handleSearch = (val) => {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(val, typeFilter, fromDate, toDate), 300);
  };

  const handleGo = () => load(search, typeFilter, fromDate, toDate);

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
          <input value={search} onChange={e => handleSearch(e.target.value)}
            placeholder="Search description, user, action..."
            style={{ width: '100%', padding: '7px 10px 7px 30px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
        </div>

        {/* Type filter */}
        <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); load(search, e.target.value, fromDate, toDate); }}
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

        <span style={{ fontSize: 12, color: '#888', marginLeft: 'auto' }}>{logs.length} entries shown</span>
      </div>

      {/* Log table */}
      <div style={{ background: '#fff', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
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
      </div>
    </div>
  );
}

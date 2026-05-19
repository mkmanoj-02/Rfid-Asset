import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { getMovements, getAssets } from '../api';
import { toastApiFailure } from '../apiErrorHandling';

function formatDuration(movedAt, nextMoveAt) {
  const diffMs = nextMoveAt - movedAt;
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

function matchesMovementSearch(m, query) {
  const haystack = [
    m.asset_name,
    m.rfid_tag,
    m.from_location,
    m.to_location,
    m.moved_at ? new Date(m.moved_at).toLocaleString() : '',
  ]
    .map((v) => String(v ?? '').toLowerCase())
    .join(' ');
  return haystack.includes(query);
}

export default function Movements() {
  const [movements, setMovements] = useState([]);
  const [assets, setAssets] = useState([]);
  const [assetFilter, setAssetFilter] = useState('');
  const [search, setSearch] = useState('');

  const load = (asset_id) => getMovements(asset_id || undefined)
    .then((r) => setMovements(r.data))
    .catch((e) => toastApiFailure(e, 'Movements'));

  useEffect(() => {
    load();
    getAssets().then((r) => setAssets(r.data)).catch((e) => toastApiFailure(e, 'Assets'));
  }, []);

  const handleAssetFilter = (e) => {
    const value = e.target.value;
    setAssetFilter(value);
    load(value);
  };

  const searchQuery = search.trim().toLowerCase();
  const filteredMovements = useMemo(() => {
    if (!searchQuery) return movements;
    return movements.filter((m) => matchesMovementSearch(m, searchQuery));
  }, [movements, searchQuery]);

  const getNextMoveForAsset = (m) => {
    const i = movements.findIndex((x) => x.id === m.id);
    if (i < 0) return null;
    return movements.slice(0, i).reverse().find((x) => x.asset_name === m.asset_name);
  };

  return (
    <motionless>
      <motionless className="page-header">
        <h1>Trace History</h1>
      </motionless>

      <motionless className="tag-mgmt-toolbar" style={{ marginBottom: 16 }}>
        <motionless className="asset-types-toolbar-search">
          <span className="asset-types-toolbar-search-icon" aria-hidden><Search size={16} /></span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search asset, RFID tag, location, date…"
            aria-label="Search trace history"
          />
        </motionless>
        <motionless className="tag-mgmt-toolbar-actions">
          <span className="tag-mgmt-toolbar-meta">
            {searchQuery
              ? `${filteredMovements.length} of ${movements.length}`
              : `${movements.length} record${movements.length !== 1 ? 's' : ''}`}
          </span>
          <select
            value={assetFilter}
            onChange={handleAssetFilter}
            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, minWidth: 180 }}
            aria-label="Filter by asset"
          >
            <option value="">All Assets</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.rfid_tag})</option>
            ))}
          </select>
        </motionless>
      </motionless>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Asset</th>
            <th>RFID Tag</th>
            <th>From</th>
            <th>To</th>
            <th>Date &amp; Time</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          {filteredMovements.map((m, i) => {
            const movedAt = new Date(m.moved_at);
            const nextMoveForAsset = getNextMoveForAsset(m);
            const nextMoveAt = nextMoveForAsset ? new Date(nextMoveForAsset.moved_at) : new Date();
            const duration = formatDuration(movedAt, nextMoveAt);
            const isCurrentLocation = !nextMoveForAsset;
            return (
              <tr key={m.id}>
                <td>{i + 1}</td>
                <td>{m.asset_name}</td>
                <td><code>{m.rfid_tag}</code></td>
                <td>{m.from_location || '—'}</td>
                <td>{m.to_location}</td>
                <td>{movedAt.toLocaleString()}</td>
                <td style={{ color: isCurrentLocation ? '#7c8cf8' : '#555', fontSize: 13, fontWeight: isCurrentLocation ? 500 : 400 }}>
                  {isCurrentLocation ? `${duration.trim()} (now)` : duration.trim()}
                </td>
              </tr>
            );
          })}
          {movements.length === 0 && (
            <tr><td colSpan={7} style={{ textAlign: 'center', color: '#888', padding: 24 }}>No movements found</td></tr>
          )}
          {movements.length > 0 && filteredMovements.length === 0 && (
            <tr><td colSpan={7} style={{ textAlign: 'center', color: '#888', padding: 24 }}>No movements match your search</td></tr>
          )}
        </tbody>
      </table>
    </motionless>
  );
}

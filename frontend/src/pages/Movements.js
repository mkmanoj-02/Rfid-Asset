import React, { useEffect, useState } from 'react';
import { getMovements, getAssets } from '../api';
import { toastApiFailure } from '../apiErrorHandling';

export default function Movements() {
  const [movements, setMovements] = useState([]);
  const [assets, setAssets] = useState([]);
  const [filter, setFilter] = useState('');

  const load = (asset_id) => getMovements(asset_id || undefined)
    .then(r => setMovements(r.data))
    .catch((e) => toastApiFailure(e, 'Movements'));

  useEffect(() => {
    load();
    getAssets().then(r => setAssets(r.data)).catch((e) => toastApiFailure(e, 'Assets'));
  }, []);

  const handleFilter = (e) => {
    setFilter(e.target.value);
    load(e.target.value);
  };

  return (
    <div>
      <div className="page-header">
        <h1>Trace History</h1>
        <select value={filter} onChange={handleFilter} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14 }}>
          <option value="">All Assets</option>
          {assets.map(a => <option key={a.id} value={a.id}>{a.name} ({a.rfid_tag})</option>)}
        </select>
      </div>
      <table>
        <thead>
          <tr><th>#</th><th>Asset</th><th>RFID Tag</th><th>From</th><th>To</th><th>Date &amp; Time</th><th>Duration</th></tr>
        </thead>
        <tbody>
          {movements.map((m, i) => {
            const movedAt = new Date(m.moved_at);
            // Find the next movement for the SAME asset (movements are DESC order)
            const nextMoveForAsset = movements.slice(0, i).reverse().find(x => x.asset_name === m.asset_name);
            const nextMoveAt = nextMoveForAsset ? new Date(nextMoveForAsset.moved_at) : new Date();
            const diffMs = nextMoveAt - movedAt;
            const months = Math.floor(diffMs / 2592000000);
            const weeks = Math.floor((diffMs % 2592000000) / 604800000);
            const days = Math.floor((diffMs % 604800000) / 86400000);
            const hours = Math.floor((diffMs % 86400000) / 3600000);
            const mins = Math.floor((diffMs % 3600000) / 60000);
            const secs = Math.floor((diffMs % 60000) / 1000);
            let duration = '';
            if (months > 0) { duration = `${months} Month${months > 1 ? 's' : ''} ${weeks > 0 ? weeks + ' Week' + (weeks > 1 ? 's' : '') : ''}`; }
            else if (weeks > 0) { duration = `${weeks} Week${weeks > 1 ? 's' : ''} ${days > 0 ? days + ' Day' + (days > 1 ? 's' : '') : ''}`; }
            else if (days > 0) { duration = `${days} Day${days > 1 ? 's' : ''} ${hours > 0 ? hours + ' Hour' + (hours > 1 ? 's' : '') : ''}`; }
            else if (hours > 0) { duration = `${hours} Hour${hours > 1 ? 's' : ''} ${mins > 0 ? mins + ' Min' + (mins > 1 ? 's' : '') : ''}`; }
            else if (mins > 0) { duration = `${mins} Min${mins > 1 ? 's' : ''} ${secs > 0 ? secs + ' Sec' + (secs > 1 ? 's' : '') : ''}`; }
            else { duration = `${secs} Sec${secs !== 1 ? 's' : ''}`; }
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
        </tbody>
      </table>
    </div>
  );
}

import { useState } from 'react';
import { resolveImageUrl } from '../utils/imageUrl';

const locationThumbStyle = {
  width: 90,
  height: 70,
  background: '#f0f2f5',
  borderRadius: 6,
  flexShrink: 0,
  overflow: 'hidden',
};

const placeholderThumbStyle = {
  ...locationThumbStyle,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 11,
  color: '#aaa',
  textAlign: 'center',
};

function LocationThumb({ imageUrl }) {
  const [broken, setBroken] = useState(false);
  if (!imageUrl || broken) {
    return (
      <div style={placeholderThumbStyle}>
        No Image<br />Available
      </div>
    );
  }
  return (
    <div style={locationThumbStyle}>
      <img
        src={resolveImageUrl(imageUrl)}
        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        onError={() => setBroken(true)}
      />
    </div>
  );
}

export default function LocationDetailPopup({ locationName, detail, loading, onClose }) {
  const subLocsRaw = detail?.subLocs ?? detail?.sub_locations ?? [];
  const locationId = detail?.id ?? detail?.loc?.id;
  const subLocs = subLocsRaw.filter(
    (s) => s.id !== locationId && s.name !== locationName
  );
  const byType = detail?.byType ?? detail?.assets_by_type ?? [];
  const recentTx = detail?.recentTx ?? detail?.recent_transactions ?? [];
  const recentAlerts = detail?.recentAlerts ?? detail?.recent_alerts ?? [];
  const total = detail?.total ?? detail?.asset_count ?? 0;
  const missing = detail?.missing ?? detail?.inactive_assets ?? 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500,
    }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 8, width: 620, maxWidth: '95vw', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #e2e8f0', background: '#f7f8fc' }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{locationName}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#888' }}>×</button>
        </div>

        {loading || !detail ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#aaa' }}>{loading ? 'Loading...' : 'Could not load location.'}</div>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: 16, padding: 16, borderBottom: '1px solid #e2e8f0' }}>
              <LocationThumb imageUrl={detail.image_url} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
                <div><span style={{ color: '#555', minWidth: 140, display: 'inline-block' }}>Type</span>: Default</div>
                <div><span style={{ color: '#555', minWidth: 140, display: 'inline-block' }}>Total Inventory</span>: <strong style={{ color: '#5a67d8' }}>{total}</strong></div>
                <div><span style={{ color: '#555', minWidth: 140, display: 'inline-block' }}>Missing Inventory</span>: <strong style={{ color: missing > 0 ? '#e53e3e' : '#276749' }}>{missing}</strong></div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid #e2e8f0' }}>
              <div style={{ padding: 14, borderRight: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, textAlign: 'center' }}>Inventory by Sub Location</div>
                {subLocs.length === 0 && <div style={{ fontSize: 13, color: '#aaa', textAlign: 'center' }}>No sub-locations</div>}
                {subLocs.map((s) => (
                  <div key={s.id ?? s.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid #f7f8fc' }}>
                    <span>{s.name}</span>
                    <strong style={{ color: '#5a67d8' }}>{s.count}</strong>
                  </div>
                ))}
              </div>
              <div style={{ padding: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, textAlign: 'center' }}>Inventory by Asset Types</div>
                {byType.length === 0 && <div style={{ fontSize: 13, color: '#aaa', textAlign: 'center' }}>No assets</div>}
                {byType.map((t, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid #f7f8fc' }}>
                    <span>{t.name}</span>
                    <strong style={{ color: '#5a67d8' }}>{t.count}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <div style={{ padding: 14, borderRight: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, textAlign: 'center' }}>Recent Transactions</div>
                {recentTx.length === 0 && <div style={{ fontSize: 13, color: '#aaa', textAlign: 'center' }}>No transactions</div>}
                {recentTx.map((t, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#444', marginBottom: 8 }}>
                    <span style={{ fontWeight: 500 }}>{t.asset_serial || t.asset_name}</span>
                    {' '}{t.from_loc ? 'OUT' : 'IN'}{' '}
                    {new Date(t.moved_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </div>
                ))}
              </div>
              <div style={{ padding: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, textAlign: 'center' }}>Recent Alerts</div>
                {recentAlerts.length === 0 && <div style={{ fontSize: 13, color: '#aaa', textAlign: 'center' }}>No alerts</div>}
                {recentAlerts.map((a, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#e53e3e', marginBottom: 6 }}>● {a.description}</div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

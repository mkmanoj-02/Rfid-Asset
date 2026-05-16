import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Cell, LabelList,
} from 'recharts';
import { Package, MapPin, Layers, ScanLine, CircleOff } from 'lucide-react';
import api, { getDashboard, getDashboardLocation, getLocations } from '../api';
import { toastApiFailure } from '../apiErrorHandling';
import {
  DashboardChartCard,
  LocationDistributionBarChart,
  MonthlyDistributionAreaChart,
  chartLoadingShellStyle,
} from '../components/dashboard/DistributionCharts';
import { STAT_CARD_CLASS, CHART_GRID } from '../components/dashboard/chartTheme';
import LocationDetailPopup from '../components/LocationDetailPopup';
import './Dashboard.css';
const MAP_STORAGE_KEY = 'rfid_dashboard_map_image';
const PINS_STORAGE_KEY = 'rfid_dashboard_pins'; // { locationId: { x%, y% } }

const STAT_METRICS = [
  { label: 'Total Assets', key: 'total_assets', icon: Package, tone: 'assets' },
  { label: 'Locations', key: 'total_locations', icon: MapPin, tone: 'locations' },
  { label: 'Asset Types', key: 'total_types', icon: Layers, tone: 'types' },
  { label: 'Tagged', key: 'tagged', icon: ScanLine, tone: 'tagged' },
  { label: 'Untagged', key: 'untagged', icon: CircleOff, tone: 'untagged' },
];

function buildLocationTree(items, parentId = null) {
  return items
    .filter(i => (i.parent_id || null) == parentId)
    .map(i => ({ ...i, children: buildLocationTree(items, i.id) }));
}

/** Flat list → ids to keep: matches, their ancestors (path), and descendants (context under a match). */
function filterLocationsBySearch(locations, queryNorm) {
  if (!queryNorm) return locations;
  const byId = Object.fromEntries(locations.map(l => [l.id, l]));
  const childrenByParent = {};
  for (const l of locations) {
    const p = l.parent_id ?? null;
    if (!childrenByParent[p]) childrenByParent[p] = [];
    childrenByParent[p].push(l.id);
  }
  const matches = new Set();
  for (const l of locations) {
    if (String(l.name || '').toLowerCase().includes(queryNorm)) matches.add(l.id);
  }
  if (matches.size === 0) return [];
  const idsToShow = new Set();
  const addAncestors = (id) => {
    let cur = byId[id];
    while (cur) {
      idsToShow.add(cur.id);
      cur = cur.parent_id != null && cur.parent_id !== undefined ? byId[cur.parent_id] : null;
    }
  };
  const addDescendants = (id) => {
    const stack = [id];
    while (stack.length) {
      const n = stack.pop();
      idsToShow.add(n);
      for (const c of childrenByParent[n] || []) stack.push(c);
    }
  };
  for (const id of matches) {
    addAncestors(id);
    addDescendants(id);
  }
  return locations.filter(l => idsToShow.has(l.id));
}

function AssetTypeBarChart({ rows }) {
  const data = useMemo(
    () => [...rows].sort((a, b) => b.count - a.count),
    [rows],
  );
  const h = Math.min(400, Math.max(160, data.length * 32 + 48));
  if (data.length === 0) {
    return (
      <div style={{ padding: 28, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
        No assets in this view yet
      </div>
    );
  }
  return (
    <div style={{ overflowY: 'auto', maxHeight: 440 }}>
      <ResponsiveContainer width="100%" height={h}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 48, left: 8, bottom: 8 }}>
          <defs>
            <linearGradient id="dashAssetBlue" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#4F9CE8" />
              <stop offset="100%" stopColor="#C5E3FA" />
            </linearGradient>
            <linearGradient id="dashAssetPurple" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#9B7EDE" />
              <stop offset="100%" stopColor="#D8CCF5" />
            </linearGradient>
            <linearGradient id="dashAssetCoral" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#EF8A82" />
              <stop offset="100%" stopColor="#F5C4BE" />
            </linearGradient>
            <linearGradient id="dashAssetMint" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#5CB8A8" />
              <stop offset="100%" stopColor="#B8E8DE" />
            </linearGradient>
            <linearGradient id="dashAssetSky" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#38BDF8" />
              <stop offset="100%" stopColor="#BAE6FD" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CHART_GRID} />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11, fill: '#334155' }} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v) => [v, 'Assets']} />
          <Bar dataKey="count" radius={[0, 10, 10, 0]} maxBarSize={26}>
            {data.map((_, i) => (
              <Cell key={`${i}-${data[i].name}`} fill={['url(#dashAssetBlue)', 'url(#dashAssetPurple)', 'url(#dashAssetCoral)', 'url(#dashAssetMint)', 'url(#dashAssetSky)'][i % 5]} />
            ))}
            <LabelList dataKey="count" position="right" style={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────
export default function Dashboard() {
  const [data, setData] = useState(null);
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [mapImage, setMapImage] = useState(() => localStorage.getItem(MAP_STORAGE_KEY) || null);
  const [pins, setPins] = useState(() => { try { return JSON.parse(localStorage.getItem(PINS_STORAGE_KEY) || '{}'); } catch { return {}; } });
  const [placingPin, setPlacingPin] = useState(null); // locationId being placed
  const [selectedLocation, setSelectedLocation] = useState(null); // scopes dashboard + chart (tree or pin)
  const [popupLocation, setPopupLocation] = useState(null); // location detail modal (tree or map pin)
  const [locations, setLocations] = useState([]);
  const [locationSearch, setLocationSearch] = useState('');
  const [showPinPanel, setShowPinPanel] = useState(false);
  const [popupDetail, setPopupDetail] = useState(null);
  const [popupLoading, setPopupLoading] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const mapRef = useRef();

  useEffect(() => {
    if (!popupLocation) {
      setPopupDetail(null);
      setPopupLoading(false);
      return;
    }
    let cancelled = false;
    setPopupDetail(null);
    setPopupLoading(true);
    getDashboardLocation(popupLocation.id)
      .then(r => { if (!cancelled) setPopupDetail(r.data); })
      .catch((e) => {
        if (!cancelled) {
          setPopupDetail(null);
          toastApiFailure(e, 'Location details');
        }
      })
      .finally(() => { if (!cancelled) setPopupLoading(false); });
    return () => { cancelled = true; };
  }, [popupLocation]);

  useEffect(() => {
    let cancelled = false;
    setDashboardLoading(true);
    getDashboard(selectedLocation?.id ?? null)
      .then(r => { if (!cancelled) setData(r.data); })
      .catch((e) => { if (!cancelled) toastApiFailure(e, 'Dashboard'); })
      .finally(() => { if (!cancelled) setDashboardLoading(false); });
    return () => { cancelled = true; };
  }, [selectedLocation?.id]);

  useEffect(() => {
    api.get('/alerts').then(r => setRecentAlerts(r.data.slice(0, 3)))
      .catch((e) => toastApiFailure(e, 'Alerts'));
    // Use getLocations() so user_id is automatically attached → server filters by privilege
    getLocations().then(r => setLocations(r.data))
      .catch((e) => toastApiFailure(e, 'Locations'));
  }, []);

  const savePins = (newPins) => {
    setPins(newPins);
    localStorage.setItem(PINS_STORAGE_KEY, JSON.stringify(newPins));
  };

  const handleMapUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => { setMapImage(evt.target.result); localStorage.setItem(MAP_STORAGE_KEY, evt.target.result); };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const clearMap = () => { setMapImage(null); localStorage.removeItem(MAP_STORAGE_KEY); savePins({}); };

  // Click on map to place a pin
  const handleMapClick = useCallback((e) => {
    if (!placingPin) return;
    const rect = mapRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    savePins({ ...pins, [placingPin]: { x, y } });
    setPlacingPin(null);
  }, [placingPin, pins]);

  const removePin = (locId) => {
    const next = { ...pins };
    delete next[locId];
    savePins(next);
  };

  const missing      = data ? (data.rfid_breakdown?.untagged || 0) : 0;
  const scannedToday = data?.recent_movements?.length || 0;

  const locationSearchNorm = locationSearch.trim().toLowerCase();
  const filteredLocations = useMemo(
    () => filterLocationsBySearch(locations, locationSearchNorm),
    [locations, locationSearchNorm],
  );
  const locationTree = buildLocationTree(filteredLocations);

  const distributionRows = useMemo(() => {
    if (!data?.assets_by_type) return [];
    return data.assets_by_type
      .map(r => ({ name: r.type, count: Number(r.count) || 0 }))
      .filter(r => r.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [data]);

  /** Remount chart when dashboard payload or scope changes */
  const distributionChartKey = `chart-${selectedLocation?.id ?? 'all'}-${data?.total_assets ?? 0}-${dashboardLoading ? 'l' : 'r'}`;
  const scopeLabel = data?.location?.name || selectedLocation?.name || 'All Locations';
  const locationDistRows = data?.locationDistribution ?? [];
  const monthlyDistRows = data?.monthlyDistribution ?? [];

  const clearLocationScope = () => {
    setSelectedLocation(null);
    setPopupLocation(null);
  };

  const chartScopeAction = selectedLocation ? (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      style={{ fontSize: 11, flexShrink: 0, marginTop: 2 }}
      onClick={clearLocationScope}
    >
      All locations
    </button>
  ) : null;

  // Collapsible tree node for dashboard
  function DashLocNode({ loc, depth = 0 }) {
    const [expanded, setExpanded] = useState(true);
    const hasChildren = loc.children && loc.children.length > 0;
    const hasPinned = !!pins[loc.id];
    const isSelected = selectedLocation && String(selectedLocation.id) === String(loc.id);

    return (
      <div>
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: `7px 14px 7px ${14 + depth * 16}px`,
            borderBottom: '1px solid #f7f8fc', fontSize: 13,
            transition: 'background 0.1s',
            background: isSelected ? '#eff6ff' : undefined,
          }}
          onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f8fafc'; }}
          onMouseLeave={e => { e.currentTarget.style.background = isSelected ? '#eff6ff' : 'transparent'; }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
            {/* Single expand/collapse toggle — only shown when has children */}
            {hasChildren ? (
              <span
                onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
                style={{ color: '#94a3b8', fontSize: 10, cursor: 'pointer', width: 14, flexShrink: 0, userSelect: 'none' }}
              >
                {expanded ? '▾' : '▸'}
              </span>
            ) : (
              <span style={{ width: 14, flexShrink: 0 }} />
            )}
            <span
              onClick={() => {
                setSelectedLocation({ id: loc.id, name: loc.name });
                setPopupLocation({ id: loc.id, name: loc.name });
              }}
              style={{
                cursor: 'pointer',
                color: hasPinned ? '#2563EB' : depth === 0 ? '#0f172a' : '#475569',
                fontWeight: depth === 0 ? 600 : 400,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {hasPinned && <span style={{ marginRight: 4 }}>📍</span>}
              {loc.name}
            </span>
          </span>

          {/* Pin controls — only shown when pin panel is open */}
          {showPinPanel && (
            hasPinned ? (
              <button
                onClick={e => { e.stopPropagation(); removePin(loc.id); }}
                style={{ fontSize: 10, padding: '2px 6px', background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 5, cursor: 'pointer', flexShrink: 0 }}
              >✕</button>
            ) : (
              <button
                onClick={e => { e.stopPropagation(); setPlacingPin(placingPin === String(loc.id) ? null : String(loc.id)); }}
                style={{
                  fontSize: 10, padding: '2px 6px', borderRadius: 5, cursor: 'pointer', flexShrink: 0,
                  background: placingPin === String(loc.id) ? '#2563EB' : '#f1f5f9',
                  color: placingPin === String(loc.id) ? '#fff' : '#64748b',
                  border: `1px solid ${placingPin === String(loc.id) ? '#2563EB' : '#e2e8f0'}`,
                }}
              >+ Pin</button>
            )
          )}
        </div>

        {/* Children — only rendered when expanded */}
        {expanded && hasChildren && loc.children.map(child => (
          <DashLocNode key={child.id} loc={child} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <h1>Dashboard</h1>
        {selectedLocation && (
          <p className="dashboard-scope">
            Showing metrics for <strong>{scopeLabel}</strong>
          </p>
        )}
      </div>

      {/* Stat cards */}
      <div className="stat-cards">
        {STAT_METRICS.map(({ label, key, icon: Icon, tone }) => {
          let value = '—';
          if (!dashboardLoading) {
            if (key === 'tagged') value = data?.rfid_breakdown?.tagged ?? '—';
            else if (key === 'untagged') value = data?.rfid_breakdown?.untagged ?? '—';
            else value = data?.[key] ?? '—';
          } else value = '...';
          return (
            <div
              className={`stat-card ${STAT_CARD_CLASS[tone]}`}
              key={label}
            >
              <div className="stat-icon-wrap">
                <Icon size={22} strokeWidth={2} aria-hidden />
              </div>
              <div className="stat-info">
                <span className="value">{value}</span>
                <span className="label">{label}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, alignItems: 'stretch' }}>

        {/* Left panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Inventory Summary */}
          <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', padding: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: '#1a1f36' }}>Inventory Summary</div>
            {[
              { label: 'Total Inventory', value: dashboardLoading ? '...' : (data?.total_assets ?? '—'), color: '#1a1f36' },
              { label: 'Missing Inventory', value: dashboardLoading ? '...' : missing, color: '#e53e3e' },
              { label: 'Scanned Today', value: dashboardLoading ? '...' : scannedToday, color: '#276749' },
              { label: 'Asset Types', value: dashboardLoading ? '...' : (data?.total_types ?? '—'), color: '#5a67d8' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 0', borderBottom: '1px solid #f7f8fc' }}>
                <span style={{ color: '#555' }}>{label}</span>
                <strong style={{ color }}>{value}</strong>
              </div>
            ))}
          </div>

          {/* Location tree with pin controls */}
          <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #e2e8f0', background: '#f7f8fc' }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Locations</span>
              {mapImage && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setShowPinPanel(p => !p)} style={{ fontSize: 11 }}>
                    📍 {showPinPanel ? 'Done' : 'Place Pins'}
                  </button>
                  {Object.keys(pins).length > 0 && (
                    <button className="btn btn-danger btn-sm" style={{ fontSize: 11 }} onClick={() => savePins({})}>
                      Clear Pins
                    </button>
                  )}
                </div>
              )}
            </div>
            <div style={{ padding: '8px 10px', borderBottom: '1px solid #f7f8fc' }}>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none', display: 'flex' }}>
                  <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                  </svg>
                </span>
                <input
                  type="search"
                  value={locationSearch}
                  onChange={e => setLocationSearch(e.target.value)}
                  placeholder="Search locations…"
                  aria-label="Search locations"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px 6px 28px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, background: '#fafbfc' }}
                />
              </div>
            </div>
            <div style={{ maxHeight: 280, overflowY: 'auto' }}>
              {locations.length === 0 ? (
                <div style={{ padding: '16px 14px', fontSize: 13, color: '#aaa' }}>No locations available</div>
              ) : locationTree.length === 0 ? (
                <div style={{ padding: '16px 14px', fontSize: 13, color: '#94a3b8' }}>No locations match your search</div>
              ) : (
                locationTree.map(loc => <DashLocNode key={loc.id} loc={loc} depth={0} />)
              )}
            </div>
          </div>

        </div>

        {/* Map panel */}
        <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #f0f2f5' }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1f36' }}>
              {selectedLocation ? 'Location map' : 'Global Asset Map'}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {placingPin && (
                <span style={{ fontSize: 12, color: '#7c8cf8', fontWeight: 500 }}>
                  Click on map to place pin for "{locations.find(l => String(l.id) === placingPin)?.name}"
                </span>
              )}
              <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', marginBottom: 0 }}>
                📁 Upload Map
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleMapUpload} />
              </label>
              {mapImage && <button className="btn btn-secondary btn-sm" onClick={clearMap}>✕ Clear</button>}
            </div>
          </div>

          <div
            ref={mapRef}
            onClick={handleMapClick}
            style={{ position: 'relative', flex: 1, minHeight: 0, background: '#e8edf2', cursor: placingPin ? 'crosshair' : 'default', userSelect: 'none' }}
          >
            {mapImage ? (
              <img src={mapImage} alt="Asset Map" style={{ width: '100%', height: '100%', objectFit: 'contain', maxHeight: 520, display: 'block' }} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, minHeight: 0, height: '100%', color: '#a0aec0' }}>
                <div style={{ fontSize: 52, marginBottom: 12 }}>🗺️</div>
                <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 8 }}>No map uploaded</div>
                <div style={{ fontSize: 13, marginBottom: 16 }}>Upload a floor plan, site map, or world map image</div>
                <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
                  Upload Map Image
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleMapUpload} />
                </label>
              </div>
            )}

            {/* Location pins */}
            {mapImage && Object.entries(pins).map(([locId, pos]) => {
              const loc = locations.find(l => String(l.id) === locId);
              if (!loc) return null;
              return (
                <div
                  key={locId}
                  onClick={e => {
                    e.stopPropagation();
                    if (placingPin) return;
                    setSelectedLocation({ id: loc.id, name: loc.name });
                    setPopupLocation({ id: loc.id, name: loc.name });
                  }}
                  style={{
                    position: 'absolute',
                    left: `${pos.x}%`, top: `${pos.y}%`,
                    transform: 'translate(-50%, -100%)',
                    cursor: 'pointer',
                    zIndex: 10,
                  }}
                >
                  {/* Pin */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{
                      background: '#1a1f36', color: '#fff', fontSize: 11, fontWeight: 600,
                      padding: '3px 7px', borderRadius: 4, whiteSpace: 'nowrap',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                      maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {loc.name}
                    </div>
                    <div style={{ width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '8px solid #1a1f36' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Charts — asset type, location bar, monthly trend */}
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <DashboardChartCard
          title="Asset Type Distribution"
          subtitle={scopeLabel}
          action={chartScopeAction}
        >
          {dashboardLoading && !data ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading chart...</div>
          ) : dashboardLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Updating chart...</div>
          ) : (
            <AssetTypeBarChart key={distributionChartKey} rows={distributionRows} />
          )}
        </DashboardChartCard>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: 16, alignItems: 'stretch' }}>
          <DashboardChartCard
            title="Location Based Distribution"
            subtitle={scopeLabel}
            action={chartScopeAction}
          >
            {dashboardLoading ? (
              <div style={chartLoadingShellStyle}>
                {data ? 'Updating chart...' : 'Loading chart...'}
              </div>
            ) : (
              <LocationDistributionBarChart
                key={`loc-bar-${distributionChartKey}`}
                rows={locationDistRows}
              />
            )}
          </DashboardChartCard>

          <DashboardChartCard
            title="Monthly Asset Distribution"
            subtitle={`Assets created per month (current year) · ${scopeLabel}`}
            action={chartScopeAction}
          >
            {dashboardLoading ? (
              <div style={chartLoadingShellStyle}>
                {data ? 'Updating chart...' : 'Loading chart...'}
              </div>
            ) : (
              <MonthlyDistributionAreaChart
                key={`monthly-${distributionChartKey}`}
                rows={monthlyDistRows}
              />
            )}
          </DashboardChartCard>
        </div>
      </div>

      {popupLocation && (
        <LocationDetailPopup
          locationName={popupLocation.name}
          detail={popupDetail}
          loading={popupLoading}
          onClose={() => setPopupLocation(null)}
        />
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, Legend,
  LineChart, Line, XAxis, YAxis, ResponsiveContainer,
  CartesianGrid, BarChart, Bar, LabelList,
} from 'recharts';
import api from '../api';
import { toastApiFailure } from '../apiErrorHandling';
import { exportExcel, exportPDF, exportExcelSections, exportPDFSections } from '../export';
import { T, PALETTE, ExportBtn, ReportCard, ChartTooltip, StatPill, Empty } from './reports/ui';
import OverallReports from './reports/OverallReports';

/** List endpoints return `{ from, to, data: [...] }` or a bare array. */
function reportListPayload(body) {
  if (!body) return [];
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.data)) return body.data;
  return [];
}

/** Detail rows for exports — backend sends `assets` (some payloads may use `asset`). */
function reportAssetsPayload(body) {
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body.assets)) return body.assets;
  if (Array.isArray(body.asset)) return body.asset;
  return [];
}

/** Shared column defs — same headers for Excel and PDF. */
const REPORT_ASSET_EXPORT_COLUMNS = [
  { header: 'S.No', key: 's_no' },
  { header: 'Asset ID / Asset Serial', key: 'asset_code' },
  { header: 'Asset Name', key: 'asset_name' },
  { header: 'Tag Type', key: 'tag_type_name' },
  { header: 'Location', key: 'location' },
  { header: 'Assigned To', key: 'assigned_to' },
  { header: 'Status', key: 'asset_status' },
  { header: 'Created', key: 'created_at' },
];

const INVENTORY_MISSING_EXPORT_COLUMNS = [
  ...REPORT_ASSET_EXPORT_COLUMNS,
  { header: 'Report Status', key: 'report_status' },
  { header: 'Movements in Period', key: 'movement_count' },
  { header: 'Last Movement', key: 'last_movement_at' },
];

function formatExportDate(value) {
  if (value == null || value === '') return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAssetRowsForExport(assets) {
  if (!Array.isArray(assets)) return [];
  return assets.map((a, index) => ({
    ...a,
    s_no: index + 1,
    asset_code: (a?.asset_code || '').toString().trim() || '—',
    tag_type_name: (a?.tag_type_name || a?.asset_type || '').toString().trim() || '—',
    created_at: formatExportDate(a?.created_at),
    last_movement_at: formatExportDate(a?.last_movement_at),
    movement_count: a?.movement_count ?? 0,
  }));
}

function exportReportAssetsExcel(rows, filename) {
  exportExcel(REPORT_ASSET_EXPORT_COLUMNS, formatAssetRowsForExport(rows), filename);
}

function exportReportAssetsPDF(rows, title, filename) {
  exportPDF(REPORT_ASSET_EXPORT_COLUMNS, formatAssetRowsForExport(rows), title, filename);
}

/** Inventory vs Missing — backend `inventory_assets` + `missing_assets`. */
function inventoryMissingAssetLists(body) {
  if (!body || typeof body !== 'object') {
    return { inventory: [], missing: [] };
  }
  if (Array.isArray(body.inventory_assets) || Array.isArray(body.missing_assets)) {
    return {
      inventory: Array.isArray(body.inventory_assets) ? body.inventory_assets : [],
      missing: Array.isArray(body.missing_assets) ? body.missing_assets : [],
    };
  }
  const assets = Array.isArray(body.assets) ? body.assets : [];
  return {
    inventory: assets.filter((a) => a.report_status === 'In Stock'),
    missing: assets.filter((a) => a.report_status === 'Missing'),
  };
}

function inventoryMissingExportSections(body) {
  const { inventory: inventoryRaw, missing: missingRaw } = inventoryMissingAssetLists(body);
  const inventory = formatAssetRowsForExport(inventoryRaw);
  const missing = formatAssetRowsForExport(missingRaw);
  const columns = INVENTORY_MISSING_EXPORT_COLUMNS;
  return [
    { name: 'In Stock', title: 'In Stock (movement in period)', columns, rows: inventory },
    { name: 'Missing Assets', title: 'Missing (no movement in period)', columns, rows: missing },
  ];
}

function exportInventoryMissingExcel(body, filename, rangeLabel) {
  exportExcelSections(
    inventoryMissingExportSections(body).map(({ title, columns, rows }) => ({
      title,
      columns,
      rows,
    })),
    filename,
    {
      sheetName: 'Inventory vs Missing',
      reportTitle: rangeLabel ? `Inventory vs Missing (${rangeLabel})` : 'Inventory vs Missing',
    }
  );
}

function exportInventoryMissingPDF(body, title, filename) {
  exportPDFSections(
    inventoryMissingExportSections(body).map(({ title: sectionTitle, columns, rows }) => ({
      title: sectionTitle,
      columns,
      rows,
    })),
    title,
    filename
  );
}

/* ─── Dashboard Reports ──────────────────────────────────────── */
function DashboardReports() {
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().split('T')[0]);

  const [inventoryMissing, setInventoryMissing] = useState(null);
  const [assetsByType, setAssetsByType] = useState([]);
  const [assetsByLoc, setAssetsByLoc] = useState([]);
  const [missingByLoc, setMissingByLoc] = useState([]);
  const [activeUsers, setActiveUsers] = useState([]);
  const [exportAssetsByType, setExportAssetsByType] = useState([]);
  const [exportAssetsByLocation, setExportAssetsByLocation] = useState([]);
  const [exportAssetsMissingByLocation, setExportAssetsMissingByLocation] = useState([]);

  const load = () => {
    const params = { from: fromDate, to: toDate };
    api.get('/reports/inventory-missing', { params }).then(r => setInventoryMissing(r.data))
      .catch((e) => toastApiFailure(e, 'Reports · Inventory'));
    api.get('/reports/assets-by-type', { params }).then((r) => {
      const body = r.data;
      setAssetsByType(reportListPayload(body));
      setExportAssetsByType(reportAssetsPayload(body));
    }).catch((e) => toastApiFailure(e, 'Reports · Assets by type'));
    api.get('/reports/assets-by-location', { params }).then((r) => {
      const body = r.data;
      setAssetsByLoc(reportListPayload(body));
      setExportAssetsByLocation(reportAssetsPayload(body));
    }).catch((e) => toastApiFailure(e, 'Reports · By location'));
    api.get('/reports/missing-by-location', { params }).then((r) => {
      const body = r.data;
      setMissingByLoc(reportListPayload(body));
      setExportAssetsMissingByLocation(reportAssetsPayload(body));
    }).catch((e) => toastApiFailure(e, 'Reports · Missing by location'));
    api.get('/reports/most-active-users', { params }).then(r => setActiveUsers(reportListPayload(r.data)))
      .catch((e) => toastApiFailure(e, 'Reports · Active users'));
  };

  useEffect(() => { load(); }, []);

  const invData = inventoryMissing ? [
    { name: 'In Stock', value: inventoryMissing.inventory },
    { name: 'Missing', value: inventoryMissing.missing },
  ] : [];

  const typeH = Math.max(220, assetsByType.length * 40);
  const locH = Math.max(220, assetsByLoc.length * 40);
  const missingH = Math.max(180, missingByLoc.length * 40);

  const axisStyle = { fontSize: 11, fill: T.muted, fontFamily: 'inherit' };
  const rangeLabel = `${fromDate} → ${toDate}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{
        background: T.card, borderRadius: T.radius,
        boxShadow: T.shadow, border: `1px solid ${T.border}`,
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: T.sub }}>Date Range</span>
        {[
          { label: 'From', val: fromDate, set: setFromDate },
          { label: 'To', val: toDate, set: setToDate },
        ].map(({ label, val, set }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: T.muted }}>{label}</span>
            <input
              type="date"
              value={val}
              onChange={e => set(e.target.value)}
              style={{
                padding: '5px 10px', border: `1px solid ${T.border}`,
                borderRadius: 7, fontSize: 12.5, color: T.text,
                background: '#fff', outline: 'none',
              }}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={load}
          style={{
            padding: '6px 16px', borderRadius: 7, fontSize: 12.5, fontWeight: 600,
            background: T.blue, color: '#fff', border: 'none', cursor: 'pointer',
          }}
        >
          Apply
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

      {/* ── Inventory vs Missing ── */}
      <ReportCard
        title="Inventory vs Missing"
        subtitle={`With movement in range vs none (${rangeLabel})`}
        onExcel={() => exportInventoryMissingExcel(
          inventoryMissing,
          'inventory-vs-missing',
          rangeLabel
        )}
        onPDF={() => exportInventoryMissingPDF(
          inventoryMissing,
          `Inventory vs Missing (${rangeLabel})`,
          'inventory-vs-missing'
        )}
        minH={260}
      >
        {inventoryMissing ? (
          <>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <StatPill label="In Stock"  value={inventoryMissing.inventory} color={T.green}  bg={T.greenL} />
              <StatPill label="Missing"   value={inventoryMissing.missing}   color={T.red}    bg={T.redL}   />
              <StatPill label="Total"     value={inventoryMissing.total}     color={T.blue}   bg={T.blueL}  />
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={invData} dataKey="value" nameKey="name"
                  cx="50%" cy="50%" innerRadius={52} outerRadius={78}
                  paddingAngle={3} strokeWidth={0}>
                  <Cell fill={T.green} />
                  <Cell fill={T.red}   />
                </Pie>
                <Tooltip content={<ChartTooltip />} />
                <Legend
                  iconType="circle" iconSize={8}
                  formatter={v => <span style={{ fontSize: 12, color: T.sub }}>{v}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          </>
        ) : <Empty msg="Loading inventory data..." />}
      </ReportCard>

      {/* ── Most Active Users ── */}
      <ReportCard
        title="Most Active Users"
        subtitle={`Logins in selected period (${rangeLabel})`}
        onExcel={() => exportExcel(
          [{ header: 'Username', key: 'username' }, { header: 'Logins', key: 'login_count' }],
          activeUsers, 'active-users'
        )}
        onPDF={() => exportPDF(
          [{ header: 'Username', key: 'username' }, { header: 'Logins', key: 'login_count' }],
          activeUsers, `Most Active Users (${rangeLabel})`, 'active-users'
        )}
        minH={260}
      >
        {activeUsers.filter(u => u.login_count > 0).length === 0 ? (
          <Empty msg="No login data yet" />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={activeUsers.filter(u => u.login_count > 0)}
                dataKey="login_count" nameKey="username"
                cx="40%" cy="50%" outerRadius={85}
                paddingAngle={2} strokeWidth={0}
              >
                {activeUsers.filter(u => u.login_count > 0).map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} formatter={(v, n) => [`${v} logins`, n]} />
              <Legend
                layout="vertical" align="right" verticalAlign="middle"
                iconType="circle" iconSize={8}
                formatter={(v, e) => (
                  <span style={{ fontSize: 11.5, color: T.sub }}>
                    {v} <span style={{ color: T.faint }}>({e.payload.login_count})</span>
                  </span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </ReportCard>

      {/* ── Assets by Type ── */}
      <ReportCard
        title="Assets by Type"
        subtitle={`Assets created in period (${rangeLabel})`}
        onExcel={() => exportReportAssetsExcel(
          exportAssetsByType,
          'assets-by-type-detail'
        )}
        onPDF={() => exportReportAssetsPDF(
          exportAssetsByType,
          `Assets by type — full detail (${rangeLabel})`,
          'assets-by-type-detail'
        )}
      >
        {assetsByType.length === 0 ? <Empty /> : (
          <div style={{ overflowY: 'auto', maxHeight: 340 }}>
            <ResponsiveContainer width="100%" height={typeH}>
              <BarChart data={assetsByType} layout="vertical"
                margin={{ top: 4, right: 52, left: 4, bottom: 4 }}>
                <XAxis type="number" allowDecimals={false} tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="type" tick={axisStyle} width={130} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: T.blueL }} />
                <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={22}>
                  {assetsByType.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  <LabelList dataKey="count" position="right"
                    style={{ fontSize: 11, fill: T.muted, fontWeight: 600 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ReportCard>

      {/* ── Assets by Location ── */}
      <ReportCard
        title="Assets by Location"
        subtitle={`Top locations — assets created in period (${rangeLabel})`}
        onExcel={() => exportReportAssetsExcel(
          exportAssetsByLocation,
          'assets-by-location-detail'
        )}
        onPDF={() => exportReportAssetsPDF(
          exportAssetsByLocation,
          `Assets by location — full detail (${rangeLabel})`,
          'assets-by-location-detail'
        )}
      >
        {assetsByLoc.length === 0 ? <Empty /> : (
          <div style={{ overflowY: 'auto', maxHeight: 340 }}>
            <ResponsiveContainer width="100%" height={locH}>
              <BarChart data={assetsByLoc} layout="vertical"
                margin={{ top: 4, right: 52, left: 4, bottom: 4 }}>
                <XAxis type="number" allowDecimals={false} tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="location" tick={axisStyle} width={130} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: T.blueL }} />
                <Bar dataKey="count" radius={[0, 6, 6, 0]} fill={T.blue} maxBarSize={22}>
                  <LabelList dataKey="count" position="right"
                    style={{ fontSize: 11, fill: T.muted, fontWeight: 600 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </ReportCard>

      {/* ── Missing by Location (full width) ── */}
      <ReportCard
        title="Locations with Missing Assets"
        subtitle={`Inactive assets created in period (${rangeLabel})`}
        fullWidth
        onExcel={() => exportReportAssetsExcel(
          exportAssetsMissingByLocation,
          'missing-by-location-detail'
        )}
        onPDF={() => exportReportAssetsPDF(
          exportAssetsMissingByLocation,
          `Missing assets by location — full detail (${rangeLabel})`,
          'missing-by-location-detail'
        )}
      >
        {missingByLoc.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 0', gap: 6 }}>
            <div style={{ fontSize: 28 }}>🎉</div>
            <div style={{ fontSize: 13, color: T.faint }}>No missing assets — all locations are fully stocked</div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={missingH}>
            <BarChart data={missingByLoc} layout="vertical"
              margin={{ top: 4, right: 64, left: 4, bottom: 4 }}>
              <XAxis type="number" allowDecimals={false} tick={axisStyle} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="location" tick={axisStyle} width={150} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: T.redL }} />
              <Bar dataKey="missing_count" name="Missing" radius={[0, 6, 6, 0]} fill={T.red} maxBarSize={22}>
                <LabelList dataKey="missing_count" position="right"
                  style={{ fontSize: 11, fill: T.muted, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ReportCard>

      </div>
    </div>
  );
}

/* ─── Tagging Progress ───────────────────────────────────────── */
function TaggingReports() {
  const [data, setData] = useState([]);
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().split('T')[0]);

  const load = () => {
    api.get('/reports/tagging-progress', { params: { from: fromDate, to: toDate } })
      .then(r => setData(reportListPayload(r.data)))
      .catch((e) => toastApiFailure(e, 'Reports · Tagging'));
  };
  useEffect(() => { load(); }, []);

  const axisStyle = { fontSize: 11, fill: T.muted, fontFamily: 'inherit' };
  const gridStyle = { stroke: T.border, strokeDasharray: '4 4' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Filter bar */}
      <div style={{
        background: T.card, borderRadius: T.radius,
        boxShadow: T.shadow, border: `1px solid ${T.border}`,
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: T.sub }}>Date Range</span>
        {[
          { label: 'From', val: fromDate, set: setFromDate },
          { label: 'To',   val: toDate,   set: setToDate   },
        ].map(({ label, val, set }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: T.muted }}>{label}</span>
            <input type="date" value={val} onChange={e => set(e.target.value)}
              style={{
                padding: '5px 10px', border: `1px solid ${T.border}`,
                borderRadius: 7, fontSize: 12.5, color: T.text,
                background: '#fff', outline: 'none',
              }} />
          </div>
        ))}
        <button onClick={load} style={{
          padding: '6px 16px', borderRadius: 7, fontSize: 12.5, fontWeight: 600,
          background: T.blue, color: '#fff', border: 'none', cursor: 'pointer',
        }}>
          Apply
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <ExportBtn type="excel" onClick={() => exportExcel(
            [{ header: 'Date', key: 'date' }, { header: 'Daily', key: 'count' }, { header: 'Cumulative', key: 'cumulative' }],
            data, 'tagging-progress'
          )} />
          <ExportBtn type="pdf" onClick={() => exportPDF(
            [{ header: 'Date', key: 'date' }, { header: 'Daily', key: 'count' }, { header: 'Cumulative', key: 'cumulative' }],
            data, `Tagging Progress (${fromDate} → ${toDate})`, 'tagging-progress'
          )} />
        </div>
      </div>

      {/* Summary pills */}
      {data.length > 0 && (
        <div style={{ display: 'flex', gap: 12 }}>
          <StatPill label="Total Tagged"    value={data[data.length - 1]?.cumulative ?? 0} color={T.blue}  bg={T.blueL}  />
          <StatPill label="Days in Range"   value={data.length}                             color={T.purple} bg={T.purpleL} />
          <StatPill label="Peak Day"        value={Math.max(...data.map(d => d.count))}     color={T.green}  bg={T.greenL}  />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        <ReportCard title="Daily Tagging Activity" subtitle="Assets that received a 24-character RFID tag per day">
          {data.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid {...gridStyle} />
                <XAxis dataKey="date" tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={axisStyle} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="count" name="Tagged"
                  stroke={T.blue} strokeWidth={2.5} dot={{ r: 3, fill: T.blue, strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: T.blue }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ReportCard>

        <ReportCard title="Cumulative Tagging Progress" subtitle="Running total of RFID tag assignments in range">
          {data.length === 0 ? <Empty /> : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid {...gridStyle} />
                <XAxis dataKey="date" tick={axisStyle} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={axisStyle} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="cumulative" name="Cumulative"
                  stroke={T.green} strokeWidth={2.5} dot={{ r: 3, fill: T.green, strokeWidth: 0 }}
                  activeDot={{ r: 5, fill: T.green }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ReportCard>

      </div>
    </div>
  );
}

/* ─── Report tab icons (inline SVG, uses currentColor) ───────── */
function ReportTabIconDashboard() {
  /* Bold column bars — reads clearly at tab size (no pie/donut arc confusion). */
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" aria-hidden>
      <path d="M6.5 19.5V10.5M12 19.5V6.5M17.5 19.5V12" />
    </svg>
  );
}

function ReportTabIconTagging() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4.5 16.5L9 10.5l4 4L19.5 6" />
      <circle cx="19.5" cy="6" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ReportTabIconOverall() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 5h16l-6 7.5V19l-4-2v-4.5L4 5z" />
    </svg>
  );
}

/* ─── Tab button ─────────────────────────────────────────────── */
function TabBtn({ active, onClick, children }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: '8px 18px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        border: 'none',
        borderBottom: active ? `2px solid ${T.blue}` : '2px solid transparent',
        background: 'transparent',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        color: active ? T.blue : hov ? T.sub : T.muted,
        letterSpacing: '0.01em',
        transition: 'all 0.15s',
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}

/* ─── Main Reports Page ──────────────────────────────────────── */
export default function Reports() {
  const [tab, setTab] = useState('dashboard');

  return (
    <div style={{ background: T.bg, minHeight: '100%', padding: '24px 28px' }}>

      {/* Page header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: T.text, letterSpacing: '-0.02em' }}>Reports</div>
        <div style={{ fontSize: 13, color: T.muted, marginTop: 4 }}>
          Analytics and insights for your RFID asset management system
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        display: 'flex', gap: 0,
        borderBottom: `1px solid ${T.border}`,
        marginBottom: 20,
        background: T.card,
        borderRadius: `${T.radius}px ${T.radius}px 0 0`,
        padding: '0 8px',
        boxShadow: T.shadow,
        border: `1px solid ${T.border}`,
      }}>
        <TabBtn active={tab === 'dashboard'} onClick={() => setTab('dashboard')}>
          <ReportTabIconDashboard />
          Dashboard Reports
        </TabBtn>
        <TabBtn active={tab === 'tagging'} onClick={() => setTab('tagging')}>
          <ReportTabIconTagging />
          Tagging Progress
        </TabBtn>
        <TabBtn active={tab === 'overall'} onClick={() => setTab('overall')}>
          <ReportTabIconOverall />
          Custom Reports
        </TabBtn>
      </div>

      {tab === 'dashboard' && <DashboardReports />}
      {tab === 'tagging'   && <TaggingReports />}
      {tab === 'overall'   && <OverallReports />}
    </div>
  );
}

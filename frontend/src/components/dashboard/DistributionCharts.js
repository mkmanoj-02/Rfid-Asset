import { useMemo, useId } from 'react';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
  LabelList,
} from 'recharts';

import {
  CHART_ACCENT,
  CHART_GRID,
  CHART_PIE_FILLS,
  CHART_PRIMARY,
  CHART_TICK,
  CHART_TICK_MUTED,
} from './chartTheme';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Fixed plot height for dashboard location + monthly charts (keeps cards aligned). */
export const DASHBOARD_DIST_CHART_HEIGHT = 260;

export const chartPlotShellStyle = {
  width: '100%',
  height: DASHBOARD_DIST_CHART_HEIGHT,
  minHeight: DASHBOARD_DIST_CHART_HEIGHT,
};

export const chartLoadingShellStyle = {
  ...chartPlotShellStyle,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#94a3b8',
  fontSize: 13,
};

/** Shared plot insets so location + monthly charts align visually. */
const DIST_CHART_MARGIN = { top: 12, right: 20, left: 12, bottom: 16 };
const DIST_Y_AXIS_WIDTH = 40;

function truncateAxisLabel(name, maxLen = 11) {
  const s = String(name ?? '');
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
}

function ChartViewport({ children }) {
  return (
    <div className="dash-chart-plot">
      <div className="dash-chart-plot__inner">{children}</div>
    </div>
  );
}

const TICK = CHART_TICK_MUTED;
const TICK_DARK = CHART_TICK;

const TOOLTIP_BOX = {
  background: '#0f172a',
  color: '#fff',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 12,
  boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
};

export function normalizeLocationRows(rows) {
  return (rows || [])
    .map((r) => ({
      name: String(r.name ?? r.location ?? 'Unknown').trim() || 'Unknown',
      count: Number(r.count) || 0,
    }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
}

export function normalizeMonthlyRows(rows) {
  const byMonth = Object.fromEntries(
    (rows || []).map((r) => [Number(r.month), Number(r.count) || 0]),
  );
  return MONTH_LABELS.map((month, i) => ({
    month,
    count: byMonth[i + 1] ?? 0,
  }));
}

function niceYMax(maxVal) {
  if (maxVal <= 0) return 10;
  const mag = 10 ** Math.floor(Math.log10(maxVal));
  const norm = maxVal / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return Math.ceil(maxVal / (mag * step / 10)) * (mag * step / 10) || 10;
}

function BarAreaTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={TOOLTIP_BOX}>
      {label != null && label !== '' && (
        <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>{label}</div>
      )}
      <div style={{ fontWeight: 600 }}>{Number(payload[0].value).toLocaleString()} assets</div>
    </div>
  );
}

function PieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div style={TOOLTIP_BOX}>
      <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 4 }}>{p.name}</div>
      <div style={{ fontWeight: 600 }}>
        {Number(p.value).toLocaleString()} ({p.payload?.percent ?? 0}%)
      </div>
    </div>
  );
}

function ChartEmpty({ message = 'No data for this view' }) {
  return (
    <div style={{ ...chartPlotShellStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <span style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>{message}</span>
    </div>
  );
}

const ASSET_TYPE_SCROLL_AT = 9;
const ASSET_TYPE_ROW_PX = 28;
const ASSET_TYPE_ROW_PX_WRAPPED = 36;
const ASSET_LABEL_CHARS_PER_LINE = 13;
const ASSET_LABEL_MAX_LINES = 2;
const ASSET_LABEL_LEFT = 2;
const ASSET_LABEL_LINE_HEIGHT = 13;

/** Split long asset names into up to two lines (word-aware when possible). */
function wrapAssetLabel(name, perLine = ASSET_LABEL_CHARS_PER_LINE, maxLines = ASSET_LABEL_MAX_LINES) {
  const s = String(name ?? '').trim();
  if (!s) return [''];
  if (s.length <= perLine) return [s];

  const lines = [];
  let remaining = s;

  while (remaining && lines.length < maxLines) {
    if (remaining.length <= perLine) {
      lines.push(remaining);
      break;
    }
    let chunk = remaining.slice(0, perLine);
    const lastSpace = chunk.lastIndexOf(' ');
    if (lastSpace > 3 && lines.length < maxLines - 1) {
      chunk = remaining.slice(0, lastSpace);
      remaining = remaining.slice(lastSpace + 1).trim();
    } else {
      remaining = remaining.slice(perLine);
    }
    lines.push(chunk);
  }

  if (remaining && lines.length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = last.length >= perLine ? `${last.slice(0, perLine - 1)}…` : `${last}…`;
  }

  return lines.slice(0, maxLines);
}

function AssetYAxisTick({ y, payload }) {
  const lines = wrapAssetLabel(payload?.value ?? '');
  const centerOffset = lines.length > 1 ? -((lines.length - 1) * ASSET_LABEL_LINE_HEIGHT) / 2 : 0;

  return (
    <text
      x={ASSET_LABEL_LEFT}
      y={y}
      dy={4 + centerOffset}
      textAnchor="start"
      fill={TICK_DARK.fill}
      fontSize={11}
      fontFamily="inherit"
    >
      {lines.map((line, i) => (
        <tspan key={`${line}-${i}`} x={ASSET_LABEL_LEFT} dy={i === 0 ? 0 : ASSET_LABEL_LINE_HEIGHT}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

const ASSET_BAR_GRADIENTS = [
  'url(#dashAssetBlue)',
  'url(#dashAssetPurple)',
  'url(#dashAssetCoral)',
  'url(#dashAssetMint)',
  'url(#dashAssetSky)',
];

export function AssetTypeDistributionBarChart({ rows }) {
  const data = useMemo(
    () => [...(rows || [])]
      .map((r) => ({ name: String(r.name ?? r.type ?? 'Unknown'), count: Number(r.count) || 0 }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count),
    [rows],
  );

  const hasWrappedLabels = useMemo(
    () => data.some((d) => wrapAssetLabel(d.name).length > 1),
    [data],
  );

  const rowPx = hasWrappedLabels ? ASSET_TYPE_ROW_PX_WRAPPED : ASSET_TYPE_ROW_PX;

  const yAxisWidth = useMemo(() => {
    if (!data.length) return 52;
    const wrapped = data.map((d) => wrapAssetLabel(d.name));
    const maxLineLen = Math.max(...wrapped.flat().map((line) => line.length));
    return Math.min(98, Math.max(44, Math.ceil(maxLineLen * 6.1) + 6));
  }, [data]);

  const maxBarSize = useMemo(() => {
    if (!data.length) return 24;
    const slot = (DASHBOARD_DIST_CHART_HEIGHT - 44) / data.length;
    const cap = hasWrappedLabels ? 32 : 38;
    return Math.min(cap, Math.max(14, Math.floor(slot * 0.62)));
  }, [data.length, hasWrappedLabels]);

  const needsScroll = data.length >= ASSET_TYPE_SCROLL_AT;
  const scrollInnerHeight = data.length * rowPx + 36;

  if (data.length === 0) {
    return <ChartEmpty message="No assets in this view yet" />;
  }

  const plotShellClass = `dash-chart-plot dash-chart-plot--asset${needsScroll ? ' dash-chart-plot--scroll' : ''}`;

  return (
    <div className={plotShellClass}>
      <div
        className="dash-chart-plot__inner"
        style={needsScroll ? { height: scrollInnerHeight, minHeight: scrollInnerHeight } : undefined}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 12, right: 44, left: 0, bottom: 12 }}
            barCategoryGap="16%"
          >
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
            <XAxis type="number" allowDecimals={false} tick={TICK} axisLine={false} tickLine={false} />
            <YAxis
              type="category"
              dataKey="name"
              width={yAxisWidth}
              tick={AssetYAxisTick}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(v) => [v, 'Assets']}
              labelFormatter={(name) => name}
              content={<BarAreaTooltip />}
            />
            <Bar dataKey="count" radius={[0, 8, 8, 0]} maxBarSize={maxBarSize}>
              {data.map((entry, i) => (
                <Cell key={entry.name} fill={ASSET_BAR_GRADIENTS[i % ASSET_BAR_GRADIENTS.length]} />
              ))}
              <LabelList
                dataKey="count"
                position="right"
                style={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function LocationDistributionBarChart({ rows, maxCategories = 12 }) {
  const data = useMemo(
    () => normalizeLocationRows(rows).slice(0, maxCategories),
    [rows, maxCategories],
  );
  const yMax = useMemo(
    () => niceYMax(Math.max(0, ...data.map((d) => d.count))),
    [data],
  );

  if (data.length === 0) return <ChartEmpty />;

  return (
    <ChartViewport>
      <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={DIST_CHART_MARGIN}>
        <defs>
          <linearGradient id="dashLocSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3BB5F5" />
            <stop offset="100%" stopColor="#A8E4F9" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />
        <XAxis
          dataKey="name"
          tick={TICK_DARK}
          axisLine={false}
          tickLine={false}
          interval={0}
          angle={-32}
          textAnchor="end"
          height={36}
          tickMargin={4}
          tickFormatter={truncateAxisLabel}
        />
        <YAxis
          width={DIST_Y_AXIS_WIDTH}
          tick={TICK}
          axisLine={false}
          tickLine={false}
          domain={[0, yMax]}
          allowDecimals={false}
          tickFormatter={(v) => v.toLocaleString()}
        />
        <Tooltip content={<BarAreaTooltip />} cursor={{ fill: 'rgba(59, 181, 245, 0.1)' }} />
        <Bar dataKey="count" radius={[10, 10, 0, 0]} maxBarSize={52} fill="url(#dashLocSky)">
          {data.map((entry) => (
            <Cell key={entry.name} fill="url(#dashLocSky)" />
          ))}
        </Bar>
      </BarChart>
      </ResponsiveContainer>
    </ChartViewport>
  );
}

export function LocationDistributionPieChart({ rows, maxCategories = 8 }) {
  const { data, total } = useMemo(() => {
    const sorted = normalizeLocationRows(rows);
    const top = sorted.slice(0, maxCategories);
    const rest = sorted.slice(maxCategories);
    const otherSum = rest.reduce((s, r) => s + r.count, 0);
    const slice = otherSum > 0 ? [...top, { name: 'Other', count: otherSum }] : top;
    const sum = slice.reduce((s, r) => s + r.count, 0);
    return {
      data: slice.map((r) => ({
        ...r,
        percent: sum > 0 ? Math.round((r.count / sum) * 1000) / 10 : 0,
      })),
      total: sum,
    };
  }, [rows, maxCategories]);

  if (data.length === 0) return <ChartEmpty />;

  return (
    <ResponsiveContainer width="100%" height={320}>
      <PieChart>
        <Pie
          data={data}
          dataKey="count"
          nameKey="name"
          cx="50%"
          cy="46%"
          innerRadius={58}
          outerRadius={92}
          paddingAngle={2}
          strokeWidth={0}
        >
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={CHART_PIE_FILLS[i % CHART_PIE_FILLS.length]} />
          ))}
        </Pie>
        <Tooltip content={<PieTooltip />} />
        <Legend
          layout="horizontal"
          verticalAlign="bottom"
          align="center"
          iconType="circle"
          iconSize={8}
          formatter={(value, entry) => (
            <span style={{ fontSize: 11.5, color: '#475569' }}>
              {value}{' '}
              <span style={{ color: '#94a3b8' }}>({entry?.payload?.percent ?? 0}%)</span>
            </span>
          )}
        />
        <text x="50%" y="44%" textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 22, fontWeight: 700, fill: '#0f172a' }}>
          {total.toLocaleString()}
        </text>
        <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 11, fill: '#94a3b8' }}>
          Total assets
        </text>
      </PieChart>
    </ResponsiveContainer>
  );
}

export function MonthlyDistributionAreaChart({ rows }) {
  const gradId = useId().replace(/:/g, '');
  const data = useMemo(() => normalizeMonthlyRows(rows), [rows]);
  const yMax = useMemo(
    () => niceYMax(Math.max(0, ...data.map((d) => d.count))),
    [data],
  );
  const hasData = data.some((d) => d.count > 0);

  if (!hasData) return <ChartEmpty message="No assets created this year for this view" />;

  return (
    <ChartViewport>
      <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={DIST_CHART_MARGIN}>
        <defs>
          <linearGradient id={`monthArea-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3BB5F5" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#3BB5F5" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_GRID} />
        <XAxis
          dataKey="month"
          tick={TICK_DARK}
          axisLine={false}
          tickLine={false}
          height={36}
          tickMargin={4}
        />
        <YAxis
          width={DIST_Y_AXIS_WIDTH}
          tick={TICK}
          axisLine={false}
          tickLine={false}
          domain={[0, yMax]}
          allowDecimals={false}
          tickFormatter={(v) => v.toLocaleString()}
        />
        <Tooltip content={<BarAreaTooltip />} />
        <Area
          type="monotone"
          dataKey="count"
          stroke="#3BB5F5"
          strokeWidth={2}
          fill={`url(#monthArea-${gradId})`}
          dot={{ r: 3, fill: '#3BB5F5', strokeWidth: 0 }}
          activeDot={{ r: 5, fill: CHART_ACCENT, stroke: '#fff', strokeWidth: 2 }}
        />
      </AreaChart>
      </ResponsiveContainer>
    </ChartViewport>
  );
}

export function DashboardChartCard({ title, subtitle, children, action, className = '', bodyClassName = '' }) {
  return (
    <div className={`dash-chart-card ${className}`.trim()}>
      <div className="dash-chart-card__head">
        <div className="dash-chart-card__titles">
          <div className="dash-chart-card__title">{title}</div>
          {subtitle && (
            <div className="dash-chart-card__subtitle">{subtitle}</div>
          )}
        </div>
        {action}
      </div>
      <div className={`dash-chart-card__body ${bodyClassName}`.trim()}>{children}</div>
    </div>
  );
}

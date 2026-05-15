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
} from 'recharts';

const CHART_PALETTE = [
  '#38bdf8', '#818cf8', '#f472b6', '#fb923c', '#4ade80', '#a78bfa',
  '#22d3ee', '#facc15', '#f87171', '#34d399',
];

const PASTEL_BARS = ['#bfdbfe', '#fecaca', '#fed7aa', '#bbf7d0', '#ddd6fe', '#a5f3fc'];

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const TICK = { fontSize: 11, fill: '#94a3b8', fontFamily: 'inherit' };
const TICK_DARK = { fontSize: 11, fill: '#64748b', fontFamily: 'inherit' };

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
    <div style={{ padding: 48, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>{message}</div>
  );
}

export function LocationDistributionBarChart({ rows, maxCategories = 12 }) {
  const gradId = useId().replace(/:/g, '');
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
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 12, right: 12, left: 4, bottom: 64 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
        <XAxis
          dataKey="name"
          tick={TICK_DARK}
          axisLine={false}
          tickLine={false}
          interval={0}
          angle={-28}
          textAnchor="end"
          height={72}
        />
        <YAxis
          tick={TICK}
          axisLine={false}
          tickLine={false}
          domain={[0, yMax]}
          allowDecimals={false}
          tickFormatter={(v) => v.toLocaleString()}
        />
        <Tooltip content={<BarAreaTooltip />} cursor={{ fill: 'rgba(56, 189, 248, 0.08)' }} />
        <defs>
          <linearGradient id={`locBarGrad-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#e0f2fe" />
          </linearGradient>
        </defs>
        <Bar dataKey="count" radius={[8, 8, 0, 0]} maxBarSize={52}>
          {data.map((entry, index) => (
            <Cell
              key={entry.name}
              fill={index === 0 ? `url(#locBarGrad-${gradId})` : PASTEL_BARS[(index - 1) % PASTEL_BARS.length]}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
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
            <Cell key={entry.name} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
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
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart data={data} margin={{ top: 12, right: 16, left: 4, bottom: 8 }}>
        <defs>
          <linearGradient id={`monthArea-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
        <XAxis dataKey="month" tick={TICK_DARK} axisLine={false} tickLine={false} />
        <YAxis
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
          stroke="#38bdf8"
          strokeWidth={2.5}
          fill={`url(#monthArea-${gradId})`}
          dot={{ r: 4, fill: '#38bdf8', strokeWidth: 0 }}
          activeDot={{ r: 6, fill: '#0ea5e9', stroke: '#fff', strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DashboardChartCard({ title, subtitle, children, action }) {
  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)',
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          padding: '14px 18px',
          borderBottom: '1px solid #f1f5f9',
          background: '#fafbfc',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', letterSpacing: '-0.01em' }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 4 }}>{subtitle}</div>
          )}
        </div>
        {action}
      </div>
      <div style={{ padding: '12px 16px 18px', flex: 1 }}>{children}</div>
    </div>
  );
}

import { useState } from 'react';

/* ─── Design tokens ──────────────────────────────────────────── */
export const T = {
  blue:    '#2563EB',
  blueL:   '#EFF6FF',
  blueM:   '#DBEAFE',
  green:   '#059669',
  greenL:  '#ECFDF5',
  amber:   '#D97706',
  amberL:  '#FFFBEB',
  red:     '#DC2626',
  redL:    '#FEF2F2',
  purple:  '#7C3AED',
  purpleL: '#F5F3FF',
  indigo:  '#4F46E5',
  teal:    '#0D9488',
  text:    '#0F172A',
  sub:     '#334155',
  muted:   '#64748B',
  faint:   '#94A3B8',
  border:  '#E2E8F0',
  bg:      '#F8FAFC',
  card:    '#FFFFFF',
  radius:  14,
  shadow:  '0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)',
  shadowH: '0 4px 12px rgba(0,0,0,0.08), 0 12px 32px rgba(0,0,0,0.06)',
};

/* Enterprise chart palette */
export const PALETTE = [
  '#2563EB','#7C3AED','#059669','#D97706',
  '#DC2626','#0D9488','#4F46E5','#DB2777',
  '#0891B2','#65A30D',
];

/* ─── Typography helpers ─────────────────────────────────────── */
export const Heading = ({ children, style = {} }) => (
  <div style={{ fontSize: 13, fontWeight: 700, color: T.text, letterSpacing: '-0.01em', ...style }}>
    {children}
  </div>
);
export const Sub = ({ children, style = {} }) => (
  <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2, ...style }}>{children}</div>
);

/* ─── Export button ──────────────────────────────────────────── */
export function ExportBtn({ onClick, type, disabled = false }) {
  const [hov, setHov] = useState(false);
  const isExcel = type === 'excel';
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '5px 11px', borderRadius: 7, fontSize: 11.5, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer', border: 'none', transition: 'all 0.15s',
    letterSpacing: '0.01em', opacity: disabled ? 0.6 : 1,
  };
  const style = isExcel
    ? { ...base, background: hov ? '#DCFCE7' : T.greenL, color: T.green, border: `1px solid ${hov ? '#86EFAC' : '#BBF7D0'}` }
    : { ...base, background: hov ? '#FEE2E2' : T.redL,   color: T.red,   border: `1px solid ${hov ? '#FCA5A5' : '#FECACA'}` };
  return (
    <button type="button" onClick={onClick} style={style} disabled={disabled}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>
      {isExcel ? '⬇ Excel' : '⬇ PDF'}
    </button>
  );
}

/* ─── Report card ────────────────────────────────────────────── */
export function ReportCard({ title, subtitle, onExcel, onPDF, children, fullWidth = false, minH = 0, actions = null }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: T.card,
        borderRadius: T.radius,
        boxShadow: hov ? T.shadowH : T.shadow,
        border: `1px solid ${T.border}`,
        overflow: 'hidden',
        transition: 'box-shadow 0.2s ease, transform 0.2s ease',
        transform: hov ? 'translateY(-1px)' : 'none',
        gridColumn: fullWidth ? '1 / -1' : undefined,
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Card header */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        padding: '16px 20px 12px',
        borderBottom: `1px solid ${T.border}`,
        background: '#FAFBFC',
      }}>
        <div>
          <Heading>{title}</Heading>
          {subtitle && <Sub>{subtitle}</Sub>}
        </div>
        {(onExcel || onPDF || actions) && (
          <div style={{ display: 'flex', gap: 5, flexShrink: 0, marginLeft: 12, alignItems: 'center' }}>
            {actions}
            {onExcel && <ExportBtn type="excel" onClick={onExcel} />}
            {onPDF   && <ExportBtn type="pdf"   onClick={onPDF}   />}
          </div>
        )}
      </div>
      {/* Card body */}
      <div style={{ padding: '16px 20px', flex: 1, minHeight: minH }}>
        {children}
      </div>
    </div>
  );
}

/* ─── Custom tooltip ─────────────────────────────────────────── */
export function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: T.text, color: '#fff', borderRadius: 8,
      padding: '8px 12px', fontSize: 12, fontWeight: 500,
      boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
    }}>
      {label && <div style={{ color: T.faint, fontSize: 11, marginBottom: 4 }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color || p.fill, flexShrink: 0 }} />
          <span>{p.name || p.dataKey}: <strong>{p.value}</strong></span>
        </div>
      ))}
    </div>
  );
}

/* ─── Stat pill ──────────────────────────────────────────────── */
export function StatPill({ label, value, color, bg }) {
  return (
    <div style={{
      flex: 1, background: bg, borderRadius: 10, padding: '12px 16px',
      display: 'flex', flexDirection: 'column', gap: 3,
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, color, letterSpacing: '-0.03em', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: T.muted, fontWeight: 500 }}>{label}</div>
    </div>
  );
}

/* ─── Empty state ────────────────────────────────────────────── */
export function Empty({ msg = 'No data available' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 0', gap: 8 }}>
      <div style={{ fontSize: 32 }}>📊</div>
      <div style={{ fontSize: 13, color: T.faint }}>{msg}</div>
    </div>
  );
}

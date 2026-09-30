import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../api';
import { toastApiFailure } from '../../apiErrorHandling';
import { exportExcel, exportPDF } from '../../export';
import { T, ExportBtn, StatPill, Empty, Heading, Sub } from './ui';

const STORAGE_KEY = 'overallReports.state.v1';
const MAX_ATTR_COLUMNS = 8;
const SEARCH_DEBOUNCE_MS = 400;

const DATE_FIELDS = [
  { value: 'created', label: 'Created date' },
  { value: 'lastseen', label: 'Last seen date' },
  { value: 'updated', label: 'Updated date' },
];

const PRESETS = [
  { value: 'missing', label: 'Missing' },
  { value: 'not_seen_30', label: 'Not seen in 30 days' },
  { value: 'untagged', label: 'Untagged (no RFID)' },
  { value: 'this_month', label: 'Added this month' },
];

const INVENTORY_STATUSES = [
  { value: 'in_inventory', label: 'In Inventory' },
  { value: 'missing', label: 'Missing' },
  { value: 'not_in_inventory', label: 'Not in Inventory' },
];

const OPERATORS = {
  string: [
    { value: 'contains', label: 'contains' },
    { value: 'equals', label: 'equals' },
    { value: 'empty', label: 'is empty' },
    { value: 'not_empty', label: 'is not empty' },
  ],
  double: [
    { value: 'eq', label: '=' },
    { value: 'gt', label: '>' },
    { value: 'lt', label: '<' },
    { value: 'between', label: 'between' },
  ],
  date: [
    { value: 'on', label: 'on' },
    { value: 'before', label: 'before' },
    { value: 'after', label: 'after' },
    { value: 'between', label: 'between' },
  ],
  list: [{ value: 'in', label: 'is any of' }],
};

const PAGE_SIZES = [25, 50, 100];

const DEFAULT_FILTERS = {
  date_field: 'created',
  from: '',
  to: '',
  search: '',
  presets: [],
  asset_type_id: [],
  location_id: [],
  tag_type_id: [],
  vendor_id: [],
  asset_inventory_status: [],
  attr_match: 'all',
  attr_filters: [],
};

const BASE_COLUMNS = [
  { key: 'asset_code', header: 'Asset ID', sort: 'asset_code' },
  { key: 'asset_serial', header: 'Serial', sort: 'asset_serial' },
  { key: 'name', header: 'Name', sort: 'name' },
  { key: 'asset_type_name', header: 'Type', sort: 'asset_type_name' },
  { key: 'location_name', header: 'Location', sort: 'location_name' },
  { key: 'tag_type_name', header: 'Tag Type', sort: 'tag_type_name' },
  { key: 'status_label', header: 'Status', sort: 'asset_inventory_status' },
  { key: 'lastseen_label', header: 'Last Seen', sort: 'lastseen' },
  { key: 'created_label', header: 'Created', sort: 'created_at' },
];

const inputStyle = {
  padding: '6px 10px', border: `1px solid ${T.border}`,
  borderRadius: 7, fontSize: 12.5, color: T.text,
  background: '#fff', outline: 'none', minWidth: 0,
};

const cardStyle = {
  background: T.card, borderRadius: T.radius,
  boxShadow: T.shadow, border: `1px solid ${T.border}`,
};

const labelStyle = { fontSize: 11.5, color: T.muted, fontWeight: 600, marginBottom: 4 };

let conditionSeq = 0;
const newConditionId = () => `c${Date.now()}_${conditionSeq++}`;

const MULTI_FILTER_KEYS = ['asset_type_id', 'location_id', 'tag_type_id', 'vendor_id', 'asset_inventory_status'];

/** Older saved state stored these filters as a single string. */
function normalizeFilters(saved) {
  const f = { ...DEFAULT_FILTERS, ...(saved || {}) };
  MULTI_FILTER_KEYS.forEach((k) => {
    const v = f[k];
    f[k] = Array.isArray(v) ? v.map(String) : (v == null || v === '' ? [] : [String(v)]);
  });
  return f;
}

function loadSavedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      filters: normalizeFilters(parsed.filters),
      attrColumns: Array.isArray(parsed.attrColumns) ? parsed.attrColumns.slice(0, MAX_ATTR_COLUMNS) : [],
      pageSize: PAGE_SIZES.includes(parsed.pageSize) ? parsed.pageSize : PAGE_SIZES[0],
    };
  } catch {
    return null;
  }
}

function formatDateTime(value) {
  if (value == null || value === '') return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function statusLabel(value) {
  return INVENTORY_STATUSES.find((s) => s.value === value)?.label || value || '—';
}

function attrValue(row, name) {
  const key = String(name).trim().toLowerCase();
  const hit = (row.attributes || []).find((a) => String(a.name || '').trim().toLowerCase() === key);
  const v = hit?.value;
  return v == null || String(v).trim() === '' ? '—' : String(v);
}

function toDisplayRow(row, index) {
  return {
    ...row,
    s_no: index + 1,
    asset_code: row.asset_code || '—',
    asset_serial: row.asset_serial || '—',
    name: row.name || '—',
    asset_type_name: row.asset_type_name || '—',
    location_name: row.location_name || '—',
    tag_type_name: row.tag_type_name || '—',
    status_label: statusLabel(row.asset_inventory_status),
    lastseen_label: formatDateTime(row.lastseen),
    created_label: formatDateTime(row.created_at),
  };
}

/** Drops incomplete advanced rows and UI-only fields before sending to the API. */
function toRequestBody(filters) {
  return {
    ...filters,
    search: filters.search.trim(),
    attr_filters: filters.attr_filters
      .filter((c) => c.name && c.op)
      .map(({ name, attr_type, op, value, value2, values }) => ({ name, attr_type, op, value, value2, values })),
  };
}

function countActiveFilters(f) {
  let n = 0;
  if (f.from || f.to) n += 1;
  if (f.search.trim()) n += 1;
  n += f.presets.length;
  MULTI_FILTER_KEYS.forEach((k) => {
    if (f[k].length) n += 1;
  });
  n += f.attr_filters.filter((c) => c.name).length;
  return n;
}

/* ─── Filter bar (date + search) ─────────────────────────────── */
function OverallFilterBar({ filters, onChange, onApply, onReset }) {
  return (
    <div style={{ ...cardStyle, padding: '14px 20px', display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
      <div>
        <div style={labelStyle}>Date field</div>
        <select value={filters.date_field} onChange={(e) => onChange({ date_field: e.target.value })} style={inputStyle}>
          {DATE_FIELDS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </select>
      </div>
      <div>
        <div style={labelStyle}>From</div>
        <input type="date" value={filters.from} max={filters.to || undefined}
          onChange={(e) => onChange({ from: e.target.value })} style={inputStyle} />
      </div>
      <div>
        <div style={labelStyle}>To</div>
        <input type="date" value={filters.to} min={filters.from || undefined}
          onChange={(e) => onChange({ to: e.target.value })} style={inputStyle} />
      </div>
      <div style={{ flex: '1 1 240px' }}>
        <div style={labelStyle}>Asset ID search</div>
        <input
          type="search"
          value={filters.search}
          placeholder="Asset ID, serial, RFID tag or name"
          onChange={(e) => onChange({ search: e.target.value })}
          style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={onApply} style={{
          padding: '7px 18px', borderRadius: 7, fontSize: 12.5, fontWeight: 600,
          background: T.blue, color: '#fff', border: 'none', cursor: 'pointer',
        }}>
          Apply
        </button>
        <button type="button" onClick={onReset} style={{
          padding: '7px 14px', borderRadius: 7, fontSize: 12.5, fontWeight: 600,
          background: '#fff', color: T.sub, border: `1px solid ${T.border}`, cursor: 'pointer',
        }}>
          Reset
        </button>
      </div>
    </div>
  );
}

/* ─── Recommended filters (presets + dropdowns) ──────────────── */
function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer',
        border: `1px solid ${active ? T.blue : T.border}`,
        background: active ? T.blueL : '#fff',
        color: active ? T.blue : T.sub,
        transition: 'all 0.15s',
      }}
    >
      {active ? '✓ ' : ''}{children}
    </button>
  );
}

function MultiSelect({ label, value, options, onChange, getLabel = (o) => o.name }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const items = options.map((o) => ({ id: String(o.id ?? o.value), label: getLabel(o) }));
  const q = query.trim().toLowerCase();
  const visible = q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items;
  const selected = new Set(value);

  const toggle = (id) => {
    onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  };
  const selectVisible = () => onChange([...new Set([...value, ...visible.map((i) => i.id)])]);

  let summary = 'All';
  if (value.length === 1) summary = items.find((i) => i.id === value[0])?.label || '1 selected';
  else if (value.length > 1) summary = `${value.length} selected`;

  const linkBtn = {
    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
    fontSize: 11.5, fontWeight: 600, color: T.blue,
  };

  return (
    <div ref={ref} style={{ flex: '1 1 170px', minWidth: 150, position: 'relative' }}>
      <div style={labelStyle}>{label}</div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          ...inputStyle, width: '100%', textAlign: 'left', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
          borderColor: value.length ? T.blue : T.border,
          background: value.length ? T.blueL : '#fff',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: value.length ? T.blue : T.text }}>
          {summary}
        </span>
        <span style={{ color: T.muted, fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', left: 0, top: 'calc(100% + 4px)', zIndex: 30, minWidth: '100%', width: 260,
          background: '#fff', border: `1px solid ${T.border}`, borderRadius: 9, boxShadow: T.shadowH, padding: 8,
        }}>
          {items.length > 8 && (
            <input
              type="search"
              autoFocus
              value={query}
              placeholder={`Search ${label.toLowerCase()}…`}
              onChange={(e) => setQuery(e.target.value)}
              style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', marginBottom: 6 }}
            />
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 4px 6px' }}>
            <button type="button" style={linkBtn} onClick={selectVisible} disabled={!visible.length}>Select all</button>
            <button type="button" style={{ ...linkBtn, color: T.muted }} onClick={() => onChange([])} disabled={!value.length}>
              Clear
            </button>
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {visible.length === 0 && <div style={{ fontSize: 12, color: T.faint, padding: 4 }}>No matches</div>}
            {visible.map((i) => (
              <label key={i.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 4px',
                fontSize: 12.5, color: T.text, cursor: 'pointer', borderRadius: 5,
              }}>
                <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                {i.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RecommendedFilters({ filters, onChange, lookups }) {
  const togglePreset = (p) => {
    const next = filters.presets.includes(p)
      ? filters.presets.filter((x) => x !== p)
      : [...filters.presets, p];
    onChange({ presets: next });
  };

  return (
    <div style={{ ...cardStyle, padding: '14px 20px' }}>
      <Heading>Recommended filters</Heading>
      <Sub>Quick presets and the most common filters</Sub>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        {PRESETS.map((p) => (
          <Chip key={p.value} active={filters.presets.includes(p.value)} onClick={() => togglePreset(p.value)}>
            {p.label}
          </Chip>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
        <MultiSelect label="Asset type" value={filters.asset_type_id} options={lookups.assetTypes}
          onChange={(v) => onChange({ asset_type_id: v })}
          getLabel={(o) => (o.parent_name ? `${o.parent_name} / ${o.name}` : o.name)} />
        <MultiSelect label="Location" value={filters.location_id} options={lookups.locations}
          onChange={(v) => onChange({ location_id: v })}
          getLabel={(o) => (o.parent_name ? `${o.parent_name} / ${o.name}` : o.name)} />
        <MultiSelect label="Tag type" value={filters.tag_type_id} options={lookups.tagTypes}
          onChange={(v) => onChange({ tag_type_id: v })} />
        <MultiSelect label="Vendor" value={filters.vendor_id} options={lookups.vendors}
          onChange={(v) => onChange({ vendor_id: v })} />
        <MultiSelect label="Inventory status" value={filters.asset_inventory_status} options={INVENTORY_STATUSES}
          onChange={(v) => onChange({ asset_inventory_status: v })} getLabel={(o) => o.label} />
      </div>
    </div>
  );
}

/* ─── Advanced filter (attribute conditions) ─────────────────── */
function ListValuePicker({ options, selected, onChange }) {
  if (!options.length) {
    return <span style={{ fontSize: 12, color: T.faint }}>No options defined for this attribute</span>;
  }
  const toggle = (v) => {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map((o) => (
        <Chip key={o.option_value} active={selected.includes(o.option_value)} onClick={() => toggle(o.option_value)}>
          {o.option_value}
        </Chip>
      ))}
    </div>
  );
}

function ConditionValue({ condition, attribute, onChange }) {
  const { attr_type: type, op } = condition;
  if (type === 'string' && (op === 'empty' || op === 'not_empty')) return null;
  if (type === 'list') {
    return (
      <ListValuePicker
        options={attribute?.list_options || []}
        selected={condition.values || []}
        onChange={(values) => onChange({ values })}
      />
    );
  }
  const inputType = type === 'double' ? 'number' : type === 'date' ? 'date' : 'text';
  const placeholder = type === 'string' ? 'Value' : '';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input type={inputType} value={condition.value ?? ''} placeholder={placeholder}
        onChange={(e) => onChange({ value: e.target.value })} style={{ ...inputStyle, width: 160 }} />
      {op === 'between' && (
        <>
          <span style={{ fontSize: 12, color: T.muted }}>and</span>
          <input type={inputType} value={condition.value2 ?? ''}
            onChange={(e) => onChange({ value2: e.target.value })} style={{ ...inputStyle, width: 160 }} />
        </>
      )}
    </div>
  );
}

function AdvancedFilter({ filters, onChange, attributes }) {
  const [open, setOpen] = useState(() => filters.attr_filters.length > 0);
  const conditions = filters.attr_filters;
  const activeCount = conditions.filter((c) => c.name).length;

  const setConditions = (next) => onChange({ attr_filters: next });
  const updateCondition = (id, patch) => {
    setConditions(conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };
  const selectAttribute = (id, name) => {
    const attr = attributes.find((a) => a.name === name);
    const type = OPERATORS[attr?.attr_type] ? attr.attr_type : 'string';
    updateCondition(id, {
      name, attr_type: type, op: OPERATORS[type][0].value, value: '', value2: '', values: [],
    });
  };
  const addCondition = () => {
    setOpen(true);
    setConditions([...conditions, {
      id: newConditionId(), name: '', attr_type: 'string', op: 'contains', value: '', value2: '', values: [],
    }]);
  };
  const removeCondition = (id) => setConditions(conditions.filter((c) => c.id !== id));

  return (
    <div style={{ ...cardStyle, padding: '14px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <button type="button" onClick={() => setOpen((o) => !o)} style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
        }}>
          <Heading>
            {open ? '▾' : '▸'} Advanced filter
            {activeCount > 0 && (
              <span style={{
                marginLeft: 8, padding: '1px 8px', borderRadius: 999, fontSize: 11,
                background: T.blueL, color: T.blue, fontWeight: 700,
              }}>{activeCount}</span>
            )}
          </Heading>
          <Sub>Filter by asset attributes ({attributes.length} available)</Sub>
        </button>
        {open && conditions.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.sub }}>
            Match
            <select value={filters.attr_match} onChange={(e) => onChange({ attr_match: e.target.value })} style={inputStyle}>
              <option value="all">all conditions (AND)</option>
              <option value="any">any condition (OR)</option>
            </select>
          </div>
        )}
      </div>

      {open && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {conditions.length === 0 && (
            <div style={{ fontSize: 12.5, color: T.faint }}>No attribute conditions yet.</div>
          )}
          {conditions.map((c) => {
            const attr = attributes.find((a) => a.name === c.name);
            return (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                padding: '8px 10px', border: `1px solid ${T.border}`, borderRadius: 9, background: T.bg,
              }}>
                <select value={c.name} onChange={(e) => selectAttribute(c.id, e.target.value)}
                  style={{ ...inputStyle, width: 200 }}>
                  <option value="">Select attribute…</option>
                  {attributes.map((a) => (
                    <option key={a.id} value={a.name}>{a.name} ({a.attr_type})</option>
                  ))}
                </select>
                {c.name && (
                  <>
                    <select value={c.op} onChange={(e) => updateCondition(c.id, { op: e.target.value })}
                      style={{ ...inputStyle, width: 130 }}>
                      {(OPERATORS[c.attr_type] || OPERATORS.string).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <ConditionValue condition={c} attribute={attr} onChange={(patch) => updateCondition(c.id, patch)} />
                    </div>
                  </>
                )}
                <button type="button" onClick={() => removeCondition(c.id)} title="Remove condition" style={{
                  marginLeft: 'auto', background: 'none', border: 'none', color: T.red,
                  cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 6px',
                }}>
                  ×
                </button>
              </div>
            );
          })}
          <div>
            <button type="button" onClick={addCondition} disabled={!attributes.length} style={{
              padding: '6px 12px', borderRadius: 7, fontSize: 12.5, fontWeight: 600,
              background: '#fff', color: T.blue, border: `1px dashed ${T.blue}`,
              cursor: attributes.length ? 'pointer' : 'not-allowed',
            }}>
              + Add condition
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Results table ──────────────────────────────────────────── */
function AttributeColumnPicker({ attributes, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggle = (name) => {
    if (selected.includes(name)) onChange(selected.filter((n) => n !== name));
    else if (selected.length < MAX_ATTR_COLUMNS) onChange([...selected, name]);
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={{
        padding: '5px 11px', borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
        background: '#fff', color: T.sub, border: `1px solid ${T.border}`,
      }}>
        Attribute columns{selected.length ? ` (${selected.length})` : ''} ▾
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 20,
          background: '#fff', border: `1px solid ${T.border}`, borderRadius: 9, boxShadow: T.shadowH,
          padding: 8, width: 240, maxHeight: 300, overflowY: 'auto',
        }}>
          <div style={{ fontSize: 11, color: T.muted, padding: '2px 4px 6px' }}>
            Up to {MAX_ATTR_COLUMNS} columns
          </div>
          {attributes.length === 0 && <div style={{ fontSize: 12, color: T.faint, padding: 4 }}>No attributes</div>}
          {attributes.map((a) => {
            const checked = selected.includes(a.name);
            const disabled = !checked && selected.length >= MAX_ATTR_COLUMNS;
            return (
              <label key={a.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '4px 4px', fontSize: 12.5,
                color: disabled ? T.faint : T.text, cursor: disabled ? 'not-allowed' : 'pointer',
              }}>
                <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(a.name)} />
                {a.name}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OverallResultsTable({
  rows, loading, columns, sort, sortDir, onSort, page, totalPages, total, pageSize, onPage, onPageSize,
}) {
  const thStyle = {
    textAlign: 'left', padding: '9px 12px', fontSize: 11.5, fontWeight: 700, color: T.sub,
    borderBottom: `1px solid ${T.border}`, background: '#FAFBFC', whiteSpace: 'nowrap',
    position: 'sticky', top: 0,
  };
  const tdStyle = {
    padding: '8px 12px', fontSize: 12.5, color: T.text, borderBottom: `1px solid ${T.border}`,
    whiteSpace: 'nowrap', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis',
  };
  const firstIndex = (page - 1) * pageSize;
  const pagerBtn = (disabled) => ({
    padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
    background: '#fff', color: disabled ? T.faint : T.sub, border: `1px solid ${T.border}`,
    cursor: disabled ? 'not-allowed' : 'pointer',
  });

  return (
    <>
      <div style={{ overflow: 'auto', maxHeight: 560, border: `1px solid ${T.border}`, borderRadius: 9 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>S.No</th>
              {columns.map((col) => {
                const active = col.sort && sort === col.sort;
                return (
                  <th
                    key={col.key}
                    style={{ ...thStyle, cursor: col.sort ? 'pointer' : 'default', color: active ? T.blue : T.sub }}
                    onClick={col.sort ? () => onSort(col.sort) : undefined}
                  >
                    {col.header}{active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody style={{ opacity: loading ? 0.5 : 1 }}>
            {rows.map((row, i) => (
              <tr key={row.id}>
                <td style={{ ...tdStyle, color: T.muted }}>{firstIndex + i + 1}</td>
                {columns.map((col) => (
                  <td key={col.key} style={tdStyle} title={String(col.get(row))}>{col.get(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 && <Empty msg="No assets match these filters" />}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: T.muted }}>
          {total > 0
            ? `Showing ${firstIndex + 1}–${Math.min(firstIndex + rows.length, total)} of ${total}`
            : 'No results'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} style={inputStyle}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
          <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} style={pagerBtn(page <= 1)}>
            ‹ Prev
          </button>
          <span style={{ fontSize: 12, color: T.sub }}>Page {page} of {totalPages}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}
            style={pagerBtn(page >= totalPages)}>
            Next ›
          </button>
        </div>
      </div>
    </>
  );
}

/* ─── Custom Reports tab ─────────────────────────────────────── */
export default function OverallReports() {
  const saved = useRef(loadSavedState()).current;
  const [filters, setFilters] = useState(saved?.filters || DEFAULT_FILTERS);
  const [applied, setApplied] = useState(saved?.filters || DEFAULT_FILTERS);
  const [attrColumns, setAttrColumns] = useState(saved?.attrColumns || []);
  const [pageSize, setPageSize] = useState(saved?.pageSize || PAGE_SIZES[0]);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');

  const [lookups, setLookups] = useState({ assetTypes: [], locations: [], tagTypes: [], vendors: [] });
  const [attributes, setAttributes] = useState([]);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ total: 0, in_inventory: 0, missing: 0 });
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const requestSeq = useRef(0);

  useEffect(() => {
    const load = (url, key, label) => api.get(url)
      .then((r) => setLookups((prev) => ({ ...prev, [key]: Array.isArray(r.data) ? r.data : [] })))
      .catch((e) => toastApiFailure(e, label));
    load('/asset-types', 'assetTypes', 'Asset types');
    load('/locations', 'locations', 'Locations');
    load('/tag-types', 'tagTypes', 'Tag types');
    load('/vendors', 'vendors', 'Vendors');
    api.get('/attribute-list')
      .then((r) => setAttributes(Array.isArray(r.data) ? r.data : []))
      .catch((e) => toastApiFailure(e, 'Attributes'));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ filters, attrColumns, pageSize }));
    } catch {
      /* storage full or disabled */
    }
  }, [filters, attrColumns, pageSize]);

  useEffect(() => {
    if (filters.search === applied.search) return undefined;
    const t = setTimeout(() => {
      setApplied((prev) => ({ ...prev, search: filters.search }));
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [filters.search, applied.search]);

  const fetchPage = useCallback(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    api.post('/reports/overall', { ...toRequestBody(applied), page, limit: pageSize, sort, sort_dir: sortDir })
      .then((r) => {
        if (seq !== requestSeq.current) return;
        const body = r.data || {};
        setRows(Array.isArray(body.data) ? body.data : []);
        setSummary(body.summary || { total: 0, in_inventory: 0, missing: 0 });
        setTotalPages(body.pagination?.totalPages || 1);
      })
      .catch((e) => {
        if (seq === requestSeq.current) toastApiFailure(e, 'Reports · Custom');
      })
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false);
      });
  }, [applied, page, pageSize, sort, sortDir]);

  useEffect(() => { fetchPage(); }, [fetchPage]);

  const patchFilters = (patch) => setFilters((prev) => ({ ...prev, ...patch }));

  const apply = () => {
    setApplied({ ...filters });
    setPage(1);
  };

  const reset = () => {
    setFilters(DEFAULT_FILTERS);
    setApplied(DEFAULT_FILTERS);
    setPage(1);
  };

  const onSort = (key) => {
    if (sort === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSort(key); setSortDir('asc'); }
    setPage(1);
  };

  const columns = [
    ...BASE_COLUMNS.map((c) => ({ ...c, get: (r) => r[c.key] })),
    ...attrColumns.map((name) => ({ key: `attr:${name}`, header: name, get: (r) => attrValue(r, name) })),
  ];
  const displayRows = rows.map(toDisplayRow);

  const runExport = async (kind) => {
    setExporting(true);
    setNotice('');
    try {
      const r = await api.post('/reports/overall', {
        ...toRequestBody(applied), sort, sort_dir: sortDir, export: true,
      });
      const body = r.data || {};
      const data = (Array.isArray(body.data) ? body.data : []).map(toDisplayRow);
      if (!data.length) {
        setNotice('Nothing to export for the current filters.');
        return;
      }
      const exportColumns = [
        { header: 'S.No', key: 's_no' },
        ...BASE_COLUMNS.map((c) => ({ header: c.header, key: c.key })),
        ...attrColumns.map((name) => ({ header: name, key: `attr:${name}` })),
      ];
      const exportRows = data.map((row) => {
        const out = { ...row };
        attrColumns.forEach((name) => { out[`attr:${name}`] = attrValue(row, name); });
        return out;
      });
      const stamp = new Date().toISOString().split('T')[0];
      if (kind === 'excel') exportExcel(exportColumns, exportRows, `custom-report-${stamp}`);
      else exportPDF(exportColumns, exportRows, `Custom Report (${stamp})`, `custom-report-${stamp}`);
      if (body.truncated) {
        setNotice(`Export limited to the first ${data.length} of ${body.summary?.total} assets. Narrow the filters to export the rest.`);
      }
    } catch (e) {
      toastApiFailure(e, 'Reports · Custom export');
    } finally {
      setExporting(false);
    }
  };

  const pendingChanges = JSON.stringify(filters) !== JSON.stringify(applied);
  const activeCount = countActiveFilters(applied);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <OverallFilterBar filters={filters} onChange={patchFilters} onApply={apply} onReset={reset} />
      <RecommendedFilters filters={filters} onChange={patchFilters} lookups={lookups} />
      <AdvancedFilter filters={filters} onChange={patchFilters} attributes={attributes} />

      <div style={{ display: 'flex', gap: 12 }}>
        <StatPill label="Total (filtered)" value={summary.total} color={T.blue} bg={T.blueL} />
        <StatPill label="In Inventory" value={summary.in_inventory} color={T.green} bg={T.greenL} />
        <StatPill label="Missing" value={summary.missing} color={T.red} bg={T.redL} />
      </div>

      <div style={{ ...cardStyle, padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <div>
            <Heading>Assets</Heading>
            <Sub>
              {activeCount ? `${activeCount} filter${activeCount === 1 ? '' : 's'} applied` : 'No filters applied'}
              {pendingChanges && <span style={{ color: T.amber, marginLeft: 8 }}>Unapplied changes, press Apply</span>}
            </Sub>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <AttributeColumnPicker attributes={attributes} selected={attrColumns} onChange={setAttrColumns} />
            <ExportBtn type="excel" disabled={exporting} onClick={() => runExport('excel')} />
            <ExportBtn type="pdf" disabled={exporting} onClick={() => runExport('pdf')} />
          </div>
        </div>
        {notice && (
          <div style={{
            marginBottom: 12, padding: '8px 12px', borderRadius: 8, fontSize: 12.5,
            background: T.amberL, color: T.amber, border: '1px solid #FDE68A',
          }}>
            {notice}
          </div>
        )}
        <OverallResultsTable
          rows={displayRows}
          loading={loading}
          columns={columns}
          sort={sort}
          sortDir={sortDir}
          onSort={onSort}
          page={page}
          totalPages={totalPages}
          total={summary.total}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(n) => { setPageSize(n); setPage(1); }}
        />
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import api from '../api';
import { toastApiFailure } from '../apiErrorHandling';

const SAMPLES = {
  assets: [['Serial', 'Name', 'RFID', 'Asset Type', 'Location', 'Description', 'Attribute1', 'Attribute2']],
  'asset-types': [['Asset Type', 'Parent Asset Type', 'Description', 'Attribute1', 'Attribute2']],
  locations: [['Location', 'Parent Location', 'Description']],
};

function downloadSample(type) {
  const ws = XLSX.utils.aoa_to_sheet(SAMPLES[type]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, `sample-${type}.xlsx`);
}

const STATUS_BG = { insert: '#c6f6d5', update: '#dbeafe', error: '#fff5f5', skipped: '#e2e8f0' };
const STATUS_COLOR = { insert: '#276749', update: '#1a56db', error: '#9b2c2c', skipped: '#555' };

function StatusBadge({ status }) {
  return (
    <span style={{ background: STATUS_BG[status] || '#e2e8f0', color: STATUS_COLOR[status] || '#555', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
      {status}
    </span>
  );
}

// ── Smart Fix Dialog ───────────────────────────────────────────
function SmartFixDialog({ missingTypes, missingLocations, attributeCols, onSmartFix, onIgnore, onAbort }) {
  return (
    <div className="modal-overlay" style={{ zIndex: 300 }}>
      <div style={{ background: '#fff', borderRadius: 8, width: 680, maxWidth: '95vw', boxShadow: '0 4px 24px rgba(0,0,0,0.18)', overflow: 'hidden' }}>
        <div style={{ background: '#f7f8fc', padding: '10px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            {missingTypes.length} Asset Type(s) and {missingLocations.length} location(s) were not available in the system
          </span>
          <button onClick={onAbort} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#888' }}>×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: '1px solid #e2e8f0' }}>
          {[{ label: 'Asset Types', items: missingTypes }, { label: 'Locations', items: missingLocations }, { label: 'Attributes', items: attributeCols }].map(({ label, items }) => (
            <div key={label} style={{ borderRight: '1px solid #e2e8f0' }}>
              <div style={{ fontWeight: 600, fontSize: 13, padding: '8px 12px', borderBottom: '1px solid #e2e8f0', background: '#fafafa' }}>{label}</div>
              <div style={{ minHeight: 220, maxHeight: 280, overflowY: 'auto' }}>
                {items.map((item, i) => (
                  <div key={i} style={{ padding: '6px 12px', fontSize: 13, background: i === 0 ? '#fffde7' : 'inherit', borderBottom: '1px solid #f7f8fc' }}>{item}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>* Smart Fix will create missing Asset Types, Locations and Attributes</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-primary btn-sm" onClick={onSmartFix}>Smart Fix</button>
            <button className="btn btn-secondary btn-sm" onClick={onIgnore}>Ignore</button>
            <button className="btn btn-secondary btn-sm" onClick={onAbort}>Abort</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Field Mapper ───────────────────────────────────────────────
// Unmapped cols show editable Attribute/Skip dropdown + data type selector
function FieldMapper({ fields, columns, mapping, attrMapping, attrTypes, onMappingChange, onAttrMappingChange, onAttrTypeChange }) {
  const mappedCols = Object.values(mapping).filter(Boolean);
  const unmappedCols = columns.filter(c => !mappedCols.includes(c));

  return (
    <div style={{ background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '160px 200px 160px', gap: '10px 16px', alignItems: 'center' }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: '#333' }}>CSV Keys</div>
        <div style={{ fontWeight: 600, fontSize: 13, color: '#333' }}>System Keys</div>
        <div />

        {/* Known system fields */}
        {fields.map(f => (
          <React.Fragment key={f.key}>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#555' }}>
              {f.label}{f.required && <span style={{ color: '#e53e3e' }}> *</span>}
            </label>
            <select
              value={mapping[f.key] || ''}
              onChange={e => onMappingChange({ ...mapping, [f.key]: e.target.value })}
              style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
            >
              <option value="">-Select-</option>
              {columns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div />
          </React.Fragment>
        ))}

        {/* Unmapped columns — editable Attribute/Skip + data type */}
        {unmappedCols.map(col => (
          <React.Fragment key={col}>
            <label style={{ fontSize: 13, fontWeight: 500, color: '#7c8cf8' }}>{col}</label>
            <select
              value={attrMapping[col] || 'attribute'}
              onChange={e => onAttrMappingChange({ ...attrMapping, [col]: e.target.value })}
              style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
            >
              <option value="attribute">Attribute</option>
              <option value="skip">-Skip-</option>
            </select>
            {(attrMapping[col] || 'attribute') === 'attribute' ? (
              <select
                value={attrTypes[col] || 'string'}
                onChange={e => onAttrTypeChange({ ...attrTypes, [col]: e.target.value })}
                style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }}
              >
                <option value="string">String</option>
                <option value="double">Double</option>
                <option value="date">Date</option>
                <option value="list">List</option>
              </select>
            ) : <div />}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ── Preview Table ──────────────────────────────────────────────
function PreviewTable({ rows, columns, attrCols }) {
  const counts = { insert: 0, update: 0, error: 0, skipped: 0 };
  rows.forEach(r => { if (counts[r._status] !== undefined) counts[r._status]++; });

  return (
    <div>
      <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 16 }}>
        <table style={{ minWidth: 600 }}>
          <thead>
            <tr>
              <th style={{ width: 80 }}>Status</th>
              {columns.map(c => <th key={c}>{c}</th>)}
              {attrCols.map(c => <th key={c}>{c}</th>)}
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={{ background: STATUS_BG[row._status] || 'inherit' }}>
                <td><StatusBadge status={row._status} /></td>
                {columns.map(c => <td key={c} style={{ fontSize: 13 }}>{row[c]}</td>)}
                {attrCols.map(c => <td key={c} style={{ fontSize: 13 }}>{row.attributes?.[c] || ''}</td>)}
                <td style={{ fontSize: 12, color: '#e53e3e' }}>{(row._errors || []).join('; ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 24, fontSize: 13, alignItems: 'center' }}>
        <span><span style={{ display: 'inline-block', width: 14, height: 14, background: '#e2e8f0', border: '1px solid #ccc', marginRight: 6, verticalAlign: 'middle' }} />All ({rows.length})</span>
        <span><span style={{ display: 'inline-block', width: 14, height: 14, background: '#c6f6d5', marginRight: 6, verticalAlign: 'middle' }} />Insert ({counts.insert})</span>
        <span><span style={{ display: 'inline-block', width: 14, height: 14, background: '#dbeafe', marginRight: 6, verticalAlign: 'middle' }} />Update ({counts.update})</span>
        <span><span style={{ display: 'inline-block', width: 14, height: 14, background: '#fed7d7', marginRight: 6, verticalAlign: 'middle' }} />Error ({counts.error})</span>
      </div>
    </div>
  );
}

// ── Import Wizard ──────────────────────────────────────────────
function ImportWizard({ title, fields, endpoint }) {
  const [step, setStep] = useState(1);
  const [columns, setColumns] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [attrMapping, setAttrMapping] = useState({}); // col -> 'attribute' | 'skip'
  const [attrTypes, setAttrTypes] = useState({});     // col -> data type
  const [preview, setPreview] = useState([]);
  const [attrCols, setAttrCols] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [smartFixDialog, setSmartFixDialog] = useState(null);

  // Persist & restore mapping per endpoint
  const loadSaved = (headers) => {
    try {
      const saved = JSON.parse(localStorage.getItem(`import_mapping_${endpoint}`) || '{}');
      const auto = {};
      fields.forEach(f => {
        if (saved.mapping?.[f.key] && headers.includes(saved.mapping[f.key])) {
          auto[f.key] = saved.mapping[f.key];
        } else {
          const match = headers.find(h => h.toLowerCase().replace(/\s+/g, '') === f.label.toLowerCase().replace(/\s+/g, ''));
          if (match) auto[f.key] = match;
        }
      });
      const savedAttrTypes = {};
      const savedAttrMapping = {};
      headers.forEach(h => {
        if (saved.attrTypes?.[h]) savedAttrTypes[h] = saved.attrTypes[h];
        if (saved.attrMapping?.[h]) savedAttrMapping[h] = saved.attrMapping[h];
      });
      return { auto, savedAttrTypes, savedAttrMapping };
    } catch { return { auto: {}, savedAttrTypes: {}, savedAttrMapping: {} }; }
  };

  const saveMapping = (m, at, am) => {
    try { localStorage.setItem(`import_mapping_${endpoint}`, JSON.stringify({ mapping: m, attrTypes: at, attrMapping: am })); } catch {}
  };

  const reset = () => {
    setStep(1); setColumns([]); setRawRows([]); setMapping({});
    setAttrMapping({}); setAttrTypes({}); setPreview([]); setAttrCols([]);
    setResult(null); setFileName(''); setSmartFixDialog(null);
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (data.length < 1) return;
      const headers = data[0].map(h => String(h).trim()).filter(Boolean);
      const rows = data.slice(1).filter(r => r.some(c => c !== '')).map(r => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = String(r[i] || '').trim(); });
        return obj;
      });
      setColumns(headers);
      setRawRows(rows);
      const { auto, savedAttrTypes, savedAttrMapping } = loadSaved(headers);
      setMapping(auto);
      setAttrTypes(savedAttrTypes);
      setAttrMapping(savedAttrMapping);
      setStep(2);
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const buildMappedRows = () => {
    const mappedCols = Object.values(mapping).filter(Boolean);
    const unmapped = columns.filter(c => !mappedCols.includes(c) && (attrMapping[c] || 'attribute') === 'attribute');
    const mapped = rawRows.map(row => {
      const obj = {};
      fields.forEach(f => { if (mapping[f.key]) obj[f.key] = row[mapping[f.key]] || ''; });
      if (unmapped.length) {
        obj.attributes = {};
        obj.attrTypes = {};
        unmapped.forEach(c => { obj.attributes[c] = row[c] || ''; obj.attrTypes[c] = attrTypes[c] || 'string'; });
      }
      return obj;
    });
    return { unmapped, mapped };
  };

  const runPreview = async (mapped, unmapped) => {
    try {
      const res = await api.post(`/import/${endpoint}/preview`, { rows: mapped });
      setPreview(res.data);
      setAttrCols(unmapped || []);
      setStep(3);
    } catch (e) { toastApiFailure(e, 'Import · Preview'); }
  };

  const handlePreviewClick = async () => {
    saveMapping(mapping, attrTypes, attrMapping);
    if (endpoint !== 'assets') {
      setLoading(true);
      const { mapped, unmapped } = buildMappedRows();
      await runPreview(mapped, unmapped);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { unmapped, mapped } = buildMappedRows();
    try {
      const res = await api.post('/import/assets/check', { rows: mapped });
      const { missingTypes, missingLocations } = res.data;
      if (missingTypes.length > 0 || missingLocations.length > 0) {
        setSmartFixDialog({ missingTypes, missingLocations, attributeCols: unmapped, mappedRows: mapped, unmapped });
        setLoading(false);
        return;
      }
      await runPreview(mapped, unmapped);
    } catch (e) { toastApiFailure(e, 'Import · Check'); }
    setLoading(false);
  };

  const handleSmartFix = async () => {
    const { mappedRows, unmapped } = smartFixDialog;
    setSmartFixDialog(null);
    setLoading(true);
    try {
      await api.post('/import/assets/smartfix', { rows: mappedRows });
      await runPreview(mappedRows, unmapped);
    } catch (e) { toastApiFailure(e, 'Import · Smart fix'); }
    setLoading(false);
  };

  const handleIgnore = async () => {
    const { mappedRows, unmapped } = smartFixDialog;
    setSmartFixDialog(null);
    setLoading(true);
    try {
      await runPreview(mappedRows, unmapped);
    } catch (e) {
      toastApiFailure(e, 'Import · Preview');
    }
    setLoading(false);
  };

  const executeImport = async () => {
    setLoading(true);
    try {
      const res = await api.post(`/import/${endpoint}/execute`, { rows: preview.filter(r => r._status !== 'error') });
      setResult(res.data);
      setStep(4);
    } catch (e) { toastApiFailure(e, 'Import · Execute'); }
    setLoading(false);
  };

  return (
    <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden', marginBottom: 32 }}>
      {smartFixDialog && (
        <SmartFixDialog
          missingTypes={smartFixDialog.missingTypes}
          missingLocations={smartFixDialog.missingLocations}
          attributeCols={smartFixDialog.attributeCols}
          onSmartFix={handleSmartFix}
          onIgnore={handleIgnore}
          onAbort={() => setSmartFixDialog(null)}
        />
      )}

      <div style={{ background: '#f7f8fc', padding: '12px 20px', borderBottom: '1px solid #e2e8f0', fontWeight: 600, fontSize: 15, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{title}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {['Upload', 'Map Fields', 'Preview'].map((label, i) => (
            <span key={i} style={{ padding: '2px 10px', borderRadius: 12, background: step >= i + 1 ? '#7c8cf8' : '#e2e8f0', color: step >= i + 1 ? '#fff' : '#888', fontSize: 12 }}>{label}</span>
          ))}
        </div>
      </div>

      <div style={{ padding: 24 }}>
        {step === 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ fontWeight: 500, fontSize: 14 }}>Upload File :</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="text" readOnly value={fileName} placeholder="No file selected"
                style={{ width: 240, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
              <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer', marginBottom: 0 }}>
                ...
                <input type="file" accept=".csv,.xls,.xlsx" style={{ display: 'none' }} onChange={handleFile} />
              </label>
            </div>
            <button className="btn btn-secondary btn-sm" style={{ color: '#7c8cf8' }} onClick={() => downloadSample(endpoint)}>
              ⬇ Download sample spreadsheet
            </button>
            <div style={{ width: '100%', fontSize: 12, color: '#888', marginTop: 4 }}>Supports *.csv, *.xls, *.xlsx</div>
          </div>
        )}

        {step === 2 && (
          <div>
            <FieldMapper
              fields={fields} columns={columns}
              mapping={mapping} attrMapping={attrMapping} attrTypes={attrTypes}
              onMappingChange={setMapping} onAttrMappingChange={setAttrMapping} onAttrTypeChange={setAttrTypes}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={reset}>Back</button>
              <button className="btn btn-primary" onClick={handlePreviewClick} disabled={loading}>
                {loading ? 'Checking...' : 'Preview →'}
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <PreviewTable rows={preview} columns={fields.filter(f => mapping[f.key]).map(f => f.key)} attrCols={attrCols} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setStep(2)}>Back</button>
              <button className="btn btn-primary" onClick={executeImport} disabled={loading || preview.every(r => r._status === 'error')}>
                {loading ? 'Importing...' : 'Import'}
              </button>
              <button className="btn btn-secondary" onClick={reset}>Cancel</button>
            </div>
          </div>
        )}

        {step === 4 && result && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Import Complete</div>
            <div style={{ display: 'flex', gap: 24, justifyContent: 'center', fontSize: 14, marginBottom: 24 }}>
              <span style={{ color: '#276749' }}>Inserted: {result.inserted}</span>
              <span style={{ color: '#1a56db' }}>Updated: {result.updated}</span>
              <span style={{ color: '#9b2c2c' }}>Errors: {result.errors}</span>
            </div>
            <button className="btn btn-primary" onClick={reset}>Import Another File</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Field definitions ──────────────────────────────────────────
const ASSET_FIELDS = [
  { key: 'asset_serial', label: 'Serial', required: true },
  { key: 'name', label: 'Name', required: true },
  { key: 'rfid_tag', label: 'RFID' },
  { key: 'asset_type', label: 'Asset Type' },
  { key: 'location', label: 'Location' },
  { key: 'description', label: 'Description' },
];

const ASSET_TYPE_FIELDS = [
  { key: 'name', label: 'Asset Type', required: true },
  { key: 'parent_name', label: 'Parent Asset Type' },
  { key: 'description', label: 'Description' },
];

const LOCATION_FIELDS = [
  { key: 'name', label: 'Location', required: true },
  { key: 'parent_name', label: 'Parent Location' },
  { key: 'description', label: 'Description' },
];

export default function Import() {
  const [tab, setTab] = useState('assets');
  return (
    <div>
      <div className="page-header"><h1>Import</h1></div>
      <div className="detail-tabs" style={{ marginBottom: 24 }}>
        {[['assets', 'Import Assets'], ['asset-types', 'Import Asset Types'], ['locations', 'Import Locations']].map(([key, label]) => (
          <button key={key} className={`tab-btn ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      {tab === 'assets' && <ImportWizard title="Import Assets" endpoint="assets" fields={ASSET_FIELDS} />}
      {tab === 'asset-types' && <ImportWizard title="Import Asset Types" endpoint="asset-types" fields={ASSET_TYPE_FIELDS} />}
      {tab === 'locations' && <ImportWizard title="Import Locations" endpoint="locations" fields={LOCATION_FIELDS} />}
    </div>
  );
}

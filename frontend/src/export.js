import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

function cellValue(row, key) {
  const v = row[key];
  return v === null || v === undefined || v === '' ? '—' : v;
}

/** jsPDF Helvetica only supports WinAnsi — normalize Unicode before drawing text. */
function pdfSafeText(value) {
  return String(value ?? '')
    .replace(/\u2192/g, ' to ')   // →
    .replace(/\u2014/g, '-')      // —
    .replace(/\u2013/g, '-')      // –
    .replace(/\u00b7/g, ' - ')    // ·
    .replace(/\u2026/g, '...');   // …
}

function columnWidths(columns, rows) {
  return columns.map((c) => {
    let maxLen = c.header.length;
    for (const r of rows) {
      const len = String(cellValue(r, c.key)).length;
      if (len > maxLen) maxLen = len;
    }
    return { wch: Math.min(maxLen + 2, 72) };
  });
}

function sheetFromTable(columns, rows) {
  const safeRows = rows || [];
  const wsData = [
    columns.map((c) => c.header),
    ...safeRows.map((row) => columns.map((c) => cellValue(row, c.key))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = columnWidths(columns, safeRows);
  return ws;
}

function sanitizeSheetName(name) {
  const safe = String(name || 'Sheet').replace(/[\\/*?:[\]]/g, ' ').trim() || 'Sheet';
  return safe.slice(0, 31);
}

/* ─── Excel export ───────────────────────────────────────────── */
export function exportExcel(columns, rows, filename = 'export') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromTable(columns, rows), 'Sheet1');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/** Excel workbook with one sheet per section: [{ name, columns, rows }]. */
export function exportExcelMultiSheet(sheets, filename = 'export') {
  const wb = XLSX.utils.book_new();
  const used = new Set();
  (sheets || []).forEach((sheet) => {
    let name = sanitizeSheetName(sheet.name);
    let suffix = 2;
    while (used.has(name)) {
      const base = name.slice(0, 28);
      name = `${base} (${suffix++})`;
    }
    used.add(name);
    XLSX.utils.book_append_sheet(wb, sheetFromTable(sheet.columns || [], sheet.rows || []), name);
  });
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/**
 * One worksheet with stacked sections (matches PDF layout).
 * sections: [{ title, columns, rows }]
 */
export function exportExcelSections(sections, filename = 'export', options = {}) {
  const { sheetName = 'Report', reportTitle = '' } = options;
  const aoa = [];
  const allRows = [];

  if (reportTitle) {
    aoa.push([reportTitle]);
    aoa.push([
      `Generated: ${new Date().toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}`,
    ]);
    aoa.push([]);
  }

  (sections || []).forEach((section, index) => {
    const columns = section.columns || [];
    const rows = section.rows || [];
    if (index > 0) aoa.push([]);
    const count = rows.length;
    aoa.push([`${section.title} (${count} asset${count === 1 ? '' : 's'})`]);
    aoa.push(columns.map((c) => c.header));
    rows.forEach((row) => {
      aoa.push(columns.map((c) => cellValue(row, c.key)));
      allRows.push(row);
    });
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const flatColumns = (sections || []).find((s) => s.columns?.length)?.columns || [];
  if (flatColumns.length) {
    ws['!cols'] = columnWidths(flatColumns, allRows);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(sheetName));
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

const PDF_TABLE_OPTS = {
  styles: {
    fontSize: 8,
    cellPadding: 3,
    overflow: 'linebreak',
    textColor: [15, 23, 42],
  },
  headStyles: {
    fillColor: [37, 99, 235],
    textColor: 255,
    fontStyle: 'bold',
    fontSize: 8.5,
  },
  alternateRowStyles: { fillColor: [248, 250, 252] },
  tableLineColor: [226, 232, 240],
  tableLineWidth: 0.1,
  margin: { left: 14, right: 14 },
};

function pdfColumnHeaders(columns) {
  return (columns || []).map((c) =>
    pdfSafeText(c?.header != null ? String(c.header) : String(c?.key ?? ''))
  );
}

function pdfTableBody(columns, rows) {
  return rows.map((row) =>
    columns.map((c) => pdfSafeText(String(cellValue(row, c.key))))
  );
}

function drawPdfHeader(doc, title) {
  doc.setFillColor(37, 99, 235);
  doc.rect(0, 0, 297, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('RFID Asset Management System', 14, 10);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(pdfSafeText(title), 14, 17);
  const now = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  doc.setFontSize(8);
  doc.text(`Generated: ${now}`, 297 - 14, 17, { align: 'right' });
}

function drawPdfFooters(doc) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      pdfSafeText(`Page ${i} of ${pageCount}  ·  RFID Asset Management System`),
      297 / 2, 205, { align: 'center' }
    );
  }
}

/* ─── PDF export ─────────────────────────────────────────────── */
export function exportPDF(columns, rows, title = 'Report', filename = 'export') {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  drawPdfHeader(doc, title);
  autoTable(doc, {
    startY: 26,
    head: [pdfColumnHeaders(columns)],
    body: pdfTableBody(columns, rows),
    ...PDF_TABLE_OPTS,
  });
  drawPdfFooters(doc);
  doc.save(`${filename}.pdf`);
}

/** PDF with multiple titled tables: [{ title, columns, rows }]. */
export function exportPDFSections(sections, title = 'Report', filename = 'export') {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  drawPdfHeader(doc, title);
  let startY = 28;

  sections.forEach((section, index) => {
    const rows = section.rows || [];
    const columns = section.columns || [];
    const countLabel = ` (${rows.length} asset${rows.length === 1 ? '' : 's'})`;

    if (index > 0 && startY > 165) {
      doc.addPage();
      startY = 20;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text(pdfSafeText(`${section.title}${countLabel}`), 14, startY);
    startY += 5;

    autoTable(doc, {
      startY,
      head: [pdfColumnHeaders(columns)],
      body: pdfTableBody(columns, rows),
      ...PDF_TABLE_OPTS,
    });
    startY = (doc.lastAutoTable?.finalY ?? startY) + 10;
  });

  drawPdfFooters(doc);
  doc.save(`${filename}.pdf`);
}

/* ─── Export button component ────────────────────────────────── */
const EXCEL_BTN_STYLE = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '6px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
  background: '#F0FDF4', color: '#15803D',
  border: '1px solid #BBF7D0', transition: 'all 0.15s',
};
const PDF_BTN_STYLE = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '6px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
  background: '#FEF2F2', color: '#DC2626',
  border: '1px solid #FECACA', transition: 'all 0.15s',
};

function exportBtnDisabledStyle(base) {
  return {
    ...base,
    cursor: 'not-allowed',
    opacity: 0.55,
    pointerEvents: 'auto',
  };
}

export function ExportButtons({ onExcel, onPDF, disabled = false, label = 'Export' }) {
  const noDataTitle = 'No data to export';

  const handleExcel = (e) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    onExcel?.();
  };

  const handlePDF = (e) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    onPDF?.();
  };

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button
        type="button"
        onClick={handleExcel}
        title={disabled ? noDataTitle : 'Export to Excel'}
        aria-disabled={disabled}
        style={disabled
          ? exportBtnDisabledStyle(EXCEL_BTN_STYLE)
          : { ...EXCEL_BTN_STYLE, cursor: 'pointer' }}
        onMouseEnter={disabled ? undefined : (e) => { e.currentTarget.style.background = '#DCFCE7'; }}
        onMouseLeave={disabled ? undefined : (e) => { e.currentTarget.style.background = '#F0FDF4'; }}
      >
        📊 Excel
      </button>
      <button
        type="button"
        onClick={handlePDF}
        title={disabled ? noDataTitle : 'Export to PDF'}
        aria-disabled={disabled}
        style={disabled
          ? exportBtnDisabledStyle(PDF_BTN_STYLE)
          : { ...PDF_BTN_STYLE, cursor: 'pointer' }}
        onMouseEnter={disabled ? undefined : (e) => { e.currentTarget.style.background = '#FEE2E2'; }}
        onMouseLeave={disabled ? undefined : (e) => { e.currentTarget.style.background = '#FEF2F2'; }}
      >
        📄 PDF
      </button>
    </div>
  );
}

import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/* ─── Excel export ───────────────────────────────────────────── */
export function exportExcel(columns, rows, filename = 'export') {
  // columns: [{ header, key }]
  // rows: array of objects
  const wsData = [
    columns.map(c => c.header),
    ...rows.map(row => columns.map(c => {
      const v = row[c.key];
      return v === null || v === undefined || v === '' ? '—' : v;
    })),
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Auto column widths
  const colWidths = columns.map((c, i) => ({
    wch: Math.max(
      c.header.length,
      ...rows.map(r => String(r[c.key] === null || r[c.key] === undefined || r[c.key] === '' ? '—' : r[c.key]).length)
    ) + 2,
  }));
  ws['!cols'] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

/* ─── PDF export ─────────────────────────────────────────────── */
export function exportPDF(columns, rows, title = 'Report', filename = 'export') {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  // Header bar
  doc.setFillColor(37, 99, 235);          // #2563EB
  doc.rect(0, 0, 297, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('RFID Asset Management System', 14, 10);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(title, 14, 17);

  // Timestamp top-right
  const now = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  doc.setFontSize(8);
  doc.text(`Generated: ${now}`, 297 - 14, 17, { align: 'right' });

  // Table
  autoTable(doc, {
    startY: 26,
    head: [columns.map(c => c.header)],
    body: rows.map(row => columns.map(c => {
      const v = row[c.key];
      return v === null || v === undefined ? '—' : String(v);
    })),
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
  });

  // Footer on each page
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `Page ${i} of ${pageCount}  ·  RFID Asset Management System`,
      297 / 2, 205, { align: 'center' }
    );
  }

  doc.save(`${filename}.pdf`);
}

/* ─── Export button component ────────────────────────────────── */
export function ExportButtons({ onExcel, onPDF, label = 'Export' }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button
        onClick={onExcel}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '6px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
          background: '#F0FDF4', color: '#15803D',
          border: '1px solid #BBF7D0', cursor: 'pointer',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#DCFCE7'}
        onMouseLeave={e => e.currentTarget.style.background = '#F0FDF4'}
      >
        📊 Excel
      </button>
      <button
        onClick={onPDF}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '6px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
          background: '#FEF2F2', color: '#DC2626',
          border: '1px solid #FECACA', cursor: 'pointer',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#FEE2E2'}
        onMouseLeave={e => e.currentTarget.style.background = '#FEF2F2'}
      >
        📄 PDF
      </button>
    </div>
  );
}

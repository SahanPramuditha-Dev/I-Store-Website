import api from "./api";
import JSZip from "jszip";
import * as XLSX from "xlsx";

function resolveValue(column, row) {
  return typeof column.value === "function" ? column.value(row) : row[column.value];
}

function escapeCsv(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function toTabularRows(columns, rows) {
  return (rows || []).map((row) => columns.map((column) => resolveValue(column, row)));
}

export function toCsvString(columns, rows) {
  const header = columns.map((column) => escapeCsv(column.label)).join(",");
  const body = toTabularRows(columns, rows)
    .map((row) => row.map((value) => escapeCsv(value)).join(","))
    .join("\n");
  return `${header}\n${body}`;
}

function triggerDownloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function paginateRows(rows, page, pageSize) {
  const safeSize = Math.max(1, Number(pageSize || 10));
  const totalPages = Math.max(1, Math.ceil((rows?.length || 0) / safeSize));
  const safePage = Math.min(Math.max(1, Number(page || 1)), totalPages);
  const start = (safePage - 1) * safeSize;
  return {
    page: safePage,
    totalPages,
    pageRows: (rows || []).slice(start, start + safeSize),
  };
}

export function downloadCsv(filename, columns, rows) {
  const csv = toCsvString(columns, rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  triggerDownloadBlob(filename, blob);
  return blob.size;
}

export function downloadXlsx(filename, columns, rows, sheetName = "Report") {
  const header = columns.map((column) => column.label);
  const body = toTabularRows(columns, rows);
  const worksheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownloadBlob(filename, blob);
  return blob.size;
}

export async function downloadZipBundle(filename, files) {
  const zip = new JSZip();
  for (const file of files || []) {
    if (!file?.name || !file?.content) continue;
    zip.file(file.name, file.content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownloadBlob(filename, blob);
  return blob.size;
}

export function openPrintView(title, columns, rows) {
  const win = window.open("", "_blank", "width=1200,height=800");
  if (!win) return;

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const thead = `<tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>`;
  const tbody = (rows || [])
    .map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(resolveValue(column, row))}</td>`).join("")}</tr>`)
    .join("");

  win.document.write(`
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; color: #111; }
          h1 { margin: 0 0 8px; font-size: 20px; }
          p { margin: 0 0 16px; color: #444; font-size: 12px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
          th { background: #f3f4f6; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <p>Generated at ${new Date().toLocaleString()}</p>
        <table>
          <thead>${thead}</thead>
          <tbody>${tbody || `<tr><td colspan="${columns.length}">No records found.</td></tr>`}</tbody>
        </table>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

export async function downloadPdf(filenameBase, title, columns, rows, options = {}) {
  const payload = {
    title,
    columns: columns.map((c) => ({ label: c.label })),
    rows: (rows || []).map((row) => columns.map((c) => (typeof c.value === "function" ? c.value(row) : row[c.value]))),
    branding: options.branding || null,
    watermark: options.watermark || null,
    confidential_stamp: Boolean(options.confidentialStamp),
  };
  const res = await api.post("/reports/export-pdf", payload, { responseType: "blob" });
  const blob = new Blob([res.data], { type: "application/pdf" });
  triggerDownloadBlob(`${filenameBase}.pdf`, blob);
  return blob.size;
}

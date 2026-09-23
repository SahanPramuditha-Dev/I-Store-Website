import writeExcelFile from "write-excel-file/browser";

export async function createWorkbookBlob(header, body, sheetName = "Report") {
  const cell = (value) => {
    if (value == null) return { value: "", type: String };
    if (typeof value === "number") return { value, type: Number };
    if (typeof value === "boolean") return { value, type: Boolean };
    return { value: String(value), type: String };
  };
  const data = [header.map(cell), ...body.map((row) => row.map(cell))];
  return writeExcelFile(data, { sheet: String(sheetName || "Report").slice(0, 31) }).toBlob();
}

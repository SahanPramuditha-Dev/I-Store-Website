export async function printHtmlDocument(html, options = {}) {
  const { win = null } = options;
  const printWindow = win ?? window.open("", "_blank");
  if (!printWindow) throw new Error("Print window was blocked");

  const fullDoc = html.includes("<!DOCTYPE") || html.includes("<html")
    ? html
    : `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Print Preview</title></head><body style="margin:0;padding:0;">${html}</body></html>`;

  printWindow.document.open();
  printWindow.document.write(fullDoc);
  printWindow.document.close();

  // Wait for resources/styles to settle before triggering print dialog
  await new Promise((resolve) => setTimeout(resolve, 350));
  printWindow.focus();
  printWindow.print();

  return { ok: true, preview: true };
}

export async function listDesktopPrinters() {
  return [];
}

export async function printHtmlDocument(html, options = {}) {
  const win = window.open("", "_blank");
  if (!win) throw new Error("Print window was blocked");
  win.document.write(html);
  win.document.close();
  return { ok: true, preview: true };
}

export async function listDesktopPrinters() {
  return [];
}

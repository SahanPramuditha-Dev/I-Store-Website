export function formatReleaseNotes(notes) {
  const source = Array.isArray(notes) ? notes.map(entry => typeof entry === "string" ? entry : entry?.note || "").join("\n\n") : String(notes || "");
  const doc = new DOMParser().parseFromString(source, "text/html");
  doc.querySelectorAll("script, style, iframe, object").forEach(node => node.remove());
  doc.querySelectorAll("br").forEach(node => node.replaceWith("\n"));
  doc.querySelectorAll("li").forEach(node => node.prepend("• "));
  doc.querySelectorAll("p, li, h1, h2, h3, h4, blockquote").forEach(node => node.append("\n"));
  return (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

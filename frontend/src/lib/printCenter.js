const TYPE_ALIASES = {
  receipt: "sales_receipt",
  sale: "sales_receipt",
  sales: "sales_receipt",
  invoice: "invoice",
  return: "return_receipt",
  advance: "advance_receipt",
  repair: "repair_job_card",
  warranty: "warranty_certificate",
  barcode: "barcode_sheet",
  label: "product_label",
  payment: "payment_receipt",
};

export function buildPrintCenterPath({ type = "sales_receipt", ref = "", paper = "", template = "" } = {}) {
  const params = new URLSearchParams();
  params.set("type", TYPE_ALIASES[type] || type);
  if (ref !== undefined && ref !== null && String(ref).trim()) params.set("ref", String(ref).trim());
  if (paper) params.set("paper", paper);
  if (template) params.set("template", template);
  return `/print-center?${params.toString()}`;
}

export function openPrintCenter(navigate, intent = {}) {
  if (typeof navigate !== "function") return;
  navigate(buildPrintCenterPath(intent));
}

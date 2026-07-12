import api from "./api";
import { printHtmlDocument } from "./printBridge";

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

export async function openPrintCenter(navigate, intent = {}) {
  if (typeof navigate !== "function") return;

  const { type = "sales_receipt", ref = "", paper = "thermal_80", template = "standard" } = intent;
  const mappedType = TYPE_ALIASES[type] || type;

  try {
    const { data } = await api.get("/print-center/render", {
      params: {
        document_type: mappedType,
        ...(ref ? { reference: ref } : {}),
        paper: paper,
        template: template,
      },
      responseType: "text",
      transformResponse: [(data) => data],
    });

    await printHtmlDocument(data);
  } catch (error) {
    console.error("Direct print failed, falling back to Print Center", error);
    navigate(buildPrintCenterPath(intent));
  }
}

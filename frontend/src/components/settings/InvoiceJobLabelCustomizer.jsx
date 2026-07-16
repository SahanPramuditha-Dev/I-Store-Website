import { useMemo, useRef } from "react";
import html2pdf from "html2pdf.js";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { ModernRetailInvoice } from "../print/ModernRetailInvoice";
import { PremiumBusinessInvoice } from "../print/PremiumBusinessInvoice";

import {
  Copy,
  Download,
  Eye,
  FileText,
  Monitor,
  Plus,
  Printer,
  Rocket,
  RotateCcw,
  Save,
  Smartphone,
  Tag,
  Trash2,
  Upload,
  ZoomIn,
} from "lucide-react";
import { Badge, Button, Input, SectionCard, Select, Table } from "../../components/UI";
import api from "../../lib/api";
import { printHtmlDocument } from "../../lib/printBridge";
import { normalizeStoreProfile } from "../../lib/storeProfile";

const DOC_OPTIONS = [
  { id: "sales_bill", label: "Sales Bill", icon: FileText },
  { id: "job_card", label: "Job Card", icon: Smartphone },
  { id: "labels", label: "Labels", icon: Tag },
];

const FORMAT_OPTIONS = {
  sales_bill: [
    { id: "a4", label: "A4 Office Standard" },
    { id: "a5", label: "A5 Compact" },
    { id: "80mm", label: "80mm Thermal" },
    { id: "58mm", label: "58mm Thermal" },
  ],
  job_card: [
    { id: "a4", label: "A4 Full Job Card" },
    { id: "a5", label: "A5 Compact Card" },
    { id: "thermal", label: "Thermal Job Sticker" },
  ],
  labels: [
    { id: "30x20", label: "30 x 20 mm" },
    { id: "40x25", label: "40 x 25 mm" },
    { id: "50x30", label: "50 x 30 mm" },
    { id: "70x40", label: "70 x 40 mm" },
    { id: "80x50", label: "80 x 50 mm" },
    { id: "100x30", label: "100 x 30 mm" },
    { id: "custom", label: "Custom" },
  ],
};

const SALES_SECTIONS = [
  { id: "branding", label: "Branding" },
  { id: "business", label: "Business" },
  { id: "header", label: "Header" },
  { id: "bill_to", label: "Bill To" },
  { id: "items", label: "Items" },
  { id: "totals", label: "Totals" },
  { id: "payment", label: "Payment" },
  { id: "footer", label: "Footer" },
  { id: "print", label: "Print" },
];

const JOB_SECTIONS = [
  { id: "header", label: "Header" },
  { id: "device_customer", label: "Device & Customer" },
  { id: "issue", label: "Issue & Complaint" },
  { id: "accessories", label: "Accessories" },
  { id: "financial", label: "Financial" },
  { id: "photos", label: "Device Photos" },
  { id: "terms", label: "Terms & Signature" },
  { id: "footer", label: "Footer" },
  { id: "print", label: "Print" },
];

const LABEL_SECTIONS = [
  { id: "layout", label: "Layout" },
  { id: "content", label: "Content Blocks" },
  { id: "style", label: "Styling" },
  { id: "print", label: "Print" },
];

const LABEL_TYPE_OPTIONS = [
  { id: "product_label", label: "Product Label" },
  { id: "repair_job_sticker", label: "Repair Job Sticker" },
  { id: "spare_parts_label", label: "Spare Parts Label" },
  { id: "shelf_label", label: "Shelf Label" },
];

const LABEL_BLOCK_LIBRARY = {
  product_label: [
    ["shop_logo", "Shop Logo", true, 9, false, "#ffffff"],
    ["shop_name", "Shop Name", true, 9, true, "#ffffff"],
    ["product_name", "Product Name", true, 12, true, "#ffffff"],
    ["brand", "Brand", true, 9, false, "#aaaaaa"],
    ["sku", "SKU / Item Code", true, 8, false, "#888888"],
    ["barcode", "Barcode", true, 8, false, "#ffffff"],
    ["barcode_text", "Barcode Number Text", true, 7, false, "#cccccc"],
    ["selling_price", "Selling Price", true, 16, true, "#00d4aa"],
    ["mrp_price", "Original / MRP Price", true, 10, false, "#888888"],
    ["discount_badge", "Discount Badge", true, 10, true, "#ff4d6d"],
    ["warranty_period", "Warranty Period", true, 8, false, "#aaaaaa"],
  ],
  repair_job_sticker: [
    ["job_id", "Job ID", true, 18, true, "#ffffff"],
    ["job_barcode", "Job ID Barcode", true, 8, false, "#ffffff"],
    ["job_qr", "Job ID QR Code", true, 8, false, "#ffffff"],
    ["customer_name", "Customer Name", true, 9, false, "#cccccc"],
    ["customer_phone", "Customer Phone", true, 9, false, "#cccccc"],
    ["device_model", "Device Brand + Model", true, 10, true, "#ffffff"],
    ["imei", "IMEI", true, 8, false, "#aaaaaa"],
    ["eta", "ETA / Delivery Date", true, 8, true, "#00d4aa"],
    ["technician", "Technician", true, 8, false, "#aaaaaa"],
    ["balance_due", "Balance Due", true, 10, true, "#ff4d6d"],
  ],
  spare_parts_label: [
    ["part_name", "Part Name", true, 11, true, "#ffffff"],
    ["part_code", "Part Code / SKU", true, 9, false, "#cccccc"],
    ["barcode", "Barcode", true, 8, false, "#ffffff"],
    ["compatible_models", "Compatible Models", true, 8, false, "#aaaaaa"],
    ["category", "Category", true, 8, false, "#aaaaaa"],
    ["qty_pack", "Qty in Pack", true, 8, false, "#aaaaaa"],
    ["location", "Storage Location", true, 9, true, "#f5f5f5"],
    ["condition", "Condition", true, 8, false, "#aaaaaa"],
  ],
  shelf_label: [
    ["product_name", "Product Name", true, 14, true, "#ffffff"],
    ["brand", "Brand", true, 10, false, "#cccccc"],
    ["model", "Model", true, 10, false, "#cccccc"],
    ["selling_price", "Selling Price", true, 22, true, "#00d4aa"],
    ["original_price", "Original Price", true, 12, false, "#888888"],
    ["discount_badge", "Discount Badge", true, 11, true, "#ff4d6d"],
    ["barcode", "Barcode", true, 8, false, "#ffffff"],
    ["warranty_badge", "Warranty Badge", true, 9, false, "#aaaaaa"],
  ],
};

const FONT_OPTIONS = ["DM Sans", "Inter", "Roboto", "Poppins", "Montserrat", "Noto Sans Sinhala"];
const PREVIEW_ZOOM_OPTIONS = ["fit", "50", "75", "100", "150"];
const PREVIEW_MODE_OPTIONS = ["sample", "last", "empty"];

const SAMPLE_SALES_ITEMS = [
  { description: "iPhone 13 128GB Blue", imei: "356789012345678", qty: 1, unit_price: 245000, discount: 5000, total: 240000, warranty: "12 months" },
  { description: "Type-C Fast Charger 20W", imei: "-", qty: 1, unit_price: 4500, discount: 0, total: 4500, warranty: "6 months" },
];

const SAMPLE_JOB = {
  job_id: "JOB-20260516-014",
  customer_name: "Kasun Perera",
  customer_phone: "0771234567",
  device_brand: "Samsung",
  device_model: "Galaxy A52",
  imei: "352001234567890",
  priority: "Urgent",
  status: "Repairing",
  received_at: "16/05/2026 10:45",
  eta: "17/05/2026 16:00",
  technician: "Nimal",
  issue: "Display not responding",
  diagnosis: "Touch IC fault suspected",
  complaint: "Screen freezes intermittently",
  estimate: 16500,
  advance: 5000,
  balance: 11500,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDefaults(defaultValue, incomingValue) {
  if (Array.isArray(defaultValue)) {
    if (Array.isArray(incomingValue) && incomingValue.length > 0) return incomingValue;
    return clone(defaultValue);
  }
  if (defaultValue && typeof defaultValue === "object") {
    const incoming = incomingValue && typeof incomingValue === "object" ? incomingValue : {};
    const out = { ...incoming };
    Object.entries(defaultValue).forEach(([key, nestedDefault]) => {
      out[key] = mergeDefaults(nestedDefault, incoming[key]);
    });
    return out;
  }
  return incomingValue === undefined || incomingValue === null ? defaultValue : incomingValue;
}

function setPath(target, path, value) {
  const keys = String(path || "").split(".").filter(Boolean);
  if (!keys.length) return;
  let ptr = target;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const k = keys[i];
    if (!ptr[k] || typeof ptr[k] !== "object") ptr[k] = {};
    ptr = ptr[k];
  }
  ptr[keys[keys.length - 1]] = value;
}

function makeLabelBlocks(type) {
  const rows = LABEL_BLOCK_LIBRARY[type] || [];
  return Object.fromEntries(
    rows.map(([id, label, show, fontSize, bold, color]) => [
      id,
      {
        label,
        show,
        font_size: fontSize,
        bold,
        color,
      },
    ])
  );
}

function defaultSalesSettings(format = "a4") {
  return {
    branding: {
      show_logo: true,
      logo_size: "Medium",
      logo_custom_px: 54,
      logo_position: "Left",
      logo_top_margin: 8,
      separate_thermal_logo: true,
      show_shop_name: true,
      shop_name_text: "",
      shop_name_font: "Montserrat",
      shop_name_size: 24,
      shop_name_weight: "Bold",
      shop_name_color: "#ffffff",
      show_tagline: true,
      tagline_text: "",
      tagline_size: 11,
      tagline_color: "#aaaaaa",
    },
    business: {
      show_address: true,
      show_phone: true,
      show_secondary_phone: false,
      show_email: true,
      show_website: true,
      show_tax_number: true,
      layout: "Stacked",
      align: "Right",
      font_size: 10,
      color: "#cccccc",
    },
    header: {
      show_title: true,
      title_text: "TAX INVOICE",
      title_size: 18,
      title_weight: "Bold",
      title_color: "#6c63ff",
      title_align: "Center",
      show_invoice_no: true,
      show_date: true,
      show_time: true,
      show_cashier: true,
      show_branch: false,
      date_format: "DD/MM/YYYY",
      time_format: "12-hour",
      meta_layout: "2 columns",
      show_qr: true,
      qr_content: "Invoice verification URL",
      qr_size: 60,
      qr_position: "Top right",
    },
    bill_to: {
      show_section: true,
      section_label: "BILL TO",
      show_customer_name: true,
      show_customer_phone: true,
      show_customer_address: false,
      show_customer_id: false,
      show_outstanding: true,
      outstanding_label: "Outstanding Balance",
      border_style: "Solid",
      border_color: "#333355",
      background_color: "#1a1d2e",
      radius: 6,
    },
    items: {
      show_imei: true,
      show_discount: true,
      show_warranty: true,
      row_height: 32,
      header_bg: "#252840",
      header_text: "#ffffff",
      row_even_bg: "#1a1d2e",
      row_odd_bg: "#141628",
      row_text: "#e0e0e0",
      border_color: "#2a2d4a",
    },
    totals: {
      show_subtotal: true,
      show_discount: true,
      show_tax: true,
      show_rounding: true,
      show_total: true,
      show_paid: true,
      show_balance: true,
      show_outstanding: true,
      show_total_words: true,
      totals_align: "Right",
      width_percent: 50,
      total_color: "#6c63ff",
      total_bg: "#1a1d2e",
    },
    payment: {
      show_section: true,
      show_method: true,
      show_tendered: true,
      show_change: true,
      show_partial_history: true,
      show_remaining: true,
    },
    footer: {
      show_thank_you: true,
      thank_you_text: "Thank you for your purchase!",
      thank_you_size: 11,
      thank_you_color: "#aaaaaa",
      show_return_policy: true,
      return_policy_text: "Items can be returned within 7 days with receipt.",
      show_warranty_note: true,
      warranty_note_text: "All products carry manufacturer warranty. Repair warranty: 30 days.",
      custom_line_1: "Call us: +94 77 123 4567",
      custom_line_2: "Visit: www.istore.com",
      custom_line_3: "",
      show_footer_qr: false,
      show_invoice_barcode: false,
    },
    print: {
      paper_size: format === "80mm" || format === "58mm" ? format : format.toUpperCase(),
      orientation: "Portrait",
      margin_top_mm: 15,
      margin_bottom_mm: 15,
      margin_left_mm: 15,
      margin_right_mm: 15,
      font_family: "DM Sans",
      base_font_size: 11,
      line_spacing: 1.4,
      color_scheme: "Light",
      accent_color: "#0066cc",
      background_color: "#ffffff",
      text_color: "#1a1a2e",
      watermark: "None",
    },
  };
}

function defaultJobSettings(format = "a4") {
  return {
    header: {
      title_text: "REPAIR JOB CARD",
      show_job_id: true,
      job_id_size: 24,
      job_id_label: "JOB ID",
      show_job_barcode: true,
      show_job_qr: true,
      qr_target: "Job detail page",
      show_shop_logo: true,
      show_shop_name: true,
      show_contact: true,
    },
    device_customer: {
      layout: "2 columns",
      show_customer_name: true,
      show_customer_phone: true,
      show_customer_address: false,
      show_customer_id: false,
      show_device_brand: true,
      show_device_model: true,
      show_imei: true,
      show_color: true,
      show_condition: true,
      show_received: true,
      show_eta: true,
      show_technician: true,
      show_priority: true,
      show_status: true,
    },
    issue: {
      show_issue_section: true,
      issue_label: "REPORTED ISSUE",
      issue_lines: 3,
      show_diagnosis: true,
      diagnosis_label: "DIAGNOSIS",
      diagnosis_lines: 3,
      show_complaint: true,
      complaint_label: "CUSTOMER COMPLAINT",
    },
    accessories: {
      show_section: true,
      layout: "Checkbox grid",
      items: ["SIM Card", "Memory Card", "Charger", "Back Cover", "Case / Cover", "Screen Protector", "Earphones", "Battery", "Box", "Warranty Card"],
      show_other_field: true,
    },
    financial: {
      show_estimate: true,
      show_advance: true,
      show_balance: true,
      show_final_total: true,
      show_payment_method: true,
      show_payment_history: true,
    },
    photos: {
      show_section: true,
      boxes: 2,
      box_size: "Medium",
      show_before_after: true,
      show_caption: true,
    },
    terms: {
      show_terms: true,
      terms_font_size: 9,
      terms_text:
        "1. Device not collected within 60 days is customer responsibility.\n2. The store is not responsible for data loss during repairs.\n3. Warranty void if device opened by third-party.\n4. Repair warranty covers the same fault only for 30 days.",
      show_customer_sign: true,
      show_sign_date: true,
      show_technician_sign: true,
      show_manager_sign: false,
      sign_line_style: "Solid",
      sign_line_width_percent: 60,
    },
    footer: {
      show_footer_message: true,
      footer_text: "Thank you for trusting us with your device.",
      show_tear_off: true,
      tear_off_label: "CUSTOMER COPY - KEEP THIS SLIP",
      tear_off_show_job_id: true,
      tear_off_show_barcode: true,
      tear_off_show_customer: true,
      tear_off_show_device: true,
      tear_off_show_eta: true,
      tear_off_show_balance: true,
      tear_off_show_phone: true,
    },
    print: {
      paper_size: format === "thermal" ? "Thermal" : format.toUpperCase(),
      orientation: "Portrait",
      margin_top_mm: 10,
      margin_bottom_mm: 10,
      margin_left_mm: 10,
      margin_right_mm: 10,
      font_family: "DM Sans",
      base_font_size: 11,
      accent_color: "#6c63ff",
      background_color: "#ffffff",
      text_color: "#1a1a2e",
    },
  };
}

function defaultLabelSettings(format = "50x30") {
  return {
    layout: {
      label_type: "product_label",
      size_preset: format,
      custom_width_mm: 50,
      custom_height_mm: 30,
      padding_px: 4,
      corner_radius_px: 4,
    },
    blocks: {
      product_label: makeLabelBlocks("product_label"),
      repair_job_sticker: makeLabelBlocks("repair_job_sticker"),
      spare_parts_label: makeLabelBlocks("spare_parts_label"),
      shelf_label: makeLabelBlocks("shelf_label"),
    },
    style: {
      background_color: "#1a1d2e",
      border_enabled: true,
      border_color: "#6c63ff",
      border_thickness_px: 1,
      price_format: "LKR 12,500",
      price_style: "Normal",
      text_color: "#ffffff",
      accent_color: "#00d4aa",
    },
    print: {
      print_quality: "Normal",
      orientation: "Portrait",
      margin_mm: 2,
      printer_profile: "Default",
    },
  };
}

function buildDefaultTemplates() {
  return [
    { id: "sales_a4_default", name: "Default", document: "sales_bill", format: "a4", deployed: true, settings: defaultSalesSettings("a4") },
    { id: "sales_a5_formal", name: "Formal A5", document: "sales_bill", format: "a5", deployed: false, settings: defaultSalesSettings("a5") },
    { id: "sales_80_minimal", name: "Minimal Thermal 80mm", document: "sales_bill", format: "80mm", deployed: false, settings: defaultSalesSettings("80mm") },
    { id: "sales_58_compact", name: "Compact 58mm", document: "sales_bill", format: "58mm", deployed: false, settings: defaultSalesSettings("58mm") },

    { id: "job_a4_default", name: "Default", document: "job_card", format: "a4", deployed: true, settings: defaultJobSettings("a4") },
    { id: "job_a5_counter", name: "Counter A5", document: "job_card", format: "a5", deployed: false, settings: defaultJobSettings("a5") },
    { id: "job_thermal_sticker", name: "Thermal Sticker", document: "job_card", format: "thermal", deployed: false, settings: defaultJobSettings("thermal") },

    { id: "label_50_default", name: "Default", document: "labels", format: "50x30", deployed: true, settings: defaultLabelSettings("50x30") },
    { id: "label_40_repair", name: "Repair Sticker", document: "labels", format: "40x25", deployed: false, settings: defaultLabelSettings("40x25") },
    { id: "label_80_bag", name: "Repair Bag", document: "labels", format: "80x50", deployed: false, settings: defaultLabelSettings("80x50") },
    { id: "label_100_shelf", name: "Shelf Edge", document: "labels", format: "100x30", deployed: false, settings: defaultLabelSettings("100x30") },
  ];
}

function buildDefaultCustomizer() {
  const selectedTemplateByContext = {};
  buildDefaultTemplates().forEach((t) => {
    selectedTemplateByContext[`${t.document}:${t.format}`] = t.id;
  });
  return {
    ui: {
      document: "sales_bill",
      format_by_document: { sales_bill: "a4", job_card: "a4", labels: "50x30" },
      section_by_document: { sales_bill: "branding", job_card: "header", labels: "layout" },
      preview_mode: "sample",
      preview_zoom: "fit",
      selected_template_by_context: selectedTemplateByContext,
    },
    templates: buildDefaultTemplates(),
  };
}

function normalizeCustomizer(customizer) {
  const defaults = buildDefaultCustomizer();
  const merged = mergeDefaults(defaults, customizer || {});
  const fallbackTemplates = buildDefaultTemplates();
  if (!Array.isArray(merged.templates) || merged.templates.length === 0) merged.templates = fallbackTemplates;
  if (merged.templates && merged.templates.length && !Array.isArray(merged.ui?.selected_template_by_context)) {
    merged.ui.selected_template_by_context = merged.ui.selected_template_by_context || {};
  }
  return merged;
}

function toneFromDocument(document) {
  if (document === "sales_bill") return "indigo";
  if (document === "job_card") return "sky";
  return "green";
}

function LabeledField({ label, children, hint }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-slate-500">{hint}</span>}
    </label>
  );
}

function BoolField({ label, checked, onChange }) {
  return (
    <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs font-semibold text-slate-200">
      <span>{label}</span>
      <input type="checkbox" checked={!!checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function ColorField({ label, value, onChange }) {
  return (
    <LabeledField label={label}>
      <div className="flex gap-2">
        <input type="color" value={value || "#ffffff"} onChange={(event) => onChange(event.target.value)} className="h-10 w-12 rounded-md border border-white/10 bg-slate-900" />
        <Input value={value || "#ffffff"} onChange={(event) => onChange(event.target.value)} />
      </div>
    </LabeledField>
  );
}

function PreviewSalesBill({ settings, previewMode, storeProfile }) {
  const isEmpty = previewMode === "empty";
  const identity = normalizeStoreProfile(storeProfile || {});
  const items = isEmpty ? [] : SAMPLE_SALES_ITEMS;
  const sub = items.reduce((sum, row) => sum + Number(row.unit_price || 0) * Number(row.qty || 0), 0);
  const discount = items.reduce((sum, row) => sum + Number(row.discount || 0), 0);
  const total = sub - discount;
  const accent = settings?.print?.accent_color || "#0066cc";
  const textColor = settings?.print?.text_color || "#1a1a2e";
  const bg = settings?.print?.background_color || "#ffffff";

  return (
    <div className="rounded-xl border border-dashed border-slate-500/40 p-5" style={{ background: bg, color: textColor, fontFamily: settings?.print?.font_family || "DM Sans", fontSize: `${settings?.print?.base_font_size || 11}px` }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          {settings?.branding?.show_logo && <div className="h-9 w-14 rounded bg-slate-200/60 mb-2 text-[10px] text-slate-700 grid place-items-center">LOGO</div>}
          {settings?.branding?.show_shop_name && <h3 className="font-black text-lg" style={{ color: settings?.branding?.shop_name_color || textColor }}>{settings?.branding?.shop_name_text || identity.shopName}</h3>}
          {settings?.branding?.show_tagline && <p className="text-[11px]" style={{ color: settings?.branding?.tagline_color || "#777" }}>{settings?.branding?.tagline_text || identity.tagline || "-"}</p>}
        </div>
        <div className="text-right text-[11px] space-y-0.5" style={{ color: settings?.business?.color || "#666" }}>
          {settings?.business?.show_address && <p>{identity.address || "Store address not configured"}</p>}
          {settings?.business?.show_phone && <p>{identity.phone || "Phone not configured"}</p>}
          {settings?.business?.show_email && <p>{identity.email || "Email not configured"}</p>}
          {settings?.business?.show_website && <p>{identity.website || "Website not configured"}</p>}
        </div>
      </div>

      {settings?.header?.show_title && <div className="mt-3 text-center font-black" style={{ color: settings?.header?.title_color || accent, fontSize: `${settings?.header?.title_size || 18}px` }}>{settings?.header?.title_text || "INVOICE"}</div>}

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        {settings?.header?.show_invoice_no && <div>Invoice No: INV-2026-00031</div>}
        {settings?.header?.show_date && <div className="text-right">Date: 16/05/2026</div>}
        {settings?.header?.show_cashier && <div>Served By: Asela</div>}
        {settings?.header?.show_time && <div className="text-right">Time: 11:35 AM</div>}
      </div>

      {settings?.bill_to?.show_section && (
        <div className="mt-3 rounded border p-2 text-[11px]" style={{ borderColor: settings?.bill_to?.border_color || "#333355", background: settings?.bill_to?.background_color || "transparent" }}>
          <p className="font-bold">{settings?.bill_to?.section_label || "BILL TO"}</p>
          {settings?.bill_to?.show_customer_name && <p>Kasun Perera</p>}
          {settings?.bill_to?.show_customer_phone && <p>077 123 4567</p>}
          {settings?.bill_to?.show_outstanding && <p>{settings?.bill_to?.outstanding_label || "Outstanding"}: LKR 12,500</p>}
        </div>
      )}

      <div className="mt-3 rounded overflow-hidden border" style={{ borderColor: settings?.items?.border_color || "#2a2d4a" }}>
        <table className="w-full text-[11px]">
          <thead style={{ background: settings?.items?.header_bg || "#252840", color: settings?.items?.header_text || "#ffffff" }}>
            <tr>
              <th className="text-left px-2 py-1.5">Description</th>
              {settings?.items?.show_imei && <th className="text-left px-2 py-1.5">IMEI</th>}
              <th className="text-right px-2 py-1.5">Qty</th>
              <th className="text-right px-2 py-1.5">Unit</th>
              {settings?.items?.show_discount && <th className="text-right px-2 py-1.5">Disc</th>}
              <th className="text-right px-2 py-1.5">Total</th>
            </tr>
          </thead>
          <tbody style={{ color: settings?.items?.row_text || "#e0e0e0" }}>
            {items.length === 0 && (
              <tr style={{ background: settings?.items?.row_even_bg || "#1a1d2e" }}>
                <td className="px-2 py-2" colSpan={settings?.items?.show_imei ? 6 : 5}>No items</td>
              </tr>
            )}
            {items.map((row, idx) => (
              <tr key={`${row.description}-${idx}`} style={{ background: idx % 2 ? settings?.items?.row_odd_bg || "#141628" : settings?.items?.row_even_bg || "#1a1d2e" }}>
                <td className="px-2 py-1.5">
                  <div>{row.description}</div>
                  {settings?.items?.show_warranty && <div className="text-[10px] opacity-70">Warranty: {row.warranty}</div>}
                </td>
                {settings?.items?.show_imei && <td className="px-2 py-1.5">{row.imei}</td>}
                <td className="px-2 py-1.5 text-right">{row.qty}</td>
                <td className="px-2 py-1.5 text-right">{row.unit_price.toLocaleString("en-LK")}</td>
                {settings?.items?.show_discount && <td className="px-2 py-1.5 text-right">{row.discount.toLocaleString("en-LK")}</td>}
                <td className="px-2 py-1.5 text-right">{row.total.toLocaleString("en-LK")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 ml-auto w-[56%] text-[11px] space-y-1">
        {settings?.totals?.show_subtotal && <div className="flex justify-between"><span>Sub Total</span><span>LKR {sub.toLocaleString("en-LK")}</span></div>}
        {settings?.totals?.show_discount && <div className="flex justify-between"><span>Discount</span><span>LKR {discount.toLocaleString("en-LK")}</span></div>}
        {settings?.totals?.show_total && <div className="flex justify-between rounded px-2 py-1 font-black" style={{ background: settings?.totals?.total_bg || "#1a1d2e", color: settings?.totals?.total_color || accent }}><span>TOTAL</span><span>LKR {total.toLocaleString("en-LK")}</span></div>}
      </div>

      {settings?.footer?.show_thank_you && <p className="mt-3 text-center text-[11px]" style={{ color: settings?.footer?.thank_you_color || "#888" }}>{settings?.footer?.thank_you_text || ""}</p>}
    </div>
  );
}

function PreviewJobCard({ settings, previewMode }) {
  const isEmpty = previewMode === "empty";
  const textColor = settings?.print?.text_color || "#1a1a2e";
  const bg = settings?.print?.background_color || "#ffffff";
  const accent = settings?.print?.accent_color || "#6c63ff";
  const info = isEmpty ? {} : SAMPLE_JOB;

  return (
    <div className="rounded-xl border border-dashed border-slate-500/40 p-5" style={{ background: bg, color: textColor, fontFamily: settings?.print?.font_family || "DM Sans" }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-black text-lg">{settings?.header?.title_text || "REPAIR JOB CARD"}</h3>
          {settings?.header?.show_job_id && <p className="mt-1 font-black" style={{ fontSize: `${settings?.header?.job_id_size || 24}px`, color: accent }}>{settings?.header?.job_id_label || "JOB ID"}: {info.job_id || "-"}</p>}
        </div>
        <div className="text-right text-[11px] space-y-1">
          {settings?.header?.show_job_barcode && <div className="rounded bg-slate-200 text-slate-700 px-2 py-1">BARCODE</div>}
          {settings?.header?.show_job_qr && <div className="inline-grid h-14 w-14 place-items-center rounded bg-slate-200 text-slate-700 text-[10px]">QR</div>}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        {settings?.device_customer?.show_customer_name && <div>Customer: {info.customer_name || "-"}</div>}
        {settings?.device_customer?.show_customer_phone && <div>Phone: {info.customer_phone || "-"}</div>}
        {settings?.device_customer?.show_device_brand && <div>Brand: {info.device_brand || "-"}</div>}
        {settings?.device_customer?.show_device_model && <div>Model: {info.device_model || "-"}</div>}
        {settings?.device_customer?.show_imei && <div>IMEI: {info.imei || "-"}</div>}
        {settings?.device_customer?.show_priority && <div>Priority: {info.priority || "-"}</div>}
        {settings?.device_customer?.show_status && <div>Status: {info.status || "-"}</div>}
        {settings?.device_customer?.show_eta && <div>ETA: {info.eta || "-"}</div>}
      </div>

      {settings?.issue?.show_issue_section && (
        <div className="mt-3 rounded border border-slate-400/40 p-2 text-[11px]">
          <p className="font-semibold">{settings?.issue?.issue_label || "REPORTED ISSUE"}:</p>
          <p>{info.issue || "-"}</p>
          {settings?.issue?.show_diagnosis && (
            <>
              <p className="mt-2 font-semibold">{settings?.issue?.diagnosis_label || "DIAGNOSIS"}:</p>
              <p>{info.diagnosis || "-"}</p>
            </>
          )}
        </div>
      )}

      {settings?.financial?.show_final_total && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
          {settings?.financial?.show_estimate && <div className="rounded border border-slate-400/40 p-2">Estimated: LKR {Number(info.estimate || 0).toLocaleString("en-LK")}</div>}
          {settings?.financial?.show_advance && <div className="rounded border border-slate-400/40 p-2">Advance: LKR {Number(info.advance || 0).toLocaleString("en-LK")}</div>}
          {settings?.financial?.show_balance && <div className="rounded border border-slate-400/40 p-2 font-bold">Balance: LKR {Number(info.balance || 0).toLocaleString("en-LK")}</div>}
        </div>
      )}

      {settings?.terms?.show_terms && (
        <div className="mt-3 rounded border border-slate-400/40 p-2 text-[10px] whitespace-pre-line">
          <p className="font-semibold mb-1">TERMS & CONDITIONS</p>
          {settings?.terms?.terms_text || ""}
        </div>
      )}
    </div>
  );
}

function PreviewLabel({ settings, previewMode }) {
  const labelType = settings?.layout?.label_type || "product_label";
  const blocks = settings?.blocks?.[labelType] || {};
  const visibleRows = Object.values(blocks).filter((row) => row?.show);
  const style = settings?.style || {};
  const isEmpty = previewMode === "empty";

  return (
    <div
      className="rounded-xl border border-dashed border-slate-500/40 p-4"
      style={{
        background: style.background_color || "#1a1d2e",
        color: style.text_color || "#ffffff",
        borderColor: style.border_enabled ? style.border_color || "#6c63ff" : "rgba(148,163,184,0.3)",
        borderWidth: `${style.border_enabled ? Number(style.border_thickness_px || 1) : 1}px`,
        borderRadius: `${Number(settings?.layout?.corner_radius_px || 4)}px`,
      }}
    >
      {isEmpty && <p className="text-xs text-slate-300">Blank preview mode</p>}
      {!isEmpty && visibleRows.map((row, idx) => (
        <p key={`${row.label}-${idx}`} style={{ fontSize: `${row.font_size || 9}px`, fontWeight: row.bold ? 700 : 400, color: row.color || style.text_color || "#fff", lineHeight: 1.3 }}>
          {sampleBlockValue(row.label)}
        </p>
      ))}
    </div>
  );
}

function sampleBlockValue(label) {
  const key = String(label || "").toLowerCase();
  if (key.includes("price")) return "LKR 12,500";
  if (key.includes("job id")) return "JOB-20260516-014";
  if (key.includes("barcode")) return "|| ||| ||||";
  if (key.includes("imei")) return "356789012345678";
  if (key.includes("customer")) return "Kasun Perera";
  if (key.includes("phone")) return "0771234567";
  if (key.includes("warranty")) return "Warranty: 12 months";
  if (key.includes("product")) return "iPhone 13 128GB";
  if (key.includes("part")) return "OLED Display";
  return label;
}

export default function InvoiceJobLabelCustomizer({
  sectionValue,
  onSectionChange,
  onSaveSection,
  saving,
  toast,
  confirm,
  prompt,
  storeProfile = {},
}) {
  const previewRef = useRef(null);
  const importInputRef = useRef(null);

  const customizer = useMemo(() => normalizeCustomizer(sectionValue?.customizer), [sectionValue]);
  const documentId = customizer.ui.document;
  const formatId = customizer.ui.format_by_document?.[documentId] || FORMAT_OPTIONS[documentId]?.[0]?.id;
  const contextKey = `${documentId}:${formatId}`;
  const templatesForContext = customizer.templates.filter((t) => t.document === documentId && t.format === formatId);
  const selectedTemplateId = customizer.ui.selected_template_by_context?.[contextKey] || templatesForContext[0]?.id;
  const selectedTemplate = templatesForContext.find((t) => t.id === selectedTemplateId) || templatesForContext[0] || null;
  const selectedSection = customizer.ui.section_by_document?.[documentId] || "branding";

  const sectionTabs = documentId === "sales_bill" ? SALES_SECTIONS : documentId === "job_card" ? JOB_SECTIONS : LABEL_SECTIONS;

  const updateSectionValue = (nextCustomizer) => {
    onSectionChange({
      ...(sectionValue || {}),
      customizer: nextCustomizer,
    });
  };

  const updateUi = (path, value) => {
    const next = clone(customizer);
    setPath(next, `ui.${path}`, value);
    updateSectionValue(next);
  };

  const updateTemplateSettings = (path, value) => {
    if (!selectedTemplate) return;
    const next = clone(customizer);
    const idx = next.templates.findIndex((row) => row.id === selectedTemplate.id);
    if (idx < 0) return;
    setPath(next.templates[idx], `settings.${path}`, value);
    updateSectionValue(next);
  };

  const switchDocument = (docId) => {
    const next = clone(customizer);
    next.ui.document = docId;
    if (!next.ui.format_by_document?.[docId]) next.ui.format_by_document[docId] = FORMAT_OPTIONS[docId][0].id;
    if (!next.ui.section_by_document?.[docId]) next.ui.section_by_document[docId] = (docId === "sales_bill" ? SALES_SECTIONS : docId === "job_card" ? JOB_SECTIONS : LABEL_SECTIONS)[0].id;
    updateSectionValue(next);
  };

  const switchFormat = (nextFormat) => {
    const next = clone(customizer);
    next.ui.format_by_document[documentId] = nextFormat;
    const key = `${documentId}:${nextFormat}`;
    const candidate = next.templates.find((row) => row.document === documentId && row.format === nextFormat);
    if (candidate) next.ui.selected_template_by_context[key] = candidate.id;
    updateSectionValue(next);
  };

  const selectTemplate = (templateId) => {
    const next = clone(customizer);
    next.ui.selected_template_by_context[contextKey] = templateId;
    updateSectionValue(next);
  };

  const createTemplate = async () => {
    const name = await prompt("Template Name", "Name this print template.", {
      defaultValue: `${documentId === "sales_bill" ? "Sales" : documentId === "job_card" ? "Job" : "Label"} Template`,
      placeholder: "Template name",
    });
    if (!name) return;
    const baseSettings =
      selectedTemplate?.settings ||
      (documentId === "sales_bill"
        ? defaultSalesSettings(formatId)
        : documentId === "job_card"
        ? defaultJobSettings(formatId)
        : defaultLabelSettings(formatId));
    const next = clone(customizer);
    const id = `${documentId}_${formatId}_${Date.now()}`;
    next.templates.push({
      id,
      name: name.trim(),
      document: documentId,
      format: formatId,
      deployed: false,
      settings: clone(baseSettings),
    });
    next.ui.selected_template_by_context[contextKey] = id;
    updateSectionValue(next);
    toast("Template created", "success");
  };

  const duplicateTemplate = () => {
    if (!selectedTemplate) return;
    const next = clone(customizer);
    const id = `${selectedTemplate.id}_dup_${Date.now()}`;
    next.templates.push({
      ...clone(selectedTemplate),
      id,
      name: `${selectedTemplate.name} Copy`,
      deployed: false,
    });
    next.ui.selected_template_by_context[contextKey] = id;
    updateSectionValue(next);
    toast("Template duplicated", "success");
  };

  const renameTemplate = async () => {
    if (!selectedTemplate) return;
    const name = await prompt("Rename Template", "Enter the new template name.", {
      defaultValue: selectedTemplate.name || "Template",
      placeholder: "Template name",
    });
    if (!name) return;
    const next = clone(customizer);
    const idx = next.templates.findIndex((row) => row.id === selectedTemplate.id);
    if (idx < 0) return;
    next.templates[idx].name = name.trim();
    updateSectionValue(next);
    toast("Template renamed", "success");
  };

  const deleteTemplate = async () => {
    if (!selectedTemplate) return;
    if (selectedTemplate.deployed) {
      toast("Cannot delete deployed template", "warning");
      return;
    }
    const ok = await confirm("Delete Template", `Delete template "${selectedTemplate.name}"?`);
    if (!ok) return;
    const next = clone(customizer);
    next.templates = next.templates.filter((row) => row.id !== selectedTemplate.id);
    const fallback = next.templates.find((row) => row.document === documentId && row.format === formatId);
    if (fallback) next.ui.selected_template_by_context[contextKey] = fallback.id;
    updateSectionValue(next);
    toast("Template deleted", "success");
  };

  const resetTemplate = async () => {
    if (!selectedTemplate) return;
    const ok = await confirm("Reset Template", "Reset selected template layout to default values?");
    if (!ok) return;
    const next = clone(customizer);
    const idx = next.templates.findIndex((row) => row.id === selectedTemplate.id);
    if (idx < 0) return;
    next.templates[idx].settings =
      documentId === "sales_bill"
        ? defaultSalesSettings(formatId)
        : documentId === "job_card"
        ? defaultJobSettings(formatId)
        : defaultLabelSettings(formatId);
    updateSectionValue(next);
    toast("Template reset to default", "success");
  };

  const deployTemplate = async () => {
    if (!selectedTemplate) return;
    const ok = await confirm("Deploy Template", `Deploy "${selectedTemplate.name}" for ${documentId.replace("_", " ")} (${formatId})?`);
    if (!ok) return;
    const next = clone(customizer);
    next.templates.forEach((row) => {
      if (row.document === documentId && row.format === formatId) row.deployed = row.id === selectedTemplate.id;
    });
    updateSectionValue(next);
    toast("Template deployed", "success");
  };

  const exportTemplate = () => {
    if (!selectedTemplate) return;
    const payload = {
      exported_at: new Date().toISOString(),
      template: selectedTemplate,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedTemplate.name.replace(/\s+/g, "_").toLowerCase()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Template exported", "success");
  };

  const importTemplate = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const incoming = parsed?.template || parsed;
      if (!incoming || typeof incoming !== "object") throw new Error("Invalid template file");
      const next = clone(customizer);
      const id = `${documentId}_${formatId}_imp_${Date.now()}`;
      next.templates.push({
        id,
        name: incoming.name || "Imported Template",
        document: incoming.document || documentId,
        format: incoming.format || formatId,
        deployed: false,
        settings: incoming.settings || incoming,
      });
      next.ui.selected_template_by_context[`${documentId}:${formatId}`] = id;
      updateSectionValue(next);
      toast("Template imported", "success");
    } catch {
      toast("Failed to import template JSON", "error");
    }
  };

  const printTest = async () => {
    if (!previewRef.current) {
      toast("Preview unavailable", "warning");
      return;
    }
    const html = `
      <html>
        <head>
          <title>Print Test</title>
          <style>
            body{font-family:Arial,sans-serif;background:#0b1020;padding:16px}
            .sheet{max-width:980px;margin:0 auto;background:#fff;padding:16px;border-radius:12px}
          </style>
        </head>
        <body>
          <div class="sheet">${previewRef.current.innerHTML}</div>
          <script>setTimeout(() => window.print(), 120);</script>
        </body>
      </html>
    `;
    try {
      await printHtmlDocument(html, { silent: false });
    } catch (error) {
      toast(error.message || "Failed to open print preview", "error");
    }
  };

  
  const exportToPdf = () => {
    if (!previewRef.current) return;
    const element = previewRef.current;
    
    // get dimensions based on paper size
    const isThermal = settings?.print?.paper_size === "Thermal 80mm";
    const width = isThermal ? 80 : 210;
    
    const opt = {
      margin: 0,
      filename: `Template_${documentId}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: isThermal ? [80, 200] : 'a4', orientation: 'portrait' }
    };
    
    html2pdf().from(element).set(opt).save();
  };

  const handleBackendPreview = async () => {
    // Determine the correct document type and paper size based on current format
    const isA4 = !["80mm", "58mm"].includes(formatId);
    const docType = documentId === "sales_bill" ? (isA4 ? "invoice" : "sales_receipt") : null;
    if (!docType) {
      toast("Backend preview is only available for Sales Bill templates", "warning");
      return;
    }
    const paper = isA4 ? "a4" : "thermal_80";
    try {
      const { data } = await api.get("/print-center/render", {
        params: { document_type: docType, paper },
        responseType: "text",
        transformResponse: [(d) => d],
      });
      const win = window.open("", "_blank");
      if (win) {
        win.document.open();
        win.document.write(String(data || ""));
        win.document.close();
      } else {
        toast("Pop-up blocked. Allow pop-ups to use backend preview.", "warning");
      }
    } catch (err) {
      toast(err?.response?.data?.detail || err?.message || "Backend preview failed", "error");
    }
  };

  const settings = selectedTemplate?.settings || {};

  const renderSalesEditor = () => {
    if (selectedSection === "branding") {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BoolField label="Show logo on receipt" checked={settings?.branding?.show_logo} onChange={(v) => updateTemplateSettings("branding.show_logo", v)} />
          <Select value={settings?.branding?.logo_position || "Left"} onChange={(e) => updateTemplateSettings("branding.logo_position", e.target.value)}>
            <option>Left</option>
            <option>Center</option>
            <option>Right</option>
          </Select>
          <LabeledField label="Shop name text">
            <Input value={settings?.branding?.shop_name_text || ""} onChange={(e) => updateTemplateSettings("branding.shop_name_text", e.target.value)} />
          </LabeledField>
          <LabeledField label="Shop name font">
            <Select value={settings?.branding?.shop_name_font || "Montserrat"} onChange={(e) => updateTemplateSettings("branding.shop_name_font", e.target.value)}>
              {FONT_OPTIONS.map((font) => <option key={font}>{font}</option>)}
            </Select>
          </LabeledField>
          <LabeledField label="Shop name font size">
            <Input type="number" value={Number(settings?.branding?.shop_name_size || 24)} onChange={(e) => updateTemplateSettings("branding.shop_name_size", Number(e.target.value || 0))} />
          </LabeledField>
          <ColorField label="Shop name color" value={settings?.branding?.shop_name_color || "#ffffff"} onChange={(v) => updateTemplateSettings("branding.shop_name_color", v)} />
          <BoolField label="Show tagline" checked={settings?.branding?.show_tagline} onChange={(v) => updateTemplateSettings("branding.show_tagline", v)} />
          <LabeledField label="Tagline text">
            <Input value={settings?.branding?.tagline_text || ""} onChange={(e) => updateTemplateSettings("branding.tagline_text", e.target.value)} />
          </LabeledField>
        </div>
      );
    }
    if (selectedSection === "business") {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BoolField label="Show address" checked={settings?.business?.show_address} onChange={(v) => updateTemplateSettings("business.show_address", v)} />
          <BoolField label="Show phone" checked={settings?.business?.show_phone} onChange={(v) => updateTemplateSettings("business.show_phone", v)} />
          <BoolField label="Show email" checked={settings?.business?.show_email} onChange={(v) => updateTemplateSettings("business.show_email", v)} />
          <BoolField label="Show website" checked={settings?.business?.show_website} onChange={(v) => updateTemplateSettings("business.show_website", v)} />
          <LabeledField label="Layout">
            <Select value={settings?.business?.layout || "Stacked"} onChange={(e) => updateTemplateSettings("business.layout", e.target.value)}>
              <option>Stacked</option>
              <option>Inline</option>
            </Select>
          </LabeledField>
          <ColorField label="Business text color" value={settings?.business?.color || "#cccccc"} onChange={(v) => updateTemplateSettings("business.color", v)} />
        </div>
      );
    }
    if (selectedSection === "header") {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <LabeledField label="Document title"><Input value={settings?.header?.title_text || ""} onChange={(e) => updateTemplateSettings("header.title_text", e.target.value)} /></LabeledField>
          <LabeledField label="Title alignment">
            <Select value={settings?.header?.title_align || "Center"} onChange={(e) => updateTemplateSettings("header.title_align", e.target.value)}>
              <option>Left</option><option>Center</option><option>Right</option>
            </Select>
          </LabeledField>
          <BoolField label="Show invoice number" checked={settings?.header?.show_invoice_no} onChange={(v) => updateTemplateSettings("header.show_invoice_no", v)} />
          <BoolField label="Show date" checked={settings?.header?.show_date} onChange={(v) => updateTemplateSettings("header.show_date", v)} />
          <BoolField label="Show time" checked={settings?.header?.show_time} onChange={(v) => updateTemplateSettings("header.show_time", v)} />
          <BoolField label="Show cashier name" checked={settings?.header?.show_cashier} onChange={(v) => updateTemplateSettings("header.show_cashier", v)} />
          <BoolField label="Show QR code" checked={settings?.header?.show_qr} onChange={(v) => updateTemplateSettings("header.show_qr", v)} />
          <LabeledField label="QR content">
            <Select value={settings?.header?.qr_content || "Invoice verification URL"} onChange={(e) => updateTemplateSettings("header.qr_content", e.target.value)}>
              <option>Invoice verification URL</option>
              <option>Shop WhatsApp link</option>
              <option>Shop website URL</option>
              <option>Encoded invoice data</option>
              <option>Custom URL/text</option>
            </Select>
          </LabeledField>
        </div>
      );
    }
    if (selectedSection === "bill_to") {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BoolField label='Show "BILL TO" section' checked={settings?.bill_to?.show_section} onChange={(v) => updateTemplateSettings("bill_to.show_section", v)} />
          <LabeledField label="Section label"><Input value={settings?.bill_to?.section_label || ""} onChange={(e) => updateTemplateSettings("bill_to.section_label", e.target.value)} /></LabeledField>
          <BoolField label="Show customer name" checked={settings?.bill_to?.show_customer_name} onChange={(v) => updateTemplateSettings("bill_to.show_customer_name", v)} />
          <BoolField label="Show customer phone" checked={settings?.bill_to?.show_customer_phone} onChange={(v) => updateTemplateSettings("bill_to.show_customer_phone", v)} />
          <BoolField label="Show outstanding balance" checked={settings?.bill_to?.show_outstanding} onChange={(v) => updateTemplateSettings("bill_to.show_outstanding", v)} />
          <ColorField label="Border color" value={settings?.bill_to?.border_color || "#333355"} onChange={(v) => updateTemplateSettings("bill_to.border_color", v)} />
          <ColorField label="Background color" value={settings?.bill_to?.background_color || "#1a1d2e"} onChange={(v) => updateTemplateSettings("bill_to.background_color", v)} />
        </div>
      );
    }
    if (selectedSection === "items") {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BoolField label="Show IMEI column" checked={settings?.items?.show_imei} onChange={(v) => updateTemplateSettings("items.show_imei", v)} />
          <BoolField label="Show discount column" checked={settings?.items?.show_discount} onChange={(v) => updateTemplateSettings("items.show_discount", v)} />
          <BoolField label="Show warranty inline" checked={settings?.items?.show_warranty} onChange={(v) => updateTemplateSettings("items.show_warranty", v)} />
          <LabeledField label="Row height (px)"><Input type="number" value={Number(settings?.items?.row_height || 32)} onChange={(e) => updateTemplateSettings("items.row_height", Number(e.target.value || 0))} /></LabeledField>
          <ColorField label="Header background" value={settings?.items?.header_bg || "#252840"} onChange={(v) => updateTemplateSettings("items.header_bg", v)} />
          <ColorField label="Header text color" value={settings?.items?.header_text || "#ffffff"} onChange={(v) => updateTemplateSettings("items.header_text", v)} />
          <ColorField label="Row even background" value={settings?.items?.row_even_bg || "#1a1d2e"} onChange={(v) => updateTemplateSettings("items.row_even_bg", v)} />
          <ColorField label="Row odd background" value={settings?.items?.row_odd_bg || "#141628"} onChange={(v) => updateTemplateSettings("items.row_odd_bg", v)} />
        </div>
      );
    }
    if (selectedSection === "totals") {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BoolField label="Show subtotal" checked={settings?.totals?.show_subtotal} onChange={(v) => updateTemplateSettings("totals.show_subtotal", v)} />
          <BoolField label="Show discount" checked={settings?.totals?.show_discount} onChange={(v) => updateTemplateSettings("totals.show_discount", v)} />
          <BoolField label="Show tax line" checked={settings?.totals?.show_tax} onChange={(v) => updateTemplateSettings("totals.show_tax", v)} />
          <BoolField label="Show total in words" checked={settings?.totals?.show_total_words} onChange={(v) => updateTemplateSettings("totals.show_total_words", v)} />
          <LabeledField label="Totals block width (%)"><Input type="number" value={Number(settings?.totals?.width_percent || 50)} onChange={(e) => updateTemplateSettings("totals.width_percent", Number(e.target.value || 0))} /></LabeledField>
          <ColorField label="Total row color" value={settings?.totals?.total_color || "#6c63ff"} onChange={(v) => updateTemplateSettings("totals.total_color", v)} />
        </div>
      );
    }
    if (selectedSection === "payment") {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BoolField label="Show payment section" checked={settings?.payment?.show_section} onChange={(v) => updateTemplateSettings("payment.show_section", v)} />
          <BoolField label="Show payment method" checked={settings?.payment?.show_method} onChange={(v) => updateTemplateSettings("payment.show_method", v)} />
          <BoolField label="Show amount tendered" checked={settings?.payment?.show_tendered} onChange={(v) => updateTemplateSettings("payment.show_tendered", v)} />
          <BoolField label="Show change given" checked={settings?.payment?.show_change} onChange={(v) => updateTemplateSettings("payment.show_change", v)} />
          <BoolField label="Show partial payment history" checked={settings?.payment?.show_partial_history} onChange={(v) => updateTemplateSettings("payment.show_partial_history", v)} />
        </div>
      );
    }
    if (selectedSection === "footer") {
      return (
        <div className="grid grid-cols-1 gap-3">
          <BoolField label="Show thank you message" checked={settings?.footer?.show_thank_you} onChange={(v) => updateTemplateSettings("footer.show_thank_you", v)} />
          <LabeledField label="Thank you text"><Input value={settings?.footer?.thank_you_text || ""} onChange={(e) => updateTemplateSettings("footer.thank_you_text", e.target.value)} /></LabeledField>
          <BoolField label="Show return policy" checked={settings?.footer?.show_return_policy} onChange={(v) => updateTemplateSettings("footer.show_return_policy", v)} />
          <LabeledField label="Return policy"><textarea className="field min-h-[90px]" value={settings?.footer?.return_policy_text || ""} onChange={(e) => updateTemplateSettings("footer.return_policy_text", e.target.value)} /></LabeledField>
          <LabeledField label="Custom footer line 1"><Input value={settings?.footer?.custom_line_1 || ""} onChange={(e) => updateTemplateSettings("footer.custom_line_1", e.target.value)} /></LabeledField>
          <LabeledField label="Custom footer line 2"><Input value={settings?.footer?.custom_line_2 || ""} onChange={(e) => updateTemplateSettings("footer.custom_line_2", e.target.value)} /></LabeledField>
        </div>
      );
    }
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <LabeledField label="Paper size">
          <Select value={settings?.print?.paper_size || "A4"} onChange={(e) => updateTemplateSettings("print.paper_size", e.target.value)}>
            <option>A4</option><option>A5</option><option>80mm</option><option>58mm</option>
          </Select>
        </LabeledField>
        <LabeledField label="Orientation">
          <Select value={settings?.print?.orientation || "Portrait"} onChange={(e) => updateTemplateSettings("print.orientation", e.target.value)}>
            <option>Portrait</option><option>Landscape</option>
          </Select>
        </LabeledField>
        <LabeledField label="Global font family">
          <Select value={settings?.print?.font_family || "DM Sans"} onChange={(e) => updateTemplateSettings("print.font_family", e.target.value)}>
            {FONT_OPTIONS.map((font) => <option key={font}>{font}</option>)}
          </Select>
        </LabeledField>
        <ColorField label="Primary accent color" value={settings?.print?.accent_color || "#0066cc"} onChange={(v) => updateTemplateSettings("print.accent_color", v)} />
        <ColorField label="Background color" value={settings?.print?.background_color || "#ffffff"} onChange={(v) => updateTemplateSettings("print.background_color", v)} />
        <ColorField label="Text color" value={settings?.print?.text_color || "#1a1a2e"} onChange={(v) => updateTemplateSettings("print.text_color", v)} />
      </div>
    );
  };

  const renderJobEditor = () => {
    if (selectedSection === "header") {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <LabeledField label="Document title"><Input value={settings?.header?.title_text || ""} onChange={(e) => updateTemplateSettings("header.title_text", e.target.value)} /></LabeledField>
          <BoolField label="Show job ID (large)" checked={settings?.header?.show_job_id} onChange={(v) => updateTemplateSettings("header.show_job_id", v)} />
          <LabeledField label="Job ID font size"><Input type="number" value={Number(settings?.header?.job_id_size || 24)} onChange={(e) => updateTemplateSettings("header.job_id_size", Number(e.target.value || 0))} /></LabeledField>
          <BoolField label="Show job ID barcode" checked={settings?.header?.show_job_barcode} onChange={(v) => updateTemplateSettings("header.show_job_barcode", v)} />
          <BoolField label="Show job ID QR code" checked={settings?.header?.show_job_qr} onChange={(v) => updateTemplateSettings("header.show_job_qr", v)} />
          <LabeledField label="QR links to">
            <Select value={settings?.header?.qr_target || "Job detail page"} onChange={(e) => updateTemplateSettings("header.qr_target", e.target.value)}>
              <option>Job detail page</option>
              <option>Encoded job data</option>
              <option>WhatsApp status check</option>
            </Select>
          </LabeledField>
        </div>
      );
    }
    if (selectedSection === "device_customer") {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <LabeledField label="Layout">
            <Select value={settings?.device_customer?.layout || "2 columns"} onChange={(e) => updateTemplateSettings("device_customer.layout", e.target.value)}>
              <option>2 columns</option><option>Stacked</option><option>Table</option>
            </Select>
          </LabeledField>
          <BoolField label="Show customer name" checked={settings?.device_customer?.show_customer_name} onChange={(v) => updateTemplateSettings("device_customer.show_customer_name", v)} />
          <BoolField label="Show customer phone" checked={settings?.device_customer?.show_customer_phone} onChange={(v) => updateTemplateSettings("device_customer.show_customer_phone", v)} />
          <BoolField label="Show device brand" checked={settings?.device_customer?.show_device_brand} onChange={(v) => updateTemplateSettings("device_customer.show_device_brand", v)} />
          <BoolField label="Show device model" checked={settings?.device_customer?.show_device_model} onChange={(v) => updateTemplateSettings("device_customer.show_device_model", v)} />
          <BoolField label="Show IMEI / serial" checked={settings?.device_customer?.show_imei} onChange={(v) => updateTemplateSettings("device_customer.show_imei", v)} />
          <BoolField label="Show assigned technician" checked={settings?.device_customer?.show_technician} onChange={(v) => updateTemplateSettings("device_customer.show_technician", v)} />
          <BoolField label="Show priority level" checked={settings?.device_customer?.show_priority} onChange={(v) => updateTemplateSettings("device_customer.show_priority", v)} />
          <BoolField label="Show status" checked={settings?.device_customer?.show_status} onChange={(v) => updateTemplateSettings("device_customer.show_status", v)} />
        </div>
      );
    }
    if (selectedSection === "issue") {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BoolField label="Show issue section" checked={settings?.issue?.show_issue_section} onChange={(v) => updateTemplateSettings("issue.show_issue_section", v)} />
          <LabeledField label="Issue section label"><Input value={settings?.issue?.issue_label || ""} onChange={(e) => updateTemplateSettings("issue.issue_label", e.target.value)} /></LabeledField>
          <LabeledField label="Issue lines"><Input type="number" value={Number(settings?.issue?.issue_lines || 3)} onChange={(e) => updateTemplateSettings("issue.issue_lines", Number(e.target.value || 0))} /></LabeledField>
          <BoolField label="Show technician diagnosis" checked={settings?.issue?.show_diagnosis} onChange={(v) => updateTemplateSettings("issue.show_diagnosis", v)} />
          <BoolField label="Show customer complaint" checked={settings?.issue?.show_complaint} onChange={(v) => updateTemplateSettings("issue.show_complaint", v)} />
        </div>
      );
    }
    if (selectedSection === "accessories") {
      return (
        <div className="space-y-3">
          <BoolField label="Show accessories section" checked={settings?.accessories?.show_section} onChange={(v) => updateTemplateSettings("accessories.show_section", v)} />
          <LabeledField label="Layout">
            <Select value={settings?.accessories?.layout || "Checkbox grid"} onChange={(e) => updateTemplateSettings("accessories.layout", e.target.value)}>
              <option>Checkbox grid</option><option>List</option>
            </Select>
          </LabeledField>
          <LabeledField label="Checklist items (one per line)">
            <textarea
              className="field min-h-[120px]"
              value={(settings?.accessories?.items || []).join("\n")}
              onChange={(e) => updateTemplateSettings("accessories.items", e.target.value.split("\n").map((row) => row.trim()).filter(Boolean))}
            />
          </LabeledField>
        </div>
      );
    }
    if (selectedSection === "financial") {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BoolField label="Show quotation / estimate" checked={settings?.financial?.show_estimate} onChange={(v) => updateTemplateSettings("financial.show_estimate", v)} />
          <BoolField label="Show advance paid" checked={settings?.financial?.show_advance} onChange={(v) => updateTemplateSettings("financial.show_advance", v)} />
          <BoolField label="Show balance due" checked={settings?.financial?.show_balance} onChange={(v) => updateTemplateSettings("financial.show_balance", v)} />
          <BoolField label="Show final total" checked={settings?.financial?.show_final_total} onChange={(v) => updateTemplateSettings("financial.show_final_total", v)} />
          <BoolField label="Show payment method" checked={settings?.financial?.show_payment_method} onChange={(v) => updateTemplateSettings("financial.show_payment_method", v)} />
          <BoolField label="Show payment history" checked={settings?.financial?.show_payment_history} onChange={(v) => updateTemplateSettings("financial.show_payment_history", v)} />
        </div>
      );
    }
    if (selectedSection === "photos") {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BoolField label="Show device photos section" checked={settings?.photos?.show_section} onChange={(v) => updateTemplateSettings("photos.show_section", v)} />
          <LabeledField label="Photo placeholder boxes">
            <Select value={String(settings?.photos?.boxes || 2)} onChange={(e) => updateTemplateSettings("photos.boxes", Number(e.target.value || 2))}>
              <option value="2">2</option><option value="4">4</option><option value="6">6</option>
            </Select>
          </LabeledField>
          <LabeledField label="Box size">
            <Select value={settings?.photos?.box_size || "Medium"} onChange={(e) => updateTemplateSettings("photos.box_size", e.target.value)}>
              <option>Small</option><option>Medium</option><option>Large</option>
            </Select>
          </LabeledField>
          <BoolField label='Show "Before / After" labels' checked={settings?.photos?.show_before_after} onChange={(v) => updateTemplateSettings("photos.show_before_after", v)} />
        </div>
      );
    }
    if (selectedSection === "terms") {
      return (
        <div className="space-y-3">
          <BoolField label="Show terms section" checked={settings?.terms?.show_terms} onChange={(v) => updateTemplateSettings("terms.show_terms", v)} />
          <LabeledField label="Terms font size"><Input type="number" value={Number(settings?.terms?.terms_font_size || 9)} onChange={(e) => updateTemplateSettings("terms.terms_font_size", Number(e.target.value || 0))} /></LabeledField>
          <LabeledField label="Terms text">
            <textarea className="field min-h-[140px]" value={settings?.terms?.terms_text || ""} onChange={(e) => updateTemplateSettings("terms.terms_text", e.target.value)} />
          </LabeledField>
          <BoolField label="Show customer signature line" checked={settings?.terms?.show_customer_sign} onChange={(v) => updateTemplateSettings("terms.show_customer_sign", v)} />
          <BoolField label="Show technician signature line" checked={settings?.terms?.show_technician_sign} onChange={(v) => updateTemplateSettings("terms.show_technician_sign", v)} />
        </div>
      );
    }
    if (selectedSection === "footer") {
      return (
        <div className="space-y-3">
          <BoolField label="Show footer message" checked={settings?.footer?.show_footer_message} onChange={(v) => updateTemplateSettings("footer.show_footer_message", v)} />
          <LabeledField label="Footer text"><Input value={settings?.footer?.footer_text || ""} onChange={(e) => updateTemplateSettings("footer.footer_text", e.target.value)} /></LabeledField>
          <BoolField label="Show tear-off strip" checked={settings?.footer?.show_tear_off} onChange={(v) => updateTemplateSettings("footer.show_tear_off", v)} />
          <LabeledField label="Tear-off label"><Input value={settings?.footer?.tear_off_label || ""} onChange={(e) => updateTemplateSettings("footer.tear_off_label", e.target.value)} /></LabeledField>
        </div>
      );
    }
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <LabeledField label="Paper size">
          <Select value={settings?.print?.paper_size || "A4"} onChange={(e) => updateTemplateSettings("print.paper_size", e.target.value)}>
            <option>A4</option><option>A5</option><option>Thermal</option>
          </Select>
        </LabeledField>
        <LabeledField label="Orientation">
          <Select value={settings?.print?.orientation || "Portrait"} onChange={(e) => updateTemplateSettings("print.orientation", e.target.value)}>
            <option>Portrait</option><option>Landscape</option>
          </Select>
        </LabeledField>
        <ColorField label="Accent color" value={settings?.print?.accent_color || "#6c63ff"} onChange={(v) => updateTemplateSettings("print.accent_color", v)} />
      </div>
    );
  };

  const renderLabelEditor = () => {
    const labelType = settings?.layout?.label_type || "product_label";
    const labelBlocks = settings?.blocks?.[labelType] || {};

    if (selectedSection === "layout") {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <LabeledField label="Label type">
            <Select value={labelType} onChange={(e) => updateTemplateSettings("layout.label_type", e.target.value)}>
              {LABEL_TYPE_OPTIONS.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
            </Select>
          </LabeledField>
          <LabeledField label="Size preset">
            <Select value={settings?.layout?.size_preset || "50x30"} onChange={(e) => updateTemplateSettings("layout.size_preset", e.target.value)}>
              {FORMAT_OPTIONS.labels.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
            </Select>
          </LabeledField>
          <LabeledField label="Custom width (mm)">
            <Input type="number" value={Number(settings?.layout?.custom_width_mm || 50)} onChange={(e) => updateTemplateSettings("layout.custom_width_mm", Number(e.target.value || 0))} />
          </LabeledField>
          <LabeledField label="Custom height (mm)">
            <Input type="number" value={Number(settings?.layout?.custom_height_mm || 30)} onChange={(e) => updateTemplateSettings("layout.custom_height_mm", Number(e.target.value || 0))} />
          </LabeledField>
        </div>
      );
    }

    if (selectedSection === "content") {
      const rows = Object.entries(labelBlocks);
      return (
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/25">
          <Table className="text-xs">
            <thead>
              <tr>
                <th>Block</th>
                <th>Show</th>
                <th>Font Size</th>
                <th>Bold</th>
                <th>Color</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([id, row]) => (
                <tr key={id}>
                  <td>{row.label || id}</td>
                  <td>
                    <input type="checkbox" checked={!!row.show} onChange={(e) => updateTemplateSettings(`blocks.${labelType}.${id}.show`, e.target.checked)} />
                  </td>
                  <td>
                    <Input type="number" value={Number(row.font_size || 8)} onChange={(e) => updateTemplateSettings(`blocks.${labelType}.${id}.font_size`, Number(e.target.value || 0))} />
                  </td>
                  <td>
                    <input type="checkbox" checked={!!row.bold} onChange={(e) => updateTemplateSettings(`blocks.${labelType}.${id}.bold`, e.target.checked)} />
                  </td>
                  <td>
                    <input type="color" value={row.color || "#ffffff"} onChange={(e) => updateTemplateSettings(`blocks.${labelType}.${id}.color`, e.target.value)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      );
    }

    if (selectedSection === "style") {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ColorField label="Background color" value={settings?.style?.background_color || "#1a1d2e"} onChange={(v) => updateTemplateSettings("style.background_color", v)} />
          <BoolField label="Border enabled" checked={settings?.style?.border_enabled} onChange={(v) => updateTemplateSettings("style.border_enabled", v)} />
          <ColorField label="Border color" value={settings?.style?.border_color || "#6c63ff"} onChange={(v) => updateTemplateSettings("style.border_color", v)} />
          <LabeledField label="Border thickness (px)"><Input type="number" value={Number(settings?.style?.border_thickness_px || 1)} onChange={(e) => updateTemplateSettings("style.border_thickness_px", Number(e.target.value || 0))} /></LabeledField>
          <LabeledField label="Price display format">
            <Select value={settings?.style?.price_format || "LKR 12,500"} onChange={(e) => updateTemplateSettings("style.price_format", e.target.value)}>
              <option>LKR 12,500</option>
              <option>Rs. 12,500</option>
              <option>12,500/=</option>
            </Select>
          </LabeledField>
          <LabeledField label="Price font style">
            <Select value={settings?.style?.price_style || "Normal"} onChange={(e) => updateTemplateSettings("style.price_style", e.target.value)}>
              <option>Normal</option><option>Outlined</option><option>Highlighted box</option>
            </Select>
          </LabeledField>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <LabeledField label="Print quality">
          <Select value={settings?.print?.print_quality || "Normal"} onChange={(e) => updateTemplateSettings("print.print_quality", e.target.value)}>
            <option>Draft</option><option>Normal</option><option>High</option>
          </Select>
        </LabeledField>
        <LabeledField label="Orientation">
          <Select value={settings?.print?.orientation || "Portrait"} onChange={(e) => updateTemplateSettings("print.orientation", e.target.value)}>
            <option>Portrait</option><option>Landscape</option>
          </Select>
        </LabeledField>
        <LabeledField label="Margin (mm)">
          <Input type="number" value={Number(settings?.print?.margin_mm || 2)} onChange={(e) => updateTemplateSettings("print.margin_mm", Number(e.target.value || 0))} />
        </LabeledField>
      </div>
    );
  };

  const previewZoom = customizer.ui.preview_zoom || "fit";
  const scale = previewZoom === "fit" ? 1 : Number(previewZoom || 100) / 100;

  return (
    <div className="space-y-4">
      <SectionCard
        title="Invoice, Job Card & Label Customizer"
        subtitle="Document selector, template manager, full editor, live preview, and deployment workflow."
        right={
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={resetTemplate}><RotateCcw size={13} /> Reset</Button>
            <Button size="sm" onClick={onSaveSection} disabled={saving}><Save size={13} /> {saving ? "Saving..." : "Save"}</Button>
            <Button size="sm" variant="secondary" onClick={deployTemplate}><Rocket size={13} /> Deploy</Button>
            <Button size="sm" variant="secondary" onClick={printTest}><Printer size={13} /> Print Test</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {DOC_OPTIONS.map((doc) => {
              const Icon = doc.icon;
              return (
                <button
                  key={doc.id}
                  onClick={() => switchDocument(doc.id)}
                  className={`px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wide border transition flex items-center gap-2 ${
                    documentId === doc.id ? "bg-indigo-500/20 border-indigo-400/50 text-indigo-100" : "bg-white/5 border-white/10 text-slate-400 hover:text-white"
                  }`}
                >
                  <Icon size={14} /> {doc.label}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 h-[calc(100vh-200px)]">
            <div className="xl:col-span-1 space-y-4 overflow-y-auto custom-scrollbar pr-2">
              <SectionCard title="Template Manager">
                <div className="space-y-3">
                  <LabeledField label="Format">
                    <Select value={formatId} onChange={(e) => switchFormat(e.target.value)}>
                      {(FORMAT_OPTIONS[documentId] || []).map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                    </Select>
                  </LabeledField>
                  <LabeledField label="Active template">
                    <Select value={selectedTemplate?.id || ""} onChange={(e) => selectTemplate(e.target.value)}>
                      {templatesForContext.map((row) => <option key={row.id} value={row.id}>{row.name}{row.deployed ? " (Deployed)" : ""}</option>)}
                    </Select>
                  </LabeledField>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={createTemplate}><Plus size={13} /> New</Button>
                    <Button size="sm" variant="secondary" onClick={duplicateTemplate}><Copy size={13} /> Duplicate</Button>
                    <Button size="sm" variant="secondary" onClick={renameTemplate}>Rename</Button>
                    <Button size="sm" variant="secondary" onClick={deleteTemplate}><Trash2 size={13} /> Delete</Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={exportTemplate}><Download size={13} /> Export</Button>
                    <Button size="sm" variant="secondary" onClick={() => importInputRef.current?.click()}><Upload size={13} /> Import</Button>
                    <input
                      ref={importInputRef}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={(e) => importTemplate(e.target.files?.[0])}
                    />
                  </div>
                  <div className="text-xs text-slate-400">
                    {selectedTemplate?.deployed ? <Badge tone="green">Deployed</Badge> : <Badge tone={toneFromDocument(documentId)}>Draft</Badge>}
                          </div>
                        </TransformComponent>
                      </React.Fragment>
                    )}
                  </TransformWrapper>
                </div>
              </SectionCard>

              <SectionCard title="Editor Sections">
                <div className="grid grid-cols-2 gap-2">
                  {sectionTabs.map((section) => (
                    <button
                      key={section.id}
                      onClick={() => updateUi(`section_by_document.${documentId}`, section.id)}
                      className={`px-2 py-2 rounded-lg text-xs font-semibold border transition ${
                        selectedSection === section.id ? "bg-indigo-500/20 border-indigo-400/50 text-indigo-100" : "bg-white/5 border-white/10 text-slate-400 hover:text-white"
                      }`}
                    >
                      {section.label}
                    </button>
                  ))}
                </div>
              </SectionCard>

              <SectionCard title={`${documentId === "sales_bill" ? "Sales Bill" : documentId === "job_card" ? "Job Card" : "Labels"} Editor`}>
                {documentId === "sales_bill" && renderSalesEditor()}
                {documentId === "job_card" && renderJobEditor()}
                {documentId === "labels" && renderLabelEditor()}
              </SectionCard>
            </div>

            <div className="xl:col-span-2 space-y-4 overflow-y-auto custom-scrollbar pr-2">
              <SectionCard
                title="Live Preview"
                subtitle="WYSIWYG preview updates instantly with your settings."
                right={<Badge tone={selectedTemplate?.deployed ? "green" : "amber"}>{selectedTemplate?.name || "No template"}</Badge>}
              >
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <LabeledField label="Document">
                    <Select value={documentId} onChange={(e) => switchDocument(e.target.value)}>
                      {DOC_OPTIONS.map((doc) => <option key={doc.id} value={doc.id}>{doc.label}</option>)}
                    </Select>
                  </LabeledField>
                  <LabeledField label="Format">
                    <Select value={formatId} onChange={(e) => switchFormat(e.target.value)}>
                      {(FORMAT_OPTIONS[documentId] || []).map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                    </Select>
                  </LabeledField>
                  <LabeledField label="Preview mode">
                    <Select value={customizer.ui.preview_mode || "sample"} onChange={(e) => updateUi("preview_mode", e.target.value)}>
                      {PREVIEW_MODE_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt === "sample" ? "With Sample Data" : opt === "last" ? "With Last Invoice" : "Empty (blank)"}
                        </option>
                      ))}
                    </Select>
                  </LabeledField>
                  <LabeledField label="Zoom">
                    <Select value={previewZoom} onChange={(e) => updateUi("preview_zoom", e.target.value)}>
                      {PREVIEW_ZOOM_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt === "fit" ? "Fit to panel" : `${opt}%`}</option>)}
                    </Select>
                  </LabeledField>


                  <Button size="sm" variant="secondary" onClick={printTest}><Eye size={13} /> Print Test</Button>
                  <Button size="sm" variant="secondary" onClick={handleBackendPreview}><Monitor size={13} /> Backend Preview</Button>
                  <Button size="sm" variant="secondary" onClick={exportToPdf}><Download size={13} /> Export PDF</Button>
                </div>


                <div className="rounded-2xl border border-white/10 bg-black/20 overflow-hidden h-[700px] flex justify-center items-center relative">
                  <TransformWrapper initialScale={0.8} minScale={0.5} maxScale={4} centerOnInit>
                    {({ zoomIn, zoomOut, resetTransform }) => (
                      <React.Fragment>
                        <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 bg-slate-900/80 p-2 rounded-lg shadow-lg border border-white/10 backdrop-blur-sm">
                           <button onClick={() => zoomIn()} className="w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded text-white" title="Zoom In">+</button>
                           <button onClick={() => zoomOut()} className="w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded text-white" title="Zoom Out">-</button>
                           <button onClick={() => resetTransform()} className="w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded text-white text-[10px] uppercase font-bold" title="Reset">FIT</button>
                        </div>
                        <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }}>
                          <div ref={previewRef} className="origin-center drop-shadow-2xl">

                                        {documentId === "sales_bill" && (!settings?.layout?.preset_type || settings?.layout?.preset_type === "legacy") && <PreviewSalesBill settings={settings} previewMode={customizer.ui.preview_mode} storeProfile={storeProfile} />}
                    {documentId === "sales_bill" && settings?.layout?.preset_type === "modern" && <ModernRetailInvoice settings={settings} storeProfile={storeProfile} invoice={{ invoice_number: "INV-12345", customer_name: "Sarah Johnson", customer_phone: "+94 77 123 4567", balance_due: 0, subtotal: 8000, discount_total: 500, tax_total: 1215, grand_total: 8715, created_at: "2026-07-16T15:25:00Z", lines: [{ description: "Smartphone Stand", qty: 2, unit_price: 2500, line_total: 5000 }, { description: "Screen Protector", qty: 1, unit_price: 3000, line_total: 3000 }] }} />}
                    {documentId === "sales_bill" && settings?.layout?.preset_type === "premium" && <PremiumBusinessInvoice settings={settings} storeProfile={storeProfile} invoice={{ invoice_number: "INV-12345", customer_name: "Sarah Johnson", customer_phone: "+94 77 123 4567", balance_due: 0, subtotal: 8000, discount_total: 500, tax_total: 1215, grand_total: 8715, created_at: "2026-07-16T15:25:00Z", lines: [{ description: "Smartphone Stand", qty: 2, unit_price: 2500, line_total: 5000 }, { description: "Screen Protector", qty: 1, unit_price: 3000, line_total: 3000 }] }} />}
                    {documentId === "job_card" && <PreviewJobCard settings={settings} previewMode={customizer.ui.preview_mode} />}
                    {documentId === "labels" && <PreviewLabel settings={settings} previewMode={customizer.ui.preview_mode} />}
                          </div>
                        </TransformComponent>
                      </React.Fragment>
                    )}
                  </TransformWrapper>
                </div>
              </SectionCard>

              <SectionCard title="Template Inventory">
                <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
                  <Table className="text-xs">
                    <thead>
                      <tr>
                        <th>Template</th>
                        <th>Document</th>
                        <th>Format</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(customizer.templates || []).map((row) => (
                        <tr key={row.id}>
                          <td>{row.name}</td>
                          <td>{row.document.replace("_", " ")}</td>
                          <td>{row.format}</td>
                          <td>{row.deployed ? <Badge tone="green">Deployed</Badge> : <Badge tone="slate">Draft</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </SectionCard>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

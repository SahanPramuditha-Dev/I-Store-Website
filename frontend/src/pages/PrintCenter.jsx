import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  History,
  Printer,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Store,
} from "lucide-react";
import api from "../lib/api";
import { listDesktopPrinters, printHtmlDocument } from "../lib/printBridge";
import { DEFAULT_SHOP_NAME } from "../lib/storeProfile";
import { useStoreProfile } from "../hooks/useStoreProfile";
import {
  Badge,
  AppTableHead,
  AppTableShell,
  Button,
  EmptyState,
  ErrorState,
  FilterToolbar,
  Input,
  PageContainer,
  PageHeader,
  SectionCard,
  Select,
  SensitiveActionIndicators,
  WorkstationNotice,
} from "../components/UI";
import { usePermissionsUI } from "../hooks/usePermissionUI";

const HISTORY_KEY = "istore.printCenter.history";

const DOCUMENT_TYPES = [
  {
    value: "sales_receipt",
    label: "Sales Receipt",
    badge: "POS",
    permission: ["pos.print", "pos.reprint"],
    referenceLabel: "Invoice ID",
    requiresReference: true,
    help: "Thermal receipt for completed POS sales.",
  },
  {
    value: "invoice",
    label: "Invoice",
    badge: "POS",
    permission: ["pos.print", "pos.reprint"],
    referenceLabel: "Invoice ID",
    requiresReference: true,
    help: "A4 or thermal invoice rendered by the backend.",
  },
  {
    value: "return_receipt",
    label: "Return Receipt",
    badge: "Returns",
    permission: "returns.print",
    referenceLabel: "Return ID",
    requiresReference: true,
    help: "Central return receipt preview for refund, exchange, and store credit flows.",
  },
  {
    value: "refund_receipt",
    label: "Refund Receipt",
    badge: "Returns",
    permission: "returns.print",
    referenceLabel: "Return ID",
    requiresReference: true,
    help: "Refund receipt rendered from the original return case.",
  },
  {
    value: "exchange_receipt",
    label: "Exchange Receipt",
    badge: "Returns",
    permission: "returns.print",
    referenceLabel: "Return ID",
    requiresReference: true,
    help: "Exchange receipt rendered from the original return case.",
  },
  {
    value: "advance_receipt",
    label: "Advance Payment Receipt",
    badge: "Payments",
    permission: ["advance.view", "pos.print"],
    referenceLabel: "Advance ID",
    requiresReference: true,
    help: "Receipt for customer advances and reservation deposits.",
  },
  {
    value: "repair_job_card",
    label: "Repair Job Card",
    badge: "Repairs",
    permission: "repairs.print_job_card",
    referenceLabel: "Repair ID",
    requiresReference: true,
    help: "Repair intake/job card with terms and technician handoff details.",
  },
  {
    value: "repair_delivery_receipt",
    label: "Repair Delivery Receipt",
    badge: "Repairs",
    permission: "repairs.print_job_card",
    referenceLabel: "Repair ID",
    requiresReference: true,
    help: "Repair delivery receipt with balance, parts, and customer handoff signatures.",
  },
  {
    value: "warranty_certificate",
    label: "Warranty Certificate",
    badge: "Warranty",
    permission: "warranty.print",
    referenceLabel: "Warranty Record ID",
    requiresReference: true,
    help: "Backend-rendered warranty certificate using Store Profile terms.",
  },
  {
    value: "barcode_sheet",
    label: "Barcode Sheet",
    badge: "Labels",
    permission: "labels.print",
    referenceLabel: "Batch/Queue ID",
    requiresReference: false,
    help: "Barcode sheet preview for inventory and repair labels.",
  },
  {
    value: "product_label",
    label: "Product Label",
    badge: "Labels",
    permission: "labels.print",
    referenceLabel: "Product ID/SKU",
    requiresReference: true,
    help: "Single product label with shop branding and SKU.",
  },
  {
    value: "payment_receipt",
    label: "Payment Receipt",
    badge: "Payments",
    permission: ["pos.print", "advance.view"],
    referenceLabel: "Payment ID",
    requiresReference: true,
    help: "Payment acknowledgement for balances, advances, and account settlements.",
  },
];

const PAPER_OPTIONS = [
  { value: "thermal_80", label: "Thermal 80mm" },
  { value: "a4", label: "A4" },
  { value: "label_38x25", label: "Label 38 x 25mm" },
  { value: "label_50x30", label: "Label 50 x 30mm" },
];

const TEMPLATE_OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "modern", label: "Modern (attractive)" },
  { value: "compact", label: "Compact workstation" },
  { value: "service", label: "Service/job card" },
  { value: "certificate", label: "Certificate" },
  { value: "label", label: "Label" },
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(value = new Date()) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value || "");
  }
}

function loadHistory() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 30) : [];
  } catch {
    return [];
  }
}

function saveHistory(rows) {
  if (typeof window === "undefined") return;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(rows.slice(0, 30)));
}

function storeHeader(identity) {
  const logo = identity.logoData
    ? `<img src="${escapeHtml(identity.logoData)}" alt="" style="max-height:48px;max-width:120px;object-fit:contain;margin-bottom:8px;" />`
    : "";
  return `
    <header class="store-header">
      ${logo}
      <h1>${escapeHtml(identity.shopName || DEFAULT_SHOP_NAME)}</h1>
      ${identity.tagline ? `<p class="tagline">${escapeHtml(identity.tagline)}</p>` : ""}
      <p>${escapeHtml(identity.address || "")}</p>
      <p>${escapeHtml([identity.phone, identity.email].filter(Boolean).join(" | "))}</p>
      ${identity.taxNumber ? `<p>Tax: ${escapeHtml(identity.taxNumber)}</p>` : ""}
    </header>
  `;
}

function documentStyles(paper) {
  const thermal = paper === "thermal_80";
  const label = paper.startsWith("label_");
  if (label) {
    return `
      @page { size: 50mm 30mm; margin: 2mm; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #fff; color: #111827; font-family: Arial, sans-serif; }
      .sheet { display: grid; grid-template-columns: repeat(2, 1fr); gap: 3mm; padding: 3mm; }
      .label { border: 1px solid #111827; border-radius: 4px; padding: 3mm; min-height: 25mm; display: flex; flex-direction: column; justify-content: space-between; }
      .label strong { font-size: 11px; }
      .barcode { height: 16px; background: repeating-linear-gradient(90deg, #111 0 2px, #fff 2px 4px, #111 4px 5px, #fff 5px 8px); }
      .muted { color: #4b5563; font-size: 9px; }
    `;
  }
  return `
    @page { size: ${thermal ? "80mm auto" : "A4"}; margin: ${thermal ? "4mm" : "14mm"}; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #fff; color: #111827; font-family: Arial, sans-serif; font-size: ${thermal ? "11px" : "13px"}; }
    .doc { width: 100%; max-width: ${thermal ? "72mm" : "760px"}; margin: 0 auto; }
    .store-header { text-align: center; border-bottom: 1px solid #d1d5db; padding-bottom: 10px; margin-bottom: 12px; }
    .store-header h1 { margin: 0; font-size: ${thermal ? "17px" : "24px"}; letter-spacing: .04em; }
    .store-header p { margin: 2px 0; color: #4b5563; }
    .tagline { color: #111827 !important; font-weight: 700; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; margin: 10px 0; }
    .meta div { border: 1px solid #e5e7eb; padding: 8px; border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 7px 5px; text-align: left; }
    th { color: #374151; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
    .total { display: flex; justify-content: space-between; gap: 16px; margin-top: 12px; padding-top: 10px; border-top: 2px solid #111827; font-weight: 800; }
    .notice { margin-top: 12px; border: 1px solid #f59e0b; background: #fffbeb; color: #92400e; padding: 8px; border-radius: 8px; }
    .footer { margin-top: 16px; text-align: center; color: #4b5563; font-size: 11px; }
  `;
}

function buildSampleDocumentHtml({ identity, doc, reference, paper, template }) {
  if (paper.startsWith("label_") || doc.value === "product_label" || doc.value === "barcode_sheet") {
    const labels = Array.from({ length: doc.value === "product_label" ? 2 : 8 });
    return `<!doctype html>
      <html><head><meta charset="utf-8" /><title>${escapeHtml(doc.label)}</title><style>${documentStyles(paper)}</style></head>
      <body>
        <div class="sheet">
          ${labels.map((_, index) => `
            <div class="label">
              <div>
                <strong>${escapeHtml(identity.shopName || DEFAULT_SHOP_NAME)}</strong>
                <div class="muted">${escapeHtml(doc.value === "product_label" ? "Product Label" : "Barcode Sheet")}</div>
              </div>
              <div class="barcode"></div>
              <div class="muted">SKU: ${escapeHtml(reference || `IST-${String(index + 1).padStart(4, "0")}`)}</div>
            </div>
          `).join("")}
        </div>
      </body></html>`;
  }

  const totalLabel = doc.value.includes("warranty") ? "Warranty Days" : "Amount";
  const totalValue = doc.value.includes("warranty") ? "365 Days" : "LKR 12,500.00";
  return `<!doctype html>
    <html>
      <head><meta charset="utf-8" /><title>${escapeHtml(doc.label)}</title><style>${documentStyles(paper)}</style></head>
      <body>
        <main class="doc">
          ${storeHeader(identity)}
          <h2>${escapeHtml(doc.label)}</h2>
          <section class="meta">
            <div><strong>Reference</strong><br />${escapeHtml(reference || "PREVIEW")}</div>
            <div><strong>Template</strong><br />${escapeHtml(template)}</div>
            <div><strong>Printed At</strong><br />${escapeHtml(formatDate())}</div>
            <div><strong>Operator</strong><br />I Store workstation</div>
          </section>
          <table>
            <thead><tr><th>Description</th><th>Status</th><th>Value</th></tr></thead>
            <tbody>
              <tr><td>${escapeHtml(doc.label)}</td><td>Preview</td><td>${escapeHtml(totalValue)}</td></tr>
              <tr><td>Audit state</td><td>Logged</td><td>Production print controlled</td></tr>
            </tbody>
          </table>
          <div class="total"><span>${escapeHtml(totalLabel)}</span><span>${escapeHtml(totalValue)}</span></div>
          <div class="notice">This preview uses Store Profile branding. Production printing is blocked when required Store Profile fields are missing.</div>
          <p class="footer">${escapeHtml(identity.invoiceFooter || identity.receiptMessage || "Thank you. Visit again.")}</p>
        </main>
      </body>
    </html>`;
}

function buildAdvanceReceiptHtml(receipt, identity, paper) {
  const merged = {
    ...identity,
    shopName: receipt.shop_name || identity.shopName,
    address: receipt.address || identity.address,
    phone: receipt.phone || identity.phone,
    email: receipt.email || identity.email,
    invoiceFooter: receipt.invoice_footer || identity.invoiceFooter,
  };
  return `<!doctype html>
    <html>
      <head><meta charset="utf-8" /><title>Advance Payment Receipt</title><style>${documentStyles(paper)}</style></head>
      <body>
        <main class="doc">
          ${storeHeader(merged)}
          <h2>Advance Payment Receipt</h2>
          <section class="meta">
            <div><strong>Receipt</strong><br />${escapeHtml(receipt.receipt_number || receipt.advance_number || "ADV")}</div>
            <div><strong>Customer</strong><br />${escapeHtml(receipt.customer_name || "-")}</div>
            <div><strong>Reservation</strong><br />${escapeHtml(receipt.reservation_number || "-")}</div>
            <div><strong>Date</strong><br />${escapeHtml(receipt.created_at || formatDate())}</div>
          </section>
          <table>
            <tbody>
              <tr><td>Amount paid</td><td>${escapeHtml(receipt.amount_paid || receipt.amount || "0")}</td></tr>
              <tr><td>Payment method</td><td>${escapeHtml(receipt.payment_method || "-")}</td></tr>
              <tr><td>Remaining balance</td><td>${escapeHtml(receipt.remaining_balance || "0")}</td></tr>
            </tbody>
          </table>
          <p class="footer">${escapeHtml(merged.invoiceFooter || "Thank you. Visit again.")}</p>
        </main>
      </body>
    </html>`;
}

function buildReturnReceiptHtml(record, identity, paper) {
  const items = Array.isArray(record.items) ? record.items : [];
  return `<!doctype html>
    <html>
      <head><meta charset="utf-8" /><title>Return Receipt</title><style>${documentStyles(paper)}</style></head>
      <body>
        <main class="doc">
          ${storeHeader(identity)}
          <h2>Return Receipt</h2>
          <section class="meta">
            <div><strong>Return No</strong><br />${escapeHtml(record.return_number || record.return_id || "-")}</div>
            <div><strong>Invoice</strong><br />${escapeHtml(record.original_invoice_number || record.invoice_id || "-")}</div>
            <div><strong>Customer</strong><br />${escapeHtml(record.customer_name || "-")}</div>
            <div><strong>Status</strong><br />${escapeHtml(record.decision_status || record.status || "-")}</div>
          </section>
          <table>
            <thead>
              <tr><th>Item</th><th>Qty</th><th>Condition</th><th>Action</th><th>Amount</th></tr>
            </thead>
            <tbody>
              ${
                items.length
                  ? items.map((item) => `
                    <tr>
                      <td>${escapeHtml(item.product_name || item.item_name || item.product_id || "-")}</td>
                      <td>${escapeHtml(item.quantity || 0)}</td>
                      <td>${escapeHtml(item.item_condition || "-")}</td>
                      <td>${escapeHtml(item.restock_action || "-")}</td>
                      <td>LKR ${Number(item.return_amount || item.unit_price || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    </tr>
                  `).join("")
                  : `<tr><td colspan="5">No return line items available.</td></tr>`
              }
            </tbody>
          </table>
          <div class="total"><span>Return Amount</span><span>LKR ${Number(record.total_return_amount || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
          <div class="total"><span>Refund Amount</span><span>LKR ${Number(record.refund_amount || 0).toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
          <div class="notice">Return/refund actions are permission controlled and audit logged.</div>
          <p class="footer">${escapeHtml(identity.invoiceFooter || identity.returnPolicy || "Returns are handled per shop policy.")}</p>
        </main>
      </body>
    </html>`;
}

function mergePrinterLists(desktopPrinters, savedPrinters) {
  const byName = new Map();
  [...(desktopPrinters || []), ...(savedPrinters || [])].forEach((row) => {
    const name = row?.name || row?.printer_name || row?.displayName || "";
    if (!name) return;
    byName.set(name, {
      name,
      displayName: row.displayName || row.label || name,
      status: row.status || (row.isDefault || row.is_default ? "Default" : "Configured"),
      isDefault: Boolean(row.isDefault || row.is_default),
      source: row.displayName ? "Desktop" : "Saved",
    });
  });
  return [...byName.values()].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

export default function PrintCenter() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { identity, loading: profileLoading } = useStoreProfile();
  const [documentType, setDocumentType] = useState(searchParams.get("type") || "sales_receipt");
  const [reference, setReference] = useState(searchParams.get("ref") || "");
  const [paper, setPaper] = useState(searchParams.get("paper") || "thermal_80");
  const [template, setTemplate] = useState(searchParams.get("template") || "modern");
  const [printerName, setPrinterName] = useState("");
  const [silent, setSilent] = useState(false);
  const [printers, setPrinters] = useState([]);
  const [previewHtml, setPreviewHtml] = useState("");
  const [history, setHistory] = useState(() => loadHistory());
  const [status, setStatus] = useState({ tone: "sky", text: "Ready to render a Store Profile print preview." });
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const permissionUI = usePermissionsUI();
  const doc = useMemo(() => DOCUMENT_TYPES.find((row) => row.value === documentType) || DOCUMENT_TYPES[0], [documentType]);
  const printPermission = permissionUI.guard(doc.permission, `Your role cannot print ${doc.label}.`);
  const canPrintDocument = printPermission.allowed;
  const profileWarnings = useMemo(() => {
    const missing = [];
    if (!String(identity.shopName || "").trim()) missing.push("shop name");
    if (!String(identity.address || "").trim()) missing.push("address");
    if (!String(identity.phone || "").trim()) missing.push("phone");
    return missing;
  }, [identity]);
  const productionReady = profileWarnings.length === 0;
  const currentPrinter = printers.find((row) => row.name === printerName);
  const printerMode = printers.length > 0 ? "Configured printer profile" : "Browser preview fallback";

  useEffect(() => {
    let active = true;
    Promise.all([
      listDesktopPrinters().catch(() => []),
      api.get("/labels/printers").then((res) => res.data || []).catch(() => []),
    ]).then(([desktopRows, savedRows]) => {
      if (!active) return;
      const merged = mergePrinterLists(desktopRows, savedRows);
      setPrinters(merged);
      const defaultPrinter = merged.find((row) => row.isDefault) || merged[0];
      if (defaultPrinter) setPrinterName((prev) => prev || defaultPrinter.name);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setSearchParams(
      {
        type: documentType,
        ...(reference ? { ref: reference } : {}),
        paper,
        ...(template ? { template } : {}),
      },
      { replace: true }
    );
  }, [documentType, reference, paper, template, setSearchParams]);

  useEffect(() => {
    setPreviewHtml("");
    setStatus({ tone: "sky", text: "Ready to render a backend production preview." });
  }, [doc, reference, paper, template]);

  useEffect(() => {
    if (!identity.shopName) return; // Don't render until store profile loaded
    
    const autoRender = async () => {
      setWorking(true);
      setError("");
      try {
        const html = await renderDocumentHtml(false);
        setPreviewHtml(html);
        const isDemo = !String(reference || "").trim();
        const modeText = isDemo ? "sample data (preview mode)" : "backend document data";
        setStatus({ tone: "green", text: `${doc.label} preview rendered from ${modeText}.` });
      } catch (err) {
        setError(err?.userMessage || err?.message || "Unable to render print preview.");
        setStatus({ tone: "red", text: "Preview failed. Check reference, permissions, and backend availability." });
      } finally {
        setWorking(false);
      }
    };

    autoRender();
  }, [doc, reference, paper, identity.shopName]);

  function addHistory(row) {
    const next = [{ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, createdAt: new Date().toISOString(), ...row }, ...history].slice(0, 30);
    setHistory(next);
    saveHistory(next);
  }

  async function renderDocumentHtml(forceSample = false, override = {}) {
    const activeDoc = override.doc || doc;
    const activeReference = override.reference ?? reference;
    const activePaper = override.paper || paper;
    const activeTemplate = override.template || template;
    if (forceSample) {
      return buildSampleDocumentHtml({ identity, doc: activeDoc, reference: activeReference, paper: activePaper, template: activeTemplate });
    }

    const { data } = await api.get("/print-center/render", {
      params: {
        document_type: activeDoc.value,
        ...(activeReference ? { reference: activeReference } : {}),
        paper: activePaper,
        ...(activeTemplate ? { template: activeTemplate } : {}),
      },
      responseType: "text",
      transformResponse: [(data) => data],
    });
    return String(data || "");
  }

  async function handlePreview() {
    setWorking(true);
    setError("");
    try {
      const html = await renderDocumentHtml(false);
      setPreviewHtml(html);
      const isDemo = !String(reference || "").trim();
      const modeText = isDemo ? "sample data (preview mode)" : "backend document data";
      setStatus({ tone: "green", text: `${doc.label} preview rendered from ${modeText}.` });
    } catch (err) {
      setError(err?.userMessage || err?.message || "Unable to render print preview.");
      setStatus({ tone: "red", text: "Preview failed. Check reference, permissions, and backend availability." });
    } finally {
      setWorking(false);
    }
  }

  async function handlePrint({ test = false, retry = null } = {}) {
    const targetDoc = retry ? DOCUMENT_TYPES.find((row) => row.value === retry.documentType) || doc : doc;
    const targetReference = retry ? retry.reference || "" : reference;
    if (!test && !productionReady) {
      setError(`Store Profile is incomplete. Add ${profileWarnings.join(", ")} before production printing.`);
      setStatus({ tone: "red", text: "Production print blocked by Store Profile readiness." });
      return;
    }
    if (!test && !permissionUI.can(targetDoc.permission)) {
      setError(`Your current role cannot print ${targetDoc.label}.`);
      setStatus({ tone: "red", text: "Print blocked by permission policy." });
      return;
    }
    setWorking(true);
    setError("");
    try {
      const html = test
        ? buildSampleDocumentHtml({ identity, doc: targetDoc, reference: targetReference || "TEST", paper, template })
        : await renderDocumentHtml(false, { doc: targetDoc, reference: targetReference, paper, template });
      setPreviewHtml(html);
      await printHtmlDocument(html, { printerName, silent: silent && !test });
      const row = {
        documentType: targetDoc.value,
        label: targetDoc.label,
        reference: targetReference,
        printerName: printerName || "Browser preview",
        paper,
        template,
        status: "Completed",
        message: test ? "Test print sent" : "Print job sent",
      };
      addHistory(row);
      setStatus({ tone: "green", text: `${row.message} to ${row.printerName}.` });
      if (retry) {
        setDocumentType(targetDoc.value);
        setReference(targetReference);
      }
    } catch (err) {
      const message = err?.userMessage || err?.message || "Print failed.";
      addHistory({
        documentType: targetDoc.value,
        label: targetDoc.label,
        reference: targetReference,
        printerName: printerName || "Browser preview",
        paper,
        template,
        status: "Failed",
        message,
      });
      setError(message);
      setStatus({ tone: "red", text: "Print failed. Check printer bridge, selected printer, and backend document data." });
    } finally {
      setWorking(false);
    }
  }

  return (
    <PageContainer className="print-center-page">
      <PageHeader
        eyebrow="System"
        title="Print Center"
        subtitle="Unified production printing for receipts, invoices, warranty certificates, job cards, labels, and payment documents."
        meta={
          <>
            <Badge tone={productionReady ? "green" : "amber"}>{productionReady ? "Store Profile Ready" : "Store Profile Incomplete"}</Badge>
            <Badge tone={printers.length ? "green" : "amber"}>{printerMode}</Badge>
            <Badge tone={canPrintDocument ? "sky" : "red"}>{canPrintDocument ? "Permission OK" : "Permission Required"}</Badge>
          </>
        }
        action={
          <>
            <Button variant="secondary" size="sm" onClick={handlePreview} disabled={working || printPermission.disabled} title={printPermission.reason || undefined}>
              <RefreshCw size={14} /> Render Preview
            </Button>
            <Button variant="warning" size="sm" onClick={() => handlePrint({ test: true })} disabled={working || printPermission.disabled} title={printPermission.reason || undefined}>
              <Printer size={14} /> Test Print
            </Button>
            <Button size="sm" onClick={() => handlePrint()} disabled={working || !productionReady || printPermission.disabled} title={printPermission.reason || (!productionReady ? "Complete Store Profile before production printing." : undefined)}>
              <Printer size={14} /> Print Document
            </Button>
          </>
        }
      />

      {!productionReady ? (
        <WorkstationNotice
          tone="amber"
          title="Store Profile required for production printing"
          text={`Missing required fields: ${profileWarnings.join(", ")}. Browser preview stays available, but production print jobs are blocked until the profile is complete.`}
          right={<Link className="text-xs font-black uppercase tracking-wider text-amber-100 underline" to="/settings">Open Store Profile</Link>}
        />
      ) : null}

      {error ? <ErrorState text={error} /> : null}

      <FilterToolbar
        right={<SensitiveActionIndicators items={["print", "permission", "audit"]} />}
      >
        <Select
          size="sm"
          value={documentType}
          onChange={(event) => setDocumentType(event.target.value)}
          options={DOCUMENT_TYPES.map((row) => ({ value: row.value, label: row.label }))}
          minWidth={210}
          fullWidth={false}
        />
        <Input
          className="h-9 max-w-[220px] text-xs"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder={doc.referenceLabel}
          aria-label={doc.referenceLabel}
        />
        <Select
          size="sm"
          value={paper}
          onChange={(event) => setPaper(event.target.value)}
          options={PAPER_OPTIONS}
          minWidth={150}
          fullWidth={false}
        />
        <Select
          size="sm"
          value={template}
          onChange={(event) => setTemplate(event.target.value)}
          options={TEMPLATE_OPTIONS}
          minWidth={170}
          fullWidth={false}
        />
        <Select
          size="sm"
          value={printerName}
          onChange={(event) => setPrinterName(event.target.value)}
          options={[{ value: "", label: "Browser preview" }, ...printers.map((row) => ({ value: row.name, label: `${row.displayName}${row.isDefault ? " (Default)" : ""}` }))]}
          minWidth={210}
          fullWidth={false}
        />
        <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs font-semibold text-slate-300">
          <input type="checkbox" checked={silent} onChange={(event) => setSilent(event.target.checked)} />
          Silent print
        </label>
      </FilterToolbar>

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(300px,0.78fr)_minmax(520px,1.4fr)_minmax(310px,0.82fr)]">
        <div className="space-y-4">
          <SectionCard title="Document Control" subtitle={doc.help} right={<Badge tone="indigo">{doc.badge}</Badge>}>
            <div className="space-y-3 text-xs text-slate-300">
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="font-bold text-white">{doc.label}</p>
                <p className="mt-1 text-slate-400">{doc.requiresReference ? `${doc.referenceLabel} required` : "Reference optional"}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-slate-500">Paper</p>
                  <p className="mt-1 font-bold text-white">{PAPER_OPTIONS.find((row) => row.value === paper)?.label}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-slate-500">Template</p>
                  <p className="mt-1 font-bold text-white">{TEMPLATE_OPTIONS.find((row) => row.value === template)?.label}</p>
                </div>
              </div>
              <WorkstationNotice
                tone={canPrintDocument ? "sky" : "red"}
                title={canPrintDocument ? "Permission check passed" : "Permission required"}
                text={canPrintDocument ? "This document type can be printed by the current session." : "The print button is disabled until the current role has the matching print permission."}
              />
            </div>
          </SectionCard>

          <SectionCard title="Store Profile Preview" subtitle={profileLoading ? "Loading profile..." : "Single source for printed branding"} right={<Store size={16} className="text-indigo-300" />}>
            <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4 text-center">
              {identity.logoData ? <img src={identity.logoData} alt="" className="mx-auto mb-2 max-h-12 max-w-28 object-contain" /> : null}
              <p className="text-lg font-black text-white">{identity.shopName || DEFAULT_SHOP_NAME}</p>
              {identity.tagline ? <p className="text-xs font-semibold text-indigo-200">{identity.tagline}</p> : null}
              <p className="mt-2 text-xs text-slate-400">{identity.address || "Address missing"}</p>
              <p className="text-xs text-slate-400">{[identity.phone, identity.email].filter(Boolean).join(" | ") || "Phone/email missing"}</p>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 text-xs">
              {["shopName", "address", "phone"].map((key) => {
                const label = key === "shopName" ? "Shop name" : key === "address" ? "Address" : "Phone";
                const ok = Boolean(String(identity[key] || "").trim());
                return (
                  <div key={key} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                    <span className="text-slate-300">{label}</span>
                    <Badge tone={ok ? "green" : "amber"}>{ok ? "Ready" : "Missing"}</Badge>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        </div>

        <SectionCard
          title="Backend-rendered Preview"
          subtitle="Preview uses backend HTML where available, otherwise the central Store Profile template."
          right={<FileText size={16} className="text-sky-300" />}
          className="min-w-0"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Badge tone={status.tone}>{status.text}</Badge>
            {working ? <Badge tone="amber">Working</Badge> : <Badge tone="green">Idle</Badge>}
          </div>
          <div className="h-[min(560px,calc(100vh-260px))] min-h-[260px] overflow-hidden rounded-2xl border border-white/10 bg-white">
            <iframe title="Print preview" srcDoc={previewHtml} className="h-full w-full bg-white" />
          </div>
        </SectionCard>

        <div className="space-y-4">
          <SectionCard title="Printer Selection" subtitle="Saved printer profiles and browser print status" right={<Settings2 size={16} className="text-emerald-300" />}>
            {currentPrinter ? (
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-bold text-emerald-100">{currentPrinter.displayName}</p>
                  <Badge tone="green">{currentPrinter.status || "Ready"}</Badge>
                </div>
                <p className="mt-1 text-xs text-emerald-100/70">{currentPrinter.source} printer profile</p>
              </div>
            ) : (
              <WorkstationNotice
                tone="amber"
                title="No printer profile detected"
                text="Print Center will use browser preview. Configure saved printer profiles in Settings for faster printing."
              />
            )}
            <div className="mt-3 space-y-2">
              {printers.slice(0, 5).map((row) => (
                <button
                  type="button"
                  key={row.name}
                  onClick={() => setPrinterName(row.name)}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs transition ${
                    printerName === row.name ? "border-indigo-400/50 bg-indigo-500/15 text-indigo-100" : "border-white/10 bg-black/20 text-slate-300 hover:border-white/20"
                  }`}
                >
                  <span className="truncate font-semibold">{row.displayName}</span>
                  {row.isDefault ? <CheckCircle2 size={14} className="text-emerald-300" /> : <span className="text-slate-500">{row.status || "Saved"}</span>}
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Print History" subtitle="Last local print attempts with retry for failed jobs" right={<History size={16} className="text-indigo-300" />}>
            {history.length === 0 ? (
              <EmptyState title="No print attempts yet" text="Test print or print a document to start local workstation history." />
            ) : (
              <AppTableShell minWidth={520} maxHeightClass="max-h-[360px]" innerClassName="table table-compact table-sticky" aria-label="Local print history">
                  <AppTableHead>
                    <tr>
                      <th>Time</th>
                      <th>Document</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </AppTableHead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.id}>
                        <td>{formatDate(row.createdAt)}</td>
                        <td>
                          <p className="font-semibold text-white">{row.label}</p>
                          <p className="text-[10px] text-slate-500">{row.reference || "No reference"} / {row.printerName}</p>
                        </td>
                        <td><Badge tone={row.status === "Completed" ? "green" : "red"}>{row.status}</Badge></td>
                        <td>
                          {row.status === "Failed" ? (
                            <Button size="sm" variant="secondary" onClick={() => handlePrint({ retry: row })}>
                              <RotateCcw size={12} /> Retry
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
              </AppTableShell>
            )}
          </SectionCard>

          <WorkstationNotice
            tone="sky"
            title="Production print policy"
            text="Print jobs show permission, Store Profile readiness, printer target, and audit intent before the operator can send a production document."
            right={<ShieldCheck size={18} />}
          />
          {!productionReady || !canPrintDocument ? (
            <WorkstationNotice
              tone="red"
              title="Blocked state is visible"
              text="Disabled production buttons are intentional. Use Store Profile and Permission Management to resolve missing requirements."
              right={<AlertTriangle size={18} />}
            />
          ) : null}
        </div>
      </div>
    </PageContainer>
  );
}

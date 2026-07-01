import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Barcode,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  FileJson,
  Filter,
  History,
  LayoutGrid,
  Package,
  Pause,
  Play,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Save,
  ScanLine,
  Search,
  Settings2,
  ShieldCheck,
  Tags,
  Trash2,
  Truck,
  Upload,
  Wand2,
  Wrench,
  XCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import api from "../lib/api";
import { printHtmlDocument } from "../lib/printBridge";
import { useFeedback } from "../components/FeedbackProvider";
import { Badge, Button, KpiCard, SectionCard, Select, Table } from "../components/UI";
import { downloadCsv, openPrintView } from "../lib/tableUtils";

const TABS = [
  { key: "dashboard", label: "1. Labels Dashboard", icon: LayoutGrid },
  { key: "products", label: "2. Product Labels", icon: Package },
  { key: "repairs", label: "3. Repair Job Labels", icon: Wrench },
  { key: "spares", label: "4. Spare Parts Labels", icon: Truck },
  { key: "assets", label: "5. Asset Labels", icon: ShieldCheck },
  { key: "designer", label: "6. Label Designer", icon: Wand2 },
  { key: "queue", label: "7. Print Queue", icon: ClipboardList },
  { key: "scanner", label: "8. Barcode Scanner", icon: ScanLine },
  { key: "history", label: "9. Label History", icon: History },
];

const LABEL_TYPE_BY_TAB = {
  products: "Product",
  repairs: "Repair Job",
  spares: "Spare Part",
  assets: "Asset",
};

const ENTITY_BY_TAB = {
  products: "inventory_item",
  repairs: "repair_ticket",
  spares: "inventory_item",
  assets: "asset",
};

const STATUS_TONE = {
  Waiting: "amber",
  Printing: "sky",
  Completed: "green",
  Failed: "red",
  Paused: "indigo",
  Cancelled: "slate",
  "In Stock": "green",
  Low: "amber",
  "Out of Stock": "red",
  Active: "green",
  Expired: "red",
  Unknown: "slate",
};

const PRESET_ELEMENT_TYPES = [
  "text",
  "barcode",
  "qrcode",
  "price",
  "line",
  "box",
  "badge",
];

const HISTORY_COLUMNS = [
  { label: "Date & Time", value: "created_at" },
  { label: "Label Type", value: "label_type" },
  { label: "Item", value: "item_name" },
  { label: "Template", value: "template_name" },
  { label: "Qty", value: "qty" },
  { label: "Printer", value: "printer_name" },
  { label: "Printed By", value: "generated_by" },
  { label: "Reprint", value: (row) => (row.is_reprint ? "Yes" : "No") },
  { label: "Status", value: "status" },
];

function money(value) {
  return `LKR ${Math.round(Number(value || 0)).toLocaleString("en-LK")}`;
}

function toDate(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleDateString();
}

function toDateTime(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function resolveDynamic(input, data) {
  const raw = String(input ?? "");
  return raw.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = data?.[key];
    return value === undefined || value === null || value === "" ? "-" : String(value);
  });
}

function barcodeBits(value) {
  const source = String(value || "").toUpperCase();
  const bits = [];
  for (const ch of source) {
    const code = ch.charCodeAt(0).toString(2).padStart(8, "0");
    for (const bit of code) bits.push(bit === "1" ? 1 : 0);
    bits.push(0);
  }
  return bits.length ? bits : [1, 0, 1, 0, 1, 1, 0, 1];
}

function qrBits(value, size = 21) {
  const source = String(value || "");
  let seed = 0;
  for (let i = 0; i < source.length; i += 1) {
    seed = (seed * 31 + source.charCodeAt(i)) % 1000003;
  }
  const cells = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const v = (seed + x * 17 + y * 43 + x * y * 7) % 11;
      cells.push(v > 5 ? 1 : 0);
    }
  }
  return { size, cells };
}

function pickTone(status) {
  return STATUS_TONE[String(status || "").trim()] || "slate";
}

function buildPreviewData(tabKey, row, meta) {
  const prefs = meta?.preferences || {};
  const base = {
    shop_name: prefs.shop_name || "I Point",
    shop_phone: prefs.shop_phone || "+94 77 123 4567",
    date_printed: new Date().toLocaleDateString(),
    status: row?.status || row?.stock_status || "Active",
  };
  if (!row) return base;

  if (tabKey === "products") {
    return {
      ...base,
      product_name: row.name,
      sku: row.sku,
      barcode: row.barcode || row.sku,
      price: Number(row.sale_price || 0).toLocaleString("en-LK"),
      mrp: Number(row.sale_price || 0).toLocaleString("en-LK"),
      discount: "0%",
      brand: row.brand || "",
      model: row.model || "",
      category: row.category || "",
      warranty: `${row.warranty_days || 0} days`,
      location: row.location || "",
      quantity: row.quantity || 0,
      customer_name: "",
      job_id: "",
      technician: "",
    };
  }

  if (tabKey === "repairs") {
    return {
      ...base,
      product_name: row.device_model,
      sku: row.job_id,
      barcode: row.job_id,
      price: "0",
      brand: "",
      model: row.device_model || "",
      category: "Repair",
      warranty: "-",
      location: "",
      customer_name: row.customer_name || "Walk-in",
      customer_phone: row.customer_phone || "",
      job_id: row.job_id,
      technician: row.technician || "",
      received_date: toDate(row.received_at),
      est_completion: toDate(row.estimated_completion),
      issue: row.issue || "",
    };
  }

  if (tabKey === "spares") {
    return {
      ...base,
      product_name: row.part_name,
      sku: row.sku,
      barcode: row.barcode || row.sku,
      price: Number(row.cost_price || 0).toLocaleString("en-LK"),
      brand: row.brand || "",
      model: row.compatible_models || "",
      category: row.category || "",
      location: row.location || "",
      condition: row.condition || "New",
      warranty: "-",
    };
  }

  if (tabKey === "assets") {
    return {
      ...base,
      product_name: row.asset_name,
      sku: row.asset_code,
      barcode: row.barcode_value || row.asset_code,
      brand: "",
      model: row.asset_type || "",
      category: row.department || "",
      location: row.location || "",
      assigned_to: row.assigned_to || "",
      warranty: toDate(row.warranty_expiry_date),
      maintenance_due: toDate(row.maintenance_due_date),
    };
  }

  return base;
}

function BarcodeBars({ value, className = "" }) {
  const bits = barcodeBits(value);
  return (
    <div className={`flex items-end h-full w-full overflow-hidden ${className}`}>
      {bits.map((bit, index) => (
        <div
          key={`b-${index}`}
          style={{
            width: bit ? 2 : 1,
            height: bit ? "100%" : "58%",
            background: bit ? "#020617" : "transparent",
            marginRight: 1,
          }}
        />
      ))}
    </div>
  );
}

function QrGlyph({ value }) {
  const pattern = qrBits(value, 19);
  const { size, cells } = pattern;
  return (
    <div className="grid h-full w-full bg-white" style={{ gridTemplateColumns: `repeat(${size}, minmax(0,1fr))` }}>
      {cells.map((cell, index) => (
        <div key={`q-${index}`} style={{ background: cell ? "#020617" : "#ffffff" }} />
      ))}
    </div>
  );
}

function LabelPreview({
  template,
  data,
  scale = 3,
  selectedElementId = null,
  onElementPointerDown = null,
  interactive = false,
}) {
  const canvas = template?.canvas || {};
  const widthMm = Number(template?.width_mm || 50);
  const heightMm = Number(template?.height_mm || 30);
  const elements = Array.isArray(canvas?.elements) ? canvas.elements : [];
  const border = canvas?.border || { enabled: true, color: "#0f172a", width: 1 };
  const bg = canvas?.background || "#ffffff";

  return (
    <div
      className="relative rounded-xl shadow-2xl"
      style={{
        width: `${Math.max(20, widthMm * scale)}px`,
        height: `${Math.max(20, heightMm * scale)}px`,
        background: bg,
        border: border?.enabled ? `${Math.max(1, Number(border.width || 1))}px solid ${border.color || "#0f172a"}` : "1px solid transparent",
      }}
    >
      {elements.map((element, idx) => {
        const id = element.id || `el-${idx}`;
        const x = Number(element.x || 0) * scale;
        const y = Number(element.y || 0) * scale;
        const w = Math.max(4, Number(element.w || 10) * scale);
        const h = Math.max(4, Number(element.h || 4) * scale);
        const fontSize = Math.max(8, Number(element.fontSize || 9));
        const resolved = resolveDynamic(element.value, data || {});
        const isSelected = selectedElementId && selectedElementId === id;
        const commonStyle = {
          position: "absolute",
          left: x,
          top: y,
          width: w,
          height: h,
          cursor: interactive ? "move" : "default",
          userSelect: "none",
          outline: isSelected ? "2px dashed rgba(99,102,241,.8)" : "none",
          outlineOffset: 1,
          color: element.color || "#020617",
        };

        let node = null;
        if (element.type === "barcode") {
          node = (
            <div style={commonStyle} className="flex flex-col justify-center">
              <div className="h-[70%]">
                <BarcodeBars value={resolved} />
              </div>
              <div className="text-[8px] text-center tracking-wide">{resolved}</div>
            </div>
          );
        } else if (element.type === "qrcode") {
          node = (
            <div style={commonStyle}>
              <QrGlyph value={resolved} />
            </div>
          );
        } else if (element.type === "line") {
          node = <div style={{ ...commonStyle, borderBottom: `1px solid ${element.color || "#0f172a"}` }} />;
        } else if (element.type === "box") {
          node = <div style={{ ...commonStyle, border: `1px solid ${element.color || "#0f172a"}` }} />;
        } else if (element.type === "badge") {
          node = (
            <div
              style={{
                ...commonStyle,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 999,
                background: "rgba(15,23,42,.12)",
                border: "1px solid rgba(15,23,42,.25)",
                fontSize,
                fontWeight: 700,
                textAlign: "center",
                padding: "0 4px",
                overflow: "hidden",
                whiteSpace: "nowrap",
              }}
            >
              {resolved}
            </div>
          );
        } else {
          node = (
            <div
              style={{
                ...commonStyle,
                fontSize,
                fontWeight: element.bold ? 700 : 500,
                fontStyle: element.italic ? "italic" : "normal",
                textAlign: element.align || "left",
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
                lineHeight: `${Math.max(10, h - 1)}px`,
                padding: "0 2px",
              }}
              title={resolved}
            >
              {resolved}
            </div>
          );
        }

        if (!interactive || !onElementPointerDown) return <div key={id}>{node}</div>;
        return (
          <div key={id} onMouseDown={(event) => onElementPointerDown(event, id)}>
            {node}
          </div>
        );
      })}
    </div>
  );
}

function TabButton({ active, label, icon: Icon, onClick }) {
  return (
    <button
      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-black uppercase tracking-wider transition ${
        active
          ? "bg-sky-500/20 border-sky-400/45 text-sky-100"
          : "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:text-white"
      }`}
      onClick={onClick}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

function ToneBadge({ value }) {
  return <Badge tone={pickTone(value)}>{value || "-"}</Badge>;
}

function renderLabelToCanvas(template, previewData) {
  const widthMm = Number(template?.width_mm || 50);
  const heightMm = Number(template?.height_mm || 30);
  const canvasDef = template?.canvas || {};
  const elements = Array.isArray(canvasDef?.elements) ? canvasDef.elements : [];
  const pxPerMm = 10;

  const c = document.createElement("canvas");
  c.width = Math.max(200, Math.round(widthMm * pxPerMm));
  c.height = Math.max(120, Math.round(heightMm * pxPerMm));
  const ctx = c.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = canvasDef?.background || "#ffffff";
  ctx.fillRect(0, 0, c.width, c.height);

  const border = canvasDef?.border || {};
  if (border.enabled) {
    ctx.strokeStyle = border.color || "#0f172a";
    ctx.lineWidth = Math.max(1, Number(border.width || 1));
    ctx.strokeRect(0, 0, c.width, c.height);
  }

  for (const element of elements) {
    const x = Number(element.x || 0) * pxPerMm;
    const y = Number(element.y || 0) * pxPerMm;
    const w = Math.max(10, Number(element.w || 10) * pxPerMm);
    const h = Math.max(10, Number(element.h || 4) * pxPerMm);
    const text = resolveDynamic(element.value, previewData || {});
    const fontSize = Math.max(9, Number(element.fontSize || 10) + 3);
    const color = element.color || "#0f172a";

    if (element.type === "line") {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + h / 2);
      ctx.lineTo(x + w, y + h / 2);
      ctx.stroke();
      continue;
    }

    if (element.type === "box") {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
      continue;
    }

    if (element.type === "barcode") {
      const bits = barcodeBits(text);
      const barWidth = Math.max(1, Math.floor(w / Math.max(1, bits.length)));
      let cursor = x;
      for (const bit of bits) {
        if (bit) {
          ctx.fillStyle = "#020617";
          ctx.fillRect(cursor, y + 2, barWidth, Math.max(8, h - 16));
        }
        cursor += barWidth;
      }
      ctx.fillStyle = "#020617";
      ctx.font = "12px monospace";
      ctx.fillText(text, x + 2, y + h - 3);
      continue;
    }

    if (element.type === "qrcode") {
      const pattern = qrBits(text, 15);
      const cell = Math.max(1, Math.floor(Math.min(w, h) / pattern.size));
      let idx = 0;
      for (let qy = 0; qy < pattern.size; qy += 1) {
        for (let qx = 0; qx < pattern.size; qx += 1) {
          ctx.fillStyle = pattern.cells[idx] ? "#020617" : "#ffffff";
          ctx.fillRect(x + qx * cell, y + qy * cell, cell, cell);
          idx += 1;
        }
      }
      ctx.strokeStyle = "#020617";
      ctx.strokeRect(x, y, pattern.size * cell, pattern.size * cell);
      continue;
    }

    if (element.type === "badge") {
      ctx.fillStyle = "rgba(15,23,42,.15)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "rgba(15,23,42,.5)";
      ctx.strokeRect(x, y, w, h);
    }

    ctx.fillStyle = color;
    ctx.font = `${element.bold ? "bold " : ""}${fontSize}px Segoe UI`;
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 4, y + h / 2);
  }
  return c;
}

export default function Barcodes() {
  const { toast, confirm } = useFeedback();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [labelsApiAvailable, setLabelsApiAvailable] = useState(true);

  const [meta, setMeta] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [products, setProducts] = useState([]);
  const [repairs, setRepairs] = useState([]);
  const [spares, setSpares] = useState([]);
  const [assets, setAssets] = useState([]);
  const [queueRows, setQueueRows] = useState([]);
  const [historyState, setHistoryState] = useState({ rows: [], kpis: {}, reprint_analysis: [], staff_reprint_count: [] });
  const [scanHistory, setScanHistory] = useState([]);

  const [productFilters, setProductFilters] = useState({ q: "", category: "all", brand: "all", supplier_id: "all", stock_status: "all", unlabelled_only: false });
  const [repairFilters, setRepairFilters] = useState({ q: "", technician: "all", status: "all", unlabelled_only: false });
  const [spareFilters, setSpareFilters] = useState({ q: "", category: "all", brand: "all", supplier_id: "all", unlabelled_only: false });
  const [assetFilters, setAssetFilters] = useState({ q: "", asset_type: "all", status: "all" });
  const [queueFilters, setQueueFilters] = useState({ status: "all", label_type: "all", q: "" });
  const [historyFilters, setHistoryFilters] = useState({ date_from: "", date_to: "", label_type: "all", status: "all", reprint_only: false, q: "" });

  const [selectedProducts, setSelectedProducts] = useState([]);
  const [selectedRepairs, setSelectedRepairs] = useState([]);
  const [selectedSpares, setSelectedSpares] = useState([]);
  const [selectedAssets, setSelectedAssets] = useState([]);
  const [printQty, setPrintQty] = useState({});

  const [selectedTemplateByScope, setSelectedTemplateByScope] = useState({});
  const [previewTabSource, setPreviewTabSource] = useState({ tab: "products", row: null });
  const [batchMode, setBatchMode] = useState("one_per_product");
  const [printSettings, setPrintSettings] = useState({
    barcode_format: "Auto",
    printer_name: "",
    paper_type: "Label Roll",
    print_quality: "Normal",
    orientation: "Portrait",
    copies: 1,
  });

  const [scanInput, setScanInput] = useState("");
  const [scanMode, setScanMode] = useState("scanner");
  const [scanResult, setScanResult] = useState(null);
  const [multiScanMode, setMultiScanMode] = useState(false);
  const [multiScanRows, setMultiScanRows] = useState([]);

  const [designerDraft, setDesignerDraft] = useState(null);
  const [designerSelectedElementId, setDesignerSelectedElementId] = useState(null);
  const [designerZoom, setDesignerZoom] = useState(140);
  const [designerDrag, setDesignerDrag] = useState(null);
  const designerPreviewRef = useRef(null);

  const [assetForm, setAssetForm] = useState({
    asset_name: "",
    asset_type: "Tool",
    department: "",
    location: "",
    purchase_date: "",
    warranty_expiry_date: "",
    assigned_to: "",
    maintenance_due_date: "",
    barcode_value: "",
    qr_value: "",
    status: "Active",
  });

  const defaultTemplatesByScope = useMemo(() => {
    const map = {};
    for (const scope of LABEL_SCOPE_LOOP) {
      const pool = templates.filter((t) => t.label_scope === scope && t.is_active);
      map[scope] = pool.find((t) => t.is_default) || pool[0] || null;
    }
    return map;
  }, [templates]);

  const selectedTemplate = useMemo(() => {
    const scope = activeTab === "designer" ? designerDraft?.label_scope : LABEL_TYPE_BY_TAB[previewTabSource.tab || activeTab];
    if (!scope) return null;
    const selectedId = selectedTemplateByScope[scope];
    if (selectedId) {
      const found = templates.find((t) => t.id === selectedId);
      if (found) return found;
    }
    return defaultTemplatesByScope[scope] || null;
  }, [activeTab, designerDraft?.label_scope, previewTabSource.tab, selectedTemplateByScope, templates, defaultTemplatesByScope]);

  const previewTemplate = activeTab === "designer" ? designerDraft : selectedTemplate;

  const previewData = useMemo(() => {
    if (activeTab === "designer") {
      const scopeToTab = designerDraft?.label_scope === "Repair Job" ? "repairs" : designerDraft?.label_scope === "Spare Part" ? "spares" : designerDraft?.label_scope === "Asset" ? "assets" : "products";
      return buildPreviewData(scopeToTab, previewTabSource.row, meta);
    }
    return buildPreviewData(previewTabSource.tab, previewTabSource.row, meta);
  }, [activeTab, designerDraft?.label_scope, previewTabSource.row, previewTabSource.tab, meta]);

  const printerOptions = meta?.printers || [];

  useEffect(() => {
    if (!printSettings.printer_name && printerOptions.length) {
      const defaultPrinter = printerOptions.find((p) => p.is_default) || printerOptions[0];
      setPrintSettings((prev) => ({ ...prev, printer_name: defaultPrinter?.name || "" }));
    }
  }, [printSettings.printer_name, printerOptions]);

  const loadCore = useCallback(async () => {
    setLoading(true);
    try {
      const [metaRes, dashRes, templateRes, queueRes, historyRes, scanRes] = await Promise.all([
        api.get("/labels/meta"),
        api.get("/labels/dashboard"),
        api.get("/labels/templates"),
        api.get("/labels/queue"),
        api.get("/labels/history"),
        api.get("/labels/scanner/history"),
      ]);
      setMeta(metaRes.data || null);
      setDashboard(dashRes.data || null);
      const templateRows = Array.isArray(templateRes.data) ? templateRes.data : [];
      setTemplates(templateRows);
      setQueueRows(Array.isArray(queueRes.data) ? queueRes.data : []);
      setHistoryState(historyRes.data || { rows: [], kpis: {}, reprint_analysis: [], staff_reprint_count: [] });
      setScanHistory(Array.isArray(scanRes.data) ? scanRes.data : []);
      setLabelsApiAvailable(true);

      if (templateRows.length) {
        const nextScopes = {};
        for (const scope of LABEL_SCOPE_LOOP) {
          const scoped = templateRows.filter((row) => row.label_scope === scope && row.is_active);
          const chosen = scoped.find((row) => row.is_default) || scoped[0];
          if (chosen) nextScopes[scope] = chosen.id;
        }
        setSelectedTemplateByScope((prev) => ({ ...nextScopes, ...prev }));
      }
    } catch (error) {
      if (error?.response?.status === 404) {
        setLabelsApiAvailable(false);
        setMeta(null);
        setDashboard(null);
        setTemplates([]);
        setQueueRows([]);
        setHistoryState({ rows: [], kpis: {}, reprint_analysis: [], staff_reprint_count: [] });
        setScanHistory([]);
        toast("Labels API endpoints are not available on the running backend. Restart backend with latest code.", "warning");
      } else {
        toast(error.response?.data?.detail || "Failed to load labels module", "error");
      }
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadProducts = useCallback(async () => {
    if (!labelsApiAvailable) return;
    try {
      const params = {
        q: productFilters.q || undefined,
        category: productFilters.category !== "all" ? productFilters.category : undefined,
        brand: productFilters.brand !== "all" ? productFilters.brand : undefined,
        supplier_id: productFilters.supplier_id !== "all" ? Number(productFilters.supplier_id) : undefined,
        stock_status: productFilters.stock_status !== "all" ? productFilters.stock_status : undefined,
        unlabelled_only: productFilters.unlabelled_only || undefined,
      };
      const res = await api.get("/labels/products", { params });
      const rows = Array.isArray(res.data) ? res.data : [];
      setProducts(rows);
      if (!previewTabSource.row && rows[0]) setPreviewTabSource({ tab: "products", row: rows[0] });
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to load product label rows", "error");
    }
  }, [labelsApiAvailable, productFilters, previewTabSource.row, toast]);

  const loadRepairs = useCallback(async () => {
    if (!labelsApiAvailable) return;
    try {
      const params = {
        q: repairFilters.q || undefined,
        technician: repairFilters.technician !== "all" ? repairFilters.technician : undefined,
        status: repairFilters.status !== "all" ? repairFilters.status : undefined,
        unlabelled_only: repairFilters.unlabelled_only || undefined,
      };
      const res = await api.get("/labels/repairs", { params });
      const rows = Array.isArray(res.data) ? res.data : [];
      setRepairs(rows);
      if (!previewTabSource.row && rows[0]) setPreviewTabSource({ tab: "repairs", row: rows[0] });
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to load repair label rows", "error");
    }
  }, [labelsApiAvailable, repairFilters, previewTabSource.row, toast]);

  const loadSpares = useCallback(async () => {
    if (!labelsApiAvailable) return;
    try {
      const params = {
        q: spareFilters.q || undefined,
        category: spareFilters.category !== "all" ? spareFilters.category : undefined,
        brand: spareFilters.brand !== "all" ? spareFilters.brand : undefined,
        supplier_id: spareFilters.supplier_id !== "all" ? Number(spareFilters.supplier_id) : undefined,
        unlabelled_only: spareFilters.unlabelled_only || undefined,
      };
      const res = await api.get("/labels/spare-parts", { params });
      const rows = Array.isArray(res.data) ? res.data : [];
      setSpares(rows);
      if (!previewTabSource.row && rows[0]) setPreviewTabSource({ tab: "spares", row: rows[0] });
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to load spare part labels", "error");
    }
  }, [labelsApiAvailable, spareFilters, previewTabSource.row, toast]);

  const loadAssets = useCallback(async () => {
    if (!labelsApiAvailable) return;
    try {
      const params = {
        q: assetFilters.q || undefined,
        asset_type: assetFilters.asset_type !== "all" ? assetFilters.asset_type : undefined,
        status: assetFilters.status !== "all" ? assetFilters.status : undefined,
      };
      const res = await api.get("/labels/assets", { params });
      const rows = Array.isArray(res.data) ? res.data : [];
      setAssets(rows);
      if (!previewTabSource.row && rows[0]) setPreviewTabSource({ tab: "assets", row: rows[0] });
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to load assets", "error");
    }
  }, [assetFilters, labelsApiAvailable, previewTabSource.row, toast]);

  const loadQueue = useCallback(async () => {
    if (!labelsApiAvailable) return;
    try {
      const params = {
        status: queueFilters.status !== "all" ? queueFilters.status : undefined,
        label_type: queueFilters.label_type !== "all" ? queueFilters.label_type : undefined,
        q: queueFilters.q || undefined,
      };
      const res = await api.get("/labels/queue", { params });
      setQueueRows(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to load queue", "error");
    }
  }, [labelsApiAvailable, queueFilters, toast]);

  const loadHistory = useCallback(async () => {
    if (!labelsApiAvailable) return;
    try {
      const params = {
        date_from: historyFilters.date_from || undefined,
        date_to: historyFilters.date_to || undefined,
        label_type: historyFilters.label_type !== "all" ? historyFilters.label_type : undefined,
        status: historyFilters.status !== "all" ? historyFilters.status : undefined,
        reprint_only: historyFilters.reprint_only || undefined,
        q: historyFilters.q || undefined,
      };
      const res = await api.get("/labels/history", { params });
      setHistoryState(res.data || { rows: [], kpis: {}, reprint_analysis: [], staff_reprint_count: [] });
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to load label history", "error");
    }
  }, [historyFilters, labelsApiAvailable, toast]);

  useEffect(() => {
    loadCore();
  }, [loadCore]);

  useEffect(() => {
    if (!labelsApiAvailable) return;
    if (activeTab === "products") loadProducts();
    if (activeTab === "repairs") loadRepairs();
    if (activeTab === "spares") loadSpares();
    if (activeTab === "assets") loadAssets();
    if (activeTab === "queue") loadQueue();
    if (activeTab === "history") loadHistory();
    if (activeTab === "designer" && !designerDraft) {
      const fallback =
        templates.find((row) => row.label_scope === "Product" && row.is_default) ||
        templates.find((row) => row.label_scope === "Product") ||
        templates[0];
      if (fallback) setDesignerDraft(clone(fallback));
    }
  }, [activeTab, designerDraft, labelsApiAvailable, loadAssets, loadHistory, loadProducts, loadQueue, loadRepairs, loadSpares, templates]);

  const refreshAll = useCallback(async () => {
    if (!labelsApiAvailable) {
      await loadCore();
      return;
    }
    await loadCore();
    if (activeTab === "products") await loadProducts();
    if (activeTab === "repairs") await loadRepairs();
    if (activeTab === "spares") await loadSpares();
    if (activeTab === "assets") await loadAssets();
    if (activeTab === "queue") await loadQueue();
    if (activeTab === "history") await loadHistory();
  }, [activeTab, labelsApiAvailable, loadAssets, loadCore, loadHistory, loadProducts, loadQueue, loadRepairs, loadSpares]);

  const toggleSelection = (list, setter, id) => {
    setter(list.includes(id) ? list.filter((value) => value !== id) : [...list, id]);
  };

  const applySelectAll = (rows, list, setter) => {
    const ids = rows.map((row) => row.id);
    const allSelected = ids.length > 0 && ids.every((id) => list.includes(id));
    if (allSelected) setter(list.filter((id) => !ids.includes(id)));
    else setter(Array.from(new Set([...list, ...ids])));
  };

  const resolveTemplateForScope = (scope) => {
    const selectedId = selectedTemplateByScope[scope];
    const bySelected = templates.find((row) => row.id === selectedId);
    if (bySelected) return bySelected;
    return defaultTemplatesByScope[scope] || null;
  };

  const enqueueItems = useCallback(
    async (items) => {
      if (!items.length) {
        toast("Select at least one record before adding to print queue", "warning");
        return;
      }
      try {
        setBusy(true);
        await api.post("/labels/queue", { items });
        toast(`${items.length} label jobs added to queue`, "success");
        await Promise.all([loadQueue(), loadCore()]);
      } catch (error) {
        toast(error.response?.data?.detail || "Failed to add print jobs", "error");
      } finally {
        setBusy(false);
      }
    },
    [loadCore, loadQueue, toast],
  );

  const buildQueueItemsForTab = (tabKey) => {
    const scope = LABEL_TYPE_BY_TAB[tabKey];
    const entityType = ENTITY_BY_TAB[tabKey];
    const template = resolveTemplateForScope(scope);
    if (!scope || !entityType || !template) return [];

    if (tabKey === "products") {
      return products
        .filter((row) => selectedProducts.includes(row.id))
        .map((row) => {
          const countByMode = batchMode === "stock_count" ? Math.max(1, Number(row.quantity || 1)) : 1;
          const qty = Math.max(1, Number(printQty[row.id] || countByMode)) * Math.max(1, Number(printSettings.copies || 1));
          return {
            label_type: scope,
            entity_type: entityType,
            entity_id: row.id,
            entity_ref: row.sku,
            item_name: row.name,
            qty,
            template_id: template.id,
            template_name: template.name,
            barcode_format: printSettings.barcode_format,
            printer_name: printSettings.printer_name,
            paper_type: printSettings.paper_type,
            print_quality: printSettings.print_quality,
            orientation: printSettings.orientation,
            metadata: buildPreviewData("products", row, meta),
          };
        });
    }

    if (tabKey === "repairs") {
      return repairs
        .filter((row) => selectedRepairs.includes(row.id))
        .map((row) => ({
          label_type: scope,
          entity_type: entityType,
          entity_id: row.id,
          entity_ref: row.job_id,
          item_name: row.device_model,
          qty: Math.max(1, Number(printQty[row.id] || 1)) * Math.max(1, Number(printSettings.copies || 1)),
          template_id: template.id,
          template_name: template.name,
          barcode_format: printSettings.barcode_format,
          printer_name: printSettings.printer_name,
          paper_type: printSettings.paper_type,
          print_quality: printSettings.print_quality,
          orientation: printSettings.orientation,
          metadata: buildPreviewData("repairs", row, meta),
        }));
    }

    if (tabKey === "spares") {
      return spares
        .filter((row) => selectedSpares.includes(row.id))
        .map((row) => ({
          label_type: scope,
          entity_type: entityType,
          entity_id: row.id,
          entity_ref: row.sku,
          item_name: row.part_name,
          qty: Math.max(1, Number(printQty[row.id] || 1)) * Math.max(1, Number(printSettings.copies || 1)),
          template_id: template.id,
          template_name: template.name,
          barcode_format: printSettings.barcode_format,
          printer_name: printSettings.printer_name,
          paper_type: printSettings.paper_type,
          print_quality: printSettings.print_quality,
          orientation: printSettings.orientation,
          metadata: buildPreviewData("spares", row, meta),
        }));
    }

    if (tabKey === "assets") {
      return assets
        .filter((row) => selectedAssets.includes(row.id))
        .map((row) => ({
          label_type: scope,
          entity_type: entityType,
          entity_id: row.id,
          entity_ref: row.asset_code,
          item_name: row.asset_name,
          qty: Math.max(1, Number(printQty[row.id] || 1)) * Math.max(1, Number(printSettings.copies || 1)),
          template_id: template.id,
          template_name: template.name,
          barcode_format: printSettings.barcode_format,
          printer_name: printSettings.printer_name,
          paper_type: printSettings.paper_type,
          print_quality: printSettings.print_quality,
          orientation: printSettings.orientation,
          metadata: buildPreviewData("assets", row, meta),
        }));
    }

    return [];
  };

  const addCurrentSelectionToQueue = async (tabKey) => {
    const items = buildQueueItemsForTab(tabKey);
    await enqueueItems(items);
  };

  const createAsset = async () => {
    if (!assetForm.asset_name.trim()) {
      toast("Asset name is required", "warning");
      return;
    }
    try {
      setBusy(true);
      await api.post("/labels/assets", {
        ...assetForm,
        purchase_date: assetForm.purchase_date || null,
        warranty_expiry_date: assetForm.warranty_expiry_date || null,
        maintenance_due_date: assetForm.maintenance_due_date || null,
      });
      toast("Asset created", "success");
      setAssetForm({
        asset_name: "",
        asset_type: "Tool",
        department: "",
        location: "",
        purchase_date: "",
        warranty_expiry_date: "",
        assigned_to: "",
        maintenance_due_date: "",
        barcode_value: "",
        qr_value: "",
        status: "Active",
      });
      await Promise.all([loadAssets(), loadCore()]);
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to create asset", "error");
    } finally {
      setBusy(false);
    }
  };

  const updateQueueStatus = async (row, status) => {
    try {
      setBusy(true);
      await api.put(`/labels/queue/${row.id}/status`, { status });
      await Promise.all([loadQueue(), loadCore()]);
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to update queue item", "error");
    } finally {
      setBusy(false);
    }
  };

  const printNow = async (row) => {
    try {
      setBusy(true);
      await api.post(`/labels/queue/${row.id}/print-now`, { mark_completed: true });
      toast(`Printed ${row.item_name}`, "success");
      await Promise.all([loadQueue(), loadCore(), loadHistory()]);
    } catch (error) {
      toast(error.response?.data?.detail || "Print action failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const moveQueueItem = async (row, direction) => {
    const rows = [...queueRows];
    const idx = rows.findIndex((r) => r.id === row.id);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= rows.length) return;
    [rows[idx], rows[swapIdx]] = [rows[swapIdx], rows[idx]];
    setQueueRows(rows);
    try {
      await api.post("/labels/queue/reorder", { ordered_job_ids: rows.map((r) => r.id) });
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to reorder queue", "error");
    }
  };

  const clearCompletedQueue = async () => {
    const ok = await confirm("Clear Completed Queue", "Remove all completed and cancelled queue records?");
    if (!ok) return;
    try {
      setBusy(true);
      await api.post("/labels/queue/clear-completed");
      toast("Completed queue rows cleared", "success");
      await Promise.all([loadQueue(), loadCore()]);
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to clear queue", "error");
    } finally {
      setBusy(false);
    }
  };

  const retryFailedQueue = async () => {
    try {
      setBusy(true);
      await api.post("/labels/queue/retry-failed");
      toast("Failed jobs moved back to waiting", "success");
      await Promise.all([loadQueue(), loadCore()]);
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to retry queue", "error");
    } finally {
      setBusy(false);
    }
  };

  const performScan = async (input = scanInput) => {
    const value = String(input || "").trim();
    if (!value) {
      toast("Enter or scan a barcode value first", "warning");
      return;
    }
    try {
      setBusy(true);
      const res = await api.post("/labels/scanner/scan", {
        value,
        scan_mode: scanMode,
      });
      const payload = res.data || null;
      setScanResult(payload);
      setPreviewTabSource((prev) => {
        const type = payload?.data?.item_type;
        if (type === "Product") {
          return { tab: "products", row: { ...payload.data, name: payload.data.name, sale_price: payload.data.price } };
        }
        if (type === "Part") {
          return { tab: "spares", row: { ...payload.data, part_name: payload.data.name, cost_price: payload.data.price } };
        }
        if (type === "Repair Job") {
          return { tab: "repairs", row: { ...payload.data, job_id: payload.data.job_id, device_model: payload.data.device } };
        }
        if (type === "Asset") {
          return { tab: "assets", row: { ...payload.data, asset_name: payload.data.name, asset_code: payload.data.asset_code } };
        }
        return prev;
      });
      if (multiScanMode && payload?.data) {
        setMultiScanRows((prev) => {
          const merged = [payload.data, ...prev];
          return merged.slice(0, 200);
        });
      }
      setScanInput("");
      await loadCore();
      await loadHistory();
      await loadQueue();
    } catch (error) {
      toast(error.response?.data?.detail || "Scan failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const enqueueMultiScans = async () => {
    const groupedItems = [];
    const productTemplate = resolveTemplateForScope("Product");
    const repairTemplate = resolveTemplateForScope("Repair Job");
    const spareTemplate = resolveTemplateForScope("Spare Part");
    const assetTemplate = resolveTemplateForScope("Asset");
    for (const row of multiScanRows) {
      if (row.item_type === "Product" && productTemplate) {
        groupedItems.push({
          label_type: "Product",
          entity_type: "inventory_item",
          entity_id: row.id,
          entity_ref: row.sku,
          item_name: row.name,
          qty: 1,
          template_id: productTemplate.id,
          template_name: productTemplate.name,
          printer_name: printSettings.printer_name,
          paper_type: printSettings.paper_type,
          print_quality: printSettings.print_quality,
          orientation: printSettings.orientation,
          metadata: buildPreviewData("products", { ...row, sale_price: row.price }, meta),
        });
      }
      if (row.item_type === "Part" && spareTemplate) {
        groupedItems.push({
          label_type: "Spare Part",
          entity_type: "inventory_item",
          entity_id: row.id,
          entity_ref: row.sku,
          item_name: row.name,
          qty: 1,
          template_id: spareTemplate.id,
          template_name: spareTemplate.name,
          printer_name: printSettings.printer_name,
          paper_type: printSettings.paper_type,
          print_quality: printSettings.print_quality,
          orientation: printSettings.orientation,
          metadata: buildPreviewData("spares", { ...row, part_name: row.name, cost_price: row.price }, meta),
        });
      }
      if (row.item_type === "Repair Job" && repairTemplate) {
        groupedItems.push({
          label_type: "Repair Job",
          entity_type: "repair_ticket",
          entity_id: row.id,
          entity_ref: row.job_id,
          item_name: row.device,
          qty: 1,
          template_id: repairTemplate.id,
          template_name: repairTemplate.name,
          printer_name: printSettings.printer_name,
          paper_type: printSettings.paper_type,
          print_quality: printSettings.print_quality,
          orientation: printSettings.orientation,
          metadata: buildPreviewData("repairs", { ...row, device_model: row.device }, meta),
        });
      }
      if (row.item_type === "Asset" && assetTemplate) {
        groupedItems.push({
          label_type: "Asset",
          entity_type: "asset",
          entity_id: row.id,
          entity_ref: row.asset_code,
          item_name: row.name,
          qty: 1,
          template_id: assetTemplate.id,
          template_name: assetTemplate.name,
          printer_name: printSettings.printer_name,
          paper_type: printSettings.paper_type,
          print_quality: printSettings.print_quality,
          orientation: printSettings.orientation,
          metadata: buildPreviewData("assets", { ...row, asset_name: row.name }, meta),
        });
      }
    }
    await enqueueItems(groupedItems);
  };

  const saveTemplate = async () => {
    if (!designerDraft?.name?.trim()) {
      toast("Template name is required", "warning");
      return;
    }
    try {
      setBusy(true);
      const payload = {
        name: designerDraft.name,
        label_scope: designerDraft.label_scope || "Product",
        width_mm: Number(designerDraft.width_mm || 50),
        height_mm: Number(designerDraft.height_mm || 30),
        canvas: designerDraft.canvas || {},
        is_default: Boolean(designerDraft.is_default),
        is_active: Boolean(designerDraft.is_active ?? true),
      };
      if (designerDraft.id) {
        await api.put(`/labels/templates/${designerDraft.id}`, payload);
      } else {
        await api.post("/labels/templates", payload);
      }
      toast("Template saved", "success");
      await loadCore();
      const reloaded = await api.get("/labels/templates");
      setTemplates(Array.isArray(reloaded.data) ? reloaded.data : []);
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to save template", "error");
    } finally {
      setBusy(false);
    }
  };

  const duplicateTemplate = async () => {
    if (!designerDraft?.id) {
      toast("Save template first before duplicating", "warning");
      return;
    }
    const suffix = new Date().toISOString().slice(11, 19).replace(/:/g, "");
    const name = `${designerDraft.name} Copy ${suffix}`;
    try {
      setBusy(true);
      const res = await api.post(`/labels/templates/${designerDraft.id}/duplicate`, { name });
      setDesignerDraft(clone(res.data));
      toast("Template duplicated", "success");
      await loadCore();
    } catch (error) {
      toast(error.response?.data?.detail || "Template duplication failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const deleteTemplate = async () => {
    if (!designerDraft?.id) return;
    const ok = await confirm("Delete Template", "Delete this custom template permanently?");
    if (!ok) return;
    try {
      setBusy(true);
      await api.delete(`/labels/templates/${designerDraft.id}`);
      toast("Template deleted", "success");
      setDesignerDraft(null);
      await loadCore();
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to delete template", "error");
    } finally {
      setBusy(false);
    }
  };

  const addDesignerElement = (type) => {
    if (!designerDraft) return;
    const canvas = designerDraft.canvas || {};
    const elements = Array.isArray(canvas.elements) ? [...canvas.elements] : [];
    const nextId = `${type}_${Date.now()}`;
    elements.push({
      id: nextId,
      type,
      x: 3,
      y: 3 + elements.length * 3,
      w: type === "qrcode" ? 12 : type === "barcode" ? 40 : 30,
      h: type === "qrcode" ? 12 : type === "barcode" ? 9 : type === "line" ? 2 : 5,
      fontSize: 9,
      bold: type === "price",
      value: type === "price" ? "LKR {{price}}" : type === "barcode" ? "{{barcode}}" : type === "qrcode" ? "{{barcode}}" : "{{product_name}}",
      color: "#0f172a",
      align: "left",
    });
    setDesignerDraft({ ...designerDraft, canvas: { ...canvas, elements } });
    setDesignerSelectedElementId(nextId);
  };

  const updateDesignerElement = (id, field, value) => {
    if (!designerDraft) return;
    const canvas = designerDraft.canvas || {};
    const elements = (canvas.elements || []).map((el) => (el.id === id ? { ...el, [field]: value } : el));
    setDesignerDraft({ ...designerDraft, canvas: { ...canvas, elements } });
  };

  const removeDesignerElement = (id) => {
    if (!designerDraft) return;
    const canvas = designerDraft.canvas || {};
    const elements = (canvas.elements || []).filter((el) => el.id !== id);
    setDesignerDraft({ ...designerDraft, canvas: { ...canvas, elements } });
    setDesignerSelectedElementId(null);
  };

  useEffect(() => {
    if (!designerDrag || !designerDraft) return undefined;
    const handleMove = (event) => {
      if (!designerPreviewRef.current) return;
      const rect = designerPreviewRef.current.getBoundingClientRect();
      const scale = Math.max(0.1, (designerZoom / 100) * 3);
      const x = Math.max(0, (event.clientX - rect.left - designerDrag.offsetX) / scale);
      const y = Math.max(0, (event.clientY - rect.top - designerDrag.offsetY) / scale);
      updateDesignerElement(designerDrag.id, "x", Math.round(x * 10) / 10);
      updateDesignerElement(designerDrag.id, "y", Math.round(y * 10) / 10);
    };
    const handleUp = () => setDesignerDrag(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [designerDrag, designerDraft, designerZoom]);

  const onDesignerPointerDown = (event, elementId) => {
    if (!designerDraft || !designerPreviewRef.current) return;
    const scale = Math.max(0.1, (designerZoom / 100) * 3);
    const element = (designerDraft.canvas?.elements || []).find((row) => row.id === elementId);
    if (!element) return;
    const rect = designerPreviewRef.current.getBoundingClientRect();
    const x = Number(element.x || 0) * scale;
    const y = Number(element.y || 0) * scale;
    setDesignerSelectedElementId(elementId);
    setDesignerDrag({
      id: elementId,
      offsetX: event.clientX - rect.left - x,
      offsetY: event.clientY - rect.top - y,
    });
  };

  const exportTemplateJson = () => {
    if (!designerDraft) return;
    const content = JSON.stringify({ template: designerDraft }, null, 2);
    const blob = new Blob([content], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${designerDraft.name || "label-template"}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importTemplateJson = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const incoming = parsed?.template || parsed;
      if (!incoming?.name || !incoming?.label_scope) {
        toast("Template JSON is invalid", "error");
        return;
      }
      setDesignerDraft({
        ...incoming,
        id: null,
        name: `${incoming.name} Imported`,
      });
      toast("Template imported into designer", "success");
    } catch {
      toast("Failed to parse template JSON", "error");
    } finally {
      event.target.value = "";
    }
  };

  const exportPreviewPng = () => {
    if (!previewTemplate) {
      toast("No template selected for preview export", "warning");
      return;
    }
    const canvas = renderLabelToCanvas(previewTemplate, previewData);
    if (!canvas) {
      toast("Unable to render preview canvas", "error");
      return;
    }
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(previewTemplate.name || "label").replace(/\s+/g, "_")}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const printPreview = async () => {
    if (!previewTemplate) {
      toast("No template selected for print preview", "warning");
      return;
    }
    const canvas = renderLabelToCanvas(previewTemplate, previewData);
    if (!canvas) {
      toast("Unable to render label preview", "error");
      return;
    }
    const dataUrl = canvas.toDataURL("image/png");
    const width = Number(previewTemplate.width_mm || 50);
    const height = Number(previewTemplate.height_mm || 30);
    const title = escapeHtml(previewTemplate.name || "Label");
    const html = `
      <html>
        <head>
          <title>${title}</title>
          <style>
            @page { size: ${width}mm ${height}mm; margin: 0; }
            body { margin: 0; padding: 0; display:flex; align-items:center; justify-content:center; background:#fff; }
            .label { width:${width}mm; height:${height}mm; display:flex; align-items:center; justify-content:center; }
            img { width:${width}mm; height:${height}mm; object-fit:contain; }
          </style>
        </head>
        <body>
          <div class="label"><img src="${dataUrl}" alt="label" /></div>
        </body>
      </html>
    `;
    try {
      await printHtmlDocument(html, { silent: false, printerName: printSettings.printer_name || "" });
    } catch (error) {
      toast(error.message || "Label print failed", "error");
    }
  };

  const exportHistoryCsv = () => {
    const rows = historyState?.rows || [];
    const size = downloadCsv("label-history.csv", HISTORY_COLUMNS, rows);
    toast(`Label history CSV exported (${Math.max(1, Math.round(size / 1024))} KB)`, "success");
  };

  const printHistoryView = () => {
    openPrintView("Label History", HISTORY_COLUMNS, historyState?.rows || []);
  };

  const reprintFromHistory = async (row) => {
    try {
      setBusy(true);
      await api.post(`/labels/history/${row.id}/reprint`, {
        qty: row.qty || 1,
        printer_name: printSettings.printer_name || row.printer_name || null,
        reason: "History reprint",
      });
      toast("Reprint added to queue", "success");
      await Promise.all([loadQueue(), loadHistory(), loadCore()]);
    } catch (error) {
      toast(error.response?.data?.detail || "Failed to reprint item", "error");
    } finally {
      setBusy(false);
    }
  };

  if (loading && !meta) {
    return <div className="h-full min-h-0 grid place-items-center text-slate-400">Loading labels module...</div>;
  }

  if (!labelsApiAvailable) {
    return (
      <div className="h-full min-h-0 p-4">
        <SectionCard title="Labels Module Unavailable">
          <div className="space-y-2 text-sm text-slate-300">
            <p>The current backend process does not expose `/labels/*` routes (HTTP 404).</p>
            <p>Restart backend with the latest code and refresh this page.</p>
            <p className="text-xs text-slate-500">Expected endpoints include `/labels/meta`, `/labels/dashboard`, `/labels/templates`, `/labels/queue`, and `/labels/history`.</p>
            <div className="pt-2">
              <Button size="sm" onClick={loadCore}>
                <RefreshCw size={13} /> Retry Labels API
              </Button>
            </div>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 pb-3">
      <section className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
              <Barcode className="text-sky-400" /> Labels &amp; Barcodes
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Offline label control center for products, repairs, spare parts, assets, queueing, scanning, and print history.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={refreshAll} disabled={busy}>
              <RefreshCw size={13} /> Refresh
            </Button>
            <Link
              to="/print-center?type=barcode_sheet&paper=label_50x30&template=label"
              className="btn-secondary inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-bold"
            >
              <Printer size={13} /> Print Center
            </Link>
            <Button size="sm" onClick={printPreview} disabled={!previewTemplate}>
              <Printer size={13} /> Print
            </Button>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <TabButton
            key={tab.key}
            active={activeTab === tab.key}
            label={tab.label}
            icon={tab.icon}
            onClick={() => setActiveTab(tab.key)}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 min-h-0 flex-1">
        <div className="xl:col-span-8 min-h-0 overflow-auto custom-scrollbar pr-1 space-y-3">
          {activeTab === "dashboard" && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <KpiCard title="Labels Printed Today" value={String(dashboard?.kpis?.labels_printed_today || 0)} icon={<Printer size={16} />} />
                <KpiCard title="Printed This Month" value={String(dashboard?.kpis?.labels_printed_month || 0)} icon={<Tags size={16} />} tone="indigo" />
                <KpiCard title="Products Without Labels" value={String(dashboard?.kpis?.products_without_labels || 0)} icon={<Package size={16} />} tone="amber" />
                <KpiCard title="Repair Jobs Without Labels" value={String(dashboard?.kpis?.repair_jobs_without_labels || 0)} icon={<Wrench size={16} />} tone="amber" />
                <KpiCard title="Spare Parts Without Labels" value={String(dashboard?.kpis?.spare_parts_without_labels || 0)} icon={<Truck size={16} />} tone="amber" />
                <KpiCard title="Printer Status" value={dashboard?.kpis?.printer_status || "Offline"} icon={<Settings2 size={16} />} tone={pickTone(dashboard?.kpis?.printer_status)} />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                <SectionCard title="Quick Actions">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button className="rounded-xl border border-white/10 bg-white/5 p-3 text-left hover:bg-white/10" onClick={() => setActiveTab("products")}>
                      <p className="text-xs font-black uppercase tracking-widest text-sky-300">Print Product Label</p>
                      <p className="text-sm text-slate-300 mt-1">Single or batch mode with stock-aware quantities.</p>
                    </button>
                    <button className="rounded-xl border border-white/10 bg-white/5 p-3 text-left hover:bg-white/10" onClick={() => setActiveTab("repairs")}>
                      <p className="text-xs font-black uppercase tracking-widest text-indigo-300">Print Repair Labels</p>
                      <p className="text-sm text-slate-300 mt-1">Job stickers and bag labels for current repair flow.</p>
                    </button>
                    <button className="rounded-xl border border-white/10 bg-white/5 p-3 text-left hover:bg-white/10" onClick={() => setActiveTab("queue")}>
                      <p className="text-xs font-black uppercase tracking-widest text-emerald-300">Batch Queue</p>
                      <p className="text-sm text-slate-300 mt-1">Queue low stock and new-arrival labels safely.</p>
                    </button>
                    <button className="rounded-xl border border-white/10 bg-white/5 p-3 text-left hover:bg-white/10" onClick={() => setActiveTab("scanner")}>
                      <p className="text-xs font-black uppercase tracking-widest text-amber-300">Scan Barcode</p>
                      <p className="text-sm text-slate-300 mt-1">Instant lookup and one-click label reprint workflow.</p>
                    </button>
                  </div>
                  <div className="mt-3 rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-slate-300">
                    <p className="font-bold text-slate-100">Quick Batch Suggestions</p>
                    <p className="mt-1">Low stock items: <span className="font-bold">{dashboard?.quick_batches?.low_stock_items || 0}</span></p>
                    <p>New arrivals today: <span className="font-bold">{dashboard?.quick_batches?.new_arrivals_today || 0}</span></p>
                    <p>All unlabelled products: <span className="font-bold">{dashboard?.quick_batches?.all_unlabelled_products || 0}</span></p>
                  </div>
                </SectionCard>

                <SectionCard title="Alerts">
                  <div className="space-y-2">
                    {(dashboard?.alerts || []).length === 0 && (
                      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                        No label alerts at the moment.
                      </div>
                    )}
                    {(dashboard?.alerts || []).map((row, index) => (
                      <div
                        key={`alert-${index}`}
                        className={`rounded-lg border px-3 py-2 text-sm ${
                          row.severity === "warning"
                            ? "border-amber-400/40 bg-amber-500/15 text-amber-100"
                            : "border-sky-400/40 bg-sky-500/10 text-sky-100"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <AlertTriangle size={14} />
                          <span>{row.text}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              </div>

              <SectionCard title="Recent Print Jobs">
                <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
                  <Table>
                    <thead>
                      <tr>
                        <th>Date &amp; Time</th>
                        <th>Label Type</th>
                        <th>Product / Job</th>
                        <th>Qty</th>
                        <th>Printed By</th>
                        <th>Template</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(dashboard?.recent_print_jobs || []).length === 0 && (
                        <tr>
                          <td colSpan={8} className="py-5 text-center text-slate-500">
                            No print jobs yet.
                          </td>
                        </tr>
                      )}
                      {(dashboard?.recent_print_jobs || []).map((row) => (
                        <tr key={row.id}>
                          <td>{toDateTime(row.created_at)}</td>
                          <td>{row.label_type}</td>
                          <td>{row.item_name}</td>
                          <td>{row.qty}</td>
                          <td>{row.generated_by || "-"}</td>
                          <td>{row.template_name || "-"}</td>
                          <td><ToneBadge value={row.status} /></td>
                          <td>
                            <Button size="sm" variant="ghost" onClick={() => reprintFromHistory(row)}>
                              Reprint
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </SectionCard>
            </>
          )}

          {activeTab === "products" && (
            <>
              <SectionCard title="Product Selector" subtitle="Search, filter, and multi-select products for batch label printing">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-2 mb-3">
                  <input className="field !py-2 !px-3 !text-xs xl:col-span-2" value={productFilters.q} onChange={(e) => setProductFilters((p) => ({ ...p, q: e.target.value }))} placeholder="Search name / SKU / barcode" />
                  <Select className="field !py-2 !px-3 !text-xs" value={productFilters.category} onChange={(e) => setProductFilters((p) => ({ ...p, category: e.target.value }))}>
                    <option value="all">Category</option>
                    {(meta?.categories || []).map((row) => <option key={row} value={row}>{row}</option>)}
                  </Select>
                  <Select className="field !py-2 !px-3 !text-xs" value={productFilters.brand} onChange={(e) => setProductFilters((p) => ({ ...p, brand: e.target.value }))}>
                    <option value="all">Brand</option>
                    {(meta?.brands || []).map((row) => <option key={row} value={row}>{row}</option>)}
                  </Select>
                  <Select className="field !py-2 !px-3 !text-xs" value={productFilters.supplier_id} onChange={(e) => setProductFilters((p) => ({ ...p, supplier_id: e.target.value }))}>
                    <option value="all">Supplier</option>
                    {(meta?.suppliers || []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                  </Select>
                  <Select className="field !py-2 !px-3 !text-xs" value={productFilters.stock_status} onChange={(e) => setProductFilters((p) => ({ ...p, stock_status: e.target.value }))}>
                    <option value="all">Stock Status</option>
                    <option value="in_stock">In Stock</option>
                    <option value="low">Low</option>
                    <option value="out_of_stock">Out of Stock</option>
                  </Select>
                </div>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={productFilters.unlabelled_only} onChange={(e) => setProductFilters((p) => ({ ...p, unlabelled_only: e.target.checked }))} />
                    Unlabelled only
                  </label>
                  <Button size="sm" variant="secondary" onClick={loadProducts}><Filter size={13} /> Apply</Button>
                  <Button size="sm" onClick={() => addCurrentSelectionToQueue("products")} disabled={busy}><Plus size={13} /> Add Selected To Queue</Button>
                  <Button size="sm" variant="ghost" onClick={() => applySelectAll(products, selectedProducts, setSelectedProducts)}>Select All Filtered</Button>
                  <Select className="field !py-1.5 !px-2 !text-xs max-w-[180px]" value={batchMode} onChange={(e) => setBatchMode(e.target.value)}>
                    <option value="one_per_product">Print 1 per product</option>
                    <option value="stock_count">Print matching stock count</option>
                  </Select>
                </div>

                <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
                  <Table>
                    <thead>
                      <tr>
                        <th>Pick</th>
                        <th>Product</th>
                        <th>SKU</th>
                        <th>Barcode</th>
                        <th>Category</th>
                        <th>Brand</th>
                        <th>Price</th>
                        <th>Stock</th>
                        <th>Print Qty</th>
                        <th>Status</th>
                        <th>Label</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.length === 0 && (
                        <tr><td colSpan={11} className="py-5 text-center text-slate-500">No product rows found.</td></tr>
                      )}
                      {products.map((row) => (
                        <tr key={row.id} onClick={() => setPreviewTabSource({ tab: "products", row })} className="cursor-pointer">
                          <td><input type="checkbox" checked={selectedProducts.includes(row.id)} onChange={() => toggleSelection(selectedProducts, setSelectedProducts, row.id)} onClick={(e) => e.stopPropagation()} /></td>
                          <td>{row.name}</td>
                          <td className="font-mono text-xs">{row.sku}</td>
                          <td className="font-mono text-xs">{row.barcode || "-"}</td>
                          <td>{row.category || "-"}</td>
                          <td>{row.brand || "-"}</td>
                          <td>{money(row.sale_price)}</td>
                          <td>{row.quantity}</td>
                          <td>
                            <input
                              type="number"
                              min={1}
                              className="field !py-1 !px-2 !text-xs max-w-[90px]"
                              value={printQty[row.id] ?? (batchMode === "stock_count" ? Math.max(1, Number(row.quantity || 1)) : 1)}
                              onChange={(e) => setPrintQty((prev) => ({ ...prev, [row.id]: Number(e.target.value || 1) }))}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                          <td><ToneBadge value={row.stock_status} /></td>
                          <td>{row.has_label_printed ? <Badge tone="green">Printed</Badge> : <Badge tone="amber">Unlabelled</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </SectionCard>
            </>
          )}

          {activeTab === "repairs" && (
            <SectionCard title="Repair Job Labels" subtitle="Print job labels for device tracking, bag tags, and collection verification">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2 mb-3">
                <input className="field !py-2 !px-3 !text-xs xl:col-span-2" value={repairFilters.q} onChange={(e) => setRepairFilters((p) => ({ ...p, q: e.target.value }))} placeholder="Job ID / customer / device / IMEI" />
                <Select className="field !py-2 !px-3 !text-xs" value={repairFilters.technician} onChange={(e) => setRepairFilters((p) => ({ ...p, technician: e.target.value }))}>
                  <option value="all">Technician</option>
                  {(meta?.technicians || []).map((row) => <option key={row} value={row}>{row}</option>)}
                </Select>
                <Select className="field !py-2 !px-3 !text-xs" value={repairFilters.status} onChange={(e) => setRepairFilters((p) => ({ ...p, status: e.target.value }))}>
                  <option value="all">Status</option>
                  <option value="Pending">Pending</option>
                  <option value="Diagnosing">Diagnosing</option>
                  <option value="Repairing">Repairing</option>
                  <option value="Completed">Completed</option>
                  <option value="Delivered">Delivered</option>
                </Select>
                <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                  <input type="checkbox" checked={repairFilters.unlabelled_only} onChange={(e) => setRepairFilters((p) => ({ ...p, unlabelled_only: e.target.checked }))} />
                  Unlabelled only
                </label>
              </div>
              <div className="mb-3 flex gap-2">
                <Button size="sm" variant="secondary" onClick={loadRepairs}><Filter size={13} /> Apply</Button>
                <Button size="sm" onClick={() => addCurrentSelectionToQueue("repairs")}><Plus size={13} /> Add Selected To Queue</Button>
                <Button size="sm" variant="ghost" onClick={() => applySelectAll(repairs, selectedRepairs, setSelectedRepairs)}>Select All Filtered</Button>
              </div>

              <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
                <Table>
                  <thead>
                    <tr>
                      <th>Pick</th>
                      <th>Job ID</th>
                      <th>Customer</th>
                      <th>Device</th>
                      <th>IMEI / Serial</th>
                      <th>Technician</th>
                      <th>Status</th>
                      <th>Received</th>
                      <th>ETA</th>
                      <th>Label</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repairs.length === 0 && (
                      <tr><td colSpan={10} className="py-5 text-center text-slate-500">No repair jobs found.</td></tr>
                    )}
                    {repairs.map((row) => (
                      <tr key={row.id} onClick={() => setPreviewTabSource({ tab: "repairs", row })} className="cursor-pointer">
                        <td><input type="checkbox" checked={selectedRepairs.includes(row.id)} onChange={() => toggleSelection(selectedRepairs, setSelectedRepairs, row.id)} onClick={(e) => e.stopPropagation()} /></td>
                        <td className="font-mono text-xs font-bold">{row.job_id}</td>
                        <td>{row.customer_name}</td>
                        <td>{row.device_model}</td>
                        <td className="font-mono text-xs">{row.imei || "-"}</td>
                        <td>{row.technician || "-"}</td>
                        <td><ToneBadge value={row.status} /></td>
                        <td>{toDate(row.received_at)}</td>
                        <td>{toDate(row.estimated_completion)}</td>
                        <td>{row.has_label_printed ? <Badge tone="green">Printed</Badge> : <Badge tone="amber">Unlabelled</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </SectionCard>
          )}

          {activeTab === "spares" && (
            <SectionCard title="Spare Part Labels" subtitle="Label repair inventory parts, bins, and storage locations">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2 mb-3">
                <input className="field !py-2 !px-3 !text-xs xl:col-span-2" value={spareFilters.q} onChange={(e) => setSpareFilters((p) => ({ ...p, q: e.target.value }))} placeholder="Part name / code / barcode / model" />
                <Select className="field !py-2 !px-3 !text-xs" value={spareFilters.category} onChange={(e) => setSpareFilters((p) => ({ ...p, category: e.target.value }))}>
                  <option value="all">Category</option>
                  {(meta?.categories || []).map((row) => <option key={row} value={row}>{row}</option>)}
                </Select>
                <Select className="field !py-2 !px-3 !text-xs" value={spareFilters.brand} onChange={(e) => setSpareFilters((p) => ({ ...p, brand: e.target.value }))}>
                  <option value="all">Brand</option>
                  {(meta?.brands || []).map((row) => <option key={row} value={row}>{row}</option>)}
                </Select>
                <Select className="field !py-2 !px-3 !text-xs" value={spareFilters.supplier_id} onChange={(e) => setSpareFilters((p) => ({ ...p, supplier_id: e.target.value }))}>
                  <option value="all">Supplier</option>
                  {(meta?.suppliers || []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </Select>
              </div>
              <div className="mb-3 flex gap-2 items-center">
                <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                  <input type="checkbox" checked={spareFilters.unlabelled_only} onChange={(e) => setSpareFilters((p) => ({ ...p, unlabelled_only: e.target.checked }))} />
                  Unlabelled only
                </label>
                <Button size="sm" variant="secondary" onClick={loadSpares}><Filter size={13} /> Apply</Button>
                <Button size="sm" onClick={() => addCurrentSelectionToQueue("spares")}><Plus size={13} /> Add Selected To Queue</Button>
                <Button size="sm" variant="ghost" onClick={() => applySelectAll(spares, selectedSpares, setSelectedSpares)}>Select All Filtered</Button>
              </div>

              <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
                <Table>
                  <thead>
                    <tr>
                      <th>Pick</th>
                      <th>Part</th>
                      <th>SKU</th>
                      <th>Barcode</th>
                      <th>Compatible Models</th>
                      <th>Supplier</th>
                      <th>Location</th>
                      <th>Qty</th>
                      <th>Condition</th>
                      <th>Label</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spares.length === 0 && (
                      <tr><td colSpan={10} className="py-5 text-center text-slate-500">No spare parts found.</td></tr>
                    )}
                    {spares.map((row) => (
                      <tr key={row.id} onClick={() => setPreviewTabSource({ tab: "spares", row })} className="cursor-pointer">
                        <td><input type="checkbox" checked={selectedSpares.includes(row.id)} onChange={() => toggleSelection(selectedSpares, setSelectedSpares, row.id)} onClick={(e) => e.stopPropagation()} /></td>
                        <td>{row.part_name}</td>
                        <td className="font-mono text-xs">{row.sku}</td>
                        <td className="font-mono text-xs">{row.barcode}</td>
                        <td>{row.compatible_models || "-"}</td>
                        <td>{row.supplier_name || "-"}</td>
                        <td>{row.location || "-"}</td>
                        <td>{row.quantity}</td>
                        <td>{row.condition}</td>
                        <td>{row.has_label_printed ? <Badge tone="green">Printed</Badge> : <Badge tone="amber">Unlabelled</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </SectionCard>
          )}

          {activeTab === "assets" && (
            <>
              <SectionCard title="Asset Labels" subtitle="Track equipment, tools, and fixed assets with barcode labels">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-2 mb-3">
                  <input className="field !py-2 !px-3 !text-xs xl:col-span-2" value={assetFilters.q} onChange={(e) => setAssetFilters((p) => ({ ...p, q: e.target.value }))} placeholder="Asset name / asset code / barcode / location" />
                  <input className="field !py-2 !px-3 !text-xs" value={assetFilters.asset_type} onChange={(e) => setAssetFilters((p) => ({ ...p, asset_type: e.target.value }))} placeholder="Asset type or all" />
                  <Select className="field !py-2 !px-3 !text-xs" value={assetFilters.status} onChange={(e) => setAssetFilters((p) => ({ ...p, status: e.target.value }))}>
                    <option value="all">Status</option>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                    <option value="Retired">Retired</option>
                  </Select>
                  <Button size="sm" variant="secondary" onClick={loadAssets}><Filter size={13} /> Apply</Button>
                  <Button size="sm" onClick={() => addCurrentSelectionToQueue("assets")}><Plus size={13} /> Add Selected To Queue</Button>
                </div>
                <div className="mb-3">
                  <Button size="sm" variant="ghost" onClick={() => applySelectAll(assets, selectedAssets, setSelectedAssets)}>
                    Select All Filtered
                  </Button>
                </div>
                <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
                  <Table>
                    <thead>
                      <tr>
                        <th>Pick</th>
                        <th>Asset Code</th>
                        <th>Asset Name</th>
                        <th>Type</th>
                        <th>Location</th>
                        <th>Assigned To</th>
                        <th>Barcode</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assets.length === 0 && (
                        <tr><td colSpan={8} className="py-5 text-center text-slate-500">No asset rows found.</td></tr>
                      )}
                      {assets.map((row) => (
                        <tr key={row.id} onClick={() => setPreviewTabSource({ tab: "assets", row })} className="cursor-pointer">
                          <td><input type="checkbox" checked={selectedAssets.includes(row.id)} onChange={() => toggleSelection(selectedAssets, setSelectedAssets, row.id)} onClick={(e) => e.stopPropagation()} /></td>
                          <td className="font-mono text-xs">{row.asset_code}</td>
                          <td>{row.asset_name}</td>
                          <td>{row.asset_type}</td>
                          <td>{row.location || "-"}</td>
                          <td>{row.assigned_to || "-"}</td>
                          <td className="font-mono text-xs">{row.barcode_value}</td>
                          <td><ToneBadge value={row.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </SectionCard>

              <SectionCard title="Add Asset">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
                  <input className="field !py-2 !px-3 !text-xs" placeholder="Asset name" value={assetForm.asset_name} onChange={(e) => setAssetForm((p) => ({ ...p, asset_name: e.target.value }))} />
                  <input className="field !py-2 !px-3 !text-xs" placeholder="Asset type" value={assetForm.asset_type} onChange={(e) => setAssetForm((p) => ({ ...p, asset_type: e.target.value }))} />
                  <input className="field !py-2 !px-3 !text-xs" placeholder="Department" value={assetForm.department} onChange={(e) => setAssetForm((p) => ({ ...p, department: e.target.value }))} />
                  <input className="field !py-2 !px-3 !text-xs" placeholder="Location" value={assetForm.location} onChange={(e) => setAssetForm((p) => ({ ...p, location: e.target.value }))} />
                  <input className="field !py-2 !px-3 !text-xs" placeholder="Assigned to" value={assetForm.assigned_to} onChange={(e) => setAssetForm((p) => ({ ...p, assigned_to: e.target.value }))} />
                  <input className="field !py-2 !px-3 !text-xs" placeholder="Custom barcode (optional)" value={assetForm.barcode_value} onChange={(e) => setAssetForm((p) => ({ ...p, barcode_value: e.target.value }))} />
                  <input className="field !py-2 !px-3 !text-xs" type="date" value={assetForm.purchase_date} onChange={(e) => setAssetForm((p) => ({ ...p, purchase_date: e.target.value }))} />
                  <input className="field !py-2 !px-3 !text-xs" type="date" value={assetForm.warranty_expiry_date} onChange={(e) => setAssetForm((p) => ({ ...p, warranty_expiry_date: e.target.value }))} />
                </div>
                <div className="mt-3">
                  <Button size="sm" onClick={createAsset} disabled={busy}>
                    <Plus size={13} /> Create Asset
                  </Button>
                </div>
              </SectionCard>
            </>
          )}

          {activeTab === "designer" && (
            <>
              <SectionCard title="Template Designer" subtitle="Drag elements directly on the canvas and bind dynamic fields for live barcode labels">
                {!designerDraft && (
                  <div className="text-sm text-slate-400">Select a template to begin designing.</div>
                )}
                {designerDraft && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-2">
                      <input className="field !py-2 !px-3 !text-xs xl:col-span-2" value={designerDraft.name || ""} onChange={(e) => setDesignerDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Template name" />
                      <Select className="field !py-2 !px-3 !text-xs" value={designerDraft.label_scope || "Product"} onChange={(e) => setDesignerDraft((d) => ({ ...d, label_scope: e.target.value }))}>
                        {(meta?.label_scopes || []).map((scope) => <option key={scope} value={scope}>{scope}</option>)}
                      </Select>
                      <input className="field !py-2 !px-3 !text-xs" type="number" min={10} value={designerDraft.width_mm || 50} onChange={(e) => setDesignerDraft((d) => ({ ...d, width_mm: Number(e.target.value || 50) }))} placeholder="Width (mm)" />
                      <input className="field !py-2 !px-3 !text-xs" type="number" min={10} value={designerDraft.height_mm || 30} onChange={(e) => setDesignerDraft((d) => ({ ...d, height_mm: Number(e.target.value || 30) }))} placeholder="Height (mm)" />
                      <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                        <input type="checkbox" checked={Boolean(designerDraft.is_default)} onChange={(e) => setDesignerDraft((d) => ({ ...d, is_default: e.target.checked }))} />
                        Default template
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={saveTemplate} disabled={busy}><Save size={13} /> Save</Button>
                      <Button size="sm" variant="secondary" onClick={duplicateTemplate} disabled={busy}><Copy size={13} /> Duplicate</Button>
                      <Button size="sm" variant="ghost" onClick={exportTemplateJson}><FileJson size={13} /> Export JSON</Button>
                      <label className="btn btn-secondary btn-sm cursor-pointer">
                        <Upload size={13} /> Import JSON
                        <input type="file" accept="application/json" className="hidden" onChange={importTemplateJson} />
                      </label>
                      <Button size="sm" variant="danger" onClick={deleteTemplate} disabled={!designerDraft.id || busy}><Trash2 size={13} /> Delete</Button>
                      <div className="ml-auto flex items-center gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setDesignerZoom((v) => Math.max(60, v - 10))}><ZoomOut size={13} /></Button>
                        <span className="text-xs text-slate-300 min-w-[60px] text-center">{designerZoom}%</span>
                        <Button size="sm" variant="ghost" onClick={() => setDesignerZoom((v) => Math.min(260, v + 10))}><ZoomIn size={13} /></Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
                      {PRESET_ELEMENT_TYPES.map((type) => (
                        <Button key={type} size="sm" variant="ghost" onClick={() => addDesignerElement(type)}>
                          <Plus size={12} /> {type}
                        </Button>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                      <div className="rounded-xl border border-white/10 bg-black/30 p-3 overflow-auto">
                        <div ref={designerPreviewRef} className="inline-block">
                          <LabelPreview
                            template={designerDraft}
                            data={previewData}
                            scale={(designerZoom / 100) * 3}
                            interactive
                            selectedElementId={designerSelectedElementId}
                            onElementPointerDown={onDesignerPointerDown}
                          />
                        </div>
                      </div>

                      <div className="space-y-3">
                        <SectionCard title="Elements">
                          <div className="space-y-2 max-h-[360px] overflow-auto custom-scrollbar pr-1">
                            {(designerDraft.canvas?.elements || []).map((el) => (
                              <div key={el.id} className={`rounded-xl border p-2 ${designerSelectedElementId === el.id ? "border-sky-400/50 bg-sky-500/10" : "border-white/10 bg-black/25"}`}>
                                <div className="flex items-center justify-between gap-2">
                                  <button className="text-left flex-1" onClick={() => setDesignerSelectedElementId(el.id)}>
                                    <p className="text-xs font-bold text-white">{el.type}</p>
                                    <p className="text-[11px] text-slate-400 font-mono">{el.id}</p>
                                  </button>
                                  <Button size="sm" variant="ghost" onClick={() => removeDesignerElement(el.id)}><Trash2 size={12} /></Button>
                                </div>
                                {designerSelectedElementId === el.id && (
                                  <div className="mt-2 grid grid-cols-2 gap-2">
                                    <input className="field !py-1 !px-2 !text-xs col-span-2" value={el.value || ""} onChange={(e) => updateDesignerElement(el.id, "value", e.target.value)} placeholder="Value / binding e.g. {{product_name}}" />
                                    <input className="field !py-1 !px-2 !text-xs" type="number" step="0.1" value={el.x ?? 0} onChange={(e) => updateDesignerElement(el.id, "x", Number(e.target.value || 0))} placeholder="X" />
                                    <input className="field !py-1 !px-2 !text-xs" type="number" step="0.1" value={el.y ?? 0} onChange={(e) => updateDesignerElement(el.id, "y", Number(e.target.value || 0))} placeholder="Y" />
                                    <input className="field !py-1 !px-2 !text-xs" type="number" step="0.1" value={el.w ?? 10} onChange={(e) => updateDesignerElement(el.id, "w", Number(e.target.value || 10))} placeholder="W" />
                                    <input className="field !py-1 !px-2 !text-xs" type="number" step="0.1" value={el.h ?? 5} onChange={(e) => updateDesignerElement(el.id, "h", Number(e.target.value || 5))} placeholder="H" />
                                    <input className="field !py-1 !px-2 !text-xs" type="number" value={el.fontSize ?? 9} onChange={(e) => updateDesignerElement(el.id, "fontSize", Number(e.target.value || 9))} placeholder="Font" />
                                    <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                                      <input type="checkbox" checked={Boolean(el.bold)} onChange={(e) => updateDesignerElement(el.id, "bold", e.target.checked)} />
                                      Bold
                                    </label>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </SectionCard>

                        <SectionCard title="Field Bindings">
                          <div className="grid grid-cols-2 gap-1 text-xs text-slate-300 font-mono">
                            {[
                              "{{product_name}}", "{{sku}}", "{{barcode}}", "{{price}}", "{{mrp}}", "{{discount}}",
                              "{{brand}}", "{{category}}", "{{warranty}}", "{{job_id}}", "{{customer_name}}",
                              "{{technician}}", "{{received_date}}", "{{est_completion}}", "{{shop_name}}", "{{shop_phone}}",
                              "{{date_printed}}",
                            ].map((token) => (
                              <button
                                key={token}
                                className="rounded border border-white/10 bg-white/5 px-2 py-1 text-left hover:bg-white/10"
                                onClick={() => {
                                  if (!designerSelectedElementId) return;
                                  const current = (designerDraft.canvas?.elements || []).find((row) => row.id === designerSelectedElementId);
                                  if (!current) return;
                                  const next = current.value ? `${current.value} ${token}` : token;
                                  updateDesignerElement(current.id, "value", next);
                                }}
                              >
                                {token}
                              </button>
                            ))}
                          </div>
                        </SectionCard>
                      </div>
                    </div>
                  </div>
                )}
              </SectionCard>
            </>
          )}

          {activeTab === "queue" && (
            <>
              <SectionCard title="Print Queue" subtitle="Manage pending, in-progress, failed, and completed jobs with priority controls">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2 mb-3">
                  <Select className="field !py-2 !px-3 !text-xs" value={queueFilters.status} onChange={(e) => setQueueFilters((p) => ({ ...p, status: e.target.value }))}>
                    <option value="all">Status</option>
                    {(meta?.queue_statuses || []).map((row) => <option key={row} value={row}>{row}</option>)}
                  </Select>
                  <Select className="field !py-2 !px-3 !text-xs" value={queueFilters.label_type} onChange={(e) => setQueueFilters((p) => ({ ...p, label_type: e.target.value }))}>
                    <option value="all">Label Type</option>
                    {(meta?.label_scopes || []).map((row) => <option key={row} value={row}>{row}</option>)}
                  </Select>
                  <input className="field !py-2 !px-3 !text-xs xl:col-span-2" value={queueFilters.q} onChange={(e) => setQueueFilters((p) => ({ ...p, q: e.target.value }))} placeholder="Search queue..." />
                  <Button size="sm" variant="secondary" onClick={loadQueue}><Filter size={13} /> Apply</Button>
                </div>
                <div className="mb-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" onClick={retryFailedQueue}><RefreshCw size={13} /> Retry Failed</Button>
                  <Button size="sm" variant="ghost" onClick={clearCompletedQueue}><Trash2 size={13} /> Clear Completed</Button>
                </div>
                <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
                  <Table>
                    <thead>
                      <tr>
                        <th>Queue No</th>
                        <th>Label Type</th>
                        <th>Product / Job</th>
                        <th>Template</th>
                        <th>Qty</th>
                        <th>Added By</th>
                        <th>Added At</th>
                        <th>Printer</th>
                        <th>Status</th>
                        <th>Priority</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queueRows.length === 0 && (
                        <tr><td colSpan={11} className="py-5 text-center text-slate-500">Queue is empty.</td></tr>
                      )}
                      {queueRows.map((row) => (
                        <tr key={row.id} onClick={() => setPreviewTabSource({ tab: row.label_type === "Repair Job" ? "repairs" : row.label_type === "Spare Part" ? "spares" : row.label_type === "Asset" ? "assets" : "products", row: row.metadata || null })} className="cursor-pointer">
                          <td>{row.queue_no}</td>
                          <td>{row.label_type}</td>
                          <td>{row.item_name}</td>
                          <td>{row.template_name || "-"}</td>
                          <td>{row.qty}</td>
                          <td>{row.generated_by || "-"}</td>
                          <td>{toDateTime(row.created_at)}</td>
                          <td>{row.printer_name || "-"}</td>
                          <td><ToneBadge value={row.status} /></td>
                          <td>{row.priority}</td>
                          <td>
                            <div className="flex items-center gap-1">
                              <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); printNow(row); }}><Play size={12} /></Button>
                              <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); updateQueueStatus(row, "Paused"); }}><Pause size={12} /></Button>
                              <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); moveQueueItem(row, "up"); }}><ArrowUp size={12} /></Button>
                              <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); moveQueueItem(row, "down"); }}><ArrowDown size={12} /></Button>
                              <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); updateQueueStatus(row, "Cancelled"); }}><XCircle size={12} /></Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </SectionCard>

              <SectionCard title="Printer Management">
                <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
                  <Table>
                    <thead>
                      <tr>
                        <th>Printer</th>
                        <th>Model</th>
                        <th>Status</th>
                        <th>Paper Type</th>
                        <th>Default</th>
                      </tr>
                    </thead>
                    <tbody>
                      {printerOptions.map((printer, idx) => (
                        <tr key={`prn-${idx}`}>
                          <td>{printer.name}</td>
                          <td>{printer.model || "-"}</td>
                          <td><ToneBadge value={printer.status} /></td>
                          <td>{printer.paper_type || "-"}</td>
                          <td>{printer.is_default ? <CheckCircle2 size={14} className="text-emerald-300" /> : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </SectionCard>
            </>
          )}

          {activeTab === "scanner" && (
            <>
              <SectionCard title="Barcode Scanner" subtitle="Scan product, repair, spare part, customer, or asset labels for instant lookup">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-2 mb-3">
                  <input
                    className="field !py-2 !px-3 !text-xs xl:col-span-3"
                    placeholder="Scan with USB scanner or type barcode value"
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        performScan();
                      }
                    }}
                  />
                  <Select className="field !py-2 !px-3 !text-xs" value={scanMode} onChange={(e) => setScanMode(e.target.value)}>
                    <option value="scanner">USB/Bluetooth Scanner</option>
                    <option value="manual">Manual Entry</option>
                    <option value="camera">Camera</option>
                  </Select>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={multiScanMode} onChange={(e) => setMultiScanMode(e.target.checked)} />
                    Multi-scan mode
                  </label>
                  <Button size="sm" onClick={() => performScan()}><ScanLine size={13} /> Scan</Button>
                </div>
                <div className="mb-3 flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setMultiScanRows([])}>Clear Multi-scan</Button>
                  <Button size="sm" onClick={enqueueMultiScans} disabled={!multiScanRows.length}>Queue Labels For Scanned Items</Button>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  <SectionCard title="Scan Result">
                    {!scanResult?.data && <div className="text-sm text-slate-400">No scan result yet.</div>}
                    {!!scanResult?.data && (
                      <div className="rounded-xl border border-white/10 bg-black/25 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-bold text-white">{scanResult.data.item_type || "Unknown"}</p>
                          <ToneBadge value={scanResult.data.item_type || "Unknown"} />
                        </div>
                        {Object.entries(scanResult.data)
                          .filter(([key]) => key !== "quick_actions")
                          .map(([key, value]) => (
                            <div key={key} className="flex items-center justify-between text-xs text-slate-300">
                              <span className="uppercase tracking-widest text-slate-500">{key.replace(/_/g, " ")}</span>
                              <span className="text-right max-w-[60%] truncate">{String(value ?? "-")}</span>
                            </div>
                          ))}
                        <div className="flex flex-wrap gap-2 pt-2">
                          {(scanResult.data.quick_actions || []).map((action) => (
                            <span key={action} className="rounded-md border border-sky-400/30 bg-sky-500/10 px-2 py-1 text-[11px] text-sky-100">
                              {action}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </SectionCard>

                  <SectionCard title="Multi-Scan List">
                    <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
                      <Table>
                        <thead>
                          <tr>
                            <th>Type</th>
                            <th>Name / Ref</th>
                            <th>Code</th>
                          </tr>
                        </thead>
                        <tbody>
                          {multiScanRows.length === 0 && (
                            <tr><td colSpan={3} className="py-5 text-center text-slate-500">No scanned rows yet.</td></tr>
                          )}
                          {multiScanRows.map((row, idx) => (
                            <tr key={`${row.item_type}-${row.id}-${idx}`}>
                              <td>{row.item_type}</td>
                              <td>{row.name || row.device || row.customer || row.asset_code || "-"}</td>
                              <td className="font-mono text-xs">{row.sku || row.job_id || row.asset_code || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  </SectionCard>
                </div>
              </SectionCard>

              <SectionCard title="Scanner History (Last 50)">
                <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
                  <Table>
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>User</th>
                        <th>Barcode Value</th>
                        <th>Type</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scanHistory.length === 0 && (
                        <tr><td colSpan={5} className="py-5 text-center text-slate-500">No scanner history found.</td></tr>
                      )}
                      {scanHistory.map((row) => (
                        <tr key={row.id}>
                          <td>{toDateTime(row.timestamp)}</td>
                          <td>{row.user || "-"}</td>
                          <td className="font-mono text-xs">{row.barcode_value}</td>
                          <td>{row.scanned_type}</td>
                          <td>{row.result_summary || row.result_ref || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </SectionCard>
            </>
          )}

          {activeTab === "history" && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
                <KpiCard title="Printed This Month" value={String(historyState?.kpis?.total_labels_printed_month || 0)} icon={<Printer size={16} />} />
                <KpiCard title="Reprints This Month" value={String(historyState?.kpis?.total_reprints_month || 0)} icon={<Copy size={16} />} tone="amber" />
                <KpiCard title="Print Jobs Today" value={String(historyState?.kpis?.print_jobs_today || 0)} icon={<ClipboardList size={16} />} tone="sky" />
                <KpiCard title="Failed Print Jobs" value={String(historyState?.kpis?.failed_print_jobs || 0)} icon={<XCircle size={16} />} tone="red" />
                <KpiCard title="Most Active Printer" value={historyState?.kpis?.most_active_printer || "-"} icon={<Settings2 size={16} />} tone="indigo" />
              </div>

              <SectionCard title="History Filters">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-2">
                  <input className="field !py-2 !px-3 !text-xs" type="date" value={historyFilters.date_from} onChange={(e) => setHistoryFilters((p) => ({ ...p, date_from: e.target.value }))} />
                  <input className="field !py-2 !px-3 !text-xs" type="date" value={historyFilters.date_to} onChange={(e) => setHistoryFilters((p) => ({ ...p, date_to: e.target.value }))} />
                  <Select className="field !py-2 !px-3 !text-xs" value={historyFilters.label_type} onChange={(e) => setHistoryFilters((p) => ({ ...p, label_type: e.target.value }))}>
                    <option value="all">Label Type</option>
                    {(meta?.label_scopes || []).map((row) => <option key={row} value={row}>{row}</option>)}
                  </Select>
                  <Select className="field !py-2 !px-3 !text-xs" value={historyFilters.status} onChange={(e) => setHistoryFilters((p) => ({ ...p, status: e.target.value }))}>
                    <option value="all">Status</option>
                    {(meta?.queue_statuses || []).map((row) => <option key={row} value={row}>{row}</option>)}
                  </Select>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={historyFilters.reprint_only} onChange={(e) => setHistoryFilters((p) => ({ ...p, reprint_only: e.target.checked }))} />
                    Reprint only
                  </label>
                  <input className="field !py-2 !px-3 !text-xs" value={historyFilters.q} onChange={(e) => setHistoryFilters((p) => ({ ...p, q: e.target.value }))} placeholder="Search history..." />
                  <Button size="sm" variant="secondary" onClick={loadHistory}><Filter size={13} /> Apply</Button>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="ghost" onClick={exportHistoryCsv}><Download size={13} /> Export CSV</Button>
                  <Button size="sm" variant="ghost" onClick={printHistoryView}><Printer size={13} /> Print View</Button>
                </div>
              </SectionCard>

              <SectionCard title="Full Print Log">
                <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
                  <Table>
                    <thead>
                      <tr>
                        <th>Date &amp; Time</th>
                        <th>Label Type</th>
                        <th>Item</th>
                        <th>Template</th>
                        <th>Qty</th>
                        <th>Printer</th>
                        <th>Printed By</th>
                        <th>Reprint?</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(historyState?.rows || []).length === 0 && (
                        <tr><td colSpan={10} className="py-5 text-center text-slate-500">No history rows found.</td></tr>
                      )}
                      {(historyState?.rows || []).map((row) => (
                        <tr key={row.id}>
                          <td>{toDateTime(row.created_at)}</td>
                          <td>{row.label_type}</td>
                          <td>{row.item_name}</td>
                          <td>{row.template_name || "-"}</td>
                          <td>{row.qty}</td>
                          <td>{row.printer_name || "-"}</td>
                          <td>{row.generated_by || "-"}</td>
                          <td>{row.is_reprint ? "Yes" : "No"}</td>
                          <td><ToneBadge value={row.status} /></td>
                          <td>
                            <Button size="sm" variant="ghost" onClick={() => reprintFromHistory(row)}>
                              Reprint
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </SectionCard>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                <SectionCard title="Reprint Analysis">
                  <div className="space-y-2">
                    {(historyState?.reprint_analysis || []).slice(0, 12).map((row, idx) => (
                      <div key={`ra-${idx}`} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs">
                        <span className="truncate max-w-[80%]">{row.item}</span>
                        <Badge tone={row.count > 5 ? "red" : row.count > 2 ? "amber" : "green"}>{row.count}</Badge>
                      </div>
                    ))}
                    {(historyState?.reprint_analysis || []).length === 0 && (
                      <div className="text-sm text-slate-400">No reprint trends yet.</div>
                    )}
                  </div>
                </SectionCard>

                <SectionCard title="Staff Activity">
                  <div className="space-y-2">
                    {(historyState?.staff_reprint_count || []).slice(0, 12).map((row, idx) => (
                      <div key={`sa-${idx}`} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs">
                        <span className="truncate">{row.staff}</span>
                        <Badge tone={row.count > 20 ? "amber" : "sky"}>{row.count}</Badge>
                      </div>
                    ))}
                    {(historyState?.staff_reprint_count || []).length === 0 && (
                      <div className="text-sm text-slate-400">No staff activity rows yet.</div>
                    )}
                  </div>
                </SectionCard>
              </div>
            </>
          )}
        </div>

        <aside className="xl:col-span-4 min-h-0 overflow-auto custom-scrollbar space-y-3">
          <SectionCard
            title="Live Label Preview"
            subtitle="WYSIWYG preview updates instantly with your selected row and template"
            right={<Badge tone={previewTemplate ? "green" : "amber"}>{previewTemplate?.name || "No template"}</Badge>}
          >
            {!previewTemplate && <div className="text-sm text-slate-400">No active template selected.</div>}
            {!!previewTemplate && (
              <div className="space-y-3">
                <div className="rounded-xl border border-white/10 bg-slate-950 p-3 overflow-auto">
                  <LabelPreview template={previewTemplate} data={previewData} scale={3} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant="secondary" onClick={exportPreviewPng}><Download size={13} /> PNG</Button>
                  <Button size="sm" variant="secondary" onClick={printPreview}><Printer size={13} /> PDF / Print</Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <Select
                    className="field !py-2 !px-3 !text-xs"
                    value={printSettings.barcode_format}
                    onChange={(e) => setPrintSettings((p) => ({ ...p, barcode_format: e.target.value }))}
                  >
                    {(meta?.barcode_formats || []).map((row) => (
                      <option key={row} value={row}>{row}</option>
                    ))}
                  </Select>
                  <Select
                    className="field !py-2 !px-3 !text-xs"
                    value={printSettings.paper_type}
                    onChange={(e) => setPrintSettings((p) => ({ ...p, paper_type: e.target.value }))}
                  >
                    <option value="Label Roll">Label Roll</option>
                    <option value="A4 Sheet">A4 Sheet</option>
                  </Select>
                  <Select
                    className="field !py-2 !px-3 !text-xs"
                    value={printSettings.print_quality}
                    onChange={(e) => setPrintSettings((p) => ({ ...p, print_quality: e.target.value }))}
                  >
                    <option value="Draft">Draft</option>
                    <option value="Normal">Normal</option>
                    <option value="High">High</option>
                  </Select>
                  <Select
                    className="field !py-2 !px-3 !text-xs"
                    value={printSettings.orientation}
                    onChange={(e) => setPrintSettings((p) => ({ ...p, orientation: e.target.value }))}
                  >
                    <option value="Portrait">Portrait</option>
                    <option value="Landscape">Landscape</option>
                  </Select>
                  <Select
                    className="field !py-2 !px-3 !text-xs md:col-span-2"
                    value={printSettings.printer_name}
                    onChange={(e) => setPrintSettings((p) => ({ ...p, printer_name: e.target.value }))}
                  >
                    {(printerOptions || []).map((row, idx) => (
                      <option key={`pr-${idx}`} value={row.name}>{row.name} ({row.status})</option>
                    ))}
                  </Select>
                  <input
                    className="field !py-2 !px-3 !text-xs"
                    type="number"
                    min={1}
                    value={printSettings.copies}
                    onChange={(e) => setPrintSettings((p) => ({ ...p, copies: Math.max(1, Number(e.target.value || 1)) }))}
                    placeholder="Copies"
                  />
                </div>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Template Picker">
            <div className="space-y-2">
              {LABEL_SCOPE_LOOP.map((scope) => (
                <div key={scope} className="rounded-lg border border-white/10 bg-black/25 px-2 py-2">
                  <p className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">{scope}</p>
                  <Select
                    className="field !py-1.5 !px-2 !text-xs"
                    value={selectedTemplateByScope[scope] || ""}
                    onChange={(e) => setSelectedTemplateByScope((prev) => ({ ...prev, [scope]: Number(e.target.value) }))}
                  >
                    {(templates || [])
                      .filter((row) => row.label_scope === scope && row.is_active)
                      .map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.name}{row.is_default ? " (Default)" : ""}
                        </option>
                      ))}
                  </Select>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Recent Export Helpers">
            <div className="space-y-2 text-xs text-slate-300">
              <button
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10"
                onClick={() => setActiveTab("history")}
              >
                Export filtered print logs as CSV
              </button>
              <button
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10"
                onClick={() => setActiveTab("queue")}
              >
                Monitor queue and retry failed print jobs
              </button>
              <button
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10"
                onClick={() => setActiveTab("designer")}
              >
                Build or edit template with drag-and-drop canvas
              </button>
            </div>
          </SectionCard>
        </aside>
      </div>
    </div>
  );
}

const LABEL_SCOPE_LOOP = ["Product", "Repair Job", "Spare Part", "Asset"];


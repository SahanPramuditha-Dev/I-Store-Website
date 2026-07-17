import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../lib/api";
import { runWithApproval } from "../lib/approvalFlow";
import { openPrintCenter } from "../lib/printCenter";
import { useCachedQuery } from "../hooks/useCachedQuery";
import { apiService } from "../lib/apiService";
import { AppTableEmptyRow, AppTableHead, AppTableShell, Badge, KpiCard, Loading, Select, StatusBadge } from "../components/UI";
import AppDrawer from "../components/layout/AppDrawer";
import AppModal from "../components/layout/AppModal";
import { downloadCsv, downloadPdf, paginateRows } from "../lib/tableUtils";
import { Menu, MenuItem } from "@mui/material";
import {
  AlertTriangle,
  Barcode,
  Boxes,
  Edit2,
  Eye,
  Grid3X3,
  Layers,
  List,
  MoreHorizontal,
  Package,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  Trash2,
  Wand2,
} from "lucide-react";
import { useFeedback } from "../components/FeedbackProvider";

const LOW_STOCK_THRESHOLD = 3;
const RECENT_DAYS = 30;
const PRODUCT_CATEGORIES = [
  "Smartphones",
  "Used Phones",
  "Chargers",
  "Earphones",
  "Power Banks",
  "Cases & Covers",
  "Tempered Glass",
  "Displays",
  "Batteries",
  "Charging Ports",
  "IC Components",
  "Repair Tools",
  "Repair Services",
];

const QUICK_FILTERS = ["Low Stock", "Out of Stock", "Spare Parts", "Fast Moving", "Recently Added"];

const currency = (value) => `Rs. ${Number(value || 0).toLocaleString()}`;
const parseDate = (value) => {
  const dt = new Date(value || "");
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const isRecent = (value, days = RECENT_DAYS) => {
  const dt = parseDate(value);
  if (!dt) return false;
  return Date.now() - dt.getTime() <= days * 24 * 60 * 60 * 1000;
};

export default function Inventory() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast, confirm, prompt } = useFeedback();

  const [query, setQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [supplierFilter, setSupplierFilter] = useState("All");
  const [productTypeFilter, setProductTypeFilter] = useState("All");
  const [sortBy, setSortBy] = useState("updated");
  const [viewMode, setViewMode] = useState("list");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const searchRef = useRef(null);

  const { data: inventoryData, loading, error, refetch, setData: setCacheData } = useCachedQuery(
    ["inventory", page, pageSize, query, categoryFilter, supplierFilter],
    () => apiService.inventory.list({
      page,
      pageSize,
      search: query,
      category: categoryFilter,
      supplierId: supplierFilter
    })
  );

  const suppliersQuery = useCachedQuery("suppliers", () => apiService.inventory.getSuppliers().then(res => res.data));
  const movementQuery = useCachedQuery("movements", () => apiService.inventory.getMovements().then(res => res.data));

  const suppliers = suppliersQuery.data || [];
  const movements = movementQuery.data || [];
  const data = inventoryData?.items || [];

  const setData = (updater) => {
    setCacheData((prev) => {
      const currentItems = prev?.items || [];
      const newItems = typeof updater === "function" ? updater(currentItems) : (updater?.items ?? updater);
      return {
        ...prev,
        items: newItems,
        total: prev?.total ?? newItems.length
      };
    });
  };

  const [editingProductId, setEditingProductId] = useState(null);
  const [detailsDrawer, setDetailsDrawer] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedProductRows, setSelectedProductRows] = useState([]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [adjustModal, setAdjustModal] = useState(null);
  const [serialModal, setSerialModal] = useState(null);

  const [form, setForm] = useState({
    name: "",
    category: "Smartphones",
    brand: "",
    model: "",
    storage: "",
    color: "",
    condition: "New",
    product_type: "Retail",
    location: "",
    image_url: "",
    warranty_days: 0,
    sku: "",
    quantity: 1,
    cost_price: 0,
    sale_price: 0,
    barcode: "",
    supplier_id: "",
    has_serials: false,
  });
  const [adjustForm, setAdjustForm] = useState({ qty: 0, note: "" });
  const [serialForm, setSerialForm] = useState("");
  const [selectedSerials, setSelectedSerials] = useState([]);
  const [serialsLoading, setSerialsLoading] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const emptyProductForm = {
    name: "",
    category: "Smartphones",
    brand: "",
    model: "",
    storage: "",
    color: "",
    condition: "New",
    product_type: "Retail",
    location: "",
    image_url: "",
    warranty_days: 0,
    sku: "",
    quantity: 1,
    cost_price: 0,
    sale_price: 0,
    barcode: "",
    supplier_id: "",
    has_serials: false,
  };

  const resetProductForm = () => {
    setEditingProductId(null);
    setForm({ ...emptyProductForm });
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "/" && document.activeElement !== searchRef.current) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1024px)");
    const syncMode = () => setViewMode(mediaQuery.matches ? "grid" : "list");
    syncMode();
    mediaQuery.addEventListener("change", syncMode);
    return () => mediaQuery.removeEventListener("change", syncMode);
  }, []);

  useEffect(() => {
    const preset = location.state?.presetFilter;
    const prefetchedSearch = location.state?.search || new URLSearchParams(location.search).get("q") || "";
    if (preset === "Low Stock" || preset === "Out of Stock") {
      setQuickFilter(preset);
      setStatusFilter(preset);
      setPage(1);
    }
    if (prefetchedSearch) {
      setQuery(String(prefetchedSearch));
      setPage(1);
    }
  }, [location.search, location.state]);

  const getItemThreshold = (item) => Number(item?.low_stock_threshold || LOW_STOCK_THRESHOLD);

  const getStockStatus = (item) => {
    const quantity = Number(item?.quantity || 0);
    const threshold = getItemThreshold(item);
    if (quantity <= 0) return "Out of Stock";
    if (quantity <= threshold) return "Low Stock";
    return "In Stock";
  };

  const getProductType = (item) => {
    if (["Displays", "Batteries", "Charging Ports", "IC Components", "Repair Tools"].includes(item.category)) {
      return "Spare Parts";
    }
    if (item.category === "Repair Services") return "Service";
    return "Retail";
  };

  const getFastMovingItemIds = useMemo(() => {
    const consumed = {};
    for (const row of movements) {
      if (["SALE", "REPAIR_CONSUME"].includes(row.movement_type)) {
        consumed[row.item_id] = (consumed[row.item_id] || 0) + Math.abs(Number(row.quantity || 0));
      }
    }
    return new Set(
      Object.entries(consumed)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([id]) => Number(id))
    );
  }, [movements]);

  const stats = useMemo(() => {
    const rows = data || [];
    const low = rows.filter((i) => getStockStatus(i) === "Low Stock").length;
    const out = rows.filter((i) => Number(i.quantity || 0) <= 0).length;
    const value = rows.reduce((sum, i) => sum + Number(i.quantity || 0) * Number(i.cost_price || 0), 0);
    const spareParts = rows.filter((i) => getProductType(i) === "Spare Parts").length;
    const today = new Date().toISOString().slice(0, 10);
    const todayMovement = movements
      .filter((m) => String(m.created_at || "").slice(0, 10) === today)
      .reduce((sum, m) => sum + Math.abs(Number(m.quantity || 0)), 0);
    return {
      totalProducts: rows.length,
      low,
      out,
      value,
      spareParts,
      todayMovement,
    };
  }, [data, movements]);

  const quickFilterCounts = useMemo(() => {
    const rows = data || [];
    return {
      "Low Stock": rows.filter((i) => getStockStatus(i) === "Low Stock").length,
      "Out of Stock": rows.filter((i) => getStockStatus(i) === "Out of Stock").length,
      "Spare Parts": rows.filter((i) => getProductType(i) === "Spare Parts").length,
      "Fast Moving": rows.filter((i) => getFastMovingItemIds.has(i.id)).length,
      "Recently Added": rows.filter((i) => isRecent(i.created_at)).length,
    };
  }, [data, getFastMovingItemIds]);

  const clearFilters = () => {
    setQuery("");
    setQuickFilter("");
    setStatusFilter("All");
    setCategoryFilter("All");
    setSupplierFilter("All");
    setProductTypeFilter("All");
    setSortBy("updated");
    setPage(1);
  };

  const bulkRestock = async () => {
    if (!selectedProductRows.length) return toast("Select at least one product", "warning");
    setData((prev = []) =>
      prev.map((row) =>
        selectedProductRows.includes(row.id)
          ? { ...row, quantity: Math.max(Number(row.quantity || 0), Number(row.low_stock_threshold || LOW_STOCK_THRESHOLD) + 1) }
          : row
      )
    );
    toast(`Restocked ${selectedProductRows.length} products locally`, "success");
    setSelectedProductRows([]);
  };

  const bulkMarkOutOfStock = async () => {
    if (!selectedProductRows.length) return toast("Select at least one product", "warning");
    setData((prev = []) => prev.map((row) => (selectedProductRows.includes(row.id) ? { ...row, quantity: 0 } : row)));
    toast(`Marked ${selectedProductRows.length} products as out of stock`, "success");
    setSelectedProductRows([]);
  };

  const assignSupplierBulk = (supplierId) => {
    if (!supplierId) return;
    if (!selectedProductRows.length) return toast("Select at least one product", "warning");
    setData((prev = []) =>
      prev.map((row) => (selectedProductRows.includes(row.id) ? { ...row, supplier_id: Number(supplierId) } : row))
    );
    toast("Supplier assignment updated locally", "info");
    setSelectedProductRows([]);
  };

  const filtered = useMemo(() => {
    return data;
  }, [data]);

  const selectedResolved = useMemo(() => {
    if (!selectedItem) return null;
    return (data || []).find((row) => row.id === selectedItem.id) || null;
  }, [data, selectedItem]);

  const selectedHistory = useMemo(() => {
    if (!selectedResolved) return [];
    return movements.filter((m) => m.item_id === selectedResolved.id).slice(0, 20);
  }, [movements, selectedResolved]);

  const gridRows = data;
  const gridTotalPages = Math.ceil((inventoryData?.total || 0) / pageSize) || 1;

  useEffect(() => {
    const loadSerials = async () => {
      if (!selectedResolved || !selectedResolved.has_serials || !detailsDrawer) {
        setSelectedSerials([]);
        return;
      }
      try {
        setSerialsLoading(true);
        const res = await api.get(`/inventory/${selectedResolved.id}/serials`);
        setSelectedSerials(res.data || []);
      } catch {
        setSelectedSerials([]);
      } finally {
        setSerialsLoading(false);
      }
    };
    loadSerials();
  }, [selectedResolved, detailsDrawer]);

  const saveProduct = async () => {
    try {
      const payload = { ...form, supplier_id: form.supplier_id ? Number(form.supplier_id) : null };
      if (editingProductId) {
        const r = await api.put(`/inventory/${editingProductId}`, payload);
        setData((data || []).map((row) => (row.id === editingProductId ? r.data : row)));
        toast("Product updated successfully", "success");
      } else {
        const r = await api.post("/inventory", payload);
        setData([...(data || []), r.data]);
        toast("Product added successfully", "success");
      }
      setShowAddModal(false);
      resetProductForm();
    } catch {
      toast(editingProductId ? "Failed to update product" : "Failed to add product", "error");
    }
  };

  const deleteItem = async (item) => {
    const confirmed = await confirm("Archive Product", `Archive "${item.name}" from inventory?`);
    if (!confirmed) return;
    try {
      await runWithApproval({
        confirm,
        prompt,
        toast,
        approval: {
          module: "inventory",
          action: "archive_product",
          target_type: "InventoryItem",
          target_id: item.id,
          reason: `Archive inventory item ${item.name}`,
          payload: { sku: item.sku },
        },
        execute: (approvalCode) => api.delete(`/inventory/${item.id}`, { params: approvalCode ? { approval_request_code: approvalCode } : {} }),
      });
      setData((data || []).filter((i) => i.id !== item.id));
      if (selectedResolved?.id === item.id) setDetailsDrawer(false);
      toast("Item deleted", "success");
    } catch (error) {
      if (error.approvalCancelled) return;
      toast(error.response?.data?.detail || "Failed to delete item", "error");
    }
  };

  const adjustStock = async () => {
    if (!adjustModal || !adjustForm.note || adjustForm.note.trim().length < 5) {
      return toast("Reason with at least 5 characters is required", "warning");
    }
    try {
      const quantityChange = Number(adjustForm.qty);
      await runWithApproval({
        confirm,
        prompt,
        toast,
        approval: {
          module: "inventory",
          action: "stock_adjustment",
          target_type: "InventoryItem",
          target_id: adjustModal.id,
          reason: adjustForm.note,
          payload: { quantity_change: quantityChange },
        },
        execute: (approvalCode) => api.post("/inventory/adjust", {
          item_id: adjustModal.id,
          quantity_change: quantityChange,
          note: adjustForm.note,
          approval_request_code: approvalCode || null,
        }),
      });
      const [invRes, moveRes] = await Promise.all([api.get("/inventory"), api.get("/inventory/movements")]);
      setData(invRes.data);
      movementFetch.setData(moveRes.data);
      setAdjustModal(null);
      setAdjustForm({ qty: 0, note: "" });
      toast("Stock adjusted", "success");
    } catch (error) {
      if (error.approvalCancelled) return;
      toast(error.response?.data?.detail || "Stock adjustment failed", "error");
    }
  };

  const manageSerials = async () => {
    if (!serialModal || !serialForm) return;
    try {
      await api.post(`/inventory/${serialModal.id}/serials?serial_number=${encodeURIComponent(serialForm)}`);
      const [invRes, moveRes] = await Promise.all([api.get("/inventory"), api.get("/inventory/movements")]);
      setData(invRes.data);
      movementFetch.setData(moveRes.data);
      setSerialForm("");
      toast("Serial added", "success");
    } catch (e) {
      toast(e.response?.data?.detail || "Failed to add serial", "error");
    }
  };

  const openDetails = (item) => {
    setSelectedItem(item);
    setDetailsDrawer(true);
  };

  const printLabel = (item) => {
    if (!item) return;
    openPrintCenter(navigate, {
      type: "label",
      ref: item.id || item.barcode || item.sku,
      paper: "label_50x30",
      template: "label",
    });
  };

  const generateBarcode = () => {
    const seed = `${form.sku || "IST"}${Date.now().toString().slice(-6)}`.toUpperCase().replace(/\s+/g, "");
    setForm((prev) => ({ ...prev, barcode: seed }));
  };

  const getImageUrl = (value) => {
    if (!value) return "";
    if (String(value).startsWith("http://") || String(value).startsWith("https://")) return value;
    return `${import.meta.env.VITE_API_URL || (typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1" ? "https://i-store-website-by6z.vercel.app" : "http://127.0.0.1:8000")}${value}`;
  };

  const uploadImage = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      setUploadingImage(true);
      const res = await api.post("/inventory/upload-image", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setForm((prev) => ({ ...prev, image_url: res.data?.url || "" }));
      toast("Image uploaded", "success");
    } catch (e) {
      toast(e.response?.data?.detail || "Image upload failed", "error");
    } finally {
      setUploadingImage(false);
    }
  };

  if (loading) return <Loading text="Loading inventory..." />;
  if (error) return <div className="rounded border border-red-500/30 bg-red-500/10 p-4 text-red-300">{error}</div>;

  return (
    <div className="flex min-h-0 min-w-0 max-w-full flex-col gap-4 overflow-x-clip overflow-y-auto pb-2 xl:h-full xl:overflow-y-hidden">
      <div className="flex justify-end">
        <button
          onClick={() => {
            resetProductForm();
            setShowAddModal(true);
          }}
          className="inline-flex items-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-indigo-950/30 transition hover:bg-indigo-500"
        >
          + New Product
        </button>
      </div>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Total Products" value={String(stats.totalProducts)} hint="Catalog count" tone="sky" icon={<Boxes size={18} />} />
        <KpiCard title="Low Stock Items" value={String(stats.low)} hint="Need replenishment" tone="amber" icon={<AlertTriangle size={18} />} />
        <KpiCard title="Inventory Value" value={currency(stats.value)} hint="Cost basis" tone="indigo" icon={<Layers size={18} />} />
        <KpiCard title="Spare Parts Count" value={String(stats.spareParts)} hint="Repair parts" tone="green" icon={<Wand2 size={18} />} />
      </section>

      <div className="min-h-0 flex-1">
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-md">
          <div className="p-6 border-b border-white/5 space-y-4 bg-white/[0.01]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative group flex-1 min-w-[220px] xl:min-w-[280px]">
                <Search size={18} className="absolute left-4 top-3.5 text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setPage(1); }}
                  placeholder="Search by product, SKU, barcode, category"
                  className="w-full bg-[#0f172a] border border-white/10 rounded-xl py-3 pl-12 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/15 transition-all"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="repair-select h-11 min-w-[130px] max-w-[180px] !w-auto bg-[#0f172a] border-white/10 text-xs">
                  <option value="All">All Status</option>
                  <option value="In Stock">In Stock</option>
                  <option value="Low Stock">Low Stock</option>
                  <option value="Out of Stock">Out of Stock</option>
                </Select>
                <Select value={supplierFilter} onChange={(e) => { setSupplierFilter(e.target.value); setPage(1); }} className="repair-select h-11 min-w-[130px] max-w-[180px] !w-auto bg-[#0f172a] border-white/10 text-xs">
                  <option value="All">All Suppliers</option>
                  {suppliers.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                </Select>
                <Select value={productTypeFilter} onChange={(e) => { setProductTypeFilter(e.target.value); setPage(1); }} className="repair-select h-11 min-w-[120px] max-w-[165px] !w-auto bg-[#0f172a] border-white/10 text-xs">
                  <option value="All">All Type</option>
                  <option value="Retail">Retail</option>
                  <option value="Spare Parts">Spare Parts</option>
                  <option value="Service">Service</option>
                </Select>
                <Select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }} className="repair-select h-11 min-w-[130px] max-w-[190px] !w-auto bg-[#0f172a] border-white/10 text-xs">
                  <option value="All">All Categories</option>
                  {PRODUCT_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </Select>
                <Select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="repair-select h-11 min-w-[130px] max-w-[180px] !w-auto bg-[#0f172a] border-white/10 text-xs">
                  <option value="updated">Newest First</option>
                  <option value="name">Name A-Z</option>
                  <option value="qty_asc">Lowest Qty First</option>
                  <option value="qty_desc">Highest Qty First</option>
                  <option value="value">Highest Value First</option>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {QUICK_FILTERS.map((pill) => (
                  <button
                    key={pill}
                    onClick={() => { setQuickFilter((prev) => (prev === pill ? "" : pill)); setPage(1); }}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition ${quickFilter === pill ? "bg-indigo-500/30 text-indigo-200 border border-indigo-400/40" : "bg-white/5 text-slate-400 border border-white/10 hover:text-white"}`}
                  >
                    {pill} ({quickFilterCounts[pill] || 0})
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => downloadCsv("inventory-products.csv", [
                    { label: "Name", value: "name" },
                    { label: "SKU", value: "sku" },
                    { label: "Barcode", value: "barcode" },
                    { label: "Category", value: "category" },
                    { label: "Quantity", value: "quantity" },
                    { label: "Cost Price", value: "cost_price" },
                    { label: "Sale Price", value: "sale_price" },
                    { label: "Supplier ID", value: "supplier_id" },
                  ], filtered)}
                  className="px-3 h-9 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-[11px] font-bold transition"
                >
                  Export CSV
                </button>
                <button
                  onClick={async () => downloadPdf("inventory-products", "Inventory Products Report", [
                    { label: "Name", value: "name" },
                    { label: "SKU", value: "sku" },
                    { label: "Barcode", value: "barcode" },
                    { label: "Category", value: "category" },
                    { label: "Quantity", value: "quantity" },
                    { label: "Cost Price", value: "cost_price" },
                    { label: "Sale Price", value: "sale_price" },
                    { label: "Supplier ID", value: "supplier_id" },
                  ], filtered)}
                  className="px-3 h-9 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-[11px] font-bold transition"
                >
                  Export PDF
                </button>
                <button onClick={bulkRestock} className="px-3 h-9 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-200 text-[11px] font-bold transition">Bulk Restock</button>
                <button onClick={bulkMarkOutOfStock} className="px-3 h-9 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 text-[11px] font-bold transition">Bulk Out Of Stock</button>
                <Select className="repair-select h-9 min-w-[150px] max-w-[220px] !w-auto bg-[#0f172a] border-white/10 text-xs" onChange={(e) => assignSupplierBulk(e.target.value)}>
                  <option value="">Assign Supplier (bulk)</option>
                  {suppliers.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                </Select>
                <div className="h-7 w-[1px] bg-white/10 mx-1 hidden lg:block" />
                <div className="flex items-center p-1 bg-[#0f172a] rounded-xl border border-white/5">
                  <button onClick={() => setViewMode("list")} className={`p-1.5 rounded-lg transition-all ${viewMode === "list" ? "bg-indigo-500 text-white shadow-lg" : "text-slate-400 hover:text-white"}`}><List size={17} /></button>
                  <button onClick={() => setViewMode("grid")} className={`p-1.5 rounded-lg transition-all ${viewMode === "grid" ? "bg-indigo-500 text-white shadow-lg" : "text-slate-400 hover:text-white"}`}><Grid3X3 size={17} /></button>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <span>Showing {gridRows.length} of {inventoryData?.total || 0} products</span>
              {viewMode === "grid" ? (
                <div className="inline-flex items-center gap-2">
                  <Select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="repair-select rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-slate-100">
                    <option value={10}>10 / page</option>
                    <option value={25}>25 / page</option>
                    <option value={50}>50 / page</option>
                  </Select>
                  <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border border-white/10 px-2 py-1 disabled:opacity-40">Prev</button>
                  <span>{page} / {gridTotalPages}</span>
                  <button disabled={page >= gridTotalPages} onClick={() => setPage((p) => p + 1)} className="rounded border border-white/10 px-2 py-1 disabled:opacity-40">Next</button>
                </div>
              ) : (
                <span className="text-slate-500">Sortable columns | Sticky header</span>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
            {viewMode === "list" ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <InventoryTable
                  rows={filtered}
                  suppliers={suppliers}
                  getProductType={getProductType}
                  getItemThreshold={getItemThreshold}
                  getStockStatus={getStockStatus}
                  selectedRows={selectedProductRows}
                  setSelectedRows={setSelectedProductRows}
                  onEdit={(item) => {
                    setEditingProductId(item.id);
                    setForm({
                      name: item.name,
                      category: item.category,
                      brand: item.brand || "",
                      model: item.model || "",
                      storage: item.storage || "",
                      color: item.color || "",
                      condition: item.condition || "New",
                      product_type: item.product_type || "Retail",
                      location: item.location || "",
                      image_url: item.image_url || "",
                      warranty_days: Number(item.warranty_days || 0),
                      sku: item.sku,
                      quantity: item.quantity,
                      cost_price: item.cost_price,
                      sale_price: item.sale_price,
                      barcode: item.barcode || "",
                      supplier_id: item.supplier_id ? String(item.supplier_id) : "",
                      has_serials: Boolean(item.has_serials),
                    });
                    setShowAddModal(true);
                  }}
                  onAdjust={(item) => setAdjustModal(item)}
                  onView={openDetails}
                  onPrint={printLabel}
                  onDelete={deleteItem}
                />
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto custom-scrollbar">
                <InventoryGrid
                  rows={gridRows}
                  getStockStatus={getStockStatus}
                  onView={openDetails}
                  onAdjust={(item) => setAdjustModal(item)}
                  onPrint={printLabel}
                />
              </div>
            )}
          </div>
        </section>
      </div>

      <AppDrawer
        open={detailsDrawer && !!selectedResolved}
        onClose={() => setDetailsDrawer(false)}
        title="Product Details"
        subtitle={selectedResolved?.name || "Inventory item"}
        panelClassName="sm:max-w-md bg-[#0c1428]"
      >
        {selectedResolved && (
          <div className="flex min-h-full flex-col p-4">
            <div className="space-y-3 pr-1">
              <InfoRow label="Product" value={selectedResolved.name} />
              <InfoRow label="Brand / Model" value={`${selectedResolved.brand || "-"} ${selectedResolved.model || ""}`.trim()} />
              <InfoRow label="Variant" value={`${selectedResolved.storage || "-"} / ${selectedResolved.color || "-"}`} />
              <InfoRow label="SKU" value={selectedResolved.sku} mono />
              <InfoRow label="Barcode" value={selectedResolved.barcode || "Not assigned"} mono />
              <InfoRow label="Category" value={selectedResolved.category} />
              <InfoRow label="Type" value={getProductType(selectedResolved)} />
              <InfoRow label="Condition" value={selectedResolved.condition || "-"} />
              <InfoRow label="Location" value={selectedResolved.location || "-"} />
              {selectedResolved.image_url && (
                <div className="rounded-xl border border-white/10 bg-black/20 p-2">
                  <img src={getImageUrl(selectedResolved.image_url)} alt={selectedResolved.name} className="h-40 w-full rounded-lg object-cover" />
                </div>
              )}
              <InfoRow label="Warranty" value={`${Number(selectedResolved.warranty_days || 0)} days`} />
              <InfoRow label="Supplier" value={suppliers.find((s) => s.id === selectedResolved.supplier_id)?.name || "Direct"} />
              <InfoRow label="Current Stock" value={selectedResolved.quantity} />
              <InfoRow label="Low Stock Threshold" value={getItemThreshold(selectedResolved)} />
              <InfoRow label="Cost Price" value={currency(selectedResolved.cost_price)} />
              <InfoRow label="Selling Price" value={currency(selectedResolved.sale_price)} />
              <InfoRow label="Status" value={getStockStatus(selectedResolved)} />
              {selectedResolved.has_serials && (
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">IMEI / Serial Numbers</p>
                  <div className="mt-2 space-y-1 max-h-28 overflow-y-auto custom-scrollbar pr-1">
                    {serialsLoading && <p className="text-xs text-slate-500">Loading serials...</p>}
                    {!serialsLoading && selectedSerials.length === 0 && <p className="text-xs text-slate-500">No serials added yet.</p>}
                    {!serialsLoading && selectedSerials.map((s) => (
                      <div key={s.id} className="flex items-center justify-between rounded bg-white/[0.03] px-2 py-1">
                        <span className="font-mono text-xs text-slate-200">{s.serial_number}</span>
                        <span className="text-[10px] uppercase text-slate-400">{s.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Stock Movement Logs</p>
                <div className="mt-2 space-y-1">
                  {selectedHistory.length === 0 && <p className="text-xs text-slate-500">No movement history yet.</p>}
                  {selectedHistory.map((row) => (
                    <div key={row.id} className="flex items-center justify-between text-xs">
                      <span className="text-slate-300">{row.movement_type}</span>
                      <span className={Number(row.quantity) >= 0 ? "text-emerald-300" : "text-rose-300"}>
                        {Number(row.quantity) >= 0 ? "+" : ""}{row.quantity}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </AppDrawer>

      {showAddModal && (
        <Modal title={editingProductId ? "Edit Product" : "Add Product"} onClose={() => { setShowAddModal(false); resetProductForm(); }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FieldInput label="Product Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
            <FieldSelect label="Category" value={form.category} onChange={(value) => setForm({ ...form, category: value })} options={PRODUCT_CATEGORIES} />
            <FieldInput label="Brand" value={form.brand} onChange={(value) => setForm({ ...form, brand: value })} />
            <FieldInput label="Model" value={form.model} onChange={(value) => setForm({ ...form, model: value })} />
            <FieldInput label="Storage" value={form.storage} onChange={(value) => setForm({ ...form, storage: value })} placeholder="128GB" />
            <FieldInput label="Color" value={form.color} onChange={(value) => setForm({ ...form, color: value })} />
            <FieldSelect label="Condition" value={form.condition} onChange={(value) => setForm({ ...form, condition: value })} options={["New", "Used", "Refurbished"]} />
            <FieldSelect label="Product Type" value={form.product_type} onChange={(value) => setForm({ ...form, product_type: value })} options={["Retail", "Spare Parts", "Service"]} />
            <FieldInput label="Location" value={form.location} onChange={(value) => setForm({ ...form, location: value })} placeholder="Shelf A-02" />
            <FieldInput label="Image URL" value={form.image_url} onChange={(value) => setForm({ ...form, image_url: value })} />
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Upload Image</label>
              <div className="flex items-center gap-2">
                <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" onChange={(e) => uploadImage(e.target.files?.[0])} className="w-full rounded-xl border border-white/10 bg-black/40 p-2 text-xs text-slate-200" />
                {uploadingImage && <span className="text-xs text-slate-400">Uploading...</span>}
              </div>
            </div>
            <FieldInput label="Warranty Days" type="number" value={form.warranty_days} onChange={(value) => setForm({ ...form, warranty_days: Number(value) })} />
            <FieldInput label="SKU" value={form.sku} onChange={(value) => setForm({ ...form, sku: value })} mono />
            <div>
              <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Barcode</label>
              <div className="flex gap-2">
                <input className="w-full rounded-xl border border-white/10 bg-black/40 p-2.5 text-sm text-white font-mono" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
                <button onClick={generateBarcode} className="rounded-lg border border-white/10 bg-white/5 px-2 text-slate-100"><Barcode size={14} /></button>
              </div>
            </div>
            <FieldSelect label="Supplier" value={form.supplier_id} onChange={(value) => setForm({ ...form, supplier_id: value })} options={["", ...suppliers.map((s) => String(s.id))]} optionLabels={["No Supplier", ...suppliers.map((s) => s.name)]} />
            <FieldInput label="Initial Qty" type="number" value={form.quantity} onChange={(value) => setForm({ ...form, quantity: Number(value) })} />
            <FieldInput label="Cost Price" type="number" value={form.cost_price} onChange={(value) => setForm({ ...form, cost_price: Number(value) })} />
            <FieldInput label="Selling Price" type="number" value={form.sale_price} onChange={(value) => setForm({ ...form, sale_price: Number(value) })} />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <input type="checkbox" checked={form.has_serials} onChange={(e) => setForm({ ...form, has_serials: e.target.checked })} />
            <span className="text-sm text-slate-300">Track serial numbers / IMEI</span>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={saveProduct} className="flex-1 rounded-xl bg-indigo-600 py-2 text-sm font-semibold text-white">{editingProductId ? "Update Product" : "Save Product"}</button>
          </div>
        </Modal>
      )}

      {adjustModal && (
        <Modal title={`Adjust Stock: ${adjustModal.name}`} onClose={() => setAdjustModal(null)}>
          <FieldInput label="Quantity Change (+/-)" type="number" value={adjustForm.qty} onChange={(value) => setAdjustForm({ ...adjustForm, qty: value })} />
          <FieldInput label="Reason / Note" value={adjustForm.note} onChange={(value) => setAdjustForm({ ...adjustForm, note: value })} />
          <button onClick={adjustStock} className="mt-3 w-full rounded-xl bg-amber-600 py-2 text-sm font-semibold text-white">Confirm Adjustment</button>
        </Modal>
      )}

      {serialModal && (
        <Modal title={`Add Serial: ${serialModal.name}`} onClose={() => setSerialModal(null)}>
          <FieldInput label="Serial / IMEI" value={serialForm} onChange={setSerialForm} mono />
          <button onClick={manageSerials} className="mt-3 w-full rounded-xl bg-cyan-600 py-2 text-sm font-semibold text-white">Save Serial</button>
        </Modal>
      )}
    </div>
  );
}

function InventoryTable({ rows, suppliers, getProductType, getItemThreshold, getStockStatus, selectedRows, setSelectedRows, onEdit, onAdjust, onView, onPrint, onDelete }) {
  const [sortBy, setSortBy] = useState("id");
  const [sortDir, setSortDir] = useState("desc");
  const [columnsMenuAnchor, setColumnsMenuAnchor] = useState(null);
  const [rowMenuAnchor, setRowMenuAnchor] = useState(null);
  const [rowMenuItem, setRowMenuItem] = useState(null);
  const [visibleColumns, setVisibleColumns] = useState({
    image: true,
    name: true,
    sku: true,
    barcode: true,
    category: true,
    cost: true,
    selling: true,
    stock: true,
    threshold: true,
    supplier: true,
    status: true,
  });

  const getImageUrl = (value) => {
    if (!value) return "";
    if (String(value).startsWith("http://") || String(value).startsWith("https://")) return value;
    return `${import.meta.env.VITE_API_URL || (typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1" ? "https://i-store-website-by6z.vercel.app" : "http://127.0.0.1:8000")}${value}`;
  };

  useEffect(() => {
    setSelectedRows([]);
  }, [rows]);

  const openRowMenu = (event, item) => {
    setRowMenuAnchor(event.currentTarget);
    setRowMenuItem(item);
  };

  const closeRowMenu = () => {
    setRowMenuAnchor(null);
    setRowMenuItem(null);
  };

  const supplierName = (item) => suppliers.find((s) => s.id === item.supplier_id)?.name || "Direct";

  const sortValue = (item, key) => {
    switch (key) {
      case "name":
        return String(item.name || "").toLowerCase();
      case "sku":
        return String(item.sku || "").toLowerCase();
      case "barcode":
        return String(item.barcode || "").toLowerCase();
      case "category":
        return String(item.category || "").toLowerCase();
      case "cost_price":
        return Number(item.cost_price || 0);
      case "sale_price":
        return Number(item.sale_price || 0);
      case "quantity":
        return Number(item.quantity || 0);
      case "supplier":
        return supplierName(item).toLowerCase();
      case "status":
        return String(getStockStatus(item) || "");
      case "id":
      default:
        return Number(item.id || 0);
    }
  };

  const sortedRows = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const av = sortValue(a, sortBy);
      const bv = sortValue(b, sortBy);
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [rows, sortBy, sortDir]);

  const handleSort = (key) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(key);
    setSortDir(key === "id" ? "desc" : "asc");
  };

  const HeaderCell = ({ label, sortKey, align = "left" }) => (
    <th className={`px-3 py-3 ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"}`}>
      {sortKey ? (
        <button
          type="button"
          onClick={() => handleSort(sortKey)}
          className={`inline-flex items-center gap-1 font-black uppercase tracking-widest text-slate-500 hover:text-slate-300 ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : ""}`}
        >
          {label}
          {sortBy === sortKey ? <span className="text-[9px] text-indigo-300">{sortDir === "asc" ? "Asc" : "Desc"}</span> : null}
        </button>
      ) : (
        label
      )}
    </th>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#12182a]/60">
      <div className="flex items-center justify-between border-b border-white/5 px-3 py-2">
        <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Product Inventory Grid</div>
        <button
          onClick={(e) => setColumnsMenuAnchor(e.currentTarget)}
          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-bold text-slate-300 hover:bg-white/10"
        >
          Columns
        </button>
      </div>
      <AppTableShell minWidth={760} className="rounded-none border-0 bg-black/10" aria-label="Product inventory grid">
          <AppTableHead>
            <tr>
              <th className="w-12 px-3 py-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-white/20 bg-black/30 accent-indigo-500"
                  checked={sortedRows.length > 0 && selectedRows.length === sortedRows.length}
                  onChange={(e) => setSelectedRows(e.target.checked ? sortedRows.map((r) => r.id) : [])}
                  aria-label="Select all products"
                />
              </th>
              {visibleColumns.image && <HeaderCell label="Image" />}
              {visibleColumns.name && <HeaderCell label="Product Name" sortKey="name" />}
              {visibleColumns.sku && <HeaderCell label="SKU" sortKey="sku" />}
              {visibleColumns.barcode && <HeaderCell label="Barcode" sortKey="barcode" />}
              {visibleColumns.category && <HeaderCell label="Category" sortKey="category" />}
              {visibleColumns.cost && <HeaderCell label="Cost" sortKey="cost_price" align="right" />}
              {visibleColumns.selling && <HeaderCell label="Selling" sortKey="sale_price" align="right" />}
              {visibleColumns.stock && <HeaderCell label="Stock" sortKey="quantity" align="center" />}
              {visibleColumns.threshold && <HeaderCell label="Threshold" align="center" />}
              {visibleColumns.supplier && <HeaderCell label="Supplier" sortKey="supplier" />}
              {visibleColumns.status && <HeaderCell label="Status" sortKey="status" />}
              <HeaderCell label="Actions" align="right" />
            </tr>
          </AppTableHead>
          <tbody className="divide-y divide-white/5">
            {sortedRows.length === 0 && (
              <AppTableEmptyRow colSpan={Object.values(visibleColumns).filter(Boolean).length + 2} title="No products found" text="Change filters or add a new product to the inventory." />
            )}
            {sortedRows.map((item, idx) => (
              <tr
                key={item.id ?? idx}
                className={`${selectedRows.includes(item.id) ? "bg-indigo-500/10" : ""} hover:bg-indigo-500/10`}
              >
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-white/20 bg-black/30 accent-indigo-500"
                    checked={selectedRows.includes(item.id)}
                    onChange={(e) => setSelectedRows(e.target.checked ? [...selectedRows, item.id] : selectedRows.filter((id) => id !== item.id))}
                    aria-label={`Select ${item.name}`}
                  />
                </td>
                {visibleColumns.image && <td className="px-3 py-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
                    {item.image_url ? <img src={getImageUrl(item.image_url)} alt={item.name} className="h-full w-full rounded-lg object-cover" /> : <Package size={13} className="text-slate-300" />}
                  </div>
                </td>}
                {visibleColumns.name && <td className="px-3 py-3">
                  <div>
                    <div className="font-semibold text-slate-100">{item.name}</div>
                    <div className="text-[11px] text-slate-500">{getProductType(item)}</div>
                  </div>
                </td>}
                {visibleColumns.sku && <td className="px-3 py-3"><span className="font-mono text-xs text-slate-300">{item.sku}</span></td>}
                {visibleColumns.barcode && <td className="px-3 py-3"><span className="font-mono text-xs text-slate-500">{item.barcode || "-"}</span></td>}
                {visibleColumns.category && <td className="px-3 py-3">
                  <Badge tone={item.category === "Smartphones" ? "sky" : item.category === "Displays" ? "amber" : "indigo"}>{item.category || "-"}</Badge>
                </td>}
                {visibleColumns.cost && <td className="px-3 py-3 text-right"><span className="font-medium text-slate-300">{currency(item.cost_price)}</span></td>}
                {visibleColumns.selling && <td className="px-3 py-3 text-right"><span className="font-semibold text-slate-100">{currency(item.sale_price)}</span></td>}
                {visibleColumns.stock && <td className="px-3 py-3 text-center"><span className="font-semibold text-slate-100">{item.quantity}</span></td>}
                {visibleColumns.threshold && <td className="px-3 py-3 text-center"><span className="text-xs text-slate-400">{getItemThreshold(item)}</span></td>}
                {visibleColumns.supplier && <td className="px-3 py-3"><span className="text-slate-300">{supplierName(item)}</span></td>}
                {visibleColumns.status && <td className="px-3 py-3">
                  {(() => {
                    const status = getStockStatus(item);
                    const normalized = status === "In Stock" ? "in_stock" : status === "Low Stock" ? "low_stock" : "out_of_stock";
                    return <StatusBadge status={normalized} label={status} />;
                  })()}
                </td>}
                <td className="px-3 py-3 text-right">
                  <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                    <button type="button" onClick={() => onAdjust(item)} className="grid h-8 w-8 place-items-center rounded-lg text-indigo-300 hover:bg-indigo-500/15" title="Quick adjust">
                      <Layers size={14} />
                    </button>
                    <button type="button" onClick={(e) => openRowMenu(e, item)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white" title="Actions">
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
      </AppTableShell>
      <Menu
        anchorEl={columnsMenuAnchor}
        open={Boolean(columnsMenuAnchor)}
        onClose={() => setColumnsMenuAnchor(null)}
        PaperProps={{ sx: { bgcolor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0" } }}
      >
        {Object.entries(visibleColumns).map(([key, value]) => (
          <MenuItem key={key} onClick={() => setVisibleColumns((prev) => ({ ...prev, [key]: !prev[key] }))} sx={{ gap: 1 }}>
            <input
              type="checkbox"
              checked={value}
              readOnly
              className="h-4 w-4 rounded border-white/20 bg-black/30 accent-indigo-500"
            />
            {key === "name" ? "Product Name" : key.charAt(0).toUpperCase() + key.slice(1)}
          </MenuItem>
        ))}
      </Menu>
      <Menu
        anchorEl={rowMenuAnchor}
        open={Boolean(rowMenuAnchor)}
        onClose={closeRowMenu}
        PaperProps={{ sx: { bgcolor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0" } }}
      >
        <MenuItem onClick={() => { if (rowMenuItem) onView(rowMenuItem); closeRowMenu(); }}>View Details</MenuItem>
        <MenuItem onClick={() => { if (rowMenuItem) onEdit(rowMenuItem); closeRowMenu(); }}>Edit Product</MenuItem>
        <MenuItem onClick={() => { if (rowMenuItem) onPrint(rowMenuItem); closeRowMenu(); }}>Print Label</MenuItem>
        <MenuItem onClick={() => { if (rowMenuItem) onDelete(rowMenuItem); closeRowMenu(); }}>Delete</MenuItem>
      </Menu>
    </div>
  );
}

function InventoryGrid({ rows, getStockStatus, onView, onAdjust, onPrint }) {
  const getImageUrl = (value) => {
    if (!value) return "";
    if (String(value).startsWith("http://") || String(value).startsWith("https://")) return value;
    return `${import.meta.env.VITE_API_URL || (typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1" ? "https://i-store-website-by6z.vercel.app" : "http://127.0.0.1:8000")}${value}`;
  };
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {rows.map((item) => {
        const status = getStockStatus(item);
        return (
          <div key={item.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-black/25">
                  {item.image_url ? (
                    <img src={getImageUrl(item.image_url)} alt={item.name} className="h-full w-full rounded-lg object-cover" />
                  ) : (
                    <Package size={14} className="text-slate-200" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-100">{item.name}</p>
                  <p className="text-xs font-mono text-slate-500">{item.sku}</p>
                </div>
              </div>
              <StatusBadge status={status === "In Stock" ? "in_stock" : status === "Low Stock" ? "low_stock" : "out_of_stock"} label={status} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
              <p className="text-slate-500">Selling</p><p className="text-right text-slate-100">{currency(item.sale_price)}</p>
              <p className="text-slate-500">Stock</p><p className="text-right text-slate-100">{item.quantity}</p>
            </div>
            <div className="mt-2 flex gap-1">
              <SmallBtn label="Details" onClick={() => onView(item)} />
              <SmallBtn label="Adjust" onClick={() => onAdjust(item)} />
              <SmallBtn label="Print" onClick={() => onPrint(item)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function IconBtn({ children, onClick, title, danger = false }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`rounded-md border p-1.5 transition-colors ${danger ? "border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20" : "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.1]"}`}
    >
      {children}
    </button>
  );
}

function SmallBtn({ label, onClick }) {
  return <button onClick={onClick} className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200">{label}</button>;
}

function InfoRow({ label, value, mono = false }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-sm text-slate-100 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <AppModal
      open
      onClose={onClose}
      title={title}
      panelClassName="max-w-xl"
    >
      <div className="p-4">{children}</div>
    </AppModal>
  );
}

function FieldInput({ label, value, onChange, type = "text", mono = false, placeholder = "" }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</label>
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={`w-full rounded-xl border border-white/10 bg-black/40 p-2.5 text-sm text-white ${mono ? "font-mono" : ""}`} />
    </div>
  );
}

function FieldSelect({ label, value, onChange, options, optionLabels }) {
  return (
    <div>
      <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</label>
      <Select value={value} onChange={(e) => onChange(e.target.value)} className="repair-select w-full rounded-xl border border-white/10 bg-black/40 p-2.5 text-sm text-white">
        {options.map((valueOpt, idx) => (
          <option key={`${valueOpt}-${idx}`} value={valueOpt}>
            {optionLabels ? optionLabels[idx] : valueOpt}
          </option>
        ))}
      </Select>
    </div>
  );
}


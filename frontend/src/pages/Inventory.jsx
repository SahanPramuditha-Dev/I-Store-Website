import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api, { API_BASE_URL } from "../lib/api";
import { runWithApproval } from "../lib/approvalFlow";
import { openPrintCenter } from "../lib/printCenter";
import { useCachedQuery } from "../hooks/useCachedQuery";
import { apiService } from "../lib/apiService";
import { AppTableEmptyRow, AppTableHead, AppTableShell, Badge, Button, ErrorState, KpiCard, Loading, PageHeader, Select, SearchableSelect, StatusBadge } from "../components/UI";
import AppDrawer from "../components/layout/AppDrawer";
import AppModal from "../components/layout/AppModal";
import { BarcodeStickerModal } from "../components/BarcodeStickerModal";
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
  Sparkles,
} from "lucide-react";
import { useFeedback } from "../components/FeedbackProvider";
import { useCapabilities } from "../context/CapabilityContext";

const LOW_STOCK_THRESHOLD = 3;
const RECENT_DAYS = 30;
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
  const [showAIRestockModal, setShowAIRestockModal] = useState(false);
  const [aiRestockPlan, setAiRestockPlan] = useState(null);
  const [loadingAIRestock, setLoadingAIRestock] = useState(false);

  const fetchAIRestockPlan = async () => {
    setLoadingAIRestock(true);
    setShowAIRestockModal(true);
    try {
      const res = await api.get("/api/ai/inventory-forecast");
      setAiRestockPlan(res.data);
    } catch (err) {
      toast("Failed to generate AI restock plan", "error");
    } finally {
      setLoadingAIRestock(false);
    }
  };

  const [viewMode, setViewMode] = useState("list");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const searchRef = useRef(null);

  const [inventoryItems, setInventoryItems] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({
        page: String(page),
        page_size: String(pageSize),
      });
      if (query.trim()) q.append("search", query.trim());
      if (categoryFilter && categoryFilter !== "All") q.append("category", categoryFilter);
      if (supplierFilter && supplierFilter !== "All") q.append("supplier_id", supplierFilter);

      const res = await api.get(`/inventory?${q.toString()}`, { timeout: 10000, __retryCount: 2 });
      setInventoryItems(res.data || []);
      setTotalCount(parseInt(res.headers["x-total-count"] || res.headers["X-Total-Count"] || "0", 10));
    } catch (err) {
      setError(err.userMessage || err.message || "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, query, categoryFilter, supplierFilter]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  const { data: masterProductsData, loading: loadingMasterProducts } = useCachedQuery(
    "catalog-master-products",
    () => api.get("/catalog/products").then((res) => res.data || [])
  );

  const { data: productTypesData } = useCachedQuery(
    "catalog-product-types",
    () => api.get("/catalog/product-types").then((res) => res.data || [])
  );

  const { data: categoriesData } = useCachedQuery(
    "inventory-categories",
    () => api.get("/inventory/categories").then((res) => res.data || [])
  );

  const { data: brandsData } = useCachedQuery(
    "inventory-brands",
    () => api.get("/inventory/brands").then((res) => res.data || [])
  );

  const { data: suppliersData } = useCachedQuery(
    "inventory-suppliers",
    () => api.get("/inventory/suppliers").then((res) => res.data || [])
  );

  const { data: movementsData } = useCachedQuery(
    "inventory-movements",
    () => api.get("/inventory/movements?limit=100").then((res) => res.data || [])
  );

  const masterProductsList = masterProductsData || [];
  const productTypesList = productTypesData || [];

  const suppliers = suppliersData || [];
  const movements = movementsData || [];
  const categoryOptions = useMemo(() => {
    const names = (categoriesData || [])
      .map((row) => String(row?.name || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    return Array.from(new Set(names));
  }, [categoriesData]);
  const brandOptions = useMemo(() => {
    const names = (brandsData || [])
      .map((row) => String(row?.name || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    return Array.from(new Set(names));
  }, [brandsData]);
  const inventoryData = useMemo(() => ({ items: inventoryItems, total: totalCount }), [inventoryItems, totalCount]);
  const data = inventoryItems;

  const setCacheData = (updater) => {
    setInventoryItems((prev) => (typeof updater === "function" ? updater(prev) : (updater?.items ?? updater)));
  };
  const setData = setCacheData;

  const [editingProductId, setEditingProductId] = useState(null);
  const [detailsDrawer, setDetailsDrawer] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedProductRows, setSelectedProductRows] = useState([]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [adjustModal, setAdjustModal] = useState(null);
  const [serialModal, setSerialModal] = useState(null);

  const [form, setForm] = useState({
    master_product_id: "",
    selected_variant_id: "",
    name: "",
    category: "",
    brand: "",
    model: "",
    storage: "",
    color: "",
    condition: "New",
    product_type: "",
    location: "",
    image_url: "",
    warranty_days: 0,
    shop_warranty_days: 0,
    supplier_warranty_days: 0,
    sku: "",
    quantity: 0,
    cost_price: 0,
    sale_price: 0,
    wholesale_price: 0,
    min_allowed_price: 0,
    low_stock_threshold: 5,
    barcode: "",
    supplier_id: "",
    has_serials: false,
    unit_of_measure: "pcs",
    is_weighted: false,
    allow_decimal_qty: false,
    batch_number: "",
    expiry_date: "",
  });
  const [adjustForm, setAdjustForm] = useState({ qty: 0, note: "" });
  const [serialForm, setSerialForm] = useState("");
  const [selectedSerials, setSelectedSerials] = useState([]);
  const [serialsLoading, setSerialsLoading] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [stickerModalItem, setStickerModalItem] = useState(null);
  const [selectedSerialDetail, setSelectedSerialDetail] = useState(null);

  const emptyProductForm = {
    master_product_id: "",
    selected_variant_id: "",
    name: "",
    category: "",
    brand: "",
    model: "",
    storage: "",
    color: "",
    condition: "New",
    product_type: "",
    location: "",
    image_url: "",
    warranty_days: 0,
    shop_warranty_days: 0,
    supplier_warranty_days: 0,
    sku: "",
    quantity: 0,
    cost_price: 0,
    sale_price: 0,
    wholesale_price: 0,
    min_allowed_price: 0,
    low_stock_threshold: 5,
    barcode: "",
    supplier_id: "",
    has_serials: false,
    unit_of_measure: "pcs",
    is_weighted: false,
    allow_decimal_qty: false,
    batch_number: "",
    expiry_date: "",
  };

  const resetProductForm = () => {
    setEditingProductId(null);
    setForm({ ...emptyProductForm });
  };

  useEffect(() => {
    if (!showAddModal) return;
    if (!form.category) return;
    if (categoryOptions.includes(form.category)) return;
    setForm((prev) => ({ ...prev, category: "" }));
  }, [categoryOptions, form.category, showAddModal]);

  const categoryFieldOptions = useMemo(() => {
    if (!form.category) return categoryOptions;
    return categoryOptions.includes(form.category) ? categoryOptions : [form.category, ...categoryOptions];
  }, [categoryOptions, form.category]);

  const brandFieldOptions = useMemo(() => {
    if (!form.brand) return brandOptions;
    return brandOptions.includes(form.brand) ? brandOptions : [form.brand, ...brandOptions];
  }, [brandOptions, form.brand]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
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

  useEffect(() => {
    if (!location.state?.openAddProduct) return;
    setShowAddModal(true);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate]);

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
      // Strip UI-only fields and sanitize types before sending to API
      const { selected_variant_id, ...formData } = form;
      const payload = {
        ...formData,
        master_product_id: formData.master_product_id ? Number(formData.master_product_id) : null,
        supplier_id: formData.supplier_id ? Number(formData.supplier_id) : null,
        warranty_days: Number(formData.shop_warranty_days || formData.warranty_days || 0),
        shop_warranty_days: Number(formData.shop_warranty_days || 0),
        supplier_warranty_days: Number(formData.supplier_warranty_days || 0),
        quantity: Number(formData.quantity || 0),
        cost_price: Number(formData.cost_price || 0),
        sale_price: Number(formData.sale_price || 0),
        wholesale_price: Number(formData.wholesale_price || 0),
        min_allowed_price: Number(formData.min_allowed_price || 0),
        low_stock_threshold: Number(formData.low_stock_threshold || 5),
      };
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
    } catch (err) {
      const serverMsg = err?.response?.data?.detail || err?.response?.data?.message;
      toast(serverMsg || (editingProductId ? "Failed to update product" : "Failed to add product"), "error");
      console.error(err?.response?.data || err);
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
    setStickerModalItem(item);
  };

  const generateSku = () => {
    const brandCode = (form.brand || "IST").substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, "X");
    const modelCode = (form.model || "PRD").substring(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "X");
    const storageCode = (form.storage || "").replace(/\s+/g, "").toUpperCase();
    const colorCode = (form.color || "").substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    
    let parts = [brandCode, modelCode];
    if (storageCode) parts.push(storageCode);
    if (colorCode) parts.push(colorCode);
    parts.push(randomSuffix);

    const generated = parts.join("-");
    setForm((prev) => ({ ...prev, sku: generated }));
  };

  const generateBarcode = () => {
    const seed = `${form.sku || "IST"}${Date.now().toString().slice(-6)}`.toUpperCase().replace(/\s+/g, "");
    setForm((prev) => ({ ...prev, barcode: seed }));
  };

  const getImageUrl = (value) => {
    if (!value) return "";
    if (String(value).startsWith("http://") || String(value).startsWith("https://")) return value;
    return `${API_BASE_URL}${value}`;
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

  if (loading && inventoryItems.length === 0) return <Loading text="Loading inventory..." />;
  if (error && inventoryItems.length === 0) {
    return (
      <ErrorState
        title="Inventory unavailable"
        text={error}
        action={<Button onClick={fetchInventory}>Retry</Button>}
      />
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 max-w-full flex-col gap-4 overflow-x-clip overflow-y-auto pb-2 xl:h-full">
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Total Products" value={String(stats.totalProducts)} hint="Catalog count" tone="sky" icon={<Boxes size={18} />} />
        <KpiCard title="Low Stock Items" value={String(stats.low)} hint="Need replenishment" tone="amber" icon={<AlertTriangle size={18} />} />
        <KpiCard title="Inventory Value" value={currency(stats.value)} hint="Cost basis" tone="indigo" icon={<Layers size={18} />} />
        <KpiCard title="Spare Parts Count" value={String(stats.spareParts)} hint="Repair parts" tone="green" icon={<Wand2 size={18} />} />
      </section>

      <div className="min-h-0 flex-1">
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 shadow-sm dark:shadow-none backdrop-blur-md">
          <div className="p-6 border-b border-slate-200 dark:border-white/5 space-y-4 bg-slate-50/50 dark:bg-white/[0.01]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative group flex-1 min-w-[220px] xl:min-w-[280px]">
                <Search size={18} className="absolute left-4 top-3.5 text-slate-400 dark:text-slate-500 group-focus-within:text-indigo-600 dark:group-focus-within:text-indigo-400 transition-colors" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setPage(1); }}
                  placeholder="Search by product, SKU, barcode, category"
                  className="w-full bg-white dark:bg-[#0f172a] border border-slate-300 dark:border-white/10 rounded-xl py-3 pl-12 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 transition-all"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="repair-select h-11 min-w-[130px] max-w-[180px] !w-auto bg-white dark:bg-[#0f172a] border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-xs">
                  <option value="All">All Status</option>
                  <option value="In Stock">In Stock</option>
                  <option value="Low Stock">Low Stock</option>
                  <option value="Out of Stock">Out of Stock</option>
                </Select>
                <Select value={supplierFilter} onChange={(e) => { setSupplierFilter(e.target.value); setPage(1); }} className="repair-select h-11 min-w-[130px] max-w-[180px] !w-auto bg-white dark:bg-[#0f172a] border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-xs">
                  <option value="All">All Suppliers</option>
                  {suppliers.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                </Select>
                <Select value={productTypeFilter} onChange={(e) => { setProductTypeFilter(e.target.value); setPage(1); }} className="repair-select h-11 min-w-[120px] max-w-[165px] !w-auto bg-white dark:bg-[#0f172a] border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-xs">
                  <option value="All">All Type</option>
                  <option value="Retail">Retail</option>
                  <option value="Spare Parts">Spare Parts</option>
                  <option value="Service">Service</option>
                </Select>
                <Select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }} className="repair-select h-11 min-w-[130px] max-w-[190px] !w-auto bg-white dark:bg-[#0f172a] border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-xs">
                  <option value="All">All Categories</option>
                  {categoryOptions.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </Select>
                <Select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="repair-select h-11 min-w-[130px] max-w-[180px] !w-auto bg-white dark:bg-[#0f172a] border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-xs">
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
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition ${
                      quickFilter === pill 
                        ? "bg-indigo-50 text-indigo-700 border border-indigo-300 dark:bg-indigo-500/30 dark:text-indigo-200 dark:border-indigo-400/40" 
                        : "bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-white/10 hover:text-slate-950 dark:hover:text-white"
                    }`}
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
                  className="px-3 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10 text-[11px] font-bold transition"
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
                  className="px-3 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10 text-[11px] font-bold transition"
                >
                  Export PDF
                </button>
                <button onClick={fetchAIRestockPlan} className="px-3 h-9 rounded-lg bg-purple-50 hover:bg-purple-100 dark:bg-gradient-to-r dark:from-purple-600/30 dark:to-indigo-600/30 border border-purple-200 dark:border-purple-500/40 text-purple-700 dark:text-purple-200 text-[11px] font-bold transition flex items-center gap-1.5 shadow-sm">
                  <Sparkles size={14} className="text-purple-600 dark:text-purple-300 animate-pulse" />
                  AI Restock Plan
                </button>
                <button onClick={bulkRestock} className="px-3 h-9 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:hover:bg-indigo-500/25 text-indigo-700 dark:text-indigo-200 border border-indigo-200 dark:border-transparent text-[11px] font-bold transition">Bulk Restock</button>
                <button onClick={bulkMarkOutOfStock} className="px-3 h-9 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-200 border border-emerald-200 dark:border-transparent text-[11px] font-bold transition">Bulk Out Of Stock</button>
                <Select className="repair-select h-9 min-w-[150px] max-w-[220px] !w-auto bg-white dark:bg-[#0f172a] border border-slate-300 dark:border-white/10 text-slate-900 dark:text-white text-xs" onChange={(e) => assignSupplierBulk(e.target.value)}>
                  <option value="">Assign Supplier (bulk)</option>
                  {suppliers.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                </Select>
                <div className="h-7 w-[1px] bg-slate-200 dark:bg-white/10 mx-1 hidden lg:block" />
                <div className="flex items-center p-1 bg-slate-100 dark:bg-[#0f172a] rounded-xl border border-slate-200 dark:border-white/5">
                  <button onClick={() => setViewMode("list")} className={`p-1.5 rounded-lg transition-all ${viewMode === "list" ? "bg-indigo-600 text-white shadow-md" : "text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white"}`}><List size={17} /></button>
                  <button onClick={() => setViewMode("grid")} className={`p-1.5 rounded-lg transition-all ${viewMode === "grid" ? "bg-indigo-600 text-white shadow-md" : "text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white"}`}><Grid3X3 size={17} /></button>
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
                  masterProductsList={masterProductsList}
                  getProductType={getProductType}
                  getItemThreshold={getItemThreshold}
                  getStockStatus={getStockStatus}
                  selectedRows={selectedProductRows}
                  setSelectedRows={setSelectedProductRows}
                  onEdit={(item) => {
                    setEditingProductId(item.id);
                    setForm({
                      master_product_id: item.master_product_id ? String(item.master_product_id) : "",
                      selected_variant_id: item.variant_id ? String(item.variant_id) : "",
                      name: item.name,
                      category: item.category || "",
                      brand: item.brand || "",
                      model: item.model || "",
                      storage: item.storage || "",
                      color: item.color || "",
                      condition: item.condition || "New",
                      product_type: item.product_type || "",
                      location: item.location || "",
                      image_url: item.image_url || "",
                      warranty_days: Number(item.warranty_days || 0),
                      shop_warranty_days: Number(item.shop_warranty_days || item.warranty_days || 0),
                      supplier_warranty_days: Number(item.supplier_warranty_days || 0),
                      sku: item.sku,
                      quantity: item.quantity,
                      cost_price: item.cost_price || 0,
                      sale_price: item.sale_price || 0,
                      wholesale_price: item.wholesale_price || 0,
                      min_allowed_price: item.min_allowed_price || 0,
                      low_stock_threshold: item.low_stock_threshold || 5,
                      barcode: item.barcode || "",
                      supplier_id: item.supplier_id ? String(item.supplier_id) : "",
                      has_serials: Boolean(item.has_serials),
                      unit_of_measure: item.unit_of_measure || "pcs",
                      is_weighted: Boolean(item.is_weighted),
                      allow_decimal_qty: Boolean(item.allow_decimal_qty),
                      batch_number: item.batch_number || "",
                      expiry_date: item.expiry_date ? String(item.expiry_date).slice(0, 10) : "",
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
                      <div 
                        key={s.id} 
                        className="flex items-center justify-between rounded bg-white/[0.03] px-2 py-1 cursor-pointer hover:bg-white/10"
                        onClick={() => setSelectedSerialDetail(s)}
                      >
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
        <Modal
          title={editingProductId ? "Edit Product (SKU)" : "Add Product (SKU)"}
          panelClassName="max-w-3xl"
          onClose={() => { setShowAddModal(false); resetProductForm(); }}
        >
          <div className="space-y-4">
            {/* Step 1: Master Product & Variant Preset Selection Banner */}
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/40 p-3.5 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-indigo-300">
                  1. Master Product Family (Optional Link)
                </label>
                <SearchableSelect
                  value={form.master_product_id}
                  placeholder="-- No Master Product (Standalone SKU) --"
                  searchPlaceholder="Search master products..."
                  onChange={(e) => {
                    const mpId = e.target.value;
                    const selectedMp = masterProductsList.find((mp) => String(mp.id) === String(mpId));
                    if (selectedMp) {
                      setForm((prev) => ({
                        ...prev,
                        master_product_id: mpId,
                        selected_variant_id: "",
                        name: selectedMp.name,
                        brand: selectedMp.brand || prev.brand,
                        category: selectedMp.category || prev.category,
                        storage: "",
                        color: "",
                        image_url: selectedMp.master_image_url || prev.image_url || "",
                      }));
                    } else {
                      setForm((prev) => ({ ...prev, master_product_id: "", selected_variant_id: "", storage: "", color: "" }));
                    }
                  }}
                  className="w-full"
                  options={masterProductsList.map((mp) => {
                    const vCount = mp.variants?.length || 0;
                    return {
                      value: String(mp.id),
                      label: `${mp.name}${mp.brand ? ` (${mp.brand})` : ""} - ${vCount} variant${vCount === 1 ? "" : "s"}`,
                    };
                  })}
                />
                {(!masterProductsList.length && !loadingMasterProducts) && (
                  <p className="mt-2 text-xs text-slate-400">No master products have been created yet.</p>
                )}
                {loadingMasterProducts && (
                  <p className="mt-2 text-xs text-slate-400">Loading master products...</p>
                )}
              </div>

              {Boolean(form.master_product_id) && (() => {
                const selectedMp = masterProductsList.find((mp) => String(mp.id) === String(form.master_product_id));
                const mpVariants = selectedMp?.variants || [];
                if (mpVariants.length === 0) return null;
                return (
                  <div className="pt-2.5 border-t border-indigo-500/20">
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-amber-300">
                      2. Pick Variant Preset SKU
                    </label>
                    <SearchableSelect
                      value={form.selected_variant_id}
                      placeholder="-- Select Variant Preset --"
                      searchPlaceholder="Search variant presets..."
                      onChange={(e) => {
                        const varId = e.target.value;
                        const v = mpVariants.find((varItem) => String(varItem.id) === String(varId));
                        if (v) {
                          const attrs = v.attributes || {};
                          const attrStr = Object.entries(attrs).map(([k, val]) => `${k}: ${val}`).join(" | ");
                          setForm((prev) => ({
                            ...prev,
                            selected_variant_id: varId,
                            name: v.display_name || prev.name,
                            brand: selectedMp?.brand || prev.brand,
                            category: selectedMp?.category || prev.category,
                            storage: attrs.Storage || attrs.Length || attrs["Case Size"] || prev.storage,
                            color: attrs.Color || attrs["Band Color"] || prev.color,
                            sku: v.sku || prev.sku,
                            barcode: v.barcode || prev.barcode,
                            cost_price: v.default_cost_price ?? prev.cost_price,
                            sale_price: v.default_selling_price ?? prev.sale_price,
                            wholesale_price: v.default_wholesale_price ?? prev.wholesale_price,
                            min_allowed_price: v.min_allowed_price ?? prev.min_allowed_price,
                            shop_warranty_days: v.shop_warranty_days ?? prev.shop_warranty_days,
                            warranty_days: v.shop_warranty_days ?? prev.warranty_days,
                            supplier_warranty_days: v.supplier_warranty_days ?? prev.supplier_warranty_days,
                          }));
                          toast(`Loaded variant: ${v.display_name || v.sku} ${attrStr ? `(${attrStr})` : ""}`, "info");
                        } else {
                          setForm((prev) => ({ ...prev, selected_variant_id: "" }));
                        }
                      }}
                      className="w-full font-mono text-amber-200"
                      options={mpVariants.map((v) => {
                        const attrs = v.attributes || {};
                        const attrStr = Object.entries(attrs).map(([k, val]) => `${k}: ${val}`).join(", ");
                        return {
                          value: String(v.id),
                          label: `${v.display_name || v.sku} ${attrStr ? `[${attrStr}]` : ""} (SKU: ${v.sku} | Rs. ${v.default_selling_price})`,
                        };
                      })}
                    />
                  </div>
                );
              })()}
            </div>

            {/* Smart Specification Banner if Master Product Selected */}
            {Boolean(form.master_product_id) && (
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-indigo-200">
                  <Sparkles size={16} className="text-indigo-400" />
                  <span>
                    Linked to Master Family: <strong className="text-white">{form.name}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {form.category && <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[10px] font-bold text-slate-300">{form.category}</span>}
                  {form.brand && <span className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-[10px] font-bold text-indigo-300 border border-indigo-500/30">{form.brand}</span>}
                </div>
              </div>
            )}

            {/* Form Fields: Smart Dynamic Layout */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* Product Name (Always Shown) */}
              <FieldInput label="Product Name / SKU Title" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
              
              {/* Category & Brand */}
              <FieldSelect label="Category" value={form.category} onChange={(value) => setForm({ ...form, category: value })} options={categoryFieldOptions} />
              <FieldSelect label="Brand" value={form.brand} onChange={(value) => setForm({ ...form, brand: value })} options={brandFieldOptions} />

              {/* Show Custom Specifications Inputs ONLY if NOT linked to a Master Product */}
              {!form.master_product_id && (
                <>
                  <FieldInput 
                    label={hasCapability("size_color_variants") ? "Size / Dimension" : "Specification / Size"} 
                    value={form.storage} 
                    onChange={(value) => setForm({ ...form, storage: value })} 
                    placeholder={hasCapability("size_color_variants") ? "e.g. S, M, L, XL, 32, 42" : "e.g. 128GB, 2 Meter, 45mm"} 
                  />
                  <FieldInput 
                    label={hasCapability("size_color_variants") ? "Color / Pattern" : "Color / Finish"} 
                    value={form.color} 
                    onChange={(value) => setForm({ ...form, color: value })} 
                    placeholder={hasCapability("size_color_variants") ? "e.g. Navy Blue, Floral, Black" : "e.g. Black, Silver"} 
                  />
                  {hasCapability("season_management") && (
                    <FieldInput 
                      label="Season / Collection" 
                      value={form.model || ""} 
                      onChange={(value) => setForm({ ...form, model: value })} 
                      placeholder="e.g. Summer 2026, Festive Edition" 
                    />
                  )}
                  {!hasCapability("season_management") && (
                    <FieldInput label="Model / Sub-Variant" value={form.model} onChange={(value) => setForm({ ...form, model: value })} placeholder="e.g. Pro, Slim, 2M" />
                  )}
                </>
              )}

              {/* System & Stock Behavior Fields */}
              <FieldSelect label="Condition" value={form.condition} onChange={(value) => setForm({ ...form, condition: value })} options={["New", "Used", "Refurbished"]} />
              <FieldSelect
                label="Product Type"
                value={form.product_type}
                onChange={(value) => setForm({ ...form, product_type: value })}
                options={productTypesList.length > 0 ? productTypesList.map((pt) => pt.name) : ["Mobile Phone", "Accessory", "Spare Part", "Service"]}
              />
              <FieldInput label="Shelf / Bin Location" value={form.location} onChange={(value) => setForm({ ...form, location: value })} placeholder="Shelf A-02" />

              {/* Stock Quantities & Financial Prices */}
              <FieldInput label="Initial Stock Qty" type="number" value={form.quantity} onChange={(value) => setForm({ ...form, quantity: Number(value) })} />
              <FieldInput label="Cost Price (Rs.)" type="number" value={form.cost_price} onChange={(value) => setForm({ ...form, cost_price: Number(value) })} />
              <FieldInput label="Retail Selling Price (Rs.)" type="number" value={form.sale_price} onChange={(value) => setForm({ ...form, sale_price: Number(value) })} />
              <FieldInput label="Wholesale Price (Rs.)" type="number" value={form.wholesale_price} onChange={(value) => setForm({ ...form, wholesale_price: Number(value) })} placeholder="B2B Dealer Price" />
              <FieldInput label="Min Allowed Price (Floor Guard)" type="number" value={form.min_allowed_price} onChange={(value) => setForm({ ...form, min_allowed_price: Number(value) })} placeholder="Minimum checkout price" />
              <FieldInput label="Low Stock Threshold Alert" type="number" value={form.low_stock_threshold} onChange={(value) => setForm({ ...form, low_stock_threshold: Number(value) })} />

              {/* Identifiers (SKU & Barcode) */}
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">SKU Code</label>
                <div className="flex gap-2">
                  <input className="w-full rounded-xl border border-white/10 bg-black/40 p-2.5 text-sm text-white font-mono placeholder-slate-600" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="e.g. APP-IP15-128-9842" />
                  {!form.master_product_id && (
                    <button type="button" onClick={generateSku} title="Auto-generate SKU" className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-600/20 px-3 text-xs font-semibold text-indigo-300 hover:bg-indigo-600/40">
                      <Wand2 size={14} /> Auto
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Barcode</label>
                <div className="flex gap-2">
                  <input className="w-full rounded-xl border border-white/10 bg-black/40 p-2.5 text-sm text-white font-mono" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
                  <button type="button" onClick={generateBarcode} title="Auto-generate Barcode" className="rounded-lg border border-white/10 bg-white/5 px-2.5 text-slate-100 hover:bg-white/10"><Barcode size={14} /></button>
                </div>
              </div>

              {/* Multi-Industry Additive Fields */}
              {hasCapability("batch_tracking") && (
                <FieldInput label="Batch / Lot Number" value={form.batch_number || ""} onChange={(value) => setForm({ ...form, batch_number: value })} placeholder="e.g. BATCH-2026-X" />
              )}
              {hasCapability("expiry_tracking") && (
                <FieldInput label="Expiry Date" type="date" value={form.expiry_date || ""} onChange={(value) => setForm({ ...form, expiry_date: value })} />
              )}
              {hasCapability("unit_conversions") && (
                <FieldSelect label="Unit of Measure" value={form.unit_of_measure || "pcs"} onChange={(value) => setForm({ ...form, unit_of_measure: value })} options={["pcs", "kg", "g", "l", "ml", "m", "pair", "box"]} />
              )}

              {/* Supplier & Warranty Breakdown */}
              <FieldSelect label="Supplier" value={form.supplier_id} onChange={(value) => setForm({ ...form, supplier_id: value })} options={["", ...suppliers.map((s) => String(s.id))]} optionLabels={["No Supplier", ...suppliers.map((s) => s.name)]} />
              
              {hasCapability("warranty_management") && (
                <>
                  <FieldInput label="Shop Warranty (Days)" type="number" value={form.shop_warranty_days || form.warranty_days} onChange={(value) => setForm({ ...form, shop_warranty_days: Number(value), warranty_days: Number(value) })} />
                  <FieldInput label="Supplier / Brand Warranty (Days)" type="number" value={form.supplier_warranty_days} onChange={(value) => setForm({ ...form, supplier_warranty_days: Number(value) })} />
                </>
              )}

              {/* Image Input */}
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Upload Image</label>
                <div className="flex items-center gap-2">
                  <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp" onChange={(e) => uploadImage(e.target.files?.[0])} className="w-full rounded-xl border border-white/10 bg-black/40 p-2 text-xs text-slate-200" />
                  {uploadingImage && <span className="text-xs text-slate-400">Uploading...</span>}
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
              <div className="flex flex-wrap items-center gap-4">
                {(hasCapability("imei_tracking") || hasCapability("serial_tracking")) && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" className="h-4 w-4 rounded border-white/20 bg-slate-900 text-indigo-600 focus:ring-indigo-500/30" checked={form.has_serials} onChange={(e) => setForm({ ...form, has_serials: e.target.checked })} />
                    <span className="text-xs font-semibold text-slate-300">Serial / IMEI tracking</span>
                  </label>
                )}
                {hasCapability("weighted_products") && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" className="h-4 w-4 rounded border-white/20 bg-slate-900 text-indigo-600 focus:ring-indigo-500/30" checked={form.is_weighted} onChange={(e) => setForm({ ...form, is_weighted: e.target.checked })} />
                    <span className="text-xs font-semibold text-slate-300">Weighted Product</span>
                  </label>
                )}
                {hasCapability("decimal_quantities") && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" className="h-4 w-4 rounded border-white/20 bg-slate-900 text-indigo-600 focus:ring-indigo-500/30" checked={form.allow_decimal_qty} onChange={(e) => setForm({ ...form, allow_decimal_qty: e.target.checked })} />
                    <span className="text-xs font-semibold text-slate-300">Allow Decimal Qty</span>
                  </label>
                )}
              </div>

              <div className="flex gap-2">
                <button type="button" onClick={() => { setShowAddModal(false); resetProductForm(); }} className="rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-xs font-bold text-slate-400 hover:bg-white/5">
                  Cancel
                </button>
                <button onClick={saveProduct} className="rounded-xl bg-indigo-600 px-6 py-2 text-xs font-bold text-white hover:bg-indigo-500">
                  {editingProductId ? "Update Product SKU" : "Save Product Stock"}
                </button>
              </div>
            </div>
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

      {showAIRestockModal && (
        <Modal title="AI Inventory Restock Plan" onClose={() => setShowAIRestockModal(false)}>
          {loadingAIRestock ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Sparkles size={32} className="animate-spin text-purple-400" />
              <p className="text-sm text-slate-300">Gemini AI is analyzing inventory sales trends and stock levels...</p>
            </div>
          ) : aiRestockPlan ? (
            <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              <div className="p-3.5 rounded-xl border border-purple-500/30 bg-purple-500/10 text-xs text-purple-200">
                <div className="flex items-center gap-2 font-bold mb-1">
                  <Sparkles size={14} className="text-purple-400" />
                  <span>Executive AI Summary</span>
                </div>
                <p>{aiRestockPlan.summary}</p>
                {aiRestockPlan.total_estimated_restock_cost && (
                  <p className="mt-2 text-xs font-semibold text-purple-300">
                    Estimated Total Restock Cost: <span className="text-emerald-400 font-mono">${aiRestockPlan.total_estimated_restock_cost.toFixed(2)}</span>
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Recommended Action Items</p>
                {aiRestockPlan.action_items?.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">No low-stock items requiring restock currently.</p>
                ) : (
                  aiRestockPlan.action_items?.map((item, idx) => (
                    <div key={idx} className="p-3 rounded-xl border border-white/10 bg-slate-900/80 flex flex-col gap-1 text-xs">
                      <div className="flex items-center justify-between font-bold text-slate-200">
                        <span className="text-white">{item.item_name} <span className="text-slate-500 font-mono text-[10px]">({item.sku})</span></span>
                        <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-extrabold ${item.priority === "Critical" ? "bg-red-500/20 text-red-300 border border-red-500/30" : item.priority === "High" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "bg-slate-500/20 text-slate-300"}`}>
                          {item.priority}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-400 mt-1">
                        <span>Suggested Order: <strong className="text-emerald-300 font-mono">{item.suggested_order_qty} units</strong></span>
                        {item.estimated_cost && <span>Est. Cost: <strong className="text-slate-200 font-mono">${Number(item.estimated_cost).toFixed(2)}</strong></span>}
                      </div>
                      <p className="text-[11px] text-slate-400 italic mt-0.5">{item.reason}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-red-400">Failed to load AI restock forecast.</p>
          )}
        </Modal>
      )}

      {selectedSerialDetail && (
        <SerialMovementHistoryModal 
          serial={selectedSerialDetail} 
          onClose={() => setSelectedSerialDetail(null)} 
        />
      )}

      {/* 1-CLICK THERMAL BARCODE & PRICE TAG STICKER MODAL */}
      <BarcodeStickerModal
        open={Boolean(stickerModalItem)}
        onClose={() => setStickerModalItem(null)}
        item={stickerModalItem}
      />
    </div>
  );
}

function InventoryTable({ rows, suppliers, masterProductsList = [], getProductType, getItemThreshold, getStockStatus, selectedRows, setSelectedRows, onEdit, onAdjust, onView, onPrint, onDelete }) {
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
    return `${API_BASE_URL}${value}`;
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#12182a]/60 shadow-sm dark:shadow-none">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-white/5 bg-slate-50/70 dark:bg-transparent px-3 py-2">
        <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-600 dark:text-slate-400">Product Inventory Grid</div>
        <button
          onClick={(e) => setColumnsMenuAnchor(e.currentTarget)}
          className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 px-3 py-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10"
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
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[11px] text-slate-400">{getProductType(item)}</span>
                      {item.master_product_id && (
                        <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold text-indigo-300 border border-indigo-500/20">
                          {masterProductsList.find((mp) => mp.id === item.master_product_id)?.name || `Master #${item.master_product_id}`}
                        </span>
                      )}
                    </div>
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
        slotProps={{ paper: { sx: { bgcolor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0" } } }}
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
        slotProps={{ paper: { sx: { bgcolor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0" } } }}
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
    return `${API_BASE_URL}${value}`;
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

function Modal({ title, onClose, children, panelClassName = "max-w-xl" }) {
  return (
    <AppModal
      open
      onClose={onClose}
      title={title}
      panelClassName={panelClassName}
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

function SerialMovementHistoryModal({ serial, onClose }) {
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const fetchMovements = async () => {
      setLoading(true);
      try {
        const res = await api.get(`/inventory/serials/${serial.id}/movements`);
        if (active) setMovements(res.data || []);
      } catch (err) {
        // Ignored or handled via global error handling
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchMovements();
    return () => { active = false; };
  }, [serial.id]);

  return (
    <Modal title={`Movement History: ${serial.serial_number}`} onClose={onClose} panelClassName="max-w-xl bg-[#0f172a]">
      {loading ? (
        <div className="flex flex-col items-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-indigo-500"></div>
          <p className="mt-2 text-xs text-slate-400">Loading movement history...</p>
        </div>
      ) : movements.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400">
          No movement history recorded.
        </div>
      ) : (
        <div className="relative border-l border-white/10 ml-3 pl-4 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {movements.map((mov, i) => {
            const isOut = Number(mov.quantity || 0) < 0 || mov.movement_type === "SALE" || mov.movement_type === "REPAIR_CONSUME";
            const dt = new Date(mov.created_at);
            return (
              <div key={mov.id || i} className="relative">
                <div className={`absolute -left-6 top-1 h-3 w-3 rounded-full border-2 border-[#0f172a] ${isOut ? "bg-rose-400" : "bg-emerald-400"}`}></div>
                <div className="rounded-lg bg-white/[0.02] border border-white/5 p-3">
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">{mov.movement_type}</span>
                    <span className="text-[10px] text-slate-500">
                      {dt.toLocaleDateString()} {dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    {mov.note || (mov.reference_type ? `${mov.reference_type} #${mov.reference_id}` : 'Manual Adjustment')}
                  </div>
                  {mov.created_by_name && (
                    <div className="text-[10px] text-slate-500 mt-1.5 flex items-center gap-1">
                      <span className="text-slate-600">By:</span> {mov.created_by_name}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}


import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import api from "../lib/api";
import { runWithApproval } from "../lib/approvalFlow";
import { openPrintCenter } from "../lib/printCenter";
import { printHtmlDocument } from "../lib/printBridge";
import { useFetch } from "../hooks/useFetch";
import { Input, Select, SearchableSelect, CustomerSelect, ProductSelect } from "../components/UI";
import { Barcode, ShoppingBasket, Search, Printer, Trash2, Plus, Minus, User, Wrench, Clock, CornerUpLeft, X, RefreshCw, Save, FolderOpen, Mail, MessageCircle, MessageSquare, Share2, CreditCard, Banknote, Wallet, Percent, Info, ImageOff, AlertCircle, Check, Eye, Zap, ChevronDown, ChevronUp, RotateCcw, Tag, PackagePlus, FileText, ShoppingCart, Boxes } from "lucide-react";
import { useFeedback } from "../components/FeedbackProvider";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import AppModal from "../components/layout/AppModal";
import { ShiftModal } from "../components/ShiftModal";
import VariantMatrixModal from "../components/pos/VariantMatrixModal";
import { useCapabilities } from "../context/CapabilityContext";

export default function POS() {
  const { toast, confirm, prompt } = useFeedback();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const barcodeRef = useRef(null);
  const productSearchRef = useRef(null);
  const customerSelectRef = useRef(null);
  const cashInputRef = useRef(null);
  const paymentRefInputRef = useRef(null);
  const repairTicketRef = useRef(null);
  const reservationRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);
  const inventoryFetch = useFetch('/inventory?limit=50');
  const categoriesFetch = useFetch('/inventory/categories');
  const suppliersFetch = useFetch('/inventory/suppliers');
  const customersFetch = useFetch('/customers?limit=100');
  const salesFetch = useFetch('/pos/sales');
  const repairsFetch = useFetch('/repairs'); // To link tickets
  const reservationsFetch = useFetch('/product-reservations');
  const { hasCapability } = useCapabilities();

  const [mode, setMode] = useState("sale"); // sale | repair | reservation
  const [activeCategory, setActiveCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [scanCode, setScanCode] = useState("");
  const [selectedCartIndex, setSelectedCartIndex] = useState(0);
  const [matrixItem, setMatrixItem] = useState(null);
  const [isMatrixOpen, setIsMatrixOpen] = useState(false);
  
  const [cart, setCart] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [customerId, setCustomerId] = useState("");
  
  const [discountMode, setDiscountMode] = useState("amount"); 
  const [discountValue, setDiscountValue] = useState(0);
  const [discountError, setDiscountError] = useState("");
  const [taxAmount, setTaxAmount] = useState(0);
  
  const [paid, setPaid] = useState(true);
  const [autoPrint, setAutoPrint] = useState(() => localStorage.getItem("pos_auto_print") === "true");
  const [cashReceived, setCashReceived] = useState("");
  const [cardAmount, setCardAmount] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [repairTicketNo, setRepairTicketNo] = useState("");
  const [reservationNo, setReservationNo] = useState("");
  const [suspendedCarts, setSuspendedCarts] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("pos_suspended_carts") || "[]");
    } catch {
      return [];
    }
  });
  const [showSuspendPicker, setShowSuspendPicker] = useState(false);
  const [showNewCustomerModal, setShowNewCustomerModal] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "", email: "", address: "" });
  const [showSaleCompleteModal, setShowSaleCompleteModal] = useState(false);
  const saleCompleteAutoCloseTimerRef = useRef(null);
  const [productDetail, setProductDetail] = useState(null);
  const [catalogRows, setCatalogRows] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [availableAdvances, setAvailableAdvances] = useState([]);
  const [selectedAdvanceMap, setSelectedAdvanceMap] = useState({});
  const [availableCredits, setAvailableCredits] = useState([]);
  const [selectedCreditMap, setSelectedCreditMap] = useState({});
  const [showRecentSales, setShowRecentSales] = useState(false);
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [currentShiftData, setCurrentShiftData] = useState(null);
  const [rightPanelTab, setRightPanelTab] = useState("checkout");

  const fetchShiftStatus = useCallback(async () => {
    try {
      const res = await api.get("/shifts/current");
      if (res.data?.has_active_shift) {
        setCurrentShiftData(res.data.shift);
      } else {
        setCurrentShiftData(null);
      }
    } catch {
      setCurrentShiftData(null);
    }
  }, []);

  useEffect(() => {
    fetchShiftStatus();
  }, [fetchShiftStatus]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddLoading, setQuickAddLoading] = useState(false);
  const [quickAddOptional, setQuickAddOptional] = useState(false);
  const [quickAddForm, setQuickAddForm] = useState({
    name: "",
    sale_price: "",
    quantity: "1",
    sku: "",
    category: "Uncategorized",
    description: "",
    cost_price: "",
    tax_rate: "",
    discount: "",
  });
  const [returnInvoiceLookup, setReturnInvoiceLookup] = useState("");
  const [returnInvoicePayload, setReturnInvoicePayload] = useState(null);
  const [selectedReturnItem, setSelectedReturnItem] = useState(null);
  const [returnQuantity, setReturnQuantity] = useState(1);
  const [returnAction, setReturnAction] = useState("refund");
  const [returnNotes, setReturnNotes] = useState("");
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnSearchBusy, setReturnSearchBusy] = useState(false);

  const subtotal = useMemo(() => cart.reduce((s, c) => s + c.quantity * c.price, 0), [cart]);
  
  const discountAmount = useMemo(() => {
    const val = Number(discountValue || 0);
    if (!subtotal) return 0;
    if (discountMode === "percent") return Math.max(0, Math.min(subtotal, (subtotal * val) / 100));
    return Math.max(0, Math.min(subtotal, val));
  }, [discountMode, discountValue, subtotal]);

  const grandTotal = useMemo(() => {
    const t = subtotal - discountAmount + Number(taxAmount || 0);
    return Math.max(0, t);
  }, [discountAmount, subtotal, taxAmount]);

  const linkedRepairForForm = useMemo(() => {
    if (mode !== "repair") return null;
    const code = String(repairTicketNo || "").trim().toLowerCase();
    if (!code) return null;
    return (repairsFetch.data || []).find((r) => String(r.ticket_no || "").toLowerCase() === code) || null;
  }, [mode, repairTicketNo, repairsFetch.data]);

  const linkedReservationForForm = useMemo(() => {
    if (mode !== "reservation") return null;
    const code = String(reservationNo || "").trim().toLowerCase();
    if (!code) return null;
    return (reservationsFetch.data || []).find((r) => String(r.reservation_number || "").toLowerCase() === code) || null;
  }, [mode, reservationNo, reservationsFetch.data]);

  const selectedAdvances = useMemo(() => (
    (availableAdvances || [])
      .map((row) => {
        const requested = Number(selectedAdvanceMap[row.id] || 0);
        const remaining = Number(row.remaining_amount || 0);
        const amount = Math.max(0, Math.min(requested, remaining));
        return {
          advance_payment_id: row.id,
          amount,
          remaining_amount: remaining,
          advance_number: row.advance_number,
        };
      })
      .filter((row) => row.amount > 0)
  ), [availableAdvances, selectedAdvanceMap]);

  const appliedAdvanceTotal = useMemo(
    () => selectedAdvances.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    [selectedAdvances]
  );

  const selectedStoreCredits = useMemo(() => (
    (availableCredits || [])
      .map((row) => {
        const requested = Number(selectedCreditMap[row.id] || 0);
        const remaining = Number(row.remaining_amount || 0);
        const amount = Math.max(0, Math.min(requested, remaining));
        return {
          store_credit_id: row.id,
          amount,
          remaining_amount: remaining,
          credit_number: row.credit_number,
        };
      })
      .filter((row) => row.amount > 0)
  ), [availableCredits, selectedCreditMap]);

  const appliedStoreCreditTotal = useMemo(
    () => selectedStoreCredits.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    [selectedStoreCredits]
  );

  const dueAfterAdvances = useMemo(
    () => Math.max(0, grandTotal - appliedAdvanceTotal),
    [grandTotal, appliedAdvanceTotal]
  );

  const dueAfterCredits = useMemo(
    () => Math.max(0, dueAfterAdvances - appliedStoreCreditTotal),
    [dueAfterAdvances, appliedStoreCreditTotal]
  );

  const change = useMemo(() => {
    if (!paid || paymentMethod !== "Cash") return 0;
    return Math.max(0, Number(cashReceived || 0) - dueAfterCredits);
  }, [cashReceived, dueAfterCredits, paid, paymentMethod]);

  const signedChange = useMemo(() => {
    // Positive = customer gave more than due (change to return)
    // Negative = customer gave less than due (balance remaining)
    return Number(cashReceived || 0) - dueAfterCredits;
  }, [cashReceived, dueAfterCredits]);

  const [lastSale, setLastSale] = useState(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [showDraftSaveModal, setShowDraftSaveModal] = useState(false);
  const [pendingSync, setPendingSync] = useState(false);
  const autoSaveTimerRef = useRef(null);
  const searchDebounceRef = useRef(null);

  useEffect(() => {
    if (saleCompleteAutoCloseTimerRef.current) {
      window.clearTimeout(saleCompleteAutoCloseTimerRef.current);
    }
  }, [showSaleCompleteModal]);
  
  const netRemaining = useMemo(() => {
    if (paymentMethod !== "Mixed") return dueAfterCredits;
    return Math.max(0, dueAfterCredits - Number(cashReceived || 0) - Number(cardAmount || 0));
  }, [paymentMethod, dueAfterCredits, cashReceived, cardAmount]);

  // Validation helpers
  const maxDiscountAllowed = useMemo(() => {
    // Compute max discount allowed from per-product limits (if present on inventory items).
    // inventoryFetch.data is expected to contain items with optional fields:
    //  - max_discount_amount (absolute LKR)
    //  - max_discount_percent (percentage of the line total)
    // Fallback to 35% of the line total when no per-product limit is set.
    const inv = inventoryFetch.data || [];
    if (!cart.length) return 0;
    let totalAllowed = 0;
    for (const c of cart) {
      const lineTotal = Number(c.quantity || 0) * Number(c.price || 0);
      if (!lineTotal) continue;
      const item = inv.find((i) => Number(i.id) === Number(c.item_id)) || {};
      const perAmount = Number(item.max_discount_amount || item.max_discount || 0);
      const perPct = Number(item.max_discount_percent || 0);
      const minAllowedPrice = Number(item.min_allowed_price || 0);
      if (perAmount > 0) {
        totalAllowed += Math.min(perAmount, lineTotal);
      } else if (perPct > 0) {
        totalAllowed += (perPct / 100) * lineTotal;
      } else if (minAllowedPrice > 0) {
        // Can't discount below the min allowed price per unit
        const qty = Number(c.quantity || 0) || 1;
        const allowedByFloor = Math.max(0, lineTotal - (minAllowedPrice * qty));
        totalAllowed += Math.min(allowedByFloor, lineTotal);
      } else {
        totalAllowed += 0.35 * lineTotal; // fallback
      }
    }
    return totalAllowed;
  }, [cart, inventoryFetch.data, subtotal]);

  const maxDiscountPercentAllowed = useMemo(() => {
    if (!subtotal) return 0;
    return (maxDiscountAllowed / subtotal) * 100;
  }, [maxDiscountAllowed, subtotal]);
  const minSellingPrice = useMemo(() => {
    return cart.map(c => {
      const inv = (inventoryFetch.data || []).find(x => x.id === c.item_id);
      if (!inv || c.is_labor) return null;
      return { item_id: c.item_id, cost: inv.cost_price || 0 };
    }).filter(Boolean);
  }, [cart, inventoryFetch.data]);

  const hasNegativeMargin = useMemo(() => {
    return minSellingPrice.some(item => {
      const cartItem = cart.find(c => c.item_id === item.item_id);
      return cartItem && cartItem.price < item.cost;
    });
  }, [cart, minSellingPrice]);

  const checkoutDisabled = mode === "return" || cart.length === 0 || hasNegativeMargin;

  const cashierSummary = useMemo(() => {
    const dayKey = (value) => {
      const date = new Date(value);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    };
    const today = dayKey(new Date());
    const todaysSales = (salesFetch.data || []).filter((s) => dayKey(s.created_at) === today && !s.is_return && !s.is_voided);
    const total = todaysSales.reduce((sum, s) => sum + Number(s.total || 0), 0);
    return { count: todaysSales.length, total };
  }, [salesFetch.data]);

  const inventoryAlerts = useMemo(() => {
    const rows = inventoryFetch.data || [];
    const out = rows.filter((row) => Number(row.quantity || 0) <= 0).slice(0, 8);
    const low = rows.filter((row) => Number(row.quantity || 0) > 0 && Number(row.quantity || 0) <= 5).slice(0, 8);
    return { out, low };
  }, [inventoryFetch.data]);

  const categoryOptions = useMemo(() => {
    const names = (categoriesFetch.data || [])
      .filter((row) => row?.is_active !== false)
      .map((row) => String(row?.name || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    return ["All", ...Array.from(new Set(names))];
  }, [categoriesFetch.data]);

  const quickAddCategoryOptions = useMemo(() => {
    const names = (categoriesFetch.data || [])
      .filter((row) => row?.is_active !== false)
      .map((row) => String(row?.name || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    return ["Uncategorized", ...Array.from(new Set(names))];
  }, [categoriesFetch.data]);

  const quickAddStats = useMemo(() => {
    const search = String(quickAddForm.name || "").trim().toLowerCase();
    const rows = inventoryFetch.data || [];
    if (!search) return { matches: 0, stockHint: null, priceHint: null };
    const match = rows.find((row) => String(row.name || "").toLowerCase().includes(search) || String(row.sku || "").toLowerCase() === search || String(row.barcode || "").toLowerCase() === search);
    return {
      matches: rows.filter((row) => String(row.name || "").toLowerCase().includes(search)).length,
      stockHint: match ? Number(match.quantity || 0) : null,
      priceHint: match ? Number(match.sale_price || 0) : null,
    };
  }, [inventoryFetch.data, quickAddForm.name]);

  const resetQuickAdd = useCallback(() => {
    setQuickAddForm({
      name: "",
      sale_price: "",
      quantity: "1",
      sku: "",
      category: "Uncategorized",
      description: "",
      cost_price: "",
      tax_rate: "",
      discount: "",
    });
    setQuickAddOptional(false);
    setQuickAddLoading(false);
  }, []);

  const handleQuickAddChange = useCallback((e) => {
    const { name, value } = e.target;
    setQuickAddForm((prev) => ({ ...prev, [name]: value }));
  }, []);

  const submitQuickAdd = useCallback(async (actionType) => {
    const name = String(quickAddForm.name || "").trim();
    if (!name) {
      toast("Product Name is required", "warning");
      return;
    }
    if (!quickAddForm.sale_price || Number(quickAddForm.sale_price) < 0) {
      toast("Valid Selling Price is required", "warning");
      return;
    }
    if (!quickAddForm.quantity || Number(quickAddForm.quantity) <= 0) {
      toast("Valid Quantity is required", "warning");
      return;
    }

    const payload = {
      ...quickAddForm,
      name,
      sale_price: Number(quickAddForm.sale_price || 0),
      quantity: Number(quickAddForm.quantity || 1),
      cost_price: Number(quickAddForm.cost_price || 0),
      tax_rate: Number(quickAddForm.tax_rate || 0),
      discount: Number(quickAddForm.discount || 0),
      action_type: actionType,
    };

    if (actionType === "temporary") {
      handleQuickAddTemporary(payload);
      setQuickAddOpen(false);
      resetQuickAdd();
      return;
    }

    try {
      setQuickAddLoading(true);
      const { data } = await api.post("/pos/quick-add-item", payload);
      handleQuickAddSaved(data);
      toast(`Item saved to ${actionType === "draft" ? "drafts" : "inventory"}`, "success");
      setQuickAddOpen(false);
      resetQuickAdd();
    } catch (err) {
      toast(err.response?.data?.detail || "Failed to save item", "error");
    } finally {
      setQuickAddLoading(false);
    }
  }, [handleQuickAddSaved, handleQuickAddTemporary, quickAddForm, resetQuickAdd, toast]);



  useEffect(() => {
    const raw = searchParams.get("sale_id");
    const saleId = Number(raw || 0);
    if (!saleId) return;
    let mounted = true;
    api
      .get(`/pos/sales/${saleId}`)
      .then(({ data }) => {
        if (!mounted) return;
        setLastSale(data);
        toast(`Loaded ${data?.invoice_no || `sale #${saleId}`}`, "info");
      })
      .catch(() => {
        if (!mounted) return;
        toast("Unable to open invoice from search", "warning");
      })
      .finally(() => {
        if (!mounted) return;
        const next = new URLSearchParams(searchParams);
        next.delete("sale_id");
        setSearchParams(next, { replace: true });
      });
    return () => {
      mounted = false;
    };
  }, [searchParams, setSearchParams, toast]);

  const lastHandledTicketRef = useRef(null);

  useEffect(() => {
    const targetMode = searchParams.get("mode");
    const ticketParam = searchParams.get("ticket");
    if (targetMode === "repair") {
      setMode("repair");
      if (ticketParam && lastHandledTicketRef.current !== ticketParam) {
        lastHandledTicketRef.current = ticketParam;
        setRepairTicketNo(ticketParam);
        loadRepairTicketToCart(ticketParam);
        const next = new URLSearchParams(searchParams);
        next.delete("mode");
        next.delete("ticket");
        setSearchParams(next, { replace: true });
      }
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const cid = Number(customerId || 0);
    if (!cid) {
      setAvailableAdvances([]);
      setSelectedAdvanceMap({});
      setAvailableCredits([]);
      setSelectedCreditMap({});
      return;
    }
    let active = true;
    const params = { customer_id: cid };
    if (linkedRepairForForm?.id) params.repair_ticket_id = linkedRepairForForm.id;
    if (linkedReservationForForm?.id) params.reservation_id = linkedReservationForForm.id;
    api.get("/pos/available-advances", { params })
      .then(({ data }) => {
        if (!active) return;
        const rows = Array.isArray(data) ? data : [];
        setAvailableAdvances(rows);
        setSelectedAdvanceMap((prev) => {
          const next = {};
          rows.forEach((row) => {
            if (prev[row.id]) next[row.id] = Math.min(Number(prev[row.id] || 0), Number(row.remaining_amount || 0));
          });
          return next;
        });
      })
      .catch(() => {
        if (!active) return;
        setAvailableAdvances([]);
        setSelectedAdvanceMap({});
      });
    api.get(`/pos/customer/${cid}/available-credits`)
      .then(({ data }) => {
        if (!active) return;
        const rows = Array.isArray(data?.rows) ? data.rows : [];
        setAvailableCredits(rows);
        setSelectedCreditMap((prev) => {
          const next = {};
          rows.forEach((row) => {
            if (prev[row.id]) next[row.id] = Math.min(Number(prev[row.id] || 0), Number(row.remaining_amount || 0));
          });
          return next;
        });
      })
      .catch(() => {
        if (!active) return;
        setAvailableCredits([]);
        setSelectedCreditMap({});
      });
    return () => {
      active = false;
    };
  }, [customerId, linkedRepairForForm?.id, linkedReservationForForm?.id]);

  useEffect(() => {
    let active = true;
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setCatalogLoading(true);
      const params = {
        q: (searchQuery || "").trim(),
        limit: 140,
      };
      if (activeCategory && activeCategory !== "All") params.category = activeCategory;
      api.get("/pos/product-search", { params })
        .then(({ data }) => {
          if (!active) return;
          const rows = Array.isArray(data) ? data : [];
          setCatalogRows(rows.map((row) => ({
            ...row,
            quantity: Number(row?.stock?.available ?? row.quantity ?? 0),
            total_stock: Number(row?.stock?.on_hand ?? row.quantity ?? 0),
            reserved_stock: Number(row?.stock?.reserved ?? 0),
          })));
        })
        .catch(() => {
          if (!active) return;
          setCatalogRows([]);
        })
        .finally(() => {
          if (active) setCatalogLoading(false);
        });
    }, 220);
    return () => {
      active = false;
      clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery, activeCategory]);

  useEffect(() => {
    const handleKeyDown = async (e) => {
      if (e.key === "F2") { e.preventDefault(); productSearchRef.current?.focus(); return; }
      if (e.key === "F3") { e.preventDefault(); customerSelectRef.current?.focus(); return; }
      if (e.key === "F4") {
        e.preventDefault();
        if (paymentMethod === "Cash" || paymentMethod === "Mixed") {
          setCashReceived(dueAfterCredits);
          setTimeout(() => cashInputRef.current?.focus(), 60);
        } else {
          setTimeout(() => paymentRefInputRef.current?.focus(), 60);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") {
        e.preventDefault();
        setMode("repair");
        setTimeout(() => repairTicketRef.current?.focus(), 80);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        const invoiceNo = await prompt("Invoice Lookup", "Enter the invoice number to load into the receipt panel.", {
          placeholder: "INV-2026-00001",
        });
        if (!invoiceNo) return;
        api.get(`/invoices/number/${encodeURIComponent(String(invoiceNo).trim())}`)
          .then(({ data }) => {
            if (!data?.id) {
              toast("Invoice not found", "warning");
              return;
            }
            return api.get(`/pos/sales/${data.id}`).then(({ data: sale }) => {
              setLastSale(sale);
              toast(`Loaded ${sale?.invoice_no || invoiceNo}`, "success");
            });
          })
          .catch(() => toast("Invoice lookup failed", "error"));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        printReceipt();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (productDetail) { setProductDetail(null); return; }
        if (showSuspendPicker) { setShowSuspendPicker(false); return; }
        if (showNewCustomerModal) { setShowNewCustomerModal(false); return; }
        return;
      }
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) { e.preventDefault(); productSearchRef.current?.focus(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") { e.preventDefault(); barcodeRef.current?.focus(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); checkout(); }
      if (e.key === "Enter" && document.activeElement === productSearchRef.current) {
        e.preventDefault();
        if (filteredInventory.length > 0) addItem(filteredInventory[0]);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Backspace") { 
        e.preventDefault(); 
        if (selectedCartIndex >= 0 && cart[selectedCartIndex]) {
          removeItem(cart[selectedCartIndex].item_id);
        }
      }
      if (cart.length && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedCartIndex((i) => Math.min(i + 1, cart.length - 1));
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedCartIndex((i) => Math.max(i - 1, 0));
        }
        const activeItem = cart[selectedCartIndex];
        if (activeItem && (e.key === "+" || e.key === "=")) {
          e.preventDefault();
          stepQty(activeItem.item_id, 1);
        }
        if (activeItem && e.key === "-") {
          e.preventDefault();
          stepQty(activeItem.item_id, -1);
        }
        if (activeItem && e.key === "Delete") {
          e.preventDefault();
          removeItem(activeItem.item_id);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    cart,
    selectedCartIndex,
    paymentMethod,
    mode,
    dueAfterCredits,
    lastSale,
    productDetail,
    showSuspendPicker,
    showNewCustomerModal,
    catalogRows,
  ]);

  useEffect(() => {
    localStorage.setItem("pos_suspended_carts", JSON.stringify(suspendedCarts));
  }, [suspendedCarts]);

  useEffect(() => {
    localStorage.setItem("pos_auto_print", autoPrint);
  }, [autoPrint]);


  // Auto-save draft every 3 seconds
  useEffect(() => {
    if (!cart.length) return;
    clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      const draft = {
        token: `DRAFT-${new Date().toLocaleTimeString()}`,
        created_at: new Date().toISOString(),
        customerId,
        paymentMethod,
        mode,
        discountMode,
        discountValue,
        taxAmount,
        cashReceived,
        cardAmount,
        paymentReference,
        repairTicketNo,
        reservationNo,
        selectedCreditMap,
        selectedAdvanceMap,
        cart,
        label: draftLabel || "Auto-saved Draft",
      };
      localStorage.setItem("pos_current_draft", JSON.stringify(draft));
      setPendingSync(false);
    }, 2000);
    setPendingSync(true);
    return () => clearTimeout(autoSaveTimerRef.current);
  }, [cart, customerId, paymentMethod, mode, discountMode, discountValue, taxAmount, cashReceived, cardAmount, paymentReference, repairTicketNo, reservationNo, selectedAdvanceMap, selectedCreditMap, draftLabel]);

  const tryAddByCode = async (e) => {
    if (e && e.key !== "Enter") return;
    const code = (scanCode || "").trim();
    if (!code) return;

    // Scale Embedded Barcode Support (EAN-13: 20-29 prefix for weight / price)
    // Format: 20 + 5-digit PLU + 5-digit weight in grams + 1 check digit (e.g. 2000105012503 -> PLU 105, Weight 1.250kg)
    let searchCode = code;
    let extractedWeight = null;
    if (code.length === 13 && (code.startsWith("20") || code.startsWith("21") || code.startsWith("22"))) {
      const plu = code.substring(2, 7).replace(/^0+/, "");
      const weightGrams = parseInt(code.substring(7, 12), 10);
      if (!isNaN(weightGrams) && weightGrams > 0) {
        extractedWeight = weightGrams / 1000.0;
        searchCode = plu;
      }
    }

    try {
      const { data } = await api.get(`/pos/barcode/${encodeURIComponent(searchCode)}`);
      if (data) {
        addItem({
          ...data,
          quantity: Number(data?.stock?.available ?? data.quantity ?? 0),
          total_stock: Number(data?.stock?.on_hand ?? data.quantity ?? 0),
          reserved_stock: Number(data?.stock?.reserved ?? 0),
        }, extractedWeight);
        setScanCode("");
        barcodeRef.current?.focus();
      }
    } catch {
      // Fallback try original code
      try {
        const { data } = await api.get(`/pos/barcode/${encodeURIComponent(code)}`);
        if (data) {
          addItem({
            ...data,
            quantity: Number(data?.stock?.available ?? data.quantity ?? 0),
            total_stock: Number(data?.stock?.on_hand ?? data.quantity ?? 0),
            reserved_stock: Number(data?.stock?.reserved ?? 0),
          });
          setScanCode("");
          barcodeRef.current?.focus();
          return;
        }
      } catch {}
      toast("Item not found", "error");
      barcodeRef.current?.focus();
    }
  };

  const addItem = (i, initialQty = null) => {
    // If product has variants and matrix capability is active, open matrix picker
    if (i.variants && i.variants.length > 0 && (hasCapability("variants_matrix") || hasCapability("size_color_variants"))) {
      setMatrixItem(i);
      setIsMatrixOpen(true);
      return;
    }

    if (i.quantity <= 0 && !i.is_labor) return toast("Item out of stock", "warning");
    const resolvedLineType = i.is_labor
      ? (i.line_type || "labor")
      : (String(i.product_type || "").toLowerCase().includes("spare") ? "spare_part" : "product");
    const qtyToAdd = initialQty !== null ? initialQty : 1;
    let added = false;
    setCart((prev) => {
      const existing = prev.find((p) => p.item_id === i.id && p.line_type === resolvedLineType);
      if (existing) {
        if (!i.is_labor && existing.quantity + qtyToAdd > i.quantity) { toast("Cannot exceed stock", "warning"); return prev; }
        added = true;
        return prev.map((p) => p.item_id === i.id ? { ...p, quantity: p.quantity + qtyToAdd } : p);
      }
      added = true;
      return [
        ...prev,
        {
          item_id: i.id || Date.now(),
          name: i.name,
          quantity: qtyToAdd,
          unit_of_measure: i.unit_of_measure || "pcs",
          allow_decimal_qty: Boolean(i.allow_decimal_qty || i.is_weighted || initialQty !== null),
          price: i.sale_price || 0,
          warranty_days: Number(i.shop_warranty_days || i.warranty_days || 0),
          is_labor: Boolean(i.is_labor),
          line_type: resolvedLineType,
          description: i.description || i.name,
        },
      ];
    });
    if (added) toast(`Added ${i.name}${initialQty ? ` (${initialQty} ${i.unit_of_measure || 'kg'})` : ''}`, "success");
  };

  const addLaborCharge = () => {
    addItem({ id: `labor-${Date.now()}`, name: "Repair Labor Charge", sale_price: 1500, quantity: 999, is_labor: true, line_type: "labor" });
  };

  function handleQuickAddTemporary(payload) {
    const item = {
      item_id: `manual-${Date.now()}`,
      name: payload.name,
      quantity: payload.quantity,
      price: payload.sale_price,
      warranty_days: 0,
      is_labor: false,
      line_type: "manual_product",
      description: payload.description || payload.name,
      is_manual: true,
    };
    setCart(prev => [...prev, item]);
    toast(`Added temporary item ${payload.name}`, "success");
  }

  function handleQuickAddSaved(inventoryItem) {
    inventoryFetch.refresh();
    addItem({
      ...inventoryItem,
      quantity: 9999, // Allow selling newly created items freely
    });
  }

  const removeItem = (id) => {
    setCart(prev => prev.filter(i => i.item_id !== id));
    if (selectedCartIndex > 0) setSelectedCartIndex(selectedCartIndex - 1);
  };
  
  const updateItem = (id, field, value) => {
    setCart(prev => prev.map(i => i.item_id === id ? { ...i, [field]: value } : i));
  };

  const updateDiscountValue = (val) => {
    const numVal = Number(val || 0);
    if (discountMode === "percent") {
      const pctAllowed = Math.max(0, Math.floor(maxDiscountPercentAllowed || 0));
      if (numVal > pctAllowed) {
        toast(`Max discount: ${pctAllowed}%`, "warning");
        setDiscountValue(pctAllowed);
        setDiscountError(`Max discount is ${pctAllowed}%.`);
        return;
      }
    }
    if (discountMode === "amount") {
      const amountAllowed = Number(maxDiscountAllowed || 0);
      if (numVal > amountAllowed) {
        toast(`Max discount: LKR ${Math.round(amountAllowed)}`, "warning");
        setDiscountValue(amountAllowed);
        setDiscountError(`Max discount is LKR ${Math.round(amountAllowed)}.`);
        return;
      }
    }
    setDiscountValue(numVal);
    setDiscountError("");
  };

  const stepQty = (itemId, delta) => {
    const item = cart.find(i => i.item_id === itemId);
    if (!item) return;
    if (String(item.item_id).startsWith("repair-") || item.repair_ticket_id) {
      if (delta > 0) {
        toast("Repair service ticket quantity is locked to 1", "info");
        return;
      }
    }
    if (item.is_labor) {
      updateItem(itemId, 'quantity', Math.max(1, item.quantity + delta));
      return;
    }
    const inv = (inventoryFetch.data || []).find(x => x.id === itemId);
    const max = inv?.quantity ?? Infinity;
    const next = Math.max(1, Math.min(max, item.quantity + delta));
    updateItem(itemId, 'quantity', next);
  };

  const clearCart = () => {
    setCart([]);
    setDiscountValue(0);
    setTaxAmount(0);
    setPaid(true);
    setCashReceived("");
    setCardAmount("");
    setPaymentReference("");
    setRepairTicketNo("");
    setReservationNo("");
    setSelectedAdvanceMap({});
    setSelectedCreditMap({});
  };

  const suspendCurrentCart = () => {
    if (!cart.length) return toast("Cart is empty", "warning");
    const token = `SUSP-${Date.now().toString().slice(-5)}`;
    setSuspendedCarts((prev) => [
      {
        token,
        created_at: new Date().toISOString(),
        customerId,
        paymentMethod,
        mode,
        discountMode,
        discountValue,
        taxAmount,
        cashReceived,
        cardAmount,
        paymentReference,
        repairTicketNo,
        reservationNo,
        selectedCreditMap,
        selectedAdvanceMap,
        cart,
      },
      ...prev,
    ]);
    clearCart();
    toast(`Cart suspended as ${token}`, "success");
  };

  const resumeSuspendedCart = (token) => {
    const found = suspendedCarts.find((c) => c.token === token);
    if (!found) return;
    setCart(found.cart || []);
    setCustomerId(found.customerId || "");
    setPaymentMethod(found.paymentMethod || "Cash");
    setMode(found.mode || "sale");
    setDiscountMode(found.discountMode || "amount");
    setDiscountValue(found.discountValue || 0);
    setTaxAmount(found.taxAmount || 0);
    setCashReceived(found.cashReceived || "");
    setCardAmount(found.cardAmount || "");
    setPaymentReference(found.paymentReference || "");
    setRepairTicketNo(found.repairTicketNo || "");
    setReservationNo(found.reservationNo || "");
    setSelectedCreditMap(found.selectedCreditMap || {});
    setSelectedAdvanceMap(found.selectedAdvanceMap || {});
    setSuspendedCarts((prev) => prev.filter((c) => c.token !== token));
    setShowSuspendPicker(false);
    toast(`Resumed ${token}`, "success");
  };

  const loadRepairTicketToCart = async (targetCode) => {
    const raw = (typeof targetCode === "string" ? targetCode : repairTicketNo) || "";
    const cleanCode = raw.trim().replace(/^#+/, "").toLowerCase();
    if (!cleanCode) return toast("Enter repair ticket no", "warning");

    const localList = Array.isArray(repairsFetch.data) ? repairsFetch.data : (repairsFetch.data?.items || []);
    let hit = localList.find((r) => {
      const tNo = String(r.ticket_no || "").trim().replace(/^#+/, "").toLowerCase();
      return tNo === cleanCode || String(r.id) === cleanCode;
    });

    if (!hit) {
      try {
        const res = await api.get(`/repairs?search=${encodeURIComponent(cleanCode)}`);
        const fetched = Array.isArray(res.data) ? res.data : (res.data?.items || []);
        hit = fetched.find((r) => {
          const tNo = String(r.ticket_no || "").trim().replace(/^#+/, "").toLowerCase();
          return tNo === cleanCode || String(r.id) === cleanCode;
        }) || fetched[0];
      } catch (err) {
        hit = null;
      }
    }

    if (!hit) return toast("Repair ticket not found", "error");

    setRepairTicketNo(hit.ticket_no || `JOB-${hit.id}`);
    if (hit.customer_id) {
      setCustomerId(String(hit.customer_id));
    }

    const laborAmount = Math.max(0, Number(hit.estimated_cost || 0) - Number(hit.advance_payment || 0));
    if (laborAmount > 0) {
      setCart((prev) => {
        const existingIndex = prev.findIndex((p) => String(p.item_id) === `repair-${hit.id}`);
        const lineItem = {
          item_id: `repair-${hit.id}`,
          name: `Repair #${hit.ticket_no || hit.id} - ${hit.device_model || "Service"}`,
          price: laborAmount,
          quantity: 1,
          warranty_days: 0,
          is_labor: true,
          line_type: "service",
          description: `Repair settlement for #${hit.ticket_no || hit.id} (${hit.issue_description || hit.device_model || "Service"})`,
          repair_ticket_id: hit.id,
        };
        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = lineItem;
          return updated;
        }
        return [...prev, lineItem];
      });
      toast(`Loaded #${hit.ticket_no || hit.id} (LKR ${laborAmount.toLocaleString()}) to cart`, "success");
    } else {
      toast(`Ticket #${hit.ticket_no} has 0 balance due`, "info");
    }
  };

  const loadReservationToCart = async () => {
    const code = (reservationNo || "").trim().toLowerCase();
    if (!code) return toast("Enter reservation number", "warning");
    const hit = (reservationsFetch.data || []).find((r) => String(r.reservation_number || "").toLowerCase() === code);
    if (!hit) return toast("Reservation not found", "error");
    if (!hit.product_id) {
      setCustomerId(String(hit.customer_id || ""));
      toast("Reservation loaded. Add the final product to cart for settlement.", "info");
      return;
    }
    setCustomerId(String(hit.customer_id || ""));
    let item = (catalogRows || []).find((row) => Number(row.id) === Number(hit.product_id))
      || (inventoryFetch.data || []).find((row) => Number(row.id) === Number(hit.product_id));
    if (!item) {
      try {
        const { data } = await api.get(`/pos/product-search`, { params: { q: String(hit.product_name || hit.requested_product_name || hit.product_id), limit: 40 } });
        item = (Array.isArray(data) ? data : []).find((row) => Number(row.id) === Number(hit.product_id));
      } catch {
        item = null;
      }
    }
    if (!item) {
      toast("Linked product not found in catalog", "error");
      return;
    }
    const qty = Math.max(1, Number(hit.quantity || 1));
    const unitPrice = Number(hit.estimated_total || 0) > 0 ? (Number(hit.estimated_total || 0) / qty) : Number(item.sale_price || 0);
    setCart((prev) => {
      const existingIndex = prev.findIndex((row) => Number(row.item_id) === Number(item.id));
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = {
          ...next[existingIndex],
          quantity: qty,
          price: unitPrice,
          line_type: "product",
        };
        return next;
      }
      return [
        ...prev,
        {
          item_id: item.id,
          name: item.name || hit.product_name || hit.requested_product_name || "Reserved Product",
          quantity: qty,
          price: unitPrice,
          warranty_days: 0,
          is_labor: false,
          line_type: "product",
          description: `Reservation ${hit.reservation_number}`,
        },
      ];
    });
    toast(`Loaded reservation ${hit.reservation_number}`, "success");
  };

  const createCustomerQuick = async () => {
    if (!newCustomer.name || !newCustomer.phone) return toast("Name and phone required", "warning");
    try {
      const { data } = await api.post("/customers", newCustomer);
      customersFetch.setData([data, ...(customersFetch.data || [])]);
      setCustomerId(String(data.id));
      setShowNewCustomerModal(false);
      setNewCustomer({ name: "", phone: "", email: "", address: "" });
      toast("Customer created", "success");
    } catch {
      toast("Failed to create customer", "error");
    }
  };

  const checkout = async () => {
    if (cart.length === 0) return toast("Cart is empty", "warning");
    
    // Validation guards
    if (hasNegativeMargin) {
      toast("Cannot checkout: negative margin detected. Review prices.", "error");
      return;
    }
    
    if (paymentMethod === "Mixed") {
      const totalTendered = Number(cashReceived || 0) + Number(cardAmount || 0);
      if (totalTendered < dueAfterCredits * 0.95) {
        toast("Underpayment: tender less than subtotal", "error");
        return;
      }
      if (totalTendered > dueAfterCredits * 1.05) {
        toast("Overpayment detected. Adjust amounts.", "warning");
      }
    }
    
    if (paymentMethod === "Cash" && Number(cashReceived || 0) < dueAfterCredits) {
      toast("Insufficient cash received", "error");
      return;
    }
    if (paymentMethod === "Store Credit" && appliedStoreCreditTotal <= 0) {
      toast("Select store credit amounts before settlement", "warning");
      return;
    }

    const linkedRepair = linkedRepairForForm;
    if (mode === "repair" && !linkedRepair) {
      return toast("Select a valid repair ticket before settlement", "warning");
    }
    const linkedReservation = linkedReservationForForm;
    if (mode === "reservation" && !linkedReservation) {
      return toast("Select a valid reservation before settlement", "warning");
    }

    let payload;
    try {
      payload = {
        lines: cart.map((c) => ({
          item_id: (() => {
            // Handle non-inventory items (labor, manual, etc.)
            const itemIdStr = String(c.item_id);
            if (itemIdStr.startsWith("labor") || itemIdStr.startsWith("manual")) {
              return null;
            }
            // Convert to number if it's a valid integer
            const num = Number(c.item_id);
            return !isNaN(num) && Number.isInteger(num) ? num : null;
          })(),
          line_type: c.line_type || (c.is_labor ? "labor" : "product"),
          description: c.description || c.name,
          quantity: c.quantity,
          price: c.price,
          warranty_days: c.warranty_days,
        })),
        repair_ticket_id: mode === "repair" ? (linkedRepair?.id || null) : null,
        reservation_id: mode === "reservation" ? (linkedReservation?.id || null) : null,
        payment_method: paymentMethod,
        payment_reference: paymentReference || null,
        cash_amount: paymentMethod === "Mixed" ? Number(cashReceived || 0) : undefined,
        card_amount: paymentMethod === "Mixed" ? Number(cardAmount || 0) : undefined,
        paid,
        customer_id: customerId ? Number(customerId) : null,
        discount_amount: Number(discountAmount || 0),
        tax_amount: Number(taxAmount || 0),
        auto_apply_advances: false,
        applied_advances: selectedAdvances.map((row) => ({
          advance_payment_id: row.advance_payment_id,
          amount: Number(row.amount || 0),
        })),
        applied_store_credits: selectedStoreCredits.map((row) => ({
          store_credit_id: row.store_credit_id,
          amount: Number(row.amount || 0),
        })),
        note: mode === "repair"
          ? `Repair Ticket: ${repairTicketNo}`
          : mode === "reservation"
            ? `Reservation: ${reservationNo}`
            : ""
      };
      if (mode === "return") {
        toast("Return mode does not support standard checkout. Use the return workflow instead.", "warning");
        return;
      }
      const endpoint = mode === "repair" ? "/pos/checkout/repair" : mode === "reservation" ? "/pos/checkout/reservation" : "/pos/checkout";
      if (!navigator.onLine) {
        syncQueue.enqueue("sale_created", { endpoint, payload });
        toast("Checkout queued locally (offline mode active)", "success");
        clearCart();
        localStorage.removeItem("pos_current_draft");
        return;
      }
      const { data: r } = await api.post(endpoint, payload);
      setLastSale(r);
      setShowSaleCompleteModal(true);
      toast("Sale completed successfully", "success");
      if (autoPrint) { directPrintReceipt(r); }
      clearCart();
      setSelectedAdvanceMap({});
      setAvailableAdvances([]);
      setSelectedCreditMap({});
      setAvailableCredits([]);
      localStorage.removeItem("pos_current_draft");
      const refreshed = await api.get('/pos/sales');
      salesFetch.setData(refreshed.data);
      inventoryFetch.refresh();
    } catch (err) {
      // Log full server response to aid debugging (422 validation details)
      const serverDetail = err?.response?.data;
      console.error("POS checkout error response:", serverDetail || err);
      
      // Explicitly log validation errors if present
      if (serverDetail?.meta?.errors) {
        console.error("Validation errors:", JSON.stringify(serverDetail.meta.errors, null, 2));
        console.error("Failed fields:", serverDetail.meta.errors.map(e => e.loc?.join(".")).join(", "));
      }
      
      // Log the payload that was sent for debugging
      console.debug("Checkout payload sent:", payload);
      
      const message = serverDetail?.detail || serverDetail?.message || (typeof serverDetail === "string" ? serverDetail : null) || err.message || "Checkout failed";
      toast(message, "error");
    }
  };

  const openReturnModal = (saleId) => {
    const sale = (salesFetch.data || []).find((row) => Number(row.id) === Number(saleId));
    if (sale?.is_voided) {
      toast("Cannot return a voided sale", "warning");
      return;
    }
    const invoiceRef = sale?.invoice_no || saleId;
    setMode("return");
    setRightPanelTab("return");
    setReturnInvoiceLookup(invoiceRef);
    lookupReturnInvoice(invoiceRef);
  };

  const lookupReturnInvoice = async (invoice = null) => {
    const query = String((invoice ?? returnInvoiceLookup) || "").trim();
    if (!query) {
      toast("Enter an invoice number, customer name, or phone", "warning");
      return;
    }
    setReturnSearchBusy(true);
    try {
      const { data } = await api.get(`/returns/lookup-invoice/${encodeURIComponent(query)}`);
      setReturnInvoicePayload(data);
      setSelectedReturnItem(null);
      setReturnQuantity(1);
    } catch (err) {
      setReturnInvoicePayload(null);
      setSelectedReturnItem(null);
      toast(err.response?.data?.detail || "Invoice lookup failed", "error");
    } finally {
      setReturnSearchBusy(false);
    }
  };

  const processReturnAction = async () => {
    if (!returnInvoicePayload?.selected_invoice) {
      toast("Lookup an invoice before processing a return", "warning");
      return;
    }
    if (!selectedReturnItem) {
      toast("Select an item to return", "warning");
      return;
    }
    const qty = Math.max(1, Number(returnQuantity || 0));
    if (qty <= 0) {
      toast("Return quantity must be at least 1", "warning");
      return;
    }
    if (qty > Number(selectedReturnItem.returnable_qty || 0)) {
      toast("Return quantity exceeds eligible quantity", "warning");
      return;
    }

    if (returnAction === "refund") {
      setReturnBusy(true);
      try {
        const payload = {
          sale_id: Number(returnInvoicePayload.selected_invoice.invoice_id),
          lines: [
            {
              item_id: Number(selectedReturnItem.product_id || selectedReturnItem.sale_item_id),
              quantity: qty,
              price: Number(selectedReturnItem.unit_price || 0),
              note: returnNotes,
            },
          ],
          note: returnNotes || `Return from invoice ${returnInvoicePayload.selected_invoice.invoice_no}`,
        };
        const { data } = await api.post("/pos/return", payload);
        toast(`Refund created: ${data.invoice_no || data.return_sale_id}`, "success");
        setLastSale({ id: data.return_sale_id, invoice_no: data.invoice_no });
        setShowSaleCompleteModal(true);
        setReturnInvoicePayload(null);
        setSelectedReturnItem(null);
        setReturnQuantity(1);
        setReturnNotes("");
        const refreshed = await api.get("/pos/sales");
        salesFetch.setData(refreshed.data);
        inventoryFetch.refresh();
      } catch (err) {
        toast(err.response?.data?.detail || err.response?.data?.message || "Return failed", "error");
      } finally {
        setReturnBusy(false);
      }
      return;
    }

    if (returnAction === "exchange" || returnAction === "store_credit") {
      setReturnBusy(true);
      try {
        const payload = {
          original_invoice_id: Number(returnInvoicePayload.selected_invoice.invoice_id),
          customer_id: Number(returnInvoicePayload.selected_invoice.customer_id || 0) || null,
          return_type: returnAction,
          reason: returnNotes || "POS return/exchange",
          notes: returnNotes || "Created from POS return tab",
          items: [
            {
              original_invoice_item_id: Number(selectedReturnItem.sale_item_id),
              product_id: Number(selectedReturnItem.product_id),
              quantity: qty,
              unit_price: Number(selectedReturnItem.unit_price || 0),
              notes: returnNotes,
            },
          ],
        };
        const { data } = await api.post("/returns", payload);
        toast(`Return case created: ${data.return_number || data.id}`, "success");
        setReturnInvoicePayload(null);
        setSelectedReturnItem(null);
        setReturnQuantity(1);
        setReturnNotes("");
        navigate(`/returns?invoice=${encodeURIComponent(returnInvoicePayload.selected_invoice.invoice_no)}`);
      } catch (err) {
        toast(err.response?.data?.detail || err.response?.data?.message || "Return case creation failed", "error");
      } finally {
        setReturnBusy(false);
      }
      return;
    }

    toast("Unsupported return action", "warning");
  };

  const openSalePrint = useCallback(
    (sale = lastSale) => {
      const saleId = sale?.id || sale?.sale_id;
      if (!saleId) {
        toast("No recent sale to print", "warning");
        return;
      }

      if (sale && sale !== lastSale) setLastSale(sale);
      openPrintCenter(navigate, {
        type: "receipt",
        ref: saleId,
        paper: "thermal_80",
      });
    },
    [lastSale, navigate, toast],
  );

  // Direct print function - prints receipt without navigation
  const directPrintReceipt = useCallback(async (sale = lastSale) => {
    const saleId = sale?.id || sale?.sale_id;
    if (!saleId) {
      toast("No recent sale to print", "warning");
      return;
    }

    const popup = window.open("", "_blank");
    if (!popup) {
      toast("Pop-up blocked. Allow pop-ups to print receipt.", "error");
      return;
    }

    try {
      // Fetch receipt HTML from backend
      const { data: html } = await api.get("/print-center/render", {
        params: {
          document_type: "sales_receipt",
          reference: saleId,
          paper: "thermal_80",
        },
        responseType: "text",
        transformResponse: [(data) => data],
      });

      // Write content and trigger print in the already-opened popup
      await printHtmlDocument(html, { win: popup });
      toast("Receipt sent to printer", "success");
    } catch (err) {
      if (popup && !popup.closed) popup.close();
      toast(err?.message || "Failed to print receipt", "error");
    }
  }, [lastSale, toast]);

  const printReceipt = useCallback(() => {
    directPrintReceipt(lastSale);
  }, [lastSale, directPrintReceipt]);

  const quickReprint = async (saleId) => {
    try {
      const { data } = await api.get(`/pos/sales/${saleId}`);
      directPrintReceipt(data);
    } catch {
      toast("Unable to reprint invoice", "error");
    }
  };

  const voidSale = async (sale) => {
    if (!sale || sale.is_voided || sale.is_return) return;
    const reasonInput = await prompt("Void Invoice", `Enter a reason for voiding ${sale.invoice_no}.`, {
      placeholder: "Reason, minimum 5 characters",
      multiline: true,
      confirmText: "Continue",
    });
    if (reasonInput === null) return;
    const reason = String(reasonInput || "").trim();
    if (reason.length < 5) {
      toast("Void reason must be at least 5 characters", "warning");
      return;
    }
    const ok = await confirm(
      "Void Invoice",
      `Void ${sale.invoice_no}? This will reverse stock for inventory lines.`
    );
    if (!ok) return;
    try {
      await runWithApproval({
        confirm,
        prompt,
        toast,
        approval: {
          module: "pos",
          action: "void",
          target_type: "Sale",
          target_id: sale.id,
          reason,
          payload: { amount: Number(sale.total || 0) },
        },
        execute: (approvalCode) => api.post(`/pos/sales/${sale.id}/void`, {
          reason,
          approval_request_code: approvalCode || null,
        }),
      });
      toast("Invoice voided successfully", "success");
      salesFetch.refresh();
      inventoryFetch.refresh();
    } catch (err) {
      if (err.approvalCancelled) return;
      toast(err.response?.data?.message || err.response?.data?.detail || "Failed to void invoice", "error");
    }
  };

  const sendReceiptWhatsApp = async () => {
    if (!lastSale) return toast("No recent sale", "warning");
    window.clearTimeout(saleCompleteAutoCloseTimerRef.current);
    
    const rawPhone = lastSale.customer?.phone || lastSale.customer_phone || "";
    if (!rawPhone) {
      return toast("No customer phone number attached to this invoice", "warning");
    }

    let cleanedPhone = rawPhone.replace(/[^\d]/g, "");
    if (cleanedPhone.startsWith("0")) {
      cleanedPhone = "94" + cleanedPhone.slice(1);
    }

    const saleId = lastSale.id || lastSale.sale_id;
    const invNo = lastSale.invoice_no || lastSale.invoice_number || `INV-${saleId}`;
    const custName = lastSale.customer?.name || lastSale.customer_name || "Valued Customer";
    const totalAmt = Number(lastSale.grand_total || lastSale.total || lastSale.total_amount || 0);
    const subtotalAmt = Number(lastSale.subtotal || totalAmt);
    const discountAmt = Number(lastSale.discount_amount || lastSale.discount || 0);
    const paidAmt = Number(lastSale.amount_paid || totalAmt);
    const balAmt = Number(lastSale.balance_due || 0);
    const payMethod = String(lastSale.payment_method || "Cash");
    const dateStr = new Date(lastSale.created_at || Date.now()).toLocaleString();

    // ── Generate matching token deterministically ───────────────────────────
    const s = `${invNo}istore_secure_salt_2026`;
    let hashVal = 0;
    for (let i = 0; i < s.length; i++) {
      hashVal = (hashVal << 5) - hashVal + s.charCodeAt(i);
      hashVal = (hashVal + 2**31) % 2**32 - 2**31;
    }
    const token = `sec_${Math.abs(hashVal).toString(16).padStart(8, '0')}`.slice(0, 12);
    // ────────────────────────────────────────────────────────────────────────

    const firstItemObj = (lastSale.items || lastSale.lines || [])[0] || {};
    const firstItem = firstItemObj?.item_name || firstItemObj?.description || "Device / Retail Product";
    const firstItemWarrantyDays = Number(firstItemObj?.warranty_days ?? firstItemObj?.warrantyDays ?? 0);
    const firstItemWarrantyMonths = firstItemWarrantyDays > 0 ? Math.round(firstItemWarrantyDays / 30) : 0;
    const portalBase = "https://i-store-customer-portal-one.vercel.app";
    const billUrl = `${portalBase}/invoice/${invNo}?token=${token}&name=${encodeURIComponent(custName)}&total=${totalAmt.toFixed(2)}&subtotal=${subtotalAmt.toFixed(2)}&disc=${discountAmt.toFixed(2)}&phone=${encodeURIComponent(cleanedPhone)}&method=${encodeURIComponent(payMethod)}&item=${encodeURIComponent(firstItem)}&warranty=${firstItemWarrantyMonths}&warranty_days=${firstItemWarrantyDays}`;
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(billUrl)}&format=png&margin=12`;

    const message = `🧾 *OFFICIAL DIGITAL RECEIPT*\n━━━━━━━━━━━━━━━━━━━━\n👋 Hello *${custName}*,\n\nThank you for shopping with *I-Store*! Your transaction has been confirmed:\n\n📋 *Invoice No:* #${invNo}\n📅 *Date:* ${dateStr}\n💳 *Payment Method:* ${payMethod}\n\n💰 *Payment Breakdown:*\n• Subtotal: LKR ${subtotalAmt.toLocaleString()}\n• Discount: LKR ${discountAmt.toLocaleString()}\n• *Grand Total: LKR ${totalAmt.toLocaleString()}*\n• Amount Paid: LKR ${paidAmt.toLocaleString()}\n• *Balance Due: LKR ${balAmt.toLocaleString()}*\n\n📄 *View & Download Digital Bill:*\n${billUrl}\n\n🛡️ *Warranty & Digital Records:*\nYour warranty coverage and device serial numbers are digitally registered with your bill.\n\n📞 *Support Hotline:* +94 77 123 4567\n━━━━━━━━━━━━━━━━━━━━\n_Thank you for choosing I-Store! Have a wonderful day!_`;

    try {
      const res = await api.post("/api/whatsapp/send-direct", {
        phone: cleanedPhone,
        message,
        invoice_no: invNo,
        customer_id: lastSale.customer?.id || lastSale.customer_id || null,
        category: "sales",
        media_url: qrImageUrl
      });
      if (res.data?.success || res.data?.status === "SENT" || res.data?.status === "QUEUED") {
        toast("WhatsApp receipt sent directly to customer!", "success");
      } else {
        toast(res.data?.error || "WhatsApp message queued", "info");
      }
    } catch (err) {
      const errMsg = err.response?.data?.detail || err.response?.data?.message || err.message;
      toast(`Failed to send WhatsApp: ${errMsg}`, "error");
    }
  };

  const shareOnWhatsAppWeb = () => {
    if (!lastSale) return toast("No recent sale", "warning");
    window.clearTimeout(saleCompleteAutoCloseTimerRef.current);

    const rawPhone = lastSale.customer?.phone || lastSale.customer_phone || "";
    let cleanedPhone = rawPhone.replace(/[^\d]/g, "");
    if (cleanedPhone.startsWith("0")) {
      cleanedPhone = "94" + cleanedPhone.slice(1);
    }

    const saleId = lastSale.id || lastSale.sale_id;
    const invNo = lastSale.invoice_no || lastSale.invoice_number || `INV-${saleId}`;
    const custName = lastSale.customer?.name || lastSale.customer_name || "Valued Customer";
    const totalAmt = Number(lastSale.grand_total || lastSale.total || lastSale.total_amount || 0);
    const subtotalAmt = Number(lastSale.subtotal || totalAmt);
    const discountAmt = Number(lastSale.discount_amount || lastSale.discount || 0);
    const paidAmt = Number(lastSale.amount_paid || totalAmt);
    const balAmt = Number(lastSale.balance_due || 0);
    const payMethod = String(lastSale.payment_method || "Cash");
    const dateStr = new Date(lastSale.created_at || Date.now()).toLocaleString();

    const s = `${invNo}istore_secure_salt_2026`;
    let hashVal = 0;
    for (let i = 0; i < s.length; i++) {
      hashVal = (hashVal << 5) - hashVal + s.charCodeAt(i);
      hashVal = (hashVal + 2**31) % 2**32 - 2**31;
    }
    const token = `sec_${Math.abs(hashVal).toString(16).padStart(8, '0')}`.slice(0, 12);

    const firstItemObj = (lastSale.items || lastSale.lines || [])[0] || {};
    const firstItem = firstItemObj?.item_name || firstItemObj?.description || "Device / Retail Product";
    const firstItemWarrantyDays = Number(firstItemObj?.warranty_days ?? firstItemObj?.warrantyDays ?? 0);
    const firstItemWarrantyMonths = firstItemWarrantyDays > 0 ? Math.round(firstItemWarrantyDays / 30) : 0;
    const portalBase = "https://i-store-customer-portal-one.vercel.app";
    const billUrl = `${portalBase}/invoice/${invNo}?token=${token}&name=${encodeURIComponent(custName)}&total=${totalAmt.toFixed(2)}&subtotal=${subtotalAmt.toFixed(2)}&disc=${discountAmt.toFixed(2)}&phone=${encodeURIComponent(cleanedPhone)}&method=${encodeURIComponent(payMethod)}&item=${encodeURIComponent(firstItem)}&warranty=${firstItemWarrantyMonths}&warranty_days=${firstItemWarrantyDays}`;

    const message = `🧾 *OFFICIAL DIGITAL RECEIPT*\n━━━━━━━━━━━━━━━━━━━━\n👋 Hello *${custName}*,\n\nThank you for shopping with *I-Store*! Your transaction has been confirmed:\n\n📋 *Invoice No:* #${invNo}\n📅 *Date:* ${dateStr}\n💳 *Payment Method:* ${payMethod}\n\n💰 *Payment Breakdown:*\n• Subtotal: LKR ${subtotalAmt.toLocaleString()}\n• Discount: LKR ${discountAmt.toLocaleString()}\n• *Grand Total: LKR ${totalAmt.toLocaleString()}*\n• Amount Paid: LKR ${paidAmt.toLocaleString()}\n• *Balance Due: LKR ${balAmt.toLocaleString()}*\n\n📄 *View & Download Digital Bill:*\n${billUrl}\n\n🛡️ *Warranty & Digital Records:*\nYour warranty coverage and device serial numbers are digitally registered with your bill.\n\n📞 *Support Hotline:* +94 77 123 4567\n━━━━━━━━━━━━━━━━━━━━\n_Thank you for choosing I-Store! Have a wonderful day!_`;
    const whatsappUrl = cleanedPhone ? `https://wa.me/${cleanedPhone}?text=${encodeURIComponent(message)}` : `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank");
    toast("Opening WhatsApp Web link...", "info");
  };

  const shareRecentSaleWhatsApp = (sale) => {
    if (!sale) return;
    const rawPhone = sale.customer?.phone || sale.customer_phone || "";
    let cleanedPhone = rawPhone.replace(/[^\d]/g, "");
    if (cleanedPhone.startsWith("0")) {
      cleanedPhone = "94" + cleanedPhone.slice(1);
    }

    const invNo = sale.invoice_no || `INV-${sale.id}`;
    const custName = sale.customer?.name || sale.customer_name || "Valued Customer";
    const totalAmt = Number(sale.grand_total || sale.total || sale.total_amount || 0);
    const subtotalAmt = Number(sale.subtotal || totalAmt);
    const discountAmt = Number(sale.discount_amount || sale.discount || 0);
    const paidAmt = Number(sale.amount_paid || totalAmt);
    const balAmt = Number(sale.balance_due || 0);
    const payMethod = String(sale.payment_method || "Cash");
    const dateStr = new Date(sale.created_at || Date.now()).toLocaleString();

    // Deterministic signature matching backend
    const s = `${invNo}istore_secure_salt_2026`;
    let hashVal = 0;
    for (let i = 0; i < s.length; i++) {
      hashVal = (hashVal << 5) - hashVal + s.charCodeAt(i);
      hashVal = (hashVal + 2**31) % 2**32 - 2**31;
    }
    const token = `sec_${Math.abs(hashVal).toString(16).padStart(8, '0')}`.slice(0, 12);

    const firstItemObj = (sale.items || sale.lines || [])[0] || {};
    const firstItem = firstItemObj?.item_name || firstItemObj?.description || "Device / Retail Product";
    const firstItemWarrantyDays = Number(firstItemObj?.warranty_days ?? firstItemObj?.warrantyDays ?? 0);
    const firstItemWarrantyMonths = firstItemWarrantyDays > 0 ? Math.round(firstItemWarrantyDays / 30) : 0;
    const portalBase = "https://i-store-customer-portal-one.vercel.app";
    const billUrl = `${portalBase}/invoice/${invNo}?token=${token}&name=${encodeURIComponent(custName)}&total=${totalAmt.toFixed(2)}&subtotal=${subtotalAmt.toFixed(2)}&disc=${discountAmt.toFixed(2)}&phone=${encodeURIComponent(cleanedPhone)}&method=${encodeURIComponent(payMethod)}&item=${encodeURIComponent(firstItem)}&warranty=${firstItemWarrantyMonths}&warranty_days=${firstItemWarrantyDays}`;

    const message = `🧾 *OFFICIAL DIGITAL RECEIPT*\n━━━━━━━━━━━━━━━━━━━━\n👋 Hello *${custName}*,\n\nThank you for shopping with *I-Store*! Your transaction has been confirmed:\n\n📋 *Invoice No:* #${invNo}\n📅 *Date:* ${dateStr}\n💳 *Payment Method:* ${payMethod}\n\n💰 *Payment Breakdown:*\n• Subtotal: LKR ${subtotalAmt.toLocaleString()}\n• Discount: LKR ${discountAmt.toLocaleString()}\n• *Grand Total: LKR ${totalAmt.toLocaleString()}*\n• Amount Paid: LKR ${paidAmt.toLocaleString()}\n• *Balance Due: LKR ${balAmt.toLocaleString()}*\n\n📄 *View & Download Digital Bill:*\n${billUrl}\n\n🛡️ *Warranty & Digital Records:*\nYour warranty coverage and device serial numbers are digitally registered with your bill.\n\n📞 *Support Hotline:* +94 77 123 4567\n━━━━━━━━━━━━━━━━━━━━\n_Thank you for choosing I-Store! Have a wonderful day!_`;

    const whatsappUrl = cleanedPhone ? `https://wa.me/${cleanedPhone}?text=${encodeURIComponent(message)}` : `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank");
    toast("Opening WhatsApp Web...", "info");
  };


  const sendReceiptEmail = () => {
    if (!lastSale) return toast("No recent sale", "warning");
    window.clearTimeout(saleCompleteAutoCloseTimerRef.current);
    toast("Email send prepared (connect SMTP/mail API)", "info");
  };

  const closeSaleCompleteModal = () => {
    window.clearTimeout(saleCompleteAutoCloseTimerRef.current);
    setShowSaleCompleteModal(false);
  };

  const viewInvoice = () => {
    if (!lastSale) return toast("No recent sale", "warning");
    window.clearTimeout(saleCompleteAutoCloseTimerRef.current);
    setShowSaleCompleteModal(false);
    navigate(`/invoice/${lastSale.id || lastSale.sale_id}`);
  };

  const getSupplierName = (item) => {
    const supplier = (suppliersFetch.data || []).find((s) => s.id === item?.supplier_id);
    return supplier?.name || "Direct / Unassigned";
  };

  const openProductDetail = (item) => {
    if (!item) return;
    setProductDetail({ ...item });
  };

  const startLongPress = (item) => {
    longPressTriggeredRef.current = false;
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      openProductDetail(item);
    }, 550);
  };

  const cancelLongPress = () => {
    clearTimeout(longPressTimerRef.current);
  };

  const filteredInventory = useMemo(() => {
    if (catalogRows.length > 0) return catalogRows;
    if ((searchQuery || "").trim() || activeCategory !== "All") return [];
    let items = inventoryFetch.data || [];
    if (activeCategory !== "All") items = items.filter(i => i.category === activeCategory);
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase().trim();
      const scored = items.map(i => {
        let score = 0;
        
        // Exact SKU/barcode match = highest priority
        if (String(i.sku || "").toLowerCase() === query) score = 1000;
        if (String(i.barcode || "").toLowerCase() === query) score = 1000;
        
        // Prefix match
        else if (i.name.toLowerCase().startsWith(query)) score = 100;
        else if (String(i.sku || "").toLowerCase().startsWith(query)) score = 100;
        
        // Contains match
        else if (i.name.toLowerCase().includes(query)) score = 50;
        else if (String(i.sku || "").toLowerCase().includes(query)) score = 50;
        else if (String(i.barcode || "").toLowerCase().includes(query)) score = 10;
        
        return { item: i, score };
      }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
      
      items = scored.map(x => x.item);
    }
    
    return items.slice(0, 140);
  }, [catalogRows, inventoryFetch.data, activeCategory, searchQuery]);

  return (
    <div className="h-full min-h-0 flex flex-col gap-3 text-slate-900 dark:text-slate-200 overflow-hidden">
      
      {/* TOP COMPACT STATUS BAR */}
      <div className="flex flex-nowrap items-center justify-between gap-3 bg-white dark:bg-slate-900/60 backdrop-blur-md border border-slate-200 dark:border-white/5 rounded-xl p-2 shrink-0 shadow-sm overflow-x-auto">
        <div className="flex items-center shrink-0 bg-slate-100 dark:bg-black/40 p-1 rounded-lg border border-slate-200 dark:border-white/5">
          <button 
            className={`px-3 2xl:px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap ${mode === "sale" ? "bg-indigo-600 text-white shadow-md" : "text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white"}`}
            onClick={() => setMode("sale")}
          >
            Product Sale
          </button>
          <button 
            className={`px-3 2xl:px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap ${mode === "repair" ? "bg-indigo-600 text-white shadow-md" : "text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white"}`}
            onClick={() => setMode("repair")}
          >
            Repair Billing
          </button>
          <button 
            className={`px-3 2xl:px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap ${mode === "reservation" ? "bg-indigo-600 text-white shadow-md" : "text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white"}`}
            onClick={() => setMode("reservation")}
          >
            Reservation
          </button>
          <button
            type="button"
            onClick={() => setMode("return")}
            className={`px-3 2xl:px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap ${mode === "return" ? "bg-rose-600 text-white shadow-md" : "text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white"}`}
          >
            Return / Exchange
          </button>
        </div>

        {/* REGISTER SHIFT STATUS PILL */}
        <div className="flex items-center gap-2">
          {currentShiftData ? (
            <button
              type="button"
              onClick={() => setShiftModalOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 text-xs font-bold transition shadow-sm"
              title="Click to view Drawer Float or Close Register Shift"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Shift Open (#{currentShiftData.recon_code})</span>
              <span className="text-[11px] font-mono text-emerald-900 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-500/20 px-1.5 py-0.5 rounded">
                LKR {Number(currentShiftData.sales_summary?.expected_drawer_cash || currentShiftData.opening_float || 0).toLocaleString()}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShiftModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20 text-xs font-bold transition shadow-sm animate-pulse"
              title="Click to open register shift with starting float"
            >
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>Open Register Shift</span>
            </button>
          )}
        </div>
        
        <div className="flex items-center shrink-0 gap-4 2xl:gap-6 px-3 2xl:px-5">
          <div className="flex flex-col items-end justify-center whitespace-nowrap">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none mb-1">Subtotal</span>
            <span className="text-base font-black text-slate-900 dark:text-slate-200 leading-none">LKR {Math.round(subtotal).toLocaleString()}</span>
          </div>
          <div className="flex flex-col items-end justify-center whitespace-nowrap">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-none mb-1">Discount</span>
            <span className="text-base font-black text-rose-600 dark:text-rose-400 leading-none">LKR {Math.round(discountAmount).toLocaleString()}</span>
          </div>
          <div className="flex flex-col items-end justify-center whitespace-nowrap">
            <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-widest leading-none mb-1">Grand Total</span>
            <span className="text-base font-black text-indigo-600 dark:text-indigo-400 leading-none">LKR {Math.round(grandTotal).toLocaleString()}</span>
          </div>
          {appliedAdvanceTotal > 0 && <div className="flex flex-col items-end justify-center whitespace-nowrap">
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-widest leading-none mb-1">Advance</span>
            <span className="text-base font-black text-emerald-700 dark:text-emerald-300 leading-none">LKR {Math.round(appliedAdvanceTotal).toLocaleString()}</span>
          </div>}
          {appliedStoreCreditTotal > 0 && <div className="flex flex-col items-end justify-center whitespace-nowrap">
            <span className="text-[10px] text-cyan-600 dark:text-cyan-400 font-bold uppercase tracking-widest leading-none mb-1">Store Credit</span>
            <span className="text-base font-black text-cyan-700 dark:text-cyan-300 leading-none">LKR {Math.round(appliedStoreCreditTotal).toLocaleString()}</span>
          </div>}
          <div className="flex flex-col items-end justify-center whitespace-nowrap rounded-lg border border-amber-300 dark:border-amber-400/25 bg-amber-50 dark:bg-amber-500/10 px-3 py-1.5">
            <span className="text-[10px] text-amber-800 dark:text-amber-400 font-bold uppercase tracking-widest leading-none mb-1">Due Now</span>
            <span className="text-base font-black text-amber-900 dark:text-amber-300 leading-none">LKR {Math.round(dueAfterCredits).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* 3-PANEL WORKSPACE */}
      <div className="grid flex-1 min-h-0 gap-3 overflow-hidden grid-cols-1 xl:grid-cols-[minmax(250px,0.82fr)_minmax(420px,1.18fr)_minmax(300px,0.9fr)] 2xl:grid-cols-[minmax(300px,0.85fr)_minmax(560px,1.35fr)_minmax(320px,0.8fr)]">
        
        {/* LEFT PANEL: PRODUCT EXPLORER (30%) */}
        <div className="min-h-0 flex flex-col bg-white dark:bg-slate-900/40 backdrop-blur-md border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm">
          <div className="p-3 border-b border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-900/50 space-y-2 shrink-0">
            <div className="relative">
              <Barcode size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input 
                ref={barcodeRef}
                autoFocus
                className="w-full bg-white dark:bg-black/40 border border-slate-300 dark:border-white/10 rounded-xl py-2 pl-9 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                placeholder="Scan Barcode (Enter)"
                value={scanCode}
                onChange={e => setScanCode(e.target.value)}
                onKeyDown={tryAddByCode}
              />
            </div>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input 
                ref={productSearchRef}
                className="w-full bg-white dark:bg-black/20 border border-slate-300 dark:border-white/5 rounded-xl py-2 pl-9 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                placeholder="Search products..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            
            {/* Category Pills */}
            <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1 pt-1">
              {categoryOptions.map(cat => (
                <button 
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`shrink-0 px-3 py-1 rounded-full text-[11px] font-bold transition-colors border ${activeCategory === cat ? "bg-indigo-600 border-indigo-600 text-white" : "bg-slate-100 dark:bg-black/20 border-slate-200 dark:border-white/5 text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white"}`}
                >
                  {cat}
                </button>
              ))}
            </div>
            
            <button 
              onClick={() => setQuickAddOpen((open) => !open)}
              className={`w-full flex items-center justify-center gap-2 rounded-xl py-2 text-xs font-bold transition-all shadow-sm ${
                quickAddOpen 
                  ? "bg-indigo-50 text-indigo-700 border border-indigo-300 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/40 shadow-indigo-500/10" 
                  : "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-gradient-to-r dark:from-indigo-600/15 dark:via-purple-600/15 dark:to-indigo-600/15 dark:text-indigo-200 dark:border-indigo-500/30"
              }`}
            >
              {quickAddOpen ? <X size={14} /> : <Zap size={14} className="text-indigo-600 dark:text-indigo-400 animate-pulse" />}
              <span>{quickAddOpen ? "Hide Quick Add Form" : "Quick Add / Manual Sale"}</span>
            </button>
          </div>

          {quickAddOpen ? (
            <div className="relative border border-indigo-500/20 bg-gradient-to-b from-slate-900/90 via-slate-950/95 to-slate-950 p-3.5 shrink-0 space-y-3.5 rounded-2xl mx-1 my-1 shadow-2xl shadow-indigo-950/50 backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200">
              {/* Header */}
              <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-white/10">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 text-indigo-400 border border-indigo-500/30 shadow-inner shrink-0">
                    <Zap size={16} />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-white flex items-center gap-2">
                      Quick Add Manual Item
                      <span className="text-[10px] uppercase font-extrabold px-1.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">Express</span>
                    </div>
                    <div className="text-[11px] text-slate-400">Inline entry keeps focus stable for POS cashiers.</div>
                  </div>
                </div>
                <button 
                  type="button" 
                  onClick={() => { setQuickAddOpen(false); resetQuickAdd(); }} 
                  className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                  title="Close"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Form Grid */}
              <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Input label="Product Name *" name="name" value={quickAddForm.name} onChange={handleQuickAddChange} placeholder="e.g. Generic Phone Case" />
                </div>
                <Input label="Selling Price (LKR) *" type="text" inputMode="decimal" autoComplete="off" name="sale_price" value={quickAddForm.sale_price} onChange={handleQuickAddChange} placeholder="0.00" />
                <Input label="Quantity *" type="text" inputMode="numeric" autoComplete="off" name="quantity" value={quickAddForm.quantity} onChange={handleQuickAddChange} />
                <div className="sm:col-span-2">
                  <Select
                    label="Category"
                    name="category"
                    value={quickAddForm.category}
                    onChange={handleQuickAddChange}
                    options={quickAddCategoryOptions.map((category) => ({ value: category, label: category }))}
                  />
                </div>
              </div>

              {/* Stats & Live Total Preview */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-0.5 text-[10px] font-medium text-indigo-300 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>
                    Matches: {quickAddStats.matches}
                  </span>
                  <span className="rounded-full border border-white/10 bg-black/40 px-2.5 py-0.5 text-[10px] font-medium text-slate-300 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                    Stock hint: {quickAddStats.stockHint ?? "-"}
                  </span>
                  <span className="rounded-full border border-white/10 bg-black/40 px-2.5 py-0.5 text-[10px] font-medium text-slate-300 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    Price hint: {quickAddStats.priceHint ? `LKR ${Math.round(quickAddStats.priceHint).toLocaleString()}` : "-"}
                  </span>
                </div>

                {Number(quickAddForm.sale_price || 0) > 0 && (
                  <div className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 font-bold text-xs flex items-center gap-1.5 ml-auto">
                    <span className="text-[11px] font-normal text-emerald-400/80">Item Total:</span>
                    <span className="text-emerald-300 font-extrabold text-xs">
                      LKR {(Number(quickAddForm.sale_price || 0) * Number(quickAddForm.quantity || 1)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
              </div>

              {/* Optional Toggle */}
              <div>
                <button 
                  type="button" 
                  onClick={() => setQuickAddOptional((v) => !v)} 
                  className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 font-semibold transition-colors bg-indigo-500/10 hover:bg-indigo-500/20 px-2.5 py-1 rounded-lg border border-indigo-500/20"
                >
                  <ChevronDown size={14} className={quickAddOptional ? "rotate-180 transition-transform duration-200" : "transition-transform duration-200"} />
                  {quickAddOptional ? "Hide Optional Details" : "+ More Item Details (SKU, Cost, Tax, Discount)"}
                </button>
              </div>

              {/* Optional Fields */}
              {quickAddOptional ? (
                <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2 p-3 bg-black/40 rounded-xl border border-white/10 animate-in fade-in slide-in-from-top-2 duration-200">
                  <Input label="SKU / Product Code" name="sku" value={quickAddForm.sku} onChange={handleQuickAddChange} placeholder="Auto-generated if empty" />
                  <Input label="Cost Price (LKR)" type="text" inputMode="decimal" autoComplete="off" name="cost_price" value={quickAddForm.cost_price} onChange={handleQuickAddChange} placeholder="0.00" />
                  <Input label="Tax Rate (%)" type="text" inputMode="decimal" autoComplete="off" name="tax_rate" value={quickAddForm.tax_rate} onChange={handleQuickAddChange} placeholder="0" />
                  <Input label="Discount (%)" type="text" inputMode="decimal" autoComplete="off" name="discount" value={quickAddForm.discount} onChange={handleQuickAddChange} placeholder="0" />
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-400 mb-1">Item Description / Notes</label>
                    <textarea
                      name="description"
                      value={quickAddForm.description}
                      onChange={handleQuickAddChange}
                      placeholder="Brief details about the item..."
                      className="w-full min-h-[64px] rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none transition-all"
                    />
                  </div>
                </div>
              ) : null}

              {/* Action Cards */}
              <div className="grid gap-2 sm:grid-cols-3 pt-1">
                <button 
                  type="button" 
                  disabled={quickAddLoading} 
                  onClick={() => submitQuickAdd("temporary")} 
                  className="relative overflow-hidden group border border-slate-700 hover:border-slate-500 bg-gradient-to-b from-slate-800/90 to-slate-900 hover:from-slate-800 hover:to-slate-850 px-3 py-2.5 rounded-xl text-left transition-all shadow-md disabled:opacity-60"
                >
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-slate-700/60 text-slate-300 group-hover:text-white transition-colors">
                      <Clock size={16} />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white group-hover:text-indigo-200 transition-colors">Temporary Item</div>
                      <div className="text-[10px] text-slate-400">This transaction only</div>
                    </div>
                  </div>
                </button>

                <button 
                  type="button" 
                  disabled={quickAddLoading} 
                  onClick={() => submitQuickAdd("draft")} 
                  className="relative overflow-hidden group border border-amber-500/40 hover:border-amber-400/80 bg-gradient-to-b from-amber-950/40 via-slate-900/90 to-slate-950 px-3 py-2.5 rounded-xl text-left transition-all shadow-md disabled:opacity-60"
                >
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 group-hover:bg-amber-500/30 transition-colors">
                      <FileText size={16} />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-amber-300 group-hover:text-amber-200 transition-colors">Save as Draft</div>
                      <div className="text-[10px] text-amber-400/70">Finish details later</div>
                    </div>
                  </div>
                </button>

                <button 
                  type="button" 
                  disabled={quickAddLoading} 
                  onClick={() => submitQuickAdd("inventory")} 
                  className="relative overflow-hidden group border border-indigo-400/40 hover:border-indigo-300 bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 px-3 py-2.5 rounded-xl text-left transition-all shadow-lg shadow-indigo-600/25 disabled:opacity-60"
                >
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-white/20 text-white shadow-sm">
                      <PackagePlus size={16} />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white">Save to Inventory</div>
                      <div className="text-[10px] text-indigo-100/80">Permanent product</div>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          ) : null}
          
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 grid grid-cols-1 2xl:grid-cols-2 gap-2 content-start">
            {catalogLoading && (
              <div className="col-span-2 text-center py-3 text-[11px] text-slate-400">Searching products...</div>
            )}
            {filteredInventory.map(i => {
              const margin = i.sale_price - i.cost_price;
              const marginPercent = i.cost_price > 0 ? ((margin / i.cost_price) * 100).toFixed(0) : 0;
              const reservedQty = Number(i.reserved_stock || 0);
              const cartReservedQty = cart.reduce((sum, item) => item.item_id === i.id && !item.is_labor ? sum + Number(item.quantity || 0) : sum, 0);
              const availableQty = Math.max(0, Number(i.quantity || 0) - cartReservedQty);
              const stockLabel = availableQty <= 0 ? "Out of Stock" : availableQty <= 5 ? "Low Stock" : "Available";
              return (
              <div 
                key={i.id} 
                onClick={() => {
                  if (longPressTriggeredRef.current) {
                    longPressTriggeredRef.current = false;
                    return;
                  }
                  addItem(i);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    addItem(i);
                  }
                }}
                onMouseDown={() => startLongPress(i)}
                onMouseUp={cancelLongPress}
                onMouseLeave={cancelLongPress}
                onTouchStart={() => startLongPress(i)}
                onTouchEnd={cancelLongPress}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openProductDetail(i);
                }}
                role="button"
                tabIndex={0}
                className="cursor-pointer bg-slate-50 hover:bg-indigo-50/40 dark:bg-black/20 dark:hover:bg-indigo-500/10 border border-slate-200 dark:border-white/5 hover:border-indigo-400 dark:hover:border-indigo-500/50 transition-all p-3 rounded-xl flex flex-col text-left group shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-sm text-slate-800 dark:text-slate-200 line-clamp-2 leading-tight group-hover:text-indigo-600 dark:group-hover:text-white">{i.name}</div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openProductDetail(i);
                    }}
                    className="shrink-0 p-1 rounded-md border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10"
                    title="View details"
                  >
                    <Info size={12} />
                  </button>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">{i.sku || 'No SKU'}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${stockLabel === "Available" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300 border border-emerald-200 dark:border-transparent" : stockLabel === "Low Stock" ? "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300 border border-amber-200 dark:border-transparent" : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300 border border-rose-200 dark:border-transparent"}`}>
                    {stockLabel}
                  </span>
                  {Number(i.warranty_days || 0) > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300 border border-sky-200 dark:border-transparent">
                      {Number(i.warranty_days)}d Warranty
                    </span>
                  )}
                </div>
                <div className="mt-auto pt-3 flex flex-col gap-1.5 w-full">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-black text-indigo-600 dark:text-indigo-400">Rs. {i.sale_price.toLocaleString()}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${availableQty > 5 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400" : availableQty > 0 ? "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300" : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400"}`}>
                      {availableQty} avail
                    </span>
                  </div>
                  {reservedQty > 0 && (
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-slate-500">Reserved:</span>
                      <span className="text-cyan-600 dark:text-cyan-300 font-bold">{reservedQty}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-slate-500">Margin:</span>
                    <span className={margin < 0 ? "text-rose-600 dark:text-rose-400 font-bold" : "text-emerald-600 dark:text-emerald-400 font-bold"}>
                      {marginPercent}% (Rs. {Math.round(margin).toLocaleString()})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      addItem(i);
                    }}
                    className="mt-1 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-indigo-600/20 dark:hover:bg-indigo-600/30 dark:text-indigo-200 dark:border-indigo-400/30 text-[10px] font-bold py-1 transition"
                  >
                    Quick Add
                  </button>
                </div>
              </div>
            );
            })}
            {filteredInventory.length === 0 && (
              <div className="col-span-2 flex flex-col items-center justify-center py-12 px-4 text-center">
                <div className="mb-2.5 grid h-10 w-10 place-items-center rounded-xl border border-slate-300 dark:border-white/10 bg-slate-100 dark:bg-white/5 text-slate-400">
                  <Boxes size={20} />
                </div>
                <p className="text-xs font-bold text-slate-700 dark:text-slate-300">No Products Found</p>
                <p className="text-[11px] text-slate-500 max-w-[200px] mt-0.5">Try searching with a different keyword or scan another barcode.</p>
              </div>
            )}
          </div>
        </div>

        {/* CENTER PANEL: BILLING WORKSPACE (50%) */}
        <div className="min-h-0 flex flex-col bg-white dark:bg-slate-900/60 backdrop-blur-md border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden shadow-sm relative">
          
          {mode === "repair" && (
            <div className="p-3 bg-indigo-50 border-b border-indigo-200 dark:bg-indigo-900/20 dark:border-indigo-500/20 flex flex-wrap gap-2 items-center shrink-0">
               <Wrench size={16} className="text-indigo-600 dark:text-indigo-400" />
               <input 
                 ref={repairTicketRef}
                 className="min-w-[220px] bg-white border border-indigo-300 rounded-lg px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none focus:border-indigo-500 dark:bg-black/40 dark:border-indigo-500/30 dark:text-white dark:placeholder:text-slate-400 flex-1 shadow-sm"
                 placeholder="Link Repair Ticket No. (e.g. R-1001)"
                 value={repairTicketNo}
                 onChange={e => setRepairTicketNo(e.target.value)}
               />
               <button onClick={addLaborCharge} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors shadow-sm">
                 + Add Labor
               </button>
                <button onClick={loadRepairTicketToCart} className="bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold px-3 py-2 rounded-lg transition-colors border border-slate-300 shadow-sm dark:bg-white/10 dark:hover:bg-white/20 dark:text-slate-200 dark:border-white/10">
                  Pull Ticket
                </button>
             </div>
          )}
          {mode === "reservation" && (
            <div className="p-3 bg-cyan-50 border-b border-cyan-200 dark:bg-cyan-900/20 dark:border-cyan-500/20 flex flex-wrap gap-2 items-center shrink-0">
               <Clock size={16} className="text-cyan-600 dark:text-cyan-300" />
               <input
                 ref={reservationRef}
                 className="min-w-[240px] bg-white border border-cyan-300 rounded-lg px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none focus:border-cyan-500 dark:bg-black/40 dark:border-cyan-500/30 dark:text-white dark:placeholder:text-slate-400 flex-1 shadow-sm"
                 placeholder="Reservation No. (e.g. RSV-2026-000001)"
                 value={reservationNo}
                 onChange={e => setReservationNo(e.target.value)}
               />
               <button onClick={loadReservationToCart} className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors shadow-sm">
                 Load Reservation
               </button>
               <a href="/reservations" className="bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold px-3 py-2 rounded-lg transition-colors border border-slate-300 shadow-sm dark:bg-white/10 dark:hover:bg-white/20 dark:text-slate-200 dark:border-white/10 inline-flex items-center">
                 Open Reservations
               </a>
            </div>
          )}
          {mode === "return" && (
            <div className="p-3 bg-rose-50 border-b border-rose-200 dark:bg-rose-900/20 dark:border-rose-500/20 flex flex-wrap gap-2 items-center shrink-0">
               <CornerUpLeft size={16} className="text-rose-600 dark:text-rose-400" />
               <input
                 className="min-w-[240px] bg-white border border-rose-300 rounded-lg px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-500 outline-none focus:border-rose-500 dark:bg-black/40 dark:border-rose-500/30 dark:text-white dark:placeholder:text-slate-400 flex-1 shadow-sm"
                 placeholder="Invoice number, customer, or phone"
                 value={returnInvoiceLookup}
                 onChange={e => setReturnInvoiceLookup(e.target.value)}
                 onKeyDown={e => {
                   if (e.key === "Enter") {
                     e.preventDefault();
                     lookupReturnInvoice();
                   }
                 }}
               />
               <button onClick={() => lookupReturnInvoice()} className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors shadow-sm">
                 Lookup Invoice
               </button>
               <button onClick={() => navigate("/returns")} className="bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold px-3 py-2 rounded-lg transition-colors border border-slate-300 shadow-sm dark:bg-white/10 dark:hover:bg-white/20 dark:text-slate-200 dark:border-white/10">
                 Open Returns Module
               </button>
            </div>
          )}

          {/* Cart Table Area */}
          <div className="flex-1 overflow-auto custom-scrollbar p-0">
             {hasNegativeMargin && (
               <div className="sticky top-0 z-20 bg-rose-500/20 border-b-2 border-rose-500/50 p-2 flex items-center gap-2 text-rose-400 text-xs font-bold">
                 <AlertCircle size={14} /> Negative margin detected on one or more items
               </div>
             )}
             <div className="min-w-[700px]">
                <table className="w-full text-left border-collapse">
                   <thead className="sticky top-0 bg-slate-100 dark:bg-slate-950/80 backdrop-blur z-10 text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-200 dark:border-white/5">
                     <tr>
                       <th className="p-3 font-bold">Item Name</th>
                       <th className="p-3 font-bold text-center w-24">Type</th>
                       <th className="p-3 font-bold text-center w-24">Qty</th>
                       <th className="p-3 font-bold text-right w-24">Price</th>
                       <th className="p-3 font-bold text-center w-24">Warranty</th>
                       <th className="p-3 font-bold text-right w-28">Total</th>
                       <th className="p-3 w-10"></th>
                     </tr>
                   </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-white/5">
                    {cart.map((c, idx) => {
                    const inv = (inventoryFetch.data || []).find(x => x.id === c.item_id);
                    const margin = inv ? (c.price - inv.cost_price) : 0;
                    const isNegativeMargin = !c.is_labor && margin < 0;
                    return (
                    <tr key={`${c.item_id}-${idx}`} onClick={() => setSelectedCartIndex(idx)} className={`hover:bg-slate-100 dark:hover:bg-white/5 transition-colors group ${selectedCartIndex === idx ? "bg-indigo-50/80 dark:bg-indigo-500/10 border-l-2 border-indigo-500" : ""} ${isNegativeMargin ? "bg-rose-500/5" : ""}`}>
                       <td className="p-3">
                         <div className="font-semibold text-sm text-slate-800 dark:text-slate-200 flex items-center gap-2">
                           {c.name}
                           {isNegativeMargin && <AlertCircle size={14} className="text-rose-400" />}
                         </div>
                       </td>
                       <td className="p-3 text-center">
                         <span className={`inline-flex px-2 py-1 rounded text-[10px] font-bold uppercase ${c.line_type === "manual_product" ? "bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-300 border border-fuchsia-500/30" : c.line_type === "product" || c.line_type === "spare_part" ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}>
                           {c.line_type === "manual_product" ? "Quick Sale" : String(c.line_type || "product").replace("_", " ")}
                         </span>
                       </td>
                       <td className="p-3">
                         <div className="flex items-center justify-center bg-slate-100 dark:bg-black/40 border border-slate-300 dark:border-white/10 rounded-lg overflow-hidden">
                           <button onClick={() => stepQty(c.item_id, -1)} className="px-2 py-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/10"><Minus size={12}/></button>
                          <input 
                            type="number" 
                            className="w-8 bg-transparent text-center text-sm font-bold text-slate-900 dark:text-white outline-none no-spinners" 
                            value={c.quantity}
                            onChange={(e) => updateItem(c.item_id, 'quantity', Math.max(1, Number(e.target.value)))}
                          />
                          <button onClick={() => stepQty(c.item_id, 1)} className="px-2 py-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/10"><Plus size={12}/></button>
                        </div>
                      </td>
                      <td className="p-3">
                        <input 
                          type="number" 
                          className={`w-full bg-transparent text-right text-sm font-semibold outline-none focus:bg-slate-100 dark:focus:bg-white/5 border border-transparent focus:border-slate-300 dark:focus:border-white/10 rounded px-1 text-slate-900 dark:text-white ${isNegativeMargin ? "text-rose-600 dark:text-rose-400" : ""}`}
                          value={c.price}
                          onChange={(e) => updateItem(c.item_id, 'price', Math.max(0, Number(e.target.value)))}
                        />
                      </td>
                      <td className="p-3 text-center">
                        {c.is_labor ? (
                          <span className="text-xs text-slate-500">-</span>
                        ) : (
                          <div className="inline-flex items-center gap-1 bg-slate-100 dark:bg-black/30 border border-slate-300 dark:border-white/10 rounded px-1.5 py-0.5">
                            <input
                              type="number"
                              className="bg-transparent text-[10px] w-10 text-center text-slate-800 dark:text-slate-200 outline-none"
                              value={c.warranty_days}
                              onChange={(e) => updateItem(c.item_id, 'warranty_days', Number(e.target.value))}
                              title="Warranty in days"
                            />
                            <span className="text-[10px] text-slate-500">d</span>
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-right font-black text-indigo-600 dark:text-indigo-300">
                        {(c.price * c.quantity).toLocaleString()}
                      </td>
                      <td className="p-3 text-right">
                        <button onClick={() => removeItem(c.item_id)} className="text-rose-500/50 hover:text-rose-600 dark:hover:text-rose-400 transition-colors p-1 rounded hover:bg-rose-500/10">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
              {cart.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center px-6 pb-10 text-center">
                  <div className="mb-4 grid h-16 w-16 place-items-center rounded-2xl border border-indigo-400/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 shadow-lg shadow-indigo-500/10 dark:shadow-indigo-950/30">
                    <ShoppingBasket size={32} />
                  </div>
                  <p className="text-base font-bold text-slate-900 dark:text-slate-200">Your cart is ready</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Scan a barcode, search the catalogue, or select a product card.</p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2 text-[10px] font-semibold text-slate-600 dark:text-slate-400">
                    <span className="rounded-full border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 px-2.5 py-1">F2 Search</span>
                    <span className="rounded-full border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 px-2.5 py-1">Enter Add item</span>
                    <span className="rounded-full border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 px-2.5 py-1">Ctrl + Enter Checkout</span>
                  </div>
                </div>
              )}
           </div>

          {false && (
          <div className="shrink-0 bg-slate-950 border-t border-white/10 p-4 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
            <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3 mb-4">
              
              <div className="space-y-3 min-w-0">
                <div className="flex items-center gap-2">
                  <User size={16} className="text-slate-500 shrink-0" />
                  <CustomerSelect
                    size="sm"
                    className="min-w-0 flex-1"
                    value={customerId} 
                    onChange={(e) => setCustomerId(e.target.value)}
                    customers={customersFetch.data || []}
                    placeholder="Walk-in Customer"
                  />
                  <button onClick={() => setShowNewCustomerModal(true)} className="px-2.5 py-2 rounded-lg bg-white/10 border border-white/10 text-[11px] font-bold hover:bg-white/20 whitespace-nowrap shrink-0">+New</button>
                </div>
                {customerId && (
                  <div className="rounded-lg border border-white/10 bg-black/20 p-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Available Advances</p>
                      <span className="text-[10px] font-bold text-emerald-300">Applied: LKR {Math.round(appliedAdvanceTotal).toLocaleString()}</span>
                    </div>
                    {availableAdvances.length === 0 && (
                      <p className="text-[11px] text-slate-500 mt-2">No available advances.</p>
                    )}
                    {availableAdvances.length > 0 && (
                      <div className="space-y-1.5 mt-2 max-h-28 overflow-y-auto pr-1 custom-scrollbar">
                        {availableAdvances.map((row) => (
                          <div key={row.id} className="grid grid-cols-[1fr,72px,72px] gap-1 items-center">
                            <div className="min-w-0">
                              <div className="text-[10px] text-sky-300 font-bold truncate">{row.advance_number}</div>
                              <div className="text-[10px] text-slate-500 truncate">
                                Remaining: LKR {Math.round(Number(row.remaining_amount || 0)).toLocaleString()}
                              </div>
                            </div>
                            <input
                              type="number"
                              className="bg-black/40 border border-white/10 rounded px-2 py-1 text-[11px] text-right"
                              min={0}
                              max={Number(row.remaining_amount || 0)}
                              value={selectedAdvanceMap[row.id] || ""}
                              onChange={(e) => {
                                const raw = Number(e.target.value || 0);
                                const value = Math.max(0, Math.min(raw, Number(row.remaining_amount || 0)));
                                setSelectedAdvanceMap((prev) => ({ ...prev, [row.id]: value || "" }));
                              }}
                            />
                            <button
                              className="rounded border border-white/10 bg-white/5 py-1 text-[10px] font-bold text-slate-300 hover:bg-white/10"
                              onClick={() => {
                                const maxAmount = Number(row.remaining_amount || 0);
                                setSelectedAdvanceMap((prev) => ({ ...prev, [row.id]: maxAmount }));
                              }}
                            >
                              Full
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {customerId && (
                  <div className="rounded-lg border border-cyan-500/20 bg-cyan-900/10 p-2">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black uppercase tracking-widest text-cyan-200/80">Store Credits</p>
                      <span className="text-[10px] font-bold text-cyan-300">Applied: LKR {Math.round(appliedStoreCreditTotal).toLocaleString()}</span>
                    </div>
                    {availableCredits.length === 0 && (
                      <p className="text-[11px] text-slate-500 mt-2">No available store credits.</p>
                    )}
                    {availableCredits.length > 0 && (
                      <div className="space-y-1.5 mt-2 max-h-24 overflow-y-auto pr-1 custom-scrollbar">
                        {availableCredits.map((row) => (
                          <div key={row.id} className="grid grid-cols-[1fr,68px,64px] gap-1 items-center">
                            <div className="min-w-0">
                              <div className="text-[10px] text-cyan-300 font-bold truncate">{row.credit_number}</div>
                              <div className="text-[10px] text-slate-500 truncate">
                                Rem: LKR {Math.round(Number(row.remaining_amount || 0)).toLocaleString()}
                              </div>
                            </div>
                            <input
                              type="number"
                              className="bg-black/40 border border-cyan-500/20 rounded px-2 py-1 text-[11px] text-right"
                              min={0}
                              max={Number(row.remaining_amount || 0)}
                              value={selectedCreditMap[row.id] || ""}
                              onChange={(e) => {
                                const raw = Number(e.target.value || 0);
                                const value = Math.max(0, Math.min(raw, Number(row.remaining_amount || 0)));
                                setSelectedCreditMap((prev) => ({ ...prev, [row.id]: value || "" }));
                              }}
                            />
                            <button
                              className="rounded border border-cyan-400/20 bg-cyan-500/10 py-1 text-[10px] font-bold text-cyan-200 hover:bg-cyan-500/20"
                              onClick={() => {
                                const maxAmount = Number(row.remaining_amount || 0);
                                setSelectedCreditMap((prev) => ({ ...prev, [row.id]: maxAmount }));
                              }}
                            >
                              Full
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {["Cash", "Card", "Bank Transfer", "Store Credit", "Mixed"].map(m => (
                    <button 
                      key={m}
                      onClick={() => setPaymentMethod(m)}
                      className={`py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-all ${paymentMethod === m ? "bg-indigo-600/20 border-indigo-500 text-indigo-300" : "bg-black/20 border-white/10 text-slate-500 hover:text-slate-300 hover:border-white/20"}`}
                    >
                      {m === "Bank Transfer" ? "Bank" : m === "Store Credit" ? "Credit" : m}
                    </button>
                  ))}
                </div>
                  {paymentMethod === "Cash" && (
                  <div className="flex gap-2">
                    {[dueAfterCredits, 1000, 1500].map((amt, i) => (
                      <button
                        key={i}
                        onClick={() => setCashReceived(i === 0 ? Math.round(dueAfterCredits) : Math.round(amt))}
                        className="flex-1 rounded-md border border-white/10 bg-white/5 py-1 text-[10px] font-bold text-slate-300 hover:bg-white/10"
                      >
                        {i === 0 ? "Exact" : `${amt}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2 min-w-0">
                <div className="bg-black/20 border border-white/5 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Percent size={14} className="text-indigo-300" />
                      <span className="text-xs font-semibold text-slate-200">Discount</span>
                    </div>
                    <div className="flex items-center gap-1 rounded-md bg-white/5 p-0.5">
                      <button type="button" onClick={() => setDiscountMode('amount')} className={`px-2 py-0.5 text-[11px] font-bold rounded ${discountMode === 'amount' ? 'bg-indigo-500 text-white' : 'text-slate-300'}`}>
                        LKR
                      </button>
                      <button type="button" onClick={() => setDiscountMode('percent')} className={`px-2 py-0.5 text-[11px] font-bold rounded ${discountMode === 'percent' ? 'bg-indigo-500 text-white' : 'text-slate-300'}`}>
                        %
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      aria-label={discountMode === 'percent' ? 'Discount percentage' : 'Discount amount in LKR'}
                      type="number"
                      className="flex-1 bg-transparent text-right text-sm font-bold outline-none"
                      placeholder={discountMode === 'percent' ? 'Enter % (max 35)' : 'Enter amount (LKR)'}
                      value={discountValue}
                      onChange={e => updateDiscountValue(e.target.value)}
                    />
                    {discountMode === 'percent' ? <span className="text-xs text-slate-400">%</span> : <span className="text-xs text-slate-400">LKR</span>}
                  </div>
                  <div className="mt-1 text-[11px]">
                    {discountError ? (
                      <span className="text-rose-400">{discountError}</span>
                    ) : (
                      <span className="text-slate-500">
                        {discountMode === 'percent' ? `Max discount ${Math.max(0, Math.floor(maxDiscountPercentAllowed))}%` : `Max discount LKR ${Math.round(maxDiscountAllowed)}`}
                      </span>
                    )}
                  </div>
                </div>
                {paymentMethod === "Cash" && (
                  <div className="flex items-center justify-between bg-black/20 border border-white/5 rounded-lg px-3 py-1.5 focus-within:border-emerald-500/50">
                    <span className="text-xs text-slate-400 font-medium flex items-center gap-2"><Banknote size={12} /> <span className="font-semibold">Cash Given</span></span>
                    <input aria-label="Cash given amount" ref={cashInputRef} type="number" className="w-36 bg-transparent text-right text-sm font-bold text-emerald-400 outline-none" placeholder="Enter amount or use quick buttons" value={cashReceived} onChange={e => setCashReceived(e.target.value)} />
                  </div>
                )}
                {paymentMethod === "Mixed" && (
                  <>
                    <div className="flex items-center justify-between bg-black/20 border border-white/5 rounded-lg px-3 py-1.5">
                      <span className="text-xs text-slate-400 font-medium flex items-center gap-1"><Banknote size={12}/> Cash</span>
                      <input ref={cashInputRef} type="number" className="w-28 bg-transparent text-right text-sm font-bold text-emerald-400 outline-none" placeholder="0" value={cashReceived} onChange={e => setCashReceived(e.target.value)} />
                    </div>
                    <div className="flex items-center justify-between bg-black/20 border border-white/5 rounded-lg px-3 py-1.5">
                      <span className="text-xs text-slate-400 font-medium flex items-center gap-1"><CreditCard size={12}/> Card</span>
                      <input type="number" className="w-28 bg-transparent text-right text-sm font-bold text-sky-400 outline-none" placeholder="0" value={cardAmount} onChange={e => setCardAmount(e.target.value)} />
                    </div>
                    <div className={`text-right text-xs font-bold ${netRemaining <= 0 ? "text-emerald-300" : "text-amber-300"}`}>
                      Remaining: LKR {Math.round(Math.max(0, netRemaining)).toLocaleString()}
                    </div>
                  </>
                )}
                {(paymentMethod === "Card" || paymentMethod === "Bank Transfer" || paymentMethod === "Mixed") && (
                  <div className="flex items-center justify-between bg-black/20 border border-white/5 rounded-lg px-3 py-1.5">
                    <span className="text-xs text-slate-400 font-medium">Ref No.</span>
                    <input
                      ref={paymentRefInputRef}
                      type="text"
                      className="w-40 bg-transparent text-right text-sm font-semibold text-sky-300 outline-none"
                      placeholder="Card / Bank ref"
                      value={paymentReference}
                      onChange={(e) => setPaymentReference(e.target.value)}
                    />
                  </div>
                )}
                {paymentMethod === "Store Credit" && (
                  <div className="text-right text-xs font-bold text-cyan-300">
                    Credit Applied: LKR {Math.round(appliedStoreCreditTotal).toLocaleString()} | Remaining Due: LKR {Math.round(dueAfterCredits).toLocaleString()}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2.5">
              <button onClick={clearCart} className="p-3 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 rounded-xl transition-colors shrink-0" title="Clear Cart (ESC)">
                <Trash2 size={20} />
              </button>
              <button onClick={printReceipt} disabled={!lastSale} className={`p-3 rounded-xl transition-colors shrink-0 ${lastSale ? 'bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20' : 'bg-white/5 text-slate-500 cursor-not-allowed'}`} title="Print Last Receipt (Ctrl+P)">
                <Printer size={20} />
              </button>
              <button onClick={suspendCurrentCart} className="p-3 rounded-xl transition-colors shrink-0 bg-white/5 text-slate-300 hover:bg-white/10 relative" title="Suspend Cart">
                <Save size={20} />
                {pendingSync && <span className="absolute top-1 right-1 w-2 h-2 bg-amber-400 rounded-full animate-pulse" title="Auto-saving..." />}
              </button>
              <button onClick={() => setShowSuspendPicker(true)} className="p-3 rounded-xl transition-colors shrink-0 bg-white/5 text-slate-300 hover:bg-white/10" title="Resume Cart">
                <FolderOpen size={20} />
              </button>
              <button 
                onClick={checkout} 
                disabled={hasNegativeMargin}
                className={`w-full sm:flex-1 sm:min-w-[220px] font-black text-lg uppercase tracking-widest rounded-xl shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2 ${hasNegativeMargin ? "bg-slate-600/50 text-slate-400 cursor-not-allowed opacity-50" : "bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white shadow-indigo-900/50"}`}
                title={hasNegativeMargin ? "Fix negative margins before checkout" : "Complete Sale"}
              >
                Complete Sale
              </button>
            </div>
            {paymentMethod === "Cash" && cashReceived !== "" && (
              signedChange >= 0 ? (
                <div className="text-center mt-3 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <div className="text-xs text-emerald-300/70 font-medium mb-1">CHANGE TO RETURN</div>
                  <div className="text-lg font-black text-emerald-400">LKR {change.toLocaleString()}</div>
                </div>
              ) : (
                <div className="text-center mt-3 p-2 rounded-lg bg-amber-600/10 border border-amber-600/20">
                  <div className="text-xs text-amber-300/70 font-medium mb-1">BALANCE DUE</div>
                  <div className="text-lg font-black text-amber-300">LKR {Math.abs(signedChange).toLocaleString()}</div>
                </div>
              )
            )}
            <div className="text-center mt-2 text-[9px] text-slate-500/70 space-y-1">
              <div>F2: Product Search | F3: Customer | F4: Payment | Ctrl+R: Repair | Ctrl+I: Invoice | Ctrl+P: Print</div>
              <div>Enter: Add first result | Ctrl+Enter: Checkout | Ctrl+Backspace/Delete: Remove line | Esc: Close modal</div>
            </div>
          </div>
          )}
        </div>

        {/* RIGHT PANEL: CHECKOUT RAIL + QUICK ACTIONS */}
        <div className="min-h-0 flex flex-col gap-3 overflow-y-auto custom-scrollbar sticky top-0">
          <div className="rounded-2xl border border-slate-200 dark:border-indigo-500/20 bg-white dark:bg-slate-950/95 p-3.5 shadow-sm dark:shadow-2xl backdrop-blur-xl space-y-4">
            
            {/* Header & Tab Switcher */}
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-white/10">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 dark:border-indigo-500/30">
                  <Wallet size={15} />
                </div>
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">
                    {rightPanelTab === "checkout" ? "Billing & Checkout" : "Return / Exchange"}
                  </h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    {rightPanelTab === "checkout" ? "Express Cashier Terminal" : "Return lookup and exchange processing"}
                  </p>
                </div>
              </div>
              <div className="inline-flex rounded-full border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-black/40 p-1 shrink-0">
                {[
                  { key: "checkout", label: "Checkout" },
                  { key: "return", label: "Returns" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setRightPanelTab(tab.key)}
                    className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-all ${
                      rightPanelTab === tab.key
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {rightPanelTab === "checkout" ? (
              <div className="space-y-3.5">

                {/* 1. CUSTOMER SELECTION */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] uppercase font-bold tracking-widest text-slate-500 dark:text-slate-400">
                    <span className="flex items-center gap-1.5"><User size={12} className="text-indigo-600 dark:text-indigo-400" /> Customer</span>
                    {customerId && <span className="text-emerald-600 dark:text-emerald-400 text-[10px] lowercase font-medium">customer selected</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <CustomerSelect
                      size="sm"
                      className="min-w-0 flex-1"
                      value={customerId}
                      onChange={(e) => setCustomerId(e.target.value)}
                      customers={customersFetch.data || []}
                      placeholder="Walk-in Customer"
                      searchPlaceholder="Search customer by name or phone..."
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewCustomerModal(true)}
                      className="shrink-0 rounded-xl border border-indigo-200 dark:border-indigo-400/30 bg-indigo-50 dark:bg-indigo-500/10 px-2.5 py-2 text-[11px] font-bold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition flex items-center gap-1"
                      title="Add new customer (Alt+N)"
                    >
                      +New <span className="text-[8px] opacity-70 bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 px-1 py-0.5 rounded border border-indigo-300 dark:border-indigo-400/20">Alt+N</span>
                    </button>
                  </div>

                  {/* Customer Advances & Store Credits */}
                  {customerId && (
                    <div className="grid grid-cols-1 gap-2 pt-1">
                      {/* Advances Card */}
                      <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-950/20 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-800 dark:text-emerald-300">Advances</p>
                          <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-200 bg-emerald-100 dark:bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-500/30">Applied: LKR {Math.round(appliedAdvanceTotal).toLocaleString()}</span>
                        </div>
                        {availableAdvances.length === 0 ? (
                          <p className="mt-1 text-[10px] text-slate-500">No available advances for this customer.</p>
                        ) : (
                          <div className="mt-2 max-h-24 space-y-1.5 overflow-y-auto pr-1 custom-scrollbar">
                            {availableAdvances.map((row) => (
                              <div key={row.id} className="grid grid-cols-[1fr,64px,52px] items-center gap-1">
                                <div className="min-w-0">
                                  <div className="truncate text-[10px] font-bold text-emerald-900 dark:text-emerald-200">{row.advance_number}</div>
                                  <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">Rem: LKR {Math.round(Number(row.remaining_amount || 0)).toLocaleString()}</div>
                                </div>
                                <input
                                  type="number"
                                  className="rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-black/40 px-2 py-1 text-right text-[11px] text-slate-900 dark:text-white outline-none focus:border-emerald-400"
                                  min={0}
                                  max={Number(row.remaining_amount || 0)}
                                  value={selectedAdvanceMap[row.id] || ""}
                                  onChange={(e) => {
                                    const raw = Number(e.target.value || 0);
                                    const value = Math.max(0, Math.min(raw, Number(row.remaining_amount || 0)));
                                    setSelectedAdvanceMap((prev) => ({ ...prev, [row.id]: value || "" }));
                                  }}
                                />
                                <button
                                  type="button"
                                  className="rounded-lg border border-emerald-300 dark:border-emerald-400/30 bg-emerald-100 dark:bg-emerald-500/20 py-1 text-[10px] font-bold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-200 dark:hover:bg-emerald-500/30 transition"
                                  onClick={() => {
                                    const maxAmount = Number(row.remaining_amount || 0);
                                    setSelectedAdvanceMap((prev) => ({ ...prev, [row.id]: maxAmount }));
                                  }}
                                >
                                  Full
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Store Credits Card */}
                      <div className="rounded-xl border border-cyan-200 dark:border-cyan-500/20 bg-cyan-50 dark:bg-cyan-950/20 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-black uppercase tracking-widest text-cyan-800 dark:text-cyan-300">Store Credits</p>
                          <span className="text-[10px] font-bold text-cyan-800 dark:text-cyan-200 bg-cyan-100 dark:bg-cyan-500/20 px-2 py-0.5 rounded-full border border-cyan-300 dark:border-cyan-500/30">Applied: LKR {Math.round(appliedStoreCreditTotal).toLocaleString()}</span>
                        </div>
                        {availableCredits.length === 0 ? (
                          <p className="mt-1 text-[10px] text-slate-500">No available store credits.</p>
                        ) : (
                          <div className="mt-2 max-h-24 space-y-1.5 overflow-y-auto pr-1 custom-scrollbar">
                            {availableCredits.map((row) => (
                              <div key={row.id} className="grid grid-cols-[1fr,64px,52px] items-center gap-1">
                                <div className="min-w-0">
                                  <div className="truncate text-[10px] font-bold text-cyan-900 dark:text-cyan-200">{row.credit_number}</div>
                                  <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">Rem: LKR {Math.round(Number(row.remaining_amount || 0)).toLocaleString()}</div>
                                </div>
                                <input
                                  type="number"
                                  className="rounded-lg border border-slate-300 dark:border-cyan-500/30 bg-white dark:bg-black/40 px-2 py-1 text-right text-[11px] text-slate-900 dark:text-white outline-none focus:border-cyan-400"
                                  min={0}
                                  max={Number(row.remaining_amount || 0)}
                                  value={selectedCreditMap[row.id] || ""}
                                  onChange={(e) => {
                                    const raw = Number(e.target.value || 0);
                                    const value = Math.max(0, Math.min(raw, Number(row.remaining_amount || 0)));
                                    setSelectedCreditMap((prev) => ({ ...prev, [row.id]: value || "" }));
                                  }}
                                />
                                <button
                                  type="button"
                                  className="rounded-lg border border-cyan-300 dark:border-cyan-400/30 bg-cyan-100 dark:bg-cyan-500/20 py-1 text-[10px] font-bold text-cyan-800 dark:text-cyan-200 hover:bg-cyan-200 dark:hover:bg-cyan-500/30 transition"
                                  onClick={() => {
                                    const maxAmount = Number(row.remaining_amount || 0);
                                    setSelectedCreditMap((prev) => ({ ...prev, [row.id]: maxAmount }));
                                  }}
                                >
                                  Full
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. ORDER SUMMARY & DUE NOW HERO */}
                <div className="rounded-2xl border border-slate-200 dark:border-amber-400/30 bg-slate-50 dark:bg-gradient-to-b dark:from-amber-950/20 dark:via-slate-900/90 dark:to-slate-950 p-3.5 shadow-sm dark:shadow-xl space-y-2.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                    <span>Subtotal ({cart.reduce((sum, item) => sum + Number(item.quantity || 1), 0)} items)</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-200">LKR {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                  {discountAmount > 0 && (
                    <div className="flex items-center justify-between text-[11px] text-emerald-700 dark:text-emerald-400">
                      <span>Discount ({discountMode === 'percent' ? `${discountValue}%` : 'Flat'})</span>
                      <span className="font-semibold">- LKR {discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  {Number(taxAmount || 0) > 0 && (
                    <div className="flex items-center justify-between text-[11px] text-sky-700 dark:text-sky-400">
                      <span>Tax</span>
                      <span className="font-semibold">+ LKR {Number(taxAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  <div className="border-t border-slate-200 dark:border-white/10 pt-2 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Total Amount</span>
                    <span className="text-sm font-black text-slate-900 dark:text-indigo-200">LKR {Math.round(grandTotal).toLocaleString()}</span>
                  </div>

                  {(appliedAdvanceTotal > 0 || appliedStoreCreditTotal > 0) && (
                    <div className="grid grid-cols-2 gap-2 pt-1 text-[10px]">
                      {appliedAdvanceTotal > 0 && (
                        <div className="rounded-lg bg-emerald-50 dark:bg-black/40 px-2.5 py-1 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/20 flex justify-between">
                          <span>Advance:</span>
                          <strong>-LKR {Math.round(appliedAdvanceTotal).toLocaleString()}</strong>
                        </div>
                      )}
                      {appliedStoreCreditTotal > 0 && (
                        <div className="rounded-lg bg-cyan-50 dark:bg-black/40 px-2.5 py-1 text-cyan-800 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-500/20 flex justify-between">
                          <span>Credit:</span>
                          <strong>-LKR {Math.round(appliedStoreCreditTotal).toLocaleString()}</strong>
                        </div>
                      )}
                    </div>
                  )}

                  {/* PROMINENT DUE NOW HERO BOX */}
                  <div className="rounded-xl border border-amber-300 dark:border-amber-400/40 bg-amber-50 dark:bg-gradient-to-r dark:from-amber-500/20 dark:via-amber-500/10 dark:to-transparent p-3 flex items-center justify-between shadow-inner mt-2">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-amber-800 dark:text-amber-300/90">DUE NOW</p>
                      <p className="text-2xl sm:text-3xl font-black leading-none text-slate-950 dark:text-white tracking-tight mt-0.5">
                        LKR {Math.round(dueAfterCredits).toLocaleString()}
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-amber-200 dark:bg-amber-400/20 border border-amber-300 dark:border-amber-400/30 text-amber-900 dark:text-amber-200 text-[10px] font-extrabold uppercase">
                      {cart.length} {cart.length === 1 ? 'Item' : 'Items'}
                    </span>
                  </div>
                </div>

                {/* 3. DISCOUNT BAR */}
                <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30 p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
                      <Percent size={13} className="text-indigo-600 dark:text-indigo-400" />
                      <span>Discount</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-black/50 p-0.5 border border-slate-200 dark:border-white/10">
                        <button
                          type="button"
                          onClick={() => setDiscountMode('amount')}
                          className={`px-2 py-0.5 text-[10px] font-extrabold rounded-md transition ${discountMode === 'amount' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white'}`}
                        >
                          LKR
                        </button>
                        <button
                          type="button"
                          onClick={() => setDiscountMode('percent')}
                          className={`px-2 py-0.5 text-[10px] font-extrabold rounded-md transition ${discountMode === 'percent' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white'}`}
                        >
                          %
                        </button>
                      </div>
                      <input
                        aria-label={discountMode === 'percent' ? 'Discount percentage' : 'Discount amount in LKR'}
                        type="number"
                        className="w-24 bg-white dark:bg-black/40 border border-slate-300 dark:border-white/10 rounded-lg px-2.5 py-1 text-right text-xs font-bold text-slate-900 dark:text-white outline-none focus:border-indigo-500"
                        placeholder={discountMode === 'percent' ? '0 %' : '0 LKR'}
                        value={discountValue}
                        onChange={e => updateDiscountValue(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="text-[10px] text-right">
                    {discountError ? (
                      <span className="text-rose-600 dark:text-rose-400 font-semibold">{discountError}</span>
                    ) : (
                      <span className="text-slate-500">
                        {discountMode === 'percent' ? `Max allowed: ${Math.max(0, Math.floor(maxDiscountPercentAllowed))}%` : `Max allowed: LKR ${Math.round(maxDiscountAllowed)}`}
                      </span>
                    )}
                  </div>
                </div>

                {/* 4. PAYMENT METHOD SELECTOR */}
                <div className="space-y-2">
                  <div className="text-[10px] uppercase font-bold tracking-widest text-slate-500 dark:text-slate-400 flex items-center justify-between">
                    <span>Payment Method</span>
                    <span className="text-indigo-600 dark:text-indigo-400 font-bold text-[10px]">{paymentMethod}</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {[
                      { id: "Cash", label: "Cash", icon: Banknote, key: "F4" },
                      { id: "Card", label: "Card", icon: CreditCard, key: "F5" },
                      { id: "Bank Transfer", label: "Bank", icon: Banknote, key: "F6" },
                      { id: "Store Credit", label: "Credit", icon: Wallet, key: "F7" },
                      { id: "Mixed", label: "Mixed", icon: Wallet, key: "F8" },
                    ].map((item) => {
                      const IconComponent = item.icon;
                      const isActive = paymentMethod === item.id;
                      return (
                        <button
                          key={`rail-${item.id}`}
                          type="button"
                          onClick={() => setPaymentMethod(item.id)}
                          className={`flex items-center justify-between rounded-xl border px-2.5 py-2 text-[11px] font-extrabold transition-all shadow-sm ${
                            isActive
                              ? "border-indigo-600 bg-indigo-50 text-indigo-900 dark:border-indigo-400/90 dark:bg-gradient-to-r dark:from-indigo-600/30 dark:to-purple-600/30 dark:text-white shadow-indigo-500/10 dark:shadow-indigo-950/40 ring-1 ring-indigo-500/30 dark:ring-indigo-400/50"
                              : "border-slate-200 dark:border-white/10 bg-white dark:bg-black/30 text-slate-700 dark:text-slate-400 hover:border-slate-300 dark:hover:border-white/20 hover:text-slate-950 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-black/50"
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            <IconComponent size={13} className={isActive ? "text-indigo-600 dark:text-indigo-300" : "text-slate-400 dark:text-slate-500"} />
                            {item.label}
                          </span>
                          <span className={`rounded px-1 py-0.5 text-[8px] font-bold border ${isActive ? "bg-indigo-100 dark:bg-indigo-500/30 border-indigo-200 dark:border-indigo-400/40 text-indigo-700 dark:text-indigo-200" : "bg-slate-100 dark:bg-black/40 border-slate-200 dark:border-white/5 text-slate-500"}`}>
                            {item.key}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* DYNAMIC PAYMENT INPUTS */}
                  {paymentMethod === "Cash" && (
                    <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/20 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5 shrink-0">
                          <Banknote size={14} className="text-emerald-600 dark:text-emerald-400" /> Cash Received
                        </span>
                        <div className="relative">
                          <input
                            aria-label="Cash given amount"
                            ref={cashInputRef}
                            type="number"
                            className="w-32 bg-white dark:bg-black/60 border border-emerald-300 dark:border-emerald-500/40 rounded-lg px-2.5 py-1 text-right text-base font-black text-emerald-800 dark:text-emerald-300 outline-none focus:border-emerald-400 placeholder:text-slate-400 dark:placeholder:text-slate-600"
                            placeholder="0.00"
                            value={cashReceived}
                            onChange={e => setCashReceived(e.target.value)}
                          />
                        </div>
                      </div>

                      {/* Quick Presets */}
                      <div className="grid grid-cols-3 gap-1.5 pt-1">
                        {(() => {
                          const exact = Math.round(dueAfterCredits);
                          let presets = [exact];
                          if (exact > 0) {
                            let p1 = exact <= 500 ? 500 : exact <= 1000 ? 1000 : exact <= 2000 ? 2000 : Math.ceil(exact / 1000) * 1000;
                            let p2 = exact <= 1000 ? 2000 : exact <= 5000 ? 5000 : Math.ceil(exact / 5000) * 5000;
                            if (p1 <= exact) p1 = exact + 500;
                            if (p2 <= p1) p2 = p1 + 1000;
                            presets = [exact, p1, p2];
                          } else {
                            presets = [0, 1000, 5000];
                          }
                          return presets.map((amt, i) => (
                            <button
                              key={`rail-cash-${i}`}
                              type="button"
                              onClick={() => setCashReceived(amt)}
                              className="rounded-lg border border-emerald-300 dark:border-emerald-500/25 bg-white dark:bg-emerald-500/10 py-1.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-500/25 transition shadow-sm"
                            >
                              {i === 0 ? "EXACT" : `LKR ${amt.toLocaleString()}`}
                            </button>
                          ));
                        })()}
                      </div>

                      {/* Change / Balance Banner */}
                      {cashReceived !== "" && (
                        signedChange >= 0 ? (
                          <div className="mt-2 rounded-lg border border-emerald-300 dark:border-emerald-500/40 bg-emerald-100/80 dark:bg-emerald-500/20 px-3 py-2 text-center shadow-inner">
                            <div className="text-[10px] font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-300">CHANGE TO RETURN</div>
                            <div className="text-xl font-black text-emerald-900 dark:text-emerald-200 mt-0.5">LKR {change.toLocaleString()}</div>
                          </div>
                        ) : (
                          <div className="mt-2 rounded-lg border border-amber-300 dark:border-amber-500/40 bg-amber-100/80 dark:bg-amber-500/20 px-3 py-2 text-center shadow-inner">
                            <div className="text-[10px] font-black uppercase tracking-wider text-amber-800 dark:text-amber-300">BALANCE DUE</div>
                            <div className="text-xl font-black text-amber-900 dark:text-amber-200 mt-0.5">LKR {Math.abs(signedChange).toLocaleString()}</div>
                          </div>
                        )
                      )}
                    </div>
                  )}

                  {paymentMethod === "Mixed" && (
                    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/40 p-3 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block space-y-1">
                          <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">Cash Amount</span>
                          <input ref={cashInputRef} type="number" className="w-full rounded-lg border border-emerald-300 dark:border-emerald-500/30 bg-white dark:bg-black/50 px-2.5 py-1 text-sm font-bold text-emerald-800 dark:text-emerald-300 outline-none focus:border-emerald-400" value={cashReceived} onChange={e => setCashReceived(e.target.value)} />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">Card Amount</span>
                          <input type="number" className="w-full rounded-lg border border-sky-300 dark:border-sky-500/30 bg-white dark:bg-black/50 px-2.5 py-1 text-sm font-bold text-sky-800 dark:text-sky-300 outline-none focus:border-sky-400" value={cardAmount} onChange={e => setCardAmount(e.target.value)} />
                        </label>
                      </div>
                      <div className={`text-right text-xs font-bold pt-1 ${netRemaining <= 0 ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
                        {netRemaining <= 0 ? "Fully Paid" : `Remaining Due: LKR ${Math.round(Math.max(0, netRemaining)).toLocaleString()}`}
                      </div>
                    </div>
                  )}

                  {(paymentMethod === "Card" || paymentMethod === "Bank Transfer" || paymentMethod === "Mixed") && (
                    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/40 px-3 py-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 shrink-0">Ref / Transaction #</span>
                      <input
                        ref={paymentRefInputRef}
                        type="text"
                        className="w-full max-w-[180px] bg-transparent text-right text-xs font-bold text-sky-700 dark:text-sky-300 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-600"
                        placeholder="Card/Bank reference..."
                        value={paymentReference}
                        onChange={(e) => setPaymentReference(e.target.value)}
                      />
                    </div>
                  )}

                  {paymentMethod === "Store Credit" && (
                    <div className="rounded-xl border border-cyan-200 dark:border-cyan-500/30 bg-cyan-50 dark:bg-cyan-950/20 p-2.5 text-right text-xs font-bold text-cyan-800 dark:text-cyan-300">
                      Credit Applied: LKR {Math.round(appliedStoreCreditTotal).toLocaleString()} | Remaining Due: LKR {Math.round(dueAfterCredits).toLocaleString()}
                    </div>
                  )}
                </div>

                {/* 5. MAIN CHECKOUT CTA BUTTON */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={checkout}
                    disabled={checkoutDisabled}
                    className={`w-full py-3.5 px-4 rounded-xl font-black text-sm uppercase tracking-wider transition-all active:scale-[0.98] flex items-center justify-center gap-2 ${
                      checkoutDisabled
                        ? "bg-slate-100 text-slate-500 border border-slate-300 shadow-sm cursor-not-allowed dark:bg-slate-900/80 dark:border-white/10 dark:text-slate-500"
                        : "bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-xl shadow-indigo-600/30 border border-indigo-400/40"
                    }`}
                    title={
                      mode === "return"
                        ? "Return mode does not support standard checkout"
                        : hasNegativeMargin
                          ? "Fix negative margins before checkout"
                          : cart.length === 0
                            ? "Add an item to the cart first"
                            : "Complete Sale (Ctrl+Enter)"
                    }
                  >
                    <ShoppingCart size={16} />
                    <span>
                      {mode === "return"
                        ? "RETURN MODE ACTIVE"
                        : cart.length === 0
                          ? "ADD ITEMS TO BEGIN"
                          : `COMPLETE SALE · LKR ${Math.round(dueAfterCredits).toLocaleString()}`}
                    </span>
                  </button>
                </div>

                {/* 6. SECONDARY QUICK ACTIONS TOOLBAR */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-1.5 flex-1">
                    <button
                      type="button"
                      onClick={clearCart}
                      className="p-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-300 dark:bg-rose-500/10 dark:hover:bg-rose-500/20 dark:text-rose-400 dark:border-rose-500/20 transition-colors shadow-sm"
                      title="Clear Cart (ESC)"
                    >
                      <Trash2 size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={printReceipt}
                      disabled={!lastSale}
                      className={`p-2.5 rounded-xl border transition-colors shadow-sm ${
                        lastSale
                          ? 'bg-indigo-50 border-indigo-300 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:border-indigo-500/30 dark:text-indigo-300 dark:hover:bg-indigo-500/20'
                          : 'bg-slate-100 border-slate-300 text-slate-400 dark:bg-white/5 dark:border-white/5 dark:text-slate-600 cursor-not-allowed'
                      }`}
                      title="Print Last Receipt (Ctrl+P)"
                    >
                      <Printer size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={suspendCurrentCart}
                      className="relative p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 dark:bg-white/5 dark:hover:bg-white/10 dark:text-slate-300 dark:border-white/10 transition-colors shadow-sm"
                      title="Suspend Cart"
                    >
                      <Save size={16} />
                      {pendingSync && <span className="absolute top-1 right-1 w-2 h-2 bg-amber-400 rounded-full animate-pulse" title="Auto-saving..." />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowSuspendPicker(true)}
                      className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 dark:bg-white/5 dark:hover:bg-white/10 dark:text-slate-300 dark:border-white/10 transition-colors shadow-sm"
                      title="Resume Cart"
                    >
                      <FolderOpen size={16} />
                    </button>
                  </div>
                </div>

                {/* Keyboard Shortcut Summary */}
                <div className="text-center text-[9px] font-medium text-slate-400/80 pt-1 space-y-0.5">
                  <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5">
                    <span><strong className="text-slate-300">F2</strong> Search</span>
                    <span>•</span>
                    <span><strong className="text-slate-300">F3</strong> Customer</span>
                    <span>•</span>
                    <span><strong className="text-slate-300">F4-F8</strong> Payments</span>
                    <span>•</span>
                    <span><strong className="text-slate-300">Ctrl+Enter</strong> Checkout</span>
                  </div>
                </div>

              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-rose-500/20 bg-rose-950/20 p-3 shadow-inner">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-black uppercase tracking-wider text-rose-300 flex items-center gap-1.5">
                        <RotateCcw size={13} className="text-rose-400 shrink-0" /> Return / Exchange Quick Lookup
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">Lookup invoice, select items, and process refunds or exchanges.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate("/returns")}
                      className="rounded-lg bg-rose-500/20 border border-rose-500/40 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-rose-200 hover:bg-rose-500/30 transition shadow-sm shrink-0 whitespace-nowrap"
                    >
                      Open Full Returns Page
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900/50 p-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr,auto]">
                    <div className="relative">
                      <input
                        type="text"
                        className="w-full rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-950/80 px-3 py-2 pl-8 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 outline-none focus:border-indigo-500 dark:focus:border-indigo-400/80 transition"
                        placeholder="Invoice #, customer name, or phone"
                        value={returnInvoiceLookup}
                        onChange={(e) => setReturnInvoiceLookup(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            lookupReturnInvoice();
                          }
                        }}
                      />
                      <Search size={14} className="absolute left-2.5 top-3 text-slate-400 dark:text-slate-500" />
                    </div>
                    <button
                      type="button"
                      onClick={() => lookupReturnInvoice()}
                      disabled={returnSearchBusy}
                      className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white shadow-md transition disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {returnSearchBusy ? "Searching..." : "Lookup Invoice"}
                    </button>
                  </div>
                </div>

                {returnInvoicePayload?.selected_invoice ? (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-950/30 p-3 text-xs text-slate-700 dark:text-slate-300 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <span className="text-[10px] uppercase tracking-widest font-bold text-indigo-700 dark:text-indigo-300">Invoice Ref</span>
                          <p className="font-bold text-slate-900 dark:text-white text-sm">{returnInvoicePayload.selected_invoice.invoice_no}</p>
                          <p className="text-slate-500 dark:text-slate-400 mt-0.5">{returnInvoicePayload.selected_invoice.customer_name || "Walk-in Customer"} • {returnInvoicePayload.selected_invoice.customer_phone || "—"}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400">Payment Method</p>
                          <span className="inline-block mt-0.5 rounded-md bg-indigo-100 dark:bg-white/10 px-2 py-0.5 font-bold text-indigo-900 dark:text-indigo-200 text-xs">
                            {returnInvoicePayload.selected_invoice.payment_method || "Cash"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900/50 p-3">
                      <div className="flex items-center justify-between gap-2 mb-2.5 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                        <span className="flex items-center gap-1.5"><Tag size={12} className="text-indigo-600 dark:text-indigo-400" /> Eligible Return Items</span>
                        <span className="rounded-full bg-slate-200 dark:bg-white/10 px-2 py-0.5 font-bold text-slate-700 dark:text-slate-300">{(returnInvoicePayload.selected_invoice.items || []).filter((row) => Number(row.returnable_qty || 0) > 0).length} available</span>
                      </div>
                      {returnInvoicePayload.selected_invoice.items?.length ? (
                        <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-0.5">
                          {(returnInvoicePayload.selected_invoice.items || []).map((row) => {
                            const isSelected = selectedReturnItem?.sale_item_id === row.sale_item_id;
                            const isEligible = Number(row.returnable_qty || 0) > 0;
                            return (
                              <button
                                key={row.sale_item_id}
                                type="button"
                                disabled={!isEligible}
                                onClick={() => setSelectedReturnItem(row)}
                                className={`w-full rounded-xl border p-3 text-left transition ${
                                  isSelected
                                    ? "border-indigo-600 bg-indigo-50 dark:border-indigo-400/80 dark:bg-indigo-500/20 shadow-md shadow-indigo-500/10 dark:shadow-indigo-950/50 ring-1 ring-indigo-500/30 dark:ring-indigo-400/40"
                                    : isEligible
                                      ? "border-slate-200 dark:border-white/10 bg-white dark:bg-slate-950/70 hover:border-indigo-300 dark:hover:border-indigo-400/40 hover:bg-slate-50 dark:hover:bg-slate-900"
                                      : "border-slate-200 dark:border-white/5 bg-slate-100 dark:bg-white/[0.02] opacity-50 cursor-not-allowed"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className={`font-bold text-xs truncate ${isSelected ? "text-indigo-900 dark:text-white" : "text-slate-900 dark:text-slate-200"}`}>{row.product_name}</div>
                                    <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 mt-0.5">Unit price: LKR {Math.round(Number(row.unit_price || 0)).toLocaleString()}</div>
                                  </div>
                                  <span className={`shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider transition ${
                                    isSelected
                                      ? "bg-indigo-600 text-white shadow-sm"
                                      : isEligible
                                        ? "bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-white/20"
                                        : "bg-slate-200 dark:bg-white/5 text-slate-400 dark:text-slate-500"
                                  }`}>
                                    {isSelected ? "Selected" : isEligible ? "Select" : "Returned"}
                                  </span>
                                </div>
                                <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-[10px] text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-white/5 pt-2">
                                  <div>Sold: <span className="font-bold text-slate-800 dark:text-slate-200">{row.sold_qty}</span></div>
                                  <div>Returned: <span className="font-bold text-slate-800 dark:text-slate-200">{row.already_returned_qty}</span></div>
                                  <div>Eligible: <span className={`font-extrabold ${isEligible ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}>{row.returnable_qty}</span></div>
                                </div>
                                {row.serial_number && (
                                  <div className="mt-1.5 text-[10px] font-mono text-indigo-700 dark:text-indigo-300/80 bg-indigo-50 dark:bg-indigo-500/10 rounded px-1.5 py-0.5 inline-block border border-indigo-200 dark:border-indigo-400/20">
                                    SN: {row.serial_number}
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 py-3 text-center bg-slate-100 dark:bg-white/[0.02] rounded-lg">No eligible return items found for this invoice.</div>
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900/50 p-3 space-y-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                          Action
                          <select
                            value={returnAction}
                            onChange={(e) => setReturnAction(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-950/80 px-3 py-2 text-xs font-bold text-slate-900 dark:text-white outline-none focus:border-indigo-500 dark:focus:border-indigo-400"
                          >
                            <option value="refund">Refund Money</option>
                            <option value="exchange">Exchange Product</option>
                            <option value="store_credit">Issue Store Credit</option>
                          </select>
                        </label>
                        <label className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                          Quantity
                          <input
                            type="number"
                            min="1"
                            max={selectedReturnItem?.returnable_qty || 1}
                            value={returnQuantity}
                            onChange={(e) => setReturnQuantity(Number(e.target.value || 1))}
                            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-950/80 px-3 py-2 text-xs font-bold text-slate-900 dark:text-white outline-none focus:border-indigo-500 dark:focus:border-indigo-400"
                          />
                        </label>
                      </div>
                      <label className="block text-[10px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                        Notes / Reason
                        <textarea
                          value={returnNotes}
                          onChange={(e) => setReturnNotes(e.target.value)}
                          rows={2.5}
                          className="mt-1 w-full rounded-lg border border-slate-300 dark:border-white/10 bg-white dark:bg-slate-950/80 px-3 py-2 text-xs text-slate-900 dark:text-white outline-none resize-none focus:border-indigo-500 dark:focus:border-indigo-400"
                          placeholder="Reason for return/exchange or internal note..."
                        />
                      </label>
                      <button
                        type="button"
                        onClick={processReturnAction}
                        disabled={returnBusy || !selectedReturnItem}
                        className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-950/40 px-4 py-3 text-xs font-black uppercase tracking-widest transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {returnBusy ? "Processing..." : returnAction === "refund" ? "Issue Refund" : returnAction === "exchange" ? "Create Exchange Case" : "Create Store Credit Case"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-950/50 p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                    <p className="font-semibold text-slate-700 dark:text-slate-300">No Invoice Selected</p>
                    <p className="mt-1 text-[11px] text-slate-500">Enter an invoice number or customer lookup above to inspect eligible items for return/exchange.</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {mode === "repair" && <div className="bg-white dark:bg-slate-900/40 backdrop-blur-md border border-slate-200 dark:border-white/5 rounded-2xl p-4 shadow-sm shrink-0">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2"><Wrench size={12}/> Repair Actions</h3>
            <div className="grid grid-cols-1 gap-2">
              <Link to="/repairs" className="bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200 dark:border-white/5 text-slate-800 dark:text-slate-200 rounded-lg p-2.5 text-xs font-semibold text-center transition-colors">New Repair Ticket</Link>
              <button onClick={() => setMode("repair")} className="bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-500/20 border border-indigo-200 dark:border-indigo-500/30 text-indigo-700 dark:text-indigo-300 rounded-lg p-2.5 text-xs font-semibold text-center transition-colors">Process Repair Payment</button>
            </div>
          </div>}

          {mode === "reservation" && <div className="bg-white dark:bg-slate-900/40 backdrop-blur-md border border-slate-200 dark:border-white/5 rounded-2xl p-4 shadow-sm shrink-0">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2"><Clock size={12}/> Reservation Tools</h3>
            <div className="grid grid-cols-1 gap-2">
              <button onClick={() => setMode("reservation")} className="bg-cyan-50 hover:bg-cyan-100 dark:bg-cyan-500/20 border border-cyan-200 dark:border-cyan-500/30 text-cyan-800 dark:text-cyan-200 rounded-lg p-2.5 text-xs font-semibold text-center transition-colors">Reservation Settlement</button>
              <Link to="/reservations" className="bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200 dark:border-white/5 text-slate-800 dark:text-slate-200 rounded-lg p-2.5 text-xs font-semibold text-center transition-colors">Open Reservations Module</Link>
              <Link to="/returns" className="bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/20 border border-rose-200 dark:border-rose-500/30 text-rose-800 dark:text-rose-200 rounded-lg p-2.5 text-xs font-semibold text-center transition-colors">Returns / Exchanges</Link>
            </div>
          </div>}

          {mode !== "sale" && <div className="bg-white dark:bg-slate-900/40 backdrop-blur-md border border-slate-200 dark:border-white/5 rounded-2xl p-4 shadow-sm shrink-0">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2"><User size={12}/> Customer Actions</h3>
            <div className="grid grid-cols-1 gap-2">
              <Link to="/customers" className="bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200 dark:border-white/5 text-slate-800 dark:text-slate-200 rounded-lg p-2.5 text-xs font-semibold text-center transition-colors">Add New Customer</Link>
              <button onClick={() => setShowNewCustomerModal(true)} className="bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200 dark:border-white/5 text-slate-800 dark:text-slate-200 rounded-lg p-2.5 text-xs font-semibold text-center transition-colors">Quick Create Customer</button>
            </div>
          </div>}

          {lastSale && <div className="bg-white dark:bg-slate-900/40 backdrop-blur-md border border-slate-200 dark:border-white/5 rounded-2xl p-4 shadow-sm shrink-0">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2"><Printer size={12}/> Receipt Actions</h3>
            <div className="grid grid-cols-1 gap-2">
              <button onClick={printReceipt} className="bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200 dark:border-white/5 text-slate-800 dark:text-slate-200 rounded-lg p-2.5 text-xs font-semibold text-center transition-colors">Print Receipt</button>
              <button onClick={sendReceiptWhatsApp} className="bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200 dark:border-white/5 text-slate-800 dark:text-slate-200 rounded-lg p-2.5 text-xs font-semibold text-center transition-colors flex items-center justify-center gap-1"><MessageCircle size={12}/> WhatsApp</button>
              <button onClick={sendReceiptEmail} className="bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200 dark:border-white/5 text-slate-800 dark:text-slate-200 rounded-lg p-2.5 text-xs font-semibold text-center transition-colors flex items-center justify-center gap-1"><Mail size={12}/> Email</button>
            </div>
          </div>}

          <div className="bg-white dark:bg-slate-900/40 backdrop-blur-md border border-slate-200 dark:border-white/5 rounded-2xl p-4 shadow-sm shrink-0">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2"><Wallet size={12}/> Shift Snapshot</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-xs"><span className="text-slate-500">Today's Sales</span><span className="font-bold text-slate-900 dark:text-slate-200">{cashierSummary.count}</span></div>
              <div className="flex justify-between text-xs"><span className="text-slate-500">Today's Revenue</span><span className="font-bold text-emerald-600 dark:text-emerald-300">LKR {Math.round(cashierSummary.total).toLocaleString()}</span></div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900/40 backdrop-blur-md border border-slate-200 dark:border-white/5 rounded-2xl p-4 shadow-sm shrink-0">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2"><AlertCircle size={12}/> Inventory Alerts</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Low Stock</span>
                <span className="font-bold text-amber-600 dark:text-amber-300">{inventoryAlerts.low.length}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Out of Stock</span>
                <span className="font-bold text-rose-600 dark:text-rose-300">{inventoryAlerts.out.length}</span>
              </div>
              <div className="max-h-20 overflow-y-auto custom-scrollbar space-y-1 pr-1">
                {inventoryAlerts.low.slice(0, 3).map((row) => (
                  <div key={`low-${row.id}`} className="text-[10px] text-amber-700 dark:text-amber-200 truncate">{row.name} ({row.quantity})</div>
                ))}
                {inventoryAlerts.out.slice(0, 2).map((row) => (
                  <div key={`out-${row.id}`} className="text-[10px] text-rose-700 dark:text-rose-200 truncate">{row.name} (0)</div>
                ))}
                {inventoryAlerts.low.length === 0 && inventoryAlerts.out.length === 0 && (
                  <div className="text-[10px] text-slate-500">No critical alerts</div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900/40 backdrop-blur-md border border-slate-200 dark:border-white/5 rounded-2xl p-3 shadow-sm shrink-0">
            <button
              type="button"
              onClick={() => setShowRecentSales((value) => !value)}
              className="flex w-full items-center justify-between gap-2 text-left"
            >
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2"><Clock size={12}/> Recent Sales</h3>
              <span className="rounded-md border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 px-2 py-1 text-[10px] font-bold text-slate-700 dark:text-slate-300">
                {showRecentSales ? "Hide" : "Show"}
              </span>
            </button>
            {showRecentSales && (
            <div className="mt-3 max-h-[280px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {(salesFetch.data || []).slice(0,10).map((s) => (
                <div key={s.id} className="bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/5 rounded-lg p-2.5 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-default">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-300">{s.invoice_no}</span>
                    <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">{s.total.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-slate-500">{new Date(s.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${s.payment_method === 'Cash' ? 'bg-emerald-50 dark:bg-green-500/10 text-emerald-700 dark:text-green-400 border border-emerald-200 dark:border-transparent' : 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-transparent'}`}>
                      {s.payment_method}
                    </span>
                  </div>
                  {!s.is_voided && !s.is_return && (
                    <div className="mt-2 grid grid-cols-4 gap-1">
                      <button onClick={(e) => { e.stopPropagation(); openReturnModal(s.id); }} className="w-full flex items-center justify-center gap-0.5 py-1 rounded bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/10 dark:hover:bg-rose-500/20 text-rose-700 dark:text-rose-400 text-[9px] font-bold transition-colors border border-rose-200 dark:border-transparent">
                        <CornerUpLeft size={10} /> Return
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); quickReprint(s.id); }} className="w-full flex items-center justify-center gap-0.5 py-1 rounded bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-[9px] font-bold transition-colors border border-indigo-200 dark:border-transparent">
                        <Printer size={10} /> Print
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); shareRecentSaleWhatsApp(s); }} className="w-full flex items-center justify-center gap-0.5 py-1 rounded bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[9px] font-bold transition-colors border border-emerald-200 dark:border-transparent">
                        <Share2 size={10} /> Share
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); voidSale(s); }} className="w-full flex items-center justify-center gap-0.5 py-1 rounded bg-amber-50 hover:bg-amber-100 dark:bg-amber-500/10 dark:hover:bg-amber-500/20 text-amber-800 dark:text-amber-300 text-[9px] font-bold transition-colors border border-amber-200 dark:border-transparent">
                        Void
                      </button>
                    </div>
                  )}
                  {s.is_voided && <div className="mt-2 text-center text-[9px] font-bold text-amber-400 uppercase">Voided</div>}
                  {s.is_return && <div className="mt-2 text-center text-[9px] font-bold text-rose-500 uppercase">Refunded</div>}
                </div>
              ))}
            </div>
            )}
          </div>

        </div>

      </div>

      {/* RETURN MODAL */}
      <AppModal
        open={!!productDetail}
        onClose={() => setProductDetail(null)}
        title="Product Details"
        panelClassName="max-w-lg border-indigo-400/40 bg-slate-900"
        headerActions={
          <button onClick={() => setProductDetail(null)} className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"><X size={18} /></button>
        }
      >
        {productDetail && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-4 grid grid-cols-1 sm:grid-cols-[120px_1fr] gap-4">
              <div className="h-[120px] rounded-xl border border-white/10 bg-black/30 grid place-items-center overflow-hidden">
                {productDetail.image_url ? (
                  <img src={productDetail.image_url} alt={productDetail.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex flex-col items-center text-slate-500">
                    <ImageOff size={26} />
                    <span className="text-[10px] mt-1">No Image</span>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-base font-bold text-white leading-tight">{productDetail.name || "Unnamed Product"}</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <MetaItem label="Category" value={productDetail.category || "-"} />
                  <MetaItem label="Supplier" value={getSupplierName(productDetail)} />
                  <MetaItem label="SKU" value={productDetail.sku || "-"} mono />
                  <MetaItem label="Barcode" value={productDetail.barcode || "-"} mono />
                  <MetaItem label="Stock" value={String(productDetail.quantity ?? 0)} />
                  <MetaItem label="Serial Tracking" value={productDetail.has_serials ? "Enabled" : "Disabled"} />
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">Cost Price</p>
                    <p className="text-sm font-bold text-slate-200">Rs. {Number(productDetail.cost_price || 0).toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-indigo-300/80">Selling Price</p>
                    <p className="text-sm font-black text-indigo-300">Rs. {Number(productDetail.sale_price || 0).toLocaleString()}</p>
                  </div>
                </div>
                <div className={`rounded-lg border px-3 py-2 ${(productDetail.sale_price - productDetail.cost_price) < 0 ? "border-rose-500/30 bg-rose-500/10" : "border-emerald-500/30 bg-emerald-500/10"}`}>
                  <p className="text-[10px] uppercase tracking-wider text-slate-300">Margin</p>
                  <p className={`text-base font-black ${(productDetail.sale_price - productDetail.cost_price) < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                    Rs. {(productDetail.sale_price - productDetail.cost_price).toLocaleString()} ({productDetail.cost_price > 0 ? (((productDetail.sale_price - productDetail.cost_price) / productDetail.cost_price) * 100).toFixed(1) : 0}%)
                  </p>
                </div>
              </div>
            </div>
            <div className="px-4 pb-1 text-[11px] text-slate-500">Tip: long-press card, right-click, or tap info icon to open this panel.</div>
            <div className="p-4 border-t border-white/10 bg-black/20 flex gap-2">
              <button
                onClick={() => {
                  addItem(productDetail);
                  setProductDetail(null);
                }}
                className="flex-1 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5"
              >
                Add To Cart
              </button>
              <button onClick={() => setProductDetail(null)} className="px-4 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 font-bold py-2.5">
                Close
              </button>
            </div>
          </>
        )}
      </AppModal>

      <AppModal
        open={showSuspendPicker}
        onClose={() => setShowSuspendPicker(false)}
        title="Suspended Carts"
        panelClassName="max-w-lg bg-slate-900"
        headerActions={
          <button onClick={() => setShowSuspendPicker(false)} className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"><X size={20}/></button>
        }
      >
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
              {!suspendedCarts.length && <p className="text-sm text-slate-500 text-center py-8">No suspended carts</p>}
              {suspendedCarts.map((s) => (
                <button key={s.token} onClick={() => resumeSuspendedCart(s.token)} className="w-full text-left rounded-xl border border-white/10 bg-white/[0.03] p-3 hover:bg-white/[0.06]">
                  <div className="flex justify-between text-sm font-bold text-slate-200">
                    <span>{s.token}</span>
                    <span>{s.cart.length} items</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{new Date(s.created_at).toLocaleString()}</div>
                </button>
              ))}
            </div>
      </AppModal>

      <AppModal
        open={showSaleCompleteModal}
        onClose={closeSaleCompleteModal}
        title="Sale Completed"
        panelClassName="max-w-md border-indigo-400/40 bg-slate-900"
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={closeSaleCompleteModal}
              className="w-full rounded-xl bg-white/5 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-white/10 transition-colors"
            >
              Done
            </button>
          </div>
        }
      >
        <div className="space-y-4 p-4">
          <div className="rounded-3xl border border-emerald-300 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 p-4 text-center">
            <div className="mx-auto mb-2 h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 grid place-items-center">
              <Check size={24} />
            </div>
            <p className="text-sm font-bold uppercase tracking-[0.24em] text-emerald-800 dark:text-emerald-300">Payment Confirmed</p>
            <p className="mt-2 text-lg font-black text-slate-900 dark:text-white">Sale completed successfully</p>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-950/80 p-4">
            <div className="grid gap-2 text-sm text-slate-700 dark:text-slate-300">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Invoice No</span>
                <span className="font-semibold text-slate-900 dark:text-white">{lastSale?.invoice_no || lastSale?.sale_id || lastSale?.id}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Customer</span>
                <span className="font-semibold text-slate-900 dark:text-white">{lastSale?.customer_name || lastSale?.customer?.name || "Walk-in Customer"}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Total</span>
                <span className="font-semibold text-slate-900 dark:text-white">LKR {Math.round(lastSale?.total || lastSale?.grand_total || 0).toLocaleString()}</span>
              </div>
            </div>
          </div>

          {lastSale?.customer?.phone || lastSale?.customer_phone ? (
            <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 p-3 text-sm text-slate-700 dark:text-slate-300">
              <p className="font-semibold text-slate-800 dark:text-slate-200">Send invoice to:</p>
              <p className="mt-1 text-sm font-medium text-slate-900 dark:text-white">{lastSale?.customer?.phone || lastSale?.customer_phone}</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20 p-3 text-sm text-slate-700 dark:text-slate-300">
              <p className="font-semibold text-slate-800 dark:text-slate-200">No customer contact available.</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">You can print the bill or add the customer for later digital delivery.</p>
            </div>
          )}

          <div className="grid gap-2">
            {(lastSale?.customer?.phone || lastSale?.customer_phone) ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={sendReceiptWhatsApp}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-3 py-3 text-xs font-black uppercase tracking-wider text-slate-900 shadow-lg shadow-emerald-500/10 transition hover:bg-emerald-400"
                >
                  <MessageCircle size={15} /> Auto Send
                </button>
                <button
                  type="button"
                  onClick={shareOnWhatsAppWeb}
                  className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 px-3 py-3 text-xs font-black uppercase tracking-wider text-emerald-300 transition hover:bg-emerald-500/30"
                >
                  <Share2 size={15} /> Share Web
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={shareOnWhatsAppWeb}
                className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 px-4 py-3 text-xs font-black uppercase tracking-wider text-emerald-300 transition hover:bg-emerald-500/30"
              >
                <Share2 size={15} /> Share on WhatsApp Web
              </button>
            )}
            <button
              type="button"
              onClick={printReceipt}
              disabled={!lastSale}
              className="flex items-center justify-center gap-2 rounded-2xl bg-white/5 px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Printer size={16} /> Print Invoice
            </button>
            <button
              type="button"
              onClick={sendReceiptEmail}
              disabled={!lastSale}
              className="flex items-center justify-center gap-2 rounded-2xl bg-sky-500/10 px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-sky-200 transition hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Mail size={16} /> Email Invoice
            </button>
            <button
              type="button"
              onClick={viewInvoice}
              className="flex items-center justify-center gap-2 rounded-2xl bg-white/5 px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-slate-100 transition hover:bg-white/10"
            >
              <Eye size={16} /> View Invoice
            </button>
            {!lastSale?.customer?.phone && (
              <button
                type="button"
                onClick={() => {
                  setShowNewCustomerModal(true);
                  closeSaleCompleteModal();
                }}
                className="flex items-center justify-center gap-2 rounded-2xl bg-amber-500/10 px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-amber-200 transition hover:bg-amber-500/20"
              >
                <Plus size={16} /> Add Customer
              </button>
            )}
          </div>
        </div>
      </AppModal>

      <AppModal
        open={showNewCustomerModal}
        onClose={() => setShowNewCustomerModal(false)}
        title="Quick Add Customer"
        panelClassName="max-w-md bg-slate-900"
        headerActions={
          <button onClick={() => setShowNewCustomerModal(false)} className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"><X size={20}/></button>
        }
      >
            <div className="p-4 space-y-3 flex-1 overflow-y-auto custom-scrollbar">
              <input className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-sm text-white" placeholder="Name" value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} />
              <input className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-sm text-white" placeholder="Phone" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} />
              <input className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-sm text-white" placeholder="Email (optional)" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} />
              <input className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-sm text-white" placeholder="Address (optional)" value={newCustomer.address} onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })} />
            </div>
            <div className="p-4 border-t border-white/10 bg-black/20">
              <button onClick={createCustomerQuick} className="w-full py-2.5 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-500 transition-all">Create & Attach</button>
            </div>
      </AppModal>

      {/* CASHIER SHIFT & DRAWER FLOAT RECONCILIATION MODAL */}
      <ShiftModal
        open={shiftModalOpen}
        onClose={() => setShiftModalOpen(false)}
        currentShift={currentShiftData}
        onShiftUpdated={fetchShiftStatus}
      />

      {/* FASHION SIZE x COLOR MATRIX VARIANT SELECTOR */}
      <VariantMatrixModal
        isOpen={isMatrixOpen}
        onClose={() => setIsMatrixOpen(false)}
        masterItem={matrixItem}
        onSelectVariant={(variantItem) => {
          addItem(variantItem);
          setIsMatrixOpen(false);
        }}
      />

    </div>
  );
}

function MetaItem({ label, value, mono = false }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-0.5 text-xs text-slate-200 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

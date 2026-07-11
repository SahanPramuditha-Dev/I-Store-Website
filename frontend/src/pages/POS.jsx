import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import api from "../lib/api";
import { runWithApproval } from "../lib/approvalFlow";
import { openPrintCenter } from "../lib/printCenter";
import { printHtmlDocument } from "../lib/printBridge";
import { useFetch } from "../hooks/useFetch";
import { Badge, Input, Select, SensitiveActionIndicators } from "../components/UI";
import { Barcode, ShoppingBasket, Search, Printer, Trash2, Plus, Minus, User, Wrench, Clock, CornerUpLeft, X, RefreshCw, Save, FolderOpen, Mail, MessageCircle, CreditCard, Banknote, Wallet, Info, ImageOff, AlertCircle, Check, Zap, ChevronDown, ChevronUp } from "lucide-react";
import { useFeedback } from "../components/FeedbackProvider";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import AppModal from "../components/layout/AppModal";

const CATEGORIES = ["All", "Smartphones", "Used Phones", "Chargers", "Earphones", "Power Banks", "Cases & Covers", "Tempered Glass", "Spare Parts", "Repair Services"];

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
  const inventoryFetch = useFetch('/inventory');
  const suppliersFetch = useFetch('/inventory/suppliers');
  const customersFetch = useFetch('/customers');
  const salesFetch = useFetch('/pos/sales');
  const repairsFetch = useFetch('/repairs'); // To link tickets
  const reservationsFetch = useFetch('/product-reservations');

  const [mode, setMode] = useState("sale"); // sale | repair | reservation
  const [activeCategory, setActiveCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [scanCode, setScanCode] = useState("");
  const [selectedCartIndex, setSelectedCartIndex] = useState(0);
  
  const [cart, setCart] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [customerId, setCustomerId] = useState("");
  
  const [discountMode, setDiscountMode] = useState("amount"); 
  const [discountValue, setDiscountValue] = useState(0);
  const [taxAmount, setTaxAmount] = useState(0);
  
  const [paid, setPaid] = useState(true);
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
  const [productDetail, setProductDetail] = useState(null);
  const [catalogRows, setCatalogRows] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [availableAdvances, setAvailableAdvances] = useState([]);
  const [selectedAdvanceMap, setSelectedAdvanceMap] = useState({});
  const [availableCredits, setAvailableCredits] = useState([]);
  const [selectedCreditMap, setSelectedCreditMap] = useState({});
  const [showRecentSales, setShowRecentSales] = useState(false);
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

  const [lastSale, setLastSale] = useState(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [showDraftSaveModal, setShowDraftSaveModal] = useState(false);
  const [pendingSync, setPendingSync] = useState(false);
  const autoSaveTimerRef = useRef(null);
  const searchDebounceRef = useRef(null);
  
  const netRemaining = useMemo(() => {
    if (paymentMethod !== "Mixed") return dueAfterCredits;
    return Math.max(0, dueAfterCredits - Number(cashReceived || 0) - Number(cardAmount || 0));
  }, [paymentMethod, dueAfterCredits, cashReceived, cardAmount]);

  // Validation helpers
  const maxDiscountAllowed = useMemo(() => subtotal * 0.35, [subtotal]); // Max 35% discount
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

  const cashierSummary = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todaysSales = (salesFetch.data || []).filter((s) => String(s.created_at).slice(0, 10) === today && !s.is_return && !s.is_voided);
    const total = todaysSales.reduce((sum, s) => sum + Number(s.total || 0), 0);
    return { count: todaysSales.length, total };
  }, [salesFetch.data]);

  const inventoryAlerts = useMemo(() => {
    const rows = inventoryFetch.data || [];
    const out = rows.filter((row) => Number(row.quantity || 0) <= 0).slice(0, 8);
    const low = rows.filter((row) => Number(row.quantity || 0) > 0 && Number(row.quantity || 0) <= 5).slice(0, 8);
    return { out, low };
  }, [inventoryFetch.data]);

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
      if (e.key === "/") { e.preventDefault(); productSearchRef.current?.focus(); }
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
      }
    } catch {
      toast("Item not found", "error");
      barcodeRef.current?.focus();
    }
  };

  const addItem = (i) => {
    if (i.quantity <= 0 && !i.is_labor) return toast("Item out of stock", "warning");
    const resolvedLineType = i.is_labor
      ? (i.line_type || "labor")
      : (String(i.product_type || "").toLowerCase().includes("spare") ? "spare_part" : "product");
    let added = false;
    setCart((prev) => {
      const existing = prev.find((p) => p.item_id === i.id && p.line_type === resolvedLineType);
      if (existing) {
        if (!i.is_labor && existing.quantity >= i.quantity) { toast("Cannot exceed stock", "warning"); return prev; }
        added = true;
        return prev.map((p) => p.item_id === i.id ? { ...p, quantity: p.quantity + 1 } : p);
      }
      added = true;
      return [
        ...prev,
        {
          item_id: i.id || Date.now(),
          name: i.name,
          quantity: 1,
          price: i.sale_price || 0,
          warranty_days: 0,
          is_labor: Boolean(i.is_labor),
          line_type: resolvedLineType,
          description: i.description || i.name,
        },
      ];
    });
    if (added) toast(`Added ${i.name}`, "success");
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
    if (discountMode === "percent" && numVal > 35) {
      toast("Max discount: 35%", "warning");
      setDiscountValue(35);
      return;
    }
    if (discountMode === "amount" && numVal > maxDiscountAllowed) {
      toast(`Max discount: LKR ${Math.round(maxDiscountAllowed)}`, "warning");
      setDiscountValue(maxDiscountAllowed);
      return;
    }
    setDiscountValue(numVal);
  };

  const stepQty = (itemId, delta) => {
    const item = cart.find(i => i.item_id === itemId);
    if (!item) return;
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

  const loadRepairTicketToCart = () => {
    const code = (repairTicketNo || "").trim().toLowerCase();
    if (!code) return toast("Enter repair ticket no", "warning");
    const hit = (repairsFetch.data || []).find((r) => String(r.ticket_no || "").toLowerCase() === code);
    if (!hit) return toast("Repair ticket not found", "error");
    const laborAmount = Number(hit.estimated_cost || 0) - Number(hit.advance_payment || 0);
    if (laborAmount > 0) {
      addItem({
        id: `labor-${hit.id}-${Date.now()}`,
        name: `Repair ${hit.ticket_no} - ${hit.device_model}`,
        sale_price: laborAmount,
        quantity: 999,
        is_labor: true,
        line_type: "service",
        description: `Repair service charge for ${hit.ticket_no}`,
      });
    }
    toast(`Loaded ${hit.ticket_no} to cart`, "success");
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
      toast("Sale completed successfully", "success");
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
    navigate(`/returns?invoice=${encodeURIComponent(invoiceRef)}`);
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
        template: "standard",
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

      // Open print dialog
      await printHtmlDocument(html);
      toast("Receipt sent to printer", "success");
    } catch (err) {
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

  const sendReceiptWhatsApp = () => {
    if (!lastSale) return toast("No recent sale", "warning");
    toast("WhatsApp send prepared (integrate customer phone mapping)", "info");
  };

  const sendReceiptEmail = () => {
    if (!lastSale) return toast("No recent sale", "warning");
    toast("Email send prepared (connect SMTP/mail API)", "info");
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
    <div className="h-full min-h-0 flex flex-col gap-3 text-slate-200 overflow-hidden">
      
      {/* TOP COMPACT STATUS BAR */}
      <div className="flex flex-wrap items-start justify-between gap-2 bg-slate-900/60 backdrop-blur-md border border-white/5 rounded-xl p-2 shrink-0 shadow-sm">
        <div className="flex bg-black/40 p-1 rounded-lg border border-white/5">
          <button 
            className={`px-3 2xl:px-5 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${mode === "sale" ? "bg-indigo-600 text-white shadow-md" : "text-slate-400 hover:text-white"}`}
            onClick={() => setMode("sale")}
          >
            Product Sale
          </button>
          <button 
            className={`px-3 2xl:px-5 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${mode === "repair" ? "bg-indigo-600 text-white shadow-md" : "text-slate-400 hover:text-white"}`}
            onClick={() => setMode("repair")}
          >
            Repair Billing
          </button>
          <button 
            className={`px-3 2xl:px-5 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${mode === "reservation" ? "bg-indigo-600 text-white shadow-md" : "text-slate-400 hover:text-white"}`}
            onClick={() => setMode("reservation")}
          >
            Reservation
          </button>
          <a
            href="/returns"
            className="px-3 2xl:px-5 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all text-rose-300 hover:text-white hover:bg-rose-500/20"
          >
            Return / Exchange
          </a>
          <Link
            to="/print-center?type=sales_receipt&paper=thermal_80"
            className="flex items-center gap-1.5 px-3 2xl:px-5 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all text-sky-300 hover:text-white hover:bg-sky-500/20"
            title="Open unified production printing"
          >
            <Printer size={13} /> Print Center
          </Link>
          <div className="hidden 2xl:flex items-center pl-2">
            <SensitiveActionIndicators items={["approval", "audit"]} />
          </div>
        </div>
        
        <div className="grid w-full grid-cols-3 gap-2 px-2 lg:w-auto 2xl:grid-cols-6 2xl:gap-4 2xl:px-4">
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Subtotal</span>
            <span className="text-sm font-black">LKR {Math.round(subtotal).toLocaleString()}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Discount</span>
            <span className="text-sm font-black text-rose-400">LKR {Math.round(discountAmount).toLocaleString()}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest">Grand Total</span>
            <span className="text-lg font-black text-indigo-400 leading-none mt-0.5">LKR {Math.round(grandTotal).toLocaleString()}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest">Advance</span>
            <span className="text-sm font-black text-emerald-300">LKR {Math.round(appliedAdvanceTotal).toLocaleString()}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest">Store Credit</span>
            <span className="text-sm font-black text-cyan-300">LKR {Math.round(appliedStoreCreditTotal).toLocaleString()}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-amber-400 font-bold uppercase tracking-widest">Due Now</span>
            <span className="text-lg font-black text-amber-300 leading-none mt-0.5">LKR {Math.round(dueAfterCredits).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* 3-PANEL WORKSPACE */}
      <div className="grid flex-1 min-h-0 gap-3 overflow-hidden grid-cols-1 xl:grid-cols-[minmax(250px,0.82fr)_minmax(420px,1.18fr)_minmax(300px,0.9fr)] 2xl:grid-cols-[minmax(300px,0.85fr)_minmax(560px,1.35fr)_minmax(320px,0.8fr)]">
        
        {/* LEFT PANEL: PRODUCT EXPLORER (30%) */}
        <div className="min-h-0 flex flex-col bg-slate-900/40 backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden shadow-lg">
          <div className="p-3 border-b border-white/5 bg-slate-900/50 space-y-2 shrink-0">
            <div className="relative">
              <Barcode size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input 
                ref={barcodeRef}
                autoFocus
                className="w-full bg-black/40 border border-white/10 rounded-xl py-2 pl-9 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                placeholder="Scan Barcode (Enter)"
                value={scanCode}
                onChange={e => setScanCode(e.target.value)}
                onKeyDown={tryAddByCode}
              />
            </div>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input 
                ref={productSearchRef}
                className="w-full bg-black/20 border border-white/5 rounded-xl py-2 pl-9 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                placeholder="Search products..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            
            {/* Category Pills */}
            <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1 pt-1">
              {CATEGORIES.map(cat => (
                <button 
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`shrink-0 px-3 py-1 rounded-full text-[11px] font-bold transition-colors border ${activeCategory === cat ? "bg-indigo-500 border-indigo-400 text-white" : "bg-black/20 border-white/5 text-slate-400 hover:text-white"}`}
                >
                  {cat}
                </button>
              ))}
            </div>
            
            <button 
              onClick={() => setQuickAddOpen((open) => !open)}
              className="w-full flex items-center justify-center gap-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-xl py-2 text-xs font-bold transition-all"
            >
              <Plus size={14} /> {quickAddOpen ? "Hide Quick Add" : "Quick Add / Manual Sale"}
            </button>
          </div>

          {quickAddOpen ? (
            <div className="border-b border-white/5 bg-slate-950/70 p-3 shrink-0 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-white">Quick Add Manual Item</div>
                  <div className="text-[11px] text-slate-400">Inline entry keeps focus stable and works for POS cashiers.</div>
                </div>
                <button type="button" onClick={() => { setQuickAddOpen(false); resetQuickAdd(); }} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-bold text-slate-300 hover:text-white">
                  Close
                </button>
              </div>

              <div className="grid gap-2 xl:grid-cols-[1.3fr,0.9fr]">
                <Input label="Product Name *" name="name" value={quickAddForm.name} onChange={handleQuickAddChange} placeholder="e.g. Generic Phone Case" />
                <Input label="Selling Price (LKR) *" type="text" inputMode="decimal" autoComplete="off" name="sale_price" value={quickAddForm.sale_price} onChange={handleQuickAddChange} placeholder="0.00" />
                <Input label="Quantity *" type="text" inputMode="numeric" autoComplete="off" name="quantity" value={quickAddForm.quantity} onChange={handleQuickAddChange} />
                <Select
                  label="Category"
                  name="category"
                  value={quickAddForm.category}
                  onChange={handleQuickAddChange}
                  options={[
                    { value: "Uncategorized", label: "Uncategorized" },
                    { value: "Smartphones", label: "Smartphones" },
                    { value: "Accessories", label: "Accessories" },
                    { value: "Services", label: "Services" },
                  ]}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1">Matches: {quickAddStats.matches}</span>
                <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1">Stock hint: {quickAddStats.stockHint ?? "-"}</span>
                <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1">Price hint: {quickAddStats.priceHint ? `LKR ${Math.round(quickAddStats.priceHint).toLocaleString()}` : "-"}</span>
              </div>

              <button type="button" onClick={() => setQuickAddOptional((v) => !v)} className="flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 font-bold transition-colors">
                <ChevronDown size={16} className={quickAddOptional ? "rotate-180 transition-transform" : "transition-transform"} />
                {quickAddOptional ? "Hide Optional Fields" : "Show Optional Fields"}
              </button>

              {quickAddOptional ? (
                <div className="grid gap-2 xl:grid-cols-2 animate-in fade-in slide-in-from-top-2 duration-200">
                  <Input label="SKU / Product Code" name="sku" value={quickAddForm.sku} onChange={handleQuickAddChange} placeholder="Leave blank to auto-generate" />
                  <Input label="Cost Price (LKR)" type="text" inputMode="decimal" autoComplete="off" name="cost_price" value={quickAddForm.cost_price} onChange={handleQuickAddChange} placeholder="0.00" />
                  <Input label="Tax Rate (%)" type="text" inputMode="decimal" autoComplete="off" name="tax_rate" value={quickAddForm.tax_rate} onChange={handleQuickAddChange} placeholder="0" />
                  <Input label="Discount (%)" type="text" inputMode="decimal" autoComplete="off" name="discount" value={quickAddForm.discount} onChange={handleQuickAddChange} placeholder="0" />
                  <textarea
                    name="description"
                    value={quickAddForm.description}
                    onChange={handleQuickAddChange}
                    placeholder="Brief details about the item..."
                    className="min-h-[88px] rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none xl:col-span-2"
                  />
                </div>
              ) : null}

              <div className="grid gap-2 sm:grid-cols-3">
                <button type="button" disabled={quickAddLoading} onClick={() => submitQuickAdd("temporary")} className="rounded-xl border border-slate-600/50 bg-slate-700/50 px-3 py-3 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-60">
                  Temporary Item
                  <span className="block text-[10px] font-normal text-slate-400">This transaction only</span>
                </button>
                <button type="button" disabled={quickAddLoading} onClick={() => submitQuickAdd("draft")} className="rounded-xl border border-amber-500/30 bg-amber-600/20 px-3 py-3 text-sm font-bold text-amber-400 hover:bg-amber-600/30 disabled:opacity-60">
                  Save as Draft
                  <span className="block text-[10px] font-normal text-amber-500/70">Finish details later</span>
                </button>
                <button type="button" disabled={quickAddLoading} onClick={() => submitQuickAdd("inventory")} className="rounded-xl border border-indigo-500/30 bg-indigo-600 px-3 py-3 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-60">
                  Save to Inventory
                  <span className="block text-[10px] font-normal text-indigo-200">Permanent product</span>
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
              const availableQty = Number(i.quantity || 0);
              const reservedQty = Number(i.reserved_stock || 0);
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
                className="cursor-pointer bg-black/20 border border-white/5 hover:border-indigo-500/50 hover:bg-indigo-500/10 transition-all p-3 rounded-xl flex flex-col text-left group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-sm text-slate-200 line-clamp-2 leading-tight group-hover:text-white">{i.name}</div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openProductDetail(i);
                    }}
                    className="shrink-0 p-1 rounded-md border border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
                    title="View details"
                  >
                    <Info size={12} />
                  </button>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">{i.sku || 'No SKU'}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${stockLabel === "Available" ? "bg-emerald-500/10 text-emerald-300" : stockLabel === "Low Stock" ? "bg-amber-500/10 text-amber-300" : "bg-rose-500/10 text-rose-300"}`}>
                    {stockLabel}
                  </span>
                  {Number(i.warranty_days || 0) > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-sky-500/10 text-sky-300">
                      {Number(i.warranty_days)}d Warranty
                    </span>
                  )}
                </div>
                <div className="mt-auto pt-3 flex flex-col gap-1.5 w-full">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-black text-indigo-400">Rs. {i.sale_price.toLocaleString()}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${availableQty > 5 ? "bg-emerald-500/10 text-emerald-400" : availableQty > 0 ? "bg-amber-500/10 text-amber-300" : "bg-rose-500/10 text-rose-400"}`}>
                      {availableQty} avail
                    </span>
                  </div>
                  {reservedQty > 0 && (
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-slate-500">Reserved:</span>
                      <span className="text-cyan-300 font-bold">{reservedQty}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center text-[10px]">
                    <span className="text-slate-500">Margin:</span>
                    <span className={margin < 0 ? "text-rose-400 font-bold" : "text-emerald-400 font-bold"}>
                      {marginPercent}% (Rs. {Math.round(margin).toLocaleString()})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      addItem(i);
                    }}
                    className="mt-1 rounded-md bg-indigo-600/20 border border-indigo-400/30 text-indigo-200 text-[10px] font-bold py-1 hover:bg-indigo-600/30"
                  >
                    Quick Add
                  </button>
                </div>
              </div>
            );
            })}
            {filteredInventory.length === 0 && <div className="col-span-2 text-center py-10 text-slate-500 text-sm">No products found</div>}
          </div>
        </div>

        {/* CENTER PANEL: BILLING WORKSPACE (50%) */}
        <div className="min-h-0 flex flex-col bg-slate-900/60 backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden shadow-lg relative">
          
          {mode === "repair" && (
            <div className="p-3 bg-indigo-900/20 border-b border-indigo-500/20 flex flex-wrap gap-2 items-center shrink-0">
               <Wrench size={16} className="text-indigo-400" />
               <input 
                 ref={repairTicketRef}
                 className="min-w-[220px] bg-black/40 border border-indigo-500/30 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 outline-none focus:border-indigo-400 flex-1"
                 placeholder="Link Repair Ticket No. (e.g. R-1001)"
                 value={repairTicketNo}
                 onChange={e => setRepairTicketNo(e.target.value)}
               />
               <button onClick={addLaborCharge} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors shadow-lg">
                 + Add Labor
               </button>
                <button onClick={loadRepairTicketToCart} className="bg-white/10 hover:bg-white/20 text-slate-200 text-xs font-bold px-3 py-2 rounded-lg transition-colors border border-white/10">
                  Pull Ticket
                </button>
             </div>
          )}
          {mode === "reservation" && (
            <div className="p-3 bg-cyan-900/20 border-b border-cyan-500/20 flex flex-wrap gap-2 items-center shrink-0">
               <Clock size={16} className="text-cyan-300" />
               <input
                 ref={reservationRef}
                 className="min-w-[240px] bg-black/40 border border-cyan-500/30 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-300 flex-1"
                 placeholder="Reservation No. (e.g. RSV-2026-000001)"
                 value={reservationNo}
                 onChange={e => setReservationNo(e.target.value)}
               />
               <button onClick={loadReservationToCart} className="bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors shadow-lg">
                 Load Reservation
               </button>
               <a href="/reservations" className="bg-white/10 hover:bg-white/20 text-slate-200 text-xs font-bold px-3 py-2 rounded-lg transition-colors border border-white/10">
                 Open Reservations
               </a>
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
                  <thead className="sticky top-0 bg-slate-950/80 backdrop-blur z-10 text-[10px] uppercase tracking-widest text-slate-500 border-b border-white/5">
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
                 <tbody className="divide-y divide-white/5">
                   {cart.map((c, idx) => {
                   const inv = (inventoryFetch.data || []).find(x => x.id === c.item_id);
                   const margin = inv ? (c.price - inv.cost_price) : 0;
                   const isNegativeMargin = !c.is_labor && margin < 0;
                   return (
                   <tr key={`${c.item_id}-${idx}`} onClick={() => setSelectedCartIndex(idx)} className={`hover:bg-white/5 transition-colors group ${selectedCartIndex === idx ? "bg-indigo-500/10 border-l-2 border-indigo-500" : ""} ${isNegativeMargin ? "bg-rose-500/5" : ""}`}>
                      <td className="p-3">
                        <div className="font-semibold text-sm text-slate-200 flex items-center gap-2">
                          {c.name}
                          {isNegativeMargin && <AlertCircle size={14} className="text-rose-400" />}
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <span className={`inline-flex px-2 py-1 rounded text-[10px] font-bold uppercase ${c.line_type === "manual_product" ? "bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30" : c.line_type === "product" || c.line_type === "spare_part" ? "bg-indigo-500/15 text-indigo-300" : "bg-amber-500/15 text-amber-300"}`}>
                          {c.line_type === "manual_product" ? "Quick Sale" : String(c.line_type || "product").replace("_", " ")}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-center bg-black/40 border border-white/10 rounded-lg overflow-hidden">
                          <button onClick={() => stepQty(c.item_id, -1)} className="px-2 py-1.5 text-slate-400 hover:text-white hover:bg-white/10"><Minus size={12}/></button>
                         <input 
                           type="number" 
                           className="w-8 bg-transparent text-center text-sm font-bold outline-none no-spinners" 
                           value={c.quantity}
                           onChange={(e) => updateItem(c.item_id, 'quantity', Math.max(1, Number(e.target.value)))}
                         />
                         <button onClick={() => stepQty(c.item_id, 1)} className="px-2 py-1.5 text-slate-400 hover:text-white hover:bg-white/10"><Plus size={12}/></button>
                       </div>
                     </td>
                     <td className="p-3">
                       <input 
                         type="number" 
                         className={`w-full bg-transparent text-right text-sm font-semibold outline-none focus:bg-white/5 border border-transparent focus:border-white/10 rounded px-1 ${isNegativeMargin ? "text-rose-400" : ""}`}
                         value={c.price}
                          onChange={(e) => updateItem(c.item_id, 'price', Math.max(0, Number(e.target.value)))}
                        />
                      </td>
                      <td className="p-3 text-center">
                        {c.is_labor ? (
                          <span className="text-xs text-slate-500">-</span>
                        ) : (
                          <div className="inline-flex items-center gap-1 bg-black/30 border border-white/10 rounded px-1.5 py-0.5">
                            <input
                              type="number"
                              className="bg-transparent text-[10px] w-10 text-center outline-none"
                              value={c.warranty_days}
                              onChange={(e) => updateItem(c.item_id, 'warranty_days', Number(e.target.value))}
                              title="Warranty in days"
                            />
                            <span className="text-[10px] text-slate-500">d</span>
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-right font-black text-indigo-300">
                        {(c.price * c.quantity).toLocaleString()}
                      </td>
                     <td className="p-3 text-right">
                       <button onClick={() => removeItem(c.item_id)} className="text-rose-500/50 hover:text-rose-400 transition-colors p-1 rounded hover:bg-rose-500/10">
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
               <div className="h-full flex flex-col items-center justify-center text-slate-500 opacity-50 pb-10">
                 <ShoppingBasket size={48} className="mb-4" />
                 <p className="text-sm font-medium">Cart is empty</p>
                 <p className="text-xs">Scan or click products to add</p>
               </div>
             )}
          </div>

          {false && (
          <div className="shrink-0 bg-slate-950 border-t border-white/10 p-4 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
            <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3 mb-4">
              
              <div className="space-y-3 min-w-0">
                <div className="flex items-center gap-2">
                  <User size={16} className="text-slate-500 shrink-0" />
                  <select
                    ref={customerSelectRef}
                    className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                    value={customerId} 
                    onChange={(e) => setCustomerId(e.target.value)}
                  >
                    <option value="">Walk-in Customer</option>
                    {(customersFetch.data || []).map(c => <option key={c.id} value={c.id}>{c.name} - {c.phone}</option>)}
                  </select>
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
                    {[dueAfterCredits, dueAfterCredits + 500, dueAfterCredits + 1000].map((amt, i) => (
                      <button key={i} onClick={() => setCashReceived(Math.round(amt))} className="flex-1 rounded-md border border-white/10 bg-white/5 py-1 text-[10px] font-bold text-slate-300 hover:bg-white/10">
                        {i === 0 ? "Exact" : `+${i * 500}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2 min-w-0">
                <div className="flex items-center justify-between bg-black/20 border border-white/5 rounded-lg px-3 py-1.5">
                   <div className="text-xs text-slate-400 font-medium flex items-center gap-2">
                      Discount 
                      <button onClick={() => setDiscountMode(m => m === "amount" ? "percent" : "amount")} className="text-indigo-400 bg-indigo-400/10 px-1 rounded text-[10px] font-bold">{discountMode === "amount" ? "LKR" : "%"}</button>
                   </div>
                   <input type="number" className="w-24 bg-transparent text-right text-sm font-bold outline-none" placeholder="0" value={discountValue} onChange={e => updateDiscountValue(e.target.value)} />
                </div>
                {paymentMethod === "Cash" && (
                  <div className="flex items-center justify-between bg-black/20 border border-white/5 rounded-lg px-3 py-1.5 focus-within:border-emerald-500/50">
                     <span className="text-xs text-slate-400 font-medium">Cash Given</span>
                     <input ref={cashInputRef} type="number" className="w-28 bg-transparent text-right text-sm font-bold text-emerald-400 outline-none" placeholder="0" value={cashReceived} onChange={e => setCashReceived(e.target.value)} />
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
            {paymentMethod === "Cash" && cashReceived && change >= 0 && (
              <div className="text-center mt-3 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <div className="text-xs text-emerald-300/70 font-medium mb-1">CHANGE TO RETURN</div>
                <div className="text-lg font-black text-emerald-400">LKR {change.toLocaleString()}</div>
              </div>
            )}
            <div className="text-center mt-2 text-[9px] text-slate-500/70 space-y-1">
              <div>F2: Product Search | F3: Customer | F4: Payment | Ctrl+R: Repair | Ctrl+I: Invoice | Ctrl+P: Print</div>
              <div>Enter: Add first result | Ctrl+Enter: Checkout | Ctrl+Backspace/Delete: Remove line | Esc: Close modal</div>
            </div>
          </div>
          )}
        </div>

        {/* RIGHT PANEL: CHECKOUT RAIL + QUICK ACTIONS */}
        <div className="min-h-0 flex flex-col gap-3 overflow-y-auto custom-scrollbar">
          <div className="sticky top-0 z-20 shrink-0 rounded-2xl border border-indigo-400/25 bg-slate-950/95 p-3 shadow-2xl backdrop-blur-md">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h3 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-indigo-200">
                  <Wallet size={13} /> Payment / Checkout
                </h3>
                <p className="mt-1 text-[10px] text-slate-500">Always visible on desktop workstations</p>
              </div>
              <SensitiveActionIndicators items={["approval", "audit"]} />
            </div>

            <div className="mb-3 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-200/70">Due now</p>
                  <p className="mt-1 text-2xl font-black leading-none text-amber-200">
                    LKR {Math.round(dueAfterCredits).toLocaleString()}
                  </p>
                </div>
                <div className="text-right text-[10px] text-slate-400">
                  <div>Items: <span className="font-bold text-slate-200">{cart.length}</span></div>
                  <div>Total: <span className="font-bold text-indigo-200">LKR {Math.round(grandTotal).toLocaleString()}</span></div>
                </div>
              </div>
              {(appliedAdvanceTotal > 0 || appliedStoreCreditTotal > 0) && (
                <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                  <div className="rounded-lg bg-black/20 px-2 py-1 text-emerald-200">Advance: LKR {Math.round(appliedAdvanceTotal).toLocaleString()}</div>
                  <div className="rounded-lg bg-black/20 px-2 py-1 text-cyan-200">Credit: LKR {Math.round(appliedStoreCreditTotal).toLocaleString()}</div>
                </div>
              )}
            </div>

            <div className="mb-3 space-y-2 rounded-xl border border-white/10 bg-black/20 p-2.5">
              <div className="flex items-center gap-2">
                <User size={14} className="shrink-0 text-slate-500" />
                <select
                  ref={customerSelectRef}
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-xs text-white outline-none focus:border-indigo-400"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                >
                  <option value="">Walk-in Customer</option>
                  {(customersFetch.data || []).map(c => <option key={c.id} value={c.id}>{c.name} - {c.phone}</option>)}
                </select>
                <button onClick={() => setShowNewCustomerModal(true)} className="shrink-0 rounded-lg border border-white/10 bg-white/10 px-2.5 py-2 text-[10px] font-black text-slate-200 hover:bg-white/20">+New</button>
              </div>

              <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                  Discount
                  <button
                    onClick={() => setDiscountMode(m => m === "amount" ? "percent" : "amount")}
                    className="rounded bg-indigo-400/10 px-1.5 py-0.5 text-[10px] font-black text-indigo-300"
                  >
                    {discountMode === "amount" ? "LKR" : "%"}
                  </button>
                </div>
                <input
                  type="number"
                  className="w-24 bg-transparent text-right text-sm font-bold text-slate-100 outline-none"
                  placeholder="0"
                  value={discountValue}
                  onChange={e => updateDiscountValue(e.target.value)}
                />
              </div>

              {customerId && (
                <div className="grid grid-cols-1 gap-2">
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-emerald-200/80">Advances</p>
                      <span className="text-[10px] font-bold text-emerald-300">LKR {Math.round(appliedAdvanceTotal).toLocaleString()}</span>
                    </div>
                    {availableAdvances.length === 0 && (
                      <p className="mt-1 text-[10px] text-slate-500">No available advances.</p>
                    )}
                    {availableAdvances.length > 0 && (
                      <div className="mt-2 max-h-24 space-y-1.5 overflow-y-auto pr-1 custom-scrollbar">
                        {availableAdvances.map((row) => (
                          <div key={row.id} className="grid grid-cols-[1fr,64px,52px] items-center gap-1">
                            <div className="min-w-0">
                              <div className="truncate text-[10px] font-bold text-emerald-200">{row.advance_number}</div>
                              <div className="truncate text-[10px] text-slate-500">Rem: LKR {Math.round(Number(row.remaining_amount || 0)).toLocaleString()}</div>
                            </div>
                            <input
                              type="number"
                              className="rounded border border-white/10 bg-black/40 px-2 py-1 text-right text-[11px]"
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

                  <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-cyan-200/80">Store Credits</p>
                      <span className="text-[10px] font-bold text-cyan-300">LKR {Math.round(appliedStoreCreditTotal).toLocaleString()}</span>
                    </div>
                    {availableCredits.length === 0 && (
                      <p className="mt-1 text-[10px] text-slate-500">No available store credits.</p>
                    )}
                    {availableCredits.length > 0 && (
                      <div className="mt-2 max-h-24 space-y-1.5 overflow-y-auto pr-1 custom-scrollbar">
                        {availableCredits.map((row) => (
                          <div key={row.id} className="grid grid-cols-[1fr,64px,52px] items-center gap-1">
                            <div className="min-w-0">
                              <div className="truncate text-[10px] font-bold text-cyan-200">{row.credit_number}</div>
                              <div className="truncate text-[10px] text-slate-500">Rem: LKR {Math.round(Number(row.remaining_amount || 0)).toLocaleString()}</div>
                            </div>
                            <input
                              type="number"
                              className="rounded border border-cyan-500/20 bg-black/40 px-2 py-1 text-right text-[11px]"
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
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-1.5">
                {["Cash", "Card", "Bank Transfer", "Store Credit", "Mixed"].map(m => (
                  <button
                    key={`rail-${m}`}
                    onClick={() => setPaymentMethod(m)}
                    className={`rounded-lg border px-2 py-1.5 text-[10px] font-black uppercase tracking-wider transition ${
                      paymentMethod === m
                        ? "border-indigo-400/60 bg-indigo-500/20 text-indigo-100"
                        : "border-white/10 bg-black/20 text-slate-400 hover:border-white/20 hover:text-slate-200"
                    }`}
                  >
                    {m === "Bank Transfer" ? "Bank" : m === "Store Credit" ? "Credit" : m}
                  </button>
                ))}
              </div>
              {paymentMethod === "Cash" && (
                <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-400">Cash Given</span>
                    <input
                      ref={cashInputRef}
                      type="number"
                      className="w-28 bg-transparent text-right text-sm font-black text-emerald-300 outline-none"
                      placeholder="0"
                      value={cashReceived}
                      onChange={e => setCashReceived(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {[dueAfterCredits, dueAfterCredits + 500, dueAfterCredits + 1000].map((amt, i) => (
                      <button key={`rail-cash-${i}`} onClick={() => setCashReceived(Math.round(amt))} className="rounded-md border border-white/10 bg-white/5 py-1 text-[10px] font-bold text-slate-300 hover:bg-white/10">
                        {i === 0 ? "Exact" : `+${i * 500}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {paymentMethod === "Mixed" && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5">
                    <span className="block text-[10px] text-slate-500">Cash</span>
                    <input ref={cashInputRef} type="number" className="w-full bg-transparent text-sm font-bold text-emerald-300 outline-none" value={cashReceived} onChange={e => setCashReceived(e.target.value)} />
                  </label>
                  <label className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5">
                    <span className="block text-[10px] text-slate-500">Card</span>
                    <input type="number" className="w-full bg-transparent text-sm font-bold text-sky-300 outline-none" value={cardAmount} onChange={e => setCardAmount(e.target.value)} />
                  </label>
                  <div className={`col-span-2 text-right text-xs font-bold ${netRemaining <= 0 ? "text-emerald-300" : "text-amber-300"}`}>
                    Remaining: LKR {Math.round(Math.max(0, netRemaining)).toLocaleString()}
                  </div>
                </div>
              )}
              {(paymentMethod === "Card" || paymentMethod === "Bank Transfer" || paymentMethod === "Mixed") && (
                <label className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2">
                  <span className="text-xs font-semibold text-slate-400">Ref No.</span>
                  <input
                    ref={paymentRefInputRef}
                    type="text"
                    className="min-w-0 flex-1 bg-transparent text-right text-sm font-semibold text-sky-300 outline-none"
                    placeholder="Card / Bank ref"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                  />
                </label>
              )}
              {paymentMethod === "Store Credit" && (
                <div className="text-right text-xs font-bold text-cyan-300">
                  Credit Applied: LKR {Math.round(appliedStoreCreditTotal).toLocaleString()} | Remaining Due: LKR {Math.round(dueAfterCredits).toLocaleString()}
                </div>
              )}
              <div className="flex gap-1.5">
                <button onClick={clearCart} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-rose-500/10 text-rose-300 hover:bg-rose-500/20" title="Clear Cart">
                  <Trash2 size={16} />
                </button>
                <button onClick={printReceipt} disabled={!lastSale} className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${lastSale ? "bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20" : "bg-white/5 text-slate-600 cursor-not-allowed"}`} title="Print last receipt">
                  <Printer size={16} />
                </button>
                <button onClick={suspendCurrentCart} className="relative grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/5 text-slate-300 hover:bg-white/10" title="Suspend cart">
                  <Save size={16} />
                  {pendingSync && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-400" title="Auto-saving..." />}
                </button>
                <button onClick={() => setShowSuspendPicker(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/5 text-slate-300 hover:bg-white/10" title="Resume cart">
                  <FolderOpen size={16} />
                </button>
                <button
                  onClick={checkout}
                  disabled={hasNegativeMargin}
                  className={`min-h-10 flex-1 rounded-lg text-sm font-black uppercase tracking-wider shadow-lg transition active:scale-[0.98] ${
                    hasNegativeMargin
                      ? "bg-slate-600/50 text-slate-400 cursor-not-allowed opacity-50"
                      : "bg-indigo-600 text-white hover:bg-indigo-500 shadow-indigo-950/40"
                  }`}
                  title={hasNegativeMargin ? "Fix negative margins before checkout" : "Complete Sale"}
                >
                  Complete Sale
                </button>
              </div>
              {paymentMethod === "Cash" && cashReceived && change >= 0 && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-center">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/70">Change</div>
                  <div className="text-base font-black text-emerald-300">LKR {change.toLocaleString()}</div>
                </div>
              )}
            </div>
          </div>
          
          <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 rounded-2xl p-4 shadow-lg shrink-0">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2"><Wrench size={12}/> Repair Actions</h3>
            <div className="grid grid-cols-1 gap-2">
              <a href="/repairs" className="bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg p-2.5 text-xs font-semibold text-center transition-colors">New Repair Ticket</a>
              <button onClick={() => setMode("repair")} className="bg-white/5 hover:bg-indigo-500/20 border border-white/5 hover:border-indigo-500/30 text-indigo-300 rounded-lg p-2.5 text-xs font-semibold text-center transition-colors">Process Repair Payment</button>
            </div>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 rounded-2xl p-4 shadow-lg shrink-0">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2"><Clock size={12}/> Reservation Tools</h3>
            <div className="grid grid-cols-1 gap-2">
              <button onClick={() => setMode("reservation")} className="bg-white/5 hover:bg-cyan-500/20 border border-white/5 hover:border-cyan-500/30 text-cyan-200 rounded-lg p-2.5 text-xs font-semibold text-center transition-colors">Reservation Settlement</button>
              <a href="/reservations" className="bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg p-2.5 text-xs font-semibold text-center transition-colors">Open Reservations Module</a>
              <a href="/returns" className="bg-white/5 hover:bg-rose-500/20 border border-white/5 hover:border-rose-500/30 text-rose-200 rounded-lg p-2.5 text-xs font-semibold text-center transition-colors">Returns / Exchanges</a>
            </div>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 rounded-2xl p-4 shadow-lg shrink-0">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2"><User size={12}/> Customer Actions</h3>
            <div className="grid grid-cols-1 gap-2">
              <a href="/customers" className="bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg p-2.5 text-xs font-semibold text-center transition-colors">Add New Customer</a>
              <button onClick={() => setShowNewCustomerModal(true)} className="bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg p-2.5 text-xs font-semibold text-center transition-colors">Quick Create Customer</button>
            </div>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 rounded-2xl p-4 shadow-lg shrink-0">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2"><Printer size={12}/> Receipt Actions</h3>
            <div className="grid grid-cols-1 gap-2">
              <button onClick={printReceipt} className="bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg p-2.5 text-xs font-semibold text-center transition-colors">Print Receipt</button>
              <button onClick={sendReceiptWhatsApp} className="bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg p-2.5 text-xs font-semibold text-center transition-colors flex items-center justify-center gap-1"><MessageCircle size={12}/> WhatsApp</button>
              <button onClick={sendReceiptEmail} className="bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg p-2.5 text-xs font-semibold text-center transition-colors flex items-center justify-center gap-1"><Mail size={12}/> Email</button>
            </div>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 rounded-2xl p-4 shadow-lg shrink-0">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2"><Wallet size={12}/> Shift Snapshot</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-xs"><span className="text-slate-500">Today's Sales</span><span className="font-bold text-slate-200">{cashierSummary.count}</span></div>
              <div className="flex justify-between text-xs"><span className="text-slate-500">Today's Revenue</span><span className="font-bold text-emerald-300">LKR {Math.round(cashierSummary.total).toLocaleString()}</span></div>
            </div>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 rounded-2xl p-4 shadow-lg shrink-0">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2"><AlertCircle size={12}/> Inventory Alerts</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Low Stock</span>
                <span className="font-bold text-amber-300">{inventoryAlerts.low.length}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Out of Stock</span>
                <span className="font-bold text-rose-300">{inventoryAlerts.out.length}</span>
              </div>
              <div className="max-h-20 overflow-y-auto custom-scrollbar space-y-1 pr-1">
                {inventoryAlerts.low.slice(0, 3).map((row) => (
                  <div key={`low-${row.id}`} className="text-[10px] text-amber-200 truncate">{row.name} ({row.quantity})</div>
                ))}
                {inventoryAlerts.out.slice(0, 2).map((row) => (
                  <div key={`out-${row.id}`} className="text-[10px] text-rose-200 truncate">{row.name} (0)</div>
                ))}
                {inventoryAlerts.low.length === 0 && inventoryAlerts.out.length === 0 && (
                  <div className="text-[10px] text-slate-500">No critical alerts</div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 rounded-2xl p-3 shadow-lg shrink-0">
            <button
              type="button"
              onClick={() => setShowRecentSales((value) => !value)}
              className="flex w-full items-center justify-between gap-2 text-left"
            >
              <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2"><Clock size={12}/> Recent Sales</h3>
              <span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold text-slate-300">
                {showRecentSales ? "Hide" : "Show"}
              </span>
            </button>
            {showRecentSales && (
            <div className="mt-3 max-h-[280px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
              {(salesFetch.data || []).slice(0,10).map((s) => (
                <div key={s.id} className="bg-black/20 border border-white/5 rounded-lg p-2.5 hover:bg-white/5 transition-colors cursor-default">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold text-slate-300">{s.invoice_no}</span>
                    <span className="text-xs font-black text-emerald-400">{s.total.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-slate-500">{new Date(s.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${s.payment_method === 'Cash' ? 'bg-green-500/10 text-green-400' : 'bg-sky-500/10 text-sky-400'}`}>
                      {s.payment_method}
                    </span>
                  </div>
                  {!s.is_voided && !s.is_return && (
                    <div className="mt-2 grid grid-cols-3 gap-1">
                      <button onClick={(e) => { e.stopPropagation(); openReturnModal(s.id); }} className="w-full flex items-center justify-center gap-1 py-1 rounded bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 text-[10px] font-bold transition-colors">
                        <CornerUpLeft size={10} /> Return
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); quickReprint(s.id); }} className="w-full flex items-center justify-center gap-1 py-1 rounded bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 text-[10px] font-bold transition-colors">
                        <Printer size={10} /> Print
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); voidSale(s); }} className="w-full flex items-center justify-center gap-1 py-1 rounded bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 text-[10px] font-bold transition-colors">
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
          <button onClick={() => setProductDetail(null)} className="text-slate-400 hover:text-white"><X size={18} /></button>
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
          <button onClick={() => setShowSuspendPicker(false)} className="text-slate-400 hover:text-white transition-colors"><X size={20}/></button>
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
        open={showNewCustomerModal}
        onClose={() => setShowNewCustomerModal(false)}
        title="Quick Add Customer"
        panelClassName="max-w-md bg-slate-900"
        headerActions={
          <button onClick={() => setShowNewCustomerModal(false)} className="text-slate-400 hover:text-white transition-colors"><X size={20}/></button>
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

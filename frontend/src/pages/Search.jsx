import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import api from "../lib/api";
import { isRepairDelivered, repairStatusLabel } from "../lib/repairStatus";
import { AppTableEmptyRow, AppTableHead, AppTableShell, SectionCard, Badge, Button } from "../components/UI";
import {
  Search as SearchIcon,
  User,
  Wrench,
  ShoppingBag,
  Box,
  ArrowRight,
  Trash2,
  Filter,
  Pin,
  PinOff,
  X,
  Phone,
  Pencil,
  Plus,
  Keyboard,
  Sparkles,
  FileText,
  ShieldCheck,
  Wallet,
  Boxes,
  ClipboardList,
  PackageSearch,
  CircleGauge,
  Rows3,
  PanelsTopLeft,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

const RECENT_KEY = "recent_searches";
const PINNED_KEY = "pinned_searches";

const filters = [
  { id: "all", label: "All", icon: null },
  { id: "customers", label: "Customers", icon: <User size={13} /> },
  { id: "repairs", label: "Repairs", icon: <Wrench size={13} /> },
  { id: "inventory", label: "Inventory", icon: <Box size={13} /> },
  { id: "sales", label: "Sales", icon: <ShoppingBag size={13} /> },
  { id: "payments", label: "Payments", icon: <Wallet size={13} /> },
  { id: "purchase_orders", label: "Purchase", icon: <ClipboardList size={13} /> },
  { id: "warranty", label: "Warranty", icon: <ShieldCheck size={13} /> },
  { id: "suppliers", label: "Suppliers", icon: <Boxes size={13} /> },
  { id: "expenses", label: "Expenses", icon: <CircleGauge size={13} /> },
];

const quickSearchCategories = [
  { id: "customers", title: "Customers", subtitle: "Search customer profiles", icon: User, tone: "sky", filter: "customers", route: "/customers" },
  { id: "sales", title: "Invoices", subtitle: "Find invoices & payments", icon: FileText, tone: "green", filter: "sales", route: "/pos" },
  { id: "repairs", title: "Repairs", subtitle: "Search repair tickets", icon: Wrench, tone: "amber", filter: "repairs", route: "/repairs" },
  { id: "products", title: "Products", subtitle: "Search inventory items", icon: Box, tone: "violet", filter: "inventory", route: "/inventory/products" },
  { id: "serials", title: "IMEI / Serial", subtitle: "Find by IMEI or serial", icon: PackageSearch, tone: "cyan", filter: "inventory", route: "/inventory/serials" },
  { id: "payments", title: "Payments", subtitle: "Search transactions", icon: Wallet, tone: "mint", filter: "payments", route: "/pos" },
  { id: "purchase", title: "Purchase Orders", subtitle: "Search POs and GRNs", icon: ClipboardList, tone: "blue", filter: "purchase_orders", route: "/purchase" },
  { id: "warranty", title: "Warranty", subtitle: "Search warranty claims", icon: ShieldCheck, tone: "gold", filter: "warranty", route: "/warranty" },
  { id: "suppliers", title: "Suppliers", subtitle: "Search supplier data", icon: Boxes, tone: "rose", filter: "suppliers", route: "/inventory/suppliers" },
  { id: "expenses", title: "Expenses", subtitle: "Search expense records", icon: CircleGauge, tone: "indigo", filter: "expenses", route: "/expenses" },
];

const RESULT_ORDER = [
  "customers",
  "repairs",
  "inventory",
  "sales",
  "payments",
  "purchase_orders",
  "warranty",
  "suppliers",
  "expenses",
];

function normalize(v) {
  return String(v || "").toLowerCase().trim();
}

function scoreText(target, query) {
  const t = normalize(target);
  const q = normalize(query);
  if (!q || !t) return 0;
  if (t === q) return 120;
  if (t.startsWith(q)) return 90;
  if (t.includes(q)) return 60;
  return 0;
}

function scoreItem(type, item, query) {
  if (!query) return 0;
  if (type === "customers") {
    return Math.max(scoreText(item.name, query), scoreText(item.phone, query), scoreText(item.email, query));
  }
  if (type === "repairs") {
    let s = Math.max(scoreText(item.ticket_no, query), scoreText(item.device_model, query));
    if (item.status === "Pending" || item.status === "Diagnosing") s += 8;
    return s;
  }
  if (type === "inventory") {
    let s = Math.max(scoreText(item.name, query), scoreText(item.sku, query));
    if ((item.quantity || 0) <= 3) s += 6;
    return s;
  }
  if (type === "sales") {
    return Math.max(scoreText(item.invoice_no, query), scoreText(item.id, query));
  }
  if (type === "payments") {
    return Math.max(scoreText(item.payment_ref, query), scoreText(item.counterparty, query), scoreText(item.method, query), scoreText(item.status, query));
  }
  if (type === "purchase_orders") {
    return Math.max(scoreText(item.po_number, query), scoreText(item.supplier_name, query), scoreText(item.status, query));
  }
  if (type === "warranty") {
    return Math.max(scoreText(item.warranty_code, query), scoreText(item.customer_name, query), scoreText(item.imei_or_serial, query), scoreText(item.serial_number, query));
  }
  if (type === "suppliers") {
    return Math.max(scoreText(item.name, query), scoreText(item.contact, query), scoreText(item.email, query));
  }
  if (type === "expenses") {
    return Math.max(scoreText(item.expense_code, query), scoreText(item.vendor_name, query), scoreText(item.reference_no, query), scoreText(item.description, query));
  }
  return 0;
}

function Highlight({ text, query }) {
  const raw = String(text || "");
  const q = normalize(query);
  if (!q) return raw;
  const lower = raw.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) return raw;
  const before = raw.slice(0, idx);
  const match = raw.slice(idx, idx + q.length);
  const after = raw.slice(idx + q.length);
  return (
    <>
      {before}
      <mark className="rounded bg-indigo-500/25 px-0.5 text-inherit">{match}</mark>
      {after}
    </>
  );
}

function getResultLabel(type, item) {
  if (type === "customers") return item.name || "Customer";
  if (type === "repairs") return item.ticket_no || item.device_model || "Repair";
  if (type === "inventory") return item.name || item.sku || "Inventory item";
  if (type === "sales") return item.invoice_no || `Sale ${item.id || ""}`;
  if (type === "payments") return item.payment_ref || "Payment";
  if (type === "purchase_orders") return item.po_number || "Purchase order";
  if (type === "warranty") return item.warranty_code || "Warranty";
  if (type === "suppliers") return item.name || "Supplier";
  if (type === "expenses") return item.expense_code || "Expense";
  return "Result";
}

function getResultMeta(type, item) {
  if (type === "customers") return [item.phone, item.email].filter(Boolean).join(" | ") || "Customer profile";
  if (type === "repairs") return item.device_model || "Repair ticket";
  if (type === "inventory") return [item.sku, item.barcode].filter(Boolean).join(" | ") || "Product record";
  if (type === "sales") return item.created_at ? new Date(item.created_at).toLocaleString() : "Sales invoice";
  if (type === "payments") return [item.counterparty, item.method].filter(Boolean).join(" | ") || "Payment record";
  if (type === "purchase_orders") return item.supplier_name || "Supplier order";
  if (type === "warranty") return [item.customer_name, item.imei_or_serial || item.serial_number].filter(Boolean).join(" | ") || "Warranty record";
  if (type === "suppliers") return [item.contact, item.email].filter(Boolean).join(" | ") || "Supplier profile";
  if (type === "expenses") return [item.vendor_name, item.category].filter(Boolean).join(" | ") || "Expense record";
  return "";
}

function getResultStatus(type, item) {
  if (type === "repairs") return { label: repairStatusLabel(item.status), tone: isRepairDelivered(item.status) || String(item.status || "").toLowerCase() === "completed" ? "green" : "amber" };
  if (type === "inventory") return { label: `Qty ${item.quantity ?? 0}`, tone: (item.quantity || 0) <= 3 ? "red" : "green" };
  if (type === "payments") return { label: item.direction === "out" ? "Outgoing" : "Incoming", tone: item.direction === "out" ? "amber" : "green" };
  if (type === "purchase_orders") return { label: item.status || "Open", tone: item.status === "Received" ? "green" : "amber" };
  if (type === "warranty") return { label: item.status || "Warranty", tone: item.status === "Active" ? "green" : item.status === "Expired" ? "red" : "amber" };
  if (type === "expenses") return { label: item.status || "Expense", tone: item.status === "Paid" ? "green" : item.status === "Rejected" ? "red" : "amber" };
  if (type === "sales") return { label: `LKR ${Number(item.total || 0).toLocaleString()}`, tone: "indigo" };
  return { label: "Open", tone: "sky" };
}

function getSecurityBadge(type, item) {
  if (["sales", "payments", "purchase_orders", "expenses"].includes(type)) return { label: "Permission", tone: "amber" };
  if (type === "warranty") return { label: "Serial/IMEI", tone: "violet" };
  if (type === "repairs" && !isRepairDelivered(item.status)) return { label: "Active Job", tone: "sky" };
  if (type === "inventory" && (item.quantity || 0) <= 3) return { label: "Low Stock", tone: "red" };
  return { label: "Standard", tone: "green" };
}

export default function Search() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [activeFilter, setActiveFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [recent, setRecent] = useState(() => JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"));
  const [pinned, setPinned] = useState(() => JSON.parse(localStorage.getItem(PINNED_KEY) || "[]"));
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewMode, setViewMode] = useState("list");

  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get("/search/suggestions")
      .then((res) => setSuggestions(res.data || []))
      .catch(() => setSuggestions([]));
  }, []);

  const rememberQuery = useCallback((val) => {
    if (val.length <= 2) return;
    setRecent((prev) => {
      const updated = [val, ...prev.filter((i) => i !== val)].slice(0, 8);
      localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const handleSearch = useCallback(
    async (val) => {
      if (val.length < 2) {
        setResults(null);
        return;
      }
      setLoading(true);
      try {
        const { data } = await api.get(`/search/global?q=${encodeURIComponent(val)}`);
        setResults(data);
        rememberQuery(val);
      } catch {
        setResults({
          customers: [],
          repairs: [],
          inventory: [],
          sales: [],
          payments: [],
          purchase_orders: [],
          warranty: [],
          suppliers: [],
          expenses: [],
        });
      } finally {
        setLoading(false);
      }
    },
    [rememberQuery]
  );

  const onInputChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    if (val.length >= 2) handleSearch(val);
    else setResults(null);
  };

  const clearRecent = () => {
    setRecent([]);
    localStorage.removeItem(RECENT_KEY);
  };

  const togglePin = (val) => {
    setPinned((prev) => {
      const exists = prev.includes(val);
      const updated = exists ? prev.filter((x) => x !== val) : [val, ...prev].slice(0, 8);
      localStorage.setItem(PINNED_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const filteredRepairs = useMemo(() => {
    const rows = results?.repairs || [];
    return rows.filter((r) => {
      if (statusFilter === "all") return true;
      const status = String(r.status || "").trim().toLowerCase();
      if (statusFilter === "pending") return status === "pending" || status === "diagnosing";
      if (statusFilter === "completed") return status === "completed" || isRepairDelivered(r.status);
      return true;
    });
  }, [results, statusFilter]);

  const filteredInventory = useMemo(() => {
    const rows = results?.inventory || [];
    return rows.filter((i) => {
      if (stockFilter === "all") return true;
      if (stockFilter === "low") return (i.quantity || 0) <= 3;
      return true;
    });
  }, [results, stockFilter]);

  const groupedResults = useMemo(() => {
    const base = {
      customers: results?.customers || [],
      repairs: filteredRepairs,
      inventory: filteredInventory,
      sales: results?.sales || [],
      payments: results?.payments || [],
      purchase_orders: results?.purchase_orders || [],
      warranty: results?.warranty || [],
      suppliers: results?.suppliers || [],
      expenses: results?.expenses || [],
    };

    const sorted = {};
    Object.entries(base).forEach(([type, rows]) => {
      sorted[type] = [...rows].sort((a, b) => scoreItem(type, b, query) - scoreItem(type, a, query));
    });
    return sorted;
  }, [results, filteredRepairs, filteredInventory, query]);

  const counts = useMemo(() => {
    const next = {};
    RESULT_ORDER.forEach((type) => {
      next[type] = (groupedResults[type] || []).length;
    });
    return next;
  }, [groupedResults]);

  const totalCount = useMemo(() => RESULT_ORDER.reduce((sum, type) => sum + (counts[type] || 0), 0), [counts]);

  const flatResults = useMemo(() => {
    const out = [];
    const pushType = (type, rows) => rows.forEach((item) => out.push({ type, item }));
    if (activeFilter === "all") {
      RESULT_ORDER.forEach((type) => pushType(type, groupedResults[type] || []));
    } else {
      pushType(activeFilter, groupedResults[activeFilter] || []);
    }
    return out;
  }, [activeFilter, groupedResults]);

  const openResult = useCallback(
    (sel) => {
      if (!sel) return;
      if (sel.type === "customers") navigate(`/customers/${sel.item.id}`);
      if (sel.type === "repairs") navigate(`/repairs?id=${sel.item.id}`);
      if (sel.type === "inventory") navigate("/inventory/products", { state: { search: sel.item.sku || sel.item.barcode || sel.item.name || "" } });
      if (sel.type === "sales") navigate(`/pos?sale_id=${sel.item.id}`);
      if (sel.type === "payments") navigate("/pos");
      if (sel.type === "purchase_orders") navigate("/purchase");
      if (sel.type === "warranty") navigate("/warranty");
      if (sel.type === "suppliers") navigate("/inventory/suppliers");
      if (sel.type === "expenses") navigate("/expenses");
    },
    [navigate]
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [flatResults.length, activeFilter, query]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      const isShortcutContext =
        !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName || "") &&
        !window.getSelection()?.toString();
      if ((e.ctrlKey || e.metaKey) && isShortcutContext) {
        const k = e.key.toLowerCase();
        if (k === "i") {
          e.preventDefault();
          setActiveFilter("sales");
          inputRef.current?.focus();
        }
        if (k === "r") {
          e.preventDefault();
          setActiveFilter("repairs");
          inputRef.current?.focus();
        }
        if (k === "p") {
          e.preventDefault();
          setActiveFilter("inventory");
          inputRef.current?.focus();
        }
        if (k === "c") {
          e.preventDefault();
          setActiveFilter("customers");
          inputRef.current?.focus();
        }
      }
      if (e.key === "Escape") {
        if (query) {
          setQuery("");
          setResults(null);
          inputRef.current?.focus();
        }
      }
      if (!flatResults.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((v) => (v + 1) % flatResults.length);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((v) => (v - 1 + flatResults.length) % flatResults.length);
      }
      if (e.key === "Enter") {
        const sel = flatResults[activeIndex];
        openResult(sel);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, flatResults, openResult, query]);

  const selected = flatResults[activeIndex] || null;

  const showResults = query.length >= 2;

  const launchSearch = useCallback(
    (value) => {
      setQuery(value);
      handleSearch(value);
      inputRef.current?.focus();
    },
    [handleSearch]
  );

  const popularSearches = useMemo(() => {
    return [...new Set([...(suggestions || []), ...pinned, ...recent])].filter(Boolean).slice(0, 8);
  }, [suggestions, pinned, recent]);

  const smartSuggestions = useMemo(() => {
    const base = suggestions.length
      ? suggestions.map((item, index) => ({ label: item, count: Math.max(3, 18 - index * 2) }))
      : [
          { label: "Pending repairs older than 3 days", count: 7 },
          { label: "Low stock items", count: 14 },
          { label: "Unpaid invoices", count: 5 },
          { label: "Customers with outstanding balance", count: 12 },
          { label: "Devices ready for pickup", count: 9 },
        ];
    return base.slice(0, 5);
  }, [suggestions]);

  return (
    <div className="min-h-0 pb-4">
      <div className="search-hub-shell mx-auto max-w-full space-y-4 px-2 pb-6 pt-2 animate-in fade-in sm:px-4">
      <div className="search-hub-header space-y-4">
        <div className="search-hub-status-strip flex flex-wrap items-center gap-2">
          <span className="search-hub-status-pill tone-green">SQLite: Connected</span>
          <span className="search-hub-status-pill tone-blue">Offline Ready</span>
          <span className="search-hub-status-pill tone-violet">Backup: Synced</span>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-100">
              Search <span className="text-indigo-300">Hub</span>
            </h1>
            <p className="mt-1 text-xs text-slate-400">Fast operational lookup across customers, repairs, stock, sales, and finance records.</p>
          </div>
          <Badge tone="indigo" className="px-3 py-1 text-[10px] font-black uppercase tracking-widest shadow-md shadow-indigo-500/20">
            <Keyboard size={11} /> Ctrl/Cmd + K
          </Badge>
        </div>

        <div className="search-hub-query-row flex gap-3">
          <div className="search-hub-query-wrap relative flex-1">
            <SearchIcon className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input
              ref={inputRef}
              autoFocus
              type="text"
              placeholder="Search customers, invoices, repairs, products, IMEI, serial no, or anything..."
              className="search-hub-query-input h-12 w-full rounded-xl border pl-12 pr-44 text-sm font-semibold outline-none transition"
              value={query}
              onChange={onInputChange}
            />
            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-2">
              <span className="search-hub-keycap hidden rounded-lg px-2 py-1 text-[10px] font-bold md:inline-flex">Ctrl + K</span>
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setResults(null);
                    inputRef.current?.focus();
                  }}
                  className="rounded-lg p-2 text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
                  title="Clear"
                >
                  <X size={16} />
                </button>
              )}
              {loading && <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />}
            </div>
          </div>

          <button
            type="button"
            className="search-hub-ai-btn h-12 shrink-0 rounded-xl px-5 text-sm font-black tracking-wide"
            onClick={() => {
              if (query.length >= 2) handleSearch(query);
              else inputRef.current?.focus();
            }}
          >
            <Sparkles size={14} />
            Search Hub
          </button>
        </div>

        <div className="search-hub-popular flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-400">Popular searches:</span>
          {popularSearches.map((term) => (
            <button key={term} onClick={() => launchSearch(term)} className="search-hub-chip rounded-xl px-3 py-1.5 text-xs font-semibold">
              {term}
            </button>
          ))}
          {!popularSearches.length && (
            <span className="text-xs text-slate-500">Type at least 2 letters to start searching.</span>
          )}
        </div>
      </div>

      {!showResults && (
        <div className="space-y-5">
          <section>
            <h3 className="search-hub-section-title mb-3 text-lg font-black tracking-tight text-slate-100">Quick Search Categories</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {quickSearchCategories.map((cat) => {
                const Icon = cat.icon;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      setActiveFilter(cat.filter);
                      inputRef.current?.focus();
                    }}
                    className="search-hub-category-card group rounded-xl border p-3 text-left"
                  >
                    <div className={`search-hub-category-icon tone-${cat.tone}`}>
                      <Icon size={18} />
                    </div>
                    <p className="mt-2 text-sm font-extrabold text-slate-100">{cat.title}</p>
                    <p className="mt-1 text-xs text-slate-400">{cat.subtitle}</p>
                    <div className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-indigo-300 transition group-hover:translate-x-1">
                      Start Search <ArrowRight size={12} />
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <SectionCard
              title="Recent Searches"
              className="search-hub-info-card"
              right={<button onClick={clearRecent} className="rounded-lg p-1 text-slate-500 transition hover:text-rose-400" title="Clear recent"><Trash2 size={14} /></button>}
            >
              <div className="space-y-2">
                {!recent.length && <p className="text-sm text-slate-500">No recent searches yet.</p>}
                {recent.map((term, idx) => (
                  <div key={term} className="search-hub-list-row flex items-center justify-between rounded-xl border px-3 py-2">
                    <button onClick={() => launchSearch(term)} className="truncate text-left text-sm font-semibold text-slate-200">
                      {term}
                    </button>
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-slate-500">{`${10 - Math.floor(idx / 2)}:${idx % 2 ? "45" : "15"} AM`}</span>
                      <button onClick={() => togglePin(term)} className="p-1 text-slate-500 transition hover:text-indigo-300" title="Pin query">
                        <Pin size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title="Smart Suggestions" className="search-hub-info-card">
              <div className="space-y-2">
                {smartSuggestions.map((item) => (
                  <button key={item.label} onClick={() => launchSearch(item.label)} className="search-hub-list-row flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left">
                    <span className="truncate text-sm font-semibold text-slate-200">{item.label}</span>
                    <span className="search-hub-pill-count rounded-lg px-2 py-0.5 text-[11px] font-black">{item.count}</span>
                  </button>
                ))}
              </div>
            </SectionCard>

            <SectionCard
              title="Saved Searches"
              className="search-hub-info-card"
              right={
                <button
                  type="button"
                  onClick={() => {
                    setPinned([]);
                    localStorage.removeItem(PINNED_KEY);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-indigo-300"
                >
                  <PinOff size={12} />
                  Manage
                </button>
              }
            >
              <div className="space-y-2">
                {!pinned.length && <p className="text-sm text-slate-500">Pin searches to keep them here.</p>}
                {pinned.map((term) => (
                  <div key={term} className="search-hub-list-row flex items-center justify-between rounded-xl border px-3 py-2">
                    <button onClick={() => launchSearch(term)} className="truncate text-left text-sm font-semibold text-slate-200">
                      {term}
                    </button>
                    <button onClick={() => togglePin(term)} className="p-1 text-slate-500 transition hover:text-rose-400" title="Unpin">
                      <PinOff size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>

          <SectionCard title="Search Shortcuts" subtitle="Keyboard-friendly navigation" className="search-hub-shortcuts-card">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {[
                { key: "Ctrl + K", label: "Global Search" },
                { key: "Ctrl + I", label: "Search Invoices" },
                { key: "Ctrl + R", label: "Search Repairs" },
                { key: "Ctrl + P", label: "Search Products" },
                { key: "Ctrl + C", label: "Search Customers" },
              ].map((shortcut) => (
                <div key={shortcut.key} className="search-hub-shortcut-item rounded-xl border p-3">
                  <span className="search-hub-keycap mb-2 inline-flex rounded-lg px-2 py-1 text-[10px] font-black">{shortcut.key}</span>
                  <p className="text-sm font-semibold text-slate-200">{shortcut.label}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}

      {showResults && (
        <>
          <div className="search-hub-filter-block space-y-3 rounded-2xl border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-400"><Filter size={13} className="text-indigo-300" />Filters</span>
              {filters.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setActiveFilter(f.id)}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                    activeFilter === f.id
                      ? "bg-indigo-500 text-white shadow-lg shadow-indigo-500/30"
                      : "border border-white/10 bg-white/5 text-slate-300 hover:border-indigo-300/60"
                  }`}
                >
                  {f.icon}
                  {f.label}
                  <span className="rounded-full bg-black/10 px-1.5 text-[10px] dark:bg-white/10">
                    {f.id === "all" ? totalCount : counts[f.id] || 0}
                  </span>
                </button>
              ))}
              <button
                onClick={() => {
                  setStatusFilter("all");
                  setStockFilter("all");
                }}
                className="rounded-xl border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-400 transition hover:text-slate-200"
              >
                Clear filters
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {(activeFilter === "all" || activeFilter === "repairs") && (
                <div className="inline-flex items-center gap-1 rounded-xl border border-white/15 bg-white/5 p-1">
                  {[
                    { id: "all", label: "Repairs: All" },
                    { id: "pending", label: "Pending" },
                    { id: "completed", label: "Completed" },
                  ].map((s) => (
                    <button key={s.id} onClick={() => setStatusFilter(s.id)} className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${statusFilter === s.id ? "bg-sky-500 text-white" : "text-slate-400"}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              )}

              {(activeFilter === "all" || activeFilter === "inventory") && (
                <div className="inline-flex items-center gap-1 rounded-xl border border-white/15 bg-white/5 p-1">
                  {[
                    { id: "all", label: "Stock: All" },
                    { id: "low", label: "Low (<=3)" },
                  ].map((s) => (
                    <button key={s.id} onClick={() => setStockFilter(s.id)} className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${stockFilter === s.id ? "bg-emerald-500 text-white" : "text-slate-400"}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="ml-auto inline-flex items-center gap-1 rounded-xl border border-white/15 bg-white/5 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold ${viewMode === "list" ? "bg-indigo-500 text-white" : "text-slate-400"}`}
                >
                  <Rows3 size={12} /> Dense List
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("sections")}
                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold ${viewMode === "sections" ? "bg-indigo-500 text-white" : "text-slate-400"}`}
                >
                  <PanelsTopLeft size={12} /> Sections
                </button>
              </div>
            </div>
          </div>

          {loading && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
              ))}
            </div>
          )}

          {!loading && (
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 xl:col-span-9 space-y-4">
                {viewMode === "list" && (
                  <SectionCard
                    title={`Dense Results (${flatResults.length})`}
                    subtitle="Compact result list with status and security indicators"
                    className="search-hub-result-card"
                  >
                    <AppTableShell minWidth={760}>
                      <AppTableHead>
                        <tr>
                          <th className="px-4 py-3">Type</th>
                          <th className="px-4 py-3">Match</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Security</th>
                          <th className="px-4 py-3 text-right">Action</th>
                        </tr>
                      </AppTableHead>
                      <tbody className="divide-y divide-white/5">
                        {flatResults.map((row, idx) => {
                          const status = getResultStatus(row.type, row.item);
                          const security = getSecurityBadge(row.type, row.item);
                          return (
                            <tr
                              key={`${row.type}-${row.item.id || row.item.request_id || idx}`}
                              className={`transition ${idx === activeIndex ? "bg-indigo-500/10" : "hover:bg-white/[0.03]"}`}
                              onMouseEnter={() => setActiveIndex(idx)}
                            >
                              <td className="px-4 py-3">
                                <Badge tone="indigo" className="text-[10px] uppercase tracking-wider">{row.type.replace("_", " ")}</Badge>
                              </td>
                              <td className="min-w-0 px-4 py-3">
                                <button type="button" onClick={() => openResult(row)} className="block max-w-[420px] text-left">
                                  <p className="truncate text-sm font-bold text-slate-100"><Highlight text={getResultLabel(row.type, row.item)} query={query} /></p>
                                  <p className="truncate text-[11px] text-slate-400"><Highlight text={getResultMeta(row.type, row.item)} query={query} /></p>
                                </button>
                              </td>
                              <td className="px-4 py-3"><Badge tone={status.tone}>{status.label}</Badge></td>
                              <td className="px-4 py-3"><Badge tone={security.tone}>{security.label}</Badge></td>
                              <td className="px-4 py-3 text-right">
                                <Button size="sm" variant="ghost" onClick={() => openResult(row)}>Open</Button>
                              </td>
                            </tr>
                          );
                        })}
                        {flatResults.length === 0 && (
                          <AppTableEmptyRow colSpan={5} title="No matches found" text="Try a shorter term, clear filters, or search by phone, invoice number, ticket number, SKU, IMEI, or serial." />
                        )}
                      </tbody>
                    </AppTableShell>
                  </SectionCard>
                )}

                {viewMode === "sections" && (
                  <>
                {(activeFilter === "all" || activeFilter === "customers") && counts.customers > 0 && (
                  <SectionCard title={`Customers (${counts.customers})`} className="search-hub-result-card">
                    <div className="space-y-2">
                      {groupedResults.customers.map((c) => {
                        const idx = flatResults.findIndex((f) => f.type === "customers" && f.item.id === c.id);
                        return (
                          <div key={c.id} className={`search-hub-result-row flex items-center justify-between rounded-xl border px-3 py-2 ${idx === activeIndex ? "border-indigo-400 bg-indigo-500/10" : "border-white/10 bg-white/[0.02]"}`}>
                            <button onClick={() => navigate(`/customers/${c.id}`)} className="text-left">
                              <p className="text-sm font-bold text-slate-100"><Highlight text={c.name} query={query} /></p>
                              <p className="text-xs text-slate-400"><Highlight text={c.phone} query={query} /></p>
                              {c.email && <p className="text-xs text-slate-400"><Highlight text={c.email} query={query} /></p>}
                            </button>
                            <div className="flex items-center gap-1">
                              <Button size="sm" variant="ghost" onClick={() => navigate(`/customers/${c.id}`)}>Open</Button>
                              <Button size="sm" variant="ghost"><Phone size={13} /></Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </SectionCard>
                )}

                {(activeFilter === "all" || activeFilter === "repairs") && counts.repairs > 0 && (
                  <SectionCard title={`Repairs (${counts.repairs})`} className="search-hub-result-card">
                    <div className="space-y-2">
                      {groupedResults.repairs.map((r) => {
                        const idx = flatResults.findIndex((f) => f.type === "repairs" && f.item.id === r.id);
                        return (
                          <div key={r.id} className={`search-hub-result-row flex items-center justify-between rounded-xl border px-3 py-2 ${idx === activeIndex ? "border-sky-400 bg-sky-500/10" : "border-white/10 bg-white/[0.02]"}`}>
                            <button onClick={() => navigate(`/repairs?id=${r.id}`)} className="text-left">
                              <p className="text-xs font-black text-sky-500"><Highlight text={r.ticket_no} query={query} /></p>
                              <p className="text-sm font-bold text-slate-100"><Highlight text={r.device_model} query={query} /></p>
                            </button>
                            <div className="flex items-center gap-2">
                              <Badge tone={isRepairDelivered(r.status) || String(r.status || "").toLowerCase() === "completed" ? "green" : "amber"}>
                                {repairStatusLabel(r.status)}
                              </Badge>
                              <Button size="sm" variant="ghost" onClick={() => navigate(`/repairs?id=${r.id}`)}>Open</Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </SectionCard>
                )}

                {(activeFilter === "all" || activeFilter === "inventory") && counts.inventory > 0 && (
                  <SectionCard title={`Inventory (${counts.inventory})`} className="search-hub-result-card">
                    <div className="space-y-2">
                      {groupedResults.inventory.map((i) => {
                        const idx = flatResults.findIndex((f) => f.type === "inventory" && f.item.id === i.id);
                        return (
                          <div key={i.id} className={`search-hub-result-row flex items-center justify-between rounded-xl border px-3 py-2 ${idx === activeIndex ? "border-emerald-400 bg-emerald-500/10" : "border-white/10 bg-white/[0.02]"}`}>
                            <button onClick={() => navigate("/inventory/products", { state: { search: i.sku || i.barcode || i.name } })} className="text-left">
                              <p className="text-sm font-bold text-slate-100"><Highlight text={i.name} query={query} /></p>
                              <p className="text-[11px] font-mono text-slate-400"><Highlight text={i.sku} query={query} /></p>
                            </button>
                            <div className="flex items-center gap-2">
                              <Badge tone={(i.quantity || 0) <= 3 ? "red" : "green"}>Qty {i.quantity}</Badge>
                              <Button size="sm" variant="ghost" onClick={() => navigate("/inventory/products", { state: { search: i.sku || i.barcode || i.name } })}>Open</Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </SectionCard>
                )}

                {(activeFilter === "all" || activeFilter === "sales") && counts.sales > 0 && (
                  <SectionCard title={`Sales (${counts.sales})`} className="search-hub-result-card">
                    <div className="space-y-2">
                      {groupedResults.sales.map((s) => {
                        const idx = flatResults.findIndex((f) => f.type === "sales" && f.item.id === s.id);
                        return (
                          <div key={s.id} className={`search-hub-result-row flex items-center justify-between rounded-xl border px-3 py-2 ${idx === activeIndex ? "border-indigo-400 bg-indigo-500/10" : "border-white/10 bg-white/[0.02]"}`}>
                            <button onClick={() => navigate(`/pos?sale_id=${s.id}`)} className="text-left">
                              <p className="text-sm font-black text-indigo-500"><Highlight text={s.invoice_no} query={query} /></p>
                              <p className="text-xs text-slate-400">{new Date(s.created_at).toLocaleDateString()}</p>
                            </button>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-black text-slate-100">LKR {Number(s.total || 0).toLocaleString()}</p>
                              <Button size="sm" variant="ghost" onClick={() => navigate(`/pos?sale_id=${s.id}`)}>Open</Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </SectionCard>
                )}

                {(activeFilter === "all" || activeFilter === "payments") && counts.payments > 0 && (
                  <SectionCard title={`Payments (${counts.payments})`} className="search-hub-result-card">
                    <div className="space-y-2">
                      {groupedResults.payments.map((payment) => {
                        const idx = flatResults.findIndex((f) => f.type === "payments" && f.item.id === payment.id);
                        return (
                          <div key={payment.id} className={`search-hub-result-row flex items-center justify-between rounded-xl border px-3 py-2 ${idx === activeIndex ? "border-emerald-400 bg-emerald-500/10" : "border-white/10 bg-white/[0.02]"}`}>
                            <button onClick={() => navigate("/pos")} className="text-left">
                              <p className="text-sm font-black text-emerald-300"><Highlight text={payment.payment_ref} query={query} /></p>
                              <p className="text-xs text-slate-400"><Highlight text={`${payment.counterparty || "-"} | ${payment.method || "-"}`} query={query} /></p>
                            </button>
                            <div className="flex items-center gap-2">
                              <Badge tone={payment.direction === "out" ? "amber" : "green"}>{payment.direction === "out" ? "Outgoing" : "Incoming"}</Badge>
                              <p className="text-sm font-black text-slate-100">LKR {Number(payment.amount || 0).toLocaleString()}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </SectionCard>
                )}

                {(activeFilter === "all" || activeFilter === "purchase_orders") && counts.purchase_orders > 0 && (
                  <SectionCard title={`Purchase Orders (${counts.purchase_orders})`} className="search-hub-result-card">
                    <div className="space-y-2">
                      {groupedResults.purchase_orders.map((po) => {
                        const idx = flatResults.findIndex((f) => f.type === "purchase_orders" && f.item.id === po.id);
                        return (
                          <div key={po.id} className={`search-hub-result-row flex items-center justify-between rounded-xl border px-3 py-2 ${idx === activeIndex ? "border-blue-400 bg-blue-500/10" : "border-white/10 bg-white/[0.02]"}`}>
                            <button onClick={() => navigate("/purchase")} className="text-left">
                              <p className="text-sm font-black text-blue-300"><Highlight text={po.po_number} query={query} /></p>
                              <p className="text-xs text-slate-400"><Highlight text={po.supplier_name || "Unknown supplier"} query={query} /></p>
                            </button>
                            <div className="flex items-center gap-2">
                              <Badge tone={po.status === "Received" ? "green" : "amber"}>{po.status}</Badge>
                              <p className="text-sm font-black text-slate-100">LKR {Number(po.total_cost || 0).toLocaleString()}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </SectionCard>
                )}

                {(activeFilter === "all" || activeFilter === "warranty") && counts.warranty > 0 && (
                  <SectionCard title={`Warranty (${counts.warranty})`} className="search-hub-result-card">
                    <div className="space-y-2">
                      {groupedResults.warranty.map((w) => {
                        const idx = flatResults.findIndex((f) => f.type === "warranty" && f.item.id === w.id);
                        return (
                          <div key={w.id} className={`search-hub-result-row flex items-center justify-between rounded-xl border px-3 py-2 ${idx === activeIndex ? "border-violet-400 bg-violet-500/10" : "border-white/10 bg-white/[0.02]"}`}>
                            <button onClick={() => navigate("/warranty")} className="text-left">
                              <p className="text-sm font-black text-violet-300"><Highlight text={w.warranty_code} query={query} /></p>
                              <p className="text-xs text-slate-400"><Highlight text={`${w.customer_name || "-"} | ${w.product_or_service_name || "-"}`} query={query} /></p>
                            </button>
                            <Badge tone={w.status === "Active" ? "green" : w.status === "Expired" ? "red" : "amber"}>{w.status}</Badge>
                          </div>
                        );
                      })}
                    </div>
                  </SectionCard>
                )}

                {(activeFilter === "all" || activeFilter === "suppliers") && counts.suppliers > 0 && (
                  <SectionCard title={`Suppliers (${counts.suppliers})`} className="search-hub-result-card">
                    <div className="space-y-2">
                      {groupedResults.suppliers.map((s) => {
                        const idx = flatResults.findIndex((f) => f.type === "suppliers" && f.item.id === s.id);
                        return (
                          <div key={s.id} className={`search-hub-result-row flex items-center justify-between rounded-xl border px-3 py-2 ${idx === activeIndex ? "border-rose-400 bg-rose-500/10" : "border-white/10 bg-white/[0.02]"}`}>
                            <button onClick={() => navigate("/inventory/suppliers")} className="text-left">
                              <p className="text-sm font-bold text-slate-100"><Highlight text={s.name} query={query} /></p>
                              <p className="text-xs text-slate-400"><Highlight text={s.contact} query={query} /></p>
                              {s.email && <p className="text-xs text-slate-500"><Highlight text={s.email} query={query} /></p>}
                            </button>
                            <Button size="sm" variant="ghost" onClick={() => navigate("/inventory/suppliers")}>Open</Button>
                          </div>
                        );
                      })}
                    </div>
                  </SectionCard>
                )}

                {(activeFilter === "all" || activeFilter === "expenses") && counts.expenses > 0 && (
                  <SectionCard title={`Expenses (${counts.expenses})`} className="search-hub-result-card">
                    <div className="space-y-2">
                      {groupedResults.expenses.map((expense) => {
                        const idx = flatResults.findIndex((f) => f.type === "expenses" && f.item.id === expense.id);
                        return (
                          <div key={expense.id} className={`search-hub-result-row flex items-center justify-between rounded-xl border px-3 py-2 ${idx === activeIndex ? "border-amber-400 bg-amber-500/10" : "border-white/10 bg-white/[0.02]"}`}>
                            <button onClick={() => navigate("/expenses")} className="text-left">
                              <p className="text-sm font-black text-amber-300"><Highlight text={expense.expense_code} query={query} /></p>
                              <p className="text-xs text-slate-400"><Highlight text={`${expense.vendor_name || "-"} | ${expense.category || "-"}`} query={query} /></p>
                            </button>
                            <div className="flex items-center gap-2">
                              <Badge tone={expense.status === "Paid" ? "green" : expense.status === "Rejected" ? "red" : "amber"}>{expense.status}</Badge>
                              <p className="text-sm font-black text-slate-100">LKR {Number(expense.amount || 0).toLocaleString()}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </SectionCard>
                )}
                  </>
                )}

                {viewMode === "sections" && !loading && results && flatResults.length === 0 && (
                  <SectionCard title="No matches found" subtitle={`No results for "${query}"`} className="search-hub-result-card">
                    <p className="mb-3 text-xs text-slate-400">Try clearing filters, shortening the term, or searching by phone, invoice number, repair ticket, SKU, IMEI, or serial.</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => navigate("/customers")}> <Plus size={13} /> Create Customer</Button>
                      <Button size="sm" variant="secondary" onClick={() => navigate("/repairs")}> <Plus size={13} /> Create Repair</Button>
                      <Button size="sm" variant="ghost" onClick={() => setQuery(query.slice(0, -1))}>Try shorter term</Button>
                    </div>
                  </SectionCard>
                )}
              </div>

              <div className="col-span-12 xl:col-span-3">
                <SectionCard title="Preview" subtitle="Selected result" className="search-hub-preview-card xl:sticky xl:top-4">
                  {!selected && <p className="text-sm text-slate-500">Use arrow keys to navigate results.</p>}
                  {selected && (
                    <div className="space-y-2 text-sm">
                      <Badge tone="indigo" className="text-[10px] uppercase">{selected.type}</Badge>
                      {selected.type === "customers" && (
                        <>
                          <p className="font-bold text-slate-100">{selected.item.name}</p>
                          <p className="text-slate-500">Phone: {selected.item.phone}</p>
                          {selected.item.email && <p className="text-slate-500">Email: {selected.item.email}</p>}
                          <div className="flex gap-2 pt-2">
                            <Button size="sm" onClick={() => navigate(`/customers/${selected.item.id}`)}>Open</Button>
                            <Button size="sm" variant="ghost"><Pencil size={13} /> Edit</Button>
                          </div>
                        </>
                      )}
                      {selected.type === "repairs" && (
                        <>
                          <p className="font-bold text-slate-100">{selected.item.ticket_no}</p>
                          <p className="text-slate-500">Device: {selected.item.device_model}</p>
                          <Badge tone={selected.item.status === "Completed" ? "green" : "amber"}>{selected.item.status}</Badge>
                          <div className="pt-2">
                            <Button size="sm" onClick={() => navigate(`/repairs?id=${selected.item.id}`)}>Open Ticket</Button>
                          </div>
                        </>
                      )}
                      {selected.type === "inventory" && (
                        <>
                          <p className="font-bold text-slate-100">{selected.item.name}</p>
                          <p className="text-slate-500">SKU: {selected.item.sku}</p>
                          <Badge tone={(selected.item.quantity || 0) <= 3 ? "red" : "green"}>Qty {selected.item.quantity}</Badge>
                          <div className="pt-2">
                            <Button size="sm" onClick={() => navigate("/inventory/products", { state: { search: selected.item.sku || selected.item.barcode || selected.item.name } })}>Open Item</Button>
                          </div>
                        </>
                      )}
                      {selected.type === "sales" && (
                        <>
                          <p className="font-bold text-slate-100">{selected.item.invoice_no}</p>
                          <p className="text-slate-500">Date: {new Date(selected.item.created_at).toLocaleString()}</p>
                          <p className="font-black text-emerald-300">LKR {Number(selected.item.total || 0).toLocaleString()}</p>
                          <div className="pt-2">
                            <Button size="sm" onClick={() => navigate(`/pos?sale_id=${selected.item.id}`)}>Open Invoice</Button>
                          </div>
                        </>
                      )}
                      {selected.type === "payments" && (
                        <>
                          <p className="font-bold text-slate-100">{selected.item.payment_ref}</p>
                          <p className="text-slate-500">{selected.item.counterparty || "-"}</p>
                          <p className="text-slate-500">Method: {selected.item.method || "-"}</p>
                          <p className="font-black text-emerald-300">LKR {Number(selected.item.amount || 0).toLocaleString()}</p>
                          <div className="pt-2">
                            <Button size="sm" onClick={() => navigate("/pos")}>Open Payments</Button>
                          </div>
                        </>
                      )}
                      {selected.type === "purchase_orders" && (
                        <>
                          <p className="font-bold text-slate-100">{selected.item.po_number}</p>
                          <p className="text-slate-500">Supplier: {selected.item.supplier_name || "-"}</p>
                          <Badge tone={selected.item.status === "Received" ? "green" : "amber"}>{selected.item.status}</Badge>
                          <div className="pt-2">
                            <Button size="sm" onClick={() => navigate("/purchase")}>Open Purchase</Button>
                          </div>
                        </>
                      )}
                      {selected.type === "warranty" && (
                        <>
                          <p className="font-bold text-slate-100">{selected.item.warranty_code}</p>
                          <p className="text-slate-500">Customer: {selected.item.customer_name || "-"}</p>
                          <p className="text-slate-500">IMEI/Serial: {selected.item.imei_or_serial || selected.item.serial_number || "-"}</p>
                          <div className="pt-2">
                            <Button size="sm" onClick={() => navigate("/warranty")}>Open Warranty</Button>
                          </div>
                        </>
                      )}
                      {selected.type === "suppliers" && (
                        <>
                          <p className="font-bold text-slate-100">{selected.item.name}</p>
                          <p className="text-slate-500">Contact: {selected.item.contact || "-"}</p>
                          {selected.item.email && <p className="text-slate-500">Email: {selected.item.email}</p>}
                          <div className="pt-2">
                            <Button size="sm" onClick={() => navigate("/inventory/suppliers")}>Open Suppliers</Button>
                          </div>
                        </>
                      )}
                      {selected.type === "expenses" && (
                        <>
                          <p className="font-bold text-slate-100">{selected.item.expense_code}</p>
                          <p className="text-slate-500">Vendor: {selected.item.vendor_name || "-"}</p>
                          <p className="text-slate-500">Category: {selected.item.category || "-"}</p>
                          <p className="font-black text-amber-300">LKR {Number(selected.item.amount || 0).toLocaleString()}</p>
                          <div className="pt-2">
                            <Button size="sm" onClick={() => navigate("/expenses")}>Open Expenses</Button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </SectionCard>
              </div>
            </div>
          )}
        </>
      )}
      </div>
    </div>
  );
}

import { useMemo, useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { useCachedQuery } from "../hooks/useCachedQuery";
import { apiService } from "../lib/apiService";
import { isRepairCancelled, isRepairDelivered } from "../lib/repairStatus";
import api from "../lib/api";
import { AppTableEmptyRow, AppTableHead, AppTableShell, Badge, KpiCard, Loading } from "../components/UI";
import AppModal from "../components/layout/AppModal";
import {
  Menu,
  MenuItem,
} from "@mui/material";
import {
  Mail,
  Users,
  Search,
  Plus,
  ExternalLink,
  DollarSign,
  Shield,
  FileText,
  UserCheck,
  MoreVertical,
  Edit2,
  Trash2,
  AlertTriangle,
  Filter,
} from "lucide-react";
import { useFeedback } from "../components/FeedbackProvider";

const CUSTOMER_COLUMNS = [
  { key: "name", label: "Customer Name", sortable: true },
  { key: "phone", label: "Phone", sortable: true },
  { key: "email", label: "Email", sortable: false },
  { key: "address", label: "Address", sortable: false },
  { key: "total_spent", label: "Total Spent", sortable: true },
  { key: "outstanding_balance", label: "Outstanding Balance", sortable: true },
  { key: "repairs_count", label: "Repairs", sortable: true },
  { key: "last_visit", label: "Last Visit", sortable: true },
  { key: "warranty_items", label: "Active Warranties", sortable: false },
];

const DEFAULT_VISIBLE_COLUMNS = CUSTOMER_COLUMNS.reduce((acc, col) => {
  acc[col.key] = true;
  return acc;
}, {});

const QUICK_FILTERS = [
  { key: "all", label: "All" },
  { key: "vip", label: "VIP" },
  { key: "outstanding", label: "Outstanding" },
  { key: "recent", label: "Visited 30d" },
];

export default function Customers() {
  const { toast, confirm } = useFeedback();

  const { data: customersData, loading: customersLoading, setData: setCustomersCache } = useCachedQuery(
    "customers",
    () => apiService.customers.list({ pageSize: 1000 })
  );
  const customers = customersData?.items || [];

  const setCustomers = (updater) => {
    setCustomersCache((prev) => {
      const currentItems = prev?.items || [];
      const newItems = typeof updater === "function" ? updater(currentItems) : (updater?.items ?? updater);
      return {
        ...prev,
        items: newItems,
        total: prev?.total ?? newItems.length
      };
    });
  };

  const { data: salesData, loading: salesLoading } = useCachedQuery(
    "sales",
    () => apiService.sales.list({ pageSize: 1000 })
  );
  const sales = salesData?.items || [];

  const { data: repairsData, loading: repairsLoading } = useCachedQuery(
    "repairs",
    () => apiService.repairs.list({ pageSize: 1000 })
  );
  const repairs = repairsData?.items || [];

  const [searchQuery, setSearchQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editCustomerId, setEditCustomerId] = useState(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", notes: "" });
  const [selectedRows, setSelectedRows] = useState([]);
  const [tableSortBy, setTableSortBy] = useState("name");
  const [tableSortDir, setTableSortDir] = useState("asc");
  const [tablePage, setTablePage] = useState(0);
  const [tableRowsPerPage, setTableRowsPerPage] = useState(25);
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_VISIBLE_COLUMNS);
  const [columnsMenuAnchor, setColumnsMenuAnchor] = useState(null);
  const [rowMenuAnchor, setRowMenuAnchor] = useState(null);
  const [rowMenuCustomer, setRowMenuCustomer] = useState(null);
  const [showWalkInModal, setShowWalkInModal] = useState(false);
  const [walkInForm, setWalkInForm] = useState({ name: "", phone: "" });

  const salesByCustomerId = useMemo(() => {
    const map = new Map();
    for (const sale of sales || []) {
      if (sale.is_voided || !sale.customer_id) continue;
      const list = map.get(sale.customer_id) || [];
      list.push(sale);
      map.set(sale.customer_id, list);
    }
    return map;
  }, [sales]);

  const repairsByCustomerId = useMemo(() => {
    const map = new Map();
    for (const repair of repairs || []) {
      if (!repair.customer_id) continue;
      const list = map.get(repair.customer_id) || [];
      list.push(repair);
      map.set(repair.customer_id, list);
    }
    return map;
  }, [repairs]);

  const enhancedCustomers = useMemo(() => {
    if (!customers) return [];

    return customers.map((customer) => {
      const customerSales = salesByCustomerId.get(customer.id) || [];
      const customerRepairs = repairsByCustomerId.get(customer.id) || [];

      const totalSpent = customerSales.reduce((sum, s) => sum + (s.total || 0), 0);
      const outstandingBalance = customerRepairs
        .filter((r) => !isRepairDelivered(r.status) && !isRepairCancelled(r.status))
        .reduce((sum, r) => sum + Math.max(0, (r.estimated_cost || 0) - (r.advance_payment || 0)), 0);

      const lastVisitTimestamp = Math.max(
        0,
        ...customerSales.map((s) => new Date(s.created_at).getTime()),
        ...customerRepairs.map((r) => new Date(r.created_at).getTime())
      );
      const lastVisit = lastVisitTimestamp > 0 ? new Date(lastVisitTimestamp) : null;

      const activeWarranties = Number(customer.active_warranty_count || 0);

      return {
        ...customer,
        total_spent: totalSpent,
        outstanding_balance: outstandingBalance,
        repairs_count: customerRepairs.length,
        last_visit: lastVisit,
        warranty_items: activeWarranties,
        sales_count: customerSales.length,
      };
    });
  }, [customers, salesByCustomerId, repairsByCustomerId]);

  const filteredCustomers = useMemo(() => {
    const now = Date.now();
    const query = searchQuery.trim().toLowerCase();

    let filtered = enhancedCustomers.filter((c) => {
      if (query) {
        const matchesText =
          c.name.toLowerCase().includes(query) ||
          c.phone.includes(query) ||
          (c.email || "").toLowerCase().includes(query) ||
          (c.address || "").toLowerCase().includes(query);
        if (!matchesText) return false;
      }

      if (quickFilter === "vip" && c.total_spent <= 100000) return false;
      if (quickFilter === "outstanding" && c.outstanding_balance <= 0) return false;
      if (quickFilter === "recent") {
        if (!c.last_visit) return false;
        const ageDays = (now - c.last_visit.getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays > 30) return false;
      }

      return true;
    });

    filtered.sort((a, b) => {
      let aVal = a[tableSortBy];
      let bVal = b[tableSortBy];

      if (tableSortBy === "last_visit") {
        aVal = aVal ? aVal.getTime() : 0;
        bVal = bVal ? bVal.getTime() : 0;
      }

      if (typeof aVal === "string") {
        aVal = aVal.toLowerCase();
        bVal = (bVal || "").toLowerCase();
      }

      if (aVal < bVal) return tableSortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return tableSortDir === "asc" ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [enhancedCustomers, searchQuery, quickFilter, tableSortBy, tableSortDir]);

  const pagedCustomers = useMemo(() => {
    const start = tablePage * tableRowsPerPage;
    return filteredCustomers.slice(start, start + tableRowsPerPage);
  }, [filteredCustomers, tablePage, tableRowsPerPage]);

  const visibleCustomerColumns = useMemo(
    () => CUSTOMER_COLUMNS.filter((col) => visibleColumns[col.key]),
    [visibleColumns],
  );
  const tablePageCount = Math.max(1, Math.ceil(filteredCustomers.length / tableRowsPerPage));
  const tableRangeStart = filteredCustomers.length === 0 ? 0 : tablePage * tableRowsPerPage + 1;
  const tableRangeEnd = Math.min(filteredCustomers.length, (tablePage + 1) * tableRowsPerPage);

  useEffect(() => {
    setTablePage(0);
  }, [searchQuery, quickFilter, tableSortBy, tableSortDir]);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(filteredCustomers.length / tableRowsPerPage) - 1);
    if (tablePage > maxPage) setTablePage(maxPage);
  }, [filteredCustomers.length, tableRowsPerPage, tablePage]);

  useEffect(() => {
    setSelectedRows((prev) => prev.filter((id) => filteredCustomers.some((c) => c.id === id)));
  }, [filteredCustomers]);

  const handleSort = (column) => {
    if (tableSortBy === column) {
      setTableSortDir(tableSortDir === "asc" ? "desc" : "asc");
    } else {
      setTableSortBy(column);
      setTableSortDir("asc");
    }
  };

  const openRowMenu = (event, customer) => {
    setRowMenuAnchor(event.currentTarget);
    setRowMenuCustomer(customer);
  };

  const openEditModal = (customer) => {
    setEditCustomerId(customer.id);
    setForm({
      name: customer.name || "",
      phone: customer.phone || "",
      email: customer.email || "",
      address: customer.address || "",
      notes: customer.notes || "",
    });
    setShowEditModal(true);
  };

  const add = async () => {
    if (!form.name.trim() || !form.phone.trim()) return toast("Name and Phone are required", "warning");
    try {
      const r = await api.post("/customers", {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
      });
      setCustomers([r.data, ...(customers || [])]);
      setForm({ name: "", phone: "", email: "", address: "", notes: "" });
      setShowAddModal(false);
      toast("Customer profile created", "success");
    } catch {
      toast("Failed to create customer", "error");
    }
  };

  const saveEdit = async () => {
    if (!form.name.trim() || !form.phone.trim()) return toast("Name and Phone are required", "warning");
    try {
      const r = await api.put(`/customers/${editCustomerId}`, {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
      });
      setCustomers((customers || []).map((c) => (c.id === editCustomerId ? r.data : c)));
      setShowEditModal(false);
      setEditCustomerId(null);
      setForm({ name: "", phone: "", email: "", address: "", notes: "" });
      toast("Customer profile updated", "success");
    } catch {
      toast("Failed to update customer", "error");
    }
  };

  const addWalkIn = async () => {
    if (!walkInForm.name.trim() || !walkInForm.phone.trim()) return toast("Name and Phone are required", "warning");
    try {
      const r = await api.post("/customers", { name: walkInForm.name.trim(), phone: walkInForm.phone.trim(), address: "Walk-in Customer" });
      setCustomers([r.data, ...(customers || [])]);
      setWalkInForm({ name: "", phone: "" });
      setShowWalkInModal(false);
      toast("Walk-in customer added", "success");
    } catch {
      toast("Failed to add walk-in customer", "error");
    }
  };

  const deleteCustomer = async (customer) => {
    const ok = await confirm("Delete Customer", `Are you sure you want to delete ${customer.name}? This cannot be undone.`);
    if (!ok) return;
    try {
      await api.delete(`/customers/${customer.id}`);
      setCustomers((customers || []).filter((c) => c.id !== customer.id));
      setSelectedRows((prev) => prev.filter((id) => id !== customer.id));
      toast("Customer deleted", "success");
    } catch {
      toast("Failed to delete customer", "error");
    }
  };

  const deleteSelected = async () => {
    if (selectedRows.length === 0) return;
    const ok = await confirm("Delete Selected Customers", `Delete ${selectedRows.length} selected customer(s)? This cannot be undone.`);
    if (!ok) return;

    try {
      await Promise.all(selectedRows.map((id) => api.delete(`/customers/${id}`)));
      setCustomers((customers || []).filter((c) => !selectedRows.includes(c.id)));
      setSelectedRows([]);
      toast("Selected customers deleted", "success");
    } catch {
      toast("Failed to delete one or more customers", "error");
    }
  };

  const stats = useMemo(() => {
    const total = enhancedCustomers.length;
    const withEmail = enhancedCustomers.filter((c) => c.email).length;
    const withOutstanding = enhancedCustomers.filter((c) => c.outstanding_balance > 0).length;
    const totalOutstanding = enhancedCustomers.reduce((sum, c) => sum + c.outstanding_balance, 0);
    const vipCustomers = enhancedCustomers.filter((c) => c.total_spent > 100000).length;

    return { total, withEmail, withOutstanding, totalOutstanding, vipCustomers };
  }, [enhancedCustomers]);

  if (customersLoading || salesLoading || repairsLoading) {
    return <Loading text="Loading customer data..." />;
  }

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pb-4 xl:h-full xl:overflow-hidden">
      <div className="flex flex-wrap justify-between items-end gap-3 shrink-0">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white">Customer Management</h1>
          <p className="text-xs text-slate-400 mt-1">Manage customer profiles, history, and relationships</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowWalkInModal(true)}
            className="px-4 py-2.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-900/20 transition-all flex items-center gap-2"
          >
            <UserCheck size={14} /> Walk-in Customer
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/20 transition-all flex items-center gap-2"
          >
            <Plus size={14} /> Add Customer
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-3 shrink-0">
        <KpiCard tone="sky" title="Total Customers" value={String(stats.total)} icon={<Users size={18} />} />
        <KpiCard tone="indigo" title="Email Contacts" value={String(stats.withEmail)} icon={<Mail size={18} />} />
        <KpiCard tone="amber" title="VIP Customers" value={String(stats.vipCustomers)} icon={<Shield size={18} />} />
        <KpiCard tone="green" title="With Outstanding" value={String(stats.withOutstanding)} icon={<DollarSign size={18} />} />
        <KpiCard tone="red" title="Total Outstanding" value={`Rs. ${stats.totalOutstanding.toLocaleString()}`} icon={<AlertTriangle size={18} />} />
      </div>

      <div className="flex-1 bg-slate-900/60 backdrop-blur-md border border-white/10 rounded-2xl flex flex-col overflow-hidden shadow-2xl">
        <div className="p-4 border-b border-white/5 bg-black/20 flex flex-wrap justify-between items-center gap-3 shrink-0">
          <div className="text-xs text-slate-400 font-bold uppercase tracking-widest">Customer Directory</div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <div className="relative w-full sm:w-80">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                placeholder="Search by name, phone, email, or address..."
                className="w-full bg-black/40 border border-white/10 rounded-lg py-2 pl-9 pr-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1 bg-black/30 border border-white/10 rounded-lg px-2 py-1">
              <Filter size={12} className="text-slate-500" />
              {QUICK_FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setQuickFilter(f.key)}
                  className={`px-2 py-1 rounded text-[10px] font-bold ${
                    quickFilter === f.key ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={(e) => setColumnsMenuAnchor(e.currentTarget)}
              className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-black/20 text-slate-400 hover:bg-white/10 hover:text-white"
              aria-label="Choose visible columns"
            >
              <FileText size={14} />
            </button>
          </div>
        </div>

        {selectedRows.length > 0 && (
          <div className="px-4 py-2 border-b border-white/10 bg-rose-950/30 flex items-center justify-between">
            <span className="text-xs text-slate-300 font-bold">{selectedRows.length} selected</span>
            <button
              onClick={deleteSelected}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30"
            >
              Delete Selected
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1">
          <AppTableShell minWidth={700} className="h-full rounded-none border-0" aria-label="Customer directory">
            <AppTableHead>
              <tr>
                <th className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-white/20 bg-black/30 accent-indigo-500"
                    checked={filteredCustomers.length > 0 && selectedRows.length === filteredCustomers.length}
                    onChange={(e) => setSelectedRows(e.target.checked ? filteredCustomers.map((c) => c.id) : [])}
                    aria-label="Select all customers"
                  />
                </th>
                {visibleCustomerColumns.map(({ key, label, sortable }) => (
                  <th key={key} className="px-4 py-3">
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => handleSort(key)}
                        className="inline-flex items-center gap-1 text-left font-black uppercase tracking-widest text-slate-500 hover:text-slate-300"
                      >
                        {label}
                        {tableSortBy === key ? <span className="text-[9px] text-indigo-300">{tableSortDir === "asc" ? "Asc" : "Desc"}</span> : null}
                      </button>
                    ) : (
                      label
                    )}
                  </th>
                ))}
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </AppTableHead>
            <tbody className="divide-y divide-white/5">
              {pagedCustomers.map((c) => (
                <tr key={c.id} className="hover:bg-white/[0.03]">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-white/20 bg-black/30 accent-indigo-500"
                      checked={selectedRows.includes(c.id)}
                      onChange={(e) =>
                        setSelectedRows(e.target.checked ? [...selectedRows, c.id] : selectedRows.filter((id) => id !== c.id))
                      }
                      aria-label={`Select ${c.name}`}
                    />
                  </td>
                  {visibleColumns.name && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-indigo-500/20 bg-indigo-500/20 text-sm font-black uppercase text-indigo-300">
                          {c.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-bold text-slate-100">{c.name}</div>
                          {c.total_spent > 100000 ? (
                            <Badge tone="amber" className="mt-1 text-[9px]">
                              VIP
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    </td>
                  )}
                  {visibleColumns.phone && <td className="px-4 py-3 text-slate-400">{c.phone}</td>}
                  {visibleColumns.email && <td className="px-4 py-3 text-slate-400">{c.email || "-"}</td>}
                  {visibleColumns.address && <td className="max-w-[170px] truncate px-4 py-3 text-slate-400">{c.address || "-"}</td>}
                  {visibleColumns.total_spent && <td className="px-4 py-3 font-bold text-emerald-300">Rs. {c.total_spent.toLocaleString()}</td>}
                  {visibleColumns.outstanding_balance && (
                    <td className={`px-4 py-3 font-bold ${c.outstanding_balance > 0 ? "text-rose-300" : "text-emerald-300"}`}>
                      Rs. {c.outstanding_balance.toLocaleString()}
                    </td>
                  )}
                  {visibleColumns.repairs_count && <td className="px-4 py-3 font-semibold text-slate-200">{c.repairs_count}</td>}
                  {visibleColumns.last_visit && <td className="px-4 py-3 text-slate-400">{c.last_visit ? c.last_visit.toLocaleDateString() : "Never"}</td>}
                  {visibleColumns.warranty_items && (
                    <td className="px-4 py-3">
                      {c.warranty_items > 0 ? <Badge tone="green">{c.warranty_items} active</Badge> : <span className="text-slate-500">-</span>}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                      <NavLink
                        to={`/customers/${c.id}`}
                        className="inline-flex items-center gap-1.5 rounded bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-300 transition-colors hover:bg-indigo-500/20 hover:text-indigo-300"
                      >
                        Profile <ExternalLink size={12} />
                      </NavLink>
                      <button
                        type="button"
                        onClick={(e) => openRowMenu(e, c)}
                        className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white"
                        aria-label={`Open actions for ${c.name}`}
                      >
                        <MoreVertical size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {pagedCustomers.length === 0 ? (
                <AppTableEmptyRow
                  colSpan={visibleCustomerColumns.length + 2}
                  title={searchQuery || quickFilter !== "all" ? "No customers match" : "No customers yet"}
                  text={searchQuery || quickFilter !== "all" ? "Change the search or filter to see more customers." : "Add your first customer profile to start tracking repairs, sales, and warranties."}
                />
              ) : null}
            </tbody>
          </AppTableShell>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-3 text-xs text-slate-400">
          <div>
            Showing <span className="font-bold text-slate-200">{tableRangeStart}</span>-<span className="font-bold text-slate-200">{tableRangeEnd}</span> of <span className="font-bold text-slate-200">{filteredCustomers.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <span>Rows</span>
            <select
              value={tableRowsPerPage}
              onChange={(e) => {
                setTableRowsPerPage(parseInt(e.target.value, 10));
                setTablePage(0);
              }}
              className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs font-bold text-slate-200 outline-none"
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setTablePage((page) => Math.max(0, page - 1))}
              disabled={tablePage === 0}
              className="rounded-lg border border-white/10 px-3 py-1.5 font-bold text-slate-300 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-white/10"
            >
              Previous
            </button>
            <span className="min-w-16 text-center font-bold text-slate-300">{tablePage + 1} / {tablePageCount}</span>
            <button
              type="button"
              onClick={() => setTablePage((page) => Math.min(tablePageCount - 1, page + 1))}
              disabled={tablePage >= tablePageCount - 1}
              className="rounded-lg border border-white/10 px-3 py-1.5 font-bold text-slate-300 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-white/10"
            >
              Next
            </button>
          </div>
        </div>

        <Menu
          anchorEl={columnsMenuAnchor}
          open={Boolean(columnsMenuAnchor)}
          onClose={() => setColumnsMenuAnchor(null)}
          PaperProps={{ sx: { bgcolor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0" } }}
        >
          {CUSTOMER_COLUMNS.map((col) => (
            <MenuItem key={col.key} onClick={() => setVisibleColumns({ ...visibleColumns, [col.key]: !visibleColumns[col.key] })}>
              <input
                type="checkbox"
                checked={visibleColumns[col.key]}
                readOnly
                className="mr-3 h-4 w-4 rounded border-white/20 bg-black/30 accent-indigo-500"
              />
              {col.label}
            </MenuItem>
          ))}
        </Menu>

        <Menu
          anchorEl={rowMenuAnchor}
          open={Boolean(rowMenuAnchor)}
          onClose={() => setRowMenuAnchor(null)}
          PaperProps={{ sx: { bgcolor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0" } }}
        >
          <MenuItem
            onClick={() => {
              if (rowMenuCustomer) openEditModal(rowMenuCustomer);
              setRowMenuAnchor(null);
            }}
          >
            <Edit2 size={14} className="mr-2" /> Edit Customer
          </MenuItem>
          <MenuItem
            onClick={() => {
              if (rowMenuCustomer) deleteCustomer(rowMenuCustomer);
              setRowMenuAnchor(null);
            }}
            sx={{ color: "#ef4444" }}
          >
            <Trash2 size={14} className="mr-2" /> Delete Customer
          </MenuItem>
        </Menu>
      </div>

      <AppModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title={<span className="flex items-center gap-2"><Users size={18} className="text-indigo-400" /> New Customer Profile</span>}
        panelClassName="max-w-lg"
      >
        <div className="grid grid-cols-2 gap-5 p-5">
          <div className="col-span-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Full Name</label>
            <input
              autoFocus
              className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500"
              placeholder="e.g. Kasun Perera"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="col-span-2 md:col-span-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Phone Number</label>
            <input
              className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500"
              placeholder="07XXXXXXXX"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="col-span-2 md:col-span-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Email Address</label>
            <input
              type="email"
              className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500"
              placeholder="kasun@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Physical Address</label>
            <input
              className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500"
              placeholder="City / Area"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Notes</label>
            <textarea
              className="w-full min-h-[80px] bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500 resize-none"
              placeholder="Customer notes, preferences, reminders..."
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <div className="flex gap-3 border-t border-white/10 bg-white/[0.02] p-4">
          <button onClick={() => setShowAddModal(false)} className="flex-1 py-3 rounded-xl font-bold text-slate-300 bg-white/5 hover:bg-white/10 transition-colors">
            Cancel
          </button>
          <button onClick={add} className="flex-1 py-3 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-900/50 transition-all">
            Create Profile
          </button>
        </div>
      </AppModal>

      <AppModal
        open={showEditModal}
        onClose={() => setShowEditModal(false)}
        title={<span className="flex items-center gap-2"><Edit2 size={18} className="text-indigo-400" /> Edit Customer</span>}
        panelClassName="max-w-lg"
      >
        <div className="grid grid-cols-2 gap-5 p-5">
          <div className="col-span-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Full Name</label>
            <input
              autoFocus
              className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="col-span-2 md:col-span-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Phone Number</label>
            <input
              className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="col-span-2 md:col-span-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Email Address</label>
            <input
              type="email"
              className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Physical Address</label>
            <input
              className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Notes</label>
            <textarea
              className="w-full min-h-[80px] bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500 resize-none"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <div className="flex gap-3 border-t border-white/10 bg-white/[0.02] p-4">
          <button onClick={() => setShowEditModal(false)} className="flex-1 py-3 rounded-xl font-bold text-slate-300 bg-white/5 hover:bg-white/10 transition-colors">
            Cancel
          </button>
          <button onClick={saveEdit} className="flex-1 py-3 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-900/50 transition-all">
            Save Changes
          </button>
        </div>
      </AppModal>

      <AppModal
        open={showWalkInModal}
        onClose={() => setShowWalkInModal(false)}
        title={<span className="flex items-center gap-2"><UserCheck size={18} className="text-amber-400" /> Quick Walk-in Customer</span>}
        panelClassName="max-w-md"
      >
        <div className="grid grid-cols-1 gap-5 p-5">
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Customer Name</label>
            <input
              autoFocus
              className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-amber-500"
              placeholder="Enter customer name"
              value={walkInForm.name}
              onChange={(e) => setWalkInForm({ ...walkInForm, name: e.target.value })}
            />
          </div>
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">Phone Number</label>
            <input
              className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-amber-500"
              placeholder="07XXXXXXXX"
              value={walkInForm.phone}
              onChange={(e) => setWalkInForm({ ...walkInForm, phone: e.target.value })}
            />
          </div>
        </div>
        <div className="flex gap-3 border-t border-white/10 bg-white/[0.02] p-4">
          <button onClick={() => setShowWalkInModal(false)} className="flex-1 py-3 rounded-xl font-bold text-slate-300 bg-white/5 hover:bg-white/10 transition-colors">
            Cancel
          </button>
          <button onClick={addWalkIn} className="flex-1 py-3 rounded-xl font-bold text-white bg-amber-600 hover:bg-amber-500 shadow-lg shadow-amber-900/50 transition-all">
            Add Walk-in
          </button>
        </div>
      </AppModal>
    </div>
  );
}

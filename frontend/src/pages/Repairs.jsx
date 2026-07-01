import { useMemo, useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useCachedQuery } from "../hooks/useCachedQuery";
import { apiService } from "../lib/apiService";
import api from "../lib/api";
import { openPrintCenter } from "../lib/printCenter";
import { AppSelect, AppTableEmptyRow, AppTableHead, AppTableShell, Badge, Button, Input, KpiCard, PageTitle, Select, Table } from "../components/UI";
import AppModal from "../components/layout/AppModal";
import { Menu, MenuItem } from "@mui/material";
import { CheckCircle2, ClipboardList, Loader2, Wrench, LayoutGrid, List, Search, Plus, Filter, Clock, MoreVertical, Bell, AlertTriangle, UserCheck, Phone, CheckCheck, X } from "lucide-react";
import { useFeedback } from "../components/FeedbackProvider";
import RepairKanban from "../components/RepairKanban";

const REPAIR_STATUS_OPTIONS = [
  "pending",
  "diagnosing",
  "waiting_for_approval",
  "waiting_for_parts",
  "repairing",
  "quality_checking",
  "completed",
  "delivered",
  "cancelled",
];

const REPAIR_STATUS_LABELS = {
  pending: "Pending",
  diagnosing: "Diagnosing",
  waiting_for_approval: "Waiting for Approval",
  waiting_for_parts: "Waiting for Parts",
  repairing: "Repairing",
  quality_checking: "Quality Checking",
  completed: "Completed",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

function normalizeStatus(value) {
  const text = String(value || "").trim().toLowerCase();
  const aliases = {
    "waiting for approval": "waiting_for_approval",
    "waiting for parts": "waiting_for_parts",
    "quality checking": "quality_checking",
    "in progress": "repairing",
  };
  return aliases[text] || text;
}

function statusLabel(value) {
  const normalized = normalizeStatus(value);
  return REPAIR_STATUS_LABELS[normalized] || String(value || "Pending");
}

function statusTone(status) {
  const normalized = normalizeStatus(status);
  if (normalized === "delivered") return "green";
  if (normalized === "completed") return "sky";
  if (["repairing", "waiting_for_parts", "waiting_for_approval", "quality_checking"].includes(normalized)) return "amber";
  if (normalized === "diagnosing") return "indigo";
  return "slate";
}

const REPAIR_COLUMNS = [
  { key: "ticket_no", label: "Ticket #", sortable: true },
  { key: "customer_name", label: "Customer", sortable: true },
  { key: "customer_phone", label: "Phone", sortable: true },
  { key: "device_model", label: "Device", sortable: true },
  { key: "issue", label: "Issue", sortable: false },
  { key: "priority", label: "Priority", sortable: true },
  { key: "sla", label: "SLA", sortable: false },
  { key: "technician", label: "Technician", sortable: true },
  { key: "estimated_cost", label: "Est. Cost", sortable: true },
  { key: "advance_payment", label: "Advance", sortable: false },
  { key: "balance", label: "Balance", sortable: true },
  { key: "status", label: "Status", sortable: true },
  { key: "created_at", label: "Date", sortable: true },
  { key: "parts", label: "Parts", sortable: false },
];

const DEFAULT_VISIBLE_COLUMNS = REPAIR_COLUMNS.reduce((acc, col) => {
  acc[col.key] = true;
  return acc;
}, {});
DEFAULT_VISIBLE_COLUMNS.customer_phone = false;
DEFAULT_VISIBLE_COLUMNS.sla = false;
DEFAULT_VISIBLE_COLUMNS.advance_payment = false;
DEFAULT_VISIBLE_COLUMNS.balance = false;
DEFAULT_VISIBLE_COLUMNS.parts = false;

export default function Repairs() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast, confirm, prompt } = useFeedback();
  const { data: repairsData, loading, error, refetch, setData: setCacheData } = useCachedQuery(
    "repairs",
    () => apiService.repairs.list({ pageSize: 1000 })
  );
  const data = repairsData?.items || [];
  const refreshRepairs = refetch;

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

  const customersQuery = useCachedQuery("customers", () => apiService.customers.list({ pageSize: 1000 }).then(res => res.items));
  const customers = customersQuery.data || [];
  const customersFetch = {
    data: customers,
    setData: (updater) => {
      customersQuery.setData((currentItems = []) => {
        return typeof updater === "function" ? updater(currentItems) : updater;
      });
    }
  };
  const [query, setQuery] = useState("");
  const [view, setView] = useState("table"); // table | kanban
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ 
    customer_id: '', 
    device_model: '', 
    imei: '', 
    issue: '', 
    technician: 'Ashan Perera', 
    estimated_cost: 0, 
    notes: '',
    priority: 'Normal'
  });
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '', address: '' });
  const [selectedRepair, setSelectedRepair] = useState(null);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [timeline, setTimeline] = useState([]);
  const [parts, setParts] = useState([]);
  const [repairAdvances, setRepairAdvances] = useState([]);
  const inventoryQuery = useCachedQuery("inventory_minimal", () => apiService.inventory.list({ pageSize: 1000 }).then(res => res.items));
  const inventory = inventoryQuery.data || [];
  const inventoryFetch = {
    data: inventory,
    refresh: () => inventoryQuery.refetch()
  };
  const [selectedPart, setSelectedPart] = useState({ item_id: '', quantity: 1 });
  const [priorityFilter, setPriorityFilter] = useState("All Priority");
  const [dateFilter, setDateFilter] = useState("All Dates");
  const [selectedRows, setSelectedRows] = useState([]);
  const [activeRowIndex, setActiveRowIndex] = useState(0);
  const [tableSortBy, setTableSortBy] = useState("created_at");
  const [tableSortDir, setTableSortDir] = useState("desc");
  const [tablePage, setTablePage] = useState(0);
  const [tableRowsPerPage, setTableRowsPerPage] = useState(25);
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_VISIBLE_COLUMNS);
  const [columnsMenuAnchor, setColumnsMenuAnchor] = useState(null);
  const [rowMenuAnchor, setRowMenuAnchor] = useState(null);
  const [rowMenuRepair, setRowMenuRepair] = useState(null);
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 900));
  const hydratedFromQuery = useRef(false);
  const searchInputRef = useRef(null);

  useEffect(() => {
    const onResize = () => {
      setViewportHeight(window.innerHeight);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const isCompactHeight = viewportHeight <= 900;

  const showDetails = async (repair) => {
    try {
      const [{ data: tl }, { data: pt }, { data: adv }] = await Promise.all([
        api.get(`/repairs/${repair.id}/timeline`),
        api.get(`/repairs/${repair.id}/parts`),
        api.get(`/advance-payments/repair/${repair.id}`)
      ]);
      setTimeline(tl);
      setParts(pt);
      setRepairAdvances(Array.isArray(adv) ? adv : []);
      setSelectedRepair(repair);
      setDetailsVisible(true);
    } catch (err) {
      console.error("Failed to fetch repair details", err);
      toast("Could not load full repair details", "error");
      // Fallback: show the modal with just the repair data we already have
      setTimeline([]);
      setParts([]);
      setRepairAdvances([]);
      setSelectedRepair(repair);
      setDetailsVisible(true);
    }
  };

  const addPart = async () => {
    if (!selectedPart.item_id) return toast("Select a part first", "warning");
    const currentStatus = normalizeStatus(selectedRepair?.status);
    if (currentStatus === "pending" || currentStatus === "diagnosing") {
      return toast("Parts can only be consumed once estimate is approved (In Progress / Repairing)", "warning");
    }
    try {
      await api.post(`/repairs/${selectedRepair.id}/consume-part`, selectedPart);
      const { data: updatedParts } = await api.get(`/repairs/${selectedRepair.id}/parts`);
      setParts(updatedParts);
      setSelectedPart({ item_id: '', quantity: 1 });
      toast("Part consumed from inventory", "success");
    } catch (err) {
      toast("Failed to add part (check stock)", "error");
    }
  };

  const printTicket = (ticket) => {
    if (!ticket || !ticket.id) {
      return toast("Error: Ticket ID is missing. Refresh and try again.", "error");
    }

    openPrintCenter(navigate, {
      type: "repair",
      ref: ticket.id,
      paper: "a4",
      template: "service",
    });
  };

  const submit = async () => {
    if (!form.device_model || !form.imei || !form.technician) {
      return toast("Device model, IMEI and technician are required", "warning");
    }

    try {
      let customerId = null;
      if (form.customer_id === "new") {
        if (!newCustomer.name || !newCustomer.phone) {
          return toast("Please provide the new customer's name and phone number", "warning");
        }
        const { data: customer } = await api.post('/customers', newCustomer);
        customersFetch.setData([...(customersFetch.data || []), customer]);
        customerId = customer.id;
      } else if (form.customer_id) {
        customerId = Number(form.customer_id);
      }

      const payload = {
        ...form,
        customer_id: customerId,
      };

      const { data: newTicket } = await api.post('/repairs', payload);
      
      // Reset form immediately
      setForm({ customer_id: '', device_model: '', imei: '', issue: '', technician: defaultTechnician, estimated_cost: 0, advance_payment: 0, notes: '', priority: 'Normal' });
      setNewCustomer({ name: '', phone: '', email: '', address: '' });
      
      // Update data
      setData([newTicket, ...(data || [])]);
      
      // Close modal
      setShowCreate(false);
      
      toast("âœ… Repair ticket created successfully", "success");
      
      // Wait a moment for modal to close, then ask about printing
      setTimeout(async () => {
        const ok = await confirm("Print Job Card?", `Would you like to print the Job Card for ticket #${newTicket.ticket_no}?`);
        if (ok) {
          console.log("User confirmed printing");
          printTicket(newTicket);
        }
      }, 500);
    } catch (err) {
      console.error("Submit error:", err);
      toast("Failed to create ticket", "error");
    }
  };

  const [statusUpdateRepair, setStatusUpdateRepair] = useState(null);
  const [statusForm, setStatusForm] = useState({ status: "", note: "", notify: true });

  const openStatusModal = (repair) => {
    setStatusUpdateRepair(repair);
    setStatusForm({ status: normalizeStatus(repair.status), note: "", notify: true });
  };

  const executeStatusUpdate = async () => {
    try {
      const { data: res } = await api.put(`/repairs/${statusUpdateRepair.id}/status?status=${encodeURIComponent(statusForm.status)}&note=${encodeURIComponent(statusForm.note)}`);

      if (res?.repair) {
        setData((data || []).map((r) => (r.id === statusUpdateRepair.id ? { ...r, ...res.repair } : r)));
      } else {
        setData((data || []).map((r) => (r.id === statusUpdateRepair.id ? { ...r, status: statusForm.status } : r)));
      }
      
      if (statusForm.notify && res.whatsapp_url) {
        window.open(res.whatsapp_url, "_blank");
      }
      
      setStatusUpdateRepair(null);
      toast(`Status updated to ${statusLabel(statusForm.status)}`, "success");
    } catch {
      toast("Failed to update status", "error");
    }
  };

  const cancelRepair = async (repair) => {
    if (!repair) return;
    const reasonInput = await prompt("Cancel Repair", `Enter a reason for cancelling ${repair.ticket_no}.`, {
      placeholder: "Reason, minimum 5 characters",
      multiline: true,
    });
    if (reasonInput === null) return;
    const reason = String(reasonInput || "").trim();
    if (reason.length < 5) {
      toast("Cancellation reason must be at least 5 characters", "warning");
      return;
    }
    const ok = await confirm(
      "Cancel Repair",
      `Cancel ticket ${repair.ticket_no}? Delivered repairs cannot be cancelled, and invoiced repairs must be voided first.`
    );
    if (!ok) return;
    try {
      const { data: res } = await api.post(`/repairs/${repair.id}/cancel`, { reason });
      if (res?.repair) {
        setData((data || []).map((r) => (r.id === repair.id ? { ...r, ...res.repair } : r)));
        if (selectedRepair?.id === repair.id) {
          setSelectedRepair((prev) => ({ ...(prev || {}), ...res.repair }));
          const { data: tl } = await api.get(`/repairs/${repair.id}/timeline`);
          setTimeline(tl || []);
        }
      }
      toast("Repair cancelled successfully", "success");
    } catch (err) {
      toast(err?.response?.data?.message || err?.response?.data?.detail || "Failed to cancel repair", "error");
    }
  };

  const reloadRepairDetails = async (repairId) => {
    const target = (data || []).find((row) => row.id === repairId) || selectedRepair;
    if (target) {
      await showDetails(target);
    }
  };

  const printAdvanceReceipt = (advanceId) => {
    openPrintCenter(navigate, {
      type: "advance",
      ref: advanceId,
      paper: "thermal_80",
    });
  };

  const collectRepairAdvance = async () => {
    if (!selectedRepair) return;
    const rawAmount = await prompt("Collect Repair Advance", "Enter the advance amount in LKR.", {
      defaultValue: "0",
      placeholder: "0.00",
    });
    if (rawAmount === null) return;
    const amount = Number(rawAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast("Enter a valid advance amount", "warning");
      return;
    }
    try {
      await api.post("/advance-payments", {
        advance_type: "repair",
        customer_id: selectedRepair.customer_id,
        repair_ticket_id: selectedRepair.id,
        amount,
        payment_method: "cash",
        notes: `Collected from repair details (${selectedRepair.ticket_no})`,
      });
      await refreshRepairs();
      await reloadRepairDetails(selectedRepair.id);
      toast("Advance collected", "success");
    } catch (err) {
      toast(err?.response?.data?.message || err?.response?.data?.detail || "Failed to collect advance", "error");
    }
  };

  const refundRepairAdvance = async () => {
    if (!selectedRepair) return;
    const refundable = (repairAdvances || []).find((row) => Number(row.amount || 0) - Number(row.refunded_amount || 0) > 0 && !["cancelled", "refunded"].includes(String(row.status || "").toLowerCase()));
    if (!refundable) {
      toast("No refundable advances available", "warning");
      return;
    }
    const rawAmount = await prompt("Refund Repair Advance", `Enter refund amount for ${refundable.advance_number}.`, {
      defaultValue: String(Math.max(0, Number(refundable.amount || 0) - Number(refundable.refunded_amount || 0))),
      placeholder: "0.00",
    });
    if (rawAmount === null) return;
    const amount = Number(rawAmount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast("Enter a valid refund amount", "warning");
      return;
    }
    const reason = await prompt("Refund Reason", "Enter the reason for this advance refund.", {
      defaultValue: "Customer cancelled repair",
      placeholder: "Reason, minimum 5 characters",
      multiline: true,
    });
    if (reason === null) return;
    if (String(reason).trim().length < 5) {
      toast("Refund reason must be at least 5 characters", "warning");
      return;
    }
    try {
      await api.patch(`/advance-payments/${refundable.id}/refund`, {
        amount,
        reason: String(reason).trim(),
        notes: `Refunded from repair ${selectedRepair.ticket_no}`,
      });
      await refreshRepairs();
      await reloadRepairDetails(selectedRepair.id);
      toast("Advance refunded", "success");
    } catch (err) {
      toast(err?.response?.data?.message || err?.response?.data?.detail || "Failed to refund advance", "error");
    }
  };

  const notify = async (r) => {
    const { data: res } = await api.put(`/repairs/${r.id}/status?status=${encodeURIComponent(r.status)}`);
    if (res.whatsapp_url) {
      window.open(res.whatsapp_url, "_blank");
      toast("Notification prepared in WhatsApp", "info");
    } else {
      toast("No customer phone available", "warning");
    }
  };

  const staffQuery = useCachedQuery("staff", () => apiService.staff.list().then(res => res.data));
  const technicians = staffQuery.data || [];
  const techniciansFetch = {
    data: technicians
  };
  const defaultTechnician = technicians.find(t => t.full_name === "Ashan Perera")?.full_name || technicians[0]?.full_name || "Ashan Perera";
  
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [techFilter, setTechFilter] = useState("All Technicians");
  const technicianFilterOptions = useMemo(
    () => [
      { value: "All Technicians", label: "All Technicians" },
      ...technicians.map((t) => ({ value: t.full_name, label: t.full_name })),
    ],
    [technicians],
  );
  const priorityFilterOptions = useMemo(
    () => [
      { value: "All Priority", label: "All Priority" },
      { value: "Low", label: "Low" },
      { value: "Normal", label: "Normal" },
      { value: "High", label: "High" },
      { value: "Urgent", label: "Urgent" },
    ],
    [],
  );
  const dateFilterOptions = useMemo(
    () => [
      { value: "All Dates", label: "All Dates" },
      { value: "Today", label: "Today" },
      { value: "Last 7 days", label: "Last 7 days" },
      { value: "Older than 3 days", label: "Older than 3 days" },
    ],
    [],
  );
  const bulkTechOptions = useMemo(
    () => technicians.map((t) => ({ value: String(t.id), label: t.full_name })),
    [technicians],
  );

  const filtered = useMemo(() => {
    const now = Date.now();
    return (data || []).filter((r) => {
      const matchesQuery = !query || 
        (r.ticket_no || "").toLowerCase().includes(query.toLowerCase()) ||
        (r.customer_name || "").toLowerCase().includes(query.toLowerCase()) ||
        (r.device_model || "").toLowerCase().includes(query.toLowerCase()) ||
        (r.imei || "").toLowerCase().includes(query.toLowerCase()) ||
        (r.customer_phone || "").toLowerCase().includes(query.toLowerCase());
      
      let matchesStatus = false;
      const normalizedStatus = normalizeStatus(r.status);
      if (statusFilter === "All Status") {
        matchesStatus = true;
      } else if (statusFilter === "In Progress") {
        matchesStatus = ["diagnosing", "repairing", "waiting_for_parts", "waiting_for_approval", "quality_checking"].includes(normalizedStatus);
      } else if (statusFilter === "Ready for Pickup") {
        matchesStatus = normalizedStatus === "completed";
      } else if (statusFilter === "Completed") {
        matchesStatus = normalizedStatus === "delivered";
      } else if (statusFilter === "Cancelled") {
        matchesStatus = normalizedStatus === "cancelled";
      } else {
        matchesStatus = normalizedStatus === normalizeStatus(statusFilter);
      }
      const matchesTech = techFilter === "All Technicians" || r.technician === techFilter;
      const matchesPriority = priorityFilter === "All Priority" || (r.priority || "Normal") === priorityFilter;
      const ageDays = Math.floor((now - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24));
      const matchesDate =
        dateFilter === "All Dates" ||
        (dateFilter === "Today" && ageDays === 0) ||
        (dateFilter === "Last 7 days" && ageDays <= 7) ||
        (dateFilter === "Older than 3 days" && ageDays > 3);

      return matchesQuery && matchesStatus && matchesTech && matchesPriority && matchesDate;
    });
  }, [data, query, statusFilter, techFilter, priorityFilter, dateFilter]);

  const sortedRepairs = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      const valueFor = (row) => {
        if (tableSortBy === "ticket_no") return Number(row.ticket_no || 0);
        if (tableSortBy === "customer_name") return String(row.customer_name || "").toLowerCase();
        if (tableSortBy === "device_model") return String(row.device_model || "").toLowerCase();
        if (tableSortBy === "priority") return String(row.priority || "Normal").toLowerCase();
        if (tableSortBy === "status") return String(row.status || "").toLowerCase();
        if (tableSortBy === "technician") return String(row.technician || "").toLowerCase();
        if (tableSortBy === "estimated_cost") return Number(row.estimated_cost || 0);
        if (tableSortBy === "balance") return Math.max(0, Number(row.estimated_cost || 0) - Number(row.advance_payment || 0));
        if (tableSortBy === "created_at") return new Date(row.created_at || 0).getTime();
        return String(row[tableSortBy] || "").toLowerCase();
      };
      const av = valueFor(a);
      const bv = valueFor(b);
      if (av < bv) return tableSortDir === "asc" ? -1 : 1;
      if (av > bv) return tableSortDir === "asc" ? 1 : -1;
      return 0;
    });
    return rows;
  }, [filtered, tableSortBy, tableSortDir]);

  useEffect(() => {
    if (hydratedFromQuery.current) return;
    hydratedFromQuery.current = true;

    const q = searchParams.get("q");
    const st = searchParams.get("status");
    const tech = searchParams.get("tech");
    const pr = searchParams.get("priority");
    const dt = searchParams.get("date");
    const sortBy = searchParams.get("sortBy");
    const sortDir = searchParams.get("sortDir");
    const page = Number(searchParams.get("page") || "1");
    const rows = Number(searchParams.get("rows") || "25");
    const viewParam = searchParams.get("view");
    const vc = searchParams.get("vc");

    if (q) setQuery(q);
    if (st) setStatusFilter(st);
    if (tech) setTechFilter(tech);
    if (pr) setPriorityFilter(pr);
    if (dt) setDateFilter(dt);
    if (sortBy) setTableSortBy(sortBy);
    if (sortDir === "asc" || sortDir === "desc") setTableSortDir(sortDir);
    if (!Number.isNaN(page) && page > 0) setTablePage(page - 1);
    if ([10, 25, 50, 100].includes(rows)) setTableRowsPerPage(rows);
    if (viewParam === "table" || viewParam === "kanban") setView(viewParam);
    if (vc) {
      const visible = { ...DEFAULT_VISIBLE_COLUMNS };
      Object.keys(visible).forEach((k) => { visible[k] = false; });
      vc.split(",").forEach((k) => {
        if (Object.prototype.hasOwnProperty.call(visible, k)) visible[k] = true;
      });
      setVisibleColumns(visible);
    }
  }, [searchParams]);

  const pagedRepairs = useMemo(() => {
    const start = tablePage * tableRowsPerPage;
    return sortedRepairs.slice(start, start + tableRowsPerPage);
  }, [sortedRepairs, tablePage, tableRowsPerPage]);
  const visibleRepairColumns = useMemo(
    () => REPAIR_COLUMNS.filter((col) => visibleColumns[col.key]),
    [visibleColumns],
  );
  const tablePageCount = Math.max(1, Math.ceil(sortedRepairs.length / tableRowsPerPage));
  const tableRangeStart = sortedRepairs.length === 0 ? 0 : tablePage * tableRowsPerPage + 1;
  const tableRangeEnd = Math.min(sortedRepairs.length, (tablePage + 1) * tableRowsPerPage);

  useEffect(() => {
    if (!hydratedFromQuery.current) return;
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (statusFilter !== "All Status") params.set("status", statusFilter);
    if (techFilter !== "All Technicians") params.set("tech", techFilter);
    if (priorityFilter !== "All Priority") params.set("priority", priorityFilter);
    if (dateFilter !== "All Dates") params.set("date", dateFilter);
    if (tableSortBy !== "created_at") params.set("sortBy", tableSortBy);
    if (tableSortDir !== "desc") params.set("sortDir", tableSortDir);
    if (tablePage > 0) params.set("page", String(tablePage + 1));
    if (tableRowsPerPage !== 25) params.set("rows", String(tableRowsPerPage));
    if (view !== "table") params.set("view", view);
    const visibleKeys = REPAIR_COLUMNS.filter((c) => visibleColumns[c.key]).map((c) => c.key);
    const allVisible = visibleKeys.length === REPAIR_COLUMNS.length;
    if (!allVisible) params.set("vc", visibleKeys.join(","));
    setSearchParams(params, { replace: true });
  }, [
    query,
    statusFilter,
    techFilter,
    priorityFilter,
    dateFilter,
    tableSortBy,
    tableSortDir,
    tablePage,
    tableRowsPerPage,
    view,
    visibleColumns,
    setSearchParams,
  ]);

  useEffect(() => {
    if (!sortedRepairs.length) {
      setActiveRowIndex(0);
      return;
    }
    if (activeRowIndex > sortedRepairs.length - 1) setActiveRowIndex(0);
  }, [sortedRepairs, activeRowIndex]);

  useEffect(() => {
    setTablePage(0);
  }, [filtered]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() === "n" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        setShowCreate(true);
      }
      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key.toLowerCase() === "j" && sortedRepairs.length) {
        e.preventDefault();
        setActiveRowIndex((i) => Math.min(i + 1, sortedRepairs.length - 1));
      }
      if (e.key.toLowerCase() === "k" && sortedRepairs.length) {
        e.preventDefault();
        setActiveRowIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && sortedRepairs[activeRowIndex] && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        showDetails(sortedRepairs[activeRowIndex]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sortedRepairs, activeRowIndex]);

  const handleSort = (key) => {
    if (tableSortBy === key) {
      setTableSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setTableSortBy(key);
    setTableSortDir(key === "created_at" ? "desc" : "asc");
  };

  const toggleColumn = (key) => {
    setVisibleColumns((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const openRowMenu = (event, repair) => {
    setRowMenuAnchor(event.currentTarget);
    setRowMenuRepair(repair);
  };

  const closeRowMenu = () => {
    setRowMenuAnchor(null);
    setRowMenuRepair(null);
  };

  const cycleStatus = async (repair) => {
    const order = ["pending", "diagnosing", "waiting_for_approval", "waiting_for_parts", "repairing", "quality_checking", "completed", "delivered"];
    const idx = order.indexOf(normalizeStatus(repair.status));
    const next = order[(idx + 1) % order.length];
    try {
      await api.put(`/repairs/${repair.id}/status?status=${encodeURIComponent(next)}&note=${encodeURIComponent("Status updated from quick action")}`);
      setData((data || []).map((r) => (r.id === repair.id ? { ...r, status: next } : r)));
      toast(`Moved to ${statusLabel(next)}`, "success");
    } catch {
      toast("Failed to update status", "error");
    }
  };

  const bulkStatusUpdate = async (targetStatus) => {
    if (!selectedRows.length) return toast("Select at least one ticket", "warning");
    const ok = await confirm("Bulk Update", `Update ${selectedRows.length} tickets to ${targetStatus}?`);
    if (!ok) return;
    try {
      await Promise.all(selectedRows.map((id) =>
        api.put(`/repairs/${id}/status?status=${encodeURIComponent(targetStatus)}&note=${encodeURIComponent("Bulk status update")}`)
      ));
      setData((data || []).map((r) => (selectedRows.includes(r.id) ? { ...r, status: targetStatus } : r)));
      setSelectedRows([]);
      toast(`Updated ${selectedRows.length} tickets`, "success");
    } catch {
      toast("Bulk update failed", "error");
    }
  };

  const assignTechnicianBulk = async (technicianUserId) => {
    if (!selectedRows.length) return toast("Select at least one ticket", "warning");
    const technician = technicians.find((t) => String(t.id) === String(technicianUserId));
    try {
      const { data: res } = await api.post("/repairs/assign-technician/bulk", {
        repair_ids: selectedRows,
        technician_user_id: Number(technicianUserId),
      });
      const updatedIds = new Set(res?.updated_ids || selectedRows);
      setData((data || []).map((r) => (
        updatedIds.has(r.id)
          ? { ...r, technician: technician?.full_name || r.technician, assigned_technician_user_id: Number(technicianUserId) }
          : r
      )));
      toast(`Assigned technician to ${updatedIds.size} repair(s)`, "success");
      setSelectedRows([]);
    } catch (err) {
      toast(err?.response?.data?.detail || "Failed to assign technician", "error");
    }
  };

  const stats = useMemo(() => {
    const rows = data || [];
    const today = new Date().toISOString().split("T")[0];
    return {
      pending: rows.filter((r) => normalizeStatus(r.status) === "pending").length,
      active: rows.filter((r) => ["repairing", "diagnosing", "waiting_for_parts", "waiting_for_approval", "quality_checking"].includes(normalizeStatus(r.status))).length,
      ready: rows.filter((r) => normalizeStatus(r.status) === "completed").length,
      completedToday: rows.filter((r) => ["completed", "delivered"].includes(normalizeStatus(r.status)) && String(r.updated_at || r.created_at || "").startsWith(today)).length,
    };
  }, [data]);

  const selectedPartsTotal = useMemo(
    () => (parts || []).reduce((sum, part) => sum + Number(part.quantity || 0) * Number(part.unit_cost || 0), 0),
    [parts]
  );
  const selectedLabor = Number(selectedRepair?.estimated_cost || 0);
  const selectedDeposit = Number(selectedRepair?.advance_payment || 0);
  const selectedEstimateTotal = selectedLabor + selectedPartsTotal;
  const selectedBalanceDue = Math.max(0, selectedEstimateTotal - selectedDeposit);

  const statusPillCounts = useMemo(() => {
    const rows = data || [];
    return [
      { label: "All", count: rows.length, filterValue: "All Status", tone: "all" },
      { label: "Pending", count: rows.filter((r) => normalizeStatus(r.status) === "pending").length, filterValue: "Pending", tone: "pending" },
      {
        label: "In Progress",
        count: rows.filter((r) => ["diagnosing", "repairing", "waiting_for_parts", "waiting_for_approval", "quality_checking"].includes(normalizeStatus(r.status))).length,
        filterValue: "In Progress",
        tone: "inprogress",
      },
      { label: "Ready", count: rows.filter((r) => normalizeStatus(r.status) === "completed").length, filterValue: "Ready for Pickup", tone: "ready" },
      { label: "Completed", count: rows.filter((r) => normalizeStatus(r.status) === "delivered").length, filterValue: "Completed", tone: "completed" },
      { label: "Cancelled", count: rows.filter((r) => normalizeStatus(r.status) === "cancelled").length, filterValue: "Cancelled", tone: "cancelled" },
    ];
  }, [data]);

  if (loading) return <div className="animate-pulse p-8"><div className="h-10 w-64 bg-white/5 rounded-lg mb-8" /><div className="grid grid-cols-4 gap-4 mb-8">{[1,2,3,4].map(i => <div key={i} className="h-32 bg-white/5 rounded-2xl" />)}</div></div>;
  if (error) return <div className="text-rose-400 p-8 flex items-center gap-3 bg-rose-500/10 rounded-2xl border border-rose-500/20"><MoreVertical className="rotate-90" /> {error}</div>;

  return (
    <div className="min-h-0 pb-4 pr-1">
    <div className={`repairs-management-page min-h-0 flex flex-col gap-5 animate-in fade-in duration-700 ${isCompactHeight ? "is-compact-height" : ""}`}>
      <div className="repairs-header flex flex-wrap items-start xl:items-center justify-between gap-4">
        <PageTitle title="Repair Management" subtitle="Track repair jobs, technicians, parts, and customer updates." />
        <div className="flex items-center gap-3">
          <div className="flex items-center p-1 bg-white/5 rounded-xl border border-white/10">
            <button onClick={() => setView("table")} className={`p-2 rounded-lg transition-all ${view === 'table' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}><List size={18} /></button>
            <button onClick={() => setView("kanban")} className={`p-2 rounded-lg transition-all ${view === 'kanban' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}><LayoutGrid size={18} /></button>
          </div>
          <Button onClick={() => setShowCreate(true)} className="repairs-primary-action flex items-center gap-2 px-6"><Plus size={18} /> Create Repair Job</Button>
        </div>
      </div>

      {!isCompactHeight && (
        <div className="repairs-kpi-grid grid grid-cols-12 gap-3">
          <KpiCard className="col-span-12 md:col-span-6 xl:col-span-3" tone="sky" title="Pending Repairs" value={String(stats.pending)} hint="Awaiting technician action" icon={<ClipboardList size={20} />} />
          <KpiCard className="col-span-12 md:col-span-6 xl:col-span-3" tone="amber" title="In Progress" value={String(stats.active)} hint="Diagnosing / Repairing" icon={<Loader2 size={20} />} />
          <KpiCard className="col-span-12 md:col-span-6 xl:col-span-3" tone="indigo" title="Ready for Pickup" value={String(stats.ready)} hint="Completed repairs" icon={<Wrench size={20} />} />
          <KpiCard className="col-span-12 md:col-span-6 xl:col-span-3" tone="green" title="Completed Today" value={String(stats.completedToday)} hint="Closed tickets today" icon={<CheckCircle2 size={20} />} />
        </div>
      )}

      <div className="repairs-workspace-grid min-h-0 flex-1 grid grid-cols-12 gap-4">
      <div className={`${detailsVisible ? "col-span-12 xl:col-span-8" : "col-span-12"} repairs-jobs-panel min-h-0 bg-[#12182a]/60 backdrop-blur-xl border border-white/5 rounded-xl overflow-hidden shadow-2xl flex flex-col`}>
        <div className={`repairs-jobs-toolbar border-b border-white/5 bg-white/[0.01] ${isCompactHeight ? "p-4 space-y-3" : "p-6 space-y-5"}`}>
          <div className="repairs-jobs-title-row flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-2xl font-black tracking-tight text-white">Repair Jobs</h3>
            <div className="repairs-status-strip flex flex-nowrap xl:flex-wrap overflow-x-auto xl:overflow-visible items-center gap-2 text-[11px] font-bold text-slate-400 pb-1">
              {statusPillCounts.map((pill) => (
                <button
                  key={pill.label}
                  type="button"
                  onClick={() => setStatusFilter(pill.filterValue)}
                  className={`repair-status-tab tone-${pill.tone} inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 transition ${statusFilter === pill.filterValue ? "is-active" : ""}`}
                >
                  <span>{pill.label}</span>
                  <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] text-slate-200">{pill.count}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="repairs-toolbar-row flex flex-wrap items-center justify-between gap-3">
            <div className="relative group flex-1 min-w-[220px] xl:min-w-[280px] w-full xl:max-w-[620px]">
              <Search className="absolute left-4 top-3.5 text-slate-500 group-focus-within:text-indigo-400 transition-colors" size={18} />
              <input 
                ref={searchInputRef}
                className={`w-full bg-[#0f172a] border border-white/10 rounded-xl pl-12 pr-4 text-sm text-white focus:outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/15 transition-all ${isCompactHeight ? "py-2.5" : "py-3"}`}
                placeholder="Search ticket, customer, device..."
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>
            <div className="repairs-filter-row flex flex-wrap items-center gap-2">
              <AppSelect
                className="repair-select h-11 min-w-[140px] max-w-[190px] !w-auto"
                value={techFilter}
                onChange={(e) => setTechFilter(e.target.value)}
                options={technicianFilterOptions}
                minWidth={140}
                maxWidth={190}
              />
              <AppSelect
                className="repair-select h-11 min-w-[130px] max-w-[170px] !w-auto"
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                options={priorityFilterOptions}
                minWidth={130}
                maxWidth={170}
              />
              <AppSelect
                className="repair-select h-11 min-w-[130px] max-w-[170px] !w-auto"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                options={dateFilterOptions}
                minWidth={130}
                maxWidth={170}
              />
            </div>
          </div>

          <div className="repairs-actions-row flex flex-wrap items-center justify-end gap-3">
             <div className="repairs-quick-actions flex flex-wrap items-center gap-2">
               {!detailsVisible && (
                 <button
                   onClick={() => setDetailsVisible(true)}
                   className="px-3 h-9 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-200 text-[11px] font-bold transition"
                 >
                   Show Details
                 </button>
               )}
               <button 
                  onClick={() => {
                    const csv = [
                      ["Ticket", "Customer", "Phone", "Device", "Issue", "Technician", "Cost", "Status", "Date"].join(","),
                      ...filtered.map(r => [r.ticket_no, r.customer_name, r.customer_phone, r.device_model, r.issue, r.technician, r.estimated_cost, r.status, r.created_at].join(","))
                    ].join("\n");
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `repairs_export_${new Date().toISOString().split('T')[0]}.csv`;
                    a.click();
                  }}
                  className="px-3 h-9 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-[11px] font-bold transition"
                >
                  Export CSV
                </button>
               <button onClick={() => bulkStatusUpdate("repairing")} className="px-3 h-9 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-200 text-[11px] font-bold transition">Bulk Repairing</button>
               <button onClick={() => bulkStatusUpdate("completed")} className="px-3 h-9 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 text-[11px] font-bold transition">Bulk Complete</button>
              <AppSelect
                 className="repair-select h-10 min-w-[150px] max-w-[220px] !w-auto"
                 value=""
                 onChange={(e) => e.target.value && assignTechnicianBulk(e.target.value)}
                 options={bulkTechOptions}
                 placeholder="Assign Tech (bulk)"
                 minWidth={150}
                 maxWidth={220}
               />
               <button
                 onClick={(e) => setColumnsMenuAnchor(e.currentTarget)}
                 className="px-3 h-9 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-[11px] font-bold transition"
               >
                 Columns
               </button>
             </div>
          </div>
        </div>

        <div className="min-h-0 flex-1">
        {view === "kanban" ? (
          <div className="h-full overflow-auto custom-scrollbar p-8">
             <RepairKanban repairs={filtered} onStatusChange={async (id, status) => {
               try {
                 await api.put(`/repairs/${id}/status?status=${encodeURIComponent(status)}&note=${encodeURIComponent("Moved in board view")}`);
                 setData((data || []).map((r) => (r.id === id ? { ...r, status: normalizeStatus(status) } : r)));
                 toast(`Moved to ${statusLabel(status)}`, "success");
               } catch {
                 toast("Failed to move ticket", "error");
               }
             }} onViewDetails={showDetails} />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="repairs-table-shell flex min-h-0 flex-1 flex-col overflow-hidden">
              <AppTableShell minWidth={1120} className="rounded-none border-0">
                <AppTableHead>
                  <tr>
                    <th className="w-12 px-3 py-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-white/20 bg-black/30 accent-indigo-500"
                        checked={sortedRepairs.length > 0 && selectedRows.length === sortedRepairs.length}
                        onChange={(e) => setSelectedRows(e.target.checked ? sortedRepairs.map((r) => r.id) : [])}
                        aria-label="Select all repair tickets"
                      />
                    </th>
                    {visibleRepairColumns.map(({ key, label, sortable }) => (
                      <th key={key} className="px-3 py-3 text-left">
                        {!sortable ? label : (
                          <button
                            type="button"
                            onClick={() => handleSort(key)}
                            className="inline-flex items-center gap-1 font-black uppercase tracking-widest text-slate-500 hover:text-slate-300"
                          >
                            {label}
                            {tableSortBy === key ? <span className="text-[9px] text-indigo-300">{tableSortDir === "asc" ? "Asc" : "Desc"}</span> : null}
                          </button>
                        )}
                      </th>
                    ))}
                    <th className="px-3 py-3 text-right">Actions</th>
                  </tr>
                </AppTableHead>
                <tbody className="divide-y divide-white/5">
                  {pagedRepairs.map((r, idx) => {
                    const createdDays = Math.floor((Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24));
                    const overdue = !["completed", "delivered", "cancelled"].includes(normalizeStatus(r.status)) && createdDays > 3;
                    const balance = Math.max(0, (r.estimated_cost || 0) - (r.advance_payment || 0));
                    const rowGlobalIndex = tablePage * tableRowsPerPage + idx;
                    return (
                      <tr key={r.id} className={`${rowGlobalIndex === activeRowIndex ? "bg-indigo-500/10" : ""} hover:bg-white/[0.03]`}>
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-white/20 bg-black/30 accent-indigo-500"
                            checked={selectedRows.includes(r.id)}
                            onChange={(e) => setSelectedRows(e.target.checked ? [...selectedRows, r.id] : selectedRows.filter(id => id !== r.id))}
                            aria-label={`Select repair ticket ${r.ticket_no}`}
                          />
                        </td>
                        {visibleColumns.ticket_no && <td className="cursor-pointer px-3 py-3 font-black text-indigo-300" onClick={() => showDetails(r)}>#{r.ticket_no}</td>}
                        {visibleColumns.customer_name && <td className="px-3 py-3 font-bold text-slate-100">{r.customer_name || "-"}</td>}
                        {visibleColumns.customer_phone && <td className="px-3 py-3 text-slate-400">{r.customer_phone || "077-xxx-xxxx"}</td>}
                        {visibleColumns.device_model && <td className="px-3 py-3 font-bold text-violet-200">{r.device_model}</td>}
                        {visibleColumns.issue && <td className="max-w-[180px] truncate px-3 py-3 text-slate-300">{r.issue}</td>}
                        {visibleColumns.priority && (
                          <td className="px-3 py-3">
                            <Badge tone={r.priority === "Urgent" ? "red" : r.priority === "High" ? "amber" : r.priority === "Low" ? "sky" : "slate"}>{(r.priority || "Normal").toUpperCase()}</Badge>
                          </td>
                        )}
                        {visibleColumns.sla && <td className="px-3 py-3">{overdue ? <span className="inline-flex items-center gap-1 text-[11px] font-black text-rose-400"><AlertTriangle size={12} />Overdue {createdDays}d</span> : <span className="text-[11px] font-bold text-emerald-400">Due in {Math.max(0, 3 - createdDays)}</span>}</td>}
                        {visibleColumns.technician && <td className="px-3 py-3 font-semibold text-slate-200">{r.technician || "-"}</td>}
                        {visibleColumns.estimated_cost && <td className="px-3 py-3 font-bold text-slate-100">Rs. {(r.estimated_cost || 0).toLocaleString()}</td>}
                        {visibleColumns.advance_payment && <td className="px-3 py-3 font-bold text-indigo-300">Rs. {(r.advance_payment || 0).toLocaleString()}</td>}
                        {visibleColumns.balance && <td className="px-3 py-3 font-black text-rose-300">Rs. {balance.toLocaleString()}</td>}
                        {visibleColumns.status && (
                          <td className="px-3 py-3">
                            <button type="button" onClick={() => openStatusModal(r)}>
                              <Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge>
                            </button>
                          </td>
                        )}
                        {visibleColumns.created_at && <td className="px-3 py-3 font-bold text-slate-400">{new Date(r.created_at).toISOString().split('T')[0]}</td>}
                        {visibleColumns.parts && <td className="px-3 py-3">{normalizeStatus(r.status) === "waiting_for_parts" ? <Badge tone="amber">Waiting Parts</Badge> : <Badge tone="green">Parts Ready</Badge>}</td>}
                        <td className="px-3 py-3 text-right">
                          <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                            <button type="button" onClick={() => cycleStatus(r)} className="grid h-8 w-8 place-items-center rounded-lg text-indigo-300 hover:bg-indigo-500/15" title="Quick status">
                              <CheckCheck size={14} />
                            </button>
                            <button type="button" onClick={(e) => openRowMenu(e, r)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white" title="Actions">
                              <MoreVertical size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {pagedRepairs.length === 0 ? (
                    <AppTableEmptyRow colSpan={visibleRepairColumns.length + 2} title="No repair tickets found" text="Change the current filters or create a new repair ticket." />
                  ) : null}
                </tbody>
              </AppTableShell>

              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-3 text-xs text-slate-400">
                <div>
                  Showing <span className="font-bold text-slate-200">{tableRangeStart}</span>-<span className="font-bold text-slate-200">{tableRangeEnd}</span> of <span className="font-bold text-slate-200">{sortedRepairs.length}</span>
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
                    {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
                  <button type="button" onClick={() => setTablePage((value) => Math.max(0, value - 1))} disabled={tablePage === 0} className="rounded-lg border border-white/10 px-3 py-1.5 font-bold text-slate-300 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-white/10">
                    Previous
                  </button>
                  <span className="min-w-16 text-center font-bold text-slate-300">{tablePage + 1} / {tablePageCount}</span>
                  <button type="button" onClick={() => setTablePage((value) => Math.min(tablePageCount - 1, value + 1))} disabled={tablePage >= tablePageCount - 1} className="rounded-lg border border-white/10 px-3 py-1.5 font-bold text-slate-300 disabled:cursor-not-allowed disabled:opacity-40 hover:bg-white/10">
                    Next
                  </button>
                </div>
              </div>
            </div>

            <Menu
              anchorEl={columnsMenuAnchor}
              open={Boolean(columnsMenuAnchor)}
              onClose={() => setColumnsMenuAnchor(null)}
              PaperProps={{ sx: { bgcolor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0" } }}
            >
              {REPAIR_COLUMNS.map((col) => (
                <MenuItem key={col.key} onClick={() => toggleColumn(col.key)} sx={{ gap: 1 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(visibleColumns[col.key])}
                    readOnly
                    className="h-4 w-4 rounded border-white/20 bg-black/30 accent-indigo-500"
                  />
                  {col.label}
                </MenuItem>
              ))}
            </Menu>
            <Menu
              anchorEl={rowMenuAnchor}
              open={Boolean(rowMenuAnchor)}
              onClose={closeRowMenu}
              PaperProps={{ sx: { bgcolor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0" } }}
            >
              <MenuItem onClick={() => { if (rowMenuRepair) showDetails(rowMenuRepair); closeRowMenu(); }}>View Details</MenuItem>
              <MenuItem onClick={() => { if (rowMenuRepair) openStatusModal(rowMenuRepair); closeRowMenu(); }}>Update Status</MenuItem>
              <MenuItem onClick={() => { if (rowMenuRepair) cancelRepair(rowMenuRepair); closeRowMenu(); }}>Cancel Repair</MenuItem>
              <MenuItem onClick={() => { if (rowMenuRepair) notify(rowMenuRepair); closeRowMenu(); }}>Notify Customer</MenuItem>
              <MenuItem onClick={() => { if (rowMenuRepair) printTicket(rowMenuRepair); closeRowMenu(); }}>Print Job Card</MenuItem>
            </Menu>
          </div>
        )}
        </div>
      </div>

        {detailsVisible && (
        <aside className="col-span-12 xl:col-span-4 repairs-detail-panel min-h-0 bg-[#12182a]/60 backdrop-blur-xl border border-white/5 rounded-xl overflow-hidden shadow-2xl flex flex-col">
          <div className="repairs-detail-header border-b border-white/5 bg-white/[0.02] p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="truncate text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                {selectedRepair ? `R-2025-${String(selectedRepair.ticket_no || "").padStart(4, "0")}` : "Repair Details"}
              </p>
              <button
                type="button"
                onClick={() => setDetailsVisible(false)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-slate-300 transition hover:border-indigo-400/40 hover:text-white"
                title="Close details bar"
              >
                <X size={15} />
                <span className="hidden 2xl:inline">Close</span>
              </button>
            </div>

            {selectedRepair ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-3xl font-black tracking-tight text-white">R-2025-{String(selectedRepair.ticket_no || "").padStart(4, "0")}</h3>
                    <p className="mt-1 text-xs font-semibold text-slate-400">{selectedRepair.device_model}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={statusTone(selectedRepair.status)} className="px-2 py-1 text-[9px] font-black tracking-wider uppercase">
                      {statusLabel(selectedRepair.status)}
                    </Badge>
                    <button
                      type="button"
                      onClick={() => setSelectedRepair(null)}
                      className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5 text-slate-400 transition hover:text-white"
                      title="Clear selection"
                    >
                      x
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs font-semibold">
                  <button className="rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-2 py-1 text-indigo-200">Details</button>
                  <button className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-slate-400">History</button>
                  <button className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-slate-400">Notes</button>
                  <button className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-slate-400">Files</button>
                </div>
              </>
            ) : (
              <div>
                <h3 className="text-xl font-black tracking-tight text-white">Repair Details</h3>
                <p className="mt-1 text-sm text-slate-400">Select a ticket from the table to preview full job details.</p>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 custom-scrollbar">
            {!selectedRepair && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-400">
                No repair selected. Click any row in the repair jobs table.
              </div>
            )}

            {selectedRepair && (
              <>
                <section className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Customer Information</p>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                    <p className="text-sm font-bold text-slate-200">{selectedRepair.customer_name || "Walk-in Customer"}</p>
                    <p className="mt-1 text-xs text-slate-400">{selectedRepair.customer_phone || "No phone"}</p>
                    <p className="text-xs text-slate-500">{selectedRepair.customer_email || "No email"}</p>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => selectedRepair.customer_phone && window.open(`tel:${selectedRepair.customer_phone}`, "_self")}
                        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs font-bold text-slate-200 transition hover:border-indigo-400/40"
                      >
                        Call
                      </button>
                      <button
                        type="button"
                        onClick={() => selectedRepair.customer_phone && window.open(`sms:${selectedRepair.customer_phone}`, "_self")}
                        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs font-bold text-slate-200 transition hover:border-indigo-400/40"
                      >
                        SMS
                      </button>
                      <button
                        type="button"
                        onClick={() => selectedRepair.customer_phone && window.open(`https://wa.me/${String(selectedRepair.customer_phone).replace(/\D/g, "")}`, "_blank")}
                        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs font-bold text-slate-200 transition hover:border-indigo-400/40"
                      >
                        WhatsApp
                      </button>
                    </div>
                  </div>
                </section>

                <section className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Device Information</p>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-1.5">
                    <p className="text-sm font-bold text-slate-200">{selectedRepair.device_model}</p>
                    <p className="text-xs text-slate-400">IMEI/Serial: {selectedRepair.imei || "N/A"}</p>
                    <p className="text-xs text-slate-400">Priority: {selectedRepair.priority || "Normal"}</p>
                    <p className="text-xs text-slate-400">Status: {statusLabel(selectedRepair.status)}</p>
                  </div>
                </section>

                <section className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Problem Summary</p>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                    <p className="text-sm leading-relaxed text-slate-300">{selectedRepair.issue || "No issue description provided."}</p>
                  </div>
                </section>

                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Assigned Technician</p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openStatusModal(selectedRepair)}
                        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-slate-300 transition hover:border-indigo-400/40"
                      >
                        Update Status
                      </button>
                      {normalizeStatus(selectedRepair.status) !== "cancelled" && (
                        <button
                          type="button"
                          onClick={() => cancelRepair(selectedRepair)}
                          className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-rose-200 transition hover:bg-rose-500/20"
                        >
                          Cancel Repair
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                    <p className="text-sm font-bold text-slate-200">{selectedRepair.technician || "Unassigned"}</p>
                  </div>
                </section>

                <section className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Parts Used</p>
                  <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                    <div className="flex gap-2">
                      <Select
                        className="h-10 flex-1"
                        value={selectedPart.item_id}
                        onChange={(e) => setSelectedPart({ ...selectedPart, item_id: e.target.value })}
                        disabled={["pending", "diagnosing"].includes(normalizeStatus(selectedRepair?.status))}
                      >
                        <option value="">Select part...</option>
                        {inventory.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} ({item.quantity} in stock)
                          </option>
                        ))}
                      </Select>
                      <Input
                        type="number"
                        className="h-10 w-16 text-center"
                        value={selectedPart.quantity}
                        onChange={(e) => setSelectedPart({ ...selectedPart, quantity: Number(e.target.value) })}
                        disabled={["pending", "diagnosing"].includes(normalizeStatus(selectedRepair?.status))}
                      />
                      <Button
                        className="h-10 px-3"
                        onClick={addPart}
                        disabled={["pending", "diagnosing"].includes(normalizeStatus(selectedRepair?.status))}
                      >
                        <Plus size={14} />
                      </Button>
                    </div>
                    {["pending", "diagnosing"].includes(normalizeStatus(selectedRepair?.status)) && (
                      <p className="text-[10px] text-amber-500 font-semibold mt-1">
                        Parts can only be consumed once estimate is approved (status In Progress / Repairing).
                      </p>
                    )}

                    <div className="overflow-x-auto">
                      <Table className="table-sm w-full">
                        <thead>
                          <tr>
                            <th>Part</th>
                            <th className="text-center">Qty</th>
                            <th className="text-right">Price</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parts.slice(0, 5).map((part, index) => (
                            <tr key={`${part.item_name}-${index}`}>
                              <td className="text-xs text-slate-300">{part.item_name}</td>
                              <td className="text-center text-xs text-slate-400">{part.quantity}</td>
                              <td className="text-right text-xs font-bold text-slate-200">LKR {(Number(part.quantity || 0) * Number(part.unit_cost || 0)).toLocaleString()}</td>
                            </tr>
                          ))}
                          {!parts.length && (
                            <tr>
                              <td colSpan={3} className="py-4 text-center text-xs text-slate-500">
                                No parts added yet
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </Table>
                    </div>
                  </div>
                </section>

                <section className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Estimate & Charges</p>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-2 text-sm">
                    <div className="flex items-center justify-between text-slate-400"><span>Labor</span><span>LKR {selectedLabor.toLocaleString()}</span></div>
                    <div className="flex items-center justify-between text-slate-400"><span>Parts</span><span>LKR {selectedPartsTotal.toLocaleString()}</span></div>
                    <div className="flex items-center justify-between text-slate-400"><span>Advance</span><span>- LKR {selectedDeposit.toLocaleString()}</span></div>
                    <div className="h-px bg-white/10" />
                    <div className="flex items-center justify-between text-base font-black text-indigo-300"><span>Total Due</span><span>LKR {selectedBalanceDue.toLocaleString()}</span></div>
                    <div className="pt-2 flex flex-wrap gap-2">
                      <Button className="h-8 px-3 text-xs" onClick={collectRepairAdvance}>Collect Advance</Button>
                      <Button className="h-8 px-3 text-xs" variant="secondary" onClick={refundRepairAdvance}>Refund Advance</Button>
                    </div>
                  </div>
                </section>

                {!!repairAdvances.length && (
                  <section className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Advance History</p>
                    <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                      {repairAdvances.slice(0, 4).map((row) => (
                        <div key={row.id} className="border-b border-white/5 pb-2 last:border-b-0 last:pb-0">
                          <p className="text-xs font-bold text-sky-300">{row.advance_number}</p>
                          <p className="text-xs text-slate-300">
                            Paid: LKR {Number(row.amount || 0).toLocaleString()} | Remaining: LKR {Number(row.remaining_amount || 0).toLocaleString()}
                          </p>
                          <p className="text-[10px] text-slate-500">{row.status} | {row.payment_method}</p>
                          <div className="mt-1">
                            <Button className="h-7 px-2 text-[10px]" variant="secondary" onClick={() => printAdvanceReceipt(row.id)}>
                              Print Receipt
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {!!timeline.length && (
                  <section className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Recent Activity</p>
                    <div className="space-y-2 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                      {timeline.slice(0, 4).map((event, index) => (
                        <div key={`${event.created_at}-${index}`} className="border-b border-white/5 pb-2 last:border-b-0 last:pb-0">
                          <p className="text-xs font-bold text-slate-200">{event.status}</p>
                          {event.note && <p className="mt-0.5 text-xs text-slate-400">{event.note}</p>}
                          <p className="mt-1 text-[10px] text-slate-500">{new Date(event.created_at).toLocaleString()}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>

          {selectedRepair && (
            <div className="border-t border-white/5 bg-white/[0.02] p-4">
              <Button onClick={() => printTicket(selectedRepair)} className="w-full h-11 bg-indigo-500 hover:bg-indigo-600 shadow-lg shadow-indigo-500/25">
                Print Job Card
              </Button>
            </div>
          )}
        </aside>
        )}
      </div>

      <AppModal
        open={!!statusUpdateRepair}
        onClose={() => setStatusUpdateRepair(null)}
        title="Update Status"
        panelClassName="max-w-md"
      >
        {statusUpdateRepair && (
          <>
            <div className="border-b border-white/10 bg-white/[0.02] px-4 py-3 text-xs text-slate-500">
              Ticket #{statusUpdateRepair.ticket_no} - {statusUpdateRepair.device_model}
            </div>
            <div className="space-y-6 p-6">
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">New Status</p>
                <Select
                  value={statusForm.status}
                  onChange={e => setStatusForm({...statusForm, status: e.target.value})}
                  className="h-12"
                >
                  {REPAIR_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </Select>
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Progress Note</p>
                <textarea
                  className="w-full bg-[#0f172a] border border-white/10 rounded-2xl p-4 text-sm text-white focus:outline-none focus:border-indigo-500/50 min-h-[100px] resize-none"
                  placeholder="What's happening with this repair?"
                  value={statusForm.note}
                  onChange={e => setStatusForm({...statusForm, note: e.target.value})}
                />
              </div>
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  className="w-5 h-5 rounded-lg border-white/10 bg-white/5 text-indigo-500 focus:ring-indigo-500/20"
                  checked={statusForm.notify}
                  onChange={e => setStatusForm({...statusForm, notify: e.target.checked})}
                />
                <span className="text-sm font-bold text-slate-300 group-hover:text-white transition">Notify Customer via WhatsApp</span>
              </label>
            </div>
            <div className="flex gap-3 border-t border-white/10 bg-white/[0.02] p-4">
              <Button variant="secondary" onClick={() => setStatusUpdateRepair(null)} className="flex-1">Cancel</Button>
              <Button onClick={executeStatusUpdate} className="flex-1 bg-indigo-500 shadow-lg shadow-indigo-500/20">Update Repair</Button>
            </div>
          </>
        )}
      </AppModal>

      <AppModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Repair Ticket"
        panelClassName="max-w-2xl"
        headerActions={<button onClick={() => setShowCreate(false)} className="text-slate-500 hover:text-white transition"><X size={18} /></button>}
      >
            <div className="border-b border-white/10 bg-white/[0.02] px-4 py-3 text-xs text-slate-500">Register a new device for service</div>
            <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2">
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Customer</p>
                <Select value={form.customer_id} onChange={e => setForm({...form, customer_id: e.target.value})}>
                  <option value="">Walk-in / No customer</option>
                  <option value="new">+ Add new customer</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>)}
                </Select>
              </div>
              {form.customer_id === 'new' && (
                <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-3xl bg-white/5 border border-white/10">
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Customer Name</p>
                    <Input placeholder="Customer name" value={newCustomer.name} onChange={e => setNewCustomer({...newCustomer, name: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Phone</p>
                    <Input placeholder="Phone number" value={newCustomer.phone} onChange={e => setNewCustomer({...newCustomer, phone: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Email</p>
                    <Input placeholder="Email (optional)" value={newCustomer.email} onChange={e => setNewCustomer({...newCustomer, email: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Address</p>
                    <Input placeholder="Address (optional)" value={newCustomer.address} onChange={e => setNewCustomer({...newCustomer, address: e.target.value})} />
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Device Model</p>
                <Input placeholder="e.g. iPhone 15 Pro" value={form.device_model} onChange={e => setForm({...form, device_model: e.target.value})} />
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">IMEI / Serial</p>
                <Input placeholder="15-digit IMEI or SN" value={form.imei} onChange={e => setForm({...form, imei: e.target.value})} />
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Technician</p>
                <Select value={form.technician} onChange={e => setForm({...form, technician: e.target.value})}>
                  <option value="Ashan Perera">Ashan Perera (Manager)</option>
                  {technicians.filter(t => t.full_name !== "Ashan Perera").map(t => (
                    <option key={t.id} value={t.full_name}>{t.full_name}</option>
                  ))}
                </Select>
              </div>
              <div className="md:col-span-2 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Issue / Fault Description</p>
                <textarea 
                  className="w-full bg-[#0f172a] border border-white/10 rounded-2xl p-4 text-sm text-white focus:outline-none focus:border-indigo-500/50 min-h-[80px]"
                  placeholder="Describe the problem..."
                  value={form.issue}
                  onChange={e => setForm({...form, issue: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Estimated Labor Cost</p>
                <Input type="number" placeholder="0.00" value={form.estimated_cost} onChange={e => setForm({...form, estimated_cost: Number(e.target.value)})} />
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Advance Deposit</p>
                <Input type="number" placeholder="0.00" value={form.advance_payment || ''} onChange={e => setForm({...form, advance_payment: Number(e.target.value)})} className="border-indigo-500/50 focus:border-indigo-400 bg-indigo-500/10" />
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Priority</p>
                <Select value={form.priority} onChange={e => setForm({...form, priority: e.target.value})}>
                  {["Low", "Normal", "High", "Urgent"].map(p => <option key={p} value={p}>{p}</option>)}
                </Select>
              </div>
            </div>

            <div className="flex gap-3 border-t border-white/10 bg-white/[0.02] p-4">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowCreate(false);
                  setForm({ customer_id: '', device_model: '', imei: '', issue: '', technician: defaultTechnician, estimated_cost: 0, advance_payment: 0, notes: '', priority: 'Normal' });
                  setNewCustomer({ name: '', phone: '', email: '', address: '' });
                }}
                className="flex-1"
              >Discard</Button>
              <Button onClick={submit} className="flex-1 bg-indigo-500 shadow-lg shadow-indigo-500/20">Create Ticket</Button>
            </div>
      </AppModal>

    </div>
    </div>
  );
}

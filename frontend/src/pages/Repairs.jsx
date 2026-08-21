import { useMemo, useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useCachedQuery } from "../hooks/useCachedQuery";
import { apiService } from "../lib/apiService";
import api from "../lib/api";
import { openPrintCenter } from "../lib/printCenter";
import { useFeedback } from "../components/FeedbackProvider";
import { AppSelect, AppTableEmptyRow, AppTableHead, AppTableShell, Badge, Button, Input, KpiCard, PageHeader, PageTitle, Select, Table } from "../components/UI";
import AppModal from "../components/layout/AppModal";
import { Menu, MenuItem } from "@mui/material";
import {
  CheckCircle2, ClipboardList, Loader2, Wrench, LayoutGrid, List, Search,
  Plus, Filter, Clock, MoreVertical, Bell, AlertTriangle, UserCheck, Phone,
  CheckCheck, X, Sparkles, MessageSquare, Send, Smartphone, User, Mail,
  Calendar, DollarSign, RotateCcw, Printer, Info, Cpu, CreditCard, History,
  AlertCircle, ExternalLink, ShieldCheck, ChevronDown, Trash2
} from "lucide-react";
import { isValidLuhnIMEI } from "../lib/tableUtils";
import { toLocalIsoDate, formatDate, formatDateTime } from "../lib/dateParser";

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

const fetchRepairsList = () => apiService.repairs.list({ pageSize: 1000 });
const fetchCustomersList = () => apiService.customers.list({ pageSize: 1000 }).then(res => res.items);
const fetchInventoryList = () => apiService.inventory.list({ pageSize: 1000 }).then(res => res.items);
const fetchStaffList = () => apiService.staff.list().then(res => res.data);

export default function Repairs() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast, confirm, prompt } = useFeedback();
  const { data: repairsData, loading, error, refetch, setData: setCacheData } = useCachedQuery(
    "repairs",
    fetchRepairsList
  );
  const data = useMemo(() => {
    if (Array.isArray(repairsData)) return repairsData;
    if (Array.isArray(repairsData?.items)) return repairsData.items;
    return [];
  }, [repairsData]);
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

  const customersQuery = useCachedQuery("customers", fetchCustomersList);
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
  const [imeiIntelligence, setImeiIntelligence] = useState(null);
  const [checkingImei, setCheckingImei] = useState(false);
  const [diagnosingAI, setDiagnosingAI] = useState(false);
  const [aiDiagnosisResult, setAiDiagnosisResult] = useState(null);

  const runAIDiagnose = async () => {
    if (!form.issue.trim()) {
      toast("Please enter an issue description first", "warning");
      return;
    }
    setDiagnosingAI(true);
    try {
      const parts = (form.device_model || "").split(" ");
      const brand = parts[0] || "Unknown";
      const model = parts.slice(1).join(" ") || form.device_model || "Device";

      const res = await api.post("/api/ai/repair-diagnose", {
        device_brand: brand,
        device_model: model,
        issue_description: form.issue,
      });

      const data = res.data;
      setAiDiagnosisResult(data);

      // Auto-fill suggested labor cost if available
      if (data.estimated_cost && Number(data.estimated_cost) > 0) {
        setForm((prev) => ({
          ...prev,
          estimated_cost: Number(data.estimated_cost),
          notes: prev.notes ? `${prev.notes}\n[AI Diagnosis]: ${data.probable_cause}` : `[AI Diagnosis]: ${data.probable_cause}`
        }));
      }

      toast("AI Diagnosis complete!", "success");
    } catch (err) {
      toast("Failed to run AI diagnosis", "error");
    } finally {
      setDiagnosingAI(false);
    }
  };


  useEffect(() => {
    const clean = (form.imei || "").trim();
    if (clean.length < 5) {
      setImeiIntelligence(null);
      return;
    }
    const timer = setTimeout(async () => {
      setCheckingImei(true);
      try {
        const res = await api.get(`/inventory/serials/lookup-imei/${clean}`);
        setImeiIntelligence(res.data);
      } catch (e) {
        setImeiIntelligence(null);
      } finally {
        setCheckingImei(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [form.imei]);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '', address: '' });
  const [selectedRepair, setSelectedRepair] = useState(null);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [detailTab, setDetailTab] = useState("overview");
  const [timeline, setTimeline] = useState([]);
  const [parts, setParts] = useState([]);
  const [repairAdvances, setRepairAdvances] = useState([]);
  const inventoryQuery = useCachedQuery("inventory_minimal", fetchInventoryList);
  const inventory = inventoryQuery.data || [];
  const inventoryFetch = {
    data: inventory,
    refresh: () => inventoryQuery.refetch()
  };
  const [selectedPart, setSelectedPart] = useState({ item_id: '', quantity: 1 });
  const [partSourceMode, setPartSourceMode] = useState("inventory"); // "inventory" | "manual"
  const [partSearchQuery, setPartSearchQuery] = useState("");
  const [isPartDropdownOpen, setIsPartDropdownOpen] = useState(false);
  const [manualPart, setManualPart] = useState({ name: "", unit_cost: "", quantity: 1 });
  const partDropdownRef = useRef(null);
  const [priorityFilter, setPriorityFilter] = useState("All Priority");
  const [dateFilter, setDateFilter] = useState("All Dates");

  // AI SLA Risk Analyzer
  const [showSlaRiskModal, setShowSlaRiskModal] = useState(false);
  const [slaRiskLoading, setSlaRiskLoading] = useState(false);
  const [slaRiskData, setSlaRiskData] = useState(null);

  const fetchRepairSlaRisks = async () => {
    setShowSlaRiskModal(true);
    setSlaRiskLoading(true);
    try {
      const res = await api.get("/api/ai/repair-sla-risks");
      setSlaRiskData(res.data);
    } catch (err) {
      toast("Failed to analyze repair SLA risks", "error");
    } finally {
      setSlaRiskLoading(false);
    }
  };

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

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (partDropdownRef.current && !partDropdownRef.current.contains(e.target)) {
        setIsPartDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredInventoryParts = useMemo(() => {
    if (!partSearchQuery.trim()) return inventory.slice(0, 35);
    const q = partSearchQuery.toLowerCase().trim();
    return inventory
      .filter((item) =>
        (item.name || "").toLowerCase().includes(q) ||
        (item.sku || "").toLowerCase().includes(q) ||
        (item.category || "").toLowerCase().includes(q)
      )
      .slice(0, 35);
  }, [inventory, partSearchQuery]);

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

  const addInventoryPart = async () => {
    if (!selectedPart.item_id) return toast("Select a replacement part first", "warning");
    const currentStatus = normalizeStatus(selectedRepair?.status);
    if (currentStatus === "pending" || currentStatus === "diagnosing") {
      return toast("Parts can only be consumed once estimate is approved (In Progress / Repairing)", "warning");
    }
    const item = inventory.find(i => String(i.id) === String(selectedPart.item_id));
    if (item && item.quantity < (selectedPart.quantity || 1)) {
      return toast(`Insufficient stock for ${item.name} (${item.quantity} available)`, "warning");
    }
    try {
      const res = await api.post(`/repairs/${selectedRepair.id}/consume-part`, {
        item_id: Number(selectedPart.item_id),
        quantity: Number(selectedPart.quantity || 1)
      });
      const { data: updatedParts } = await api.get(`/repairs/${selectedRepair.id}/parts`);
      setParts(updatedParts);
      if (res.data?.estimated_cost !== undefined) {
        setSelectedRepair(prev => ({
          ...prev,
          estimated_cost: res.data.estimated_cost,
          outstanding_balance: res.data.outstanding_balance
        }));
      }
      setSelectedPart({ item_id: '', quantity: 1 });
      setPartSearchQuery("");
      setIsPartDropdownOpen(false);
      inventoryQuery.refetch();
      repairsQuery.refetch();
      toast("Part consumed from inventory & estimate updated", "success");
    } catch (err) {
      toast(err?.response?.data?.detail || "Failed to add part (check stock)", "error");
    }
  };

  const addManualPart = async () => {
    if (!manualPart.name.trim()) return toast("Please enter a part or material name", "warning");
    const currentStatus = normalizeStatus(selectedRepair?.status);
    if (currentStatus === "pending" || currentStatus === "diagnosing") {
      return toast("Parts can only be consumed once estimate is approved (In Progress / Repairing)", "warning");
    }
    const cost = parseFloat(manualPart.unit_cost) || 0;
    const qty = Math.max(1, parseInt(manualPart.quantity) || 1);
    try {
      const res = await api.post(`/repairs/${selectedRepair.id}/consume-part`, {
        custom_part_name: manualPart.name.trim(),
        unit_cost: cost,
        quantity: qty
      });
      const { data: updatedParts } = await api.get(`/repairs/${selectedRepair.id}/parts`);
      setParts(updatedParts);
      if (res.data?.estimated_cost !== undefined) {
        setSelectedRepair(prev => ({
          ...prev,
          estimated_cost: res.data.estimated_cost,
          outstanding_balance: res.data.outstanding_balance
        }));
      }
      setManualPart({ name: "", unit_cost: "", quantity: 1 });
      repairsQuery.refetch();
      toast("Manual part added to repair & estimate updated", "success");
    } catch (err) {
      toast(err?.response?.data?.detail || "Failed to add manual part", "error");
    }
  };

  const removePart = async (part) => {
    if (!part || !selectedRepair) return;
    const ok = await confirm("Remove Part?", `Remove "${part.item_name}" from this repair? If it came from inventory, stock will be returned.`);
    if (!ok) return;
    try {
      const res = await api.delete(`/repairs/${selectedRepair.id}/parts/${part.id}`);
      const { data: updatedParts } = await api.get(`/repairs/${selectedRepair.id}/parts`);
      setParts(updatedParts);
      if (res.data?.estimated_cost !== undefined) {
        setSelectedRepair(prev => ({
          ...prev,
          estimated_cost: res.data.estimated_cost,
          outstanding_balance: res.data.outstanding_balance
        }));
      }
      inventoryQuery.refetch();
      repairsQuery.refetch();
      toast(res.data?.message || "Part removed and stock returned.", "success");
    } catch (err) {
      toast(err?.response?.data?.detail || "Failed to remove part", "error");
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
      
      toast("Repair ticket created successfully", "success");
      
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
        if (selectedRepair?.id === statusUpdateRepair.id) {
          setSelectedRepair((prev) => ({ ...(prev || {}), ...res.repair }));
          const { data: tl } = await api.get(`/repairs/${statusUpdateRepair.id}/timeline`);
          setTimeline(tl || []);
        }
      } else {
        setData((data || []).map((r) => (r.id === statusUpdateRepair.id ? { ...r, status: statusForm.status } : r)));
      }
      
      setStatusUpdateRepair(null);
      if (statusForm.notify) {
        toast(`Status updated to ${statusLabel(statusForm.status)} and WhatsApp alert dispatched!`, "success");
      } else {
        toast(`Status updated to ${statusLabel(statusForm.status)}`, "success");
      }
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
    if (!r) return;
    const phone = r.customer_phone || r.phone;
    if (!phone) {
      return toast("No customer phone available for this repair ticket.", "warning");
    }

    const jobNo = r.ticket_no ? `REP-${r.ticket_no}` : `REP-${r.id}`;
    const device = r.device_model || "Device";
    const statusText = statusLabel(r.status);
    const balance = Number(r.outstanding_balance || r.estimated_cost || 0).toLocaleString();

    const msg = `*Repair Status Update - I-Store*\n\n` +
      `Hello ${r.customer_name || "Customer"},\n` +
      `Your repair ticket *#${jobNo}* (${device}) status is now: *${statusText}*.\n` +
      `Balance Due: LKR ${balance}\n\n` +
      `Thank you for trusting I-Store!`;

    try {
      const res = await api.post("/api/whatsapp/send-direct", {
        phone,
        message: msg,
        repair_no: jobNo,
        customer_id: r.customer_id ? Number(r.customer_id) : undefined,
        category: "repairs"
      });

      toast({
        title: "WhatsApp Repair Alert Dispatched",
        description: `Status update sent to ${r.customer_name || "Customer"} (${device})`,
        details: `Ticket: #${jobNo} • Status: ${statusText}`,
        tone: "success",
        iconType: "whatsapp",
        timeoutMs: 4500
      });
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || "Failed to dispatch WhatsApp notification.";
      toast({
        title: "WhatsApp Dispatch Failed",
        description: detail,
        tone: "error",
        timeoutMs: 5000
      });
    }
  };

  const sendPickupReminder = async (r) => {
    if (!r) return;
    try {
      await api.post(`/api/repairs/${r.id}/send-pickup-reminder`);
      toast({
        title: "Ready for Pickup Alert Dispatched",
        description: `Official collection notification with balance breakdown sent to ${r.customer_name || "Customer"}.`,
        tone: "success",
        iconType: "whatsapp",
        timeoutMs: 4500
      });
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || "Failed to dispatch pickup reminder.";
      toast({
        title: "Dispatch Failed",
        description: detail,
        tone: "error",
        timeoutMs: 5000
      });
    }
  };

  const staffQuery = useCachedQuery("staff", fetchStaffList);
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

    const q = searchParams.get("q") || searchParams.get("search");
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
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
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

    if (next === "delivered" && Number(repair.outstanding_balance || 0) > 0) {
      const ok = await confirm(
        "Outstanding Balance Due",
        `Ticket #${repair.ticket_no || repair.id} has an unpaid balance of LKR ${Number(repair.outstanding_balance).toLocaleString()}.\n\nDeliveries require payment settlement. Would you like to open POS to collect payment now?`
      );
      if (ok) {
        navigate(`/pos?mode=repair&ticket=${encodeURIComponent(repair.ticket_no || repair.id)}`);
      }
      return;
    }

    try {
      await api.put(`/repairs/${repair.id}/status?status=${encodeURIComponent(next)}&note=${encodeURIComponent("Status updated from quick action")}`);
      setData((data || []).map((r) => (r.id === repair.id ? { ...r, status: next } : r)));
      toast(`Moved to ${statusLabel(next)}`, "success");
    } catch (err) {
      const detail = err?.response?.data?.detail || "Failed to update status";
      toast(detail, "error");
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
    const today = toLocalIsoDate(new Date());
    return {
      pending: rows.filter((r) => normalizeStatus(r.status) === "pending").length,
      active: rows.filter((r) => ["repairing", "diagnosing", "waiting_for_parts", "waiting_for_approval", "quality_checking"].includes(normalizeStatus(r.status))).length,
      ready: rows.filter((r) => normalizeStatus(r.status) === "completed").length,
      completedToday: rows.filter((r) => ["delivered", "completed"].includes(normalizeStatus(r.status)) && toLocalIsoDate(r.delivered_at || r.updated_at || r.created_at) === today).length,
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
      <PageHeader
        eyebrow="Service & Repair Operations"
        title="Repair Management"
        subtitle="Track repair jobs, technicians, parts, and customer updates."
        action={
          <>
            <div className="flex items-center p-1 bg-white/5 rounded-xl border border-white/10">
              <button onClick={() => setView("table")} className={`p-2 rounded-lg transition-all ${view === 'table' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}><List size={18} /></button>
              <button onClick={() => setView("kanban")} className={`p-2 rounded-lg transition-all ${view === 'kanban' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-400 hover:text-white'}`}><LayoutGrid size={18} /></button>
            </div>
            <button
              type="button"
              onClick={fetchRepairSlaRisks}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-purple-600/30 to-indigo-600/30 border border-purple-500/40 hover:from-purple-600/40 hover:to-indigo-600/40 text-purple-200 text-xs font-bold transition shadow-lg shadow-purple-500/10"
            >
              <Sparkles size={14} className="text-purple-300 animate-pulse" />
              AI SLA Risk Alerts
            </button>
            <Button size="sm" onClick={() => setShowCreate(true)} className="repairs-primary-action flex items-center gap-2"><Plus size={16} /> Create Repair Job</Button>
          </>
        }
      />

      {!isCompactHeight && (
        <div className="repairs-kpi-grid grid grid-cols-12 gap-3">
          <KpiCard className="col-span-12 md:col-span-6 xl:col-span-3" tone="sky" title="Pending Repairs" value={String(stats.pending)} hint="Awaiting technician action" icon={<ClipboardList size={20} />} />
          <KpiCard className="col-span-12 md:col-span-6 xl:col-span-3" tone="amber" title="In Progress" value={String(stats.active)} hint="Diagnosing / Repairing" icon={<Loader2 size={20} />} />
          <KpiCard className="col-span-12 md:col-span-6 xl:col-span-3" tone="indigo" title="Ready for Pickup" value={String(stats.ready)} hint="Completed repairs" icon={<Wrench size={20} />} />
          <KpiCard className="col-span-12 md:col-span-6 xl:col-span-3" tone="green" title="Completed Today" value={String(stats.completedToday)} hint="Closed tickets today" icon={<CheckCircle2 size={20} />} />
        </div>
      )}

      <div className="repairs-workspace-grid min-h-0 flex-1 grid grid-cols-12 gap-4">
      <div className="col-span-12 repairs-jobs-panel min-h-0 bg-[#12182a]/60 backdrop-blur-xl border border-white/5 rounded-xl overflow-hidden shadow-2xl flex flex-col">
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
                    setTimeout(() => window.URL.revokeObjectURL(url), 1000);
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
                        {visibleColumns.created_at && <td className="px-3 py-3 font-bold text-slate-400">{formatDate(r.created_at)}</td>}
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
              slotProps={{ paper: { sx: { bgcolor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0" } } }}
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
              slotProps={{ paper: { sx: { bgcolor: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0" } } }}
            >
              <MenuItem onClick={() => { if (rowMenuRepair) showDetails(rowMenuRepair); closeRowMenu(); }}>View Details</MenuItem>
              <MenuItem onClick={() => { if (rowMenuRepair) { navigate(`/pos?mode=repair&ticket=${encodeURIComponent(rowMenuRepair.ticket_no || rowMenuRepair.id)}`); } closeRowMenu(); }}>
                Settle & Pay in POS
              </MenuItem>
              <MenuItem onClick={() => { if (rowMenuRepair) openStatusModal(rowMenuRepair); closeRowMenu(); }}>Update Status</MenuItem>
              <MenuItem onClick={() => { if (rowMenuRepair) sendPickupReminder(rowMenuRepair); closeRowMenu(); }}>Send Pickup Alert (WhatsApp)</MenuItem>
              <MenuItem onClick={() => { if (rowMenuRepair) notify(rowMenuRepair); closeRowMenu(); }}>Send Custom WhatsApp Alert</MenuItem>
              <MenuItem onClick={() => { if (rowMenuRepair) cancelRepair(rowMenuRepair); closeRowMenu(); }}>Cancel Repair</MenuItem>
              <MenuItem onClick={() => { if (rowMenuRepair) printTicket(rowMenuRepair); closeRowMenu(); }}>Print Job Card</MenuItem>
            </Menu>
          </div>
        )}
        </div>
      </div>
    </div>

      {/* ─── Centered Repair Details Modal Popup ─── */}
      <AppModal
        open={Boolean(selectedRepair && detailsVisible)}
        onClose={() => {
          setSelectedRepair(null);
          setDetailsVisible(false);
        }}
        panelClassName="max-w-4xl bg-[#0d1322] border-white/10 shadow-2xl"
        title={
          selectedRepair ? (
            <div className="space-y-1.5 py-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-400/30 bg-indigo-500/15 px-2.5 py-1 font-mono text-xs font-black text-indigo-300">
                  <Wrench size={13} /> #{selectedRepair.ticket_no || `JOB-${selectedRepair.id}`}
                </span>
                <Badge tone={statusTone(selectedRepair.status)} className="px-2.5 py-1 text-[11px] font-black uppercase tracking-wider">
                  {statusLabel(selectedRepair.status)}
                </Badge>
                {selectedRepair.priority && (
                  <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-bold uppercase text-slate-300">
                    {selectedRepair.priority} Priority
                  </span>
                )}
              </div>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
                {selectedRepair.device_model}
              </h2>
              <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap font-medium">
                <span>Registered: <strong className="text-slate-300">{formatDate(selectedRepair.created_at)}</strong></span>
                <span className="text-slate-600">•</span>
                <span>Assigned Tech: <strong className="text-indigo-300">{selectedRepair.technician || "Unassigned"}</strong></span>
              </div>
            </div>
          ) : null
        }
        headerActions={
          selectedRepair ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openStatusModal(selectedRepair)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-400/30 bg-indigo-500/20 px-3 py-1.5 text-xs font-bold text-indigo-200 transition hover:bg-indigo-500/30 cursor-pointer"
                title="Update status of this job"
              >
                <CheckCheck size={14} /> <span>Status</span>
              </button>
              <button
                type="button"
                onClick={() => notify(selectedRepair)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/20 px-3 py-1.5 text-xs font-bold text-emerald-200 transition hover:bg-emerald-500/30 cursor-pointer"
                title="Send direct WhatsApp update to customer"
              >
                <Send size={14} /> <span>WhatsApp</span>
              </button>
              <button
                type="button"
                onClick={() => printTicket(selectedRepair)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-300 transition hover:bg-white/10 hover:text-white cursor-pointer"
                title="Print physical repair ticket / job card"
              >
                <Printer size={14} /> <span>Print</span>
              </button>
            </div>
          ) : null
        }
        footer={
          selectedRepair ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
              <div className="flex items-center gap-2.5">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Balance Due</span>
                <span className="rounded-lg border border-indigo-500/30 bg-indigo-500/15 px-3 py-1 font-mono text-sm font-black text-indigo-300">
                  LKR {selectedBalanceDue.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {normalizeStatus(selectedRepair.status) !== "cancelled" && (
                  <button
                    type="button"
                    onClick={() => cancelRepair(selectedRepair)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-bold text-rose-300 transition hover:bg-rose-500/20 cursor-pointer"
                  >
                    <AlertTriangle size={14} /> Cancel Ticket
                  </button>
                )}
                <Button
                  onClick={() => {
                    setSelectedRepair(null);
                    setDetailsVisible(false);
                  }}
                  variant="secondary"
                  className="px-5 h-9 text-xs font-bold"
                >
                  Close
                </Button>
              </div>
            </div>
          ) : null
        }
      >
        {selectedRepair && (
          <div className="space-y-6 p-5 sm:p-6">
            {/* Segmented Navigation Tabs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-black/40 border border-white/10 rounded-xl">
              {[
                { id: "overview", label: "Overview & Diagnostics", icon: Info },
                { id: "parts", label: `Parts Consumed (${parts.length})`, icon: Cpu },
                { id: "financials", label: "Financials & Advances", icon: CreditCard },
                { id: "timeline", label: `Activity Log (${timeline.length})`, icon: History },
              ].map((tab) => {
                const Icon = tab.icon;
                const active = detailTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setDetailTab(tab.id)}
                    className={`flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold rounded-lg transition cursor-pointer ${
                      active
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30 border border-indigo-400/40"
                        : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                    }`}
                  >
                    <Icon size={14} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Tab 1: Overview */}
            {detailTab === "overview" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Customer Profile Card */}
                <div className="rounded-2xl border border-white/10 bg-[#121929]/80 p-5 space-y-4 shadow-lg">
                  <div className="flex items-center justify-between border-b border-white/5 pb-3">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                      <User size={15} className="text-indigo-400" />
                      <span>Customer Profile</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-base font-bold text-white">{selectedRepair.customer_name || "Walk-in Customer"}</p>
                    <p className="flex items-center gap-2 text-xs font-mono text-indigo-300">
                      <Phone size={13} className="text-indigo-400 shrink-0" />
                      <span>{selectedRepair.customer_phone || "No phone registered"}</span>
                    </p>
                    <p className="flex items-center gap-2 text-xs text-slate-400">
                      <Mail size={13} className="text-slate-500 shrink-0" />
                      <span>{selectedRepair.customer_email || "No email provided"}</span>
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/5">
                    <button
                      type="button"
                      onClick={() => selectedRepair.customer_phone && window.open(`tel:${selectedRepair.customer_phone}`, "_self")}
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 py-2 px-2 text-center text-xs font-bold text-slate-200 transition hover:border-sky-400/40 hover:bg-sky-500/10 cursor-pointer"
                    >
                      <Phone size={13} className="text-sky-400" />
                      <span>Call</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => selectedRepair.customer_phone && window.open(`sms:${selectedRepair.customer_phone}`, "_self")}
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 py-2 px-2 text-center text-xs font-bold text-slate-200 transition hover:border-amber-400/40 hover:bg-amber-500/10 cursor-pointer"
                    >
                      <MessageSquare size={13} className="text-amber-400" />
                      <span>SMS</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => notify(selectedRepair)}
                      className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/15 py-2 px-2 text-center text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/25 cursor-pointer"
                    >
                      <Send size={13} className="text-emerald-400" />
                      <span>WhatsApp</span>
                    </button>
                  </div>
                </div>

                {/* Device & Hardware Info Card */}
                <div className="rounded-2xl border border-white/10 bg-[#121929]/80 p-5 space-y-4 shadow-lg">
                  <div className="flex items-center justify-between border-b border-white/5 pb-3">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                      <Smartphone size={15} className="text-indigo-400" />
                      <span>Device & Hardware</span>
                    </div>
                  </div>
                  <div className="space-y-2.5 text-xs">
                    <div className="flex items-center justify-between border-b border-white/5 pb-2">
                      <span className="text-slate-400">Device Model</span>
                      <span className="font-bold text-white">{selectedRepair.device_model}</span>
                    </div>
                    <div className="flex items-center justify-between border-b border-white/5 pb-2">
                      <span className="text-slate-400">IMEI / Serial</span>
                      <span className="font-mono font-bold text-slate-200 bg-white/5 px-2 py-0.5 rounded border border-white/5">{selectedRepair.imei || "N/A"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Technician</span>
                      <span className="font-bold text-indigo-300 flex items-center gap-1.5">
                        <UserCheck size={13} /> {selectedRepair.technician || "Unassigned"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Problem Description Card */}
                <div className="col-span-1 md:col-span-2 rounded-2xl border border-white/10 bg-[#121929]/80 p-5 space-y-3 shadow-lg">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                    <AlertCircle size={15} className="text-amber-400" />
                    <span>Reported Problem & Diagnostics</span>
                  </div>
                  <div className="rounded-xl border border-white/5 bg-black/30 p-4 text-sm font-medium leading-relaxed text-slate-200">
                    {selectedRepair.issue || "No issue description provided during intake."}
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Parts */}
            {detailTab === "parts" && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-white/10 bg-[#121929]/80 p-5 space-y-4 shadow-lg">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-3">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                      <Cpu size={15} className="text-indigo-400" />
                      <span>Spare Parts & Inventory Consumption</span>
                    </div>

                    {/* Source Mode Toggle */}
                    <div className="inline-flex rounded-xl bg-black/40 p-1 border border-white/10">
                      <button
                        type="button"
                        onClick={() => setPartSourceMode("inventory")}
                        className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition ${
                          partSourceMode === "inventory"
                            ? "bg-indigo-600 text-white shadow"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        <Cpu size={13} />
                        <span>From Inventory</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPartSourceMode("manual")}
                        className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition ${
                          partSourceMode === "manual"
                            ? "bg-indigo-600 text-white shadow"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        <Plus size={13} />
                        <span>Manual / Custom Part</span>
                      </button>
                    </div>
                  </div>

                  {/* Mode 1: Searchable Dropdown from Inventory */}
                  {partSourceMode === "inventory" && (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                      {/* Searchable Select Combobox */}
                      <div className="relative flex-1 min-w-[280px]" ref={partDropdownRef}>
                        <div
                          onClick={() => {
                            if (!["pending", "diagnosing"].includes(normalizeStatus(selectedRepair?.status))) {
                              setIsPartDropdownOpen(true);
                            }
                          }}
                          className={`flex items-center justify-between gap-2 h-10 px-3.5 rounded-xl border bg-black/40 text-xs font-medium cursor-pointer transition ${
                            isPartDropdownOpen
                              ? "border-indigo-500 ring-2 ring-indigo-500/20"
                              : "border-white/10 hover:border-white/20"
                          } ${
                            ["pending", "diagnosing"].includes(normalizeStatus(selectedRepair?.status))
                              ? "opacity-50 cursor-not-allowed"
                              : ""
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <Search size={14} className="text-slate-400 shrink-0" />
                            {selectedPart.item_id ? (
                              (() => {
                                const sel = inventory.find((i) => String(i.id) === String(selectedPart.item_id));
                                return sel ? (
                                  <div className="flex items-center gap-2 truncate">
                                    <span className="font-bold text-white truncate">{sel.name}</span>
                                    <span className="text-[11px] text-emerald-400 font-mono">
                                      (LKR {Number(sel.sale_price || sel.cost_price || 0).toLocaleString()})
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-slate-400">Select replacement part...</span>
                                );
                              })()
                            ) : (
                              <span className="text-slate-400">Search replacement part from inventory...</span>
                            )}
                          </div>
                          {selectedPart.item_id ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedPart({ item_id: "", quantity: 1 });
                                setPartSearchQuery("");
                              }}
                              className="text-slate-400 hover:text-white p-0.5 rounded"
                            >
                              <X size={14} />
                            </button>
                          ) : (
                            <ChevronDown size={14} className="text-slate-400 shrink-0" />
                          )}
                        </div>

                        {/* Dropdown Floating Menu */}
                        {isPartDropdownOpen && (
                          <div className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl border border-indigo-500/30 bg-[#0c1222]/95 backdrop-blur-md shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                            <div className="p-2 border-b border-white/10 bg-black/30 flex items-center gap-2">
                              <Search size={13} className="text-indigo-400 shrink-0 ml-1" />
                              <input
                                type="text"
                                autoFocus
                                placeholder="Type part name, SKU, or category to filter..."
                                value={partSearchQuery}
                                onChange={(e) => setPartSearchQuery(e.target.value)}
                                className="w-full bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none"
                              />
                              {partSearchQuery && (
                                <button
                                  type="button"
                                  onClick={() => setPartSearchQuery("")}
                                  className="text-slate-400 hover:text-white"
                                >
                                  <X size={12} />
                                </button>
                              )}
                            </div>

                            <div className="max-h-60 overflow-y-auto custom-scrollbar divide-y divide-white/5">
                              {filteredInventoryParts.map((item) => {
                                const isSelected = String(selectedPart.item_id) === String(item.id);
                                const stock = item.quantity || 0;
                                return (
                                  <div
                                    key={item.id}
                                    onClick={() => {
                                      setSelectedPart({ ...selectedPart, item_id: item.id });
                                      setIsPartDropdownOpen(false);
                                    }}
                                    className={`flex items-center justify-between p-3 cursor-pointer transition text-xs ${
                                      isSelected ? "bg-indigo-600/25 text-white" : "hover:bg-white/5 text-slate-200"
                                    }`}
                                  >
                                    <div className="min-w-0 pr-2">
                                      <p className="font-bold text-white truncate">{item.name}</p>
                                      <p className="text-[11px] text-slate-400 font-mono">
                                        {item.sku ? `SKU: ${item.sku} • ` : ""}
                                        {item.category || "General"}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                      <span
                                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                          stock > 5
                                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                            : stock > 0
                                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                                            : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                                        }`}
                                      >
                                        {stock} in stock
                                      </span>
                                      <span className="font-mono font-bold text-indigo-300">
                                        LKR {Number(item.sale_price || item.cost_price || 0).toLocaleString()}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}

                              {!filteredInventoryParts.length && (
                                <div className="p-4 text-center text-xs text-slate-400 space-y-2">
                                  <p>No inventory parts match "{partSearchQuery}"</p>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPartSourceMode("manual");
                                      setManualPart({ ...manualPart, name: partSearchQuery });
                                      setIsPartDropdownOpen(false);
                                    }}
                                    className="text-xs font-bold text-indigo-400 hover:text-indigo-300 underline"
                                  >
                                    + Add as Manual / Custom Part instead
                                  </button>
                                </div>
                              )}
                            </div>

                            <div className="p-2 border-t border-white/10 bg-black/40 flex justify-between items-center text-[11px]">
                              <span className="text-slate-400">Showing {filteredInventoryParts.length} parts</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setPartSourceMode("manual");
                                  setIsPartDropdownOpen(false);
                                }}
                                className="text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1 cursor-pointer"
                              >
                                <Plus size={12} /> Add custom part
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Qty:</span>
                          <Input
                            type="number"
                            min="1"
                            className="h-10 w-20 text-center font-bold"
                            value={selectedPart.quantity}
                            onChange={(e) => setSelectedPart({ ...selectedPart, quantity: Math.max(1, Number(e.target.value)) })}
                            disabled={["pending", "diagnosing"].includes(normalizeStatus(selectedRepair?.status))}
                          />
                        </div>
                        <Button
                          className="h-10 px-4 flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 shrink-0"
                          onClick={addInventoryPart}
                          disabled={["pending", "diagnosing"].includes(normalizeStatus(selectedRepair?.status))}
                        >
                          <Plus size={14} /> <span>Add Part</span>
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Mode 2: Manual / Custom Part Entry */}
                  {partSourceMode === "manual" && (
                    <div className="rounded-xl border border-indigo-500/20 bg-indigo-950/20 p-3.5 space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-indigo-300 flex items-center gap-1.5">
                          <Plus size={14} /> Manual / Custom Part Entry
                        </span>
                        <span className="text-[11px] text-slate-400">Non-inventory items & third-party materials</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                        <div className="sm:col-span-6">
                          <Input
                            placeholder="Part / Material Name (e.g. OLED Screen Replacement)"
                            value={manualPart.name}
                            onChange={(e) => setManualPart({ ...manualPart, name: e.target.value })}
                            disabled={["pending", "diagnosing"].includes(normalizeStatus(selectedRepair?.status))}
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <Input
                            type="number"
                            placeholder="Unit Price (LKR)"
                            value={manualPart.unit_cost}
                            onChange={(e) => setManualPart({ ...manualPart, unit_cost: e.target.value })}
                            disabled={["pending", "diagnosing"].includes(normalizeStatus(selectedRepair?.status))}
                          />
                        </div>
                        <div className="sm:col-span-1">
                          <Input
                            type="number"
                            min="1"
                            className="text-center font-bold"
                            value={manualPart.quantity}
                            onChange={(e) => setManualPart({ ...manualPart, quantity: Math.max(1, Number(e.target.value)) })}
                            disabled={["pending", "diagnosing"].includes(normalizeStatus(selectedRepair?.status))}
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <Button
                            className="w-full h-10 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                            onClick={addManualPart}
                            disabled={["pending", "diagnosing"].includes(normalizeStatus(selectedRepair?.status))}
                          >
                            <Plus size={14} /> <span>Add</span>
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {["pending", "diagnosing"].includes(normalizeStatus(selectedRepair?.status)) && (
                    <div className="flex items-center gap-2 text-xs text-amber-300 font-medium bg-amber-500/10 border border-amber-500/20 p-3 rounded-xl">
                      <AlertCircle size={14} className="shrink-0 text-amber-400" />
                      <span>Spare parts can only be consumed once diagnosis is approved and repair work is underway (In Progress / Repairing).</span>
                    </div>
                  )}

                  <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/25">
                    <Table className="table-sm w-full">
                      <thead>
                        <tr>
                          <th>Part / Material</th>
                          <th className="text-center">Quantity</th>
                          <th className="text-right">Unit Price</th>
                          <th className="text-right">Total</th>
                          <th className="text-center w-12">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parts.map((part, index) => (
                          <tr key={`${part.item_name}-${index}`}>
                            <td className="text-xs font-medium text-slate-200">
                              <div className="flex items-center gap-2">
                                <span>{part.item_name}</span>
                                {part.is_manual && (
                                  <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-bold text-indigo-300 border border-indigo-500/30">
                                    Manual
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="text-center text-xs text-slate-400">{part.quantity}</td>
                            <td className="text-right text-xs text-slate-400">LKR {Number(part.unit_cost || 0).toLocaleString()}</td>
                            <td className="text-right text-xs font-bold text-slate-100">
                              LKR {(Number(part.quantity || 0) * Number(part.unit_cost || 0)).toLocaleString()}
                            </td>
                            <td className="text-center">
                              <button
                                type="button"
                                onClick={() => removePart(part)}
                                className="p-1 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
                                title="Remove part & return to stock"
                              >
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {!parts.length && (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-xs text-slate-500">
                              No spare parts or materials consumed for this job yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </Table>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 3: Financials */}
            {detailTab === "financials" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Financial Breakdown Card */}
                <div className="rounded-2xl border border-white/10 bg-[#121929]/80 p-5 space-y-4 shadow-lg">
                  <div className="flex items-center justify-between border-b border-white/5 pb-3">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                      <DollarSign size={15} className="text-emerald-400" />
                      <span>Charges & Cost Breakdown</span>
                    </div>
                  </div>
                  <div className="space-y-2.5 text-sm">
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Labor & Service Charge</span>
                      <span className="font-semibold text-slate-200 font-mono">LKR {selectedLabor.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Parts & Materials</span>
                      <span className="font-semibold text-slate-200 font-mono">LKR {selectedPartsTotal.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Advance Payments Paid</span>
                      <span className="font-semibold text-emerald-400 font-mono">- LKR {selectedDeposit.toLocaleString()}</span>
                    </div>
                    <div className="h-px bg-white/10 my-2" />
                    <div className="flex items-center justify-between text-lg font-black text-indigo-300">
                      <span>Balance Payable</span>
                      <span className="font-mono">LKR {selectedBalanceDue.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="pt-3 flex flex-wrap gap-2.5 border-t border-white/5">
                    {selectedBalanceDue > 0 && (
                      <Button
                        className="h-9 px-4 text-xs font-bold flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg"
                        onClick={() => {
                          setDetailsVisible(false);
                          navigate(`/pos?mode=repair&ticket=${encodeURIComponent(selectedRepair.ticket_no || selectedRepair.id)}`);
                        }}
                      >
                        <CreditCard size={14} /> <span>Settle & Pay in POS</span>
                      </Button>
                    )}
                    <Button className="h-9 px-4 text-xs font-bold flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500" onClick={collectRepairAdvance}>
                      <DollarSign size={14} /> <span>Collect Advance</span>
                    </Button>
                    <Button className="h-9 px-4 text-xs font-bold flex items-center gap-1.5" variant="secondary" onClick={refundRepairAdvance}>
                      <RotateCcw size={14} /> <span>Refund Advance</span>
                    </Button>
                  </div>
                </div>

                {/* Advance Payments History */}
                <div className="rounded-2xl border border-white/10 bg-[#121929]/80 p-5 space-y-4 shadow-lg">
                  <div className="flex items-center justify-between border-b border-white/5 pb-3">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                      <CreditCard size={15} className="text-sky-400" />
                      <span>Advance Receipt History</span>
                    </div>
                  </div>
                  {repairAdvances.length > 0 ? (
                    <div className="space-y-2.5 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                      {repairAdvances.map((row) => (
                        <div key={row.id} className="rounded-xl border border-white/5 bg-black/30 p-3.5 flex items-center justify-between">
                          <div className="space-y-0.5">
                            <p className="text-xs font-bold text-sky-300 font-mono">{row.advance_number}</p>
                            <p className="text-xs text-slate-200 font-medium">LKR {Number(row.amount || 0).toLocaleString()} • <span className="text-slate-400">{row.payment_method}</span></p>
                            <p className="text-[10px] text-slate-500">{formatDate(row.payment_date || row.created_at)}</p>
                          </div>
                          <Button className="h-7 px-2.5 text-[11px] font-bold flex items-center gap-1" variant="secondary" onClick={() => printAdvanceReceipt(row.id)}>
                            <Printer size={12} /> <span>Print</span>
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 py-10 text-center">No advance payments recorded for this job.</p>
                  )}
                </div>
              </div>
            )}

            {/* Tab 4: Timeline */}
            {detailTab === "timeline" && (
              <div className="rounded-2xl border border-white/10 bg-[#121929]/80 p-5 space-y-4 shadow-lg">
                <div className="flex items-center justify-between border-b border-white/5 pb-3">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                    <History size={15} className="text-indigo-400" />
                    <span>Repair Progress & Event History</span>
                  </div>
                </div>
                {timeline.length > 0 ? (
                  <div className="space-y-2.5 max-h-80 overflow-y-auto custom-scrollbar pr-1">
                    {timeline.map((event, index) => (
                      <div key={`${event.created_at}-${index}`} className="rounded-xl border border-white/5 bg-black/30 p-3.5 flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <span className="inline-block rounded-md border border-indigo-400/20 bg-indigo-500/10 px-2 py-0.5 text-xs font-bold text-indigo-300">
                            {statusLabel(event.status)}
                          </span>
                          {event.note && <p className="text-xs text-slate-200 mt-1 leading-relaxed">{event.note}</p>}
                        </div>
                        <p className="text-[11px] text-slate-500 font-mono whitespace-nowrap">{formatDateTime(event.created_at)}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 py-10 text-center">No activity history recorded yet.</p>
                )}
              </div>
            )}
          </div>
        )}
      </AppModal>

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
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">IMEI / Serial</p>
                  {form.imei && (
                    <span className={`text-[10px] font-bold ${isValidLuhnIMEI(form.imei) ? "text-emerald-400" : "text-amber-400"}`}>
                      {isValidLuhnIMEI(form.imei) ? "✓ Valid Luhn IMEI" : form.imei.length === 15 ? "⚠ Invalid Luhn Checksum" : `${form.imei.length}/15 digits`}
                    </span>
                  )}
                </div>
                <Input placeholder="15-digit IMEI or SN" value={form.imei} onChange={e => setForm({...form, imei: e.target.value})} />
                
                {checkingImei && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <Loader2 size={12} className="animate-spin text-indigo-400" />
                    <span>Checking device history...</span>
                  </div>
                )}

                {imeiIntelligence && (imeiIntelligence.is_blacklisted || imeiIntelligence.sale || imeiIntelligence.warranty || imeiIntelligence.repair_count > 0) && (
                  <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 via-purple-950/20 to-black/40 p-3 text-xs space-y-1.5 shadow-inner">
                    {imeiIntelligence.is_blacklisted && (
                      <div className="rounded-lg border border-rose-500/50 bg-rose-950/80 p-2.5 text-rose-200 font-bold flex items-center gap-2 animate-pulse shadow-lg">
                        <AlertTriangle className="text-rose-400 shrink-0" size={18} />
                        <div>
                          <div className="text-xs uppercase tracking-wider text-rose-100 font-black">⛔ STOLEN / BLACKLISTED DEVICE DETECTED</div>
                          <div className="text-[11px] font-normal text-rose-300">
                            Reason: {imeiIntelligence.blacklist_info?.reason || "Reported lost or stolen"} (By: {imeiIntelligence.blacklist_info?.reported_by || "System Admin"})
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between font-bold text-indigo-200">
                      <span>📱 Device Intelligence</span>
                      {imeiIntelligence.item_name && <span className="text-[11px] text-slate-300">{imeiIntelligence.item_name}</span>}
                    </div>

                    {imeiIntelligence.sale && (
                      <div className="text-slate-300">
                        🛒 Sold on <strong className="text-white">{imeiIntelligence.sale.sold_at?.slice(0, 10)}</strong> to <span className="text-indigo-300">{imeiIntelligence.sale.customer_name}</span> ({imeiIntelligence.sale.invoice_number})
                      </div>
                    )}

                    {imeiIntelligence.warranty && (
                      <div className="flex items-center gap-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold inline-flex items-center gap-1 ${imeiIntelligence.warranty.is_active ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "bg-rose-500/20 text-rose-300"}`}>
                          {imeiIntelligence.warranty.is_active ? (
                            <>
                              <CheckCircle2 size={11} /> Warranty Active ({imeiIntelligence.warranty.days_remaining} days left)
                            </>
                          ) : (
                            "Expired Warranty"
                          )}
                        </span>
                      </div>
                    )}

                    {imeiIntelligence.repair_count > 0 && (
                      <div className="text-amber-300 font-medium flex items-start gap-1.5">
                        <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <strong>{imeiIntelligence.repair_count} Previous Repair(s)</strong> logged for this IMEI!
                          {imeiIntelligence.past_repairs[0] && (
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              Last repair: {imeiIntelligence.past_repairs[0].ticket_number} ({imeiIntelligence.past_repairs[0].status}) - {imeiIntelligence.past_repairs[0].problem}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
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
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Issue / Fault Description</p>
                  <button
                    type="button"
                    onClick={runAIDiagnose}
                    disabled={diagnosingAI}
                    className="px-2.5 py-1 rounded-lg bg-gradient-to-r from-purple-600/30 to-indigo-600/30 border border-purple-500/40 hover:from-purple-600/40 hover:to-indigo-600/40 text-purple-200 text-[10px] font-bold transition flex items-center gap-1 shadow-md shadow-purple-500/10 disabled:opacity-50"
                  >
                    <Sparkles size={12} className={`text-purple-300 ${diagnosingAI ? "animate-spin" : ""}`} />
                    {diagnosingAI ? "Diagnosing..." : "AI Auto-Diagnose"}
                  </button>
                </div>
                <textarea 
                  className="w-full bg-[#0f172a] border border-white/10 rounded-2xl p-4 text-sm text-white focus:outline-none focus:border-indigo-500/50 min-h-[80px]"
                  placeholder="Describe the problem..."
                  value={form.issue}
                  onChange={e => setForm({...form, issue: e.target.value})}
                />
                {aiDiagnosisResult && (
                  <div className="p-3.5 rounded-2xl border border-purple-500/30 bg-purple-950/30 space-y-2 text-xs">
                    <div className="flex items-center justify-between font-bold text-purple-300">
                      <span className="flex items-center gap-1.5"><Sparkles size={14} /> AI Diagnostic Suggestion</span>
                      <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 rounded bg-purple-500/20 text-purple-200 border border-purple-500/30">
                        {aiDiagnosisResult.urgency || "Normal"} Priority
                      </span>
                    </div>
                    <p className="text-slate-300"><strong className="text-white">Probable Cause:</strong> {aiDiagnosisResult.probable_cause}</p>
                    <p className="text-slate-300"><strong className="text-white">Recommended Action:</strong> {aiDiagnosisResult.suggested_action}</p>
                    {aiDiagnosisResult.recommended_parts?.length > 0 && (
                      <p className="text-slate-300"><strong className="text-white">Parts Needed:</strong> {aiDiagnosisResult.recommended_parts.join(", ")}</p>
                    )}
                    {aiDiagnosisResult.estimated_cost && (
                      <p className="text-emerald-400 font-semibold">Suggested Est. Labor: ${Number(aiDiagnosisResult.estimated_cost).toFixed(2)} (auto-applied below)</p>
                    )}
                  </div>
                )}
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

      {showSlaRiskModal && (
        <AppModal
          open
          onClose={() => setShowSlaRiskModal(false)}
          title={
            <span className="flex items-center gap-2">
              <Sparkles size={18} className="text-purple-400" />
              AI Repair SLA Risk & Bottleneck Predictor
            </span>
          }
          panelClassName="max-w-2xl"
        >
          {slaRiskLoading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 size={36} className="animate-spin text-purple-400" />
              <p className="text-sm font-semibold text-slate-200">Gemini AI is auditing active repair queues & turnaround times...</p>
              <p className="text-xs text-slate-400">Cross-referencing technician workloads, parts availability & SLA thresholds.</p>
            </div>
          ) : slaRiskData ? (
            <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
              {/* Queue Health Summary */}
              <div className="p-4 rounded-2xl border border-purple-500/30 bg-purple-950/20 text-xs text-purple-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-bold text-sm text-purple-300">
                    <Sparkles size={16} /> Queue Health Score: {slaRiskData.sla_health_score}/100
                  </span>
                  <span className="text-slate-400">
                    {slaRiskData.total_active_jobs} Active Jobs ({slaRiskData.critical_risk_count} Critical Risks)
                  </span>
                </div>
                <p className="text-slate-300 text-xs leading-relaxed">{slaRiskData.summary}</p>
              </div>

              {/* Action Recommendations */}
              {slaRiskData.action_recommendations?.length > 0 && (
                <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900/60 space-y-1.5">
                  <p className="text-xs font-bold uppercase tracking-wider text-sky-700 dark:text-sky-300">AI Priority Action Directives</p>
                  <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                    {slaRiskData.action_recommendations.map((rec, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-sky-600 dark:text-sky-400 font-bold">•</span>
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Risk Tickets Table / Cards */}
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Flagged Risk Tickets</p>
                {slaRiskData.risk_tickets?.length === 0 ? (
                  <div className="p-6 rounded-2xl border border-emerald-300 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-950/10 text-center text-xs text-emerald-800 dark:text-emerald-300">
                    🎉 All active repair jobs are within SLA thresholds! No bottleneck risks detected.
                  </div>
                ) : (
                  slaRiskData.risk_tickets.map((t, idx) => (
                    <div key={idx} className="p-3.5 rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-900/80 space-y-1.5 text-xs">
                      <div className="flex items-center justify-between font-bold">
                        <span className="text-slate-900 dark:text-white flex items-center gap-2">
                          <span className="font-mono text-indigo-700 dark:text-indigo-300">#{t.ticket_no}</span>
                          <span>{t.device}</span>
                        </span>
                        <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-extrabold ${t.risk_level === "Critical" ? "bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300 border border-red-300 dark:border-red-500/40" : t.risk_level === "High" ? "bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40" : "bg-sky-100 dark:bg-sky-500/20 text-sky-800 dark:text-sky-300 border border-sky-300 dark:border-sky-500/40"}`}>
                          {t.risk_level} Risk
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-[11px]">
                        <span>Status: <strong className="text-slate-800 dark:text-slate-200 uppercase">{t.status.replace(/_/g, " ")}</strong></span>
                        <span>Technician: <strong className="text-slate-800 dark:text-slate-200">{t.technician}</strong></span>
                      </div>
                      <p className="text-amber-800 dark:text-amber-300/90 text-xs font-medium mt-1">⚠️ {t.reason}</p>
                      <p className="text-slate-700 dark:text-slate-300 text-[11px]"><strong className="text-purple-700 dark:text-purple-300">Action:</strong> {t.recommended_action}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-red-400">Failed to analyze SLA risks.</p>
          )}
        </AppModal>
      )}

    </div>
    </div>
  );
}

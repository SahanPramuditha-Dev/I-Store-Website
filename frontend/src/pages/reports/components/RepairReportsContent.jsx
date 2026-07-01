import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  PackageSearch,
  ShieldAlert,
  Tag,
  Wrench,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge, Button, KpiCard, SectionCard, Table, Select } from "../../../components/UI";

const MONEY_LOCALE = "en-LK";
const DAY_LABEL = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const PIE_COLORS = ["#38bdf8", "#22c55e", "#f59e0b", "#6366f1", "#f97316", "#a78bfa", "#14b8a6"];
const TAB_KEYS = [
  { key: "technician", label: "By Technician" },
  { key: "status", label: "By Status" },
  { key: "device", label: "By Device Brand/Model" },
  { key: "issue", label: "By Issue Type" },
  { key: "parts", label: "Spare Parts Usage" },
  { key: "profit", label: "Profitability per Job" },
  { key: "advanced", label: "Advanced Reports" },
];
const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

function money(value) {
  return `LKR ${Math.round(Number(value || 0)).toLocaleString(MONEY_LOCALE)}`;
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDayKey(value) {
  const date = toDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function parseDateInput(value, endExclusive = false) {
  if (!value) return null;
  const date = toDate(`${value}T00:00:00`);
  if (!date) return null;
  if (!endExclusive) return date;
  const cloned = new Date(date);
  cloned.setDate(cloned.getDate() + 1);
  return cloned;
}

function enumerateDays(from, to) {
  const start = parseDateInput(from);
  const end = parseDateInput(to, true);
  if (!start || !end || start >= end) return [];
  const rows = [];
  const cursor = new Date(start);
  while (cursor < end) {
    rows.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return rows;
}

function statusClass(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("cancel")) return "red";
  if (value.includes("deliver") || value.includes("complete")) return "green";
  if (value.includes("waiting")) return "amber";
  if (value.includes("progress") || value.includes("repair") || value.includes("diagn")) return "indigo";
  return "sky";
}

function isCompleted(status) {
  const value = String(status || "").toLowerCase();
  return value === "completed" || value === "delivered";
}

function isCancelled(status) {
  return String(status || "").toLowerCase().includes("cancel");
}

function normalizeIssue(text) {
  const value = String(text || "").trim();
  if (!value) return "Unknown";
  return value[0].toUpperCase() + value.slice(1);
}

function parseBrandModelFallback(device) {
  const raw = String(device || "").trim();
  if (!raw) return { brand: "Unknown", model: "Unknown" };
  const parts = raw.split(" ");
  return {
    brand: parts[0] || "Unknown",
    model: parts.slice(1).join(" ").trim() || raw,
  };
}

function MiniTable({ columns, rows, emptyLabel = "No records found." }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
      <Table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.label}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="py-6 text-slate-400">
                {emptyLabel}
              </td>
            </tr>
          )}
          {rows.map((row, index) => (
            <tr key={row.id || row.key || index}>
              {columns.map((col) => (
                <td key={`${row.id || index}-${col.label}`}>
                  {typeof col.value === "function" ? col.value(row, index) : row[col.value]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export default function RepairReportsContent({
  repairRows,
  movementRows,
  dateFrom,
  dateTo,
  query,
  onPrepared,
}) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("technician");
  const [page, setPage] = useState(1);
  const [technicianFilter, setTechnicianFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [brandFilter, setBrandFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [issueFilter, setIssueFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const pageSize = 12;

  const filterOptions = useMemo(() => {
    const technicians = new Set();
    const statuses = new Set();
    const brands = new Set();
    const models = new Set();
    const issues = new Set();
    const priorities = new Set();
    repairRows.forEach((row) => {
      technicians.add(row.technician || "Unassigned");
      statuses.add(row.status || "Unknown");
      const brand = row.device_brand || parseBrandModelFallback(row.device).brand;
      const model = row.device_model_name || parseBrandModelFallback(row.device).model;
      brands.add(brand || "Unknown");
      models.add(model || "Unknown");
      issues.add(row.issue_type || normalizeIssue(row.issue));
      priorities.add(row.priority || "Normal");
    });
    return {
      technicians: [...technicians].sort((a, b) => a.localeCompare(b)),
      statuses: [...statuses].sort((a, b) => a.localeCompare(b)),
      brands: [...brands].sort((a, b) => a.localeCompare(b)),
      models: [...models].sort((a, b) => a.localeCompare(b)),
      issues: [...issues].sort((a, b) => a.localeCompare(b)),
      priorities: [...priorities].sort((a, b) => a.localeCompare(b)),
    };
  }, [repairRows]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const start = parseDateInput(dateFrom);
    const end = parseDateInput(dateTo, true);

    return repairRows.filter((row) => {
      const created = toDate(row.created_at);
      if (start && created && created < start) return false;
      if (end && created && created >= end) return false;

      const brand = row.device_brand || parseBrandModelFallback(row.device).brand;
      const model = row.device_model_name || parseBrandModelFallback(row.device).model;
      const issueType = row.issue_type || normalizeIssue(row.issue);
      const technician = row.technician || "Unassigned";
      const priority = row.priority || "Normal";

      if (technicianFilter !== "all" && technician !== technicianFilter) return false;
      if (statusFilter !== "all" && (row.status || "Unknown") !== statusFilter) return false;
      if (brandFilter !== "all" && brand !== brandFilter) return false;
      if (modelFilter !== "all" && model !== modelFilter) return false;
      if (issueFilter !== "all" && issueType !== issueFilter) return false;
      if (priorityFilter !== "all" && priority !== priorityFilter) return false;

      if (!normalizedQuery) return true;
      const searchText = [
        row.ticket_no,
        row.device,
        row.issue,
        row.status,
        technician,
        brand,
        model,
        issueType,
      ]
        .join(" ")
        .toLowerCase();
      return searchText.includes(normalizedQuery);
    });
  }, [
    brandFilter,
    dateFrom,
    dateTo,
    issueFilter,
    modelFilter,
    priorityFilter,
    query,
    repairRows,
    statusFilter,
    technicianFilter,
  ]);

  useEffect(() => {
    setPage(1);
  }, [technicianFilter, statusFilter, brandFilter, modelFilter, issueFilter, priorityFilter, dateFrom, dateTo, query]);

  const analytics = useMemo(() => {
    const completedRows = filteredRows.filter((row) => isCompleted(row.status));
    const nonCancelledRows = filteredRows.filter((row) => !isCancelled(row.status));
    const pendingRows = filteredRows.filter((row) => !isCompleted(row.status) && !isCancelled(row.status));
    const delayedRows = filteredRows.filter((row) => Boolean(row.sla_breached));
    const cancelledRows = filteredRows.filter((row) => isCancelled(row.status));

    const repairRevenue = nonCancelledRows.reduce((acc, row) => acc + Number(row.invoice_amount ?? row.estimated_cost ?? 0), 0);
    const partsCostTotal = filteredRows.reduce((acc, row) => acc + Number(row.parts_cost_total || 0), 0);
    const avgRepairValue = nonCancelledRows.length > 0 ? repairRevenue / nonCancelledRows.length : 0;

    const completedWithTime = completedRows.filter((row) => row.time_taken_hours && row.time_taken_hours > 0);
    const avgRepairTimeHours =
      completedWithTime.length > 0
        ? completedWithTime.reduce((acc, row) => acc + Number(row.time_taken_hours || 0), 0) / completedWithTime.length
        : 0;

    const statusDistribution = [
      { name: "Completed", value: completedRows.length },
      { name: "Pending", value: pendingRows.length },
      { name: "Delayed", value: delayedRows.length },
    ];

    const technicianRows = Object.values(
      filteredRows.reduce((acc, row) => {
        const key = row.technician || "Unassigned";
        if (!acc[key]) {
          acc[key] = {
            technician: key,
            jobs: 0,
            completed: 0,
            pending: 0,
            delayed: 0,
            revenue: 0,
            avgHours: 0,
            totalHours: 0,
          };
        }
        acc[key].jobs += 1;
        acc[key].revenue += Number(row.invoice_amount ?? row.estimated_cost ?? 0);
        if (isCompleted(row.status)) acc[key].completed += 1;
        else if (!isCancelled(row.status)) acc[key].pending += 1;
        if (row.sla_breached) acc[key].delayed += 1;
        if (Number(row.time_taken_hours || 0) > 0) acc[key].totalHours += Number(row.time_taken_hours);
        return acc;
      }, {}),
    )
      .map((row) => ({
        ...row,
        avgHours: row.jobs > 0 ? row.totalHours / row.jobs : 0,
      }))
      .sort((a, b) => b.jobs - a.jobs);

    const dayRows = enumerateDays(dateFrom, dateTo).map((date) => ({
      dayKey: toDayKey(date),
      label: DAY_LABEL.format(date),
      jobs: 0,
      revenue: 0,
    }));
    const dayMap = Object.fromEntries(dayRows.map((day) => [day.dayKey, day]));
    filteredRows.forEach((row) => {
      const key = toDayKey(row.created_at);
      if (!dayMap[key]) return;
      dayMap[key].jobs += 1;
      dayMap[key].revenue += Number(row.invoice_amount ?? row.estimated_cost ?? 0);
    });
    const volumeTrendRows = Object.values(dayMap).sort((a, b) => a.dayKey.localeCompare(b.dayKey));

    const issueRows = Object.values(
      filteredRows.reduce((acc, row) => {
        const key = row.issue_type || normalizeIssue(row.issue);
        if (!acc[key]) acc[key] = { issue: key, count: 0, revenue: 0 };
        acc[key].count += 1;
        acc[key].revenue += Number(row.invoice_amount ?? row.estimated_cost ?? 0);
        return acc;
      }, {}),
    )
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const brandRows = Object.values(
      filteredRows.reduce((acc, row) => {
        const key = row.device_brand || parseBrandModelFallback(row.device).brand;
        if (!acc[key]) acc[key] = { brand: key, count: 0, revenue: 0 };
        acc[key].count += 1;
        acc[key].revenue += Number(row.invoice_amount ?? row.estimated_cost ?? 0);
        return acc;
      }, {}),
    ).sort((a, b) => b.count - a.count);

    const turnaroundBins = [
      { bucket: "< 1hr", min: 0, max: 1, count: 0 },
      { bucket: "1-3hr", min: 1, max: 3, count: 0 },
      { bucket: "3-8hr", min: 3, max: 8, count: 0 },
      { bucket: "1-3 days", min: 24, max: 72, count: 0 },
      { bucket: "3+ days", min: 72, max: Number.POSITIVE_INFINITY, count: 0 },
    ];
    completedWithTime.forEach((row) => {
      const hrs = Number(row.time_taken_hours || 0);
      if (hrs < 1) turnaroundBins[0].count += 1;
      else if (hrs < 3) turnaroundBins[1].count += 1;
      else if (hrs < 8) turnaroundBins[2].count += 1;
      else if (hrs < 72) turnaroundBins[3].count += 1;
      else turnaroundBins[4].count += 1;
    });

    const repairTypeRows = Object.values(
      filteredRows.reduce((acc, row) => {
        const key = row.repair_type || row.issue_type || normalizeIssue(row.issue);
        if (!acc[key]) acc[key] = { repairType: key, revenue: 0, jobs: 0 };
        acc[key].jobs += 1;
        acc[key].revenue += Number(row.invoice_amount ?? row.estimated_cost ?? 0);
        return acc;
      }, {}),
    ).sort((a, b) => b.revenue - a.revenue);

    const deviceRows = Object.values(
      filteredRows.reduce((acc, row) => {
        const brand = row.device_brand || parseBrandModelFallback(row.device).brand;
        const model = row.device_model_name || parseBrandModelFallback(row.device).model;
        const key = `${brand}::${model}`;
        if (!acc[key]) acc[key] = { brand, model, jobs: 0, revenue: 0 };
        acc[key].jobs += 1;
        acc[key].revenue += Number(row.invoice_amount ?? row.estimated_cost ?? 0);
        return acc;
      }, {}),
    ).sort((a, b) => b.jobs - a.jobs);

    const issueTypeRows = Object.values(
      filteredRows.reduce((acc, row) => {
        const key = row.issue_type || normalizeIssue(row.issue);
        if (!acc[key]) acc[key] = { issueType: key, jobs: 0, revenue: 0 };
        acc[key].jobs += 1;
        acc[key].revenue += Number(row.invoice_amount ?? row.estimated_cost ?? 0);
        return acc;
      }, {}),
    ).sort((a, b) => b.jobs - a.jobs);

    const partsUsageRows = Object.values(
      filteredRows.reduce((acc, row) => {
        (row.parts_lines || []).forEach((line) => {
          const key = `${line.part_name || "Unknown"}::${line.supplier || "Unknown"}`;
          if (!acc[key]) {
            acc[key] = {
              partName: line.part_name || "Unknown",
              supplier: line.supplier || "Unknown",
              usedCount: 0,
              cost: 0,
            };
          }
          acc[key].usedCount += Number(line.quantity || 0);
          acc[key].cost += Number(line.line_cost || 0);
        });
        return acc;
      }, {}),
    ).sort((a, b) => b.usedCount - a.usedCount);

    const profitabilityRows = filteredRows
      .map((row) => ({
        id: row.id,
        ticket_no: row.ticket_no,
        technician: row.technician || "Unassigned",
        revenue: Number(row.invoice_amount ?? row.estimated_cost ?? 0),
        partsCost: Number(row.parts_cost_total || 0),
        laborCost: Number(row.labor_cost || 0),
        profit: Number(row.job_profitability ?? Number(row.invoice_amount ?? row.estimated_cost ?? 0) - Number(row.actual_cost || 0)),
      }))
      .sort((a, b) => b.profit - a.profit);

    const slaBreachRows = filteredRows.filter((row) => row.sla_breached).map((row) => ({
      id: row.id,
      ticket: row.ticket_no,
      device: row.device,
      technician: row.technician || "Unassigned",
      eta: row.estimated_completion,
      delivered: row.delivered_at,
      status: row.status,
    }));

    const repeatRepairRows = filteredRows.filter((row) => row.is_repeat_repair).map((row) => ({
      id: row.id,
      ticket: row.ticket_no,
      device: row.device,
      imei: row.imei || "-",
      issueType: row.issue_type || normalizeIssue(row.issue),
      status: row.status,
    }));

    const satisfactionRows = completedRows.slice(0, 20).map((row) => ({
      id: row.id,
      ticket: row.ticket_no,
      customer: row.customer_name || "Unknown",
      deliveredAt: row.delivered_at,
      rating: row.customer_rating ?? "-",
    }));

    const warrantyClaimRows = filteredRows
      .filter((row) => row.warranty_claim)
      .map((row) => ({
        id: row.id,
        ticket: row.ticket_no,
        device: row.device,
        warrantyStatus: row.warranty_status || "N/A",
        issue: row.issue,
        status: row.status,
      }));

    const cancellationRows = cancelledRows.map((row) => ({
      id: row.id,
      ticket: row.ticket_no,
      cancelledAt: row.cancelled_at || row.created_at,
      reason: row.cancellation_reason || "No reason provided",
      technician: row.technician || "Unassigned",
    }));

    const varianceRows = filteredRows.map((row) => ({
      id: row.id,
      ticket: row.ticket_no,
      estimated: Number(row.invoice_amount ?? row.estimated_cost ?? 0),
      actual: Number(row.actual_cost || 0),
      variance: Number(row.cost_variance || 0),
      variancePct:
        Number(row.invoice_amount ?? row.estimated_cost ?? 0) > 0
          ? (Number(row.cost_variance || 0) / Number(row.estimated_cost || 1)) * 100
          : 0,
    }));

    const orderedByItem = {};
    const consumedByItem = {};
    movementRows.forEach((movement) => {
      const itemId = String(movement.item_id || movement.item_name || "unknown");
      const itemName = movement.item_name || `Item #${movement.item_id}`;
      const qty = Math.abs(Number(movement.quantity || 0));
      const type = String(movement.movement_type || "").toUpperCase();
      const ref = String(movement.reference_type || "").toLowerCase();
      if (type === "IN" && (ref === "purchase_order" || ref === "grn")) {
        if (!orderedByItem[itemId]) orderedByItem[itemId] = { itemId, itemName, ordered: 0 };
        orderedByItem[itemId].ordered += qty;
      }
      if (type === "REPAIR_CONSUME") {
        if (!consumedByItem[itemId]) consumedByItem[itemId] = { itemId, itemName, used: 0 };
        consumedByItem[itemId].used += qty;
      }
    });
    const partsWastageRows = Object.values(orderedByItem)
      .map((row) => {
        const used = consumedByItem[row.itemId]?.used || 0;
        return {
          part: row.itemName,
          ordered: row.ordered,
          used,
          notUsed: Math.max(0, row.ordered - used),
        };
      })
      .filter((row) => row.notUsed > 0)
      .sort((a, b) => b.notUsed - a.notUsed)
      .slice(0, 20);

    return {
      completedRows,
      pendingRows,
      delayedRows,
      cancelledRows,
      repairRevenue,
      avgRepairValue,
      avgRepairTimeHours,
      partsCostTotal,
      statusDistribution,
      technicianRows,
      volumeTrendRows,
      issueRows,
      brandRows,
      turnaroundBins,
      repairTypeRows,
      deviceRows,
      issueTypeRows,
      partsUsageRows,
      profitabilityRows,
      slaBreachRows,
      repeatRepairRows,
      satisfactionRows,
      warrantyClaimRows,
      cancellationRows,
      varianceRows,
      partsWastageRows,
    };
  }, [dateFrom, dateTo, filteredRows, movementRows]);

  useEffect(() => {
    if (!onPrepared) return;
    onPrepared({
      exportColumns: [
        { label: "Job ID", value: "ticket_no" },
        { label: "Date In", value: "created_at" },
        { label: "Device", value: "device" },
        { label: "Issue", value: "issue" },
        { label: "Technician", value: "technician" },
        { label: "Status", value: "status" },
        { label: "ETA", value: "estimated_completion" },
        { label: "Time (hrs)", value: (row) => Number(row.time_taken_hours || 0) },
        { label: "Parts Cost", value: (row) => Number(row.parts_cost_total || 0) },
        { label: "Labor", value: (row) => Number(row.labor_cost || 0) },
        { label: "Total", value: (row) => Number(row.invoice_amount ?? row.estimated_cost ?? 0) },
        { label: "Delivered", value: (row) => (row.delivered_at ? "Yes" : "No") },
      ],
      exportRows: filteredRows,
    });
  }, [filteredRows, onPrepared]);

  const pagedRows = useMemo(() => {
    const sorted = [...filteredRows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [filteredRows, page]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const fromRow = filteredRows.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const toRow = filteredRows.length === 0 ? 0 : Math.min(page * pageSize, filteredRows.length);

  const renderTabContent = () => {
    if (activeTab === "technician") {
      return (
        <SectionCard title="By Technician" subtitle="Per-technician repair stats">
          <MiniTable
            columns={[
              { label: "Technician", value: "technician" },
              { label: "Jobs", value: (row) => row.jobs.toLocaleString() },
              { label: "Completed", value: (row) => row.completed.toLocaleString() },
              { label: "Pending", value: (row) => row.pending.toLocaleString() },
              { label: "Delayed", value: (row) => row.delayed.toLocaleString() },
              { label: "Revenue", value: (row) => money(row.revenue) },
              { label: "Avg Hours", value: (row) => row.avgHours.toFixed(1) },
            ]}
            rows={analytics.technicianRows}
            emptyLabel="No technician activity."
          />
        </SectionCard>
      );
    }

    if (activeTab === "status") {
      const grouped = Object.values(
        filteredRows.reduce((acc, row) => {
          const key = row.status || "Unknown";
          if (!acc[key]) acc[key] = { status: key, jobs: 0, revenue: 0, avgHours: 0, hoursTotal: 0 };
          acc[key].jobs += 1;
          acc[key].revenue += Number(row.invoice_amount ?? row.estimated_cost ?? 0);
          acc[key].hoursTotal += Number(row.time_taken_hours || 0);
          return acc;
        }, {}),
      )
        .map((row) => ({
          ...row,
          avgHours: row.jobs > 0 ? row.hoursTotal / row.jobs : 0,
        }))
        .sort((a, b) => b.jobs - a.jobs);
      return (
        <SectionCard title="By Status" subtitle="Grouped status breakdown">
          <MiniTable
            columns={[
              { label: "Status", value: "status" },
              { label: "Jobs", value: (row) => row.jobs.toLocaleString() },
              { label: "Revenue", value: (row) => money(row.revenue) },
              { label: "Avg Hours", value: (row) => row.avgHours.toFixed(1) },
            ]}
            rows={grouped}
            emptyLabel="No status data."
          />
        </SectionCard>
      );
    }

    if (activeTab === "device") {
      return (
        <SectionCard title="By Device Brand/Model" subtitle="Most repaired hardware combinations">
          <MiniTable
            columns={[
              { label: "Brand", value: "brand" },
              { label: "Model", value: "model" },
              { label: "Jobs", value: (row) => row.jobs.toLocaleString() },
              { label: "Revenue", value: (row) => money(row.revenue) },
            ]}
            rows={analytics.deviceRows}
            emptyLabel="No device-level repairs."
          />
        </SectionCard>
      );
    }

    if (activeTab === "issue") {
      return (
        <SectionCard title="By Issue Type" subtitle="Most common problems">
          <MiniTable
            columns={[
              { label: "Issue Type", value: "issueType" },
              { label: "Jobs", value: (row) => row.jobs.toLocaleString() },
              { label: "Revenue", value: (row) => money(row.revenue) },
            ]}
            rows={analytics.issueTypeRows}
            emptyLabel="No issue data."
          />
        </SectionCard>
      );
    }

    if (activeTab === "parts") {
      return (
        <SectionCard title="Spare Parts Usage" subtitle="Part name, used count, cost, supplier">
          <MiniTable
            columns={[
              { label: "Part Name", value: "partName" },
              { label: "Used Count", value: (row) => row.usedCount.toLocaleString() },
              { label: "Cost", value: (row) => money(row.cost) },
              { label: "Supplier", value: "supplier" },
            ]}
            rows={analytics.partsUsageRows}
            emptyLabel="No part consumption in selected range."
          />
        </SectionCard>
      );
    }

    if (activeTab === "profit") {
      return (
        <SectionCard title="Profitability per Job" subtitle="Revenue minus parts and labor costs">
          <MiniTable
            columns={[
              { label: "Job ID", value: "ticket_no" },
              { label: "Technician", value: "technician" },
              { label: "Revenue", value: (row) => money(row.revenue) },
              { label: "Parts Cost", value: (row) => money(row.partsCost) },
              { label: "Labor", value: (row) => money(row.laborCost) },
              { label: "Profit", value: (row) => money(row.profit) },
            ]}
            rows={analytics.profitabilityRows}
            emptyLabel="No profitability rows."
          />
        </SectionCard>
      );
    }

    return (
      <SectionCard title="Advanced Repair Reports" subtitle="SLA, repeats, warranty, cancellations, variance, and wastage">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <SectionCard title="Repair SLA Breach Report">
            <MiniTable
              columns={[
                { label: "Job", value: "ticket" },
                { label: "Device", value: "device" },
                { label: "Technician", value: "technician" },
                { label: "ETA", value: (row) => (row.eta ? new Date(row.eta).toLocaleString() : "-") },
                { label: "Status", value: "status" },
              ]}
              rows={analytics.slaBreachRows}
              emptyLabel="No SLA breaches in selected range."
            />
          </SectionCard>

          <SectionCard title="Repeat Repair Report">
            <MiniTable
              columns={[
                { label: "Job", value: "ticket" },
                { label: "Device", value: "device" },
                { label: "IMEI", value: "imei" },
                { label: "Issue Type", value: "issueType" },
                { label: "Status", value: "status" },
              ]}
              rows={analytics.repeatRepairRows}
              emptyLabel="No repeat repairs flagged."
            />
          </SectionCard>

          <SectionCard title="Customer Satisfaction Placeholder">
            <MiniTable
              columns={[
                { label: "Job", value: "ticket" },
                { label: "Customer", value: "customer" },
                { label: "Delivered", value: (row) => (row.deliveredAt ? new Date(row.deliveredAt).toLocaleString() : "-") },
                { label: "Rating", value: "rating" },
              ]}
              rows={analytics.satisfactionRows}
              emptyLabel="No completed jobs to rate yet."
            />
          </SectionCard>

          <SectionCard title="Parts Wastage Report">
            <MiniTable
              columns={[
                { label: "Part", value: "part" },
                { label: "Ordered", value: (row) => row.ordered.toLocaleString() },
                { label: "Used", value: (row) => row.used.toLocaleString() },
                { label: "Not Used", value: (row) => row.notUsed.toLocaleString() },
              ]}
              rows={analytics.partsWastageRows}
              emptyLabel="No parts wastage detected for selected range."
            />
          </SectionCard>

          <SectionCard title="Warranty Claims Log">
            <MiniTable
              columns={[
                { label: "Job", value: "ticket" },
                { label: "Device", value: "device" },
                { label: "Warranty", value: "warrantyStatus" },
                { label: "Issue", value: "issue" },
                { label: "Status", value: "status" },
              ]}
              rows={analytics.warrantyClaimRows}
              emptyLabel="No warranty claims in selected range."
            />
          </SectionCard>

          <SectionCard title="Repair Cancellation Report">
            <MiniTable
              columns={[
                { label: "Job", value: "ticket" },
                { label: "Cancelled At", value: (row) => new Date(row.cancelledAt).toLocaleString() },
                { label: "Technician", value: "technician" },
                { label: "Reason", value: "reason" },
              ]}
              rows={analytics.cancellationRows}
              emptyLabel="No cancelled repairs found."
            />
          </SectionCard>

          <SectionCard title="Estimated vs Actual Cost Variance" className="xl:col-span-2">
            <MiniTable
              columns={[
                { label: "Job", value: "ticket" },
                { label: "Estimated", value: (row) => money(row.estimated) },
                { label: "Actual", value: (row) => money(row.actual) },
                { label: "Variance", value: (row) => money(row.variance) },
                { label: "Variance %", value: (row) => `${row.variancePct.toFixed(1)}%` },
              ]}
              rows={analytics.varianceRows}
              emptyLabel="No variance rows."
            />
          </SectionCard>
        </div>
      </SectionCard>
    );
  };

  return (
    <>
      <SectionCard title="Repair Filters" subtitle="Date range is controlled globally above">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-2">
          <Select value={technicianFilter} onChange={(event) => setTechnicianFilter(event.target.value)} className="field !py-2 !px-3 !text-xs">
            <option value="all">All Technicians</option>
            {filterOptions.technicians.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>

          <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="field !py-2 !px-3 !text-xs">
            <option value="all">All Statuses</option>
            {filterOptions.statuses.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>

          <Select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)} className="field !py-2 !px-3 !text-xs">
            <option value="all">All Brands</option>
            {filterOptions.brands.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>

          <Select value={modelFilter} onChange={(event) => setModelFilter(event.target.value)} className="field !py-2 !px-3 !text-xs">
            <option value="all">All Models</option>
            {filterOptions.models.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>

          <Select value={issueFilter} onChange={(event) => setIssueFilter(event.target.value)} className="field !py-2 !px-3 !text-xs">
            <option value="all">All Issue Types</option>
            {filterOptions.issues.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>

          <Select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="field !py-2 !px-3 !text-xs">
            <option value="all">All Priorities</option>
            {filterOptions.priorities.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard title="Total Repair Jobs (Period)" value={filteredRows.length.toLocaleString()} icon={<Wrench size={18} />} />
        <KpiCard title="Total Repair Revenue" value={money(analytics.repairRevenue)} icon={<BarChart3 size={18} />} tone="green" />
        <KpiCard title="Completed Repairs" value={analytics.completedRows.length.toLocaleString()} icon={<CheckCircle2 size={18} />} tone="indigo" />
        <KpiCard title="Pending Repairs" value={analytics.pendingRows.length.toLocaleString()} icon={<Clock3 size={18} />} tone="amber" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard title="Delayed / Overdue Repairs" value={analytics.delayedRows.length.toLocaleString()} icon={<ShieldAlert size={18} />} tone="red" />
        <KpiCard title="Average Repair Time (Hours)" value={analytics.avgRepairTimeHours.toFixed(1)} icon={<Clock3 size={18} />} tone="sky" />
        <KpiCard title="Average Repair Value (LKR)" value={money(analytics.avgRepairValue)} icon={<Tag size={18} />} tone="indigo" />
        <KpiCard title="Spare Parts Cost Total" value={money(analytics.partsCostTotal)} icon={<PackageSearch size={18} />} tone="amber" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-4" title="Repair Status Distribution" subtitle="Completed / Pending / Delayed">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={analytics.statusDistribution} dataKey="value" nameKey="name" innerRadius={60} outerRadius={92} stroke="none">
                  {analytics.statusDistribution.map((entry, index) => (
                    <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-8" title="Technician Workload" subtitle="Jobs per technician">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.technicianRows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.08)" />
                <XAxis dataKey="technician" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="jobs" fill="#6366f1" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-7" title="Repair Volume Trend" subtitle="Jobs over selected timeline">
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analytics.volumeTrendRows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.08)" />
                <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip />
                <Line type="monotone" dataKey="jobs" stroke="#38bdf8" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-5" title="Most Common Issues" subtitle="Top 10 issues">
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={analytics.issueRows} margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(148,163,184,0.08)" />
                <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="issue" width={120} tick={{ fill: "#cbd5e1", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#14b8a6" radius={[0, 8, 8, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <SectionCard className="xl:col-span-4" title="Most Repaired Brands">
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={analytics.brandRows} dataKey="count" nameKey="brand" innerRadius={54} outerRadius={88} stroke="none">
                  {analytics.brandRows.map((entry, index) => (
                    <Cell key={entry.brand} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-4" title="Turnaround Time Distribution">
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.turnaroundBins}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.08)" />
                <XAxis dataKey="bucket" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#f59e0b" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-4" title="Revenue by Repair Type">
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.repairTypeRows}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.08)" />
                <XAxis dataKey="repairType" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => money(value)} />
                <Bar dataKey="revenue" fill="#22c55e" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Sub-Report Views">
        <div className="flex flex-wrap gap-2">
          {TAB_KEYS.map((tab) => (
            <button
              key={tab.key}
              className={`btn btn-sm ${activeTab === tab.key ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </SectionCard>

      {renderTabContent()}

      <SectionCard title="Repair Job Log" subtitle="Detailed operational job table">
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
          <Table>
            <thead>
              <tr>
                <th>Job ID</th>
                <th>Date In</th>
                <th>Device</th>
                <th>Issue</th>
                <th>Technician</th>
                <th>Status</th>
                <th>ETA</th>
                <th>Time Taken</th>
                <th>Parts Cost</th>
                <th>Labor</th>
                <th>Total</th>
                <th>Delivered</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.length === 0 && (
                <tr>
                  <td colSpan={13} className="py-6 text-slate-400">
                    No repair jobs found for selected filters.
                  </td>
                </tr>
              )}
              {pagedRows.map((row) => (
                <tr key={row.id}>
                  <td className="font-mono">{row.ticket_no}</td>
                  <td>{row.created_at ? new Date(row.created_at).toLocaleString() : "-"}</td>
                  <td>{row.device || "-"}</td>
                  <td className="max-w-[210px] truncate" title={row.issue}>{row.issue || "-"}</td>
                  <td>{row.technician || "Unassigned"}</td>
                  <td>
                    <Badge tone={statusClass(row.status)}>{row.status || "Unknown"}</Badge>
                  </td>
                  <td>{row.estimated_completion ? new Date(row.estimated_completion).toLocaleString() : "-"}</td>
                  <td>{Number(row.time_taken_hours || 0).toFixed(1)}h</td>
                  <td>{money(row.parts_cost_total)}</td>
                  <td>{money(row.labor_cost)}</td>
                  <td className="font-bold">{money(row.estimated_cost)}</td>
                  <td>{row.delivered_at ? "Yes" : "No"}</td>
                  <td>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => navigate(`/repairs?id=${row.id}`)}>View</Button>
                      <Button size="sm" variant="secondary" onClick={() => window.open(`${API_BASE}/repairs/${row.id}/job-card-pdf`, "_blank")}>Print</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-slate-400">
            Showing {fromRow} to {toRow} of {filteredRows.length} jobs
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setPage((prev) => Math.max(1, prev - 1))} disabled={page <= 1}>
              Previous
            </Button>
            <Badge tone="indigo">Page {page} / {totalPages}</Badge>
            <Button size="sm" variant="secondary" onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))} disabled={page >= totalPages}>
              Next
            </Button>
          </div>
        </div>
      </SectionCard>

      {(analytics.delayedRows.length > 0 || analytics.cancelledRows.length > 0) && (
        <SectionCard title="Repair Alerts">
          <div className="space-y-2">
            {analytics.delayedRows.length > 0 && (
              <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-amber-100 text-sm flex items-center gap-2">
                <AlertTriangle size={14} />
                SLA breaches detected: {analytics.delayedRows.length} job(s).
              </div>
            )}
            {analytics.cancelledRows.length > 0 && (
              <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-rose-100 text-sm flex items-center gap-2">
                <ShieldAlert size={14} />
                Cancelled repairs logged: {analytics.cancelledRows.length} job(s).
              </div>
            )}
          </div>
        </SectionCard>
      )}
    </>
  );
}



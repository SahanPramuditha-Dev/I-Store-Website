import { useEffect, useMemo } from "react";
import { AlertTriangle, ClipboardList, TrendingUp, UserCog } from "lucide-react";
import { KpiCard, SectionCard, Table } from "../../../components/UI";

const money = (value) => `LKR ${Math.round(Number(value || 0)).toLocaleString("en-LK")}`;

function isCompletedRepair(status) {
  const value = String(status || "").toLowerCase();
  return value === "completed" || value === "delivered";
}

function daysBetween(fromIso, toIso) {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.max(0, Math.round((to - from) / (1000 * 60 * 60 * 24)));
}

function SimpleTable({ columns, rows, emptyLabel = "No records found." }) {
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
              <td colSpan={columns.length} className="text-slate-400 py-6">
                {emptyLabel}
              </td>
            </tr>
          )}
          {rows.map((row, index) => (
            <tr key={row.id || row.key || index}>
              {columns.map((col) => (
                <td key={`${row.id || index}-${col.label}`}>
                  {typeof col.value === "function" ? col.value(row) : row[col.value]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export default function TechnicianPerformanceContent({
  repairTicketRows,
  onPrepared
}) {
  const groupedRows = useMemo(() => {
    const rows = Object.values(
      (repairTicketRows || []).reduce((acc, repair) => {
        const technician = repair.technician || "Unassigned";
        if (!acc[technician]) {
          acc[technician] = {
            technician,
            total: 0,
            completed: 0,
            open: 0,
            revenue: 0,
            turnaroundDays: [],
          };
        }
        acc[technician].total += 1;
        if (isCompletedRepair(repair.status)) {
          acc[technician].completed += 1;
          acc[technician].revenue += Number(repair.invoice_amount ?? repair.estimated_cost ?? 0);
          if (repair.delivered_at) {
            acc[technician].turnaroundDays.push(daysBetween(repair.created_at, repair.delivered_at));
          }
        } else {
          acc[technician].open += 1;
        }
        return acc;
      }, {})
    )
      .map((row) => ({
        ...row,
        completionRate: row.total > 0 ? (row.completed / row.total) * 100 : 0,
        avgTurnaround:
          row.turnaroundDays.length > 0
            ? row.turnaroundDays.reduce((acc, value) => acc + value, 0) / row.turnaroundDays.length
            : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    return rows;
  }, [repairTicketRows]);

  useEffect(() => {
    if (!onPrepared) return;
    onPrepared({
      exportColumns: [
        { label: "Technician", value: "technician" },
        { label: "Total Tickets", value: (row) => row.total },
        { label: "Completed", value: (row) => row.completed },
        { label: "Open", value: (row) => row.open },
        { label: "Completion Rate %", value: (row) => Number(row.completionRate.toFixed(2)) },
        { label: "Revenue", value: (row) => Number(row.revenue || 0) },
        { label: "Avg Turnaround Days", value: (row) => Number(row.avgTurnaround.toFixed(2)) },
      ],
      exportRows: groupedRows,
    });
  }, [groupedRows, onPrepared]);

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard title="Technicians" value={groupedRows.length.toLocaleString()} icon={<UserCog size={18} />} />
        <KpiCard
          title="Completed Repairs"
          value={groupedRows.reduce((acc, row) => acc + row.completed, 0).toLocaleString()}
          icon={<ClipboardList size={18} />}
          tone="green"
        />
        <KpiCard
          title="Open Repairs"
          value={groupedRows.reduce((acc, row) => acc + row.open, 0).toLocaleString()}
          icon={<AlertTriangle size={18} />}
          tone="amber"
        />
        <KpiCard
          title="Revenue Attributed"
          value={money(groupedRows.reduce((acc, row) => acc + row.revenue, 0))}
          icon={<TrendingUp size={18} />}
          tone="indigo"
        />
      </div>
      <SectionCard title="Technician Performance Table">
        <SimpleTable
          columns={[
            { label: "Technician", value: "technician" },
            { label: "Total", value: (row) => row.total.toLocaleString() },
            { label: "Completed", value: (row) => row.completed.toLocaleString() },
            { label: "Open", value: (row) => row.open.toLocaleString() },
            { label: "Completion", value: (row) => `${row.completionRate.toFixed(1)}%` },
            { label: "Avg Days", value: (row) => row.avgTurnaround.toFixed(1) },
            { label: "Revenue", value: (row) => money(row.revenue) },
          ]}
          rows={groupedRows}
          emptyLabel="No technician data found."
        />
      </SectionCard>
    </>
  );
}

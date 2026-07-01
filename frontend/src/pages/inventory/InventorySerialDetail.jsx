import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../../lib/api";
import { AppCard, StickyTable } from "../../components/MuiPrimitives";

export default function InventorySerialDetail() {
  const navigate = useNavigate();
  const { serialId } = useParams();
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);

  const load = async () => {
    if (!serialId) return;
    setLoading(true);
    try {
      const res = await api.get(`/inventory/serials/${serialId}/detail`);
      setDetail(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [serialId]);

  const serial = detail?.serial || {};
  const sales = detail?.sales_history || [];
  const warranties = detail?.warranty_links || [];
  const returns = detail?.return_history || [];
  const movements = detail?.stock_movements || [];

  return (
    <div className="space-y-3">
      <AppCard title="Serial / IMEI Detail">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => navigate("/inventory/serials")} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200">
            Back
          </button>
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-300">
            Serial: <span className="font-mono text-slate-100">{serial.serial_number || `#${serialId}`}</span>
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-400">
            Product: {serial.item_name || "-"} ({serial.sku || "-"})
          </div>
          <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-400">
            Status: {serial.status || "-"}
          </div>
        </div>
      </AppCard>

      {loading && (
        <AppCard title="Loading">
          <p className="text-sm text-slate-400">Loading serial detail...</p>
        </AppCard>
      )}

      {!loading && detail && (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <AppCard title="Sales Hits"><p className="text-2xl font-black text-indigo-300">{sales.length}</p></AppCard>
            <AppCard title="Warranty Links"><p className="text-2xl font-black text-emerald-300">{warranties.length}</p></AppCard>
            <AppCard title="Return Records"><p className="text-2xl font-black text-amber-300">{returns.length}</p></AppCard>
            <AppCard title="Movements (Item)"><p className="text-2xl font-black text-slate-200">{movements.length}</p></AppCard>
          </div>

          <AppCard title="Sales History">
            <StickyTable
              maxHeight={360}
              rows={sales}
              columns={[
                { key: "invoice_no", label: "Invoice", render: (r) => <span className="text-indigo-300">{r.invoice_no}</span> },
                { key: "customer_name", label: "Customer", render: (r) => <span className="text-slate-200">{r.customer_name || "Walk-in"}</span> },
                { key: "quantity", label: "Qty", align: "right", render: (r) => <span className="text-slate-300">{Number(r.quantity || 0)}</span> },
                { key: "unit_price", label: "Unit Price", align: "right", render: (r) => <span className="text-slate-300">{Number(r.unit_price || 0).toLocaleString()}</span> },
                { key: "payment_method", label: "Payment", render: (r) => <span className="text-slate-500">{r.payment_method || "-"}</span> },
                { key: "created_at", label: "Date", render: (r) => <span className="text-slate-500">{r.created_at ? new Date(r.created_at).toLocaleString() : "-"}</span> },
              ]}
            />
          </AppCard>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <AppCard title="Warranty Linkage">
              <StickyTable
                maxHeight={300}
                rows={warranties}
                columns={[
                  { key: "warranty_code", label: "Warranty ID", render: (r) => <span className="text-indigo-300">{r.warranty_code}</span> },
                  { key: "status", label: "Status", render: (r) => <span className="text-slate-300">{r.status}</span> },
                  { key: "customer_name", label: "Customer", render: (r) => <span className="text-slate-300">{r.customer_name || "-"}</span> },
                  { key: "end_date", label: "Expiry", render: (r) => <span className="text-slate-500">{r.end_date ? new Date(r.end_date).toLocaleDateString() : "-"}</span> },
                ]}
              />
            </AppCard>
            <AppCard title="Return History">
              <StickyTable
                maxHeight={300}
                rows={returns}
                columns={[
                  { key: "return_code", label: "Return ID", render: (r) => <span className="text-indigo-300">{r.return_code}</span> },
                  { key: "return_type", label: "Type", render: (r) => <span className="text-slate-300">{r.return_type}</span> },
                  { key: "decision_status", label: "Status", render: (r) => <span className="text-slate-300">{r.decision_status}</span> },
                  { key: "quantity", label: "Qty", align: "right", render: (r) => <span className="text-slate-300">{Number(r.quantity || 0)}</span> },
                  { key: "created_at", label: "Date", render: (r) => <span className="text-slate-500">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "-"}</span> },
                ]}
              />
            </AppCard>
          </div>

          <AppCard title="Related Stock Movements">
            <StickyTable
              maxHeight={320}
              rows={movements}
              columns={[
                { key: "movement_type", label: "Type", render: (r) => <span className="text-slate-200">{r.movement_type}</span> },
                { key: "quantity", label: "Qty", align: "right", render: (r) => <span className="text-slate-300">{Number(r.quantity || 0)}</span> },
                { key: "reference_type", label: "Ref", render: (r) => <span className="text-slate-400">{r.reference_type || "-"}</span> },
                { key: "reference_id", label: "Ref ID", render: (r) => <span className="text-slate-500">{r.reference_id || "-"}</span> },
                { key: "note", label: "Note", render: (r) => <span className="text-slate-500">{r.note || "-"}</span> },
                { key: "created_at", label: "Date", render: (r) => <span className="text-slate-500">{r.created_at ? new Date(r.created_at).toLocaleString() : "-"}</span> },
              ]}
            />
          </AppCard>
        </>
      )}
    </div>
  );
}

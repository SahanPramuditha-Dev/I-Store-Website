import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../lib/api";
import { Badge, Button } from "../components/UI";
import { ArrowLeft } from "lucide-react";

export default function InvoiceView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) {
      setError("Missing invoice id");
      setLoading(false);
      return;
    }
    let mounted = true;
    setLoading(true);
    api
      .get(`/pos/sales/${encodeURIComponent(String(id))}`)
      .then(({ data }) => {
        if (!mounted) return;
        setInvoice(data);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err.response?.data?.detail || "Failed to load invoice");
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });
    return () => (mounted = false);
  }, [id]);

  if (loading) return <div className="p-4">Loading invoice...</div>;
  if (error) return (
    <div className="p-4">
      <div className="text-rose-300">{error}</div>
      <div className="mt-3">
        <Button variant="secondary" onClick={() => navigate(-1)}><ArrowLeft size={14}/> Back</Button>
      </div>
    </div>
  );

  if (!invoice) return <div className="p-4">Invoice not found.</div>;

  const items = invoice.lines || invoice.items || [];

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-black">Invoice {invoice.invoice_no || `#${invoice.id || id}`}</h2>
          <p className="text-sm text-slate-400">{new Date(invoice.created_at || invoice.date || Date.now()).toLocaleString()}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={invoice.is_voided ? "rose" : invoice.is_paid ? "green" : "amber"}>{invoice.is_voided ? "Voided" : invoice.is_paid ? "Paid" : "Unpaid"}</Badge>
          <Button variant="secondary" onClick={() => navigate(-1)}><ArrowLeft size={14}/> Back</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="panel p-4">
          <h3 className="font-semibold">Customer</h3>
          <p className="text-sm">{invoice.customer_name || "Walk-in"}</p>
          {invoice.customer_phone && <p className="text-sm">{invoice.customer_phone}</p>}
          {invoice.customer_address && <p className="text-sm">{invoice.customer_address}</p>}
        </div>
        <div className="panel p-4">
          <h3 className="font-semibold">Payment</h3>
          <p className="text-sm">Method: {invoice.payment_method || invoice.payment_type || "—"}</p>
          <p className="text-sm">Cashier: {invoice.cashier || invoice.served_by || "—"}</p>
          <p className="text-sm">Total: {invoice.total ? String(invoice.total) : "—"}</p>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full table-auto text-sm">
          <thead className="text-slate-400 text-left text-xs">
            <tr>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Price</th>
              <th className="px-3 py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx} className="border-t border-white/5">
                <td className="px-3 py-2">{it.name || it.item_name || it.description || "Item"}</td>
                <td className="px-3 py-2">{it.quantity || it.qty || 1}</td>
                <td className="px-3 py-2">{it.price || it.unit_price || "-"}</td>
                <td className="px-3 py-2">{it.total || it.amount || (Number(it.quantity || 1) * Number(it.price || it.unit_price || 0)).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex justify-end">
        <div className="w-full max-w-sm panel p-4">
          <div className="flex justify-between"><span>Subtotal</span><span>{invoice.subtotal ?? invoice.total_before_tax ?? "-"}</span></div>
          <div className="flex justify-between"><span>Discount</span><span>{invoice.discount_amount ?? 0}</span></div>
          <div className="flex justify-between"><span>Tax</span><span>{invoice.tax_amount ?? 0}</span></div>
          <div className="flex justify-between font-black text-lg mt-2"><span>Total</span><span>{invoice.total ?? invoice.grand_total ?? "-"}</span></div>
        </div>
      </div>
    </div>
  );
}

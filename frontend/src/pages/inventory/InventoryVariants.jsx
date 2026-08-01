import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useFetch } from "../../hooks/useFetch";
import api from "../../lib/api";
import { downloadCsv, downloadPdf, paginateRows } from "../../lib/tableUtils";
import { AppCard, StickyTable } from "../../components/MuiPrimitives";
import AppDrawer from "../../components/layout/AppDrawer";
import AppModal from "../../components/layout/AppModal";
import { Layers, Eye, DollarSign, Plus, Package, Hash, CheckCircle, Tag } from "lucide-react";

const currency = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;

export default function InventoryVariants() {
  const navigate = useNavigate();
  const { data, refetch } = useFetch("/inventory/variants");
  const rows = data || [];

  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  // Drawer state for drill-down items
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [variantItems, setVariantItems] = useState([]);

  // Bulk Price Modal state
  const [priceModalVariant, setPriceModalVariant] = useState(null);
  const [newPrice, setNewPrice] = useState("");
  const [priceSubmitting, setPriceSubmitting] = useState(false);
  const [priceError, setPriceError] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [r.brand, r.model, r.storage, r.color, r.condition, r.category].some((v) =>
        String(v || "").toLowerCase().includes(s)
      )
    );
  }, [rows, q]);

  const { pageRows, totalPages } = paginateRows(filtered, page, 20);

  // Open drill-down drawer
  const handleOpenDrawer = async (variant) => {
    setSelectedVariant(variant);
    setItemsLoading(true);
    try {
      const queryParams = new URLSearchParams({
        brand: variant.brand || "",
        model: variant.model || "",
        storage: variant.storage || "",
        color: variant.color || "",
        condition: variant.condition || "",
        category: variant.category || "",
      }).toString();

      const res = await api.get(`/inventory/variants/items?${queryParams}`);
      setVariantItems(res.data || []);
    } catch (err) {
      console.error("Failed to load variant items", err);
      setVariantItems([]);
    } finally {
      setItemsLoading(false);
    }
  };

  // Open price edit modal
  const handleOpenPriceModal = (variant) => {
    setPriceModalVariant(variant);
    setNewPrice(variant.avg_sale_price || "");
    setPriceError("");
  };

  // Submit bulk price update
  const handleBulkPriceSubmit = async (e) => {
    e.preventDefault();
    if (!priceModalVariant) return;
    const priceVal = parseFloat(newPrice);
    if (isNaN(priceVal) || priceVal <= 0) {
      setPriceError("Please enter a valid price greater than 0");
      return;
    }

    setPriceSubmitting(true);
    setPriceError("");
    try {
      await api.post("/inventory/variants/bulk-price", {
        brand: priceModalVariant.brand || "",
        model: priceModalVariant.model || "",
        storage: priceModalVariant.storage || "",
        color: priceModalVariant.color || "",
        condition: priceModalVariant.condition || "",
        category: priceModalVariant.category || "",
        new_sale_price: priceVal,
      });
      setPriceModalVariant(null);
      refetch();
    } catch (err) {
      setPriceError(err.message || "Failed to update price");
    } finally {
      setPriceSubmitting(false);
    }
  };

  // Quick ingest / add item for variant
  const handleCreateForVariant = (variant) => {
    navigate("/inventory/products", {
      state: {
        openAddProduct: true,
        prefill: {
          brand: variant.brand || "",
          model: variant.model || "",
          storage: variant.storage || "",
          color: variant.color || "",
          condition: variant.condition || "",
          category: variant.category || "",
        },
      },
    });
  };

  return (
    <>
      <AppCard
        title="Variant Catalog Matrix"
        subtitle="Aggregated stock, pricing, and serialized items grouped by spec combination."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search specs, brand, model..."
              className="w-64 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
            />
            <button
              onClick={() =>
                downloadCsv(
                  "inventory-variants.csv",
                  [
                    { label: "Brand", value: "brand" },
                    { label: "Model", value: "model" },
                    { label: "Storage", value: "storage" },
                    { label: "Color", value: "color" },
                    { label: "Condition", value: "condition" },
                    { label: "Category", value: "category" },
                    { label: "Quantity", value: "quantity" },
                    { label: "Product Batches", value: "product_count" },
                    { label: "Avg Sale Price", value: "avg_sale_price" },
                  ],
                  filtered
                )
              }
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/10"
            >
              Export CSV
            </button>
            <button
              onClick={async () =>
                downloadPdf(
                  "inventory-variants",
                  "Inventory Variants Report",
                  [
                    { label: "Brand", value: "brand" },
                    { label: "Model", value: "model" },
                    { label: "Storage", value: "storage" },
                    { label: "Color", value: "color" },
                    { label: "Condition", value: "condition" },
                    { label: "Category", value: "category" },
                    { label: "Quantity", value: "quantity" },
                    { label: "Product Batches", value: "product_count" },
                    { label: "Avg Sale Price", value: "avg_sale_price" },
                  ],
                  filtered
                )
              }
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/10"
            >
              Export PDF
            </button>
          </div>
        }
      >
        <StickyTable
          maxHeight={560}
          rows={pageRows}
          rowKey={(_, i) => i}
          columns={[
            {
              key: "brand",
              label: "Brand",
              render: (r) => (
                <span className="font-semibold text-slate-100">{r.brand || "-"}</span>
              ),
            },
            {
              key: "model",
              label: "Model",
              render: (r) => (
                <span className="font-semibold text-indigo-200">{r.model || "-"}</span>
              ),
            },
            {
              key: "storage",
              label: "Storage",
              render: (r) => (
                <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 border border-white/5">
                  {r.storage || "-"}
                </span>
              ),
            },
            {
              key: "color",
              label: "Color",
              render: (r) => (
                <span className="text-slate-300">{r.color || "-"}</span>
              ),
            },
            {
              key: "condition",
              label: "Condition",
              render: (r) => (
                <span className="rounded bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 text-xs font-medium text-indigo-300">
                  {r.condition || "-"}
                </span>
              ),
            },
            {
              key: "category",
              label: "Category",
              render: (r) => (
                <span className="text-slate-400">{r.category || "-"}</span>
              ),
            },
            {
              key: "quantity",
              label: "Stock Qty",
              align: "right",
              render: (r) => (
                <span className={`font-bold ${r.quantity > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {r.quantity}
                </span>
              ),
            },
            {
              key: "avg_sale_price",
              label: "Avg Sale",
              align: "right",
              render: (r) => (
                <span className="font-mono text-indigo-300">
                  {currency(r.avg_sale_price)}
                </span>
              ),
            },
            {
              key: "actions",
              label: "Actions",
              align: "center",
              render: (r) => (
                <div className="flex items-center justify-center gap-1">
                  <button
                    title="View Stock Items & Serials"
                    onClick={() => handleOpenDrawer(r)}
                    className="inline-flex items-center gap-1 rounded-md bg-indigo-600/20 border border-indigo-500/30 px-2 py-1 text-xs font-semibold text-indigo-200 hover:bg-indigo-600/40"
                  >
                    <Eye size={13} /> View Items
                  </button>
                  <button
                    title="Bulk Update Variant Sale Price"
                    onClick={() => handleOpenPriceModal(r)}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-600/20 border border-emerald-500/30 px-2 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-600/40"
                  >
                    <DollarSign size={13} /> Adjust Price
                  </button>
                  <button
                    title="Add Stock for this Spec"
                    onClick={() => handleCreateForVariant(r)}
                    className="inline-flex items-center gap-1 rounded-md bg-white/5 border border-white/10 px-2 py-1 text-xs font-semibold text-slate-300 hover:bg-white/10"
                  >
                    <Plus size={13} /> Add Stock
                  </button>
                </div>
              ),
            },
          ]}
        />
        <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
          <span>
            Total <strong className="text-slate-200">{filtered.length}</strong> unique variant specifications
          </span>
          <div className="inline-flex items-center gap-1">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded border border-white/10 bg-white/5 px-2.5 py-1 font-semibold hover:bg-white/10 disabled:opacity-40"
            >
              Prev
            </button>
            <span className="px-2">
              Page {page} of {totalPages || 1}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded border border-white/10 bg-white/5 px-2.5 py-1 font-semibold hover:bg-white/10 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </AppCard>

      {/* Drill-Down Side Drawer */}
      <AppDrawer
        open={Boolean(selectedVariant)}
        onClose={() => setSelectedVariant(null)}
        side="right"
        panelClassName="max-w-2xl bg-slate-950/95"
        title={
          selectedVariant
            ? `${selectedVariant.brand || ""} ${selectedVariant.model || ""}`.trim() || "Variant Stock Items"
            : "Variant Stock Items"
        }
        subtitle={
          selectedVariant
            ? `${selectedVariant.storage || ""} | ${selectedVariant.color || ""} | ${selectedVariant.condition || ""}`
            : ""
        }
      >
        {itemsLoading ? (
          <div className="flex h-64 items-center justify-center text-sm text-slate-400">
            Loading matching inventory items & serial numbers...
          </div>
        ) : variantItems.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-slate-400">
            <Package size={32} className="opacity-40" />
            <p className="text-sm">No active inventory items found for this spec variant.</p>
          </div>
        ) : (
          <div className="space-y-4 pr-1">
            {variantItems.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-white/10 bg-slate-900/60 p-4 space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-bold text-slate-100 text-sm">{item.name}</h4>
                    <p className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                      <span>SKU: {item.sku || "N/A"}</span>
                      <span>•</span>
                      <span>Category: {item.category || "Unassigned"}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-semibold text-slate-400">Stock Qty</div>
                    <div className="text-base font-extrabold text-emerald-400">{item.quantity}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs rounded-lg bg-black/30 p-2.5 border border-white/5">
                  <div>
                    <span className="text-slate-400 block">Unit Cost:</span>
                    <span className="font-mono text-slate-200">{currency(item.cost_price)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Unit Sale Price:</span>
                    <span className="font-mono text-indigo-300">{currency(item.sale_price)}</span>
                  </div>
                </div>

                {/* Serials List */}
                <div>
                  <div className="flex items-center gap-1 text-xs font-bold text-slate-300 mb-2">
                    <Hash size={13} className="text-indigo-400" />
                    Tracking Serials & IMEIs ({item.serials?.length || 0})
                  </div>
                  {item.serials?.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">No individual serial numbers tracked for this batch.</p>
                  ) : (
                    <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                      {item.serials.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center justify-between rounded bg-white/5 px-2.5 py-1.5 text-xs border border-white/5"
                        >
                          <span className="font-mono text-slate-200">{s.serial_number}</span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              s.status === "available"
                                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                                : s.status === "sold"
                                ? "bg-slate-700 text-slate-400"
                                : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                            }`}
                          >
                            {s.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </AppDrawer>

      {/* Bulk Price Adjustment Modal */}
      <AppModal
        open={Boolean(priceModalVariant)}
        onClose={() => setPriceModalVariant(null)}
        title="Bulk Price Adjustment for Variant"
        maxWidth="sm"
      >
        {priceModalVariant && (
          <form onSubmit={handleBulkPriceSubmit} className="space-y-4">
            <div className="rounded-lg bg-slate-900 p-3 text-xs space-y-1 border border-white/10">
              <div className="text-slate-400">Target Variant Specification:</div>
              <div className="font-bold text-slate-100 text-sm">
                {priceModalVariant.brand} {priceModalVariant.model}
              </div>
              <div className="text-indigo-300">
                {priceModalVariant.storage || "N/A"} | {priceModalVariant.color || "N/A"} | {priceModalVariant.condition || "N/A"}
              </div>
              <div className="text-slate-400 pt-1">
                Current Avg Sale Price: <strong className="text-slate-200">{currency(priceModalVariant.avg_sale_price)}</strong>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                New Sale Price (Rs.)
              </label>
              <input
                type="number"
                step="0.01"
                min="1"
                required
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                placeholder="Enter new sale price"
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none font-mono"
              />
            </div>

            {priceError && (
              <div className="rounded bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-xs text-rose-300">
                {priceError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setPriceModalVariant(null)}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={priceSubmitting}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {priceSubmitting ? "Updating..." : "Apply New Price"}
              </button>
            </div>
          </form>
        )}
      </AppModal>
    </>
  );
}

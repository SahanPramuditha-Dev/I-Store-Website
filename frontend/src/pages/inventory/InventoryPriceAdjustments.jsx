import { useMemo, useState } from "react";
import api from "../../lib/api";
import { useFetch } from "../../hooks/useFetch";
import { downloadCsv, downloadPdf, paginateRows } from "../../lib/tableUtils";
import { AppCard, StickyTable } from "../../components/MuiPrimitives";
import { Select } from "../../components/UI";

const money = (value) => `Rs. ${Number(value || 0).toLocaleString()}`;

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function marginPercent(salePrice, costPrice) {
  const sale = Number(salePrice || 0);
  const cost = Number(costPrice || 0);
  if (sale <= 0) return null;
  return ((sale - cost) / sale) * 100;
}

export default function InventoryPriceAdjustments() {
  const { data: items } = useFetch("/inventory");
  const { data, setData } = useFetch("/inventory/price-adjustments");
  const inventory = Array.isArray(items) ? items : [];
  const rows = Array.isArray(data) ? data : [];

  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({
    scope: "single",
    item_id: "",
    category: "",
    brand: "",
    bulk_query: "",
    mode: "absolute",
    target: "both",
    new_cost_price: "",
    new_sale_price: "",
    percent_change: "",
    reason: "",
  });

  const categories = useMemo(
    () => [...new Set(inventory.map((item) => String(item.category || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [inventory],
  );
  const brands = useMemo(
    () => [...new Set(inventory.map((item) => String(item.brand || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [inventory],
  );

  const selectedItem = useMemo(
    () => inventory.find((item) => String(item.id) === String(form.item_id)) || null,
    [inventory, form.item_id],
  );

  const bulkItems = useMemo(() => {
    const q = String(form.bulk_query || "").trim().toLowerCase();
    return inventory.filter((item) => {
      if (form.category && String(item.category || "") !== form.category) return false;
      if (form.brand && String(item.brand || "") !== form.brand) return false;
      if (!q) return true;
      const hay = `${item.name || ""} ${item.sku || ""} ${item.barcode || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [form.brand, form.bulk_query, form.category, inventory]);

  const projectedSingle = useMemo(() => {
    if (!selectedItem) return null;
    const target = String(form.target || "both").toLowerCase();
    const mode = String(form.mode || "absolute").toLowerCase();
    const currentCost = toNumber(selectedItem.cost_price, 0);
    const currentSale = toNumber(selectedItem.sale_price, 0);

    let nextCost = currentCost;
    let nextSale = currentSale;
    if (mode === "percentage") {
      const factor = 1 + toNumber(form.percent_change, 0) / 100;
      if (target === "both" || target === "cost") nextCost = Math.max(0, currentCost * factor);
      if (target === "both" || target === "sale") nextSale = Math.max(0, currentSale * factor);
    } else {
      if (target === "both" || target === "cost") {
        nextCost = Math.max(0, toNumber(form.new_cost_price, currentCost));
      }
      if (target === "both" || target === "sale") {
        nextSale = Math.max(0, toNumber(form.new_sale_price, currentSale));
      }
    }

    return {
      currentCost,
      currentSale,
      nextCost,
      nextSale,
      currentMarginPct: marginPercent(currentSale, currentCost),
      nextMarginPct: marginPercent(nextSale, nextCost),
    };
  }, [form.mode, form.new_cost_price, form.new_sale_price, form.percent_change, form.target, selectedItem]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        String(row.item_name || "").toLowerCase().includes(q) ||
        String(row.reason || "").toLowerCase().includes(q),
    );
  }, [rows, query]);
  const { pageRows, totalPages } = paginateRows(filtered, page, 20);

  const submit = async () => {
    const scope = String(form.scope || "single").toLowerCase();
    const mode = String(form.mode || "absolute").toLowerCase();
    const target = String(form.target || "both").toLowerCase();

    const targetItems = scope === "single"
      ? (form.item_id ? [Number(form.item_id)] : [])
      : bulkItems.map((item) => Number(item.id));

    if (targetItems.length === 0) return;

    const payload = {
      mode,
      target,
      reason: form.reason || "",
    };

    if (scope === "single") payload.item_id = targetItems[0];
    else payload.item_ids = targetItems;

    if (mode === "percentage") {
      if (String(form.percent_change).trim() === "") return;
      payload.percent_change = toNumber(form.percent_change, 0);
    } else {
      if (target === "both" || target === "cost") {
        if (String(form.new_cost_price).trim() === "") return;
        payload.new_cost_price = toNumber(form.new_cost_price, 0);
      }
      if (target === "both" || target === "sale") {
        if (String(form.new_sale_price).trim() === "") return;
        payload.new_sale_price = toNumber(form.new_sale_price, 0);
      }
    }

    const res = await api.post("/inventory/price-adjustments", payload);
    const added = Array.isArray(res.data?.adjustments) ? res.data.adjustments : [];
    if (added.length > 0) {
      setData((prev) => [...added, ...(Array.isArray(prev) ? prev : [])]);
    }

    setForm((prev) => ({
      ...prev,
      item_id: "",
      new_cost_price: "",
      new_sale_price: "",
      percent_change: "",
      reason: "",
    }));
  };

  return (
    <div className="space-y-3">
      <AppCard title="Price Adjustment Tools">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Select
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
            value={form.scope}
            onChange={(e) => setForm({ ...form, scope: e.target.value })}
          >
            <option value="single">Single Product</option>
            <option value="bulk">Bulk (Filtered)</option>
          </Select>

          {form.scope === "single" ? (
            <Select
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
              value={form.item_id}
              onChange={(e) => setForm({ ...form, item_id: e.target.value })}
            >
              <option value="">Select product</option>
              {inventory.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          ) : (
            <input
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
              placeholder="Bulk search by name / SKU"
              value={form.bulk_query}
              onChange={(e) => setForm({ ...form, bulk_query: e.target.value })}
            />
          )}

          <Select
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
            value={form.mode}
            onChange={(e) => setForm({ ...form, mode: e.target.value })}
          >
            <option value="absolute">Absolute Prices</option>
            <option value="percentage">Percentage Change</option>
          </Select>

          <Select
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
            value={form.target}
            onChange={(e) => setForm({ ...form, target: e.target.value })}
          >
            <option value="both">Target: Cost + Sale</option>
            <option value="sale">Target: Sale Only</option>
            <option value="cost">Target: Cost Only</option>
          </Select>

          <Select
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            disabled={form.scope !== "bulk"}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>

          <Select
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 disabled:opacity-50"
            value={form.brand}
            onChange={(e) => setForm({ ...form, brand: e.target.value })}
            disabled={form.scope !== "bulk"}
          >
            <option value="">All brands</option>
            {brands.map((brand) => (
              <option key={brand} value={brand}>
                {brand}
              </option>
            ))}
          </Select>
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
          {form.mode === "percentage" && (
            <input
              type="number"
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
              placeholder="Change % (ex: 7.5 / -3)"
              value={form.percent_change}
              onChange={(e) => setForm({ ...form, percent_change: e.target.value })}
            />
          )}
          {form.mode === "absolute" && (form.target === "both" || form.target === "cost") && (
            <input
              type="number"
              min="0"
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
              placeholder="New cost price"
              value={form.new_cost_price}
              onChange={(e) => setForm({ ...form, new_cost_price: e.target.value })}
            />
          )}
          {form.mode === "absolute" && (form.target === "both" || form.target === "sale") && (
            <input
              type="number"
              min="0"
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
              placeholder="New selling price"
              value={form.new_sale_price}
              onChange={(e) => setForm({ ...form, new_sale_price: e.target.value })}
            />
          )}
          <input
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100"
            placeholder="Reason"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
            {form.scope === "single"
              ? `Selected: ${selectedItem ? selectedItem.name : "No product selected"}`
              : `Bulk target items: ${bulkItems.length}`}
          </div>
          <button onClick={submit} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white">
            Apply Adjustment
          </button>
        </div>

        {selectedItem && projectedSingle && (
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
              <p className="text-slate-500">Current</p>
              <p>Cost: <span className="text-slate-100">{money(projectedSingle.currentCost)}</span></p>
              <p>Sale: <span className="text-slate-100">{money(projectedSingle.currentSale)}</span></p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
              <p className="text-slate-500">Projected</p>
              <p>Cost: <span className="text-amber-300">{money(projectedSingle.nextCost)}</span></p>
              <p>Sale: <span className="text-emerald-300">{money(projectedSingle.nextSale)}</span></p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
              <p className="text-slate-500">Current Margin</p>
              <p className="text-slate-100">
                {projectedSingle.currentMarginPct === null ? "-" : `${projectedSingle.currentMarginPct.toFixed(2)}%`}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
              <p className="text-slate-500">Projected Margin</p>
              <p className="text-indigo-300">
                {projectedSingle.nextMarginPct === null ? "-" : `${projectedSingle.nextMarginPct.toFixed(2)}%`}
              </p>
            </div>
          </div>
        )}
      </AppCard>

      <AppCard
        title="Adjustment History"
        actions={(
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search product/reason..."
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-slate-100"
            />
            <button
              onClick={() =>
                downloadCsv(
                  "inventory-price-adjustments.csv",
                  [
                    { label: "Product", value: "item_name" },
                    { label: "Old Cost", value: "old_cost_price" },
                    { label: "Old Sale", value: "old_sale_price" },
                    {
                      label: "Old Margin %",
                      value: (row) =>
                        row.old_margin_pct ??
                        marginPercent(row.old_sale_price, row.old_cost_price)?.toFixed(2) ??
                        "-",
                    },
                    { label: "New Cost", value: "new_cost_price" },
                    { label: "New Sale", value: "new_sale_price" },
                    {
                      label: "New Margin %",
                      value: (row) =>
                        row.new_margin_pct ??
                        marginPercent(row.new_sale_price, row.new_cost_price)?.toFixed(2) ??
                        "-",
                    },
                    { label: "Reason", value: "reason" },
                    { label: "Created At", value: "created_at" },
                  ],
                  filtered,
                )
              }
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200"
            >
              Export CSV
            </button>
            <button
              onClick={async () =>
                downloadPdf(
                  "inventory-price-adjustments",
                  "Inventory Price Adjustments Report",
                  [
                    { label: "Product", value: "item_name" },
                    { label: "Old Cost", value: "old_cost_price" },
                    { label: "Old Sale", value: "old_sale_price" },
                    {
                      label: "Old Margin %",
                      value: (row) =>
                        row.old_margin_pct ??
                        marginPercent(row.old_sale_price, row.old_cost_price)?.toFixed(2) ??
                        "-",
                    },
                    { label: "New Cost", value: "new_cost_price" },
                    { label: "New Sale", value: "new_sale_price" },
                    {
                      label: "New Margin %",
                      value: (row) =>
                        row.new_margin_pct ??
                        marginPercent(row.new_sale_price, row.new_cost_price)?.toFixed(2) ??
                        "-",
                    },
                    { label: "Reason", value: "reason" },
                    { label: "Created At", value: "created_at" },
                  ],
                  filtered,
                )
              }
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200"
            >
              Export PDF
            </button>
          </div>
        )}
      >
        <StickyTable
          maxHeight={520}
          rows={pageRows}
          columns={[
            { key: "item_name", label: "Product", render: (row) => <span className="text-slate-200">{row.item_name}</span> },
            { key: "old_cost_price", label: "Old Cost", render: (row) => <span className="text-slate-400">{money(row.old_cost_price)}</span> },
            { key: "old_sale_price", label: "Old Sale", render: (row) => <span className="text-slate-400">{money(row.old_sale_price)}</span> },
            {
              key: "old_margin_pct",
              label: "Old Margin",
              render: (row) => {
                const value = row.old_margin_pct ?? marginPercent(row.old_sale_price, row.old_cost_price);
                return <span className="text-slate-400">{value === null ? "-" : `${Number(value).toFixed(2)}%`}</span>;
              },
            },
            { key: "new_cost_price", label: "New Cost", render: (row) => <span className="text-amber-300">{money(row.new_cost_price)}</span> },
            { key: "new_sale_price", label: "New Sale", render: (row) => <span className="text-emerald-300">{money(row.new_sale_price)}</span> },
            {
              key: "new_margin_pct",
              label: "New Margin",
              render: (row) => {
                const value = row.new_margin_pct ?? marginPercent(row.new_sale_price, row.new_cost_price);
                return <span className="text-indigo-300">{value === null ? "-" : `${Number(value).toFixed(2)}%`}</span>;
              },
            },
            { key: "reason", label: "Reason", render: (row) => <span className="text-slate-300">{row.reason || "-"}</span> },
            {
              key: "created_at",
              label: "Date",
              render: (row) => (
                <span className="text-slate-500">{row.created_at ? new Date(row.created_at).toLocaleString() : "-"}</span>
              ),
            },
          ]}
        />
        <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
          <span>{filtered.length} adjustments</span>
          <div className="inline-flex items-center gap-1">
            <button
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
              className="rounded border border-white/10 px-2 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <span>{page} / {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
              className="rounded border border-white/10 px-2 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </AppCard>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useFetch } from "../../hooks/useFetch";
import api from "../../lib/api";
import { AppCard, StickyTable } from "../../components/MuiPrimitives";
import AppModal from "../../components/layout/AppModal";
import { Select } from "../../components/UI";
import { useFeedback } from "../../components/FeedbackProvider";
import { Layers, Plus, Sparkles, Check, Wand2, Package, Eye, Tag, AlertCircle, Boxes, Trash2, Edit, Printer, Copy, FileText } from "lucide-react";

export default function MasterProducts() {
  const { confirm, toast } = useFeedback();
  const { data: masterProducts, refresh: refreshProducts } = useFetch("/catalog/products");
  const { data: attributes, refresh: refreshAttributes } = useFetch("/catalog/attributes");
  const { data: presets, refresh: refreshPresets } = useFetch("/catalog/presets");
  const { data: productTypes } = useFetch("/catalog/product-types");
  const { data: brands } = useFetch("/inventory/brands");
  const { data: categories } = useFetch("/inventory/categories");

  const productsList = masterProducts || [];
  const attributeList = attributes || [];
  const presetList = presets || [];
  const productTypeList = productTypes || [];

  const [q, setQ] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);

  // Wizard Form State
  const [form, setForm] = useState({
    name: "",
    brand_id: "",
    category_id: "",
    product_type_id: "",
    description: "",
    has_variants: true,
    master_image_url: "",
    default_cost_price: 0,
    default_selling_price: 0,
    selected_value_ids: [],
  });

  // Matrix Preview State
  const [previewLoading, setPreviewLoading] = useState(false);
  const [variantPreviews, setVariantPreviews] = useState([]);
  const [createdProductId, setCreatedProductId] = useState(null);

  // Attribute Creation State inside Wizard
  const [newAttrModal, setNewAttrModal] = useState(false);
  const [newAttrName, setNewAttrName] = useState("");
  const [newValName, setNewValName] = useState("");
  const [selectedAttrForVal, setSelectedAttrForVal] = useState(null);

  // Edit Specific Variant State
  const [editingVariantModal, setEditingVariantModal] = useState(false);
  const [editingVariant, setEditingVariant] = useState(null);
  const [editVariantForm, setEditVariantForm] = useState({
    sku: "",
    barcode: "",
    default_cost_price: 0,
    default_selling_price: 0,
    status: "ACTIVE",
  });

  // Barcode / Label Printing State
  const [printLabelModal, setPrintLabelModal] = useState(false);
  const [printTarget, setPrintTarget] = useState(null);
  const [labelQty, setLabelQty] = useState(1);

  const filteredProducts = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return productsList;
    return productsList.filter(
      (p) =>
        p.name.toLowerCase().includes(s) ||
        (p.brand && p.brand.toLowerCase().includes(s)) ||
        (p.category && p.category.toLowerCase().includes(s))
    );
  }, [productsList, q]);

  // Toggle attribute value checkbox
  const toggleValueSelection = (valId) => {
    const idStr = String(valId);
    setForm((prev) => {
      const prevArr = Array.isArray(prev.selected_value_ids) ? prev.selected_value_ids : [];
      const exists = prevArr.includes(idStr);
      return {
        ...prev,
        selected_value_ids: exists
          ? prevArr.filter((id) => id !== idStr)
          : [...prevArr, idStr],
      };
    });
  };

  // Step 1 -> Step 2 / Save Single Product
  const handleStep1Submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;

    if (!form.has_variants) {
      // Create single product without variants
      try {
        await api.post("/catalog/products", form);
        setWizardOpen(false);
        refreshProducts();
        resetWizard();
      } catch (err) {
        toast(err.response?.data?.detail || err.message || "Failed to create single product", "error");
      }
      return;
    }

    setWizardStep(2);
  };

  // Step 2 -> Generate Matrix Preview
  const handleGeneratePreview = async () => {
    if (form.selected_value_ids.length === 0) {
      toast("Please select at least one attribute value to generate variants.", "warning");
      return;
    }

    setPreviewLoading(true);
    try {
      let prodId = createdProductId;
      if (!prodId) {
        // Create Master Product First if not already created
        const res = await api.post("/catalog/products", form);
        prodId = res.data.id;
        setCreatedProductId(prodId);
      }

      // Fetch Preview Matrix
      const previewRes = await api.post(`/catalog/products/${prodId}/generate-variants-preview`, {
        attribute_value_ids: (form.selected_value_ids || []).map((id) => Number(id)),
        default_cost_price: form.default_cost_price,
        default_selling_price: form.default_selling_price,
      });

      setVariantPreviews(previewRes.data.variants || []);
      setWizardStep(3);
    } catch (err) {
      const detail = err.response?.data?.detail || err.response?.data || err.message || "Failed to generate variant matrix";
      console.error("Generate preview error:", err);
      toast(detail, "error");
    } finally {
      setPreviewLoading(false);
    }
  };

  // Toggle individual variant in Preview Matrix
  const togglePreviewVariant = (previewId) => {
    setVariantPreviews((prev) =>
      prev.map((v) => (v.id === previewId ? { ...v, selected: !v.selected } : v))
    );
  };

  // Step 3 -> Finalize & Save Variants
  const handleSaveVariants = async () => {
    const selectedVariants = variantPreviews.filter((v) => v.selected);
    if (selectedVariants.length === 0) {
      toast("Please select at least one variant combination to create.", "warning");
      return;
    }

    try {
      await api.post(`/catalog/products/${createdProductId}/save-variants`, {
        variants: selectedVariants,
      });
      setWizardOpen(false);
      refreshProducts();
      resetWizard();
    } catch (err) {
      toast(err.response?.data?.detail || err.message || "Failed to save variant matrix", "error");
    }
  };

  // Create new attribute value
  const handleAddAttrValue = async () => {
    if (!newValName.trim() || !selectedAttrForVal) return;
    try {
      await api.post(`/catalog/attributes/${selectedAttrForVal.id}/values`, {
        value: newValName.trim(),
      });
      setNewValName("");
      setSelectedAttrForVal(null);
      refreshAttributes();
    } catch (err) {
      toast(err.response?.data?.detail || err.message || "Failed to add attribute value", "error");
    }
  };

  // Create new attribute
  const handleAddAttribute = async (e) => {
    e.preventDefault();
    if (!newAttrName.trim()) return;
    try {
      const res = await api.post("/catalog/attributes", {
        name: newAttrName.trim(),
        display_name: newAttrName.trim(),
      });
      const createdAttr = {
        id: res.data.id,
        name: res.data.name || newAttrName.trim(),
        display_name: newAttrName.trim(),
        values: [],
      };
      setNewAttrName("");
      setNewAttrModal(false);
      setSelectedAttrForVal(createdAttr);
      refreshAttributes();
    } catch (err) {
      toast(err.response?.data?.detail || err.message || "Failed to add attribute", "error");
    }
  };

  const handleRemoveAttribute = async (attr) => {
    const ok = await confirm(
      "Delete Attribute",
      `Delete "${attr.display_name || attr.name}"? This cannot be undone.`
    );
    if (!ok) return;

    try {
      await api.delete(`/catalog/attributes/${attr.id}`);
      if (selectedAttrForVal?.id === attr.id) {
        setSelectedAttrForVal(null);
        setNewValName("");
      }
      refreshAttributes();
      toast(`Deleted ${attr.display_name || attr.name}`, "success");
    } catch (err) {
      toast(err.response?.data?.detail || err.message || "Failed to delete attribute", "error");
    }
  };

  const handleRemoveValue = async (attr, value) => {
    const ok = await confirm("Delete Value", `Delete value \"${value.value}\"? This cannot be undone.`);
    if (!ok) return;

    try {
      await api.delete(`/catalog/attributes/values/${value.id}`);
      refreshAttributes();
      toast(`Deleted ${value.value}`, "success");
    } catch (err) {
      toast(err.response?.data?.detail || err.message || "Failed to delete attribute value", "error");
    }
  };


  const resetWizard = () => {
    setForm({
      name: "",
      brand_id: "",
      category_id: "",
      description: "",
      has_variants: true,
      master_image_url: "",
      default_cost_price: 0,
      default_selling_price: 0,
      selected_value_ids: [],
    });
    setWizardStep(1);
    setVariantPreviews([]);
    setCreatedProductId(null);
    setNewAttrModal(false);
    setNewAttrName("");
    setNewValName("");
    setSelectedAttrForVal(null);
  };

  return (
    <>
      <AppCard
        title="Master Product Catalog & Variation Matrix"
        subtitle="Manage master product templates, variant spec combinations, and inventory hierarchy."
        actions={
          <div className="flex items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search master products..."
              className="w-64 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
            />
            <button
              onClick={() => {
                resetWizard();
                setWizardOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-indigo-500 shadow-md shadow-indigo-600/20"
            >
              <Plus size={14} /> New Master Product
            </button>
          </div>
        }
      >
        <StickyTable
          maxHeight={560}
          rows={filteredProducts}
          rowKey={(r) => r.id}
          columns={[
            {
              key: "name",
              label: "Product Name",
              render: (r) => (
                <div>
                  <div className="font-bold text-slate-100">{r.name}</div>
                  <div className="text-[11px] text-slate-400">
                    {r.has_variants ? (
                      <span className="text-indigo-400 font-semibold">Master Product ({r.variant_count} Variants)</span>
                    ) : (
                      <span className="text-emerald-400 font-semibold">Single Item (No Variations)</span>
                    )}
                  </div>
                </div>
              ),
            },
            {
              key: "brand",
              label: "Brand",
              render: (r) => <span className="text-slate-200">{r.brand || "-"}</span>,
            },
            {
              key: "category",
              label: "Category",
              render: (r) => <span className="text-slate-300">{r.category || "-"}</span>,
            },
            {
              key: "variants",
              label: "Configured Variations",
              render: (r) => (
                <div className="flex flex-wrap gap-1.5 max-w-lg">
                  {r.variants?.length === 0 ? (
                    <span className="text-xs text-slate-500 italic">No variants created</span>
                  ) : (
                    r.variants?.slice(0, 4).map((v) => (
                      <div
                        key={v.id}
                        className="inline-flex items-center gap-1.5 rounded-md bg-slate-950/70 border border-white/10 px-2 py-1 text-[11px] font-mono text-slate-200 shadow-sm hover:border-indigo-500/40 transition-colors"
                      >
                        <Tag size={11} className="text-indigo-400 shrink-0" />
                        <span>{v.sku}</span>
                        {v.default_selling_price > 0 && (
                          <span className="text-[10px] text-emerald-400 font-sans font-semibold">
                            Rs.{v.default_selling_price.toLocaleString()}
                          </span>
                        )}
                        <span className={`text-[9px] font-sans px-1 py-0.2 rounded font-bold ${v.stock > 0 ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>
                          {v.stock} in stock
                        </span>
                        <div className="flex items-center gap-1 ml-0.5 border-l border-white/10 pl-1.5">
                          <button
                            onClick={() => {
                              setEditingVariant(v);
                              setEditVariantForm({
                                sku: v.sku || "",
                                barcode: v.barcode || "",
                                default_cost_price: v.default_cost_price || 0,
                                default_selling_price: v.default_selling_price || 0,
                                status: v.status || "ACTIVE",
                              });
                              setEditingVariantModal(true);
                            }}
                            className="text-slate-400 hover:text-indigo-400 transition-colors p-0.5"
                            title="Edit Variant Details & Pricing"
                          >
                            <Edit size={11} />
                          </button>
                          <button
                            onClick={() => {
                              setPrintTarget({ ...v, product_name: r.name });
                              setLabelQty(1);
                              setPrintLabelModal(true);
                            }}
                            className="text-slate-400 hover:text-amber-400 transition-colors p-0.5"
                            title="Print Barcode Label"
                          >
                            <Printer size={11} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                  {r.variants?.length > 4 && (
                    <span className="text-[10px] text-indigo-400 font-semibold self-center">
                      +{r.variants.length - 4} more
                    </span>
                  )}
                </div>
              ),
            },
            {
              key: "status",
              label: "Status",
              align: "center",
              render: (r) => (
                <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-400">
                  {r.status}
                </span>
              ),
            },
            {
              key: "actions",
              label: "Actions",
              align: "right",
              render: (r) => (
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    onClick={() => {
                      setForm({
                        name: r.name,
                        brand_id: r.brand_id || "",
                        category_id: r.category_id || "",
                        description: r.description || "",
                        has_variants: true,
                        master_image_url: r.master_image_url || "",
                        default_cost_price: 0,
                        default_selling_price: 0,
                        selected_value_ids: [],
                      });
                      setCreatedProductId(r.id);
                      setWizardStep(2);
                      setWizardOpen(true);
                    }}
                    className="inline-flex items-center gap-1 rounded bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 px-2 py-1 text-xs font-semibold text-indigo-300 transition-colors"
                    title="Add Variant"
                  >
                    <Plus size={12} /> Variant
                  </button>
                  <button
                    onClick={async () => {
                      const ok = await confirm(
                        "Delete Product",
                        `Are you sure you want to delete "${r.name}"? This will remove all unstocked variant templates.`
                      );
                      if (!ok) return;
                      try {
                        await api.delete(`/catalog/products/${r.id}`);
                        refreshProducts();
                        toast(`Deleted ${r.name}`, "success");
                      } catch (err) {
                        toast(err.response?.data?.detail || err.message || "Failed to delete product", "error");
                      }
                    }}
                    className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                    title="Delete Product"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ),
            },
          ]}
        />
      </AppCard>

      {/* Master Product & Variant Matrix Wizard Modal */}
      <AppModal
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        title={
          <div className="flex min-w-0 flex-wrap items-center gap-3 sm:flex-nowrap sm:gap-4">
            <div className="flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/30 text-white h-10 w-10">
              <Boxes size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-bold text-white tracking-wide">
                {wizardStep === 1
                  ? "Master Product Definition"
                  : wizardStep === 2
                  ? "Variation Attributes Setup"
                  : "Variant Matrix Preview"}
              </h3>
              <p className="text-xs text-slate-400">Step {wizardStep} of 3 • Catalog Management</p>
            </div>
            <div className="hidden sm:flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-slate-950/60 p-1.5">
              <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${wizardStep === 1 ? "bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-500/20" : "text-slate-500"}`}>
                1. Info
              </span>
              <span className="text-slate-700 text-xs">/</span>
              <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${wizardStep === 2 ? "bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-500/20" : "text-slate-500"}`}>
                2. Attributes
              </span>
              <span className="text-slate-700 text-xs">/</span>
              <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${wizardStep === 3 ? "bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-500/20" : "text-slate-500"}`}>
                3. Matrix
              </span>
            </div>
          </div>
        }
        maxWidth={wizardStep === 3 ? "2xl" : "lg"}
      >
        <div className="px-5 py-5 sm:px-6 sm:py-6">
        {wizardStep === 1 && (
          <form onSubmit={handleStep1Submit} className="space-y-5">
            {/* Product Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                Product Name <span className="text-rose-400">*</span>
              </label>
              <div className="relative group">
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Samsung Galaxy A56 5G"
                  className="w-full rounded-xl border border-white/15 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 transition-all focus:border-indigo-500 focus:bg-slate-950 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </div>

            {/* Brand, Category & Product Type Selectors */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                  Brand
                </label>
                <Select
                  className="w-full"
                  size="lg"
                  value={form.brand_id}
                  onChange={(e) => setForm({ ...form, brand_id: e.target.value })}
                  placeholder="Select Brand"
                >
                  {brands?.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                  Category
                </label>
                <Select
                  className="w-full"
                  size="lg"
                  value={form.category_id}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                  placeholder="Select Category"
                >
                  {categories?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                  Product Type
                </label>
                <Select
                  className="w-full"
                  size="lg"
                  value={form.product_type_id}
                  onChange={(e) => setForm({ ...form, product_type_id: e.target.value })}
                  placeholder="Select Type"
                >
                  {productTypeList?.map((pt) => (
                    <option key={pt.id} value={pt.id}>
                      {pt.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {/* Has Variations Toggle Banner */}
            <div className={`relative overflow-hidden rounded-2xl border p-4 transition-all duration-300 ${form.has_variants ? "border-indigo-500/40 bg-gradient-to-r from-indigo-950/40 via-purple-950/20 to-slate-950 shadow-lg shadow-indigo-950/30" : "border-white/10 bg-slate-950/60"}`}>
              <div className="flex items-start gap-3.5">
                <input
                  type="checkbox"
                  id="has_variants"
                  checked={form.has_variants}
                  onChange={(e) => setForm({ ...form, has_variants: e.target.checked })}
                  className="mt-1 h-5 w-5 rounded-md border-white/20 bg-slate-900 text-indigo-600 focus:ring-indigo-500/30 cursor-pointer transition"
                />
                <label htmlFor="has_variants" className="flex-1 cursor-pointer select-none">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white tracking-wide">Product Has Variations</span>
                    {form.has_variants && (
                      <span className="rounded-full bg-indigo-500/20 px-2.5 py-0.5 text-[10px] font-bold text-indigo-300 border border-indigo-500/30 uppercase">
                        Matrix Enabled
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-400">
                    Enable if product sells in different Storage, Color, RAM, or Condition combinations.
                  </p>
                </label>
              </div>
            </div>

            {/* Footer Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
              <button
                type="button"
                onClick={() => setWizardOpen(false)}
                className="rounded-xl border border-white/10 bg-slate-900 px-5 py-2.5 text-xs font-bold text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:from-indigo-500 hover:to-purple-500 transition-all transform active:scale-95"
              >
                {form.has_variants ? (
                  <>
                    Next: Choose Attributes <span className="text-indigo-200">&rarr;</span>
                  </>
                ) : (
                  "Save Single Product"
                )}
              </button>
            </div>
          </form>
        )}

        {wizardStep === 2 && (
          <div className="flex min-h-[320px] flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs leading-relaxed text-slate-400">
                Select values for each attribute to generate the matrix for{" "}
                <strong className="text-indigo-300">{form.name}</strong>.
              </div>
              <div className="flex items-center gap-2">
                {presetList.length > 0 && (
                  <Select
                    size="sm"
                    placeholder="Load Preset Template..."
                    onChange={(e) => {
                      const selectedId = e.target.value;
                      if (!selectedId) return;
                      const preset = presetList.find((p) => String(p.id) === String(selectedId));
                      if (!preset) return;
                      try {
                        const attrIds = typeof preset.attribute_ids === "string" ? JSON.parse(preset.attribute_ids) : preset.attribute_ids;
                        const matchingVals = attributeList
                          .filter((a) => attrIds.map(Number).includes(Number(a.id)))
                          .flatMap((a) => (a.values || []).map((v) => String(v.id)));
                        setForm((prev) => ({ ...prev, selected_value_ids: matchingVals }));
                        toast(`Loaded preset "${preset.name}"`, "info");
                      } catch (err) {
                        console.error(err);
                      }
                    }}
                    options={presetList.map((p) => ({ value: p.id, label: `Preset: ${p.name}` }))}
                  />
                )}
                <button
                  type="button"
                  onClick={() => setNewAttrModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs font-bold text-indigo-300 hover:bg-indigo-500/15"
                >
                  <Plus size={14} /> Add Attribute
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto pr-1">
              {attributeList.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 bg-black/20 px-4 py-5 text-center text-xs text-slate-400">
                  No attributes are configured yet. Add at least one attribute and its values before generating a variant matrix.
                </div>
              ) : (
                attributeList.map((attr) => (
                  <div key={attr.id} className="rounded-lg border border-white/10 bg-slate-900/60 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-200 text-xs uppercase tracking-wider">{attr.display_name}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveAttribute(attr)}
                          className="inline-flex items-center gap-1 rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/20"
                          title="Remove attribute"
                        >
                          <Trash2 size={10} /> Remove
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedAttrForVal(attr)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-400 hover:underline"
                      >
                        <Plus size={12} /> Add Value
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                          {attr.values?.length === 0 ? (
                        <span className="text-xs text-slate-500 italic">No values configured</span>
                      ) : (
                        attr.values.map((v) => {
                          const checked = (form.selected_value_ids || []).includes(String(v.id));
                          return (
                            <div
                              key={v.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => toggleValueSelection(v.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  toggleValueSelection(v.id);
                                }
                              }}
                              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                                checked
                                  ? "border-indigo-500 bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                                  : "border-white/10 bg-black/30 text-slate-400 hover:border-white/20"
                              }`}
                            >
                              {checked && <Check size={13} />}
                              <span className="ml-1 select-none">{v.value}</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveValue(attr, { ...v, attribute_id: attr.id });
                                }}
                                className="ml-2 rounded-full p-0.5 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                                title="Remove value"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ))
              )}

              {selectedAttrForVal && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/40 p-2.5">
                  <input
                    value={newValName}
                    onChange={(e) => setNewValName(e.target.value)}
                    placeholder={`New ${selectedAttrForVal.name} value (e.g. 512GB)...`}
                    className="min-w-0 flex-1 rounded border border-white/10 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddAttrValue}
                    className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedAttrForVal(null)}
                    className="rounded bg-white/5 px-2 py-1.5 text-xs font-semibold text-slate-400"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
              <button
                type="button"
                onClick={() => setWizardStep(1)}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-white/10"
              >
                &larr; Back
              </button>
              <button
                type="button"
                disabled={previewLoading || attributeList.length === 0}
                onClick={handleGeneratePreview}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-5 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                <Wand2 size={14} /> {previewLoading ? "Generating..." : "Generate Matrix Preview"}
              </button>
            </div>
          </div>
        )}

        {wizardStep === 3 && (
          <div className="space-y-4">
            <div className="text-xs text-slate-400">
              Review generated variant matrix combinations. Untick any combinations that are not produced by the manufacturer before saving.
            </div>

            <div className="max-h-80 overflow-y-auto rounded-lg border border-white/10 bg-black/40">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] font-bold sticky top-0 border-b border-white/10">
                  <tr>
                    <th className="p-2.5 text-center">Include</th>
                    <th className="p-2.5">Suggested SKU</th>
                    <th className="p-2.5">Specification Combination</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {variantPreviews.map((pv) => (
                    <tr key={pv.id} className={pv.selected ? "bg-indigo-500/5" : "opacity-40"}>
                      <td className="p-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={pv.selected}
                          onChange={() => togglePreviewVariant(pv.id)}
                          className="h-4 w-4 rounded border-white/20 bg-slate-900 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                      </td>
                      <td className="p-2.5 font-mono text-indigo-300 font-semibold">{pv.sku}</td>
                      <td className="p-2.5">
                        <div className="flex flex-wrap gap-1">
                          {pv.combination.map((c, i) => (
                            <span
                              key={i}
                              className="rounded bg-white/5 border border-white/10 px-2 py-0.5 text-[11px] text-slate-200"
                            >
                              {c.attribute_name}: <strong>{c.value}</strong>
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-white/10">
              <span className="text-xs text-slate-400">
                Selected <strong className="text-indigo-300">{variantPreviews.filter((v) => v.selected).length}</strong> of {variantPreviews.length} combinations
              </span>
              <button
                type="button"
                onClick={handleSaveVariants}
                className="rounded-lg bg-emerald-600 px-6 py-2 text-xs font-bold text-white hover:bg-emerald-500 shadow-md shadow-emerald-600/20"
              >
                Save Master Product & Variants
              </button>
            </div>
          </div>
        )}
        </div>
      </AppModal>

      <AppModal
        open={newAttrModal}
        onClose={() => setNewAttrModal(false)}
        title="Add Attribute"
        maxWidth="sm"
      >
        <form onSubmit={handleAddAttribute} className="space-y-4 px-5 py-5 sm:px-6 sm:py-6">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300">
              Attribute Name
            </label>
            <input
              value={newAttrName}
              onChange={(e) => setNewAttrName(e.target.value)}
              placeholder="e.g. Storage, Color, RAM"
              className="w-full rounded-xl border border-white/15 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              autoFocus
            />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={() => setNewAttrModal(false)}
              className="rounded-xl border border-white/10 bg-slate-900 px-5 py-2.5 text-xs font-bold text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:from-indigo-500 hover:to-purple-500 transition-all transform active:scale-95"
            >
              Add Attribute
            </button>
          </div>
        </form>
      </AppModal>

      {/* Edit Variant Details & Price Modal */}
      <AppModal
        open={editingVariantModal}
        onClose={() => setEditingVariantModal(false)}
        title={`Edit Variant SKU: ${editingVariant?.sku || ""}`}
        maxWidth="md"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!editingVariant) return;
            try {
              await api.put(`/catalog/variants/${editingVariant.id}`, editVariantForm);
              refreshProducts();
              setEditingVariantModal(false);
              toast("Variant updated successfully", "success");
            } catch (err) {
              toast(err.response?.data?.detail || err.message || "Failed to update variant", "error");
            }
          }}
          className="space-y-4 px-5 py-5 sm:px-6 sm:py-6"
        >
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-300">
                SKU <span className="text-rose-400">*</span>
              </label>
              <input
                required
                value={editVariantForm.sku}
                onChange={(e) => setEditVariantForm({ ...editVariantForm, sku: e.target.value })}
                className="w-full rounded-xl border border-white/15 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-300">
                Barcode / EAN
              </label>
              <input
                value={editVariantForm.barcode}
                onChange={(e) => setEditVariantForm({ ...editVariantForm, barcode: e.target.value })}
                placeholder="e.g. 8901234567890"
                className="w-full rounded-xl border border-white/15 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-300">
                Default Cost Price (Rs.)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={editVariantForm.default_cost_price}
                onChange={(e) => setEditVariantForm({ ...editVariantForm, default_cost_price: e.target.value })}
                className="w-full rounded-xl border border-white/15 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-300">
                Default Selling Price (Rs.)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={editVariantForm.default_selling_price}
                onChange={(e) => setEditVariantForm({ ...editVariantForm, default_selling_price: e.target.value })}
                className="w-full rounded-xl border border-white/15 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-300">
              Status
            </label>
            <Select
              className="w-full"
              value={editVariantForm.status}
              onChange={(e) => setEditVariantForm({ ...editVariantForm, status: e.target.value })}
              options={[
                { value: "ACTIVE", label: "Active" },
                { value: "INACTIVE", label: "Inactive" },
                { value: "ARCHIVED", label: "Archived" },
              ]}
            />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={() => setEditingVariantModal(false)}
              className="rounded-xl border border-white/10 bg-slate-900 px-5 py-2.5 text-xs font-bold text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-500 transition-all"
            >
              Save Changes
            </button>
          </div>
        </form>
      </AppModal>

      {/* Barcode Tag / Label Printing Modal */}
      <AppModal
        open={printLabelModal}
        onClose={() => setPrintLabelModal(false)}
        title="Print Barcode Tag Label"
        maxWidth="sm"
      >
        <div className="space-y-4 px-5 py-5 sm:px-6 sm:py-6">
          <div className="rounded-xl border border-indigo-500/30 bg-slate-950 p-4 text-center">
            <div className="text-xs font-bold text-indigo-400 uppercase tracking-wider">{printTarget?.product_name || "Product"}</div>
            <div className="my-1.5 font-mono text-base font-extrabold text-white tracking-widest">{printTarget?.sku}</div>
            <div className="text-xs text-slate-400">Barcode: {printTarget?.barcode || printTarget?.sku}</div>
            {printTarget?.default_selling_price > 0 && (
              <div className="mt-2 text-sm font-extrabold text-emerald-400">
                Rs. {Number(printTarget.default_selling_price).toLocaleString()}
              </div>
            )}
            
            {/* Simulated Barcode Visual */}
            <div className="mt-3 flex justify-center items-center h-12 bg-white px-4 py-2 rounded">
              <div className="font-mono text-black text-xs font-bold tracking-[6px] select-none">
                |||||| | |||| ||| ||||
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-slate-300">
              Number of Copies
            </label>
            <input
              type="number"
              min="1"
              max="100"
              value={labelQty}
              onChange={(e) => setLabelQty(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full rounded-xl border border-white/15 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={() => setPrintLabelModal(false)}
              className="rounded-xl border border-white/10 bg-slate-900 px-5 py-2.5 text-xs font-bold text-slate-400 hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                toast(`Sending ${labelQty} copy(ies) of ${printTarget?.sku} label to printer...`, "success");
                setPrintLabelModal(false);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-amber-600/30 hover:bg-amber-500 transition-all"
            >
              <Printer size={14} /> Print {labelQty} Label(s)
            </button>
          </div>
        </div>
      </AppModal>
    </>
  );
}

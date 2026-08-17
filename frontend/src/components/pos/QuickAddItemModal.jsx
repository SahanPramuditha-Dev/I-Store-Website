import { useEffect, useMemo, useRef, useState } from "react";
import AppModal from "../layout/AppModal";
import { Input, Select } from "../UI";
import { Package, Store, Clock, X, ChevronDown, ChevronUp, Save, ShoppingCart, PackagePlus, FileText, Zap } from "lucide-react";
import api from "../../lib/api";
import { useFeedback } from "../FeedbackProvider";
import { useCachedQuery } from "../../hooks/useCachedQuery";

export default function QuickAddItemModal({ isOpen, onClose, onAddTemporary, onAddSaved }) {
  const { toast } = useFeedback();
  const [loading, setLoading] = useState(false);
  const [showOptional, setShowOptional] = useState(false);
  const nameInputRef = useRef(null);
  const { data: categoriesData } = useCachedQuery("inventory-categories", () => api.get("/inventory/categories").then((res) => res.data || []));

  const categoryOptions = useMemo(() => {
    const names = (categoriesData || [])
      .map((row) => String(row?.name || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    return Array.from(new Set(names));
  }, [categoriesData]);
  const defaultCategory = categoryOptions[0] || "";

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      nameInputRef.current?.focus?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  const [formData, setFormData] = useState({
    name: "",
    sale_price: "",
    quantity: "1",
    sku: "",
    category: "",
    description: "",
    cost_price: "",
    tax_rate: "",
    discount: "",
  });

  useEffect(() => {
    if (formData.category || !defaultCategory) return;
    setFormData((prev) => ({ ...prev, category: defaultCategory }));
  }, [defaultCategory, formData.category]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const validateForm = () => {
    if (!formData.name.trim()) {
      toast("Product Name is required", "warning");
      return false;
    }
    if (!formData.sale_price || Number(formData.sale_price) < 0) {
      toast("Valid Selling Price is required", "warning");
      return false;
    }
    if (!formData.quantity || Number(formData.quantity) <= 0) {
      toast("Valid Quantity is required", "warning");
      return false;
    }
    return true;
  };

  const handleAction = async (actionType) => {
    if (!validateForm()) return;

    const payload = {
      ...formData,
      sale_price: Number(formData.sale_price || 0),
      quantity: Number(formData.quantity || 1),
      cost_price: Number(formData.cost_price || 0),
      tax_rate: Number(formData.tax_rate || 0),
      discount: Number(formData.discount || 0),
      action_type: actionType,
    };

    if (actionType === "temporary") {
      onAddTemporary(payload);
      onClose();
      resetForm();
      return;
    }

    try {
      setLoading(true);
      const { data } = await api.post("/pos/quick-add-item", payload);
      toast(`Item saved to ${actionType === 'draft' ? 'drafts' : 'inventory'}`, "success");
      onAddSaved(data);
      onClose();
      resetForm();
    } catch (err) {
      toast(err.response?.data?.detail || "Failed to save item", "error");
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      sale_price: "",
      quantity: "1",
      sku: "",
    category: defaultCategory,
      description: "",
      cost_price: "",
      tax_rate: "",
      discount: "",
    });
    setShowOptional(false);
  };

  return (
    <AppModal open={isOpen} onClose={() => { onClose(); resetForm(); }} title="Quick Add Manual Item" maxWidth="lg">
      <div className="p-4 space-y-4 text-slate-200">
        <p className="text-sm text-slate-400">
          Create an item to sell that doesn't exist in your inventory. You can add it temporarily for this transaction only, or save it permanently.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input 
            ref={nameInputRef}
            label="Product Name *" 
            name="name" 
            value={formData.name} 
            onChange={handleChange} 
            placeholder="e.g. Generic Phone Case" 
          />
          <Input 
            label="Selling Price (LKR) *" 
            type="text" 
            inputMode="decimal" 
            autoComplete="off" 
            name="sale_price" 
            value={formData.sale_price} 
            onChange={handleChange} 
            placeholder="0.00" 
          />
          <Input 
            label="Quantity *" 
            type="text" 
            inputMode="numeric" 
            autoComplete="off" 
            name="quantity" 
            value={formData.quantity} 
            onChange={handleChange} 
          />
          <Select 
            label="Category" 
            name="category" 
            value={formData.category} 
            onChange={handleChange}
            options={categoryOptions.map((category) => ({ value: category, label: category }))}
          />
        </div>

        <div className="border-t border-white/10 pt-2">
          <button 
            type="button" 
            onClick={() => setShowOptional(!showOptional)} 
            className="flex items-center gap-2 text-sm text-indigo-400 hover:text-indigo-300 font-bold transition-colors"
          >
            {showOptional ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {showOptional ? "Hide Optional Fields" : "Show Optional Fields"}
          </button>
        </div>

        {showOptional && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <Input 
              label="SKU / Product Code" 
              name="sku" 
              value={formData.sku} 
              onChange={handleChange} 
              placeholder="Leave blank to auto-generate" 
            />
            <Input 
              label="Cost Price (LKR)" 
              type="text" 
              inputMode="decimal" 
              autoComplete="off" 
              name="cost_price" 
              value={formData.cost_price} 
              onChange={handleChange} 
              placeholder="0.00" 
            />
            <Input 
              label="Description" 
              name="description" 
              value={formData.description} 
              onChange={handleChange} 
              placeholder="Brief details about the item..." 
              className="md:col-span-2"
            />
          </div>
        )}

        <div className="pt-4 flex flex-col sm:flex-row gap-3">
          <button 
            type="button"
            onClick={() => handleAction('temporary')} 
            disabled={loading}
            className="flex-1 relative overflow-hidden group border border-slate-700 hover:border-slate-500 bg-gradient-to-b from-slate-800/90 to-slate-900 hover:from-slate-800 hover:to-slate-850 p-3 rounded-xl text-left transition-all shadow-md flex items-center gap-3 disabled:opacity-60"
          >
            <div className="p-2 rounded-lg bg-slate-700/60 text-slate-300 group-hover:text-white transition-colors shrink-0">
              <Clock size={18} />
            </div>
            <div>
              <div className="text-sm font-bold text-white group-hover:text-indigo-200 transition-colors">Temporary Item</div>
              <div className="text-[11px] text-slate-400">This transaction only</div>
            </div>
          </button>

          <button 
            type="button"
            onClick={() => handleAction('draft')} 
            disabled={loading}
            className="flex-1 relative overflow-hidden group border border-amber-500/40 hover:border-amber-400/80 bg-gradient-to-b from-amber-950/40 via-slate-900/90 to-slate-950 p-3 rounded-xl text-left transition-all shadow-md flex items-center gap-3 disabled:opacity-60"
          >
            <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 group-hover:bg-amber-500/30 transition-colors shrink-0">
              <FileText size={18} />
            </div>
            <div>
              <div className="text-sm font-bold text-amber-300 group-hover:text-amber-200 transition-colors">Save as Draft</div>
              <div className="text-[11px] text-amber-400/70">Finish details later</div>
            </div>
          </button>

          <button 
            type="button"
            onClick={() => handleAction('inventory')} 
            disabled={loading}
            className="flex-1 relative overflow-hidden group border border-indigo-400/40 hover:border-indigo-300 bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-500 hover:to-purple-500 p-3 rounded-xl text-left transition-all shadow-lg shadow-indigo-600/25 flex items-center gap-3 disabled:opacity-60"
          >
            <div className="p-2 rounded-lg bg-white/20 text-white shadow-sm shrink-0">
              <PackagePlus size={18} />
            </div>
            <div>
              <div className="text-sm font-bold text-white">Save to Inventory</div>
              <div className="text-[11px] text-indigo-100/80">Permanent product</div>
            </div>
          </button>
        </div>
      </div>
    </AppModal>
  );
}

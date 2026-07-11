import { useEffect, useRef, useState } from "react";
import AppModal from "../layout/AppModal";
import { Input, Select } from "../UI";
import { Package, Store, Clock, X, ChevronDown, ChevronUp, Save, ShoppingCart } from "lucide-react";
import api from "../../lib/api";
import { useFeedback } from "../FeedbackProvider";

export default function QuickAddItemModal({ isOpen, onClose, onAddTemporary, onAddSaved }) {
  const { toast } = useFeedback();
  const [loading, setLoading] = useState(false);
  const [showOptional, setShowOptional] = useState(false);
  const nameInputRef = useRef(null);

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
    category: "Uncategorized",
    description: "",
    cost_price: "",
    tax_rate: "",
    discount: "",
  });

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
      category: "Uncategorized",
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
            options={[
              { value: "Uncategorized", label: "Uncategorized" },
              { value: "Smartphones", label: "Smartphones" },
              { value: "Accessories", label: "Accessories" },
              { value: "Services", label: "Services" },
            ]}
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
            onClick={() => handleAction('temporary')} 
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 bg-slate-700/50 hover:bg-slate-700 text-white font-bold py-3 px-4 rounded-xl transition-all border border-slate-600/50"
          >
            <Clock size={18} />
            <div className="text-left leading-tight">
              <div className="text-sm">Temporary Item</div>
              <div className="text-[10px] text-slate-400 font-normal">This transaction only</div>
            </div>
          </button>

          <button 
            onClick={() => handleAction('draft')} 
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 font-bold py-3 px-4 rounded-xl transition-all border border-amber-500/30"
          >
            <Save size={18} />
            <div className="text-left leading-tight">
              <div className="text-sm">Save as Draft</div>
              <div className="text-[10px] text-amber-500/70 font-normal">Finish details later</div>
            </div>
          </button>

          <button 
            onClick={() => handleAction('inventory')} 
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-4 rounded-xl transition-all shadow-lg shadow-indigo-900/20"
          >
            <Store size={18} />
            <div className="text-left leading-tight">
              <div className="text-sm">Save to Inventory</div>
              <div className="text-[10px] text-indigo-200 font-normal">Permanent product</div>
            </div>
          </button>
        </div>
      </div>
    </AppModal>
  );
}

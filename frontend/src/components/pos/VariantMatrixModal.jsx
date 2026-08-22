import React, { useState } from 'react';
import { X, Check, Package, Sparkles, Layers, ShieldCheck, Tag } from 'lucide-react';

export default function VariantMatrixModal({ isOpen, onClose, masterItem, onSelectVariant }) {
  if (!isOpen || !masterItem) return null;

  const variants = masterItem.variants || [];
  
  // Extract unique sizes and colors
  const sizes = Array.from(new Set(variants.map(v => v.size || v.storage || 'Standard').filter(Boolean)));
  const colors = Array.from(new Set(variants.map(v => v.color || 'Default').filter(Boolean)));

  if (sizes.length === 0) sizes.push('Standard');
  if (colors.length === 0) colors.push('Default');

  const [selectedSize, setSelectedSize] = useState(sizes[0]);
  const [selectedColor, setSelectedColor] = useState(colors[0]);

  // Find variant matching selected size & color
  const matchedVariant = variants.find(v => 
    (v.size === selectedSize || v.storage === selectedSize || (!v.size && !v.storage && selectedSize === 'Standard')) &&
    (v.color === selectedColor || (!v.color && selectedColor === 'Default'))
  ) || variants[0];

  const handleAddToCart = (variant) => {
    if (!variant) return;
    onSelectVariant({
      id: variant.id || masterItem.id,
      name: `${masterItem.name} (${variant.size || variant.storage || selectedSize} / ${variant.color || selectedColor})`,
      sale_price: variant.sale_price || masterItem.sale_price || 0,
      quantity: Number(variant.stock_quantity ?? variant.quantity ?? masterItem.quantity ?? 0),
      unit_of_measure: masterItem.unit_of_measure || 'pcs',
      allow_decimal_qty: Boolean(masterItem.allow_decimal_qty),
      is_labor: false,
      product_type: masterItem.product_type || 'product',
      line_type: 'product',
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-6">
        
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800/60">
              Variant Matrix Picker
            </span>
            <h3 className="text-base font-black text-slate-900 dark:text-white mt-1">
              {masterItem.name}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Select size and color combination to add to cart
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Size Selector */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
            1. Select Size / Dimension
          </label>
          <div className="flex flex-wrap gap-2">
            {sizes.map(size => {
              const isSelected = selectedSize === size;
              return (
                <button
                  key={size}
                  onClick={() => setSelectedSize(size)}
                  className={`px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer border ${
                    isSelected
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-500/25 scale-105'
                      : 'bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                  }`}
                >
                  {size}
                </button>
              );
            })}
          </div>
        </div>

        {/* Color Selector */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
            2. Select Color / Pattern
          </label>
          <div className="flex flex-wrap gap-2">
            {colors.map(color => {
              const isSelected = selectedColor === color;
              return (
                <button
                  key={color}
                  onClick={() => setSelectedColor(color)}
                  className={`px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer border ${
                    isSelected
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-500/25 scale-105'
                      : 'bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-300'
                  }`}
                >
                  {color}
                </button>
              );
            })}
          </div>
        </div>

        {/* Stock & Price Summary for Matched Variant */}
        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-black uppercase text-slate-400">Available Stock</span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-lg font-black text-slate-900 dark:text-white font-mono">
                {matchedVariant?.stock_quantity ?? matchedVariant?.quantity ?? masterItem.quantity ?? 0} {masterItem.unit_of_measure || 'pcs'}
              </span>
              {(matchedVariant?.stock_quantity ?? masterItem.quantity ?? 0) > 0 ? (
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
                  In Stock
                </span>
              ) : (
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400 border border-rose-200 dark:border-rose-800/60">
                  Out of Stock
                </span>
              )}
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] font-black uppercase text-slate-400">Unit Price</span>
            <p className="text-xl font-black text-indigo-600 dark:text-indigo-400 font-mono mt-0.5">
              Rs. {Number(matchedVariant?.sale_price || masterItem.sale_price || 0).toLocaleString()}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleAddToCart(matchedVariant)}
            disabled={(matchedVariant?.stock_quantity ?? masterItem.quantity ?? 0) <= 0}
            className="flex-2 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-md shadow-indigo-600/20 transition cursor-pointer disabled:opacity-50"
          >
            <Check size={16} /> Add to Cart
          </button>
        </div>

      </div>
    </div>
  );
}

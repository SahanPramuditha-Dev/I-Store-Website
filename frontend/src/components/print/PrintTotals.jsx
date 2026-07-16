import React from "react";

export function PrintTotals({ invoice, config, printConfig }) {
  const formatMoney = (val) => Number(val || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  const accent = printConfig?.accent_color || "#0066cc";
  
  return (
    <div className="ml-auto w-3/5 mt-4 text-sm">
      <div className="space-y-1">
        {config?.show_subtotal && (
          <div className="flex justify-between py-1">
            <span className="opacity-80">Sub Total</span>
            <span className="font-medium">LKR {formatMoney(invoice.subtotal)}</span>
          </div>
        )}
        
        {config?.show_discount && invoice.discount_total > 0 && (
          <div className="flex justify-between py-1 text-red-600">
            <span className="opacity-80">Discount</span>
            <span className="font-medium">- LKR {formatMoney(invoice.discount_total)}</span>
          </div>
        )}
        
        {config?.show_tax && invoice.tax_total > 0 && (
          <div className="flex justify-between py-1">
            <span className="opacity-80">Tax</span>
            <span className="font-medium">LKR {formatMoney(invoice.tax_total)}</span>
          </div>
        )}
        
        {config?.show_total && (
          <div 
            className="flex justify-between py-2 px-3 mt-2 rounded font-black text-base"
            style={{ 
              background: config?.total_bg || "#1a1d2e", 
              color: config?.total_color || accent 
            }}
          >
            <span>TOTAL</span>
            <span>LKR {formatMoney(invoice.grand_total)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

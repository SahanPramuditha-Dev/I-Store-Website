import React from "react";

export function PrintTable({ items, config }) {
  const formatMoney = (val) => Number(val || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  const showImei = config?.show_imei;
  const showDiscount = config?.show_discount;
  
  return (
    <div className="mt-4 overflow-hidden rounded border" style={{ borderColor: config?.border_color || "#e5e7eb" }}>
      <table className="w-full text-sm" style={{ color: config?.row_text || "inherit" }}>
        <thead style={{ background: config?.header_bg || "#f3f4f6", color: config?.header_text || "inherit" }}>
          <tr>
            <th className="py-2 px-3 text-left font-semibold">Description</th>
            {showImei && <th className="py-2 px-3 text-left font-semibold">IMEI/SN</th>}
            <th className="py-2 px-3 text-right font-semibold">Qty</th>
            <th className="py-2 px-3 text-right font-semibold">Unit Price</th>
            {showDiscount && <th className="py-2 px-3 text-right font-semibold">Discount</th>}
            <th className="py-2 px-3 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row, idx) => (
            <tr key={idx} style={{ background: idx % 2 === 0 ? (config?.row_even_bg || "#ffffff") : (config?.row_odd_bg || "#f9fafb") }}>
              <td className="py-2 px-3">
                <div className="font-medium">{row.description || row.item_name}</div>
                {config?.show_warranty && row.warranty_days && (
                  <div className="text-xs opacity-70 mt-0.5">Warranty: {row.warranty_days} days</div>
                )}
              </td>
              {showImei && <td className="py-2 px-3">{row.imei || row.serial_number || "-"}</td>}
              <td className="py-2 px-3 text-right">{row.quantity || row.qty || 1}</td>
              <td className="py-2 px-3 text-right">{formatMoney(row.unit_price)}</td>
              {showDiscount && <td className="py-2 px-3 text-right">{formatMoney(row.discount_amount || row.discount)}</td>}
              <td className="py-2 px-3 text-right">{formatMoney(row.line_total)}</td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={4 + (showImei ? 1 : 0) + (showDiscount ? 1 : 0)} className="py-4 text-center opacity-50">
                No items
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

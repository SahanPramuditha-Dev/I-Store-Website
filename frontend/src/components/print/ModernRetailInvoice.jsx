import React from "react";
import { PrintContainer } from "./PrintContainer";
import { PrintHeader } from "./PrintHeader";
import { PrintTable } from "./PrintTable";
import { PrintTotals } from "./PrintTotals";

export function ModernRetailInvoice({ invoice, storeProfile, settings }) {
  const format = settings?.print?.paper_size === "Thermal 80mm" ? "80mm" : "a4";
  const margin = settings?.print?.margin_mm ? `${settings.print.margin_mm}mm` : "12mm";
  
  return (
    <PrintContainer format={format} margin={margin} className="modern-retail-layout border-b-4" style={{ borderBottomColor: settings?.print?.accent_color || "#3b82f6" }}>
      <PrintHeader branding={settings?.branding} business={settings?.business} storeProfile={storeProfile} />
      
      <div className="flex justify-between items-end mb-4">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-wider" style={{ color: settings?.header?.title_color || settings?.print?.accent_color || "#3b82f6" }}>
            {settings?.header?.title_text || "Tax Invoice"}
          </h1>
          <p className="font-mono text-sm opacity-80 mt-1"># {invoice.invoice_number}</p>
        </div>
        <div className="text-right text-sm">
          <p>Date: {invoice.created_at?.split('T')[0] || "2026-07-16"}</p>
          <p>Time: {invoice.created_at?.split('T')[1]?.slice(0,5) || "12:00"}</p>
        </div>
      </div>

      {settings?.bill_to?.show_section && (
        <div className="bg-slate-50 p-3 rounded-lg mb-4 border" style={{ borderColor: settings?.bill_to?.border_color || "#e2e8f0" }}>
          <p className="text-xs font-bold uppercase tracking-wider opacity-60 mb-1">{settings?.bill_to?.section_label || "Billed To"}</p>
          <p className="font-medium text-lg">{invoice.customer_name}</p>
          <p className="opacity-80">{invoice.customer_phone}</p>
        </div>
      )}

      <PrintTable items={invoice.lines || []} config={settings?.items} />
      
      <PrintTotals invoice={invoice} config={settings?.totals} printConfig={settings?.print} />

      {settings?.footer?.show_thank_you && (
        <div className="mt-8 text-center text-sm opacity-60 font-medium">
          {settings?.footer?.thank_you_text || "Thank you for shopping with us!"}
        </div>
      )}
    </PrintContainer>
  );
}

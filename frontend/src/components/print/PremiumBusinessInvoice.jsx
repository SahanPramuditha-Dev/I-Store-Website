import React from "react";
import { PrintContainer } from "./PrintContainer";
import { PrintTable } from "./PrintTable";
import { PrintTotals } from "./PrintTotals";

export function PremiumBusinessInvoice({ invoice, storeProfile, settings }) {
  const format = settings?.print?.paper_size === "Thermal 80mm" ? "80mm" : "a4";
  const margin = settings?.print?.margin_mm ? `${settings.print.margin_mm}mm` : "20mm";
  
  return (
    <PrintContainer format={format} margin={margin} className="premium-business-layout shadow-sm" style={{ backgroundColor: settings?.print?.background_color || "#fafafa" }}>
      
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-light tracking-widest uppercase mb-1" style={{ color: settings?.header?.title_color || settings?.print?.accent_color || "#111827" }}>
            {settings?.header?.title_text || "Invoice"}
          </h1>
          <div className="w-16 h-1 mb-4" style={{ backgroundColor: settings?.print?.accent_color || "#111827" }}></div>
          <p className="text-sm font-semibold opacity-70">INV: {invoice.invoice_number}</p>
          <p className="text-sm opacity-60">Date: {invoice.created_at?.split('T')[0] || "2026-07-16"}</p>
        </div>
        
        <div className="text-right">
          {settings?.branding?.show_logo && storeProfile?.shop_logo ? (
            <img src={storeProfile.shop_logo} alt="Logo" className="max-h-16 max-w-[150px] object-contain ml-auto mb-3" />
          ) : (
            <h2 className="font-bold text-xl mb-3">{storeProfile?.shop_name || "Premium Business"}</h2>
          )}
          <div className="text-xs opacity-60 space-y-0.5">
            <p>{storeProfile?.address}</p>
            <p>{storeProfile?.phone}</p>
            <p>{storeProfile?.email}</p>
            <p>{storeProfile?.website}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8 mb-8 border-t border-b py-4" style={{ borderColor: "rgba(0,0,0,0.1)" }}>
        {settings?.bill_to?.show_section && (
          <div>
            <h3 className="text-[10px] uppercase tracking-widest opacity-50 font-bold mb-2">{settings?.bill_to?.section_label || "Billed To"}</h3>
            <p className="font-semibold">{invoice.customer_name}</p>
            <p className="text-sm opacity-80 mt-1">{invoice.customer_phone}</p>
            {settings?.bill_to?.show_customer_address && <p className="text-sm opacity-80 mt-1">{invoice.customer_address}</p>}
          </div>
        )}
        
        <div className="text-right">
          <h3 className="text-[10px] uppercase tracking-widest opacity-50 font-bold mb-2">Payment Details</h3>
          <p className="text-sm opacity-80">Method: {invoice.payment_method || "N/A"}</p>
          {settings?.bill_to?.show_outstanding && (
            <p className="text-sm font-semibold mt-2" style={{ color: settings?.print?.accent_color || "#111827" }}>
              Balance Due: LKR {Number(invoice.balance_due || 0).toLocaleString()}
            </p>
          )}
        </div>
      </div>

      <PrintTable items={invoice.lines || []} config={{ ...settings?.items, header_bg: "transparent", border_color: "transparent" }} />
      
      <div className="border-t pt-4 mt-2" style={{ borderColor: "rgba(0,0,0,0.1)" }}>
        <PrintTotals invoice={invoice} config={settings?.totals} printConfig={settings?.print} />
      </div>

      <div className="mt-16 grid grid-cols-2 gap-8 text-xs opacity-60">
        <div>
          <p className="font-bold uppercase tracking-wider mb-2">Terms & Conditions</p>
          <p className="leading-relaxed">Payment is due within 15 days. Warranty valid only with this original invoice. Goods once sold cannot be returned without prior approval.</p>
        </div>
        <div className="text-right flex flex-col items-end justify-end">
          <div className="w-40 border-b border-black/40 mb-2"></div>
          <p>Authorized Signature</p>
        </div>
      </div>

    </PrintContainer>
  );
}

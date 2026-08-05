import React from "react";
import QRCode from "react-qr-code";
import { PrintContainer } from "./PrintContainer";
import { PrintHeader } from "./PrintHeader";
import { PrintTable } from "./PrintTable";
import { PrintTotals } from "./PrintTotals";

export function ModernRetailInvoice({ invoice, storeProfile, settings }) {
  const format = settings?.print?.paper_size === "Thermal 80mm" ? "80mm" : "a4";
  const margin = settings?.print?.margin_mm ? `${settings.print.margin_mm}mm` : "12mm";
  const accentColor = settings?.print?.accent_color || "#0ea5e9";

  const invoiceNumber = invoice?.invoice_number || invoice?.id || "INV-0001";
  const invoiceDate = invoice?.created_at
    ? new Date(invoice.created_at).toLocaleDateString()
    : new Date().toLocaleDateString();
  const invoiceTime = invoice?.created_at
    ? new Date(invoice.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  const paymentStatus = (invoice?.balance_due || 0) <= 0 ? "PAID" : "UNPAID";

  return (
    <PrintContainer
      format={format}
      margin={margin}
      className="modern-retail-layout border-b-4 bg-white p-6 text-slate-900 font-sans"
      style={{ borderBottomColor: accentColor }}
    >
      <PrintHeader branding={settings?.branding} business={settings?.business} storeProfile={storeProfile} />

      {/* TOP INVOICE BAR */}
      <div className="flex justify-between items-start my-4 pb-4 border-b border-slate-200">
        <div>
          <span
            className="inline-block text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded text-white mb-1"
            style={{ backgroundColor: accentColor }}
          >
            {settings?.header?.title_text || "Official Tax Invoice"}
          </span>
          <h1 className="text-2xl font-black font-mono text-slate-900 tracking-tight">
            #{invoiceNumber}
          </h1>
          <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
            <span>Date: <strong>{invoiceDate}</strong></span>
            {invoiceTime && <span>Time: <strong>{invoiceTime}</strong></span>}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <span
            className={`text-xs font-black uppercase px-3 py-1 rounded-full border ${
              paymentStatus === "PAID"
                ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                : "bg-rose-50 text-rose-700 border-rose-300"
            }`}
          >
            {paymentStatus}
          </span>
          <div className="p-1 border border-slate-200 bg-white rounded shadow-sm">
            <QRCode value={`INV:${invoiceNumber}`} size={56} level="M" />
          </div>
        </div>
      </div>

      {/* CUSTOMER & PAYMENT METHOD GRID */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Billed To
          </p>
          <p className="font-bold text-slate-900 text-sm">
            {invoice?.customer_name || "Walk-in Customer"}
          </p>
          {invoice?.customer_phone && (
            <p className="text-xs text-slate-600 mt-0.5">{invoice.customer_phone}</p>
          )}
          {invoice?.customer_address && (
            <p className="text-xs text-slate-500 mt-0.5">{invoice.customer_address}</p>
          )}
        </div>

        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 flex flex-col justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Payment & Sales Info
            </p>
            <p className="text-xs font-semibold text-slate-800">
              Method: <span className="font-bold">{invoice?.payment_method || "Cash"}</span>
            </p>
            {invoice?.salesperson && (
              <p className="text-xs text-slate-600">Salesperson: {invoice.salesperson}</p>
            )}
          </div>
        </div>
      </div>

      {/* ITEMS TABLE */}
      <PrintTable items={invoice?.lines || invoice?.items || []} config={settings?.items} />

      {/* TOTALS SECTION */}
      <div className="mt-4">
        <PrintTotals invoice={invoice} config={settings?.totals} printConfig={settings?.print} />
      </div>

      {/* FOOTER & DISCLAIMERS */}
      <div className="mt-8 pt-4 border-t border-slate-200 flex justify-between items-end text-xs text-slate-500">
        <div>
          <p className="font-medium text-slate-700">
            {settings?.footer?.thank_you_text || "Thank you for shopping with us!"}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            Warranty covers hardware defects only. Original receipt required for returns.
          </p>
        </div>
        <div className="text-right font-mono text-[10px] text-slate-400">
          Digital Verification ID: {invoiceNumber}
        </div>
      </div>
    </PrintContainer>
  );
}

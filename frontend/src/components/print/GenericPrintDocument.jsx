import React from "react";
import { PrintContainer } from "./PrintContainer";
import { PrintHeader } from "./PrintHeader";

export function GenericPrintDocument({ documentType, data, storeProfile, settings }) {
  const isA4 = settings?.print?.paper_size !== "Thermal 80mm";
  const format = isA4 ? "a4" : "80mm";
  const title = (documentType || "Document").replace(/_/g, " ").toUpperCase();
  
  // Try to parse out common fields
  const customerName = data?.customer_name || data?.customer?.name || "Customer";
  const refNo = data?.reference_no || data?.invoice_no || data?.receipt_no || data?.id || "";
  const date = data?.created_at || data?.date || new Date().toISOString();
  
  // Extract key-value pairs from data for a generic table
  const details = Object.entries(data || {})
    .filter(([key, val]) => typeof val === "string" || typeof val === "number")
    .filter(([key]) => !["id", "created_at", "updated_at", "store_id"].includes(key));

  return (
    <PrintContainer format={format} margin={isA4 ? "15mm" : "5mm"}>
      <PrintHeader branding={settings?.branding} business={settings?.business} storeProfile={storeProfile} />
      
      <div className="mt-4 border-t-2 border-b-2 py-3 mb-6 flex justify-between items-center border-slate-200">
        <h2 className="text-xl font-bold tracking-wider">{title}</h2>
        <span className="font-bold text-lg">{refNo}</span>
      </div>
      
      <div className="mb-6 grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-bold uppercase text-slate-400 mb-1">Prepared For</div>
          <div className="font-semibold">{customerName}</div>
        </div>
        <div className="text-right">
          <div className="text-xs font-bold uppercase text-slate-400 mb-1">Date</div>
          <div>{new Date(date).toLocaleDateString()}</div>
        </div>
      </div>
      
      <div className="mb-8">
        <h3 className="text-xs font-bold uppercase text-slate-400 mb-2 border-b pb-1">Document Details</h3>
        <table className="w-full text-sm">
          <tbody>
            {details.map(([key, val]) => (
              <tr key={key} className="border-b border-slate-100 last:border-0">
                <td className="py-2 capitalize font-medium text-slate-600">{key.replace(/_/g, " ")}</td>
                <td className="py-2 text-right">{val}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {settings?.footer?.show_thank_you && (
        <div className="mt-12 text-center text-xs opacity-50 border-t pt-4">
          {settings?.footer?.thank_you_text || "Thank you for your business!"}
        </div>
      )}
    </PrintContainer>
  );
}

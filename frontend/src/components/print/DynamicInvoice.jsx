import React from "react";
import { PrintContainer } from "./PrintContainer";
import { PrintHeader } from "./PrintHeader";
import { PrintTable } from "./PrintTable";
import { PrintTotals } from "./PrintTotals";

// A simple block for Bill To since we didn't extract it earlier
function PrintBillTo({ invoice, settings }) {
  if (!settings?.bill_to?.show_section) return null;
  return (
    <div className="bg-slate-50 p-3 rounded-lg mb-4 border" style={{ borderColor: settings?.bill_to?.border_color || "#e2e8f0" }}>
      <p className="text-xs font-bold uppercase tracking-wider opacity-60 mb-1">{settings?.bill_to?.section_label || "Billed To"}</p>
      <p className="font-medium text-lg">{invoice.customer_name}</p>
      <p className="opacity-80">{invoice.customer_phone}</p>
      {settings?.bill_to?.show_customer_address && invoice.customer_address && (
        <p className="opacity-80">{invoice.customer_address}</p>
      )}
    </div>
  );
}

function PrintFooter({ settings }) {
  if (!settings?.footer?.show_thank_you) return null;
  return (
    <div className="mt-8 text-center text-sm opacity-60 font-medium">
      {settings?.footer?.thank_you_text || "Thank you for shopping with us!"}
    </div>
  );
}

const DEFAULT_BLOCKS = [
  { id: "header", type: "header", enabled: true },
  { id: "bill_to", type: "bill_to", enabled: true },
  { id: "items", type: "items", enabled: true },
  { id: "totals", type: "totals", enabled: true },
  { id: "footer", type: "footer", enabled: true }
];

export function DynamicInvoice({ invoice, storeProfile, settings }) {
  const format = settings?.print?.paper_size === "Thermal 80mm" ? "80mm" : "a4";
  const margin = settings?.print?.margin_mm ? `${settings.print.margin_mm}mm` : "12mm";
  
  // Use blocks array from layout, or default
  const blocks = settings?.layout?.blocks || DEFAULT_BLOCKS;
  
  const renderBlock = (block) => {
    if (!block.enabled) return null;
    
    switch (block.type) {
      case "header":
        return <PrintHeader key={block.id} branding={settings?.branding} business={settings?.business} storeProfile={storeProfile} />;
      case "bill_to":
        return <PrintBillTo key={block.id} invoice={invoice} settings={settings} />;
      case "items":
        return <PrintTable key={block.id} items={invoice.lines || []} config={settings?.items} />;
      case "totals":
        return <PrintTotals key={block.id} invoice={invoice} config={settings?.totals} printConfig={settings?.print} />;
      case "footer":
        return <PrintFooter key={block.id} settings={settings} />;
      default:
        return null;
    }
  };

  return (
    <PrintContainer format={format} margin={margin} className="dynamic-layout" style={{ 
      backgroundColor: settings?.print?.background_color || "#ffffff",
      borderWidth: settings?.style?.border_enabled ? (settings?.style?.border_thickness_px || 1) : 0,
      borderColor: settings?.style?.border_color || "#e5e7eb",
      borderStyle: "solid"
    }}>
      {blocks.map(renderBlock)}
    </PrintContainer>
  );
}

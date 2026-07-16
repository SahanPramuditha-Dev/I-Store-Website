import React from "react";

export function PrintHeader({ branding, business, storeProfile }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b pb-4 mb-4" style={{ borderColor: "var(--print-border-color, #e5e7eb)" }}>
      <div className="flex flex-col">
        {branding?.show_logo && storeProfile?.shop_logo && (
          <img src={storeProfile.shop_logo} alt="Logo" className="max-h-12 max-w-[120px] object-contain mb-2" />
        )}
        {branding?.show_shop_name && (
          <h2 className="font-black text-xl" style={{ color: branding?.shop_name_color || "inherit" }}>
            {branding?.shop_name_text || storeProfile?.shop_name || "I Point"}
          </h2>
        )}
        {branding?.show_tagline && (
          <p className="text-sm opacity-70 mt-1">{branding?.tagline_text || storeProfile?.tagline}</p>
        )}
      </div>
      
      <div className="text-right text-sm opacity-80 leading-relaxed max-w-[50%]">
        {business?.show_address && <p>{storeProfile?.address}</p>}
        {business?.show_phone && <p>{storeProfile?.phone}</p>}
        {business?.show_email && <p>{storeProfile?.email}</p>}
        {business?.show_website && <p>{storeProfile?.website}</p>}
      </div>
    </div>
  );
}

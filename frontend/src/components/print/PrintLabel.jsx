import React from "react";
import { PrintContainer } from "./PrintContainer";

export function PrintLabel({ product: propProduct, settings, storeProfile }) {
  const isCustom = settings?.layout?.label_type === "custom";
  
  // Parse preset format like "50x30" or use custom dimensions
  let widthMm = 50;
  let heightMm = 30;
  
  if (!isCustom && settings?.layout?.size_preset) {
    const parts = settings.layout.size_preset.split("x");
    if (parts.length === 2) {
      widthMm = parseInt(parts[0]) || 50;
      heightMm = parseInt(parts[1]) || 30;
    }
  } else if (isCustom) {
    widthMm = settings?.layout?.custom_width_mm || 50;
    heightMm = settings?.layout?.custom_height_mm || 30;
  }

  // Ensure default margins are tight for labels (usually 1-2mm)
  const marginMm = settings?.print?.margin_mm || 2;

  // Mock product data fallback
  const product = propProduct || {
    name: "iPhone 13 Pro Silicone Case",
    price: 4500,
    barcode: "890123456789",
    sku: "IP13-SIL-BLK"
  };

  return (
    <PrintContainer 
      format="label" 
      margin={`${marginMm}mm`}
      widthMm={widthMm}
      heightMm={heightMm}
      className="flex flex-col items-center justify-center overflow-hidden"
      style={{
        backgroundColor: settings?.print?.background_color || "#ffffff",
        fontFamily: settings?.style?.font_family || "inherit"
      }}
    >
      <div className="w-full h-full flex flex-col justify-between" style={{ padding: "1mm" }}>
        {/* Store Name / Header */}
        <div className="text-center font-bold text-[10px] leading-tight truncate">
          {settings?.branding?.show_logo ? storeProfile?.store_name : (settings?.business?.business_name || storeProfile?.store_name || "I Store")}
        </div>
        
        {/* Product Name */}
        <div className="text-center text-[9px] leading-tight line-clamp-2 mt-1 mb-1 font-medium px-1">
          {product.name}
        </div>
        
        {/* Barcode Mock */}
        <div className="flex-1 flex flex-col items-center justify-center w-full min-h-[12px]">
          {/* We use a simple div with repeating borders to mock a barcode visually in the customizer */}
          <div className="w-full h-full max-h-[16px] max-w-[90%] bg-black" style={{
            backgroundImage: "repeating-linear-gradient(90deg, transparent, transparent 1px, #fff 1px, #fff 2px)",
          }}></div>
          <div className="text-[7px] text-center mt-[1px] tracking-widest">{product.barcode}</div>
        </div>
        
        {/* Price & SKU */}
        <div className="flex justify-between items-end w-full px-1 mt-1">
          <div className="text-[7px] opacity-70 truncate max-w-[45%]">
            {product.sku}
          </div>
          <div className="text-[11px] font-bold">
            Rs.{product.price}
          </div>
        </div>
      </div>
    </PrintContainer>
  );
}

import React from "react";

/**
 * PrintContainer creates exact-dimension print layouts for A4, A5, Letter, Thermal 80mm, Thermal 58mm, and Barcode Labels.
 */
export function PrintContainer({ children, format = "a4", margin = "12mm", widthMm, heightMm, className = "", style = {} }) {
  const normFormat = String(format || "a4").toLowerCase();

  let width = "210mm";
  let minHeight = "297mm";

  if (normFormat === "a5") {
    width = "148mm";
    minHeight = "210mm";
  } else if (normFormat === "letter") {
    width = "215.9mm";
    minHeight = "279.4mm";
  } else if (normFormat === "80mm" || normFormat === "thermal_80") {
    width = "80mm";
    minHeight = "auto";
  } else if (normFormat === "58mm" || normFormat === "thermal_58") {
    width = "58mm";
    minHeight = "auto";
  } else if (normFormat === "label") {
    width = widthMm ? `${widthMm}mm` : "50mm";
    minHeight = heightMm ? `${heightMm}mm` : "25mm";
  }

  return (
    <div
      className={`print-container relative mx-auto bg-white ${className}`}
      style={{
        width: width,
        maxWidth: width,
        minHeight: minHeight,
        padding: margin,
        boxSizing: "border-box",
        fontFamily: "var(--print-font-family, 'Inter', sans-serif)",
        color: "var(--print-text-color, #111827)",
        ...style
      }}
    >
      {children}
    </div>
  );
}

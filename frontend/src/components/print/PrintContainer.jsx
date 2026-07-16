import React from "react";

/**
 * PrintContainer creates an exact-dimension preview box.
 * Automatically scales or hides borders when rendering vs printing.
 */
export function PrintContainer({ children, format = "a4", margin = "12mm", widthMm, heightMm, className = "", style = {} }) {
  const isThermal = format === "80mm";
  const isLabel = format === "label";
  
  let maxWidth = isThermal ? "80mm" : "210mm";
  let minHeight = isThermal ? "auto" : "297mm";
  
  if (isLabel) {
    maxWidth = `${widthMm}mm`;
    minHeight = `${heightMm}mm`;
  }

  return (
    <div
      className={`print-container relative mx-auto bg-white ${className}`}
      style={{
        width: maxWidth,
        maxWidth: maxWidth,
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

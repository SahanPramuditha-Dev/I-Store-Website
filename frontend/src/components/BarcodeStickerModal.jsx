import React, { useState, useMemo, useRef } from "react";
import { Printer, Tag, X, Check, Copy, Sliders, Layers } from "lucide-react";
import AppModal from "./layout/AppModal";
import { Button, Input, Select } from "./UI";
import { useFeedback } from "./FeedbackProvider";

// Standard Code 128 (Subset B) Barcode Generator
const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112"
];

function encodeCode128B(text) {
  const clean = String(text || "").trim() || "0000";
  const startCode = 104; // Start B
  let checksum = startCode;
  const codes = [startCode];

  for (let i = 0; i < clean.length; i++) {
    const charCode = clean.charCodeAt(i);
    const val = charCode >= 32 && charCode <= 126 ? charCode - 32 : 0;
    codes.push(val);
    checksum += val * (i + 1);
  }

  const checkVal = checksum % 103;
  codes.push(checkVal);
  codes.push(106); // Stop symbol

  let patternStr = "";
  for (const c of codes) {
    patternStr += CODE128_PATTERNS[c] || "212222";
  }

  // Convert width strings (e.g. "211214") to binary bar/space modules
  const modules = [];
  let isBar = true;
  for (const widthChar of patternStr) {
    const w = parseInt(widthChar, 10) || 1;
    for (let j = 0; j < w; j++) {
      modules.push(isBar ? 1 : 0);
    }
    isBar = !isBar;
  }
  return modules;
}

export function BarcodeSVG({ value, height = 36, className = "" }) {
  const modules = useMemo(() => encodeCode128B(value), [value]);
  const width = modules.length;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`w-full ${className}`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
    >
      <rect width={width} height={height} fill="#ffffff" />
      {modules.map((bit, idx) =>
        bit === 1 ? (
          <rect key={idx} x={idx} y={0} width={1} height={height} fill="#000000" />
        ) : null
      )}
    </svg>
  );
}

const LABEL_SIZES = [
  { id: "50x25", label: "50mm × 25mm (Standard Accessory / Cable)", widthMm: 50, heightMm: 25 },
  { id: "40x30", label: "40mm × 30mm (Square Box Tag)", widthMm: 40, heightMm: 30 },
  { id: "60x40", label: "60mm × 40mm (Large Product Box)", widthMm: 60, heightMm: 40 },
];

export function BarcodeStickerModal({ open, onClose, item, storeName = "I STORE" }) {
  const { toast } = useFeedback();
  const [sizeId, setSizeId] = useState("50x25");
  const [quantity, setQuantity] = useState("1");
  const [customHeader, setCustomHeader] = useState(storeName);
  const [showPrice, setShowPrice] = useState(true);
  const [showSku, setShowSku] = useState(true);

  const selectedSize = LABEL_SIZES.find((s) => s.id === sizeId) || LABEL_SIZES[0];
  const barcodeValue = item?.barcode || item?.sku || item?.item_code || String(item?.id || "IST-1001");
  const itemName = item?.name || item?.item_name || "Product Item";
  const itemPrice = Number(item?.sale_price || item?.price || item?.unit_cost || 0);

  const handlePrint = () => {
    const printQty = Math.max(1, parseInt(quantity, 10) || 1);
    const printWindow = window.open("", "_blank", "width=800,height=600");
    if (!printWindow) {
      return toast("Please allow popups to print thermal barcode labels", "error");
    }

    const { widthMm, heightMm } = selectedSize;

    // Generate single sticker HTML
    const singleStickerHtml = `
      <div class="sticker-page">
        <div class="sticker-card">
          <div class="store-header">${customHeader}</div>
          <div class="product-title">${itemName}</div>
          <div class="barcode-container">
            <svg viewBox="0 0 ${encodeCode128B(barcodeValue).length} 36" class="barcode-svg" preserveAspectRatio="none" shape-rendering="crispEdges">
              <rect width="100%" height="100%" fill="#fff"/>
              ${encodeCode128B(barcodeValue).map((b, i) => b === 1 ? `<rect x="${i}" y="0" width="1" height="36" fill="#000"/>` : '').join('')}
            </svg>
          </div>
          <div class="code-and-price">
            ${showSku ? `<span class="barcode-text">${barcodeValue}</span>` : '<span></span>'}
            ${showPrice ? `<span class="price-text">LKR ${itemPrice.toLocaleString()}</span>` : ''}
          </div>
        </div>
      </div>
    `;

    const allPagesHtml = Array.from({ length: printQty })
      .map(() => singleStickerHtml)
      .join("");

    const docContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <title>Barcode Stickers - ${itemName}</title>
        <style>
          @page {
            size: ${widthMm}mm ${heightMm}mm;
            margin: 0mm;
          }
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            background: #fff;
            color: #000;
          }
          .sticker-page {
            width: ${widthMm}mm;
            height: ${heightMm}mm;
            page-break-after: always;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            padding: 1.2mm 2mm;
          }
          .sticker-card {
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            text-align: center;
          }
          .store-header {
            font-size: 7.5pt;
            font-weight: 800;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            line-height: 1;
            padding-bottom: 0.5mm;
          }
          .product-title {
            font-size: 7.5pt;
            font-weight: 700;
            line-height: 1.1;
            max-height: 2.3em;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: normal;
          }
          .barcode-container {
            width: 100%;
            height: 8.5mm;
            margin: 0.5mm 0;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .barcode-svg {
            width: 96%;
            height: 100%;
          }
          .code-and-price {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 7pt;
            font-weight: 700;
            line-height: 1;
            padding-top: 0.5mm;
          }
          .barcode-text {
            font-family: monospace;
            font-size: 6.5pt;
            letter-spacing: 0.05em;
          }
          .price-text {
            font-size: 8pt;
            font-weight: 900;
          }
        </style>
      </head>
      <body>
        ${allPagesHtml}
        <script>
          window.onload = function() {
            window.print();
            setTimeout(function() { window.close(); }, 500);
          };
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(docContent);
    printWindow.document.close();
    toast(`Printing ${printQty} barcode sticker(s)...`, "success");
    onClose();
  };

  if (!open || !item) return null;

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2 text-indigo-400">
          <Tag size={18} />
          <span>Thermal Barcode &amp; Price Sticker</span>
        </div>
      }
      panelClassName="max-w-md bg-[#0d1322] border-white/10"
    >
      <div className="space-y-4 py-1 text-xs">
        {/* Live Sticker Preview Card */}
        <div className="p-4 rounded-2xl bg-slate-950/80 border border-white/10 flex flex-col items-center justify-center">
          <div className="text-[10px] uppercase font-bold text-slate-500 mb-2">Live Sticker Preview</div>
          
          <div
            className="bg-white text-black p-2.5 rounded-lg shadow-xl flex flex-col justify-between text-center select-none"
            style={{
              width: `${selectedSize.widthMm * 4.5}px`,
              minHeight: `${selectedSize.heightMm * 4.5}px`,
            }}
          >
            <div className="text-[10px] font-black uppercase tracking-widest leading-none text-slate-800">
              {customHeader || "I STORE"}
            </div>
            <div className="text-[11px] font-bold text-slate-900 leading-tight line-clamp-2 my-1">
              {itemName}
            </div>
            <div className="w-full my-1 px-1">
              <BarcodeSVG value={barcodeValue} height={32} />
            </div>
            <div className="flex items-center justify-between text-[10px] font-bold text-slate-950 pt-0.5 border-t border-slate-200">
              {showSku ? <span className="font-mono text-[9px]">{barcodeValue}</span> : <span />}
              {showPrice && (
                <span className="text-[11px] font-black text-slate-950 font-mono">
                  LKR {itemPrice.toLocaleString()}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Sticker Configuration Controls */}
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">Thermal Label Size</label>
            <Select
              value={sizeId}
              onChange={(e) => setSizeId(e.target.value)}
              options={LABEL_SIZES.map((s) => ({ value: s.id, label: s.label }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Print Quantity</label>
              <Input
                type="number"
                min="1"
                max="500"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="1"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1">Header Text</label>
              <Input
                type="text"
                value={customHeader}
                onChange={(e) => setCustomHeader(e.target.value)}
                placeholder="Store Name"
              />
            </div>
          </div>

          <div className="flex items-center gap-4 pt-1">
            <label className="flex items-center gap-2 cursor-pointer text-slate-300">
              <input
                type="checkbox"
                checked={showPrice}
                onChange={(e) => setShowPrice(e.target.checked)}
                className="rounded border-white/20 bg-black/40 text-indigo-500 focus:ring-0"
              />
              <span>Show Price Tag</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-slate-300">
              <input
                type="checkbox"
                checked={showSku}
                onChange={(e) => setShowSku(e.target.checked)}
                className="rounded border-white/20 bg-black/40 text-indigo-500 focus:ring-0"
              />
              <span>Show SKU / Barcode text</span>
            </label>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handlePrint}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
          >
            <Printer size={15} />
            <span>Print {quantity > 1 ? `${quantity} Stickers` : "Sticker"}</span>
          </Button>
        </div>
      </div>
    </AppModal>
  );
}

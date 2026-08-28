import React, { useState } from "react";
import { 
  Plus, Minus, Trash2, ShoppingCart, Percent, 
  Banknote, CreditCard, Wallet, Search, Barcode, 
  RotateCcw, Sparkles, Check, ChevronRight, X, Info, Tag,
  Wrench, Clock, CornerUpLeft, Package, UserCheck
} from "lucide-react";

export default function TouchPOSTerminal({
  mode,
  setMode,
  repairTicketNo,
  setRepairTicketNo,
  repairTicketRef,
  loadRepairTicketToCart,
  addLaborCharge,
  reservationNo,
  setReservationNo,
  reservationRef,
  loadReservationToCart,
  returnInvoiceLookup,
  setReturnInvoiceLookup,
  lookupReturnInvoice,
  returnSearchBusy,
  returnInvoicePayload,
  selectedReturnItem,
  setSelectedReturnItem,
  returnAction,
  setReturnAction,
  returnQuantity,
  setReturnQuantity,
  returnNotes,
  setReturnNotes,
  processReturnAction,
  returnBusy,
  cart,
  selectedCartIndex,
  setSelectedCartIndex,
  addItem,
  stepQty,
  updateItem,
  removeItem,
  clearCart,
  subtotal,
  discountAmount,
  discountMode,
  setDiscountMode,
  discountValue,
  updateDiscountValue,
  maxDiscountAllowed,
  maxDiscountPercentAllowed,
  discountError,
  taxAmount,
  grandTotal,
  dueAfterCredits,
  appliedAdvanceTotal,
  appliedStoreCreditTotal,
  paymentMethod,
  setPaymentMethod,
  cashReceived,
  setCashReceived,
  change,
  signedChange,
  checkout,
  checkoutDisabled,
  hasNegativeMargin,
  filteredInventory,
  categoryOptions,
  activeCategory,
  setActiveCategory,
  searchQuery,
  setSearchQuery,
  scanCode,
  setScanCode,
  tryAddByCode,
  barcodeRef,
  productSearchRef,
  customerId,
  setCustomerId,
  customers,
  setShowNewCustomerModal,
  openProductDetail,
  lastSale,
  printReceipt
}) {
  const [padTarget, setPadTarget] = useState("cash"); // "cash" | "qty" | "discount"
  const [padBuffer, setPadBuffer] = useState("");
  const selectedCartItem = cart[selectedCartIndex] || null;

  const handlePadPress = (key) => {
    if (padTarget === "cash") {
      let currentVal = String(cashReceived || "");
      if (key === "C") {
        setCashReceived("");
      } else if (key === "DEL") {
        setCashReceived(currentVal.slice(0, -1));
      } else if (key === ".") {
        if (!currentVal.includes(".")) setCashReceived(currentVal + ".");
      } else if (key === "00") {
        if (currentVal && currentVal !== "0") setCashReceived(currentVal + "00");
      } else {
        setCashReceived(currentVal === "0" ? String(key) : currentVal + String(key));
      }
    } else if (padTarget === "qty") {
      if (!selectedCartItem) return;
      let currentQty = String(padBuffer || "");
      if (key === "C") {
        setPadBuffer("");
      } else if (key === "DEL") {
        const next = currentQty.slice(0, -1);
        setPadBuffer(next);
        if (next) updateItem(selectedCartItem.item_id, 'quantity', Math.max(1, Number(next)));
      } else if (key === ".") {
        if (!currentQty.includes(".")) {
          const next = currentQty + ".";
          setPadBuffer(next);
        }
      } else if (key === "00") {
        const next = currentQty ? currentQty + "00" : "0";
        setPadBuffer(next);
        updateItem(selectedCartItem.item_id, 'quantity', Math.max(1, Number(next)));
      } else {
        const next = currentQty === "0" ? String(key) : currentQty + String(key);
        setPadBuffer(next);
        updateItem(selectedCartItem.item_id, 'quantity', Math.max(1, Number(next)));
      }
    } else if (padTarget === "discount") {
      let currentDisc = String(discountValue || "");
      if (key === "C") {
        updateDiscountValue(0);
      } else if (key === "DEL") {
        const next = currentDisc.slice(0, -1);
        updateDiscountValue(next || 0);
      } else if (key === ".") {
        if (!currentDisc.includes(".")) updateDiscountValue(currentDisc + ".");
      } else if (key === "00") {
        if (currentDisc && currentDisc !== "0") updateDiscountValue(currentDisc + "00");
      } else {
        const next = currentDisc === "0" ? String(key) : currentDisc + String(key);
        updateDiscountValue(next);
      }
    }
  };

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[400px_1fr] xl:grid-cols-[440px_1fr] gap-3.5 overflow-hidden text-slate-900 dark:text-slate-100">
      
      {/* ========================================================================= */}
      {/* LEFT COLUMN: RECEIPT TAPE / CART BILLING TERMINAL (~38-40%) */}
      {/* ========================================================================= */}
      <div className="flex flex-col min-h-0 bg-white dark:bg-black/80 border border-slate-200 dark:border-white/10 rounded-2xl shadow-sm dark:shadow-2xl overflow-hidden backdrop-blur-xl">
        
        {/* Receipt Header */}
        <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${mode === 'return' ? 'bg-rose-500 animate-pulse' : mode === 'repair' ? 'bg-indigo-500 animate-pulse' : mode === 'reservation' ? 'bg-cyan-500 animate-pulse' : 'bg-emerald-500 animate-pulse'}`} />
              <h2 className="text-sm font-black tracking-wider uppercase text-slate-900 dark:text-white">
                {mode === "return" ? "Return / Exchange Order" : mode === "repair" ? "Repair Billing Order" : mode === "reservation" ? "Reservation Order" : "Current Order"}
              </h2>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
              {cart.length} {cart.length === 1 ? "line item" : "line items"} · {cart.reduce((s, i) => s + Number(i.quantity || 1), 0)} units
            </p>
          </div>
          <button 
            type="button" 
            onClick={clearCart}
            disabled={!cart.length}
            className="px-3 py-1.5 rounded-xl border border-rose-300 dark:border-rose-500/30 bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:hover:bg-rose-500/20 dark:text-rose-300 font-bold text-xs transition disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-sm"
            title="Clear current cart"
          >
            <Trash2 size={13} /> Void Cart
          </button>
        </div>

        {/* Customer Quick Select Banner */}
        <div className="px-3 py-2 bg-slate-100/70 dark:bg-slate-950/40 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 shrink-0">Customer:</span>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="bg-white dark:bg-slate-800/90 text-slate-900 dark:text-white text-xs font-bold rounded-lg px-2.5 py-1.5 border border-slate-300 dark:border-slate-700 outline-none w-full max-w-[200px] truncate shadow-sm"
            >
              <option value="">Walk-in Customer</option>
              {(customers || []).map((c) => (
                <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ""}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => setShowNewCustomerModal(true)}
            className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black shrink-0 transition shadow-sm"
          >
            + Add
          </button>
        </div>

        {/* Receipt Table Items */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar bg-slate-50/50 dark:bg-transparent">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-400 dark:text-slate-500">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 flex items-center justify-center mb-3 shadow-inner">
                {mode === 'repair' ? <Wrench size={30} className="text-indigo-500 dark:text-indigo-400" /> : mode === 'reservation' ? <Clock size={30} className="text-cyan-500 dark:text-cyan-400" /> : mode === 'return' ? <CornerUpLeft size={30} className="text-rose-500 dark:text-rose-400" /> : <ShoppingCart size={30} className="text-slate-400 dark:text-slate-500" />}
              </div>
              <p className="text-base font-bold text-slate-700 dark:text-slate-300">
                {mode === "return" ? "Lookup Invoice to Return" : mode === "repair" ? "Pull a Repair Ticket or Add Parts" : mode === "reservation" ? "Load a Reservation to Cart" : "Order is Empty"}
              </p>
              <p className="text-xs text-slate-500 mt-1 max-w-[240px]">
                {mode === "return" ? "Use the top Return Lookup bar on the right to search and select items." : mode === "repair" ? "Scan parts from the catalog or load ticket labor." : "Tap any product on the right grid or scan a barcode to add."}
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-white/95 dark:bg-slate-950/95 text-[10px] uppercase font-black tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 z-10 backdrop-blur">
                <tr>
                  <th className="p-3">Item</th>
                  <th className="p-3 text-center w-24">Qty</th>
                  <th className="p-3 text-right w-20">Price</th>
                  <th className="p-3 text-right w-24">Total</th>
                  <th className="p-2 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70">
                {cart.map((item, idx) => {
                  const isSelected = selectedCartIndex === idx;
                  const lineTotal = item.price * item.quantity;
                  return (
                    <tr
                      key={`${item.item_id}-${idx}`}
                      onClick={() => {
                        setSelectedCartIndex(idx);
                        setPadBuffer(String(item.quantity || "1"));
                        setPadTarget("qty");
                      }}
                      className={`cursor-pointer transition select-none ${
                        isSelected 
                          ? "bg-indigo-50 dark:bg-indigo-600/25 border-l-4 border-indigo-600 dark:border-indigo-400" 
                          : "hover:bg-slate-100 dark:hover:bg-slate-800/40"
                      }`}
                    >
                      <td className="p-3">
                        <div className="font-bold text-sm text-slate-900 dark:text-white line-clamp-1 leading-snug">
                          {item.name}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {item.is_labor ? (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-500/30">Labor</span>
                          ) : (
                            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{item.sku || "No SKU"}</span>
                          )}
                        </div>
                      </td>
                      <td className="p-2 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl overflow-hidden shadow-inner">
                          <button
                            type="button"
                            onClick={() => stepQty(item.item_id, -1)}
                            className="px-2 py-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                          >
                            <Minus size={12} />
                          </button>
                          <span className="px-2 font-black text-sm text-slate-900 dark:text-white min-w-[24px]">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => stepQty(item.item_id, 1)}
                            className="px-2 py-1.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      </td>
                      <td className="p-3 text-right font-bold text-xs text-slate-700 dark:text-slate-300">
                        {item.price.toLocaleString()}
                      </td>
                      <td className="p-3 text-right font-black text-sm text-indigo-700 dark:text-indigo-300">
                        {lineTotal.toLocaleString()}
                      </td>
                      <td className="p-2 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeItem(item.item_id);
                          }}
                          className="p-1 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition"
                          title="Remove item"
                        >
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Receipt Totals & Giant Total Hero */}
        <div className="p-4 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 space-y-2 shrink-0">
          <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 font-semibold">
            <span>Sub-total</span>
            <span className="font-bold text-slate-900 dark:text-slate-200">LKR {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>

          {discountAmount > 0 && (
            <div className="flex justify-between text-xs text-rose-600 dark:text-rose-400 font-semibold">
              <span>Discount ({discountMode === "percent" ? `${discountValue}%` : "Flat"})</span>
              <span className="font-bold">- LKR {discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
          )}

          {Number(taxAmount || 0) > 0 && (
            <div className="flex justify-between text-xs text-sky-600 dark:text-sky-400 font-semibold">
              <span>Sales Tax</span>
              <span className="font-bold">+ LKR {Number(taxAmount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
          )}

          {/* GIANT TOTAL HERO BOX */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-baseline justify-between">
            <span className="text-base font-black tracking-widest uppercase text-slate-700 dark:text-slate-300">TOTAL</span>
            <span className="text-3xl xl:text-4xl font-black text-slate-950 dark:text-white tracking-tight">
              LKR {Math.round(dueAfterCredits).toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* RIGHT COLUMN: TOUCH MATRIX / SPECIALIZED REPAIR/RESERVATION/RETURN PANELS */}
      {/* ========================================================================= */}
      <div className="flex flex-col min-h-0 gap-3 overflow-hidden">
        
        {/* SPECIALIZED MODE TOOLBAR: REPAIR / RESERVATION / RETURN */}
        {mode === "repair" && (
          <div className="bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-500/40 rounded-2xl p-3 shadow-sm dark:shadow-xl shrink-0 flex flex-wrap gap-2 items-center backdrop-blur-xl">
            <div className="flex items-center gap-2 flex-1 min-w-[240px]">
              <Wrench size={16} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
              <input
                ref={repairTicketRef}
                className="w-full bg-white dark:bg-slate-950/80 border border-indigo-300 dark:border-indigo-500/40 rounded-xl py-2 px-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-indigo-500"
                placeholder="Link Repair Ticket No. (e.g. R-1001)"
                value={repairTicketNo}
                onChange={(e) => setRepairTicketNo(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={addLaborCharge}
              className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black uppercase tracking-wider transition shadow-md whitespace-nowrap"
            >
              + Add Labor
            </button>
            <button
              type="button"
              onClick={loadRepairTicketToCart}
              className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-black uppercase tracking-wider border border-slate-300 dark:border-slate-700 transition shadow-sm whitespace-nowrap"
            >
              Pull Ticket
            </button>
          </div>
        )}

        {mode === "reservation" && (
          <div className="bg-cyan-50 dark:bg-cyan-950/60 border border-cyan-200 dark:border-cyan-500/40 rounded-2xl p-3 shadow-sm dark:shadow-xl shrink-0 flex flex-wrap gap-2 items-center backdrop-blur-xl">
            <div className="flex items-center gap-2 flex-1 min-w-[240px]">
              <Clock size={16} className="text-cyan-600 dark:text-cyan-400 shrink-0" />
              <input
                ref={reservationRef}
                className="w-full bg-white dark:bg-slate-950/80 border border-cyan-300 dark:border-cyan-500/40 rounded-xl py-2 px-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-cyan-500"
                placeholder="Reservation No. (e.g. RSV-2026-000001)"
                value={reservationNo}
                onChange={(e) => setReservationNo(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={loadReservationToCart}
              className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-black uppercase tracking-wider transition shadow-md whitespace-nowrap"
            >
              Load Reservation
            </button>
            <a
              href="/reservations"
              className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-black uppercase tracking-wider border border-slate-300 dark:border-slate-700 transition shadow-sm whitespace-nowrap"
            >
              Module
            </a>
          </div>
        )}

        {mode === "return" && (
          <div className="bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-500/40 rounded-2xl p-3 shadow-sm dark:shadow-xl shrink-0 backdrop-blur-xl">
            <div className="flex gap-2 items-center">
              <RotateCcw size={16} className="text-rose-600 dark:text-rose-400 shrink-0" />
              <input
                className="flex-1 bg-white dark:bg-slate-950/80 border border-rose-300 dark:border-rose-500/40 rounded-xl py-2 px-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-rose-500"
                placeholder="Invoice #, customer name or phone..."
                value={returnInvoiceLookup}
                onChange={(e) => setReturnInvoiceLookup(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    lookupReturnInvoice();
                  }
                }}
              />
              <button
                type="button"
                onClick={lookupReturnInvoice}
                disabled={returnSearchBusy}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black uppercase tracking-wider transition shadow-md disabled:opacity-50"
              >
                {returnSearchBusy ? "Searching..." : "Lookup"}
              </button>
            </div>
          </div>
        )}

        {/* RETURN DETAIL MATRIX IF IN RETURN MODE */}
        {mode === "return" && returnInvoicePayload?.selected_invoice ? (
          <div className="flex-1 min-h-0 bg-white dark:bg-black/60 border border-slate-200 dark:border-slate-700/60 rounded-2xl p-3 overflow-y-auto custom-scrollbar space-y-3 shadow-sm">
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-950/30 p-3 text-xs flex justify-between items-center">
              <div>
                <span className="text-[10px] uppercase tracking-widest font-black text-indigo-700 dark:text-indigo-400">Invoice</span>
                <p className="font-bold text-sm text-slate-900 dark:text-white">{returnInvoicePayload.selected_invoice.invoice_no}</p>
                <p className="text-slate-500 dark:text-slate-400 text-[11px]">{returnInvoicePayload.selected_invoice.customer_name || "Walk-in"} • {returnInvoicePayload.selected_invoice.customer_phone || "—"}</p>
              </div>
              <div className="text-right">
                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400">Payment</span>
                <p className="font-bold text-indigo-600 dark:text-indigo-300">{returnInvoicePayload.selected_invoice.payment_method}</p>
              </div>
            </div>

            {/* List of Eligible Return Items */}
            <div className="space-y-2">
              {(returnInvoicePayload.selected_invoice.items || []).map((row) => {
                const isSelected = selectedReturnItem?.sale_item_id === row.sale_item_id;
                const isEligible = Number(row.returnable_qty || 0) > 0;
                return (
                  <button
                    key={row.sale_item_id}
                    type="button"
                    disabled={!isEligible}
                    onClick={() => setSelectedReturnItem(row)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      isSelected
                        ? "border-indigo-600 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-600/30 shadow-md ring-2 ring-indigo-500"
                        : isEligible
                        ? "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/80 hover:border-indigo-300"
                        : "border-slate-200 dark:border-slate-800/40 bg-slate-100 dark:bg-slate-950/30 opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-bold text-xs text-slate-900 dark:text-white">{row.product_name}</div>
                        <div className="text-[11px] text-emerald-700 dark:text-emerald-400">Unit Price: LKR {Math.round(Number(row.unit_price || 0)).toLocaleString()}</div>
                      </div>
                      <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${isSelected ? "bg-indigo-600 text-white" : isEligible ? "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300" : "bg-slate-200 dark:bg-slate-900 text-slate-500"}`}>
                        {isSelected ? "Selected" : isEligible ? `Eligible: ${row.returnable_qty}` : "Returned"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Return Action Selector */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 p-3 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  Action
                  <select
                    value={returnAction}
                    onChange={(e) => setReturnAction(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold text-slate-900 dark:text-white outline-none"
                  >
                    <option value="refund">Refund Money</option>
                    <option value="exchange">Exchange Product</option>
                    <option value="store_credit">Issue Store Credit</option>
                  </select>
                </label>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-400">
                  Quantity
                  <input
                    type="number"
                    min="1"
                    max={selectedReturnItem?.returnable_qty || 1}
                    value={returnQuantity}
                    onChange={(e) => setReturnQuantity(Number(e.target.value || 1))}
                    className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-bold text-slate-900 dark:text-white outline-none"
                  />
                </label>
              </div>
              <textarea
                value={returnNotes}
                onChange={(e) => setReturnNotes(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-white outline-none resize-none"
                placeholder="Reason for return/exchange..."
              />
              <button
                type="button"
                onClick={processReturnAction}
                disabled={returnBusy || !selectedReturnItem}
                className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-xs uppercase tracking-widest py-3 transition disabled:opacity-40 shadow-md"
              >
                {returnBusy ? "Processing..." : returnAction === "refund" ? "Issue Refund" : returnAction === "exchange" ? "Create Exchange Case" : "Create Store Credit Case"}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* TOP BAR: SEARCH BAR & CATEGORY PILLS (FOR SALE, REPAIR, RESERVATION) */}
            <div className="bg-white dark:bg-black/80 border border-slate-200 dark:border-white/10 rounded-2xl p-3 shadow-sm dark:shadow-xl shrink-0 space-y-2.5 backdrop-blur-xl">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Barcode size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    ref={barcodeRef}
                    className="w-full bg-slate-50 dark:bg-slate-950/80 border border-slate-300 dark:border-slate-700 rounded-xl py-2 pl-9 pr-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 outline-none focus:border-indigo-500"
                    placeholder="Scan Barcode (Enter)"
                    value={scanCode}
                    onChange={(e) => setScanCode(e.target.value)}
                    onKeyDown={tryAddByCode}
                  />
                </div>
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    ref={productSearchRef}
                    className="w-full bg-slate-50 dark:bg-slate-950/80 border border-slate-300 dark:border-slate-700 rounded-xl py-2 pl-9 pr-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 outline-none focus:border-indigo-500"
                    placeholder="Search products..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              {/* Horizontal Category Tabs */}
              <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-1">
                {categoryOptions.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategory(cat)}
                    className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider whitespace-nowrap transition-all shadow-sm ${
                      activeCategory === cat
                        ? "bg-indigo-600 text-white shadow-indigo-600/30 scale-105"
                        : "bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white border border-slate-200 dark:border-slate-700/60"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* MIDDLE SECTION: TOUCH PRODUCT GRID */}
            <div className="flex-1 min-h-0 bg-slate-100/70 dark:bg-black/60 border border-slate-200 dark:border-white/10 rounded-2xl p-2.5 overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2">
                {filteredInventory.map((prod) => {
                  const inCartCount = cart.find(c => c.item_id === prod.id)?.quantity || 0;
                  return (
                    <button
                      key={prod.id}
                      type="button"
                      onClick={() => addItem(prod)}
                      className="relative group bg-white dark:bg-slate-900/90 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-400 rounded-xl p-2 flex flex-col items-center justify-between text-center transition-all active:scale-95 shadow-sm hover:shadow h-[88px]"
                    >
                      {inCartCount > 0 && (
                        <span className="absolute top-1 right-1 px-1.5 py-0.2 rounded-full bg-emerald-500 text-white dark:text-slate-950 font-black text-[9px] shadow">
                          {inCartCount}
                        </span>
                      )}
                      
                      {/* Icon / Image */}
                      <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-600/30 flex items-center justify-center shrink-0">
                        {prod.image_url ? (
                          <img src={prod.image_url} alt={prod.name} className="w-full h-full object-cover rounded-lg" />
                        ) : (
                          <Tag size={15} className="text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-300" />
                        )}
                      </div>

                      <div className="w-full">
                        <div className="font-bold text-[11px] text-slate-800 dark:text-slate-200 truncate group-hover:text-slate-950 dark:group-hover:text-white leading-tight">
                          {prod.name}
                        </div>
                        <div className="font-black text-[10px] text-indigo-600 dark:text-indigo-400 mt-0.5">
                          Rs. {prod.sale_price.toLocaleString()}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* BOTTOM SECTION: ACTIVE ITEM CARD + TOUCH NUMPAD + ACTION BAR */}
        <div className="bg-white dark:bg-black/90 border border-slate-200 dark:border-white/10 rounded-2xl p-3 shadow-sm dark:shadow-2xl shrink-0 space-y-3 backdrop-blur-xl">
          
          <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-3 items-center">
            
            {/* Left: Active Selected Item Specs / Quick Controls */}
            <div className="bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl p-3 flex flex-col justify-between h-full min-h-[180px]">
              {selectedCartItem ? (
                <div className="space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] uppercase font-black tracking-widest text-indigo-600 dark:text-indigo-400">Selected Item</span>
                      <h4 className="font-black text-sm text-slate-900 dark:text-white line-clamp-1">{selectedCartItem.name}</h4>
                    </div>
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-400">Unit: LKR {selectedCartItem.price.toLocaleString()}</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => { setPadTarget("qty"); setPadBuffer(String(selectedCartItem.quantity || "1")); }}
                      className={`p-2 rounded-xl border text-center transition ${padTarget === "qty" ? "bg-indigo-600 border-indigo-500 text-white font-black shadow" : "bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-300 hover:bg-slate-100"}`}
                    >
                      <div className="text-[9px] uppercase font-bold opacity-70">Quantity</div>
                      <div className="text-base font-black">{selectedCartItem.quantity}</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => { 
                        if (padTarget === "discount") {
                          setDiscountMode(discountMode === "percent" ? "amount" : "percent");
                        } else {
                          setPadTarget("discount"); 
                        }
                      }}
                      className={`p-2 rounded-xl border text-center transition ${padTarget === "discount" ? "bg-rose-600 border-rose-500 text-white font-black shadow" : "bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-300 hover:bg-slate-100"}`}
                    >
                      <div className="text-[9px] uppercase font-bold opacity-70">
                        {discountMode === "percent" ? "Discount (%)" : "Discount (LKR)"}
                      </div>
                      <div className="text-base font-black">
                        {discountValue ? `${discountValue}${discountMode === "percent" ? "%" : " LKR"}` : "0"}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => { setPadTarget("cash"); }}
                      className={`p-2 rounded-xl border text-center transition ${padTarget === "cash" ? "bg-emerald-600 border-emerald-500 text-white font-black shadow" : "bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-300 hover:bg-slate-100"}`}
                    >
                      <div className="text-[9px] uppercase font-bold opacity-70">Cash In</div>
                      <div className="text-base font-black">{cashReceived ? `${Number(cashReceived).toLocaleString()}` : "0"}</div>
                    </button>
                  </div>

                  {/* Payment Method Pills */}
                  <div className="grid grid-cols-4 gap-1 pt-1">
                    {["Cash", "Card", "Bank Transfer", "Mixed"].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPaymentMethod(m)}
                        className={`py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition ${
                          paymentMethod === m 
                            ? "bg-indigo-600 text-white shadow" 
                            : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-transparent shadow-sm"
                        }`}
                      >
                        {m === "Bank Transfer" ? "Bank" : m}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 dark:text-slate-500 py-4">
                  <Info size={24} className="mb-1 opacity-60" />
                  <p className="text-xs font-bold text-slate-600 dark:text-slate-400">No Item Selected</p>
                  <p className="text-[11px] text-slate-500">Tap an item on the receipt to adjust specs</p>
                </div>
              )}
            </div>

            {/* Right: Modern 4x4 Calculator Touch Keypad */}
            <div className="bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 space-y-1.5">
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  "7", "8", "9", "C",
                  "4", "5", "6", "DEL",
                  "1", "2", "3", "00",
                  ".", "0", "EXACT", "ENTER"
                ].map((k) => {
                  const isSpecial = k === "C" || k === "DEL";
                  return (
                    <button
                      key={`calc-${k}`}
                      type="button"
                      onClick={() => {
                        if (k === "EXACT") {
                          setCashReceived(Math.round(dueAfterCredits));
                          setPaymentMethod("Cash");
                        } else if (k === "ENTER") {
                          if (padTarget === "cash" && !checkoutDisabled) {
                            checkout();
                          } else {
                            setPadTarget("cash");
                          }
                        } else {
                          handlePadPress(k);
                        }
                      }}
                      className={`h-11 rounded-xl font-black text-sm flex items-center justify-center transition active:scale-95 select-none shadow-sm ${
                        k === "ENTER"
                          ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                          : k === "EXACT"
                          ? "bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
                          : isSpecial
                          ? "bg-rose-100 hover:bg-rose-200 text-rose-800 dark:bg-rose-950/60 dark:hover:bg-rose-900/80 dark:text-rose-300 border border-rose-300 dark:border-rose-800/40"
                          : "bg-white hover:bg-slate-100 dark:bg-slate-800/90 dark:hover:bg-slate-700 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700/60 text-base"
                      }`}
                    >
                      {k}
                    </button>
                  );
                })}
              </div>
            </div>

          </div>

          {/* FINAL BOTTOM TOUCH ACTION BAR: DISCOUNT, VOID, PAY NOW */}
          <div className="grid grid-cols-1 sm:grid-cols-[140px_140px_1fr] gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => {
                setDiscountMode(discountMode === "percent" ? "amount" : "percent");
                setPadTarget("discount");
              }}
              className="py-3.5 px-3 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-black text-xs uppercase tracking-widest border border-slate-300 dark:border-slate-700 transition active:scale-95 flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Percent size={15} /> Discount ({discountMode === "percent" ? "%" : "LKR"})
            </button>

            <button
              type="button"
              onClick={clearCart}
              disabled={!cart.length}
              className="py-3.5 px-3 rounded-2xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 font-black text-xs uppercase tracking-widest border border-rose-300 dark:border-rose-800/50 transition active:scale-95 disabled:opacity-40 flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Trash2 size={15} /> Void Sale
            </button>

            <button
              type="button"
              onClick={checkout}
              disabled={checkoutDisabled}
              className={`py-3.5 px-6 rounded-2xl font-black text-base uppercase tracking-widest transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-xl ${
                checkoutDisabled
                  ? "bg-slate-100 text-slate-400 border border-slate-300 dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700 cursor-not-allowed"
                  : "bg-emerald-500 hover:bg-emerald-400 text-white dark:text-slate-950 shadow-emerald-500/20 ring-2 ring-emerald-400"
              }`}
            >
              <Check size={20} className="stroke-[3]" />
              <span>PAY NOW · LKR {Math.round(dueAfterCredits).toLocaleString()}</span>
            </button>
          </div>

        </div>

      </div>

    </div>
  );
}

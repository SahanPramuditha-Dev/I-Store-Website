import React from "react";
import QRCode from "react-qr-code";
import { PrintContainer } from "./PrintContainer";

const Field = ({ label, value }) => (
  <div className="flex items-end mb-1.5 text-[10px]">
    <span className="font-semibold whitespace-nowrap pr-1 text-slate-700">{label}</span>
    <div className="flex-grow border-b-2 border-dotted border-slate-300 mb-1 mx-1"></div>
    <span className="whitespace-nowrap pl-1 font-bold">{value || " "}</span>
  </div>
);

export function BoxedDetailedInvoice({ invoice, storeProfile, settings }) {
  const isA4 = settings?.print?.paper_size !== "Thermal 80mm";
  const format = isA4 ? "a4" : "80mm";

  const {
    invoice_number = "INV-000000000",
    created_at = new Date().toISOString(),
    customer_name = "",
    customer_phone = "",
    customer_email = "",
    customer_address = "",
    customer_id = "",
    payment_method = "Cash",
    balance_due = 0,
    subtotal = 0,
    discount_total = 0,
    tax_total = 0,
    grand_total = 0,
    paid_amount = 0,
    lines = [],
    repair_details = {},
  } = invoice || {};

  const {
    brand = "",
    model = "",
    imei = "",
    condition = "",
    accessories = "",
    password = "",
    reported_issue = "",
    technician_notes = "",
  } = repair_details;

  const dateIssued = new Date(created_at).toLocaleDateString();
  const dueDate = new Date(created_at).toLocaleDateString(); // Simplified
  const status = balance_due > 0 ? "UNPAID" : "PAID";
  
  const shopName = storeProfile?.name || "CiperForge Mobile & Repair";
  const shopTagline = storeProfile?.tagline || "Sales • Accessories • Repairs • Software Services";
  const shopReg = storeProfile?.registration_number || "";
  const shopAddress = storeProfile?.address || "No 123, Main Street";
  const shopPhone = storeProfile?.phone || "+94 77 000 0000";
  const shopEmail = storeProfile?.email || "info@shopdomain.com";

  return (
    <PrintContainer format={format} margin={isA4 ? "15mm" : "5mm"}>
      <div className="bg-white w-full h-full text-slate-900 font-sans leading-tight">
        
        {/* HEADER */}
        <div className="flex justify-between items-start border-b border-black pb-2 mb-2">
          {/* LOGO */}
          <div className="w-24 h-24 border border-dashed border-slate-400 flex items-center justify-center text-[10px] text-slate-400 text-center p-2">
            LOGO<br/>(click to upload)
          </div>
          
          {/* CENTER TEXT */}
          <div className="flex-1 text-center px-4">
            <h1 className="text-2xl font-bold font-serif mb-1 uppercase tracking-wider">{shopName}</h1>
            <p className="text-[10px] italic text-slate-600 mb-1">{shopTagline}</p>
            {shopReg && <p className="text-[10px] font-semibold">Business Reg. No: {shopReg}</p>}
            <p className="text-[10px]">{shopAddress}</p>
            <p className="text-[10px]">Tel: {shopPhone} | Email: {shopEmail}</p>
          </div>

          {/* QR CODE */}
          <div className="w-24 h-24 border border-dashed border-slate-400 flex items-center justify-center p-1">
             <QRCode value={invoice_number} size={80} level="L" />
          </div>
        </div>

        {/* TITLE */}
        <h2 className="text-center font-bold text-base uppercase tracking-[0.2em] mb-2 border-b border-black pb-2">
          SALES / REPAIR INVOICE
        </h2>

        {/* TOP INFO GRIDS */}
        <div className="grid grid-cols-2 gap-4 mb-2">
          {/* LEFT: INVOICE INFO */}
          <div className="border border-black">
            <div className="bg-slate-100 border-b border-black px-2 py-1 text-[10px] font-bold uppercase">
              Invoice Information
            </div>
            <div className="p-2">
              <Field label="Invoice No." value={invoice_number} />
              <Field label="Date Issued" value={dateIssued} />
              <Field label="Due Date" value={dueDate} />
              <Field label="Salesperson" value={invoice?.salesperson || ""} />
              <Field label="Payment Method" value={payment_method} />
              <div className="flex justify-between items-center mt-1">
                <span className="text-[10px] font-semibold text-slate-700">Invoice Status</span>
                <span className={`text-[10px] font-bold border px-2 py-0.5 ${status === "PAID" ? "border-green-600 text-green-700" : "border-red-600 text-red-700"}`}>
                  {status}
                </span>
              </div>
            </div>
          </div>
          
          {/* RIGHT: CUSTOMER INFO */}
          <div className="border border-black">
            <div className="bg-slate-100 border-b border-black px-2 py-1 text-[10px] font-bold uppercase">
              Customer Information
            </div>
            <div className="p-2">
              <Field label="Customer Name" value={customer_name || "Walk-in Customer"} />
              <Field label="Phone Number" value={customer_phone} />
              <Field label="Email" value={customer_email} />
              <Field label="Address" value={customer_address} />
              <Field label="Customer ID" value={customer_id ? `CUST-${customer_id}` : ""} />
            </div>
          </div>
        </div>

        {/* DEVICE INFO (Always render empty lines if no repair details to maintain structure) */}
        <div className="border border-black mb-2">
          <div className="bg-slate-100 border-b border-black px-2 py-1 text-[10px] font-bold uppercase">
            Device Information (Repair / Service Jobs)
          </div>
          <div className="p-2">
            <div className="grid grid-cols-3 gap-x-4 mb-2">
              <Field label="Brand" value={brand} />
              <Field label="Model" value={model} />
              <Field label="IMEI / Serial" value={imei} />
              <Field label="Condition" value={condition} />
              <Field label="Accessories" value={accessories} />
              <Field label="Password / PIN" value={password} />
            </div>
            <div className="mb-2">
              <div className="text-[10px] font-semibold text-slate-700 mb-1">Reported Issue</div>
              <div className="border border-slate-300 min-h-[40px] p-1 text-[10px] font-mono">{reported_issue}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-slate-700 mb-1">Technician Notes</div>
              <div className="border border-slate-300 min-h-[40px] p-1 text-[10px] font-mono">{technician_notes}</div>
            </div>
          </div>
        </div>

        {/* ITEMS TABLE */}
        <div className="mb-2 border border-black">
          <div className="bg-slate-100 border-b border-black px-2 py-1 text-[10px] font-bold uppercase">
            Items & Services
          </div>
          <table className="w-full text-[10px]">
            <thead className="border-b-2 border-black">
              <tr>
                <th className="p-1 text-center w-8 border-r border-slate-300">#</th>
                <th className="p-1 text-left border-r border-slate-300">DESCRIPTION</th>
                <th className="p-1 text-center w-12 border-r border-slate-300">QTY</th>
                <th className="p-1 text-right w-20 border-r border-slate-300">UNIT PRICE</th>
                <th className="p-1 text-right w-16 border-r border-slate-300">DISCOUNT</th>
                <th className="p-1 text-right w-16 border-r border-slate-300">TAX %</th>
                <th className="p-1 text-right w-24">TOTAL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300">
              {lines.length > 0 ? lines.map((row, idx) => (
                <tr key={idx}>
                  <td className="p-1 text-center border-r border-slate-300">{idx + 1}</td>
                  <td className="p-1 font-semibold border-r border-slate-300">{row.description}</td>
                  <td className="p-1 text-center border-r border-slate-300">{row.qty || row.quantity || 1}</td>
                  <td className="p-1 text-right border-r border-slate-300">{(row.unit_price || row.price || 0).toFixed(2)}</td>
                  <td className="p-1 text-right border-r border-slate-300">{(row.discount_amount || 0).toFixed(2)}</td>
                  <td className="p-1 text-right border-r border-slate-300">{(row.tax_rate || 0).toFixed(2)}</td>
                  <td className="p-1 text-right font-bold">{(row.line_total || row.total || ((row.qty||row.quantity||1)*(row.unit_price||row.price||0))).toFixed(2)}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan="7" className="p-4 text-center text-slate-400 italic">No items recorded</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* BOTTOM SECTION */}
        <div className="grid grid-cols-2 gap-4 mb-2 items-start">
          {/* WARRANTY */}
          <div className="border border-black h-full">
            <div className="bg-slate-100 border-b border-black px-2 py-1 text-[10px] font-bold uppercase">
              Warranty
            </div>
            <div className="p-2">
              <Field label="Warranty Period" value="30 Days" />
              <Field label="Repair Warranty" value="Parts Only" />
              <p className="mt-2 text-[9px] leading-tight text-slate-700">
                Warranty does not cover physical damage, liquid damage, or damage occurring after the device leaves our premises. Software issues are covered for 7 days from delivery.
              </p>
            </div>
          </div>
          
          {/* TOTALS */}
          <div className="border border-black">
            <div className="p-2 space-y-1">
              <Field label="Subtotal" value={Number(subtotal).toFixed(2)} />
              <Field label="Discount" value={Number(discount_total).toFixed(2)} />
              <Field label="Tax Amount" value={Number(tax_total).toFixed(2)} />
              <Field label="Repair Charges" value="0.00" />
              <Field label="Delivery Charges" value="0.00" />
              <div className="border-t-2 border-black my-1"></div>
              <div className="flex justify-between items-center font-black text-sm">
                <span>Grand Total</span>
                <span>{Number(grand_total).toFixed(2)}</span>
              </div>
              <div className="border-t border-slate-300 my-1"></div>
              <Field label="Paid Amount" value={Number(paid_amount || (grand_total - balance_due)).toFixed(2)} />
              <div className="flex justify-between items-center font-black text-[12px] mt-1 text-slate-800">
                <span>Balance Due</span>
                <span>{Number(balance_due).toFixed(2)}</span>
              </div>
            </div>
            <div className="border-t border-black p-1 text-center text-[9px] italic bg-slate-50">
              Amount in words: Rupees Only
            </div>
          </div>
        </div>

        {/* FOOTER DISCLAIMERS */}
        <div className="grid grid-cols-2 gap-4 mt-auto">
          <div className="border border-black text-[8px] leading-tight p-2">
            <div className="font-bold uppercase mb-1 border-b border-slate-300 pb-1">Terms & Conditions</div>
            <ul className="list-disc pl-3 space-y-0.5">
              <li>Goods once sold are not returnable/exchangeable except under statutory warranty.</li>
              <li>Repaired devices not collected within 30 days may be treated as abandoned.</li>
              <li>All disputes are subject to local jurisdiction only.</li>
            </ul>
          </div>
          <div className="border border-black text-[8px] leading-tight p-2">
            <div className="font-bold uppercase mb-1 border-b border-slate-300 pb-1">Liability & Data Disclaimer</div>
            <ul className="list-disc pl-3 space-y-0.5">
              <li>The shop is not liable for pre-existing damage discovered during repair.</li>
              <li>Customers are responsible for backing up data; we are not liable for data loss during servicing.</li>
              <li>Warranty is void if the device shows signs of tampering by a third party.</li>
            </ul>
          </div>
        </div>

      </div>
    </PrintContainer>
  );
}

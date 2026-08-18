import React, { useState } from "react";
import { MessageSquare, Copy, Check, Send, Loader2, XCircle } from "lucide-react";
import { Button } from "./UI";
import { useFeedback } from "./FeedbackProvider";
import api from "../lib/api";

export function ReceiptShareModal({ invoice, isOpen, onClose }) {
  const { toast } = useFeedback();
  const [copied, setCopied]               = useState(false);
  const [sending, setSending]             = useState(false);
  const [phoneNumber, setPhoneNumber]     = useState(invoice?.customer_phone || "");
  const [sendResult, setSendResult]       = useState(null); // null | 'ok' | 'failed' | 'error'
  const [sendDetail, setSendDetail]       = useState("");

  if (!isOpen || !invoice) return null;

  const invoiceNo   = invoice.invoice_number || invoice.invoice_no || `INV-${invoice.id || '0001'}`;
  const custName    = invoice.customer_name || invoice.customer || "Valued Customer";
  const totalAmt    = Number(invoice.total_amount || invoice.grand_total || invoice.total || 0);
  const subtotalAmt = Number(invoice.subtotal || totalAmt);
  const discountAmt = Number(invoice.discount_amount || invoice.discount || 0);
  const paidAmt     = Number(invoice.amount_paid || totalAmt);
  const balAmt      = Number(invoice.balance_due || 0);
  const payMethod   = String(invoice.payment_method || "Cash");
  const dateStr     = new Date(invoice.created_at || Date.now()).toLocaleString();

  const s = `${invoiceNo}istore_secure_salt_2026`;
  let hashVal = 0;
  for (let i = 0; i < s.length; i++) {
    hashVal = (hashVal << 5) - hashVal + s.charCodeAt(i);
    hashVal = (hashVal + 2**31) % 2**32 - 2**31;
  }
  const token = `sec_${Math.abs(hashVal).toString(16).padStart(8, '0')}`.slice(0, 12);

  const firstItemObj = (invoice.items || invoice.lines || [])[0] || {};
  const firstItemName = firstItemObj?.item_name || firstItemObj?.description || "Device / Retail Product";
  const firstItemWarrantyDays = Number(firstItemObj?.warranty_days ?? firstItemObj?.warrantyDays ?? 0);
  const firstItemWarrantyMonths = firstItemWarrantyDays > 0 ? Math.round(firstItemWarrantyDays / 30) : 0;

  const portalBase = "https://i-store-customer-portal-one.vercel.app";
  const billUrl = `${portalBase}/invoice/${invoiceNo}?token=${token}&name=${encodeURIComponent(custName)}&total=${totalAmt.toFixed(2)}&subtotal=${subtotalAmt.toFixed(2)}&disc=${discountAmt.toFixed(2)}&phone=${encodeURIComponent(phoneNumber || '')}&method=${encodeURIComponent(payMethod)}&item=${encodeURIComponent(firstItemName)}&warranty=${firstItemWarrantyMonths}&warranty_days=${firstItemWarrantyDays}`;
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(billUrl)}&format=png&margin=12`;

  const textMessage = `🧾 *OFFICIAL DIGITAL RECEIPT*\n━━━━━━━━━━━━━━━━━━━━\n👋 Hello *${custName}*,\n\nThank you for shopping with *I-Store*! Your transaction has been confirmed:\n\n📋 *Invoice No:* #${invoiceNo}\n📅 *Date:* ${dateStr}\n💳 *Payment Method:* ${payMethod}\n\n💰 *Payment Breakdown:*\n• Subtotal: LKR ${subtotalAmt.toLocaleString()}\n• Discount: LKR ${discountAmt.toLocaleString()}\n• *Grand Total: LKR ${totalAmt.toLocaleString()}*\n• Amount Paid: LKR ${paidAmt.toLocaleString()}\n• *Balance Due: LKR ${balAmt.toLocaleString()}*\n\n📄 *View & Download Digital Bill:*\n${billUrl}\n\n🛡️ *Warranty & Digital Records:*\nYour warranty coverage and device serial numbers are digitally registered with your bill.\n\n📞 *Support Hotline:* +94 77 123 4567\n━━━━━━━━━━━━━━━━━━━━\n_Thank you for choosing I-Store! Have a wonderful day!_`;

  // Normalize phone: 0771234567 → 94771234567
  const normalizePhone = (raw) => {
    const digits = raw.replace(/[^\d]/g, "");
    if (digits.startsWith("94") && digits.length === 11) return digits;
    if (digits.startsWith("0") && digits.length === 10)  return "94" + digits.slice(1);
    if (digits.length === 9 && digits.startsWith("7"))    return "94" + digits;
    return digits;
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(textMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendWhatsApp = async () => {
    const cleanPhone = normalizePhone(phoneNumber);
    if (!cleanPhone || cleanPhone.length < 10) {
      setSendResult("error");
      setSendDetail("Please enter a valid phone number.");
      return;
    }

    setSending(true);
    setSendResult(null);
    setSendDetail("");

    try {
      // Route through Python backend — it holds the service secret and does ACK waiting.
      // Never fall back to wa.me — that bypasses the internal delivery entirely.
      const res  = await api.post("/api/whatsapp/send-direct", {
        phone:   cleanPhone,
        message: textMessage
      });

      if (res.data?.ok) {
        setSendResult("ok");
        setSendDetail(`Receipt sent to ${cleanPhone}.`);
        toast({
          title: "WhatsApp Receipt Delivered",
          description: `Official receipt for #${invoiceNo} (${currency} ${totalAmount}) dispatched to customer.`,
          details: `Recipient: +${cleanPhone} • Message ID: ${res.data?.message_id || "sent"}`,
          tone: "success",
          iconType: "whatsapp",
          timeoutMs: 4500
        });
        setTimeout(onClose, 1800);
      } else {
        setSendResult("failed");
        setSendDetail(res.data?.detail || res.data?.error || "Send failed.");
      }
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || "Unknown error";
      setSendResult("failed");
      if (detail.toLowerCase().includes("not registered")) {
        setSendDetail("This number is not registered on WhatsApp.");
      } else if (detail.toLowerCase().includes("offline") || detail.toLowerCase().includes("reachable")) {
        setSendDetail("WhatsApp service is offline. Please start it and try again.");
      } else if (detail.toLowerCase().includes("ack_error") || detail.toLowerCase().includes("rejected")) {
        setSendDetail("WhatsApp rejected the message. The account may be rate-limited — wait a few minutes.");
      } else {
        setSendDetail(detail);
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-6 text-slate-900 dark:text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800 mb-4">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-lg">
            <MessageSquare className="w-5 h-5" />
            Send Receipt via WhatsApp
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-bold">×</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-400 mb-1">
              Customer Phone Number
            </label>
            <input
              type="text"
              value={phoneNumber}
              onChange={(e) => { setPhoneNumber(e.target.value); setSendResult(null); }}
              placeholder="e.g. 0771234567 or 94771234567"
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-900 dark:text-slate-100 text-sm focus:border-emerald-500 focus:outline-none"
            />
            <p className="text-[11px] text-slate-500 mt-1">Local and international formats both accepted.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-400 mb-1">Receipt Message Preview</label>
            <textarea
              readOnly
              rows={5}
              value={textMessage}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-300 text-xs font-mono focus:outline-none"
            />
          </div>

          {/* Send result feedback */}
          {sendResult && (
            <div className={`flex items-start gap-2 text-xs font-semibold px-3 py-2 rounded-lg ${
              sendResult === "ok"
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                : "bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300"
            }`}>
              {sendResult === "ok"
                ? <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                : <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
              <span>{sendDetail}</span>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={handleCopy}
              className="flex-1 border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center gap-2"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-4 h-4" />}
              {copied ? "Copied" : "Copy Text"}
            </Button>
            <button
              onClick={handleSendWhatsApp}
              disabled={sending}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium rounded-lg px-4 py-2 text-sm flex items-center justify-center gap-2 transition cursor-pointer"
            >
              {sending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
                : <><Send className="w-4 h-4" /> Send via WhatsApp</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

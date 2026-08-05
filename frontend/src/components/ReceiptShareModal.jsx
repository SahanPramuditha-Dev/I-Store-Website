import React, { useState } from "react";
import { MessageSquare, Share2, Copy, Check } from "lucide-react";
import { Button } from "./UI";

export function ReceiptShareModal({ invoice, isOpen, onClose }) {
  const [copied, setCopied] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState(invoice?.customer_phone || "");

  if (!isOpen || !invoice) return null;

  const currency = "LKR";
  const totalAmount = (invoice.total_amount || invoice.grand_total || 0).toLocaleString();
  const invoiceNo = invoice.invoice_number || invoice.id || "INV-0001";
  
  const textMessage = `*${invoice.shop_name || "I Store"} - Official Receipt*\n` +
    `Invoice: #${invoiceNo}\n` +
    `Date: ${invoice.created_at ? new Date(invoice.created_at).toLocaleDateString() : new Date().toLocaleDateString()}\n` +
    `---------------------------\n` +
    `Total Amount: ${currency} ${totalAmount}\n` +
    `Items Count: ${invoice.items?.length || invoice.lines?.length || 1}\n` +
    `---------------------------\n` +
    `Thank you for shopping with us!\n` +
    `View Digital Invoice: ${window.location.origin}/invoices/${invoiceNo}`;

  const cleanPhone = phoneNumber.replace(/[^0-9]/g, "");
  const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(textMessage)}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(textMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-md p-6 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
          <div className="flex items-center gap-2 text-emerald-400 font-semibold text-lg">
            <MessageSquare className="w-5 h-5" />
            Share Receipt via WhatsApp
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-xl font-bold">×</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Customer Phone (WhatsApp)</label>
            <input
              type="text"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="e.g. 94771234567"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">Receipt Message Preview</label>
            <textarea
              readOnly
              value={textMessage}
              rows={7}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-300 text-xs font-mono resize-none focus:outline-none"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={handleCopy}
              className="flex-1 border-slate-700 text-slate-300 hover:bg-slate-800 flex items-center justify-center gap-2"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              {copied ? "Copied" : "Copy Text"}
            </Button>
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg px-4 py-2 text-sm flex items-center justify-center gap-2 transition"
            >
              <Share2 className="w-4 h-4" />
              Open WhatsApp
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

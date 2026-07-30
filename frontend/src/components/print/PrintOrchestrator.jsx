import React, { useEffect, useState, useRef } from "react";
import api from "../../lib/api";
import { ModernRetailInvoice } from "./ModernRetailInvoice";
import { PremiumBusinessInvoice } from "./PremiumBusinessInvoice";
import { DynamicInvoice } from "./DynamicInvoice";
import { PrintJobCard } from "./PrintJobCard";
import { PrintLabel } from "./PrintLabel";
import { GenericPrintDocument } from "./GenericPrintDocument";
import { BoxedDetailedInvoice } from "./BoxedDetailedInvoice";

// A fallback legacy view if no modern template matches
function LegacyFallback({ html }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

export function PrintOrchestrator({ documentId, referenceId, format, templateId, onLoaded }) {
  const [data, setData] = useState(null);
  const [storeProfile, setStoreProfile] = useState({});
  const [settings, setSettings] = useState({});
  const [legacyHtml, setLegacyHtml] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const storeRes = await api.get("/settings/section/store_profile");
        const designRes = await api.get("/settings/section/invoice_receipt_design");

        const header = designRes.data?.header_configuration || {};
        const body = designRes.data?.body_configuration || {};
        const footer = designRes.data?.footer_configuration || {};
        const receiptFormat = designRes.data?.receipt_format || {};

        const derivedSettings = {
          print: {
            paper_size: receiptFormat.paper_size || "",
            margin_mm: 12,
          },
          branding: {
            show_logo: Boolean(header.show_shop_logo),
            show_shop_name: Boolean(header.show_shop_name),
          },
          business: {
            show_address: Boolean(header.show_address),
            show_phone: Boolean(header.show_phone_number),
            show_email: Boolean(header.show_email),
            show_website: Boolean(header.show_website),
          },
          header: {
            title_text: header.custom_header_text || "",
          },
          bill_to: {
            show_section: Boolean(body.show_customer_name),
          },
          footer: {
            show_thank_you: Boolean(footer.show_thank_you_message),
            thank_you_text: footer.thank_you_text || "",
          },
        };

        let docData = null;
        const printableDoc = String(documentId || "").trim();
        const token = String(referenceId || "").trim();
        const isInvoice = printableDoc === "invoice" || printableDoc === "sales_receipt" || printableDoc === "sales_bill";

        if (token && isInvoice) {
          const isNumeric = /^\d+$/.test(token);
          const res = isNumeric
            ? await api.get(`/invoices/${encodeURIComponent(token)}`)
            : await api.get(`/invoices/number/${encodeURIComponent(token)}`);
          docData = res.data;
        }

        if (docData) {
          setData(docData);
          setLegacyHtml(null);
        } else {
          const res = await api.get("/print-center/render", {
            params: { document_type: documentId, reference: referenceId, paper: format },
          });
          setLegacyHtml(res.data);
          setData(null);
        }

        setStoreProfile(storeRes.data);
        setSettings(derivedSettings);
      } catch (err) {
        const status = err?.response?.status;
        if (status && status !== 404) {
          console.error("Error fetching print data, falling back to legacy HTML", err);
        }
        // Fallback to legacy HTML render
        try {
          const res = await api.get("/print-center/render", {
            params: { document_type: documentId, reference: referenceId, paper: format }
          });
          setLegacyHtml(res.data);
        } catch (e) {
          console.error("Fallback failed", e);
        }
      } finally {
        setLoading(false);
        if (onLoaded) onLoaded();
      }
    }
    fetchData();
  }, [documentId, referenceId, format, templateId]);

  if (loading) return <div className="p-8 text-center text-slate-500">Loading print data...</div>;

  if (legacyHtml && !data) {
    return <LegacyFallback html={legacyHtml} />;
  }
  
  if (!data) return <div className="p-8 text-center text-red-500">Could not load document data.</div>;

  const docType = documentId === "sales_receipt" ? "sales_bill" : documentId;
  const preset = settings?.layout?.preset_type || "modern";

  if (docType === "sales_bill") {
    if (preset === "dynamic") return <DynamicInvoice invoice={data} storeProfile={storeProfile} settings={settings} />;
    if (preset === "premium") return <PremiumBusinessInvoice invoice={data} storeProfile={storeProfile} settings={settings} />;
    if (preset === "boxed") return <BoxedDetailedInvoice invoice={data} storeProfile={storeProfile} settings={settings} />;
    return <ModernRetailInvoice invoice={data} storeProfile={storeProfile} settings={settings} />;
  }
  
  if (docType === "repair_job_card" || docType === "job_card") {
    if (preset === "boxed") return <BoxedDetailedInvoice invoice={{ ...data, repair_details: data }} storeProfile={storeProfile} settings={settings} />;
    return <PrintJobCard jobCard={data} storeProfile={storeProfile} settings={settings} />;
  }
  
  // For labels, data would be a product object
  if (docType === "product_label" || docType === "labels") {
    return <PrintLabel product={data} storeProfile={storeProfile} settings={settings} />;
  }

  // For generic legacy documents
  if (["warranty_certificate", "advance_receipt", "return_receipt", "payment_receipt"].includes(docType)) {
    return <GenericPrintDocument documentType={docType} data={data} storeProfile={storeProfile} settings={settings} />;
  }

  return <div className="p-8 text-center">Unsupported document type for React rendering.</div>;
}

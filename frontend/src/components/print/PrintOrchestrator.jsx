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
        // 1. Fetch the raw data for the document
        // 2. Fetch the store profile
        // 3. Fetch the customizer settings for this documentId
        
        // As a shortcut to bridge the legacy gap quickly, we can call a new endpoint 
        // OR we can just fetch the existing /print-center/data endpoint if it existed.
        // Wait, the backend already has /print-center/render which returns HTML.
        // We need the raw JSON data to feed into our React components.
        
        // Let's see how PrintCenter normally fetches data. It calls /print-center/render.
        // If we want raw data, we need to fetch the invoice/job details directly.
        
        // Actually, if we look at Customizer, it fetches `settings` via /settings/print-templates
        // and uses mock data. For real data, we must fetch from /invoices/{ref}, /repairs/{ref}, etc.
        
        let docData = null;
        if (documentId === "sales_receipt" || documentId === "sales_bill") {
          const res = await api.get(`/invoices/number/${referenceId}`);
          docData = res.data;
        } else if (documentId === "repair_job_card" || documentId === "job_card") {
          const res = await api.get(`/repairs/${referenceId}`);
          docData = res.data;
        }
        
        const storeRes = await api.get("/settings/store-profile");
        const settingsRes = await api.get("/settings/print-templates");
        
        // Find active template settings
        const templates = settingsRes.data?.templates || [];
        let activeTemplate = templateId 
          ? templates.find(t => t.id === templateId) 
          : templates.find(t => (t.document === documentId || t.document === "sales_bill") && t.deployed);
          
        if (!activeTemplate) {
          activeTemplate = templates.find(t => t.document === "sales_bill");
        }

        setData(docData);
        setStoreProfile(storeRes.data);
        setSettings(activeTemplate?.settings || {});
        
      } catch (err) {
        console.error("Error fetching print data, falling back to legacy HTML", err);
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

import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../lib/api";
import { Badge, Button } from "../components/UI";
import { ArrowLeft, Printer } from "lucide-react";

export default function InvoiceView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const iframeRef = useRef(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [invoiceTemplate, setInvoiceTemplate] = useState("");

  useEffect(() => {
    let active = true;
    api
      .get("/settings/section/invoice_receipt_design")
      .then((res) => {
        if (!active) return;
        setInvoiceTemplate(String(res.data?.default_template || "").trim());
      })
      .catch(() => {
        if (!active) return;
        setInvoiceTemplate("");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!id) {
      setError("Missing invoice id");
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
    api
      .get("/print-center/render", {
        params: {
          document_type: "invoice",
          reference: id,
          paper: "a4",
          ...(invoiceTemplate ? { template: invoiceTemplate } : {}),
        },
        responseType: "text",
        transformResponse: [(data) => data],
      })
      .then(({ data }) => {
        if (!mounted) return;
        setPreviewHtml(String(data || ""));
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err.response?.data?.detail || err.message || "Failed to load invoice preview");
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [id, invoiceTemplate]);

  const handlePrint = () => {
    if (!iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.focus();
    iframeRef.current.contentWindow.print();
  };

  if (loading) return <div className="p-4">Loading invoice preview...</div>;
  if (error) return (
    <div className="p-4">
      <div className="text-rose-300">{error}</div>
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" onClick={() => navigate(-1)}><ArrowLeft size={14} /> Back</Button>
        <Button variant="secondary" onClick={() => window.location.reload()}><Printer size={14} /> Retry</Button>
      </div>
    </div>
  );

  return (
    <div className="p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
        <div>
          <h2 className="text-lg font-black">Invoice Preview</h2>
          <p className="text-sm text-slate-400">Invoice ID: {id}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="green">Store Default Template</Badge>
          <Button variant="secondary" onClick={() => navigate(-1)}><ArrowLeft size={14} /> Back</Button>
          <Button onClick={handlePrint}><Printer size={14} /> Print</Button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 overflow-hidden bg-slate-950" style={{ minHeight: "640px" }}>
        <iframe
          ref={iframeRef}
          title="Invoice Preview"
          srcDoc={previewHtml}
          className="w-full h-[800px] border-0 bg-white"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
        />
      </div>
    </div>
  );
}

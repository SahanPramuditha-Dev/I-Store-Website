import React from "react";
import { PrintContainer } from "./PrintContainer";
import { PrintHeader } from "./PrintHeader";

export function PrintJobCard({ jobCard: propJobCard, settings, storeProfile }) {
  // Use a default job card object for preview if none provided
  const jobCard = propJobCard || {
    job_number: "JOB-7890",
    customer_name: "John Doe",
    customer_phone: "+94 77 987 6543",
    device_model: "iPhone 13 Pro",
    device_imei: "359812345678901",
    issue_description: "Screen replacement and battery check",
    estimated_cost: 35000,
    created_at: new Date().toISOString(),
    status: "Pending"
  };

  const format = settings?.print?.paper_size === "Thermal 80mm" ? "80mm" : "a4";
  const margin = settings?.print?.margin_mm ? `${settings.print.margin_mm}mm` : "12mm";
  const isA4 = format === "a4";

  return (
    <PrintContainer format={format} margin={margin} style={{
      backgroundColor: settings?.print?.background_color || "#ffffff",
      fontFamily: settings?.style?.font_family || "inherit"
    }}>
      <PrintHeader branding={settings?.branding} business={settings?.business} storeProfile={storeProfile} />
      
      <div className={`mt-4 border-t-2 border-b-2 py-3 mb-4 flex flex-col gap-1 border-slate-200`}>
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold uppercase tracking-wider">Job Sheet</h2>
          <span className="font-bold text-lg">{jobCard.job_number}</span>
        </div>
        <div className="flex justify-between items-center text-sm opacity-70">
          <span>Date: {new Date(jobCard.created_at).toLocaleDateString()}</span>
          <span>Status: {jobCard.status}</span>
        </div>
      </div>

      <div className={`grid ${isA4 ? 'grid-cols-2 gap-6' : 'grid-cols-1 gap-4'} mb-6`}>
        {/* Customer Details */}
        <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
          <h3 className="text-xs font-bold uppercase text-slate-400 mb-2">Customer Details</h3>
          <div className="font-semibold text-lg">{jobCard.customer_name}</div>
          <div className="text-sm opacity-80">{jobCard.customer_phone}</div>
        </div>

        {/* Device Details */}
        <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
          <h3 className="text-xs font-bold uppercase text-slate-400 mb-2">Device Details</h3>
          <div className="font-semibold">{jobCard.device_model}</div>
          <div className="text-sm opacity-80">IMEI: {jobCard.device_imei}</div>
        </div>
      </div>

      {/* Issue Details */}
      <div className="mb-6">
        <h3 className="text-xs font-bold uppercase text-slate-400 mb-2 border-b pb-1">Reported Issue</h3>
        <p className="text-sm p-3 bg-slate-50 rounded-lg whitespace-pre-wrap">
          {jobCard.issue_description}
        </p>
      </div>

      {/* Estimates */}
      <div className="flex justify-end mb-8">
        <div className="text-right p-4 bg-slate-50 rounded-lg min-w-[200px]">
          <div className="text-xs font-bold uppercase text-slate-400 mb-1">Estimated Cost</div>
          <div className="text-2xl font-bold">Rs. {jobCard.estimated_cost.toFixed(2)}</div>
        </div>
      </div>

      {/* Signatures */}
      {settings?.footer?.show_thank_you && (
        <div className={`mt-12 grid ${isA4 ? 'grid-cols-2' : 'grid-cols-1 gap-8'} text-center pt-8`}>
          <div>
            <div className="border-t border-slate-300 w-48 mx-auto pt-2 text-sm opacity-70">
              Customer Signature
            </div>
          </div>
          <div>
            <div className="border-t border-slate-300 w-48 mx-auto pt-2 text-sm opacity-70">
              Technician Signature
            </div>
          </div>
        </div>
      )}

      {/* Footer Notes */}
      <div className="mt-8 text-center text-xs opacity-50 border-t pt-4">
        {settings?.footer?.thank_you_text || "Terms & Conditions apply. Device must be collected within 30 days."}
      </div>
    </PrintContainer>
  );
}

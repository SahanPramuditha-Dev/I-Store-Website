import { useMemo, useState } from "react";
import { 
  Globe, 
  ShieldCheck, 
  Receipt, 
  Wrench, 
  Gift, 
  Calendar, 
  ExternalLink, 
  Copy, 
  Check, 
  MessageSquare, 
  Sparkles,
  QrCode,
  Lock,
  RefreshCw
} from "lucide-react";
import { Input, SectionCard, Button, Badge } from "../../components/UI";
import SettingsSectionShell from "./SettingsSectionShell";

const DEFAULTS = {
  portal_config: {
    portal_base_url: "https://i-store-customer-portal-one.vercel.app",
    custom_store_slug: "i-point",
    enable_public_warranty_verification: true,
    enable_digital_receipt_lookup: true,
    enable_online_repair_tracking: true,
    enable_loyalty_point_program: true,
    enable_service_appointment_booking: true,
    enable_trade_in_estimator: true,
  },
  loyalty_rules: {
    lkr_spent_per_loyalty_point: 1000,
    lkr_discount_per_point_redeemed: 1,
    min_points_for_redemption: 100,
    enable_auto_point_awarding: true,
  },
  branding_and_content: {
    hero_heading: "Your Purchases. Your Warranties. Always With You.",
    hero_subheading: "Official cloud portal for instant digital receipts, hardware warranty validation certificates, and live repair tracking.",
    whatsapp_greeting_text: "Hi support team, I need assistance regarding my invoice or warranty record.",
    security_badge_text: "SHA-256 Verified Cloud Vault Active",
  },
  policy_terms: {
    warranty_coverage_scope: "Standard hardware defects are protected. Physical drops, water ingress, and unauthorized third-party repairs void manufacturer coverage.",
    repair_service_sla: "Diagnostic assessment within 24-48 hours. Replaced original components carry a 30 to 90-day service warranty.",
    privacy_policy_statement: "Customer contact information and invoices are encrypted with secure session verification tokens.",
  },
};

function RowToggle({ label, checked, onChange, hint, icon: Icon }) {
  return (
    <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-3 text-xs hover:border-cyan-500/40 transition-colors">
      <div className="flex items-start space-x-2.5 pr-4">
        {Icon && <Icon className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />}
        <div>
          <p className="font-semibold text-slate-200">{label}</p>
          {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
        </div>
      </div>
      <input 
        type="checkbox" 
        checked={!!checked} 
        onChange={(e) => onChange(e.target.checked)} 
        className="w-4 h-4 rounded text-cyan-500 focus:ring-cyan-500 focus:ring-offset-0 bg-slate-800 border-slate-700"
      />
    </label>
  );
}

function validate(data) {
  const errors = [];
  if (!data?.portal_config?.portal_base_url) errors.push("Portal base URL cannot be empty.");
  if (Number(data?.loyalty_rules?.lkr_spent_per_loyalty_point || 0) <= 0) {
    errors.push("LKR spent per loyalty point must be greater than 0.");
  }
  return errors;
}

export default function CustomerPortalSettingsPanel({
  sectionValue,
  onSectionChange,
  onSaveSection,
  saving,
  toast,
  confirm,
  prompt,
  storeProfile = {},
}) {
  const [copiedUrl, setCopiedUrl] = useState(false);

  const merged = useMemo(() => {
    return {
      portal_config: { ...DEFAULTS.portal_config, ...(sectionValue?.portal_config || {}) },
      loyalty_rules: { ...DEFAULTS.loyalty_rules, ...(sectionValue?.loyalty_rules || {}) },
      branding_and_content: { ...DEFAULTS.branding_and_content, ...(sectionValue?.branding_and_content || {}) },
      policy_terms: { ...DEFAULTS.policy_terms, ...(sectionValue?.policy_terms || {}) },
    };
  }, [sectionValue]);

  const liveStoreUrl = useMemo(() => {
    const base = merged.portal_config.portal_base_url.replace(/\/$/, "");
    const slug = (merged.portal_config.custom_store_slug || storeProfile?.business_identity?.shop_name || "store")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-");
    return `${base}/store/${slug}`;
  }, [merged.portal_config.portal_base_url, merged.portal_config.custom_store_slug, storeProfile]);

  const update = (category, field, value) => {
    onSectionChange({
      ...merged,
      [category]: {
        ...merged[category],
        [field]: value,
      },
    });
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(liveStoreUrl);
      setCopiedUrl(true);
      if (toast) toast("Portal URL copied to clipboard!", "success");
      setTimeout(() => setCopiedUrl(false), 2500);
    } catch {
      // ignore
    }
  };

  return (
    <SettingsSectionShell
      title="Customer Portal & Cloud Vault Settings"
      description="Configure live customer self-service features, digital receipt URLs, warranty certificates, and loyalty conversion rates."
      icon={Globe}
      validationErrors={validate(merged)}
      onSave={onSaveSection}
      saving={saving}
      onResetDefaults={() => onSectionChange(DEFAULTS)}
    >
      <div className="space-y-6">
        
        {/* Live URL & Cloud Access Hub */}
        <SectionCard title="Live Customer Portal Connection">
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-gradient-to-r from-cyan-950/40 via-blue-950/30 to-indigo-950/40 border border-cyan-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span className="text-xs font-bold text-cyan-300 uppercase tracking-wider">Live Customer Portal URL</span>
                </div>
                <p className="text-xs font-mono font-bold text-white break-all">
                  {liveStoreUrl}
                </p>
                <p className="text-[11px] text-slate-400">
                  Printed automatically on smart invoice QR codes and shared via WhatsApp billing.
                </p>
              </div>

              <div className="flex items-center space-x-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer border border-white/10"
                >
                  {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedUrl ? "Copied" : "Copy Link"}</span>
                </button>
                <a
                  href={liveStoreUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer shadow-md shadow-cyan-600/30"
                >
                  <span>Open Portal</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Portal Base Domain / URL</span>
                <Input
                  value={merged.portal_config.portal_base_url}
                  onChange={(e) => update("portal_config", "portal_base_url", e.target.value)}
                  placeholder="https://i-store-customer-portal-one.vercel.app"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Store Tenant Slug</span>
                <Input
                  value={merged.portal_config.custom_store_slug}
                  onChange={(e) => update("portal_config", "custom_store_slug", e.target.value)}
                  placeholder="e.g. i-point or liberty-plaza"
                />
              </label>
            </div>
          </div>
        </SectionCard>

        {/* Feature Switches */}
        <SectionCard title="Customer Portal Feature Controls">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <RowToggle
              icon={ShieldCheck}
              label="Public Warranty Verification"
              hint="Allow customers to check warranty status by typing or scanning IMEI/Serial"
              checked={merged.portal_config.enable_public_warranty_verification}
              onChange={(val) => update("portal_config", "enable_public_warranty_verification", val)}
            />

            <RowToggle
              icon={Receipt}
              label="Interactive Digital Bills"
              hint="Allow viewing high-res receipts and downloading official PDFs"
              checked={merged.portal_config.enable_digital_receipt_lookup}
              onChange={(val) => update("portal_config", "enable_digital_receipt_lookup", val)}
            />

            <RowToggle
              icon={Wrench}
              label="Real-Time Repair Progress"
              hint="Live milestone progress tracker and technician status updates"
              checked={merged.portal_config.enable_online_repair_tracking}
              onChange={(val) => update("portal_config", "enable_online_repair_tracking", val)}
            />

            <RowToggle
              icon={Gift}
              label="Loyalty Rewards & Points Program"
              hint="Show loyalty balance and available discount vouchers on customer profile"
              checked={merged.portal_config.enable_loyalty_point_program}
              onChange={(val) => update("portal_config", "enable_loyalty_point_program", val)}
            />

            <RowToggle
              icon={Calendar}
              label="Online Service Booking"
              hint="Allow customers to reserve prioritized diagnostic & repair intake slots"
              checked={merged.portal_config.enable_service_appointment_booking}
              onChange={(val) => update("portal_config", "enable_service_appointment_booking", val)}
            />

            <RowToggle
              icon={RefreshCw}
              label="Device Trade-In Estimator"
              hint="Provide instant trade-in valuation quotes for customer devices"
              checked={merged.portal_config.enable_trade_in_estimator}
              onChange={(val) => update("portal_config", "enable_trade_in_estimator", val)}
            />
          </div>
        </SectionCard>

        {/* Loyalty Program Calculation Rules */}
        <SectionCard title="Loyalty & Rewards Conversion Rules">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">LKR Spend Per 1 Point Earned</span>
              <Input
                type="number"
                value={merged.loyalty_rules.lkr_spent_per_loyalty_point}
                onChange={(e) => update("loyalty_rules", "lkr_spent_per_loyalty_point", Number(e.target.value))}
              />
              <span className="text-[10px] text-slate-500">e.g. LKR 1,000 spend = 1 Point</span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">LKR Discount Per 1 Point Redeemed</span>
              <Input
                type="number"
                value={merged.loyalty_rules.lkr_discount_per_point_redeemed}
                onChange={(e) => update("loyalty_rules", "lkr_discount_per_point_redeemed", Number(e.target.value))}
              />
              <span className="text-[10px] text-slate-500">e.g. 1 Point = LKR 1.00 off</span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Minimum Points To Redeem</span>
              <Input
                type="number"
                value={merged.loyalty_rules.min_points_for_redemption}
                onChange={(e) => update("loyalty_rules", "min_points_for_redemption", Number(e.target.value))}
              />
              <span className="text-[10px] text-slate-500">Threshold before voucher unlocks</span>
            </label>
          </div>
        </SectionCard>

        {/* Portal Branding & Customer Messages */}
        <SectionCard title="Portal Hero & WhatsApp Integration">
          <div className="space-y-4 text-xs">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Portal Hero Headline</span>
              <Input
                value={merged.branding_and_content.hero_heading}
                onChange={(e) => update("branding_and_content", "hero_heading", e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Portal Subtitle / Introduction</span>
              <textarea
                rows={2}
                className="field text-xs text-slate-200"
                value={merged.branding_and_content.hero_subheading}
                onChange={(e) => update("branding_and_content", "hero_subheading", e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Default WhatsApp Support Greeting</span>
              <Input
                value={merged.branding_and_content.whatsapp_greeting_text}
                onChange={(e) => update("branding_and_content", "whatsapp_greeting_text", e.target.value)}
              />
              <span className="text-[10px] text-slate-500">Pre-populated when customers click the WhatsApp Care button</span>
            </label>
          </div>
        </SectionCard>

        {/* Store Policy Terms Customization */}
        <SectionCard title="Store Policy Modal Text">
          <div className="space-y-4 text-xs">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Warranty Coverage Terms</span>
              <textarea
                rows={2}
                className="field text-xs text-slate-200"
                value={merged.policy_terms.warranty_coverage_scope}
                onChange={(e) => update("policy_terms", "warranty_coverage_scope", e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Repair Service SLA Terms</span>
              <textarea
                rows={2}
                className="field text-xs text-slate-200"
                value={merged.policy_terms.repair_service_sla}
                onChange={(e) => update("policy_terms", "repair_service_sla", e.target.value)}
              />
            </label>
          </div>
        </SectionCard>

      </div>
    </SettingsSectionShell>
  );
}

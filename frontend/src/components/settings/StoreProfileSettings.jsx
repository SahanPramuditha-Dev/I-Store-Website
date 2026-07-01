import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  Download,
  Globe,
  ImageUp,
  Landmark,
  Languages,
  MapPinned,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Undo2,
  UserCheck,
} from "lucide-react";
import { Badge, Button, Input, KpiCard, SectionCard, Select, Table, WorkstationNotice } from "../../components/UI";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SECTION_LIST = [
  { id: "identity", label: "Business Identity", icon: Building2 },
  { id: "contact", label: "Contact Information", icon: Globe },
  { id: "address", label: "Address", icon: MapPinned },
  { id: "hours", label: "Business Hours", icon: Clock3 },
  { id: "branding", label: "Logo & Branding", icon: ImageUp },
  { id: "branches", label: "Branch Profiles", icon: Landmark },
  { id: "localization", label: "Localization", icon: Languages },
  { id: "workflow", label: "Approval & Audit", icon: ShieldCheck },
];

const PHONE_RE = /^(\+94|0)(7\d{8}|[1-9]\d{8})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const URL_RE = /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/.*)?$/i;
const VAT_RE = /^[A-Za-z0-9\-\/]{6,20}$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function formatDateTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function slug(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildDefaultStoreProfile() {
  const baseHours = Object.fromEntries(
    DAY_NAMES.map((day, index) => [
      day.toLowerCase(),
      {
        open: index < 5 ? "09:00" : index === 5 ? "09:00" : "09:00",
        close: index < 5 ? "19:00" : index === 5 ? "17:00" : "14:00",
        enabled: index !== 6,
      },
    ])
  );

  return {
    business_identity: {
      shop_name: "I Point",
      business_type: "Mobile Phone Shop",
      registration_number: "",
      tax_vat_number: "",
      owner_name: "",
      support_hotline: "",
      shop_tagline: "YOUR NO.01 MOBILE PARTNER",
    },
    contact_information: {
      primary_phone: "",
      secondary_phone: "",
      whatsapp_number: "",
      email_address: "",
      website_url: "",
      facebook_url: "",
      instagram_handle: "",
      tiktok_handle: "",
    },
    address: {
      address_line_1: "",
      address_line_2: "",
      city: "",
      district: "",
      province: "",
      postal_code: "",
      country: "Sri Lanka",
      google_map_link: "",
    },
    business_hours: {
      ...baseHours,
      preset: "Standard",
      public_holiday_mode: "Auto-close",
      temporary_closure: { enabled: false, from: "", to: "", reason: "" },
      holidays: [],
      after_hours_login_alert: true,
    },
    logo_branding: {
      logo_assets: {
        main: "",
        thermal: "",
        favicon: "",
        dark: "",
        light: "",
      },
      logo_size: "Medium",
      logo_custom_px: 64,
      logo_position_on_receipt: "Center",
      receipt_logo_mode: "same_as_shop_logo",
      use_same_for_receipts: true,
      use_same_for_labels: true,
    },
    branches: [],
    localization: {
      english: { shop_name: "I Point", tagline: "YOUR NO.01 MOBILE PARTNER" },
      sinhala: { shop_name: "", tagline: "" },
      tamil: { shop_name: "", tagline: "" },
    },
    qr_profiles: {
      website_qr_text: "",
      whatsapp_qr_text: "",
      map_qr_text: "",
      custom_qr_text: "",
    },
    custom_legal_fields: [],
    approval_workflow: {
      status: "Approved",
      requested_by: "",
      requested_at: "",
      approved_by: "",
      approved_at: "",
      note: "",
    },
    change_history: [],
    version_history: [],
    meta: {
      last_updated_by: "system",
      last_updated_at: "",
    },
  };
}

function deepMergeDefaults(defaultVal, incomingVal) {
  if (Array.isArray(defaultVal)) {
    return Array.isArray(incomingVal) ? incomingVal : clone(defaultVal);
  }
  if (defaultVal && typeof defaultVal === "object") {
    const source = incomingVal && typeof incomingVal === "object" ? incomingVal : {};
    const out = { ...source };
    Object.entries(defaultVal).forEach(([key, nested]) => {
      out[key] = deepMergeDefaults(nested, source[key]);
    });
    return out;
  }
  return incomingVal === undefined || incomingVal === null ? defaultVal : incomingVal;
}

function normalizeProfile(value) {
  return deepMergeDefaults(buildDefaultStoreProfile(), value || {});
}

function setPath(target, path, value) {
  const keys = String(path).split(".").filter(Boolean);
  if (!keys.length) return;
  let ptr = target;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (!ptr[key] || typeof ptr[key] !== "object") ptr[key] = {};
    ptr = ptr[key];
  }
  ptr[keys[keys.length - 1]] = value;
}

function getPath(target, path, fallback = "") {
  const keys = String(path).split(".").filter(Boolean);
  let ptr = target;
  for (const key of keys) {
    if (!ptr || typeof ptr !== "object") return fallback;
    ptr = ptr[key];
  }
  return ptr === undefined || ptr === null ? fallback : ptr;
}

function hash(value) {
  return JSON.stringify(value || {});
}

function computeErrors(profile) {
  const errors = {};
  const p = profile?.contact_information || {};
  const id = profile?.business_identity || {};
  const address = profile?.address || {};

  if (p.primary_phone && !PHONE_RE.test(String(p.primary_phone).replace(/\s+/g, ""))) {
    errors.primary_phone = "Invalid Sri Lankan phone format.";
  }
  if (p.secondary_phone && !PHONE_RE.test(String(p.secondary_phone).replace(/\s+/g, ""))) {
    errors.secondary_phone = "Invalid Sri Lankan phone format.";
  }
  if (p.whatsapp_number && !PHONE_RE.test(String(p.whatsapp_number).replace(/\s+/g, ""))) {
    errors.whatsapp_number = "Invalid WhatsApp phone format.";
  }
  if (p.email_address && !EMAIL_RE.test(p.email_address)) {
    errors.email_address = "Invalid email format.";
  }
  if (p.website_url && !URL_RE.test(p.website_url)) {
    errors.website_url = "Invalid website URL.";
  }
  if (id.tax_vat_number && !VAT_RE.test(id.tax_vat_number)) {
    errors.tax_vat_number = "VAT/Tax must be 6-20 alphanumeric characters.";
  }
  if (!id.shop_name) errors.shop_name = "Shop name is required.";
  if (!p.primary_phone) errors.primary_phone_required = "Primary phone is required.";
  if (!address.address_line_1) errors.address_line_1 = "Address line 1 is required.";
  if (!address.city) errors.city = "City is required.";
  return errors;
}

function requiredFieldChecks(profile) {
  return [
    ["Shop Name", !!profile?.business_identity?.shop_name],
    ["Business Type", !!profile?.business_identity?.business_type],
    ["Primary Phone", !!profile?.contact_information?.primary_phone],
    ["Email", !!profile?.contact_information?.email_address],
    ["Address Line 1", !!profile?.address?.address_line_1],
    ["City", !!profile?.address?.city],
    ["Country", !!profile?.address?.country],
    ["Main Logo", !!profile?.logo_branding?.logo_assets?.main],
    ["Website", !!profile?.contact_information?.website_url],
  ];
}

async function optimizeImageToDataUrl(file, maxSize = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas unavailable"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const out = canvas.toDataURL("image/jpeg", quality);
        resolve(out);
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function makeQrBits(text, size = 21) {
  const raw = String(text || "");
  let seed = 0;
  for (let i = 0; i < raw.length; i += 1) seed = (seed * 31 + raw.charCodeAt(i)) % 1000003;
  const cells = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = (seed + x * 17 + y * 29 + x * y * 3) % 11;
      cells.push(value > 5 ? 1 : 0);
    }
  }
  return { size, cells };
}

function MiniQrPreview({ text }) {
  const bits = useMemo(() => makeQrBits(text), [text]);
  const dot = 2;
  const px = bits.size * dot;
  return (
    <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} className="rounded border border-white/15 bg-white p-1">
      {bits.cells.map((cell, idx) => {
        if (!cell) return null;
        const x = idx % bits.size;
        const y = Math.floor(idx / bits.size);
        return <rect key={idx} x={x * dot} y={y * dot} width={dot} height={dot} fill="#000" />;
      })}
    </svg>
  );
}

function FieldLabel({ title, hint }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</span>
      {hint && <span className="text-[10px] text-slate-500">{hint}</span>}
    </div>
  );
}

function InlineError({ text }) {
  if (!text) return null;
  return <p className="text-[11px] text-rose-300 mt-1">{text}</p>;
}

function DayRow({ day, value, onChange }) {
  return (
    <div className="grid grid-cols-12 gap-2 items-center rounded-lg border border-white/10 bg-black/20 px-2 py-1.5">
      <div className="col-span-3 text-xs font-semibold text-slate-200">{day}</div>
      <div className="col-span-3">
        <Input type="time" value={value?.open || "09:00"} onChange={(e) => onChange({ ...(value || {}), open: e.target.value })} />
      </div>
      <div className="col-span-3">
        <Input type="time" value={value?.close || "19:00"} onChange={(e) => onChange({ ...(value || {}), close: e.target.value })} />
      </div>
      <label className="col-span-3 flex items-center justify-end gap-2 text-xs text-slate-300">
        <input type="checkbox" checked={!!value?.enabled} onChange={(e) => onChange({ ...(value || {}), enabled: e.target.checked })} />
        Open
      </label>
    </div>
  );
}

function applyHoursPreset(preset, currentHours) {
  const next = clone(currentHours || {});
  const setWeek = (weekdayOpen, weekdayClose, satOpen, satClose, sunEnabled, sunOpen = "09:00", sunClose = "14:00") => {
    ["monday", "tuesday", "wednesday", "thursday", "friday"].forEach((key) => {
      next[key] = { ...(next[key] || {}), open: weekdayOpen, close: weekdayClose, enabled: true };
    });
    next.saturday = { ...(next.saturday || {}), open: satOpen, close: satClose, enabled: true };
    next.sunday = { ...(next.sunday || {}), open: sunOpen, close: sunClose, enabled: !!sunEnabled };
  };
  if (preset === "Standard") setWeek("09:00", "19:00", "09:00", "17:00", false);
  if (preset === "Extended") setWeek("08:30", "20:00", "09:00", "18:00", true, "09:00", "15:00");
  if (preset === "Compact") setWeek("10:00", "18:00", "10:00", "16:00", false);
  next.preset = preset;
  return next;
}

export default function StoreProfileSettings({
  sectionValue,
  onSectionChange,
  onSaveSection,
  saving,
  toast,
  confirm,
  prompt,
}) {
  const [collapsed, setCollapsed] = useState(() => Object.fromEntries(SECTION_LIST.map((row) => [row.id, false])));
  const [activeSection, setActiveSection] = useState("identity");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const fileRefs = useRef({});
  const profile = useMemo(() => normalizeProfile(sectionValue), [sectionValue]);
  const baselineRef = useRef(profile);

  useEffect(() => {
    if (hash(sectionValue) === hash(baselineRef.current)) return;
    if (hash(profile) === hash(baselineRef.current)) return;
    // keep current baseline while user edits; replaced on successful save/discard
  }, [profile, sectionValue]);

  const dirty = hash(profile) !== hash(baselineRef.current);
  const errors = useMemo(() => computeErrors(profile), [profile]);
  const hasErrors = Object.keys(errors).length > 0;
  const requiredChecks = useMemo(() => requiredFieldChecks(profile), [profile]);
  const completedCount = requiredChecks.filter(([, ok]) => ok).length;
  const completionPct = Math.round((completedCount / Math.max(1, requiredChecks.length)) * 100);

  const selectedBranch = useMemo(
    () => (profile.branches || []).find((row) => String(row.id) === String(selectedBranchId)) || null,
    [profile.branches, selectedBranchId]
  );

  const update = (path, value) => {
    const next = clone(profile);
    setPath(next, path, value);
    onSectionChange(next);
  };

  const updateMany = (fn) => {
    const next = clone(profile);
    fn(next);
    onSectionChange(next);
  };

  const formatPhone = (raw) => {
    const digits = String(raw || "").replace(/\D+/g, "");
    if (!digits) return "";
    if (digits.startsWith("94")) return `+${digits}`;
    if (digits.startsWith("0")) return digits;
    if (digits.length === 9) return `0${digits}`;
    return raw;
  };

  const recomputeQrProfiles = (next) => {
    const web = next?.contact_information?.website_url || "";
    const waRaw = next?.contact_information?.whatsapp_number || "";
    const map = next?.address?.google_map_link || "";
    const waDigits = String(waRaw).replace(/\D+/g, "");
    const waIntl = waDigits.startsWith("0") ? `94${waDigits.slice(1)}` : waDigits.startsWith("94") ? waDigits : waDigits;
    next.qr_profiles.website_qr_text = web ? (web.startsWith("http") ? web : `https://${web}`) : "";
    next.qr_profiles.whatsapp_qr_text = waIntl ? `https://wa.me/${waIntl}` : "";
    next.qr_profiles.map_qr_text = map || "";
  };

  const handleSave = async () => {
    if (hasErrors) {
      toast("Please fix validation errors before saving.", "warning");
      return;
    }
    const now = nowIso();
    const user = localStorage.getItem("username") || "system";
    const previousSnapshot = clone(baselineRef.current);
    const next = clone(profile);
    recomputeQrProfiles(next);
    next.meta.last_updated_by = user;
    next.meta.last_updated_at = now;
    next.change_history = [
      {
        id: `${Date.now()}`,
        action: "Profile Saved",
        by: user,
        at: now,
        note: "Store profile updated.",
      },
      ...(next.change_history || []),
    ].slice(0, 200);
    next.version_history = [
      {
        id: `v_${Date.now()}`,
        saved_by: user,
        saved_at: now,
        snapshot: previousSnapshot,
      },
      ...(next.version_history || []),
    ].slice(0, 30);
    onSectionChange(next);
    const ok = await onSaveSection();
    if (ok) {
      baselineRef.current = clone(next);
    }
  };

  const handleDiscard = async () => {
    if (!dirty) return;
    const ok = await confirm("Discard Changes", "Discard unsaved Store Profile changes?");
    if (!ok) return;
    onSectionChange(clone(baselineRef.current));
    toast("Changes discarded", "info");
  };

  const rollbackVersion = async (version) => {
    const ok = await confirm("Restore Version", "Restore this historical snapshot? Current unsaved state will be replaced.");
    if (!ok) return;
    const snapshot = normalizeProfile(version?.snapshot);
    onSectionChange(snapshot);
    toast("Version restored in editor. Save to apply.", "warning");
  };

  const addBranchSafe = async () => {
    const name = await prompt("Branch Name", "Name the branch profile.", {
      defaultValue: "New Branch",
      placeholder: "Branch name",
    });
    if (!name) return;
    const id = `branch_${Date.now()}`;
    updateMany((next) => {
      next.branches.push({
        id,
        name: name.trim(),
        code: slug(name),
        address_line_1: "",
        city: "",
        phone: "",
        email: "",
        hours: clone(next.business_hours),
      });
    });
    setSelectedBranchId(id);
  };

  const removeBranch = async (branchId) => {
    const branch = (profile.branches || []).find((row) => row.id === branchId);
    if (!branch) return;
    const ok = await confirm("Delete Branch", `Delete branch "${branch.name}"?`);
    if (!ok) return;
    updateMany((next) => {
      next.branches = (next.branches || []).filter((row) => row.id !== branchId);
    });
    if (selectedBranchId === branchId) setSelectedBranchId("");
  };

  const copyMainToBranch = () => {
    if (!selectedBranch) return;
    updateMany((next) => {
      const idx = next.branches.findIndex((row) => row.id === selectedBranch.id);
      if (idx < 0) return;
      next.branches[idx] = {
        ...next.branches[idx],
        address_line_1: next.address.address_line_1 || "",
        city: next.address.city || "",
        phone: next.contact_information.primary_phone || "",
        email: next.contact_information.email_address || "",
        hours: clone(next.business_hours),
      };
    });
    toast("Copied main profile values into selected branch.", "success");
  };

  const updateBranch = (branchId, path, value) => {
    updateMany((next) => {
      const idx = (next.branches || []).findIndex((row) => row.id === branchId);
      if (idx < 0) return;
      setPath(next.branches[idx], path, value);
    });
  };

  const uploadLogo = async (key, file) => {
    if (!file) return;
    if (!/image\/(png|jpeg|jpg|svg\+xml)/i.test(file.type)) {
      toast("Please upload PNG, JPG, or SVG image.", "warning");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast("Image exceeds 2MB. Please use a smaller file.", "warning");
      return;
    }
    try {
      const optimized = await optimizeImageToDataUrl(file);
      update(`logo_branding.logo_assets.${key}`, optimized);
      toast("Logo uploaded and optimized.", "success");
    } catch {
      toast("Failed to process image.", "error");
    }
  };

  const toggleSection = (id) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  const allErrors = Object.entries(errors);

  const presetHours = (preset) => update("business_hours", applyHoursPreset(preset, profile.business_hours));

  const addHoliday = async () => {
    const date = await prompt("Holiday Date", "Enter the holiday date in YYYY-MM-DD format.", {
      placeholder: "YYYY-MM-DD",
    });
    if (!date) return;
    updateMany((next) => {
      if (!next.business_hours.holidays.includes(date)) next.business_hours.holidays.push(date);
    });
  };

  const removeHoliday = (date) => {
    updateMany((next) => {
      next.business_hours.holidays = (next.business_hours.holidays || []).filter((d) => d !== date);
    });
  };

  const addLegalField = () => {
    updateMany((next) => {
      next.custom_legal_fields.push({ key: "", value: "" });
    });
  };

  const removeLegalField = (index) => {
    updateMany((next) => {
      next.custom_legal_fields.splice(index, 1);
    });
  };

  const requestApproval = () => {
    const user = localStorage.getItem("username") || "staff";
    updateMany((next) => {
      next.approval_workflow.status = "Pending Approval";
      next.approval_workflow.requested_by = user;
      next.approval_workflow.requested_at = nowIso();
      next.approval_workflow.note = "Awaiting manager/admin review.";
    });
    toast("Approval request marked.", "info");
  };

  const approveChanges = () => {
    const user = localStorage.getItem("username") || "manager";
    updateMany((next) => {
      next.approval_workflow.status = "Approved";
      next.approval_workflow.approved_by = user;
      next.approval_workflow.approved_at = nowIso();
      next.approval_workflow.note = "Approved for deployment.";
    });
    toast("Store profile approved.", "success");
  };

  const exportProfileJson = () => {
    const payload = { exported_at: nowIso(), store_profile: profile };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "store-profile-export.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const renderPreview = () => (
    <div className="space-y-3">
      <SectionCard title="Receipt Header Preview" subtitle="Live preview used for receipts, labels, and job cards">
        <div className="rounded-xl border border-white/10 bg-white p-4 text-slate-900">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="h-12 w-16 rounded border border-slate-300 bg-slate-100 grid place-items-center text-[10px] text-slate-500 overflow-hidden">
                {profile.logo_branding.logo_assets.main ? (
                  <img src={profile.logo_branding.logo_assets.main} alt="logo" className="max-h-full max-w-full object-contain" />
                ) : (
                  "LOGO"
                )}
              </div>
              <div>
                <h3 className="font-black text-lg">{profile.business_identity.shop_name || "-"}</h3>
                <p className="text-xs text-slate-600">{profile.business_identity.shop_tagline || "-"}</p>
              </div>
            </div>
            <div className="text-right text-xs text-slate-600">
              <p>{profile.address.address_line_1 || "-"}</p>
              <p>{profile.contact_information.primary_phone || "-"}</p>
              <p>{profile.contact_information.email_address || "-"}</p>
              <p>{profile.contact_information.website_url || "-"}</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-4 text-[11px] text-slate-700">
            <span>VAT: {profile.business_identity.tax_vat_number || "-"}</span>
            <span>Reg: {profile.business_identity.registration_number || "-"}</span>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Auto QR Profiles" subtitle="Generated from website, WhatsApp, and map settings">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="text-xs font-bold text-slate-300 mb-2">Website QR</p>
            <MiniQrPreview text={profile.qr_profiles.website_qr_text || profile.contact_information.website_url} />
            <p className="text-[10px] text-slate-400 mt-2 break-all">{profile.qr_profiles.website_qr_text || "-"}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="text-xs font-bold text-slate-300 mb-2">WhatsApp QR</p>
            <MiniQrPreview text={profile.qr_profiles.whatsapp_qr_text || profile.contact_information.whatsapp_number} />
            <p className="text-[10px] text-slate-400 mt-2 break-all">{profile.qr_profiles.whatsapp_qr_text || "-"}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="text-xs font-bold text-slate-300 mb-2">Map QR</p>
            <MiniQrPreview text={profile.qr_profiles.map_qr_text || profile.address.google_map_link} />
            <p className="text-[10px] text-slate-400 mt-2 break-all">{profile.qr_profiles.map_qr_text || "-"}</p>
          </div>
        </div>
      </SectionCard>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard title="Profile Completion" value={`${completionPct}%`} tone={completionPct >= 85 ? "green" : completionPct >= 65 ? "amber" : "red"} icon={<CheckCircle2 size={16} />} />
        <KpiCard title="Validation Issues" value={String(allErrors.length)} tone={allErrors.length ? "red" : "green"} icon={<AlertTriangle size={16} />} />
        <KpiCard title="Branches" value={String((profile.branches || []).length)} tone="sky" icon={<Building2 size={16} />} />
        <KpiCard title="Approval Status" value={profile.approval_workflow.status || "Unknown"} tone={profile.approval_workflow.status === "Approved" ? "green" : "amber"} icon={<UserCheck size={16} />} />
        <KpiCard title="Last Updated By" value={profile.meta.last_updated_by || "-"} tone="indigo" />
        <KpiCard title="Last Updated At" value={profile.meta.last_updated_at ? formatDateTime(profile.meta.last_updated_at) : "-"} tone="violet" />
      </div>

      <WorkstationNotice
        tone={completionPct >= 85 && !hasErrors ? "green" : "amber"}
        title={completionPct >= 85 && !hasErrors ? "Store Profile is ready for production documents" : "Store Profile is not complete enough for production printing"}
        text="Receipts, invoices, labels, job cards, warranty certificates, and return receipts should all use this profile as their business identity."
      />

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className="xl:col-span-1 space-y-4">
          <SectionCard title="Quick Sections" subtitle="Jump and collapse by section">
            <div className="space-y-2">
              {SECTION_LIST.map((section) => {
                const Icon = section.icon;
                return (
                  <div key={section.id} className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveSection(section.id)}
                      className={`flex-1 px-3 py-2 rounded-lg border text-xs font-semibold text-left flex items-center gap-2 ${
                        activeSection === section.id ? "bg-indigo-500/20 border-indigo-400/40 text-indigo-100" : "bg-white/5 border-white/10 text-slate-300 hover:text-white"
                      }`}
                    >
                      <Icon size={13} />
                      {section.label}
                    </button>
                    <button type="button" onClick={() => toggleSection(section.id)} className="px-2 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:text-white">
                      {collapsed[section.id] ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    </button>
                  </div>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard title="Completeness Checklist">
            <div className="space-y-1.5">
              {requiredChecks.map(([label, ok]) => (
                <div key={label} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-xs">
                  <span className="text-slate-200">{label}</span>
                  {ok ? <Badge tone="green">Done</Badge> : <Badge tone="amber">Missing</Badge>}
                </div>
              ))}
            </div>
          </SectionCard>

          {allErrors.length > 0 && (
            <SectionCard title="Validation Panel">
              <div className="space-y-1.5">
                {allErrors.map(([key, msg]) => (
                  <p key={key} className="text-xs text-rose-300">
                    {msg}
                  </p>
                ))}
              </div>
            </SectionCard>
          )}
        </div>

        <div className="xl:col-span-3 space-y-4">
          <SectionCard
            title="Store Profile Configuration"
            subtitle="Identity, contacts, branches, branding, scheduling, and governance in one screen."
            right={
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={exportProfileJson}>
                  <Download size={13} /> Export JSON
                </Button>
              </div>
            }
          >
            <div className="space-y-4">
              {!collapsed.identity && (
                <SectionCard title="Business Identity" className={`${activeSection === "identity" ? "ring-1 ring-indigo-400/40" : ""}`}>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <FieldLabel title="Shop Name" />
                      <Input value={profile.business_identity.shop_name || ""} onChange={(e) => update("business_identity.shop_name", e.target.value)} />
                      <InlineError text={errors.shop_name} />
                    </div>
                    <div>
                      <FieldLabel title="Business Type" />
                      <Input value={profile.business_identity.business_type || ""} onChange={(e) => update("business_identity.business_type", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel title="Registration Number" />
                      <Input value={profile.business_identity.registration_number || ""} onChange={(e) => update("business_identity.registration_number", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel title="Tax / VAT Number" />
                      <Input value={profile.business_identity.tax_vat_number || ""} onChange={(e) => update("business_identity.tax_vat_number", e.target.value)} />
                      <InlineError text={errors.tax_vat_number} />
                    </div>
                    <div>
                      <FieldLabel title="Owner Name" />
                      <Input value={profile.business_identity.owner_name || ""} onChange={(e) => update("business_identity.owner_name", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel title="Support Hotline" />
                      <Input value={profile.business_identity.support_hotline || ""} onChange={(e) => update("business_identity.support_hotline", formatPhone(e.target.value))} />
                    </div>
                    <div className="md:col-span-3">
                      <FieldLabel title="Tagline / Slogan" />
                      <Input value={profile.business_identity.shop_tagline || ""} onChange={(e) => update("business_identity.shop_tagline", e.target.value)} />
                    </div>
                  </div>
                </SectionCard>
              )}

              {!collapsed.contact && (
                <SectionCard title="Contact Information" className={`${activeSection === "contact" ? "ring-1 ring-indigo-400/40" : ""}`}>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <FieldLabel title="Primary Phone" />
                      <Input
                        value={profile.contact_information.primary_phone || ""}
                        onChange={(e) => update("contact_information.primary_phone", e.target.value)}
                        onBlur={(e) => update("contact_information.primary_phone", formatPhone(e.target.value))}
                      />
                      <InlineError text={errors.primary_phone || errors.primary_phone_required} />
                    </div>
                    <div>
                      <FieldLabel title="Secondary Phone" />
                      <Input
                        value={profile.contact_information.secondary_phone || ""}
                        onChange={(e) => update("contact_information.secondary_phone", e.target.value)}
                        onBlur={(e) => update("contact_information.secondary_phone", formatPhone(e.target.value))}
                      />
                      <InlineError text={errors.secondary_phone} />
                    </div>
                    <div>
                      <FieldLabel title="WhatsApp Number" />
                      <Input
                        value={profile.contact_information.whatsapp_number || ""}
                        onChange={(e) => update("contact_information.whatsapp_number", e.target.value)}
                        onBlur={(e) => update("contact_information.whatsapp_number", formatPhone(e.target.value))}
                      />
                      <InlineError text={errors.whatsapp_number} />
                    </div>
                    <div>
                      <FieldLabel title="Email Address" />
                      <Input value={profile.contact_information.email_address || ""} onChange={(e) => update("contact_information.email_address", e.target.value)} />
                      <InlineError text={errors.email_address} />
                    </div>
                    <div>
                      <FieldLabel title="Website URL" />
                      <Input value={profile.contact_information.website_url || ""} onChange={(e) => update("contact_information.website_url", e.target.value)} />
                      <InlineError text={errors.website_url} />
                    </div>
                    <div>
                      <FieldLabel title="Facebook URL" />
                      <Input value={profile.contact_information.facebook_url || ""} onChange={(e) => update("contact_information.facebook_url", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel title="Instagram Handle" />
                      <Input value={profile.contact_information.instagram_handle || ""} onChange={(e) => update("contact_information.instagram_handle", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel title="TikTok Handle" />
                      <Input value={profile.contact_information.tiktok_handle || ""} onChange={(e) => update("contact_information.tiktok_handle", e.target.value)} />
                    </div>
                  </div>
                </SectionCard>
              )}

              {!collapsed.address && (
                <SectionCard title="Address & Geo Links" className={`${activeSection === "address" ? "ring-1 ring-indigo-400/40" : ""}`}>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-2">
                      <FieldLabel title="Address Line 1" />
                      <Input value={profile.address.address_line_1 || ""} onChange={(e) => update("address.address_line_1", e.target.value)} />
                      <InlineError text={errors.address_line_1} />
                    </div>
                    <div>
                      <FieldLabel title="Address Line 2" />
                      <Input value={profile.address.address_line_2 || ""} onChange={(e) => update("address.address_line_2", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel title="City" />
                      <Input value={profile.address.city || ""} onChange={(e) => update("address.city", e.target.value)} />
                      <InlineError text={errors.city} />
                    </div>
                    <div>
                      <FieldLabel title="District" />
                      <Input value={profile.address.district || ""} onChange={(e) => update("address.district", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel title="Province" />
                      <Input value={profile.address.province || ""} onChange={(e) => update("address.province", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel title="Postal Code" />
                      <Input value={profile.address.postal_code || ""} onChange={(e) => update("address.postal_code", e.target.value)} />
                    </div>
                    <div>
                      <FieldLabel title="Country" />
                      <Input value={profile.address.country || "Sri Lanka"} onChange={(e) => update("address.country", e.target.value)} />
                    </div>
                    <div className="md:col-span-2">
                      <FieldLabel title="Google Map Link" />
                      <Input value={profile.address.google_map_link || ""} onChange={(e) => update("address.google_map_link", e.target.value)} />
                    </div>
                  </div>
                </SectionCard>
              )}

              {!collapsed.hours && (
                <SectionCard title="Business Hours & Holidays" className={`${activeSection === "hours" ? "ring-1 ring-indigo-400/40" : ""}`}>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                    <div>
                      <FieldLabel title="Hours Preset" />
                      <Select value={profile.business_hours.preset || "Standard"} onChange={(e) => presetHours(e.target.value)}>
                        <option>Standard</option>
                        <option>Extended</option>
                        <option>Compact</option>
                      </Select>
                    </div>
                    <div>
                      <FieldLabel title="Public Holiday Mode" />
                      <Select value={profile.business_hours.public_holiday_mode || "Auto-close"} onChange={(e) => update("business_hours.public_holiday_mode", e.target.value)}>
                        <option>Auto-close</option>
                        <option>Manual Override</option>
                        <option>Open Normally</option>
                      </Select>
                    </div>
                    <label className="flex items-end gap-2 text-sm text-slate-200">
                      <input type="checkbox" checked={!!profile.business_hours.after_hours_login_alert} onChange={(e) => update("business_hours.after_hours_login_alert", e.target.checked)} />
                      After-hours login alert
                    </label>
                  </div>
                  <div className="space-y-2">
                    {DAY_NAMES.map((day) => {
                      const key = day.toLowerCase();
                      return <DayRow key={day} day={day} value={profile.business_hours[key]} onChange={(value) => update(`business_hours.${key}`, value)} />;
                    })}
                  </div>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <SectionCard title="Temporary Closure">
                      <label className="flex items-center gap-2 text-sm text-slate-200 mb-2">
                        <input type="checkbox" checked={!!profile.business_hours.temporary_closure.enabled} onChange={(e) => update("business_hours.temporary_closure.enabled", e.target.checked)} />
                        Enable temporary closure
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <FieldLabel title="From Date" />
                          <Input type="date" value={profile.business_hours.temporary_closure.from || ""} onChange={(e) => update("business_hours.temporary_closure.from", e.target.value)} />
                        </div>
                        <div>
                          <FieldLabel title="To Date" />
                          <Input type="date" value={profile.business_hours.temporary_closure.to || ""} onChange={(e) => update("business_hours.temporary_closure.to", e.target.value)} />
                        </div>
                      </div>
                      <div className="mt-2">
                        <FieldLabel title="Reason" />
                        <Input value={profile.business_hours.temporary_closure.reason || ""} onChange={(e) => update("business_hours.temporary_closure.reason", e.target.value)} />
                      </div>
                    </SectionCard>

                    <SectionCard
                      title="Holiday Calendar"
                      right={
                        <Button size="sm" variant="secondary" onClick={addHoliday}>
                          <Plus size={13} /> Add Date
                        </Button>
                      }
                    >
                      <div className="space-y-1">
                        {(profile.business_hours.holidays || []).length === 0 && <p className="text-xs text-slate-500">No holiday dates added.</p>}
                        {(profile.business_hours.holidays || []).map((date) => (
                          <div key={date} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-xs">
                            <span>{date}</span>
                            <button type="button" onClick={() => removeHoliday(date)} className="text-rose-300 hover:text-rose-200">
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </SectionCard>
                  </div>
                </SectionCard>
              )}

              {!collapsed.branding && (
                <SectionCard title="Logo & Branding Assets" className={`${activeSection === "branding" ? "ring-1 ring-indigo-400/40" : ""}`}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[
                      ["main", "Main Logo"],
                      ["thermal", "Thermal Logo"],
                      ["favicon", "Favicon"],
                      ["dark", "Dark Variant"],
                      ["light", "Light Variant"],
                    ].map(([key, label]) => (
                      <div key={key} className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-slate-200">{label}</p>
                          <button
                            type="button"
                            className="text-xs text-indigo-300 hover:text-indigo-100"
                            onClick={() => fileRefs.current[key]?.click()}
                          >
                            Upload
                          </button>
                        </div>
                        <input
                          ref={(el) => {
                            fileRefs.current[key] = el;
                          }}
                          type="file"
                          accept="image/png,image/jpeg,image/jpg,image/svg+xml"
                          className="hidden"
                          onChange={(e) => uploadLogo(key, e.target.files?.[0])}
                        />
                        <div className="h-16 rounded-lg border border-white/10 bg-slate-900 grid place-items-center overflow-hidden">
                          {profile.logo_branding.logo_assets[key] ? (
                            <img src={profile.logo_branding.logo_assets[key]} alt={label} className="max-h-full max-w-full object-contain" />
                          ) : (
                            <span className="text-[10px] text-slate-500">No image</span>
                          )}
                        </div>
                      </div>
                    ))}
                    <div>
                      <FieldLabel title="Logo Size" />
                      <Select value={profile.logo_branding.logo_size || "Medium"} onChange={(e) => update("logo_branding.logo_size", e.target.value)}>
                        <option>Small</option>
                        <option>Medium</option>
                        <option>Large</option>
                        <option>Custom</option>
                      </Select>
                    </div>
                    <div>
                      <FieldLabel title="Custom Logo Size (px)" />
                      <Input type="number" value={Number(profile.logo_branding.logo_custom_px || 64)} onChange={(e) => update("logo_branding.logo_custom_px", Number(e.target.value || 0))} />
                    </div>
                    <div>
                      <FieldLabel title="Receipt Logo Position" />
                      <Select value={profile.logo_branding.logo_position_on_receipt || "Center"} onChange={(e) => update("logo_branding.logo_position_on_receipt", e.target.value)}>
                        <option>Left</option>
                        <option>Center</option>
                        <option>Right</option>
                      </Select>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-slate-200">
                      <input type="checkbox" checked={!!profile.logo_branding.use_same_for_receipts} onChange={(e) => update("logo_branding.use_same_for_receipts", e.target.checked)} />
                      Use same profile data for receipts
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-200">
                      <input type="checkbox" checked={!!profile.logo_branding.use_same_for_labels} onChange={(e) => update("logo_branding.use_same_for_labels", e.target.checked)} />
                      Use same profile data for labels
                    </label>
                  </div>
                </SectionCard>
              )}

              {!collapsed.branches && (
                <SectionCard
                  title="Multi-Branch Profiles"
                  className={`${activeSection === "branches" ? "ring-1 ring-indigo-400/40" : ""}`}
                  right={
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={addBranchSafe}>
                        <Plus size={13} /> Add Branch
                      </Button>
                    </div>
                  }
                >
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <div className="lg:col-span-1 space-y-2">
                      {(profile.branches || []).length === 0 && <p className="text-xs text-slate-500">No branches yet.</p>}
                      {(profile.branches || []).map((branch) => (
                        <button
                          type="button"
                          key={branch.id}
                          onClick={() => setSelectedBranchId(branch.id)}
                          className={`w-full text-left rounded-lg border px-3 py-2 ${
                            selectedBranchId === branch.id ? "border-indigo-400/50 bg-indigo-500/20 text-indigo-100" : "border-white/10 bg-black/20 text-slate-300"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-sm">{branch.name}</span>
                            <span className="text-[10px]">{branch.code}</span>
                          </div>
                          <p className="text-[11px] opacity-80">{branch.city || "-"}</p>
                        </button>
                      ))}
                    </div>

                    <div className="lg:col-span-2">
                      {!selectedBranch && <p className="text-sm text-slate-500">Select a branch to edit details.</p>}
                      {selectedBranch && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-black text-slate-200">Edit Branch: {selectedBranch.name}</h4>
                            <div className="flex gap-2">
                              <Button size="sm" variant="secondary" onClick={copyMainToBranch}>
                                <Copy size={12} /> Copy Main
                              </Button>
                              <Button size="sm" variant="secondary" onClick={() => removeBranch(selectedBranch.id)}>
                                <Trash2 size={12} /> Delete
                              </Button>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <FieldLabel title="Branch Name" />
                              <Input value={selectedBranch.name || ""} onChange={(e) => updateBranch(selectedBranch.id, "name", e.target.value)} />
                            </div>
                            <div>
                              <FieldLabel title="Branch Code" />
                              <Input value={selectedBranch.code || ""} onChange={(e) => updateBranch(selectedBranch.id, "code", slug(e.target.value))} />
                            </div>
                            <div className="md:col-span-2">
                              <FieldLabel title="Address Line 1" />
                              <Input value={selectedBranch.address_line_1 || ""} onChange={(e) => updateBranch(selectedBranch.id, "address_line_1", e.target.value)} />
                            </div>
                            <div>
                              <FieldLabel title="City" />
                              <Input value={selectedBranch.city || ""} onChange={(e) => updateBranch(selectedBranch.id, "city", e.target.value)} />
                            </div>
                            <div>
                              <FieldLabel title="Phone" />
                              <Input value={selectedBranch.phone || ""} onChange={(e) => updateBranch(selectedBranch.id, "phone", formatPhone(e.target.value))} />
                            </div>
                            <div className="md:col-span-2">
                              <FieldLabel title="Email" />
                              <Input value={selectedBranch.email || ""} onChange={(e) => updateBranch(selectedBranch.id, "email", e.target.value)} />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </SectionCard>
              )}

              {!collapsed.localization && (
                <SectionCard title="Localization & Bilingual Fields" className={`${activeSection === "localization" ? "ring-1 ring-indigo-400/40" : ""}`}>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                      ["english", "English"],
                      ["sinhala", "Sinhala"],
                      ["tamil", "Tamil"],
                    ].map(([key, label]) => (
                      <div key={key} className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
                        <p className="text-xs font-black uppercase tracking-wider text-slate-300">{label}</p>
                        <div>
                          <FieldLabel title="Shop Name" />
                          <Input value={getPath(profile, `localization.${key}.shop_name`, "")} onChange={(e) => update(`localization.${key}.shop_name`, e.target.value)} />
                        </div>
                        <div>
                          <FieldLabel title="Tagline" />
                          <Input value={getPath(profile, `localization.${key}.tagline`, "")} onChange={(e) => update(`localization.${key}.tagline`, e.target.value)} />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold text-slate-200">Custom Legal Fields</h4>
                      <Button size="sm" variant="secondary" onClick={addLegalField}>
                        <Plus size={13} /> Add Field
                      </Button>
                    </div>
                    <div className="space-y-2">
                      {(profile.custom_legal_fields || []).length === 0 && <p className="text-xs text-slate-500">No custom legal fields.</p>}
                      {(profile.custom_legal_fields || []).map((row, idx) => (
                        <div key={`${idx}`} className="grid grid-cols-12 gap-2 items-center">
                          <div className="col-span-5">
                            <Input placeholder="Field Name" value={row.key || ""} onChange={(e) => update(`custom_legal_fields.${idx}.key`, e.target.value)} />
                          </div>
                          <div className="col-span-6">
                            <Input placeholder="Field Value" value={row.value || ""} onChange={(e) => update(`custom_legal_fields.${idx}.value`, e.target.value)} />
                          </div>
                          <button type="button" className="col-span-1 text-rose-300 hover:text-rose-200" onClick={() => removeLegalField(idx)}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </SectionCard>
              )}

              {!collapsed.workflow && (
                <SectionCard title="Approval Workflow, Audit & Version History" className={`${activeSection === "workflow" ? "ring-1 ring-indigo-400/40" : ""}`}>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <p className="text-xs text-slate-400 uppercase tracking-wider">Status</p>
                      <p className="text-lg font-black text-white">{profile.approval_workflow.status || "-"}</p>
                      <p className="text-[11px] text-slate-500 mt-1">{profile.approval_workflow.note || "-"}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <p className="text-xs text-slate-400 uppercase tracking-wider">Requested</p>
                      <p className="text-sm text-slate-200">{profile.approval_workflow.requested_by || "-"}</p>
                      <p className="text-[11px] text-slate-500">{formatDateTime(profile.approval_workflow.requested_at)}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <p className="text-xs text-slate-400 uppercase tracking-wider">Approved</p>
                      <p className="text-sm text-slate-200">{profile.approval_workflow.approved_by || "-"}</p>
                      <p className="text-[11px] text-slate-500">{formatDateTime(profile.approval_workflow.approved_at)}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Button size="sm" variant="secondary" onClick={requestApproval}>
                      <UserCheck size={13} /> Request Approval
                    </Button>
                    <Button size="sm" variant="secondary" onClick={approveChanges}>
                      <CheckCircle2 size={13} /> Approve
                    </Button>
                  </div>

                  <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <SectionCard title="Change History">
                      <div className="space-y-1 max-h-[220px] overflow-y-auto custom-scrollbar">
                        {(profile.change_history || []).length === 0 && <p className="text-xs text-slate-500">No changes logged yet.</p>}
                        {(profile.change_history || []).map((row) => (
                          <div key={row.id} className="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5">
                            <p className="text-xs font-semibold text-slate-200">{row.action}</p>
                            <p className="text-[11px] text-slate-400">{row.by} • {formatDateTime(row.at)}</p>
                            {row.note && <p className="text-[11px] text-slate-500">{row.note}</p>}
                          </div>
                        ))}
                      </div>
                    </SectionCard>

                    <SectionCard title="Version History">
                      <div className="space-y-2 max-h-[220px] overflow-y-auto custom-scrollbar">
                        {(profile.version_history || []).length === 0 && <p className="text-xs text-slate-500">No snapshots yet.</p>}
                        {(profile.version_history || []).map((row) => (
                          <div key={row.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-2 py-1.5">
                            <div>
                              <p className="text-xs font-semibold text-slate-200">{row.saved_by || "-"}</p>
                              <p className="text-[11px] text-slate-400">{formatDateTime(row.saved_at)}</p>
                            </div>
                            <Button size="sm" variant="secondary" onClick={() => rollbackVersion(row)}>
                              <Undo2 size={12} /> Restore
                            </Button>
                          </div>
                        ))}
                      </div>
                    </SectionCard>
                  </div>
                </SectionCard>
              )}
            </div>
          </SectionCard>

          {renderPreview()}
        </div>
      </div>

      {dirty && (
        <div className="sticky bottom-0 z-20">
          <div className="rounded-2xl border border-indigo-400/30 bg-slate-950/95 backdrop-blur p-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Badge tone="amber">Unsaved Changes</Badge>
              <span className="text-slate-300">You have pending edits in Store Profile.</span>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={handleDiscard} disabled={saving}>
                <Undo2 size={13} /> Discard
              </Button>
              <Button onClick={handleSave} disabled={saving || hasErrors}>
                <Save size={13} /> {saving ? "Saving..." : "Save Store Profile"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

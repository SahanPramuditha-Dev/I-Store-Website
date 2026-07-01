import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Save, Undo2, AlertTriangle } from "lucide-react";
import { Badge, Button, KpiCard, SectionCard } from "../../components/UI";
import { clone, deepMergeDefaults, hash } from "./utils";

export default function SettingsSectionShell({
  title,
  subtitle,
  sectionValue,
  defaults,
  onSectionChange,
  onSaveSection,
  saving,
  toast,
  confirm,
  sections = [],
  kpis = [],
  validate,
  beforeSave,
  sidePreview,
}) {
  const data = useMemo(() => deepMergeDefaults(defaults || {}, sectionValue || {}), [defaults, sectionValue]);
  const [activeSection, setActiveSection] = useState(sections[0]?.id || "main");
  const baselineRef = useRef(clone(data));

  const dirty = hash(data) !== hash(baselineRef.current);
  const errors = useMemo(() => (validate ? validate(data) || [] : []), [data, validate]);
  const hasErrors = errors.length > 0;

  useEffect(() => {
    if (!dirty) baselineRef.current = clone(data);
  }, [data, dirty]);

  const apply = (next) => onSectionChange(next);

  const updatePath = (path, value) => {
    const next = clone(data);
    const keys = String(path || "").split(".").filter(Boolean);
    let ptr = next;
    for (let i = 0; i < keys.length - 1; i += 1) {
      const key = keys[i];
      if (!ptr[key] || typeof ptr[key] !== "object") ptr[key] = {};
      ptr = ptr[key];
    }
    ptr[keys[keys.length - 1]] = value;
    apply(next);
  };

  const updateMany = (fn) => {
    const next = clone(data);
    fn(next);
    apply(next);
  };

  const handleSave = async () => {
    if (hasErrors) {
      toast("Please resolve validation issues before saving.", "warning");
      return;
    }
    const payload = beforeSave ? beforeSave(clone(data)) : clone(data);
    apply(payload);
    const ok = await onSaveSection();
    if (ok) baselineRef.current = clone(payload);
  };

  const handleDiscard = async () => {
    if (!dirty) return;
    const ok = await confirm("Discard Changes", "Discard unsaved changes for this settings tab?");
    if (!ok) return;
    apply(clone(baselineRef.current));
    toast("Changes discarded.", "info");
  };

  const activeConfig = sections.find((row) => row.id === activeSection) || sections[0];

  return (
    <div className="space-y-4">
      {kpis.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.title} title={kpi.title} value={kpi.value} tone={kpi.tone} icon={kpi.icon} hint={kpi.hint} />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className="xl:col-span-1 space-y-4">
          <SectionCard title={title} subtitle={subtitle}>
            <div className="space-y-2">
              {sections.map((section) => {
                const Icon = section.icon;
                return (
                  <button
                    type="button"
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={`w-full text-left rounded-lg border px-3 py-2 text-xs font-semibold flex items-center gap-2 ${
                      activeSection === section.id ? "bg-indigo-500/20 border-indigo-400/40 text-indigo-100" : "bg-white/5 border-white/10 text-slate-300 hover:text-white"
                    }`}
                  >
                    {Icon ? <Icon size={13} /> : null}
                    {section.label}
                  </button>
                );
              })}
            </div>
          </SectionCard>

          {hasErrors && (
            <SectionCard title="Validation Issues">
              <div className="space-y-1">
                {errors.map((msg, idx) => (
                  <p key={`${msg}-${idx}`} className="text-xs text-rose-300">
                    {msg}
                  </p>
                ))}
              </div>
            </SectionCard>
          )}

          {sidePreview ? sidePreview({ data, updatePath, updateMany }) : null}
        </div>

        <div className="xl:col-span-3">
          <SectionCard title={activeConfig?.label || "Editor"}>
            {activeConfig?.render ? activeConfig.render({ data, updatePath, updateMany }) : null}
          </SectionCard>
        </div>
      </div>

      <div className="sticky bottom-0 z-20">
        <div className="rounded-2xl border border-indigo-400/30 bg-slate-950/95 backdrop-blur p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            {dirty ? (
              <>
                <Badge tone="amber">Unsaved Changes</Badge>
                <span className="text-slate-300">You have pending edits.</span>
              </>
            ) : (
              <>
                <Badge tone="green">Saved</Badge>
                <span className="text-slate-400">No pending edits.</span>
              </>
            )}
            {hasErrors ? (
              <span className="inline-flex items-center gap-1 text-rose-300 text-xs">
                <AlertTriangle size={12} />
                {errors.length} issue{errors.length > 1 ? "s" : ""}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-emerald-300 text-xs">
                <CheckCircle2 size={12} />
                Valid
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleDiscard} disabled={!dirty || saving}>
              <Undo2 size={13} /> Discard
            </Button>
            <Button onClick={handleSave} disabled={saving || (!dirty && !hasErrors)}>
              <Save size={13} /> {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}


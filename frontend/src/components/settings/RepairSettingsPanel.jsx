import { useMemo } from "react";
import { Wrench, ListChecks, Smartphone, Flag, ShieldCheck, FileText, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { Button, Input, Select, SectionCard, Table, Badge } from "../../components/UI";
import SettingsSectionShell from "./SettingsSectionShell";

const DEFAULTS = {
  repair_status_workflow: [
    { name: "Received", color: "Blue", default: true },
    { name: "Diagnosing", color: "Yellow", default: false },
    { name: "Waiting for Parts", color: "Orange", default: false },
    { name: "Repairing", color: "Purple", default: false },
    { name: "Quality Check", color: "Teal", default: false },
    { name: "Completed", color: "Green", default: false },
    { name: "Notified", color: "Cyan", default: false },
    { name: "Delivered", color: "Gray", default: false },
    { name: "Cancelled", color: "Red", default: false },
  ],
  repair_categories: [
    "Screen Replacement",
    "Battery Replacement",
    "Charging Port Repair",
    "Speaker / Mic Repair",
    "Software / Flashing",
    "Water Damage",
  ],
  device_brands: ["Samsung", "Apple", "Redmi", "Huawei", "Oppo", "Vivo", "OnePlus", "Realme", "Nokia", "Sony", "Motorola"],
  priority_levels: [
    { name: "Normal", sla_hours: 24, color: "Blue" },
    { name: "Urgent", sla_hours: 4, color: "Orange" },
    { name: "VIP", sla_hours: 2, color: "Purple" },
  ],
  warranty_quality: {
    default_warranty_days: 30,
    warranty_counted_from: "Delivery date",
    warranty_void_conditions: "Physical damage, water damage, burn damage, seal removed, misuse.",
    allow_warranty_repair_reopening: true,
    who_can_open_warranty_job: "Manager+",
    flag_repeat_repairs_after_times: 2,
    repair_quality_check_required: true,
  },
  repair_notes_terms: {
    default_job_card_terms: "Device not collected within 60 days will not be the responsibility of the shop.",
    show_terms_on_printed_job_card: true,
    show_terms_on_receipt: true,
    show_terms_on_sms_notification: false,
  },
};

function validate(data) {
  const errors = [];
  const workflow = data?.repair_status_workflow || [];
  const defaultCount = workflow.filter((row) => row.default).length;
  if (defaultCount !== 1) errors.push("Exactly one status should be marked as default.");
  if ((data?.warranty_quality?.default_warranty_days || 0) < 0) errors.push("Default warranty days cannot be negative.");
  if ((data?.warranty_quality?.flag_repeat_repairs_after_times || 0) < 1) errors.push("Repeat repair threshold must be at least 1.");
  return errors;
}

function RowToggle({ label, checked, onChange, hint }) {
  return (
    <label className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-xs">
      <div>
        <p className="font-semibold text-slate-200">{label}</p>
        {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
      </div>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function NumberField({ label, value, onChange, suffix }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
      <div className="flex gap-2">
        <Input type="number" value={Number(value || 0)} onChange={(e) => onChange(Number(e.target.value || 0))} />
        {suffix ? <span className="px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-xs text-slate-300 grid place-items-center">{suffix}</span> : null}
      </div>
    </label>
  );
}

function TextField({ label, value, onChange }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
      <Input value={value || ""} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export default function RepairSettingsPanel({ sectionValue, onSectionChange, onSaveSection, saving, toast, confirm }) {
  const kpis = useMemo(() => {
    const d = sectionValue || {};
    return [
      { title: "Statuses", value: String((d?.repair_status_workflow || []).length), tone: "indigo", icon: <ListChecks size={16} /> },
      { title: "Issue Types", value: String((d?.repair_categories || []).length), tone: "sky", icon: <Wrench size={16} /> },
      { title: "Device Brands", value: String((d?.device_brands || []).length), tone: "green", icon: <Smartphone size={16} /> },
      { title: "Priorities", value: String((d?.priority_levels || []).length), tone: "amber", icon: <Flag size={16} /> },
      { title: "Warranty", value: `${Number(d?.warranty_quality?.default_warranty_days || 0)} days`, tone: "violet", icon: <ShieldCheck size={16} /> },
      { title: "Terms", value: d?.repair_notes_terms?.show_terms_on_printed_job_card ? "Printed" : "Hidden", tone: "indigo", icon: <FileText size={16} /> },
    ];
  }, [sectionValue]);

  const sections = [
    {
      id: "workflow",
      label: "Repair Status Workflow",
      icon: ListChecks,
      render: ({ data, updateMany, updatePath }) => (
        <div className="space-y-3">
          <SectionCard
            title="Statuses"
            right={
              <Button size="sm" variant="secondary" onClick={() => updateMany((next) => next.repair_status_workflow.push({ name: "New Status", color: "Blue", default: false }))}>
                <Plus size={12} /> Add Status
              </Button>
            }
          >
            <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
              <Table className="text-xs">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Status</th>
                    <th>Color</th>
                    <th>Default</th>
                    <th>Order</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.repair_status_workflow || []).map((row, idx) => (
                    <tr key={`${row.name}-${idx}`}>
                      <td>{idx + 1}</td>
                      <td>
                        <Input value={row.name || ""} onChange={(e) => updatePath(`repair_status_workflow.${idx}.name`, e.target.value)} />
                      </td>
                      <td>
                        <Select value={row.color || "Blue"} onChange={(e) => updatePath(`repair_status_workflow.${idx}.color`, e.target.value)}>
                          {["Blue", "Yellow", "Orange", "Purple", "Teal", "Green", "Cyan", "Gray", "Red"].map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </Select>
                      </td>
                      <td>
                        <input
                          type="radio"
                          checked={!!row.default}
                          onChange={() =>
                            updateMany((next) => {
                              next.repair_status_workflow = next.repair_status_workflow.map((item, itemIdx) => ({ ...item, default: itemIdx === idx }));
                            })
                          }
                        />
                      </td>
                      <td>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            className="px-1.5 py-1 rounded bg-white/10 text-slate-200"
                            onClick={() =>
                              updateMany((next) => {
                                if (idx === 0) return;
                                const rows = next.repair_status_workflow;
                                [rows[idx - 1], rows[idx]] = [rows[idx], rows[idx - 1]];
                              })
                            }
                          >
                            <ArrowUp size={12} />
                          </button>
                          <button
                            type="button"
                            className="px-1.5 py-1 rounded bg-white/10 text-slate-200"
                            onClick={() =>
                              updateMany((next) => {
                                const rows = next.repair_status_workflow;
                                if (idx >= rows.length - 1) return;
                                [rows[idx + 1], rows[idx]] = [rows[idx], rows[idx + 1]];
                              })
                            }
                          >
                            <ArrowDown size={12} />
                          </button>
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="text-rose-300 hover:text-rose-200"
                          onClick={() =>
                            updateMany((next) => {
                              next.repair_status_workflow.splice(idx, 1);
                              if (!next.repair_status_workflow.some((item) => item.default) && next.repair_status_workflow[0]) {
                                next.repair_status_workflow[0].default = true;
                              }
                            })
                          }
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </SectionCard>
        </div>
      ),
    },
    {
      id: "catalogs",
      label: "Categories & Brands",
      icon: Smartphone,
      render: ({ data, updateMany, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <SectionCard
            title="Repair Categories"
            right={
              <Button size="sm" variant="secondary" onClick={() => updateMany((next) => next.repair_categories.push("New Issue Type"))}>
                <Plus size={12} /> Add
              </Button>
            }
          >
            <div className="space-y-2">
              {(data.repair_categories || []).map((row, idx) => (
                <div key={`${row}-${idx}`} className="grid grid-cols-12 gap-2">
                  <div className="col-span-11">
                    <Input value={row} onChange={(e) => updatePath(`repair_categories.${idx}`, e.target.value)} />
                  </div>
                  <button
                    type="button"
                    className="col-span-1 grid place-items-center text-rose-300 hover:text-rose-200"
                    onClick={() => updateMany((next) => next.repair_categories.splice(idx, 1))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Device Brands"
            right={
              <Button size="sm" variant="secondary" onClick={() => updateMany((next) => next.device_brands.push("New Brand"))}>
                <Plus size={12} /> Add
              </Button>
            }
          >
            <div className="space-y-2">
              {(data.device_brands || []).map((row, idx) => (
                <div key={`${row}-${idx}`} className="grid grid-cols-12 gap-2">
                  <div className="col-span-11">
                    <Input value={row} onChange={(e) => updatePath(`device_brands.${idx}`, e.target.value)} />
                  </div>
                  <button
                    type="button"
                    className="col-span-1 grid place-items-center text-rose-300 hover:text-rose-200"
                    onClick={() => updateMany((next) => next.device_brands.splice(idx, 1))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      ),
    },
    {
      id: "priority",
      label: "Priority Levels",
      icon: Flag,
      render: ({ data, updateMany, updatePath }) => (
        <SectionCard
          title="Priority Levels"
          right={
            <Button size="sm" variant="secondary" onClick={() => updateMany((next) => next.priority_levels.push({ name: "New Priority", sla_hours: 12, color: "Blue" }))}>
              <Plus size={12} /> Add Priority
            </Button>
          }
        >
          <div className="space-y-2">
            {(data.priority_levels || []).map((row, idx) => (
              <div key={`${row.name}-${idx}`} className="grid grid-cols-12 gap-2 items-center rounded-xl border border-white/10 bg-black/20 p-2">
                <div className="col-span-4">
                  <Input value={row.name || ""} onChange={(e) => updatePath(`priority_levels.${idx}.name`, e.target.value)} />
                </div>
                <div className="col-span-3">
                  <Input type="number" value={Number(row.sla_hours || 0)} onChange={(e) => updatePath(`priority_levels.${idx}.sla_hours`, Number(e.target.value || 0))} />
                </div>
                <div className="col-span-4">
                  <Select value={row.color || "Blue"} onChange={(e) => updatePath(`priority_levels.${idx}.color`, e.target.value)}>
                    {["Blue", "Orange", "Purple", "Green", "Red", "Teal", "Gray"].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </div>
                <button type="button" className="col-span-1 grid place-items-center text-rose-300 hover:text-rose-200" onClick={() => updateMany((next) => next.priority_levels.splice(idx, 1))}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </SectionCard>
      ),
    },
    {
      id: "warranty",
      label: "Warranty & Quality",
      icon: ShieldCheck,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <NumberField label="Default warranty period" value={data.warranty_quality.default_warranty_days} onChange={(v) => updatePath("warranty_quality.default_warranty_days", v)} suffix="days" />
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Warranty counted from</span>
            <Select value={data.warranty_quality.warranty_counted_from || "Delivery date"} onChange={(e) => updatePath("warranty_quality.warranty_counted_from", e.target.value)}>
              <option>Delivery date</option>
              <option>Repair completion date</option>
              <option>Invoice date</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5 md:col-span-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Warranty void conditions</span>
            <textarea className="field min-h-[100px]" value={data.warranty_quality.warranty_void_conditions || ""} onChange={(e) => updatePath("warranty_quality.warranty_void_conditions", e.target.value)} />
          </label>
          <RowToggle label="Allow warranty repair reopening" checked={data.warranty_quality.allow_warranty_repair_reopening} onChange={(v) => updatePath("warranty_quality.allow_warranty_repair_reopening", v)} />
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Who can open warranty jobs</span>
            <Select value={data.warranty_quality.who_can_open_warranty_job || "Manager+"} onChange={(e) => updatePath("warranty_quality.who_can_open_warranty_job", e.target.value)}>
              <option>Manager+</option>
              <option>Admin+</option>
              <option>Owner only</option>
            </Select>
          </label>
          <NumberField label="Flag repeat repairs after" value={data.warranty_quality.flag_repeat_repairs_after_times} onChange={(v) => updatePath("warranty_quality.flag_repeat_repairs_after_times", v)} suffix="times" />
          <RowToggle label="Repair quality check required" checked={data.warranty_quality.repair_quality_check_required} onChange={(v) => updatePath("warranty_quality.repair_quality_check_required", v)} />
        </div>
      ),
    },
    {
      id: "terms",
      label: "Repair Notes & Terms",
      icon: FileText,
      render: ({ data, updatePath }) => (
        <div className="space-y-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Default job card terms</span>
            <textarea className="field min-h-[180px]" value={data.repair_notes_terms.default_job_card_terms || ""} onChange={(e) => updatePath("repair_notes_terms.default_job_card_terms", e.target.value)} />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <RowToggle label="Show on printed job card" checked={data.repair_notes_terms.show_terms_on_printed_job_card} onChange={(v) => updatePath("repair_notes_terms.show_terms_on_printed_job_card", v)} />
            <RowToggle label="Show on receipt" checked={data.repair_notes_terms.show_terms_on_receipt} onChange={(v) => updatePath("repair_notes_terms.show_terms_on_receipt", v)} />
            <RowToggle label="Show on SMS notification" checked={data.repair_notes_terms.show_terms_on_sms_notification} onChange={(v) => updatePath("repair_notes_terms.show_terms_on_sms_notification", v)} />
          </div>
        </div>
      ),
    },
  ];

  const sidePreview = ({ data }) => (
    <SectionCard title="Workflow Snapshot">
      <div className="space-y-1.5">
        {(data.repair_status_workflow || []).slice(0, 8).map((row, idx) => (
          <div key={`${row.name}-${idx}`} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-xs">
            <span className="text-slate-200">{row.name}</span>
            <Badge tone={row.default ? "green" : "slate"}>{row.default ? "Default" : row.color || "Color"}</Badge>
          </div>
        ))}
      </div>
    </SectionCard>
  );

  return (
    <SettingsSectionShell
      title="Repair Settings"
      subtitle="Control repair workflow, issue catalogs, priorities, quality, and printed terms."
      sectionValue={sectionValue}
      defaults={DEFAULTS}
      onSectionChange={onSectionChange}
      onSaveSection={onSaveSection}
      saving={saving}
      toast={toast}
      confirm={confirm}
      sections={sections}
      kpis={kpis}
      validate={validate}
      sidePreview={sidePreview}
    />
  );
}


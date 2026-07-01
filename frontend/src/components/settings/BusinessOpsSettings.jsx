import { useMemo } from "react";
import { BriefcaseBusiness, CreditCard, Percent, Boxes, Wrench, Users, ReceiptText, Plus, Trash2 } from "lucide-react";
import { Input, Select, Button, Badge, SectionCard } from "../../components/UI";
import SettingsSectionShell from "./SettingsSectionShell";

const DEFAULTS = {
  sales_pos_rules: {
    allow_credit_sales: true,
    default_credit_limit: 50000,
    max_credit_override: 100000,
    allow_selling_below_cost: false,
    require_customer_above: 10000,
    auto_apply_loyalty_discount: false,
    walk_in_customer_default_name: "Walk-in Customer",
    default_payment_method: "Cash",
    allow_split_payments: true,
    enable_rounding: true,
    rounding_rule: "Nearest 1.00",
  },
  discount_rules: {
    max_discount_cashier_percent: 10,
    max_discount_manager_percent: 25,
    max_discount_admin_percent: 100,
    require_reason_above_percent: 10,
    require_approval_above_percent: 15,
    allow_freebie_invoice: false,
    discount_applies_to: { products: true, repairs: true, spare_parts: false },
  },
  inventory_rules: {
    low_stock_threshold_default: 5,
    auto_generate_sku: true,
    sku_prefix: "IST-",
    sku_format: "IST-####",
    track_imei_for_phones: true,
    allow_negative_stock: false,
    warn_before_zero_stock: true,
    dead_stock_definition_days: 60,
    auto_reorder_suggestion: true,
  },
  repair_rules: {
    default_warranty_days: 30,
    sla_target_standard_hours: 24,
    sla_target_urgent_hours: 4,
    auto_assign_technician: false,
    require_advance_payment: false,
    minimum_advance_percent: 0,
    allow_repair_without_customer: true,
    auto_increment_job_numbers: true,
    job_number_prefix: "JOB-",
    job_number_format: "JOB-YYYYMMDD-###",
    require_device_condition_photos: true,
  },
  customer_rules: {
    auto_register_walk_in_customers: false,
    require_phone_for_new_customer: true,
    allow_duplicate_phone_numbers: false,
    customer_id_format: "CUS-####",
    dormant_customer_threshold_days: 90,
    allow_customer_blacklisting: true,
    show_outstanding_balance_at_pos: true,
  },
  expense_rules: {
    require_receipt_reference_above: 1000,
    approval_required_above: 10000,
    who_approves_expenses: "Manager",
    petty_cash_limit: 5000,
    expense_categories: [
      "Rent",
      "Salary",
      "Utilities",
      "Spare Parts Purchase",
      "Equipment & Tools",
      "Transport",
      "Marketing",
      "Miscellaneous",
    ],
  },
  return_refund_rules: {
    return_period_days: 7,
    allow_returns_without_invoice: false,
    allow_refund_to_different_payment_method: false,
    refund_approval_threshold: 100000,
    allow_store_credit: true,
    allow_exchanges: true,
    allow_warranty_replacement: true,
    restock_returned_sellable_items_automatically: true,
    require_inspection_before_refund: true,
    require_manager_approval_for_damaged_returns: true,
    default_return_policy_text:
      "Returns allowed within 7 days with invoice. Warranty claims follow product warranty rules. Physical damage is not eligible for refund.",
    return_receipt_footer_text: "Thank you. Returns are handled per policy.",
    return_reasons: [
      "Defective item",
      "Wrong item sold",
      "Customer changed mind",
      "Warranty claim",
      "Damaged packaging",
      "Not compatible",
      "Duplicate purchase",
      "Incorrect price",
      "Product not working",
      "Other",
    ],
  },
};

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

function NumberField({ label, value, onChange, min = 0, suffix }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
      <div className="flex gap-2">
        <Input type="number" min={min} value={Number(value || 0)} onChange={(e) => onChange(Number(e.target.value || 0))} />
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

function validate(data) {
  const errors = [];
  const maxCashier = Number(data?.discount_rules?.max_discount_cashier_percent || 0);
  const maxManager = Number(data?.discount_rules?.max_discount_manager_percent || 0);
  const maxAdmin = Number(data?.discount_rules?.max_discount_admin_percent || 0);
  const approvalAt = Number(data?.discount_rules?.require_approval_above_percent || 0);
  const reasonAt = Number(data?.discount_rules?.require_reason_above_percent || 0);
  const receiptRef = Number(data?.expense_rules?.require_receipt_reference_above || 0);
  const expenseApproval = Number(data?.expense_rules?.approval_required_above || 0);

  if (maxCashier > maxManager) errors.push("Cashier max discount cannot exceed manager max discount.");
  if (maxManager > maxAdmin) errors.push("Manager max discount cannot exceed admin/owner max discount.");
  if (approvalAt < reasonAt) errors.push("Approval threshold should be greater than or equal to reason threshold.");
  if (expenseApproval < receiptRef) errors.push("Expense approval threshold should be greater than receipt-reference threshold.");
  if (Number(data?.inventory_rules?.low_stock_threshold_default || 0) < 0) errors.push("Low stock threshold must be non-negative.");
  if (Number(data?.return_refund_rules?.return_period_days || 0) < 0) errors.push("Return period must be non-negative.");
  if (Number(data?.return_refund_rules?.refund_approval_threshold || 0) < 0) errors.push("Refund approval threshold must be non-negative.");
  if ((data?.return_refund_rules?.return_reasons || []).filter((x) => String(x || "").trim()).length === 0) {
    errors.push("At least one return reason must be configured.");
  }
  return errors;
}

export default function BusinessOpsSettings({ sectionValue, onSectionChange, onSaveSection, saving, toast, confirm }) {
  const kpis = useMemo(() => {
    const d = sectionValue || {};
    return [
      {
        title: "Credit Sales",
        value: d?.sales_pos_rules?.allow_credit_sales ? "Enabled" : "Disabled",
        tone: d?.sales_pos_rules?.allow_credit_sales ? "green" : "amber",
        icon: <CreditCard size={16} />,
      },
      {
        title: "Cashier Max Discount",
        value: `${Number(d?.discount_rules?.max_discount_cashier_percent || 0)}%`,
        tone: "indigo",
        icon: <Percent size={16} />,
      },
      {
        title: "Low Stock Threshold",
        value: String(Number(d?.inventory_rules?.low_stock_threshold_default || 0)),
        tone: "amber",
        icon: <Boxes size={16} />,
      },
      {
        title: "Default Repair Warranty",
        value: `${Number(d?.repair_rules?.default_warranty_days || 0)} days`,
        tone: "sky",
        icon: <Wrench size={16} />,
      },
      {
        title: "Phone Required",
        value: d?.customer_rules?.require_phone_for_new_customer ? "Yes" : "No",
        tone: d?.customer_rules?.require_phone_for_new_customer ? "green" : "red",
        icon: <Users size={16} />,
      },
      {
        title: "Expense Approval",
        value: `LKR ${Number(d?.expense_rules?.approval_required_above || 0).toLocaleString("en-LK")}`,
        tone: "violet",
        icon: <ReceiptText size={16} />,
      },
      {
        title: "Return Period",
        value: `${Number(d?.return_refund_rules?.return_period_days || 0)} days`,
        tone: "amber",
        icon: <BriefcaseBusiness size={16} />,
      },
    ];
  }, [sectionValue]);

  const sections = [
    {
      id: "sales",
      label: "Sales / POS Rules",
      icon: CreditCard,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <RowToggle label="Allow credit sales" checked={data.sales_pos_rules.allow_credit_sales} onChange={(v) => updatePath("sales_pos_rules.allow_credit_sales", v)} />
          <RowToggle label="Allow split payments" checked={data.sales_pos_rules.allow_split_payments} onChange={(v) => updatePath("sales_pos_rules.allow_split_payments", v)} />
          <RowToggle label="Enable rounding" checked={data.sales_pos_rules.enable_rounding} onChange={(v) => updatePath("sales_pos_rules.enable_rounding", v)} />
          <RowToggle label="Allow selling below cost price" checked={data.sales_pos_rules.allow_selling_below_cost} onChange={(v) => updatePath("sales_pos_rules.allow_selling_below_cost", v)} />
          <NumberField label="Default credit limit" value={data.sales_pos_rules.default_credit_limit} onChange={(v) => updatePath("sales_pos_rules.default_credit_limit", v)} suffix="LKR" />
          <NumberField label="Max credit override (manager)" value={data.sales_pos_rules.max_credit_override} onChange={(v) => updatePath("sales_pos_rules.max_credit_override", v)} suffix="LKR" />
          <NumberField label="Require customer above" value={data.sales_pos_rules.require_customer_above} onChange={(v) => updatePath("sales_pos_rules.require_customer_above", v)} suffix="LKR" />
          <TextField label="Walk-in customer default name" value={data.sales_pos_rules.walk_in_customer_default_name} onChange={(v) => updatePath("sales_pos_rules.walk_in_customer_default_name", v)} />
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Default payment method</span>
            <Select value={data.sales_pos_rules.default_payment_method || "Cash"} onChange={(e) => updatePath("sales_pos_rules.default_payment_method", e.target.value)}>
              <option>Cash</option>
              <option>Card</option>
              <option>Bank Transfer</option>
              <option>Credit</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Rounding rule</span>
            <Select value={data.sales_pos_rules.rounding_rule || "Nearest 1.00"} onChange={(e) => updatePath("sales_pos_rules.rounding_rule", e.target.value)}>
              <option>Nearest 1.00</option>
              <option>Nearest 0.50</option>
              <option>Nearest 0.10</option>
              <option>No rounding</option>
            </Select>
          </label>
        </div>
      ),
    },
    {
      id: "discount",
      label: "Discount Rules",
      icon: Percent,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <NumberField label="Max discount (cashier)" value={data.discount_rules.max_discount_cashier_percent} onChange={(v) => updatePath("discount_rules.max_discount_cashier_percent", v)} suffix="%" />
          <NumberField label="Max discount (manager)" value={data.discount_rules.max_discount_manager_percent} onChange={(v) => updatePath("discount_rules.max_discount_manager_percent", v)} suffix="%" />
          <NumberField label="Max discount (admin/owner)" value={data.discount_rules.max_discount_admin_percent} onChange={(v) => updatePath("discount_rules.max_discount_admin_percent", v)} suffix="%" />
          <NumberField label="Require reason above" value={data.discount_rules.require_reason_above_percent} onChange={(v) => updatePath("discount_rules.require_reason_above_percent", v)} suffix="%" />
          <NumberField label="Require approval above" value={data.discount_rules.require_approval_above_percent} onChange={(v) => updatePath("discount_rules.require_approval_above_percent", v)} suffix="%" />
          <RowToggle label="Allow freebie invoice (0 total)" checked={data.discount_rules.allow_freebie_invoice} onChange={(v) => updatePath("discount_rules.allow_freebie_invoice", v)} />
          <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-2">
            <RowToggle label="Discount on Products" checked={data.discount_rules.discount_applies_to.products} onChange={(v) => updatePath("discount_rules.discount_applies_to.products", v)} />
            <RowToggle label="Discount on Repairs" checked={data.discount_rules.discount_applies_to.repairs} onChange={(v) => updatePath("discount_rules.discount_applies_to.repairs", v)} />
            <RowToggle label="Discount on Spare Parts" checked={data.discount_rules.discount_applies_to.spare_parts} onChange={(v) => updatePath("discount_rules.discount_applies_to.spare_parts", v)} />
          </div>
        </div>
      ),
    },
    {
      id: "inventory",
      label: "Inventory Rules",
      icon: Boxes,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <NumberField label="Low stock threshold (default)" value={data.inventory_rules.low_stock_threshold_default} onChange={(v) => updatePath("inventory_rules.low_stock_threshold_default", v)} />
          <RowToggle label="Auto-generate SKU" checked={data.inventory_rules.auto_generate_sku} onChange={(v) => updatePath("inventory_rules.auto_generate_sku", v)} />
          <TextField label="SKU prefix" value={data.inventory_rules.sku_prefix} onChange={(v) => updatePath("inventory_rules.sku_prefix", v)} />
          <TextField label="SKU format" value={data.inventory_rules.sku_format} onChange={(v) => updatePath("inventory_rules.sku_format", v)} />
          <RowToggle label="Track IMEI for phones" checked={data.inventory_rules.track_imei_for_phones} onChange={(v) => updatePath("inventory_rules.track_imei_for_phones", v)} />
          <RowToggle label="Allow negative stock" checked={data.inventory_rules.allow_negative_stock} onChange={(v) => updatePath("inventory_rules.allow_negative_stock", v)} />
          <RowToggle label="Warn before zero stock" checked={data.inventory_rules.warn_before_zero_stock} onChange={(v) => updatePath("inventory_rules.warn_before_zero_stock", v)} />
          <NumberField label="Dead stock definition (days)" value={data.inventory_rules.dead_stock_definition_days} onChange={(v) => updatePath("inventory_rules.dead_stock_definition_days", v)} />
          <RowToggle label="Auto-reorder suggestion" checked={data.inventory_rules.auto_reorder_suggestion} onChange={(v) => updatePath("inventory_rules.auto_reorder_suggestion", v)} />
        </div>
      ),
    },
    {
      id: "repair",
      label: "Repair Rules",
      icon: Wrench,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <NumberField label="Default warranty period" value={data.repair_rules.default_warranty_days} onChange={(v) => updatePath("repair_rules.default_warranty_days", v)} suffix="days" />
          <NumberField label="SLA target (standard)" value={data.repair_rules.sla_target_standard_hours} onChange={(v) => updatePath("repair_rules.sla_target_standard_hours", v)} suffix="hrs" />
          <NumberField label="SLA target (urgent)" value={data.repair_rules.sla_target_urgent_hours} onChange={(v) => updatePath("repair_rules.sla_target_urgent_hours", v)} suffix="hrs" />
          <RowToggle label="Auto-assign technician" checked={data.repair_rules.auto_assign_technician} onChange={(v) => updatePath("repair_rules.auto_assign_technician", v)} />
          <RowToggle label="Require advance payment" checked={data.repair_rules.require_advance_payment} onChange={(v) => updatePath("repair_rules.require_advance_payment", v)} />
          <NumberField label="Minimum advance %" value={data.repair_rules.minimum_advance_percent} onChange={(v) => updatePath("repair_rules.minimum_advance_percent", v)} suffix="%" />
          <RowToggle label="Allow repair without customer" checked={data.repair_rules.allow_repair_without_customer} onChange={(v) => updatePath("repair_rules.allow_repair_without_customer", v)} />
          <RowToggle label="Auto-increment job numbers" checked={data.repair_rules.auto_increment_job_numbers} onChange={(v) => updatePath("repair_rules.auto_increment_job_numbers", v)} />
          <TextField label="Job number prefix" value={data.repair_rules.job_number_prefix} onChange={(v) => updatePath("repair_rules.job_number_prefix", v)} />
          <TextField label="Job number format" value={data.repair_rules.job_number_format} onChange={(v) => updatePath("repair_rules.job_number_format", v)} />
          <RowToggle label="Require device condition photos" checked={data.repair_rules.require_device_condition_photos} onChange={(v) => updatePath("repair_rules.require_device_condition_photos", v)} />
        </div>
      ),
    },
    {
      id: "customer",
      label: "Customer Rules",
      icon: Users,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <RowToggle label="Auto-register walk-ins" checked={data.customer_rules.auto_register_walk_in_customers} onChange={(v) => updatePath("customer_rules.auto_register_walk_in_customers", v)} />
          <RowToggle label="Require phone for new customer" checked={data.customer_rules.require_phone_for_new_customer} onChange={(v) => updatePath("customer_rules.require_phone_for_new_customer", v)} />
          <RowToggle label="Allow duplicate phone numbers" checked={data.customer_rules.allow_duplicate_phone_numbers} onChange={(v) => updatePath("customer_rules.allow_duplicate_phone_numbers", v)} />
          <TextField label="Customer ID format" value={data.customer_rules.customer_id_format} onChange={(v) => updatePath("customer_rules.customer_id_format", v)} />
          <NumberField label="Dormant threshold (days)" value={data.customer_rules.dormant_customer_threshold_days} onChange={(v) => updatePath("customer_rules.dormant_customer_threshold_days", v)} />
          <RowToggle label="Allow customer blacklisting" checked={data.customer_rules.allow_customer_blacklisting} onChange={(v) => updatePath("customer_rules.allow_customer_blacklisting", v)} />
          <RowToggle label="Show outstanding at POS" checked={data.customer_rules.show_outstanding_balance_at_pos} onChange={(v) => updatePath("customer_rules.show_outstanding_balance_at_pos", v)} />
        </div>
      ),
    },
    {
      id: "expense",
      label: "Expense Rules",
      icon: ReceiptText,
      render: ({ data, updatePath, updateMany }) => (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <NumberField label="Require receipt reference above" value={data.expense_rules.require_receipt_reference_above} onChange={(v) => updatePath("expense_rules.require_receipt_reference_above", v)} suffix="LKR" />
            <NumberField label="Approval required above" value={data.expense_rules.approval_required_above} onChange={(v) => updatePath("expense_rules.approval_required_above", v)} suffix="LKR" />
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Who approves expenses</span>
              <Select value={data.expense_rules.who_approves_expenses || "Manager"} onChange={(e) => updatePath("expense_rules.who_approves_expenses", e.target.value)}>
                <option>Manager</option>
                <option>Admin</option>
                <option>Owner</option>
              </Select>
            </label>
            <NumberField label="Petty cash limit" value={data.expense_rules.petty_cash_limit} onChange={(v) => updatePath("expense_rules.petty_cash_limit", v)} suffix="LKR" />
          </div>
          <SectionCard
            title="Expense Categories"
            subtitle="Editable list used across expense entry forms"
            right={
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  updateMany((next) => {
                    next.expense_rules.expense_categories.push("New Category");
                  })
                }
              >
                <Plus size={12} /> Add
              </Button>
            }
          >
            <div className="space-y-2">
              {(data.expense_rules.expense_categories || []).map((row, idx) => (
                <div key={`${row}-${idx}`} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-11">
                    <Input value={row} onChange={(e) => updatePath(`expense_rules.expense_categories.${idx}`, e.target.value)} />
                  </div>
                  <button
                    type="button"
                    className="col-span-1 text-rose-300 hover:text-rose-200 grid place-items-center"
                    onClick={() =>
                      updateMany((next) => {
                        next.expense_rules.expense_categories.splice(idx, 1);
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {(data.expense_rules.expense_categories || []).length === 0 && <Badge tone="amber">No categories configured.</Badge>}
            </div>
          </SectionCard>
        </div>
      ),
    },
    {
      id: "returns",
      label: "Return & Refund Rules",
      icon: BriefcaseBusiness,
      render: ({ data, updatePath, updateMany }) => (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <NumberField
              label="Return period"
              value={data.return_refund_rules.return_period_days}
              onChange={(v) => updatePath("return_refund_rules.return_period_days", v)}
              suffix="days"
            />
            <NumberField
              label="Refund approval threshold"
              value={data.return_refund_rules.refund_approval_threshold}
              onChange={(v) => updatePath("return_refund_rules.refund_approval_threshold", v)}
              suffix="LKR"
            />
            <RowToggle
              label="Allow returns without invoice"
              checked={data.return_refund_rules.allow_returns_without_invoice}
              onChange={(v) => updatePath("return_refund_rules.allow_returns_without_invoice", v)}
            />
            <RowToggle
              label="Allow refund to different payment method"
              checked={data.return_refund_rules.allow_refund_to_different_payment_method}
              onChange={(v) => updatePath("return_refund_rules.allow_refund_to_different_payment_method", v)}
            />
            <RowToggle
              label="Allow store credit"
              checked={data.return_refund_rules.allow_store_credit}
              onChange={(v) => updatePath("return_refund_rules.allow_store_credit", v)}
            />
            <RowToggle
              label="Allow exchanges"
              checked={data.return_refund_rules.allow_exchanges}
              onChange={(v) => updatePath("return_refund_rules.allow_exchanges", v)}
            />
            <RowToggle
              label="Allow warranty replacement"
              checked={data.return_refund_rules.allow_warranty_replacement}
              onChange={(v) => updatePath("return_refund_rules.allow_warranty_replacement", v)}
            />
            <RowToggle
              label="Auto-restock sellable returns"
              checked={data.return_refund_rules.restock_returned_sellable_items_automatically}
              onChange={(v) =>
                updatePath("return_refund_rules.restock_returned_sellable_items_automatically", v)
              }
            />
            <RowToggle
              label="Require inspection before refund"
              checked={data.return_refund_rules.require_inspection_before_refund}
              onChange={(v) => updatePath("return_refund_rules.require_inspection_before_refund", v)}
            />
            <RowToggle
              label="Manager approval for damaged returns"
              checked={data.return_refund_rules.require_manager_approval_for_damaged_returns}
              onChange={(v) =>
                updatePath("return_refund_rules.require_manager_approval_for_damaged_returns", v)
              }
            />
            <div className="md:col-span-2">
              <TextField
                label="Default return policy text"
                value={data.return_refund_rules.default_return_policy_text}
                onChange={(v) => updatePath("return_refund_rules.default_return_policy_text", v)}
              />
            </div>
            <div className="md:col-span-2">
              <TextField
                label="Return receipt footer text"
                value={data.return_refund_rules.return_receipt_footer_text}
                onChange={(v) => updatePath("return_refund_rules.return_receipt_footer_text", v)}
              />
            </div>
          </div>

          <SectionCard
            title="Return Reasons"
            subtitle="Configured reasons available in Returns module"
            right={
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  updateMany((next) => {
                    next.return_refund_rules.return_reasons.push("New reason");
                  })
                }
              >
                <Plus size={12} /> Add
              </Button>
            }
          >
            <div className="space-y-2">
              {(data.return_refund_rules.return_reasons || []).map((row, idx) => (
                <div key={`${row}-${idx}`} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-11">
                    <Input
                      value={row}
                      onChange={(e) => updatePath(`return_refund_rules.return_reasons.${idx}`, e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="col-span-1 text-rose-300 hover:text-rose-200 grid place-items-center"
                    onClick={() =>
                      updateMany((next) => {
                        next.return_refund_rules.return_reasons.splice(idx, 1);
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {(data.return_refund_rules.return_reasons || []).length === 0 && (
                <Badge tone="amber">No return reasons configured.</Badge>
              )}
            </div>
          </SectionCard>
        </div>
      ),
    },
  ];

  return (
    <SettingsSectionShell
      title="Business Ops"
      subtitle="Operational rules for POS, discounts, inventory, repairs, customers, and expenses."
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
    />
  );
}

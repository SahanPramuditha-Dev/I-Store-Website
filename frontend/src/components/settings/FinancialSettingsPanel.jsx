import { useMemo } from "react";
import { Coins, Globe2, Landmark, Percent, Wallet, CalendarClock, Trophy, Plus, Trash2 } from "lucide-react";
import { Input, Select, Button, SectionCard, Badge } from "../../components/UI";
import SettingsSectionShell from "./SettingsSectionShell";

const DEFAULTS = {
  currency_locale: {
    currency: "LKR",
    currency_symbol: "LKR",
    currency_symbol_position: "Before amount",
    decimal_places: 2,
    thousand_separator: ",",
    date_format: "DD/MM/YYYY",
    time_format: "12-hour",
  },
  tax_configuration: {
    enable_tax_on_sales: true,
    tax_name: "VAT",
    tax_rate_percent: 0,
    tax_mode: "Exclusive",
    apply_tax_to: { products: true, repairs: true, accessories: true },
    tax_registration_number: "",
    enable_service_charge: true,
    service_charge_name: "Service Charge",
    service_charge_rate_percent: 0,
    service_charge_on: "Repairs only",
  },
  payment_methods: {
    cash: true,
    card: true,
    bank_transfer: true,
    credit: true,
    cheque: false,
    online_payment: false,
    custom_methods: [],
  },
  cash_drawer: {
    enable_cash_drawer_integration: true,
    opening_float_amount: 5000,
    reconciliation_reminder_time: "19:00",
    require_daily_reconciliation: true,
  },
  financial_year: {
    financial_year_start_month: "January",
    fiscal_year_name_format: "FY 2026/2027",
    monthly_closing_required: false,
  },
  commission_settings: {
    enable_commission_tracking: true,
    sales_commission_type: "% of sale value",
    default_sales_commission_rate_percent: 2,
    repair_commission_type: "% of repair value",
    default_repair_commission_rate_percent: 5,
    commission_calculated_on: "Net (after discount)",
    per_staff_commission_override: true,
  },
  advance_payment_settings: {
    enable_repair_advance: true,
    enable_product_reservation_advance: true,
    require_advance_above_amount: 10000,
    default_minimum_advance_percentage: 30,
    allow_advance_greater_than_estimate: false,
    manager_approval_required_for_refund: true,
    manager_approval_required_for_cancellation: true,
    auto_apply_advance_to_final_invoice: true,
    reservation_expiry_days: 14,
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
  const tax = Number(data?.tax_configuration?.tax_rate_percent || 0);
  const service = Number(data?.tax_configuration?.service_charge_rate_percent || 0);
  const salesCom = Number(data?.commission_settings?.default_sales_commission_rate_percent || 0);
  const repairCom = Number(data?.commission_settings?.default_repair_commission_rate_percent || 0);
  const floatAmt = Number(data?.cash_drawer?.opening_float_amount || 0);

  if (tax < 0 || tax > 100) errors.push("Tax rate must be between 0% and 100%.");
  if (service < 0 || service > 100) errors.push("Service charge rate must be between 0% and 100%.");
  if (salesCom < 0 || salesCom > 100) errors.push("Sales commission rate must be between 0% and 100%.");
  if (repairCom < 0 || repairCom > 100) errors.push("Repair commission rate must be between 0% and 100%.");
  if (floatAmt < 0) errors.push("Opening float amount cannot be negative.");
  if (!data?.currency_locale?.currency) errors.push("Currency is required.");
  return errors;
}

function formatMoneySample(currencySymbol, position, decimals, separator) {
  const value = 12500.45;
  let formatted = value.toFixed(Number(decimals || 2));
  if (separator === ",") {
    const [int, frac] = formatted.split(".");
    formatted = `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac !== undefined ? `.${frac}` : ""}`;
  }
  return position === "After amount" ? `${formatted} ${currencySymbol}` : `${currencySymbol} ${formatted}`;
}

export default function FinancialSettingsPanel({ sectionValue, onSectionChange, onSaveSection, saving, toast, confirm }) {
  const kpis = useMemo(() => {
    const d = sectionValue || {};
    return [
      { title: "Currency", value: d?.currency_locale?.currency || "LKR", tone: "indigo", icon: <Coins size={16} /> },
      { title: "Tax Rate", value: `${Number(d?.tax_configuration?.tax_rate_percent || 0)}%`, tone: "amber", icon: <Percent size={16} /> },
      {
        title: "Cash Drawer",
        value: d?.cash_drawer?.enable_cash_drawer_integration ? "Enabled" : "Disabled",
        tone: d?.cash_drawer?.enable_cash_drawer_integration ? "green" : "red",
        icon: <Wallet size={16} />,
      },
      { title: "Opening Float", value: `LKR ${Number(d?.cash_drawer?.opening_float_amount || 0).toLocaleString("en-LK")}`, tone: "sky", icon: <Landmark size={16} /> },
      {
        title: "Monthly Closing",
        value: d?.financial_year?.monthly_closing_required ? "Required" : "Optional",
        tone: d?.financial_year?.monthly_closing_required ? "amber" : "green",
        icon: <CalendarClock size={16} />,
      },
      {
        title: "Commission",
        value: d?.commission_settings?.enable_commission_tracking ? "Enabled" : "Disabled",
        tone: d?.commission_settings?.enable_commission_tracking ? "violet" : "red",
        icon: <Trophy size={16} />,
      },
    ];
  }, [sectionValue]);

  const sections = [
    {
      id: "currency",
      label: "Currency & Locale",
      icon: Globe2,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextField label="Currency code" value={data.currency_locale.currency} onChange={(v) => updatePath("currency_locale.currency", v)} />
          <TextField label="Currency symbol" value={data.currency_locale.currency_symbol} onChange={(v) => updatePath("currency_locale.currency_symbol", v)} />
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Symbol position</span>
            <Select value={data.currency_locale.currency_symbol_position || "Before amount"} onChange={(e) => updatePath("currency_locale.currency_symbol_position", e.target.value)}>
              <option>Before amount</option>
              <option>After amount</option>
            </Select>
          </label>
          <NumberField label="Decimal places" value={data.currency_locale.decimal_places} onChange={(v) => updatePath("currency_locale.decimal_places", v)} />
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Thousand separator</span>
            <Select value={data.currency_locale.thousand_separator || ","} onChange={(e) => updatePath("currency_locale.thousand_separator", e.target.value)}>
              <option value=",">,</option>
              <option value=".">.</option>
              <option value=" ">Space</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Date format</span>
            <Select value={data.currency_locale.date_format || "DD/MM/YYYY"} onChange={(e) => updatePath("currency_locale.date_format", e.target.value)}>
              <option>DD/MM/YYYY</option>
              <option>YYYY-MM-DD</option>
              <option>MM/DD/YYYY</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Time format</span>
            <Select value={data.currency_locale.time_format || "12-hour"} onChange={(e) => updatePath("currency_locale.time_format", e.target.value)}>
              <option>12-hour</option>
              <option>24-hour</option>
            </Select>
          </label>
          <SectionCard title="Sample Formatting" className="md:col-span-2">
            <p className="text-sm text-slate-200">
              {formatMoneySample(
                data.currency_locale.currency_symbol || "LKR",
                data.currency_locale.currency_symbol_position || "Before amount",
                data.currency_locale.decimal_places,
                data.currency_locale.thousand_separator
              )}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Date: {data.currency_locale.date_format || "DD/MM/YYYY"} • Time: {data.currency_locale.time_format || "12-hour"}
            </p>
          </SectionCard>
        </div>
      ),
    },
    {
      id: "tax",
      label: "Tax Configuration",
      icon: Percent,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <RowToggle label="Enable tax on sales" checked={data.tax_configuration.enable_tax_on_sales} onChange={(v) => updatePath("tax_configuration.enable_tax_on_sales", v)} />
          <TextField label="Tax name" value={data.tax_configuration.tax_name} onChange={(v) => updatePath("tax_configuration.tax_name", v)} />
          <NumberField label="Tax rate" value={data.tax_configuration.tax_rate_percent} onChange={(v) => updatePath("tax_configuration.tax_rate_percent", v)} suffix="%" />
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Tax mode</span>
            <Select value={data.tax_configuration.tax_mode || "Exclusive"} onChange={(e) => updatePath("tax_configuration.tax_mode", e.target.value)}>
              <option>Exclusive</option>
              <option>Inclusive</option>
            </Select>
          </label>
          <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-2">
            <RowToggle label="Apply tax to products" checked={data.tax_configuration.apply_tax_to.products} onChange={(v) => updatePath("tax_configuration.apply_tax_to.products", v)} />
            <RowToggle label="Apply tax to repairs" checked={data.tax_configuration.apply_tax_to.repairs} onChange={(v) => updatePath("tax_configuration.apply_tax_to.repairs", v)} />
            <RowToggle label="Apply tax to accessories" checked={data.tax_configuration.apply_tax_to.accessories} onChange={(v) => updatePath("tax_configuration.apply_tax_to.accessories", v)} />
          </div>
          <TextField label="Tax registration number" value={data.tax_configuration.tax_registration_number} onChange={(v) => updatePath("tax_configuration.tax_registration_number", v)} />
          <RowToggle label="Enable service charge" checked={data.tax_configuration.enable_service_charge} onChange={(v) => updatePath("tax_configuration.enable_service_charge", v)} />
          <TextField label="Service charge name" value={data.tax_configuration.service_charge_name} onChange={(v) => updatePath("tax_configuration.service_charge_name", v)} />
          <NumberField label="Service charge rate" value={data.tax_configuration.service_charge_rate_percent} onChange={(v) => updatePath("tax_configuration.service_charge_rate_percent", v)} suffix="%" />
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Service charge on</span>
            <Select value={data.tax_configuration.service_charge_on || "Repairs only"} onChange={(e) => updatePath("tax_configuration.service_charge_on", e.target.value)}>
              <option>Repairs only</option>
              <option>Products only</option>
              <option>Products + Repairs</option>
            </Select>
          </label>
        </div>
      ),
    },
    {
      id: "payment",
      label: "Payment Methods",
      icon: Wallet,
      render: ({ data, updatePath, updateMany }) => (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <RowToggle label="Cash" checked={data.payment_methods.cash} onChange={(v) => updatePath("payment_methods.cash", v)} />
            <RowToggle label="Card" checked={data.payment_methods.card} onChange={(v) => updatePath("payment_methods.card", v)} />
            <RowToggle label="Bank Transfer" checked={data.payment_methods.bank_transfer} onChange={(v) => updatePath("payment_methods.bank_transfer", v)} />
            <RowToggle label="Credit" checked={data.payment_methods.credit} onChange={(v) => updatePath("payment_methods.credit", v)} />
            <RowToggle label="Cheque" checked={data.payment_methods.cheque} onChange={(v) => updatePath("payment_methods.cheque", v)} />
            <RowToggle label="Online Payment" checked={data.payment_methods.online_payment} onChange={(v) => updatePath("payment_methods.online_payment", v)} />
          </div>
          <SectionCard
            title="Custom Payment Methods"
            right={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => updateMany((next) => next.payment_methods.custom_methods.push("New Method"))}
              >
                <Plus size={12} /> Add
              </Button>
            }
          >
            <div className="space-y-2">
              {(data.payment_methods.custom_methods || []).map((row, idx) => (
                <div key={`${row}-${idx}`} className="grid grid-cols-12 gap-2">
                  <div className="col-span-11">
                    <Input value={row} onChange={(e) => updatePath(`payment_methods.custom_methods.${idx}`, e.target.value)} />
                  </div>
                  <button
                    type="button"
                    className="col-span-1 grid place-items-center text-rose-300 hover:text-rose-200"
                    onClick={() =>
                      updateMany((next) => {
                        next.payment_methods.custom_methods.splice(idx, 1);
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {(data.payment_methods.custom_methods || []).length === 0 && <Badge tone="slate">No custom methods configured.</Badge>}
            </div>
          </SectionCard>
        </div>
      ),
    },
    {
      id: "advance",
      label: "Advance Payment Settings",
      icon: Wallet,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <RowToggle label="Enable repair advance" checked={data.advance_payment_settings.enable_repair_advance} onChange={(v) => updatePath("advance_payment_settings.enable_repair_advance", v)} />
          <RowToggle label="Enable product reservation advance" checked={data.advance_payment_settings.enable_product_reservation_advance} onChange={(v) => updatePath("advance_payment_settings.enable_product_reservation_advance", v)} />
          <NumberField label="Require advance above amount" value={data.advance_payment_settings.require_advance_above_amount} onChange={(v) => updatePath("advance_payment_settings.require_advance_above_amount", v)} suffix="LKR" />
          <NumberField label="Default minimum advance %" value={data.advance_payment_settings.default_minimum_advance_percentage} onChange={(v) => updatePath("advance_payment_settings.default_minimum_advance_percentage", v)} suffix="%" />
          <RowToggle label="Allow advance greater than estimate" checked={data.advance_payment_settings.allow_advance_greater_than_estimate} onChange={(v) => updatePath("advance_payment_settings.allow_advance_greater_than_estimate", v)} />
          <RowToggle label="Auto-apply advance to final invoice" checked={data.advance_payment_settings.auto_apply_advance_to_final_invoice} onChange={(v) => updatePath("advance_payment_settings.auto_apply_advance_to_final_invoice", v)} />
          <RowToggle label="Manager approval required for refund" checked={data.advance_payment_settings.manager_approval_required_for_refund} onChange={(v) => updatePath("advance_payment_settings.manager_approval_required_for_refund", v)} />
          <RowToggle label="Manager approval required for cancellation" checked={data.advance_payment_settings.manager_approval_required_for_cancellation} onChange={(v) => updatePath("advance_payment_settings.manager_approval_required_for_cancellation", v)} />
          <NumberField label="Reservation expiry (days)" value={data.advance_payment_settings.reservation_expiry_days} onChange={(v) => updatePath("advance_payment_settings.reservation_expiry_days", v)} suffix="days" />
        </div>
      ),
    },
    {
      id: "cash_drawer",
      label: "Cash Drawer",
      icon: Landmark,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <RowToggle label="Enable cash drawer integration" checked={data.cash_drawer.enable_cash_drawer_integration} onChange={(v) => updatePath("cash_drawer.enable_cash_drawer_integration", v)} />
          <RowToggle label="Require daily reconciliation" checked={data.cash_drawer.require_daily_reconciliation} onChange={(v) => updatePath("cash_drawer.require_daily_reconciliation", v)} />
          <NumberField label="Opening float amount" value={data.cash_drawer.opening_float_amount} onChange={(v) => updatePath("cash_drawer.opening_float_amount", v)} suffix="LKR" />
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Reconciliation reminder time</span>
            <Input type="time" value={data.cash_drawer.reconciliation_reminder_time || "19:00"} onChange={(e) => updatePath("cash_drawer.reconciliation_reminder_time", e.target.value)} />
          </label>
        </div>
      ),
    },
    {
      id: "fy",
      label: "Financial Year",
      icon: CalendarClock,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Financial year start month</span>
            <Select value={data.financial_year.financial_year_start_month || "January"} onChange={(e) => updatePath("financial_year.financial_year_start_month", e.target.value)}>
              {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </label>
          <TextField label="Fiscal year name format" value={data.financial_year.fiscal_year_name_format} onChange={(v) => updatePath("financial_year.fiscal_year_name_format", v)} />
          <RowToggle label="Monthly closing required" checked={data.financial_year.monthly_closing_required} onChange={(v) => updatePath("financial_year.monthly_closing_required", v)} />
        </div>
      ),
    },
    {
      id: "commission",
      label: "Commission Settings",
      icon: Trophy,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <RowToggle label="Enable commission tracking" checked={data.commission_settings.enable_commission_tracking} onChange={(v) => updatePath("commission_settings.enable_commission_tracking", v)} />
          <RowToggle label="Per-staff commission override" checked={data.commission_settings.per_staff_commission_override} onChange={(v) => updatePath("commission_settings.per_staff_commission_override", v)} />
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sales commission type</span>
            <Select value={data.commission_settings.sales_commission_type || "% of sale value"} onChange={(e) => updatePath("commission_settings.sales_commission_type", e.target.value)}>
              <option>% of sale value</option>
              <option>Flat amount</option>
            </Select>
          </label>
          <NumberField label="Default sales commission rate" value={data.commission_settings.default_sales_commission_rate_percent} onChange={(v) => updatePath("commission_settings.default_sales_commission_rate_percent", v)} suffix="%" />
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Repair commission type</span>
            <Select value={data.commission_settings.repair_commission_type || "% of repair value"} onChange={(e) => updatePath("commission_settings.repair_commission_type", e.target.value)}>
              <option>% of repair value</option>
              <option>Flat amount</option>
            </Select>
          </label>
          <NumberField label="Default repair commission rate" value={data.commission_settings.default_repair_commission_rate_percent} onChange={(v) => updatePath("commission_settings.default_repair_commission_rate_percent", v)} suffix="%" />
          <label className="flex flex-col gap-1.5 md:col-span-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Commission calculated on</span>
            <Select value={data.commission_settings.commission_calculated_on || "Net (after discount)"} onChange={(e) => updatePath("commission_settings.commission_calculated_on", e.target.value)}>
              <option>Net (after discount)</option>
              <option>Gross (before discount)</option>
            </Select>
          </label>
        </div>
      ),
    },
  ];

  const sidePreview = ({ data }) => (
    <SectionCard title="Quick Preview">
      <p className="text-xs text-slate-500">Sample Amount</p>
      <p className="text-lg font-black text-white mt-1">
        {formatMoneySample(
          data.currency_locale.currency_symbol,
          data.currency_locale.currency_symbol_position,
          data.currency_locale.decimal_places,
          data.currency_locale.thousand_separator
        )}
      </p>
      <p className="text-xs text-slate-400 mt-2">
        Tax: {Number(data.tax_configuration.tax_rate_percent || 0)}% • Service: {Number(data.tax_configuration.service_charge_rate_percent || 0)}%
      </p>
    </SectionCard>
  );

  return (
    <SettingsSectionShell
      title="Financial Settings"
      subtitle="Currency, taxes, payment methods, cash operations, fiscal year, and commissions."
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

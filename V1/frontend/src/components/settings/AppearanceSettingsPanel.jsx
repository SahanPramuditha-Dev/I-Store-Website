import { useMemo } from "react";
import { Palette, LayoutDashboard, ShoppingCart, Table2, CalendarDays, Sparkles } from "lucide-react";
import { Input, Select, SectionCard, Badge } from "../../components/UI";
import SettingsSectionShell from "./SettingsSectionShell";

const DEFAULTS = {
  theme: {
    color_theme: "Dark",
    accent_color: "#6c63ff",
    sidebar_style: "Full labels",
    sidebar_position: "Left",
    compact_mode: true,
    animation_speed: "Normal",
  },
  dashboard_display: {
    default_date_range_on_load: "Today",
    show_quick_action_tiles: true,
    show_low_stock_alerts_on_dashboard: true,
    show_pending_repairs_widget: true,
    show_outstanding_balance_widget: true,
    cards_per_row_reports: 4,
  },
  pos_display: {
    show_product_images_in_pos: true,
    products_per_page_pos_grid: 20,
    default_pos_view: "Grid",
    show_stock_qty_in_pos: true,
    warn_when_stock_below: 3,
    show_customer_balance_at_checkout: true,
    calculator_widget_at_pos: true,
  },
  table_display: {
    rows_per_page_default: 25,
    table_density: "Compact",
    sticky_table_headers: true,
    show_row_numbers: true,
    highlight_overdue_rows: true,
  },
  number_date_display: {
    date_format: "DD/MM/YYYY",
    time_format: "12-hour",
    currency_display: "LKR 12,500.00",
    large_number_format: "12,500",
    negative_numbers_format: "(1,500)",
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

function validate(data) {
  const errors = [];
  if (Number(data?.dashboard_display?.cards_per_row_reports || 0) < 1) errors.push("Cards per row must be at least 1.");
  if (Number(data?.pos_display?.products_per_page_pos_grid || 0) < 1) errors.push("Products per page must be at least 1.");
  if (Number(data?.table_display?.rows_per_page_default || 0) < 1) errors.push("Rows per page must be at least 1.");
  if (Number(data?.pos_display?.warn_when_stock_below || 0) < 0) errors.push("Stock warning threshold cannot be negative.");
  return errors;
}

export default function AppearanceSettingsPanel({ sectionValue, onSectionChange, onSaveSection, saving, toast, confirm }) {
  const kpis = useMemo(() => {
    const d = sectionValue || {};
    return [
      { title: "Theme", value: d?.theme?.color_theme || "Dark", tone: "indigo", icon: <Palette size={16} /> },
      { title: "Compact Mode", value: d?.theme?.compact_mode ? "On" : "Off", tone: d?.theme?.compact_mode ? "green" : "amber", icon: <Sparkles size={16} /> },
      { title: "Dashboard Cards", value: String(Number(d?.dashboard_display?.cards_per_row_reports || 0)), tone: "sky", icon: <LayoutDashboard size={16} /> },
      { title: "POS Page Size", value: String(Number(d?.pos_display?.products_per_page_pos_grid || 0)), tone: "violet", icon: <ShoppingCart size={16} /> },
      { title: "Table Density", value: d?.table_display?.table_density || "Compact", tone: "amber", icon: <Table2 size={16} /> },
      { title: "Date Format", value: d?.number_date_display?.date_format || "DD/MM/YYYY", tone: "indigo", icon: <CalendarDays size={16} /> },
    ];
  }, [sectionValue]);

  const sections = [
    {
      id: "theme",
      label: "Theme",
      icon: Palette,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Color theme</span>
            <Select value={data.theme.color_theme || "Dark"} onChange={(e) => updatePath("theme.color_theme", e.target.value)}>
              <option>Dark</option>
              <option>Light</option>
              <option>System</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Accent color</span>
            <div className="flex gap-2">
              <input type="color" className="h-10 w-12 rounded-md border border-white/10 bg-slate-900" value={data.theme.accent_color || "#6c63ff"} onChange={(e) => updatePath("theme.accent_color", e.target.value)} />
              <Input value={data.theme.accent_color || "#6c63ff"} onChange={(e) => updatePath("theme.accent_color", e.target.value)} />
            </div>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sidebar style</span>
            <Select value={data.theme.sidebar_style || "Full labels"} onChange={(e) => updatePath("theme.sidebar_style", e.target.value)}>
              <option>Full labels</option>
              <option>Collapsed icons</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sidebar position</span>
            <Select value={data.theme.sidebar_position || "Left"} onChange={(e) => updatePath("theme.sidebar_position", e.target.value)}>
              <option>Left</option>
              <option>Right</option>
            </Select>
          </label>
          <RowToggle label="Compact mode" checked={data.theme.compact_mode} onChange={(v) => updatePath("theme.compact_mode", v)} />
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Animation speed</span>
            <Select value={data.theme.animation_speed || "Normal"} onChange={(e) => updatePath("theme.animation_speed", e.target.value)}>
              <option>Slow</option>
              <option>Normal</option>
              <option>Fast</option>
              <option>Off</option>
            </Select>
          </label>
        </div>
      ),
    },
    {
      id: "dashboard",
      label: "Dashboard Display",
      icon: LayoutDashboard,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Default date range</span>
            <Select value={data.dashboard_display.default_date_range_on_load || "Today"} onChange={(e) => updatePath("dashboard_display.default_date_range_on_load", e.target.value)}>
              <option>Today</option>
              <option>This Week</option>
              <option>This Month</option>
            </Select>
          </label>
          <NumberField label="Cards per row (reports)" value={data.dashboard_display.cards_per_row_reports} onChange={(v) => updatePath("dashboard_display.cards_per_row_reports", v)} />
          <RowToggle label="Show quick action tiles" checked={data.dashboard_display.show_quick_action_tiles} onChange={(v) => updatePath("dashboard_display.show_quick_action_tiles", v)} />
          <RowToggle label="Show low stock alerts widget" checked={data.dashboard_display.show_low_stock_alerts_on_dashboard} onChange={(v) => updatePath("dashboard_display.show_low_stock_alerts_on_dashboard", v)} />
          <RowToggle label="Show pending repairs widget" checked={data.dashboard_display.show_pending_repairs_widget} onChange={(v) => updatePath("dashboard_display.show_pending_repairs_widget", v)} />
          <RowToggle label="Show outstanding balance widget" checked={data.dashboard_display.show_outstanding_balance_widget} onChange={(v) => updatePath("dashboard_display.show_outstanding_balance_widget", v)} />
        </div>
      ),
    },
    {
      id: "pos",
      label: "POS Display",
      icon: ShoppingCart,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <RowToggle label="Show product images" checked={data.pos_display.show_product_images_in_pos} onChange={(v) => updatePath("pos_display.show_product_images_in_pos", v)} />
          <NumberField label="Products per page (grid)" value={data.pos_display.products_per_page_pos_grid} onChange={(v) => updatePath("pos_display.products_per_page_pos_grid", v)} />
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Default POS view</span>
            <Select value={data.pos_display.default_pos_view || "Grid"} onChange={(e) => updatePath("pos_display.default_pos_view", e.target.value)}>
              <option>Grid</option>
              <option>List</option>
            </Select>
          </label>
          <RowToggle label="Show stock qty in POS" checked={data.pos_display.show_stock_qty_in_pos} onChange={(v) => updatePath("pos_display.show_stock_qty_in_pos", v)} />
          <NumberField label="Warn when stock below" value={data.pos_display.warn_when_stock_below} onChange={(v) => updatePath("pos_display.warn_when_stock_below", v)} suffix="units" />
          <RowToggle label="Show customer balance at checkout" checked={data.pos_display.show_customer_balance_at_checkout} onChange={(v) => updatePath("pos_display.show_customer_balance_at_checkout", v)} />
          <RowToggle label="Calculator widget at POS" checked={data.pos_display.calculator_widget_at_pos} onChange={(v) => updatePath("pos_display.calculator_widget_at_pos", v)} />
        </div>
      ),
    },
    {
      id: "table",
      label: "Table Display",
      icon: Table2,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <NumberField label="Rows per page (default)" value={data.table_display.rows_per_page_default} onChange={(v) => updatePath("table_display.rows_per_page_default", v)} />
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Table density</span>
            <Select value={data.table_display.table_density || "Compact"} onChange={(e) => updatePath("table_display.table_density", e.target.value)}>
              <option>Compact</option>
              <option>Normal</option>
              <option>Comfortable</option>
            </Select>
          </label>
          <RowToggle label="Sticky table headers" checked={data.table_display.sticky_table_headers} onChange={(v) => updatePath("table_display.sticky_table_headers", v)} />
          <RowToggle label="Show row numbers" checked={data.table_display.show_row_numbers} onChange={(v) => updatePath("table_display.show_row_numbers", v)} />
          <RowToggle label="Highlight overdue rows" checked={data.table_display.highlight_overdue_rows} onChange={(v) => updatePath("table_display.highlight_overdue_rows", v)} />
        </div>
      ),
    },
    {
      id: "number_date",
      label: "Number & Date Display",
      icon: CalendarDays,
      render: ({ data, updatePath }) => (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Date format</span>
            <Select value={data.number_date_display.date_format || "DD/MM/YYYY"} onChange={(e) => updatePath("number_date_display.date_format", e.target.value)}>
              <option>DD/MM/YYYY</option>
              <option>YYYY-MM-DD</option>
              <option>MM/DD/YYYY</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Time format</span>
            <Select value={data.number_date_display.time_format || "12-hour"} onChange={(e) => updatePath("number_date_display.time_format", e.target.value)}>
              <option>12-hour</option>
              <option>24-hour</option>
            </Select>
          </label>
          <Input value={data.number_date_display.currency_display || ""} onChange={(e) => updatePath("number_date_display.currency_display", e.target.value)} />
          <Input value={data.number_date_display.large_number_format || ""} onChange={(e) => updatePath("number_date_display.large_number_format", e.target.value)} />
          <Input value={data.number_date_display.negative_numbers_format || ""} onChange={(e) => updatePath("number_date_display.negative_numbers_format", e.target.value)} />
        </div>
      ),
    },
  ];

  const sidePreview = ({ data }) => {
    const isDark = String(data.theme.color_theme || "Dark").toLowerCase().includes("dark");
    const bg = isDark ? "#0f172a" : "#f8fafc";
    const cardBg = isDark ? "#1e293b" : "#ffffff";
    const text = isDark ? "#e2e8f0" : "#0f172a";
    const accent = data.theme.accent_color || "#6c63ff";
    return (
      <SectionCard title="Theme Preview">
        <div className="rounded-xl border border-white/10 p-3" style={{ background: bg, color: text }}>
          <div className="rounded-lg p-2 mb-2" style={{ background: cardBg }}>
            <p className="text-xs font-bold">Dashboard Card</p>
            <p className="text-[11px] opacity-80">Accent: {accent}</p>
            <div className="h-1.5 rounded mt-2" style={{ background: accent }} />
          </div>
          <div className="rounded-lg p-2" style={{ background: cardBg }}>
            <p className="text-xs font-bold">Table Row Sample</p>
            <div className="flex items-center justify-between mt-1 text-[11px]">
              <span>INV-00032</span>
              <Badge tone={data.table_display.highlight_overdue_rows ? "red" : "slate"}>{data.table_display.highlight_overdue_rows ? "Overdue" : "Normal"}</Badge>
            </div>
          </div>
        </div>
      </SectionCard>
    );
  };

  return (
    <SettingsSectionShell
      title="Appearance & Display"
      subtitle="Theme, dashboard widgets, POS visuals, table density, and date/number formatting."
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


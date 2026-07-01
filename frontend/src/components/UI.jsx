import { Children, forwardRef, isValidElement } from "react";
import { FormControl, MenuItem, Select as MuiSelect } from "@mui/material";

export function PageTitle({ title, subtitle, action, className = "" }) {
  return <div className={cx("flex min-w-0 items-start justify-between gap-3", className)}>
    <div className="min-w-0">
      <h1 className="truncate text-2xl font-black tracking-tight text-white xl:text-3xl">{title}</h1>
      {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-400">{subtitle}</p>}
    </div>
    {action ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{action}</div> : null}
  </div>;
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
  actions,
  meta,
  className = "",
  compact = false,
  sticky = false,
}) {
  const headerAction = actions || action;
  return (
    <header
      className={cx(
        "flex min-w-0 shrink-0 flex-wrap items-end justify-between gap-3",
        sticky ? "sticky top-0 z-20 rounded-2xl border border-white/10 bg-slate-950/85 p-3 backdrop-blur-xl" : "",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{eyebrow}</p> : null}
        <h1 className={cx("truncate font-black tracking-tight text-white", compact ? "text-lg xl:text-xl" : "text-xl xl:text-2xl")}>{title}</h1>
        {subtitle ? <p className={cx("mt-1 max-w-3xl text-slate-400", compact ? "text-xs" : "text-xs xl:text-sm")}>{subtitle}</p> : null}
        {meta ? <div className="mt-2 flex flex-wrap gap-2">{meta}</div> : null}
      </div>
      {headerAction ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{headerAction}</div> : null}
    </header>
  );
}

export function PageContainer({
  children,
  className = "",
  compact = false,
  scroll = false,
  padded = false,
  as: Component = "div",
}) {
  return (
    <Component
      className={cx(
        "flex min-h-0 min-w-0 max-w-full flex-col",
        compact ? "gap-3 text-sm" : "gap-4",
        scroll ? "overflow-y-auto overflow-x-hidden custom-scrollbar" : "",
        padded ? "p-3 md:p-4" : "pb-4",
        className,
      )}
    >
      {children}
    </Component>
  );
}

export function FilterToolbar({
  children,
  right,
  className = "",
  compact = false,
  sticky = false,
  ariaLabel = "Filter toolbar",
}) {
  return (
    <div
      className={cx(
        "app-filter-toolbar rounded-2xl border border-white/10 bg-slate-900/50",
        compact ? "p-2" : "p-2.5",
        sticky ? "sticky top-0 z-20 backdrop-blur-xl" : "",
        className,
      )}
      role="search"
      aria-label={ariaLabel}
    >
      <div className="flex min-w-[220px] flex-1 flex-wrap items-center gap-2">{children}</div>
      {right ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{right}</div> : null}
    </div>
  );
}

export function StatCard({ title, value, tone = "white", children }) {
  const toneClass =
    tone === "sky" ? "text-sky-300"
    : tone === "green" ? "text-emerald-300"
    : tone === "amber" ? "text-amber-300"
    : tone === "red" ? "text-rose-300"
    : "text-white";

  return (
    <div className="panel p-5">
      <p className="text-slate-400 text-xs uppercase tracking-widest">{title}</p>
      {children ?? <p className={`text-4xl font-bold mt-3 ${toneClass}`}>{value}</p>}
    </div>
  );
}

export function KpiCard({
  title,
  value,
  hint,
  icon,
  tone = "sky", // sky | green | amber | red | indigo | violet
  className = "",
}) {
  const toneClass =
    tone === "green" ? "kpi kpi-green"
    : tone === "amber" ? "kpi kpi-amber"
    : tone === "red" ? "kpi kpi-red"
    : tone === "indigo" ? "kpi kpi-indigo"
    : tone === "violet" ? "kpi kpi-violet"
    : "kpi kpi-sky";

  return (
    <div className={`${toneClass} ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-slate-500 dark:text-slate-300/75 uppercase tracking-[.18em]">{title}</p>
          <p className="mt-2 text-2xl font-extrabold text-slate-900 dark:text-white truncate">{value}</p>
          {hint && <p className="mt-2 text-xs text-slate-400 dark:text-slate-300/70">{hint}</p>}
        </div>
        {icon && (
          <div className="kpi-icon">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

export function SectionCard({
  title,
  subtitle,
  right,
  children,
  className = "",
  bodyClassName = "",
  headerClassName = "",
  footer = null,
  compact = false,
  noPadding = false,
  role,
}) {
  const paddingClass = noPadding ? "" : compact ? "p-3" : "p-4 xl:p-5";
  return <section className={cx("panel min-w-0 overflow-hidden", paddingClass, className)} role={role}>
    {(title || right) && <div className={cx("mb-3 flex min-w-0 items-start justify-between gap-3", headerClassName)}>
      {title ? (
        <div className="min-w-0">
          <h3 className={cx("truncate font-bold text-slate-900 dark:text-white", compact ? "text-sm" : "text-base xl:text-lg")}>{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
        </div>
      ) : <span />}
      {right ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{right}</div> : null}
    </div>}
    <div className={cx("min-h-0 min-w-0 flex-1", bodyClassName)}>{children}</div>
    {footer ? <div className="mt-3 border-t border-white/10 pt-3">{footer}</div> : null}
  </section>;
}

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  children,
  className = "",
  variant = "primary",
  size = "md",
  ...props
}) {
  const variantClass =
    variant === "secondary" ? "btn-secondary"
    : variant === "danger" ? "btn-danger"
    : variant === "warning" ? "btn-warning"
    : variant === "success" ? "btn-success"
    : variant === "approval-required" ? "btn-warning"
    : variant === "disabled-permission" ? "btn-disabled-permission"
    : variant === "ghost" ? "btn-ghost"
    : "btn-primary";

  const sizeClass =
    size === "sm" ? "btn-sm"
    : size === "lg" ? "btn-lg"
    : "btn-md";

  return (
    <button className={cx("btn", variantClass, sizeClass, className)} {...props}>
      {children}
    </button>
  );
}

export const Input = forwardRef(function Input({ className = "", ...props }, ref) {
  return <input ref={ref} className={cx("field", className)} {...props} />;
});

function textFromNode(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (isValidElement(node)) return textFromNode(node.props.children);
  return "";
}

function optionsFromChildren(children) {
  const parsed = [];
  const parseOptionNode = (node, groupLabel = "") => {
    const labelText = textFromNode(node?.props?.children).trim();
    const value = node?.props?.value ?? labelText;
    const resolvedLabel = labelText || String(value);
    const label = groupLabel ? `${groupLabel}: ${resolvedLabel}` : resolvedLabel;
    parsed.push({ value, label, disabled: Boolean(node?.props?.disabled) });
  };

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === "option") {
      parseOptionNode(child);
      return;
    }
    if (child.type === "optgroup") {
      const groupLabel = textFromNode(child.props.label).trim();
      Children.forEach(child.props.children, (opt) => {
        if (!isValidElement(opt) || opt.type !== "option") return;
        parseOptionNode(opt, groupLabel);
      });
    }
  });
  return parsed;
}

const APP_SELECT_SIZE_MAP = {
  sm: {
    formControlSize: "small",
    minHeight: 36,
    fontSize: "0.75rem",
    itemFontSize: "0.75rem",
    itemMinHeight: 30,
    selectPaddingY: "7px",
    selectPaddingX: "10px",
  },
  md: {
    formControlSize: "small",
    minHeight: 40,
    fontSize: "0.75rem",
    itemFontSize: "0.75rem",
    itemMinHeight: 32,
    selectPaddingY: "9px",
    selectPaddingX: "11px",
  },
  lg: {
    formControlSize: "medium",
    minHeight: 44,
    fontSize: "0.8125rem",
    itemFontSize: "0.8125rem",
    itemMinHeight: 34,
    selectPaddingY: "10px",
    selectPaddingX: "12px",
  },
};

function resolveSelectSize(size) {
  if (size === "small") return APP_SELECT_SIZE_MAP.sm;
  if (size === "medium") return APP_SELECT_SIZE_MAP.md;
  return APP_SELECT_SIZE_MAP[size] || APP_SELECT_SIZE_MAP.md;
}

function inferSizeFromClassName(className = "") {
  const cls = String(className);
  if (cls.includes("h-9") || cls.includes("!py-1") || cls.includes("!text-xs")) return "sm";
  if (cls.includes("h-11") || cls.includes("text-sm")) return "lg";
  return "md";
}

export function Select({
  className = "",
  children,
  options,
  placeholder,
  size,
  minWidth,
  maxWidth,
  fullWidth = true,
  disabled = false,
  sx = {},
  menuPaperSx = {},
  menuProps = {},
  ...props
}) {
  const resolvedOptions = options ?? optionsFromChildren(children);
  const resolvedSize = size || inferSizeFromClassName(className);
  const normalizedClassName = className
    .split(" ")
    .filter((token) => token && token !== "field")
    .join(" ");

  return (
    <AppSelect
      className={normalizedClassName}
      value={props.value}
      onChange={props.onChange}
      options={resolvedOptions}
      placeholder={placeholder ?? null}
      size={resolvedSize}
      minWidth={minWidth}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      disabled={disabled}
      sx={sx}
      menuPaperSx={menuPaperSx}
      menuProps={menuProps}
      {...props}
    />
  );
}

const APP_SELECT_INPUT_SX = {
  borderRadius: "12px",
  background: "rgba(15, 23, 42, 0.92)",
  color: "#e2e8f0",
  fontWeight: 600,
  letterSpacing: "0.01em",
  "& fieldset": {
    borderColor: "rgba(148, 163, 184, 0.2)",
  },
  "&:hover fieldset": {
    borderColor: "rgba(129, 140, 248, 0.45)",
  },
  "&.Mui-focused fieldset": {
    borderColor: "rgba(129, 140, 248, 0.75)",
    boxShadow: "0 0 0 3px rgba(79, 70, 229, 0.16)",
  },
};

const APP_SELECT_MENU_PAPER_SX = {
  mt: 1,
  background: "linear-gradient(165deg, rgba(8, 13, 30, 0.98), rgba(8, 14, 34, 0.97))",
  color: "#e2e8f0",
  border: "1px solid rgba(129, 140, 248, 0.25)",
  borderRadius: "12px",
  boxShadow: "0 18px 36px rgba(2, 6, 23, 0.55)",
  backdropFilter: "blur(12px)",
  maxHeight: 340,
  "& .MuiMenuItem-root": {
    fontWeight: 600,
    color: "#e2e8f0",
  },
  "& .MuiMenuItem-root:hover": {
    backgroundColor: "rgba(99, 102, 241, 0.18)",
  },
  "& .MuiMenuItem-root.Mui-selected": {
    backgroundColor: "rgba(79, 70, 229, 0.28)",
    color: "#e0e7ff",
  },
  "& .MuiMenuItem-root.Mui-selected:hover": {
    backgroundColor: "rgba(79, 70, 229, 0.36)",
  },
};

export function AppSelect({
  value,
  onChange,
  options = [],
  placeholder = null,
  className = "",
  size = "md",
  minWidth = 160,
  maxWidth,
  fullWidth = false,
  disabled = false,
  sx = {},
  menuPaperSx = {},
  menuProps = {},
  selectSx = {},
  ...selectProps
}) {
  const sizeConfig = resolveSelectSize(size);
  const labelByValue = new Map(
    options.map((opt) =>
      typeof opt === "string" || typeof opt === "number"
        ? [String(opt), String(opt)]
        : [String(opt?.value ?? ""), String(opt?.label ?? opt?.value ?? "")]
    )
  );

  return (
    <FormControl
      size={sizeConfig.formControlSize}
      fullWidth={fullWidth}
      disabled={disabled}
      className={className}
      sx={{ minWidth, maxWidth, ...sx }}
    >
      <MuiSelect
        value={value ?? ""}
        onChange={onChange}
        displayEmpty
        {...selectProps}
        renderValue={(selected) => {
          const normalized = String(selected ?? "");
          if (!normalized && placeholder !== null) {
            return <span style={{ color: "#94a3b8" }}>{placeholder}</span>;
          }
          return labelByValue.get(normalized) ?? normalized;
        }}
        sx={{
          ...APP_SELECT_INPUT_SX,
          minHeight: sizeConfig.minHeight,
          fontSize: sizeConfig.fontSize,
          "& .MuiSelect-select": {
            py: sizeConfig.selectPaddingY,
            pr: "34px",
            pl: sizeConfig.selectPaddingX,
            display: "flex",
            alignItems: "center",
          },
          "& .MuiSvgIcon-root": { color: "#cbd5e1" },
          ...selectSx,
        }}
        MenuProps={{
          ...menuProps,
          PaperProps: {
            ...(menuProps.PaperProps || {}),
            sx: {
              ...APP_SELECT_MENU_PAPER_SX,
              "& .MuiMenuItem-root": {
                ...(APP_SELECT_MENU_PAPER_SX["& .MuiMenuItem-root"] || {}),
                fontSize: sizeConfig.itemFontSize,
                minHeight: sizeConfig.itemMinHeight,
              },
              ...menuProps?.PaperProps?.sx,
              ...menuPaperSx,
            },
          },
        }}
      >
        {placeholder !== null && (
          <MenuItem value="">
            {placeholder}
          </MenuItem>
        )}
        {options.map((opt) => {
          if (typeof opt === "string" || typeof opt === "number") {
            return (
              <MenuItem key={String(opt)} value={opt}>
                {String(opt)}
              </MenuItem>
            );
          }
          const optionValue = opt?.value ?? "";
          const optionLabel = opt?.label ?? String(optionValue);
          const optionDisabled = Boolean(opt?.disabled);
          return (
            <MenuItem key={String(optionValue)} value={optionValue} disabled={optionDisabled}>
              {optionLabel}
            </MenuItem>
          );
        })}
      </MuiSelect>
    </FormControl>
  );
}

export function Badge({ children, className = "", tone = "slate" }) {
  const toneClass =
    tone === "green" ? "badge badge-green"
    : tone === "red" ? "badge badge-red"
    : tone === "amber" ? "badge badge-amber"
    : tone === "sky" ? "badge badge-sky"
    : tone === "indigo" ? "badge badge-indigo"
    : "badge badge-slate";
  return <span className={cx(toneClass, className)}>{children}</span>;
}

function normalizeStatusKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function titleFromStatus(value) {
  const raw = String(value || "").trim();
  if (!raw) return "Unknown";
  return raw
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

const STATUS_BADGE_META = {
  repair: {
    pending: { label: "Pending", tone: "amber" },
    diagnosing: { label: "Diagnosing", tone: "sky" },
    waiting_for_parts: { label: "Waiting for Parts", tone: "amber" },
    repairing: { label: "Repairing", tone: "indigo" },
    quality_checking: { label: "Quality Checking", tone: "sky" },
    completed: { label: "Completed", tone: "green" },
    delivered: { label: "Delivered", tone: "green" },
    cancelled: { label: "Cancelled", tone: "red" },
  },
  payment: {
    unpaid: { label: "Unpaid", tone: "red" },
    partial: { label: "Partial", tone: "amber" },
    paid: { label: "Paid", tone: "green" },
    refunded: { label: "Refunded", tone: "sky" },
    cancelled: { label: "Cancelled", tone: "red" },
  },
  warranty: {
    active: { label: "Active", tone: "green" },
    expiring: { label: "Expiring", tone: "amber" },
    expired: { label: "Expired", tone: "red" },
    claimed: { label: "Claimed", tone: "indigo" },
    rejected: { label: "Rejected", tone: "red" },
    replaced: { label: "Replaced", tone: "indigo" },
    voided: { label: "Voided", tone: "red" },
    pending_inspection: { label: "Pending Inspection", tone: "amber" },
    under_review: { label: "Under Review", tone: "sky" },
    waiting_parts: { label: "Waiting Parts", tone: "indigo" },
    resolved: { label: "Resolved", tone: "green" },
    repaired: { label: "Repaired", tone: "sky" },
  },
  return: {
    pending: { label: "Pending", tone: "amber" },
    inspected: { label: "Inspected", tone: "sky" },
    approved: { label: "Approved", tone: "green" },
    rejected: { label: "Rejected", tone: "red" },
    refunded: { label: "Refunded", tone: "green" },
    exchanged: { label: "Exchanged", tone: "sky" },
    closed: { label: "Closed", tone: "slate" },
    cancelled: { label: "Cancelled", tone: "red" },
  },
  inventory: {
    in_stock: { label: "In Stock", tone: "green" },
    low_stock: { label: "Low Stock", tone: "amber" },
    out_of_stock: { label: "Out of Stock", tone: "red" },
    reserved: { label: "Reserved", tone: "indigo" },
    damaged: { label: "Damaged", tone: "red" },
  },
};

const STATUS_ALIASES = {
  in_progress: "repairing",
  waiting_parts: "waiting_for_parts",
  waiting_for_part: "waiting_for_parts",
  quality_check: "quality_checking",
  canceled: "cancelled",
  complete: "completed",
  partially_paid: "partial",
  part_paid: "partial",
  active_warranty: "active",
  expiring_soon: "expiring",
  pending_review: "under_review",
  out: "out_of_stock",
  low: "low_stock",
  available: "in_stock",
};

const STATUS_TONE_ALIASES = {
  critical: "red",
  high: "red",
  danger: "red",
  error: "red",
  medium: "amber",
  warning: "amber",
  low: "sky",
  info: "sky",
  success: "green",
};

export function getStatusBadgeMeta(status, domain = "generic") {
  const normalizedDomain = normalizeStatusKey(domain || "generic");
  const rawKey = normalizeStatusKey(status);
  const key = STATUS_ALIASES[rawKey] || rawKey;
  const meta = STATUS_BADGE_META[normalizedDomain]?.[key];
  if (meta) return { ...meta, key, domain: normalizedDomain };

  const fallbackDomain = Object.keys(STATUS_BADGE_META).find((domainKey) => STATUS_BADGE_META[domainKey]?.[key]);
  if (fallbackDomain) {
    return { ...STATUS_BADGE_META[fallbackDomain][key], key, domain: fallbackDomain };
  }

  const genericTone =
    key.includes("cancel") || key.includes("reject") || key.includes("void") || key.includes("out") || key.includes("expired")
      ? "red"
      : key.includes("pending") || key.includes("partial") || key.includes("wait") || key.includes("low")
      ? "amber"
      : key.includes("paid") || key.includes("active") || key.includes("complete") || key.includes("approve") || key.includes("delivered")
      ? "green"
      : key.includes("claim") || key.includes("repair") || key.includes("reserved")
      ? "indigo"
      : "slate";

  return {
    key,
    domain: normalizedDomain,
    label: titleFromStatus(status),
    tone: genericTone,
  };
}

export function StatusBadge({ status, domain = "generic", label, tone, className = "", showDot = true }) {
  const meta = getStatusBadgeMeta(status, domain);
  const normalizedTone = normalizeStatusKey(tone);
  const displayTone = STATUS_TONE_ALIASES[normalizedTone] || normalizedTone || meta.tone;
  return (
    <Badge tone={displayTone} className={cx("status-badge", className)}>
      {showDot ? <span className="status-badge-dot" aria-hidden="true" /> : null}
      {label || meta.label}
    </Badge>
  );
}

const SENSITIVE_ACTIONS = {
  approval: { label: "Approval Required", tone: "amber" },
  permission: { label: "Permission Required", tone: "red" },
  period: { label: "Period Locked", tone: "red" },
  audit: { label: "Audit Logged", tone: "sky" },
  owner: { label: "Owner Only", tone: "amber" },
  manager: { label: "Manager Approval Needed", tone: "amber" },
  print: { label: "Print Controlled", tone: "indigo" },
};

export function SensitiveActionBadge({ type = "audit", label, className = "" }) {
  const cfg = SENSITIVE_ACTIONS[type] || SENSITIVE_ACTIONS.audit;
  return <Badge tone={cfg.tone} className={className}>{label || cfg.label}</Badge>;
}

export function SensitiveActionIndicators({ items = ["approval", "audit"], className = "" }) {
  const clean = (items || []).filter(Boolean);
  if (!clean.length) return null;
  return (
    <div className={cx("flex flex-wrap items-center gap-1.5", className)}>
      {clean.map((item) => {
        if (typeof item === "string") return <SensitiveActionBadge key={item} type={item} />;
        return <SensitiveActionBadge key={`${item.type}-${item.label}`} type={item.type} label={item.label} />;
      })}
    </div>
  );
}

export function PeriodLockBanner({
  locked = false,
  periodName = "Current accounting period",
  reason = "",
  className = "",
}) {
  if (!locked) return null;
  return (
    <WorkstationNotice
      tone="red"
      title={`${periodName} is closed`}
      text={reason || "Financial changes, refunds, voids, and stock-value adjustments require dedicated approval before they can continue."}
      right={<SensitiveActionIndicators items={["period", "approval", "audit"]} />}
      className={className}
    />
  );
}

export function Table({ className = "", ...props }) {
  return <table className={cx("table", className)} {...props} />;
}

export function AppTableShell({
  children,
  minWidth = 760,
  className = "",
  innerClassName = "",
  maxHeightClass = "",
  "aria-label": ariaLabel,
}) {
  const width = typeof minWidth === "number" ? `${minWidth}px` : minWidth;
  return (
    <div
      className={cx("app-table-viewport min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain custom-scrollbar", maxHeightClass, className)}
      role="region"
      aria-label={ariaLabel || "Scrollable data table"}
      tabIndex={0}
    >
      <table className={cx("w-full text-left text-xs", innerClassName)} style={{ minWidth: width }}>
        {children}
      </table>
    </div>
  );
}

export function AppTableHead({ children, className = "" }) {
  return (
    <thead className={cx("sticky top-0 z-10 border-b border-white/10 bg-slate-950/95 text-[10px] uppercase tracking-widest text-slate-500", className)}>
      {children}
    </thead>
  );
}

export function AppTableEmptyRow({ colSpan, title = "No records found", text = "", className = "" }) {
  return (
    <tr>
      <td colSpan={colSpan} className={cx("p-4", className)}>
        <EmptyState title={title} text={text} />
      </td>
    </tr>
  );
}

export function Loading({ text = "Loading...", className = "", compact = false }) {
  return (
    <div
      className={cx("grid place-items-center rounded-2xl border border-white/10 bg-slate-900/40 text-sm text-slate-300", compact ? "min-h-[96px]" : "min-h-[180px]", className)}
      role="status"
      aria-busy="true"
    >
      <div className="text-center">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-indigo-400/70 border-t-transparent" />
        <p>{text}</p>
      </div>
    </div>
  );
}

export function EmptyState({
  title = "No records found",
  text = "There is nothing to show for the current filters.",
  action = null,
  className = "",
  compact = false,
  icon = null,
}) {
  return (
    <div className={cx("rounded-2xl border border-dashed border-white/15 bg-black/20 px-4 text-center", compact ? "py-4" : "py-8", className)}>
      {icon ? <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-slate-300">{icon}</div> : null}
      <p className="text-sm font-bold text-slate-200">{title}</p>
      {text ? <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">{text}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  text = "Please try again or check the backend connection.",
  action = null,
  className = "",
  compact = false,
}) {
  return (
    <div
      className={cx("rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 text-sm text-rose-100", compact ? "py-3" : "py-4", className)}
      role="alert"
    >
      <p className="font-semibold">{title}</p>
      {text ? <p className="mt-1 text-xs leading-5 text-rose-100/80">{text}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function WorkstationNotice({ tone = "amber", title, text, right, className = "" }) {
  const toneClass =
    tone === "green" ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
    : tone === "red" ? "border-rose-400/30 bg-rose-500/10 text-rose-100"
    : tone === "sky" ? "border-sky-400/30 bg-sky-500/10 text-sky-100"
    : "border-amber-400/30 bg-amber-500/10 text-amber-100";
  return (
    <div className={cx("flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3", toneClass, className)}>
      <div className="min-w-0">
        {title ? <p className="text-sm font-bold">{title}</p> : null}
        {text ? <p className="mt-0.5 text-xs opacity-85">{text}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function AppDrawer({ title, subtitle, action, children, onClose, className = "" }) {
  return (
    <aside className={cx("flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 shadow-2xl", className)}>
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 p-4">
        <div className="min-w-0">
          <h3 className="truncate text-base font-black text-white">{title}</h3>
          {subtitle ? <p className="mt-1 text-xs text-slate-400">{subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {onClose ? (
            <button type="button" onClick={onClose} className="rounded-lg border border-white/10 px-2 py-1 text-xs font-bold text-slate-300 hover:text-white">
              Close
            </button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 custom-scrollbar">{children}</div>
    </aside>
  );
}

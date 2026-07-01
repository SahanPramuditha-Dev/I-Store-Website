import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

export default function AppDrawer({
  open,
  onClose,
  children,
  className = "",
  panelClassName = "",
  side = "right",
  title = "",
  subtitle = "",
  headerActions = null,
  footer = null,
  closeOnEscape = true,
}) {
  const panelRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const node = panelRef.current;
    const focusable = node?.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus?.();

    const onKeyDown = (event) => {
      if (event.key === "Escape" && closeOnEscape) {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const items = Array.from(
        node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      ).filter((item) => !item.disabled && item.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, [closeOnEscape, onClose, open]);

  if (!open) return null;

  const alignClass = side === "left" ? "justify-start" : "justify-end";

  return (
    <div className={cx("fixed inset-0 z-[120] flex", alignClass, className)}>
      <button type="button" className="flex-1 bg-black/55 backdrop-blur-sm" onClick={onClose} aria-label="Close drawer" disabled={!onClose} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Drawer"}
        className={cx(
          "h-full w-full max-w-[calc(100vw-1rem)] border-white/10 bg-slate-950 shadow-2xl overflow-hidden flex flex-col",
          side === "left" ? "border-r sm:max-w-lg" : "border-l sm:max-w-xl",
          panelClassName,
        )}
      >
        {(title || subtitle || headerActions) ? (
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
            <div className="min-w-0">
              {title ? <h3 id={titleId} className="truncate text-base font-bold text-white">{title}</h3> : null}
              {subtitle ? <p className="mt-1 text-xs text-slate-400">{subtitle}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {headerActions}
              {onClose ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400/60"
                  aria-label="Close drawer"
                >
                  <X size={15} />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">{children}</div>
        {footer ? <div className="app-sticky-actions shrink-0 p-4">{footer}</div> : null}
      </aside>
    </div>
  );
}

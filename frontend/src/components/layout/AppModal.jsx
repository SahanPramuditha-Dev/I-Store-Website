import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

export default function AppModal({
  open,
  onClose,
  children,
  className = "",
  panelClassName = "",
  title = "",
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

  return (
    <div className={cx("fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm", className)} onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Dialog"}
        className={cx(
          "flex w-full max-w-2xl max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl",
          panelClassName,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        {(title || headerActions || onClose) && (
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            {title ? (
              <h3 id={titleId} className="min-w-0 truncate text-base font-bold text-white">{title}</h3>
            ) : (
              <span className="min-w-0 text-base font-bold text-white">Dialog</span>
            )}
            <div className="flex shrink-0 items-center gap-2">
              {headerActions}
              {onClose ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400/60"
                  aria-label="Close dialog"
                >
                  <X size={15} />
                </button>
              ) : null}
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">{children}</div>
        {footer ? <div className="app-sticky-actions shrink-0 p-4">{footer}</div> : null}
      </div>
    </div>
  );
}

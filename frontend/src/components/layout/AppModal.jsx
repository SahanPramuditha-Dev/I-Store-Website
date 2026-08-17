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
  const titleIsNode = title !== null && typeof title === "object";

  const pointerStartedInsideRef = useRef(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const node = panelRef.current;
    const content = node?.querySelector("[data-modal-content]");
    const focusable =
      content?.querySelector(
        '[data-modal-initial-focus], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ) ||
      node?.querySelector(
        '[data-modal-initial-focus], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );

    if (!node?.contains(document.activeElement)) {
      focusable?.focus?.();
    }

    return () => {
      if (previous && typeof previous.focus === "function") {
        previous.focus();
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const node = panelRef.current;

    const onKeyDown = (event) => {
      if (event.key === "Escape" && closeOnEscape) {
        event.preventDefault();
        onCloseRef.current?.();
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
    };
  }, [closeOnEscape, open]);

  if (!open) return null;

  return (
    <div
      className={cx("fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm", className)}
      onPointerUp={(event) => {
        // Only close when pointer up happens directly on the overlay (not the panel),
        // and the pointer DID NOT start inside the panel. This avoids closing the
        // modal when the user selects text or drags from inside the modal to outside.
        if (event.target === event.currentTarget && !pointerStartedInsideRef.current) {
          onClose?.();
        }
        pointerStartedInsideRef.current = false;
      }}
    >
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
        onPointerDown={() => {
          // Mark that a pointer interaction started inside the panel so an eventual
          // pointerup outside the panel (e.g., from a drag/selection) won't trigger close.
          pointerStartedInsideRef.current = true;
        }}
      >
        {(title || headerActions || onClose) && (
          <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0 flex-1">
              {title ? (
                titleIsNode ? (
                  <div id={titleId}>{title}</div>
                ) : (
                  <h3 id={titleId} className="min-w-0 truncate text-base font-bold text-white">
                    {title}
                  </h3>
                )
              ) : null}
            </div>
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
        <div data-modal-content className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">{children}</div>
        {footer ? <div className="app-sticky-actions shrink-0 p-4">{footer}</div> : null}
      </div>
    </div>
  );
}

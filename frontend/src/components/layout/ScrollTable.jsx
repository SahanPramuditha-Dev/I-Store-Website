function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

export default function ScrollTable({
  children,
  className = "",
  contentClassName = "",
  maxHeightClass = "max-h-[70vh]",
  minWidth = "max-content",
  ariaLabel = "Scrollable table",
}) {
  return (
    <div
      className={cx(
        "min-w-0 overflow-x-auto overflow-y-auto overscroll-contain custom-scrollbar rounded-xl border border-white/10 bg-black/20 focus:outline-none focus:ring-2 focus:ring-indigo-400/35",
        maxHeightClass,
        className,
      )}
      role="region"
      aria-label={ariaLabel}
      tabIndex={0}
    >
      <div className={cx("min-w-max", contentClassName)} style={{ minWidth }}>
        {children}
      </div>
    </div>
  );
}

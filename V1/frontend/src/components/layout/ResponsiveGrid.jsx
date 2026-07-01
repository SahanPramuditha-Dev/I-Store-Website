function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

export default function ResponsiveGrid({
  children,
  className = "",
  colsClass = "grid-cols-1 md:grid-cols-2 xl:grid-cols-4",
  gapClass = "gap-3",
  minItemWidth = null,
  align = "stretch",
}) {
  const style = minItemWidth
    ? { gridTemplateColumns: `repeat(auto-fit, minmax(min(${minItemWidth}, 100%), 1fr))` }
    : undefined;

  return (
    <div
      className={cx(
        "grid min-w-0",
        minItemWidth ? "" : colsClass,
        gapClass,
        align === "start" ? "items-start" : align === "center" ? "items-center" : "items-stretch",
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

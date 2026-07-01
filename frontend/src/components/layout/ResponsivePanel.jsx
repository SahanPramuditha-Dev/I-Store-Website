function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

export default function ResponsivePanel({
  children,
  className = "",
  padded = true,
}) {
  return (
    <section
      className={cx(
        "min-h-0 min-w-0 rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-md",
        padded ? "p-4" : "",
        className,
      )}
    >
      {children}
    </section>
  );
}

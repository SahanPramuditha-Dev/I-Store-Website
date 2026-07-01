function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

export default function FilterToolbar({
  children,
  className = "",
}) {
  return (
    <div className={cx("flex flex-wrap items-center gap-2 min-w-0", className)}>
      {children}
    </div>
  );
}

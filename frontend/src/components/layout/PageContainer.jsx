export default function PageContainer({
  children,
  className = "",
  scroll = true,
  padded = false,
}) {
  return (
    <div
      className={`min-h-0 min-w-0 max-w-full ${scroll ? "overflow-visible" : "overflow-hidden"} ${padded ? "px-1 pb-2" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

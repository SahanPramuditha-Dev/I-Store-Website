export default function PageContainer({
  children,
  className = "",
  scroll = true,
  padded = false,
}) {
  return (
    <div
      className={`app-page-container min-h-0 min-w-0 w-full max-w-none ${scroll ? "overflow-y-auto overflow-x-hidden" : "overflow-hidden"} ${padded ? "px-1 pb-2" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

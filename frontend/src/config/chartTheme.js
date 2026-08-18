/**
 * I-Store Central Chart Theme
 * Synchronized with the design tokens in index.css
 */
export const CHART_THEME = {
  primary: "#4f46e5",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  info: "#0ea5e9",
  ai: "#8b5cf6",
  slate: "#64748b",
  
  // Palette sequences for multi-series graphs
  palette: [
    "#4f46e5", // Brand Indigo
    "#10b981", // Success Emerald
    "#0ea5e9", // Info Sky
    "#f59e0b", // Warning Amber
    "#8b5cf6", // AI Purple
    "#ef4444", // Danger Rose
  ],
  
  // Grid and Axis styling
  gridDark: "rgba(255, 255, 255, 0.08)",
  gridLight: "#e2e8f0",
  textDark: "#94a3b8",
  textLight: "#64748b",
  
  // Tooltip backgrounds
  tooltipDark: {
    backgroundColor: "rgba(15, 23, 42, 0.95)",
    borderColor: "rgba(255, 255, 255, 0.1)",
    color: "#f8fafc",
    borderRadius: "12px",
    boxShadow: "0 10px 25px rgba(0,0,0,0.4)",
  },
  tooltipLight: {
    backgroundColor: "#ffffff",
    borderColor: "#e2e8f0",
    color: "#0f172a",
    borderRadius: "12px",
    boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
  }
};

export const REPORT_SECTIONS = [
  {
    slug: "overview",
    title: "Overview Dashboard",
    shortTitle: "Overview",
    description: "Business-wide KPI snapshot for the selected date range.",
  },
  {
    slug: "sales",
    title: "Sales Reports",
    shortTitle: "Sales",
    description: "Invoices, payment methods, and daily sales trends.",
  },
  {
    slug: "repairs",
    title: "Repair Reports",
    shortTitle: "Repairs",
    description: "Ticket lifecycle, turnaround, and repair revenue.",
  },
  {
    slug: "profit-loss",
    title: "Profit & Loss Reports",
    shortTitle: "P&L",
    description: "Revenue, costs, gross margin, and net trend.",
  },
  {
    slug: "expenses",
    title: "Expense Reports",
    shortTitle: "Expenses",
    description: "Spend tracking from purchase orders and related costs.",
  },
  {
    slug: "inventory",
    title: "Inventory Reports",
    shortTitle: "Inventory",
    description: "Stock health, valuation, and inventory movement insights.",
  },
  {
    slug: "outstanding-payments",
    title: "Outstanding Payments",
    shortTitle: "Outstanding",
    description: "Customer and repair balances still pending collection.",
  },
  {
    slug: "technician-performance",
    title: "Technician Performance",
    shortTitle: "Technicians",
    description: "Technician workload, completion rate, and productivity.",
  },
  {
    slug: "product-performance",
    title: "Product Performance",
    shortTitle: "Products",
    description: "Top movers, slow movers, and category-level performance.",
  },
  {
    slug: "customer-reports",
    title: "Customer Reports",
    shortTitle: "Customers",
    description: "Customer value, repeat behavior, and service history.",
  },
  {
    slug: "supplier-reports",
    title: "Supplier Reports",
    shortTitle: "Suppliers",
    description: "Supplier purchases, linked stock, and sourcing footprint.",
  },
  {
    slug: "tax-financial",
    title: "Tax & Financial Reports",
    shortTitle: "Tax & Finance",
    description: "Tax, payment channels, and financial control views.",
  },
  {
    slug: "refunds-returns",
    title: "Refunds & Returns Reports",
    shortTitle: "Refunds",
    description: "Track product returns, repair refunds, reasons, and refund impact analytics.",
  },
  {
    slug: "audit",
    title: "Audit Reports",
    shortTitle: "Audit",
    description: "System events, notifications, and operational traceability.",
  },
  {
    slug: "export-center",
    title: "Export Center",
    shortTitle: "Export",
    description: "Generate CSV/PDF bundles for each reporting domain.",
  },
];

export const REPORT_SECTION_MAP = Object.fromEntries(
  REPORT_SECTIONS.map((section) => [section.slug, section]),
);

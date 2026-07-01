import { Card, CardContent, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from "@mui/material";

export function AppCard({ title, actions = null, children, sx = {}, contentSx = {} }) {
  return (
    <Card
      elevation={0}
      sx={{
        borderRadius: "16px",
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(15,23,42,0.60)",
        backdropFilter: "blur(8px)",
        color: "#e2e8f0",
        ...sx,
      }}
    >
      <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 }, ...contentSx }}>
        {(title || actions) && (
          <div className="mb-2 flex items-center justify-between gap-2">
            {title ? <h3 className="text-sm font-bold text-white">{title}</h3> : <span />}
            {actions}
          </div>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

export function StickyTable({
  columns,
  rows,
  rowKey = "id",
  maxHeight = 560,
  fillHeight = false,
  emptyText = "No records",
  size = "small",
  containerSx = {},
  tableSx = {},
}) {
  return (
    <TableContainer
      sx={{
        maxHeight: fillHeight ? "100%" : maxHeight,
        height: fillHeight ? "100%" : "auto",
        ...(fillHeight ? { flex: 1, minHeight: 0 } : {}),
        overflowX: "auto",
        overflowY: "auto",
        borderRadius: "12px",
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(2,6,23,0.25)",
        ...containerSx,
      }}
      className="custom-scrollbar"
    >
      <Table stickyHeader size={size} sx={tableSx}>
        <TableHead>
          <TableRow>
            {columns.map((col) => (
              <TableCell
                key={col.key}
                align={col.align || "left"}
                sx={{
                  bgcolor: "rgba(2,6,23,0.92)",
                  color: "#94a3b8",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                  fontSize: "11px",
                  textTransform: "uppercase",
                  letterSpacing: "0.10em",
                  fontWeight: 700,
                  py: 1.2,
                  px: 1.5,
                  ...(col.sx || {}),
                }}
              >
                {col.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length} sx={{ color: "#64748b", py: 3, textAlign: "center" }}>
                {emptyText}
              </TableCell>
            </TableRow>
          )}
          {rows.map((row, idx) => (
            <TableRow
              key={typeof rowKey === "function" ? rowKey(row, idx) : row[rowKey] ?? idx}
              hover
              sx={{
                "& td": {
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  color: "#cbd5e1",
                  py: 1.1,
                  px: 1.5,
                },
                "&:nth-of-type(odd)": { backgroundColor: "rgba(255,255,255,0.01)" },
              }}
            >
              {columns.map((col) => (
                <TableCell key={`${col.key}-${idx}`} align={col.align || "left"} sx={col.cellSx || {}}>
                  {col.render ? col.render(row, idx) : row[col.key]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

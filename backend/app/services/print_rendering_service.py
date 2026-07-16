import json
import logging
from html import escape

from sqlalchemy.orm import Session

from app.models import AppSetting

SOFTWARE_NAME = "I Store"
DEFAULT_SHOP_NAME = "I Point"

logger = logging.getLogger(__name__)


def _safe_float(value) -> float:
    try:
        return float(value or 0)
    except Exception:
        return 0.0


def _read_json_setting(db: Session, key: str) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row or not row.value:
        return {}
    try:
        payload = json.loads(row.value)
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def get_store_profile_print_data(db: Session) -> dict:
    state = _read_json_setting(db, "settings_state_v2")
    legacy_print = _read_json_setting(db, "print_profile")
    store_profile = (state or {}).get("store_profile", {}) or {}
    business = store_profile.get("business_identity", {}) or {}
    contact = store_profile.get("contact_information", {}) or {}
    address = store_profile.get("address", {}) or {}
    branding = store_profile.get("logo_branding", {}) or {}
    operations = store_profile.get("operational_details", {}) or {}
    receipt_design = (state or {}).get("invoice_receipt_design", {}) or {}
    footer = receipt_design.get("footer_configuration", {}) or {}

    shop_name = str(business.get("shop_name") or legacy_print.get("store_name") or DEFAULT_SHOP_NAME).strip()
    return {
        "software_name": SOFTWARE_NAME,
        "shop_name": shop_name or DEFAULT_SHOP_NAME,
        "shop_logo": branding.get("shop_logo") or branding.get("receipt_logo") or legacy_print.get("logo_data") or "",
        "address": address.get("address_line_1") or legacy_print.get("store_address") or "",
        "phone": contact.get("primary_phone") or legacy_print.get("store_phone") or "",
        "email": contact.get("email_address") or legacy_print.get("store_email") or "",
        "website": contact.get("website_url") or legacy_print.get("store_website") or "",
        "tax_number": business.get("tax_vat_number") or legacy_print.get("tax_number") or "",
        "registration_number": business.get("registration_number") or legacy_print.get("business_reg_no") or "",
        "receipt_message": operations.get("receipt_message") or footer.get("thank_you_text") or "Thank you for your purchase!",
        "invoice_footer": business.get("invoice_footer_text") or legacy_print.get("footer_note") or footer.get("thank_you_text") or "",
        "return_policy": footer.get("return_policy_text") or legacy_print.get("return_policy") or "",
        "warranty_terms": business.get("warranty_terms") or operations.get("warranty_terms") or "",
        "default_invoice_template": str(receipt_design.get("default_template") or receipt_design.get("template") or "modern").lower(),
        "invoice_receipt_design": receipt_design,
    }


def _document_shell(title: str, body: str, *, thermal: bool = False) -> str:
    max_width = "80mm" if thermal else "210mm"
    padding = "6mm" if thermal else "12mm"
    font_size = "11px" if thermal else "13px"
    return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>{escape(title)}</title>
  <style>
    @page {{ size: {'80mm auto' if thermal else 'A4'}; margin: 0; }}
    body {{ font-family: Arial, sans-serif; background: #fff; color: #111; margin: 0; padding: {padding}; }}
    .wrap {{ max-width: {max_width}; margin: 0 auto; }}
    .top {{ margin-bottom: 10px; text-align: {'center' if thermal else 'left'}; }}
    .shop {{ font-size: {'14px' if thermal else '20px'}; font-weight: 700; }}
    .muted {{ color: #555; font-size: 11px; }}
    .title {{ font-size: {'13px' if thermal else '18px'}; font-weight: 700; margin: 10px 0; text-align: center; }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 8px; }}
    th, td {{ border-bottom: 1px solid #ddd; padding: 6px 4px; font-size: {font_size}; vertical-align: top; }}
    th {{ text-align: left; background: #f7f7f7; }}
    .totals td {{ border: none; }}
    .right {{ text-align: right; }}
    .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; margin: 8px 0; }}
    .box {{ border: 1px solid #ddd; padding: 8px; min-height: 42px; }}
    @media print {{ body {{ padding: {padding}; }} }}
  </style>
</head>
<body>
  <div class="wrap">{body}</div>
</body>
</html>"""


def render_store_header(store: dict, *, thermal: bool = False) -> str:
    logo_html = ""
    if store.get("shop_logo"):
        logo_html = (
            "<div style='margin-bottom:6px;'>"
            f"<img src='{escape(str(store.get('shop_logo')))}' alt='Store Logo' "
            f"style='max-height:{'28px' if thermal else '56px'}; max-width:100%; object-fit:contain;' />"
            "</div>"
        )
    contact = " ".join(
        part
        for part in [
            str(store.get("phone") or "").strip(),
            str(store.get("email") or "").strip(),
            str(store.get("website") or "").strip(),
        ]
        if part
    )
    return (
        "<div class='top'>"
        f"{logo_html}"
        f"<div class='shop'>{escape(str(store.get('shop_name') or DEFAULT_SHOP_NAME))}</div>"
        f"<div class='muted'>{escape(str(store.get('address') or ''))}</div>"
        f"<div class='muted'>{escape(contact)}</div>"
        "</div>"
    )


def render_invoice_html(invoice: dict, store: dict, *, thermal: bool = False) -> str:
    """
    DEPRECATED: Legacy standard invoice renderer. Do not use for invoice rendering.
    Kept as a migration backup only. All rendering must go through
    render_invoice_html_from_store() -> _render_invoice_html_customizer().
    """
    line_rows = "".join(
        "<tr>"
        f"<td>{escape(str(row.get('description') or row.get('item_name') or 'Line Item'))}</td>"
        f"<td class='right'>{int(row.get('quantity') or 0)}</td>"
        f"<td class='right'>{_safe_float(row.get('unit_price')):,.2f}</td>"
        f"<td class='right'>{_safe_float(row.get('line_total')):,.2f}</td>"
        "</tr>"
        for row in (invoice.get("lines") or [])
    )
    warranty_rows = "".join(
        f"<li>{escape(str(row.get('product_or_service_name') or 'Warranty item'))} "
        f"({int(row.get('warranty_days') or 0)} days, until {escape(str(row.get('end_date') or '-'))})</li>"
        for row in (invoice.get("warranty_records") or [])
    )
    body = f"""
    {render_store_header(store, thermal=thermal)}
    <div class="muted">Invoice: {escape(str(invoice.get("invoice_number") or ""))}</div>
    <div class="muted">Date: {escape(str(invoice.get("created_at") or ""))}</div>
    <div class="muted">Customer: {escape(str(invoice.get("customer_name") or "Walk-in Customer"))}</div>
    <table>
      <thead><tr><th>Item</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Total</th></tr></thead>
      <tbody>{line_rows}</tbody>
    </table>
    <table class="totals">
      <tr><td>Subtotal</td><td class="right">{_safe_float(invoice.get("subtotal")):,.2f}</td></tr>
      <tr><td>Discount</td><td class="right">{_safe_float(invoice.get("discount_total")):,.2f}</td></tr>
      <tr><td>Tax</td><td class="right">{_safe_float(invoice.get("tax_total")):,.2f}</td></tr>
      <tr><td><strong>Grand Total</strong></td><td class="right"><strong>{_safe_float(invoice.get("grand_total")):,.2f}</strong></td></tr>
      <tr><td>Advance Applied</td><td class="right">{_safe_float(invoice.get("advance_applied_total")):,.2f}</td></tr>
      <tr><td>Paid</td><td class="right">{_safe_float(invoice.get("paid_total")):,.2f}</td></tr>
      <tr><td>Balance</td><td class="right">{_safe_float(invoice.get("balance_due")):,.2f}</td></tr>
    </table>
    <div class="muted" style="margin-top:8px;">Warranty Terms: {escape(str(store.get("warranty_terms") or "-"))}</div>
    <ul class="muted">{warranty_rows}</ul>
    <div class="muted" style="margin-top:8px;">{escape(str(store.get("invoice_footer") or ""))}</div>
    """
    return _document_shell(str(invoice.get("invoice_number") or "Invoice"), body, thermal=thermal)


def render_invoice_html_modern(invoice: dict, store: dict, *, thermal: bool = False) -> str:
    """
    DEPRECATED: Legacy modern invoice renderer. Do not use for invoice rendering.
    Kept as a migration backup only. All rendering must go through
    render_invoice_html_from_store() -> _render_invoice_html_customizer().
    """
    # A more modern, attractive A4 invoice layout (lightweight inline styles)
    created = escape(str(invoice.get("created_at") or invoice.get("date") or ""))
    invoice_no = escape(str(invoice.get("invoice_number") or invoice.get("invoice_no") or invoice.get("id") or ""))
    customer = escape(str(invoice.get("customer_name") or invoice.get("customer") or "Walk-in"))
    payment_method = escape(str(invoice.get("payment_method") or invoice.get("payment_type") or "—"))
    cashier = escape(str(invoice.get("cashier") or invoice.get("served_by") or "—"))

    lines = invoice.get("lines") or invoice.get("items") or []
    line_rows = "".join(
        "<tr>"
        f"<td style='padding:12px 10px;border-bottom:1px solid rgba(255,255,255,0.04);'>{escape(str(row.get('description') or row.get('item_name') or 'Item'))}</td>"
        f"<td style='padding:12px 10px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:center;'>{int(row.get('quantity') or 0)}</td>"
        f"<td style='padding:12px 10px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:right;'>{_safe_float(row.get('unit_price')):,.2f}</td>"
        f"<td style='padding:12px 10px;border-bottom:1px solid rgba(255,255,255,0.04);text-align:right;'>{_safe_float(row.get('line_total')):,.2f}</td>"
        "</tr>"
        for row in lines
    )

    subtotal = _safe_float(invoice.get("subtotal") or invoice.get("sub_total") or invoice.get("total_before_tax") or invoice.get("grand_total"))
    discount = _safe_float(invoice.get("discount_amount") or invoice.get("discount_total"))
    tax = _safe_float(invoice.get("tax_amount") or invoice.get("tax_total"))
    grand = _safe_float(invoice.get("grand_total") or invoice.get("total") or subtotal - discount + tax)
    paid = _safe_float(invoice.get("paid_total") or invoice.get("amount_paid") or invoice.get("paid"))
    balance = _safe_float(invoice.get("balance_due") or invoice.get("balance") or (grand - paid))

    # Inline styles for modern dark header and light content
    body = f"""
    <div style='font-family: Inter, Arial, sans-serif; color:#e6eef8;'>
      <div style='background:linear-gradient(90deg,#0b1220,#0f1724);padding:28px;border-radius:8px;color:#fff;margin-bottom:18px;'>
        <div style='display:flex;justify-content:space-between;align-items:center;'>
          <div style='min-width:40%;'>
            {f"<img src='{escape(str(store.get('shop_logo') or ''))}' style='max-height:56px;object-fit:contain;margin-bottom:8px;'/>" if store.get('shop_logo') else ''}
            <div style='font-size:20px;font-weight:800'>{escape(str(store.get('shop_name') or DEFAULT_SHOP_NAME))}</div>
            <div style='color:rgba(255,255,255,0.7);margin-top:6px;font-size:12px'>{escape(str(store.get('address') or ''))}</div>
            <div style='color:rgba(255,255,255,0.7);font-size:12px'>{escape(str(store.get('phone') or ''))} {escape(str(store.get('email') or ''))}</div>
          </div>
          <div style='text-align:right;min-width:280px;'>
            <div style='font-size:13px;color:#94a3b8'>Invoice</div>
            <div style='font-weight:800;font-size:20px;margin-top:6px'>{invoice_no}</div>
            <div style='color:#94a3b8;margin-top:6px;font-size:12px'>{created}</div>
            <div style='display:inline-block;padding:6px 10px;border-radius:999px;background:#0b815a;color:#dcfce7;margin-top:10px;font-weight:700;font-size:12px'>PAID</div>
          </div>
        </div>
      </div>

      <div style='display:grid;grid-template-columns:1fr 340px;gap:18px;margin-bottom:12px;'>
        <div style='background:#0b1220;border-radius:8px;padding:16px;color:#dbeafe;'>
          <div style='font-weight:700;margin-bottom:6px'>Customer</div>
          <div style='color:#cbd5e1'>{customer}</div>
        </div>
        <div style='background:#0b1220;border-radius:8px;padding:16px;color:#dbeafe;'>
          <div style='font-weight:700;margin-bottom:6px'>Payment</div>
          <div style='color:#cbd5e1'>Method: {payment_method}</div>
          <div style='color:#cbd5e1'>Cashier: {cashier}</div>
          <div style='margin-top:8px;font-weight:800;font-size:18px;text-align:right'>{grand:,.2f}</div>
        </div>
      </div>

      <div style='background:#071025;border-radius:10px;padding:8px;'>
        <table style='width:100%;border-collapse:collapse;'>
          <thead>
            <tr style='color:#94a3b8;text-transform:uppercase;font-size:12px;'>
              <th style='text-align:left;padding:10px 8px'>Item</th>
              <th style='text-align:center;padding:10px 8px'>Qty</th>
              <th style='text-align:right;padding:10px 8px'>Price</th>
              <th style='text-align:right;padding:10px 8px'>Total</th>
            </tr>
          </thead>
          <tbody>
            {line_rows or "<tr><td colspan='4' style='padding:12px;color:#94a3b8'>No items found</td></tr>"}
          </tbody>
        </table>
      </div>

      <div style='display:flex;justify-content:flex-end;margin-top:16px;'>
        <div style='min-width:300px;background:#071025;border-radius:8px;padding:14px;color:#dbeafe'>
          <div style='display:flex;justify-content:space-between;margin-bottom:8px'><div>Subtotal</div><div>{subtotal:,.2f}</div></div>
          <div style='display:flex;justify-content:space-between;margin-bottom:8px'><div>Discount</div><div>{discount:,.2f}</div></div>
          <div style='display:flex;justify-content:space-between;margin-bottom:8px'><div>Tax</div><div>{tax:,.2f}</div></div>
          <div style='display:flex;justify-content:space-between;margin-top:10px;font-weight:800;font-size:16px'><div>Total</div><div>{grand:,.2f}</div></div>
        </div>
      </div>

      <div style='margin-top:20px;font-size:12px;color:#94a3b8'>
        {escape(str(store.get('invoice_footer') or 'Thank you for shopping with us.'))}
      </div>

    </div>
    """

    return _document_shell(str(invoice.get("invoice_number") or "Invoice"), body, thermal=thermal)


def _normalize_invoice_template_choice(template: str | None, thermal: bool) -> str:
    """DEPRECATED: Only used by removed legacy fallback path. Retained for reference."""
    chosen = str(template or "").strip().lower()
    if not chosen:
        return "standard" if thermal else "modern"
    return chosen


def _get_system_default_settings(thermal: bool = False) -> dict:
    """Return canonical system-default template settings matching the frontend's
    defaultSalesSettings(). Used when no deployed customizer template exists in the
    store's invoice_receipt_design.customizer.templates array.
    This ensures the same renderer code path (customizer) is always used.
    """
    fmt = "80mm" if thermal else "A4"
    return {
        "branding": {
            "show_logo": True,
            "logo_size": "Medium",
            "logo_position": "Left",
            "logo_top_margin": 8,
            "show_shop_name": True,
            "shop_name_text": "",
            "shop_name_font": "Montserrat",
            "shop_name_size": 20 if thermal else 24,
            "shop_name_weight": "Bold",
            "shop_name_color": "#111827",
            "show_tagline": False,
            "tagline_text": "",
            "tagline_size": 10,
            "tagline_color": "#6b7280",
        },
        "business": {
            "show_address": True,
            "show_phone": True,
            "show_secondary_phone": False,
            "show_email": True,
            "show_website": True,
            "show_tax_number": True,
            "layout": "Stacked",
            "align": "Right",
            "font_size": 10,
            "color": "#4b5563",
        },
        "header": {
            "show_title": True,
            "title_text": "TAX INVOICE",
            "title_size": 14 if thermal else 18,
            "title_weight": "Bold",
            "title_color": "#111827",
            "title_align": "Center",
            "show_invoice_no": True,
            "show_date": True,
            "show_time": True,
            "show_cashier": True,
            "show_branch": False,
            "date_format": "DD/MM/YYYY",
            "time_format": "12-hour",
            "meta_layout": "2 columns",
            "show_qr": False,
        },
        "bill_to": {
            "show_section": True,
            "section_label": "BILL TO",
            "show_customer_name": True,
            "show_customer_phone": True,
            "show_customer_address": False,
            "show_customer_id": False,
            "show_outstanding": True,
            "outstanding_label": "Outstanding Balance",
            "border_style": "Solid",
            "border_color": "#d1d5db",
            "background_color": "#f9fafb",
            "radius": 6,
        },
        "items": {
            "show_imei": True,
            "show_discount": True,
            "show_tax": False,
            "show_warranty": True,
            "row_height": 32,
            "header_bg": "#f3f4f6",
            "header_text": "#111827",
            "row_even_bg": "#ffffff",
            "row_odd_bg": "#f9fafb",
            "row_text": "#111827",
            "border_color": "#e5e7eb",
        },
        "totals": {
            "show_subtotal": True,
            "show_discount": True,
            "show_tax": True,
            "show_rounding": True,
            "show_total": True,
            "show_paid": True,
            "show_balance": True,
            "show_outstanding": True,
            "show_total_words": False,
            "totals_align": "Right",
            "width_percent": 50,
            "total_color": "#111827",
            "total_bg": "#f3f4f6",
        },
        "payment": {
            "show_section": True,
            "show_method": True,
            "show_tendered": True,
            "show_change": True,
            "show_partial_history": True,
            "show_remaining": True,
        },
        "footer": {
            "show_thank_you": True,
            "thank_you_text": "Thank you for your purchase!",
            "thank_you_size": 11,
            "thank_you_color": "#6b7280",
            "show_return_policy": True,
            "return_policy_text": "Items can be returned within 7 days with receipt.",
            "show_warranty_note": True,
            "warranty_note_text": "All products carry manufacturer warranty.",
            "custom_line_1": "",
            "custom_line_2": "",
            "custom_line_3": "",
            "show_footer_qr": False,
            "show_invoice_barcode": False,
        },
        "print": {
            "paper_size": fmt,
            "orientation": "Portrait",
            "margin_top_mm": 8 if thermal else 15,
            "margin_bottom_mm": 8 if thermal else 15,
            "margin_left_mm": 4 if thermal else 15,
            "margin_right_mm": 4 if thermal else 15,
            "font_family": "Inter, Arial, sans-serif",
            "base_font_size": 10 if thermal else 11,
            "line_spacing": 1.4,
            "color_scheme": "Light",
            "accent_color": "#111827",
            "background_color": "#ffffff",
            "text_color": "#111827",
            "watermark": "None",
        },
    }


def _find_deployed_sales_bill_template(store: dict, *, thermal: bool = False) -> dict | None:
  # Backwards-compatible wrapper that returns only the settings dict.
  info = _find_deployed_sales_bill_template_info(store, thermal=thermal)
  return info[0] if info else None


def _find_deployed_sales_bill_template_info(store: dict, *, thermal: bool = False) -> tuple[dict | None, str | None] | None:
  """Return (settings, template_id) for the first deployed or selected sales_bill template.
  Keeps the original selection logic but also exposes the template id for diagnostics.
  """
  receipt_design = store.get("invoice_receipt_design") or {}
  customizer = receipt_design.get("customizer") or {}
  templates = customizer.get("templates") if isinstance(customizer.get("templates"), list) else []
  target_format = "a4" if not thermal else "80mm"
  for template in templates:
    if (
      str(template.get("document") or "").lower() == "sales_bill"
      and str(template.get("format") or "").lower() == target_format
      and bool(template.get("deployed"))
    ):
      return (template.get("settings") or {}, template.get("id"))
  ui = customizer.get("ui") or {}
  selected_map = ui.get("selected_template_by_context") or {}
  selected_id = selected_map.get(f"sales_bill:{target_format}")
  if selected_id:
    selected = next((tpl for tpl in templates if tpl.get("id") == selected_id), None)
    if selected:
      return (selected.get("settings") or {}, selected.get("id"))
  return None


def _format_money(value) -> str:
    return f"{_safe_float(value):,.2f}"


def _render_invoice_html_customizer(invoice: dict, store: dict, settings: dict, *, thermal: bool = False) -> str:
    from html import escape
    
    branding = settings.get("branding") or {}
    business = settings.get("business") or {}
    header_config = settings.get("header") or {}
    bill_to = settings.get("bill_to") or {}
    items_config = settings.get("items") or {}
    totals_config = settings.get("totals") or {}
    footer_config = settings.get("footer") or {}
    print_config = settings.get("print") or {}

    accent = print_config.get("accent_color") or "#0066cc"
    text_color = print_config.get("text_color") or "#1a1a2e"
    bg = print_config.get("background_color") or "#ffffff"
    font_family = print_config.get("font_family") or "DM Sans, sans-serif"
    base_font_size = f"{print_config.get('base_font_size') or 11}px"
    
    max_width = "80mm" if thermal else "210mm"
    padding = "6mm" if thermal else "12mm"

    # Extraction
    invoice_number = escape(str(invoice.get("invoice_number") or invoice.get("invoice_no") or invoice.get("id") or ""))
    created_at = escape(str(invoice.get("created_at") or ""))
    salesperson = escape(str(invoice.get("created_by_name") or invoice.get("salesperson") or ""))
    
    customer_name = escape(str(invoice.get("customer_name") or "Walk-in Customer"))
    customer_phone = escape(str(invoice.get("customer_phone") or ""))
    
    DEFAULT_SHOP_NAME = "I Point"
    shop_name = escape(str(store.get("shop_name") or DEFAULT_SHOP_NAME))
    shop_address = escape(str(store.get("address") or ""))
    shop_phone = escape(str(store.get("phone") or ""))
    shop_email = escape(str(store.get("email") or ""))
    shop_website = escape(str(store.get("website") or ""))
    
    def _format_money(value) -> str:
        try:
            val = float(value or 0)
            return f"{val:,.2f}"
        except:
            return "0.00"

    # Items table
    line_rows = []
    for idx, row in enumerate(invoice.get("lines") or []):
        desc = escape(str(row.get("description") or row.get("item_name") or ""))
        qty = int(row.get("quantity") or 0)
        unit = _format_money(row.get("unit_price"))
        total = _format_money(row.get("line_total"))
        
        row_bg = items_config.get("row_odd_bg") or "#141628" if idx % 2 else items_config.get("row_even_bg") or "#1a1d2e"
        
        cells = [f"<td style='padding: 6px 8px;'><div>{desc}</div>"]
        if items_config.get("show_warranty") and row.get("warranty_days"):
            cells.append(f"<div style='font-size: 10px; opacity: 0.7;'>Warranty: {row.get('warranty_days')} days</div>")
        cells.append("</td>")
        
        if items_config.get("show_imei"):
            imei = escape(str(row.get("imei") or row.get("serial_number") or ""))
            cells.append(f"<td style='padding: 6px 8px;'>{imei}</td>")
            
        cells.append(f"<td style='padding: 6px 8px; text-align: right;'>{qty}</td>")
        cells.append(f"<td style='padding: 6px 8px; text-align: right;'>{unit}</td>")
        
        if items_config.get("show_discount"):
            disc = _format_money(row.get("discount_amount"))
            cells.append(f"<td style='padding: 6px 8px; text-align: right;'>{disc}</td>")
            
        cells.append(f"<td style='padding: 6px 8px; text-align: right;'>{total}</td>")
        line_rows.append(f"<tr style='background: {row_bg};'>{''.join(cells)}</tr>")

    if not line_rows:
        col_span = 4
        if items_config.get("show_imei"): col_span += 1
        if items_config.get("show_discount"): col_span += 1
        line_rows.append(f"<tr style='background: {items_config.get('row_even_bg') or '#1a1d2e'};'><td colspan='{col_span}' style='padding: 8px;'>No items</td></tr>")

    # Header columns
    th_style = f"padding: 6px 8px; text-align: left; background: {items_config.get('header_bg') or '#252840'}; color: {items_config.get('header_text') or '#ffffff'};"
    th_right = th_style.replace("text-align: left", "text-align: right")
    
    th_html = f"<th style='{th_style}'>Description</th>"
    if items_config.get("show_imei"):
        th_html += f"<th style='{th_style}'>IMEI</th>"
    th_html += f"<th style='{th_right}'>Qty</th>"
    th_html += f"<th style='{th_right}'>Unit</th>"
    if items_config.get("show_discount"):
        th_html += f"<th style='{th_right}'>Disc</th>"
    th_html += f"<th style='{th_right}'>Total</th>"

    logo_html = ""
    if branding.get("show_logo") and store.get("shop_logo"):
        logo_html = f"<img src='{escape(str(store.get('shop_logo')))}' class='logo-box' />"
    
    shop_name_html = ""
    if branding.get("show_shop_name"):
        shop_name_html = f"<div class='font-black' style='font-size: 1.1em; color: {branding.get('shop_name_color') or text_color};'>{branding.get('shop_name_text') or shop_name}</div>"
        
    tagline_html = ""
    if branding.get("show_tagline"):
        tagline_html = f"<div style='font-size: 0.9em; color: {branding.get('tagline_color') or '#777'}; margin-bottom: 8px;'>{branding.get('tagline_text') or store.get('tagline') or '-'}</div>"

    business_address_html = f"<div>{shop_address}</div>" if business.get("show_address") and shop_address else ""
    business_phone_html = f"<div>{shop_phone}</div>" if business.get("show_phone") and shop_phone else ""
    business_email_html = f"<div>{shop_email}</div>" if business.get("show_email") and shop_email else ""
    business_website_html = f"<div>{shop_website}</div>" if business.get("show_website") and shop_website else ""
    
    title_html = ""
    if header_config.get("show_title"):
        title_html = f"<div class='mt-3 text-center font-black' style='color: {header_config.get('title_color') or accent}; font-size: {header_config.get('title_size') or 18}px;'>{header_config.get('title_text') or 'INVOICE'}</div>"

    invoice_no_html = f"<div>Invoice No: {invoice_number}</div>" if header_config.get("show_invoice_no") else ""
    
    date_part = created_at.split("T")[0] if "T" in created_at else created_at
    time_part = created_at.split("T")[1][:5] if "T" in created_at else "-"
    date_html = f"<div class='text-right'>Date: {date_part}</div>" if header_config.get("show_date") else ""
    cashier_html = f"<div>Served By: {salesperson}</div>" if header_config.get("show_cashier") else ""
    time_html = f"<div class='text-right'>Time: {time_part}</div>" if header_config.get("show_time") else ""

    bill_to_html = ""
    if bill_to.get("show_section"):
        b_name = f"<div>{customer_name}</div>" if bill_to.get("show_customer_name") else ""
        b_phone = f"<div>{customer_phone}</div>" if bill_to.get("show_customer_phone") else ""
        b_out = f"<div style='margin-top: 4px;'>{bill_to.get('outstanding_label') or 'Outstanding'}: LKR {_format_money(invoice.get('balance_due'))}</div>" if bill_to.get("show_outstanding") else ""
        bill_to_html = f"<div class='mt-3' style='border: 1px solid {bill_to.get('border_color') or '#333355'}; background: {bill_to.get('background_color') or 'transparent'}; padding: 8px; border-radius: 4px;'><div class='font-bold' style='margin-bottom: 4px;'>{bill_to.get('section_label') or 'BILL TO'}</div>{b_name}{b_phone}{b_out}</div>"

    subtotal_html = f"<div class='flex-row'><span>Sub Total</span><span>LKR {_format_money(invoice.get('subtotal'))}</span></div>" if totals_config.get("show_subtotal") else ""
    discount_total_html = f"<div class='flex-row'><span>Discount</span><span>LKR {_format_money(invoice.get('discount_total'))}</span></div>" if totals_config.get("show_discount") else ""
    tax_total_html = f"<div class='flex-row'><span>Tax</span><span>LKR {_format_money(invoice.get('tax_total'))}</span></div>" if totals_config.get("show_tax") else ""
    total_html = f"<div class='flex-row font-black' style='background: {totals_config.get('total_bg') or '#1a1d2e'}; color: {totals_config.get('total_color') or accent}; padding: 4px 8px; border-radius: 4px; margin-top: 4px;'><span>TOTAL</span><span>LKR {_format_money(invoice.get('grand_total'))}</span></div>" if totals_config.get("show_total") else ""
    
    thank_you_html = f"<div class='mt-3 text-center' style='color: {footer_config.get('thank_you_color') or '#888'}; font-size: 0.9em;'>{footer_config.get('thank_you_text') or ''}</div>" if footer_config.get("show_thank_you") else ""
    
    # We use double curly braces {{ }} for CSS to escape them in the Python f-string
    html_output = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>{invoice_number}</title>
  <style>
    body {{
      margin: 0;
      padding: {padding};
      background: #f1f5f9;
    }}
    .invoice-container {{
      max-width: {max_width};
      margin: 0 auto;
      background: {bg};
      color: {text_color};
      font-family: '{font_family}', sans-serif;
      font-size: {base_font_size};
      padding: 20px;
      border: 1px dashed #cbd5e1;
      border-radius: 12px;
      box-sizing: border-box;
    }}
    .flex-between {{ display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }}
    .logo-box {{ margin-bottom: 8px; max-height: 40px; max-width: 100px; object-fit: contain; }}
    .grid-2 {{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }}
    .text-right {{ text-align: right; }}
    .text-center {{ text-align: center; }}
    .font-black {{ font-weight: 900; }}
    .font-bold {{ font-weight: 700; }}
    .mt-3 {{ margin-top: 12px; }}
    table {{ width: 100%; border-collapse: collapse; border-spacing: 0; }}
    .totals-box {{ margin-left: auto; width: 56%; margin-top: 12px; font-size: 0.95em; }}
    .flex-row {{ display: flex; justify-content: space-between; margin-bottom: 4px; }}
  </style>
</head>
<body>
  <!-- selected_template:{settings.get('_template_id_tracker_') or 'system_default'} render_source:customizer mode:{'preview' if not str(invoice.get('id', '')).isdigit() else 'production'} -->
  <div class="invoice-container">
    
    <div class="flex-between">
      <div>
        {logo_html}
        {shop_name_html}
        {tagline_html}
      </div>
      <div class="text-right" style="font-size: 0.9em; color: {business.get('color') or '#666'}; line-height: 1.4;">
        {business_address_html}
        {business_phone_html}
        {business_email_html}
        {business_website_html}
      </div>
    </div>

    {title_html}

    <div class="mt-3 grid-2" style="font-size: 0.95em;">
      {invoice_no_html}
      {date_html}
      {cashier_html}
      {time_html}
    </div>

    {bill_to_html}

    <div class="mt-3" style="border: 1px solid {items_config.get('border_color') or '#2a2d4a'}; border-radius: 4px; overflow: hidden;">
      <table style="color: {items_config.get('row_text') or '#e0e0e0'};">
        <thead>
          <tr>{th_html}</tr>
        </thead>
        <tbody>
          {''.join(line_rows)}
        </tbody>
      </table>
    </div>

    <div class="totals-box">
      {subtotal_html}
      {discount_total_html}
      {tax_total_html}
      {total_html}
    </div>

    {thank_you_html}

  </div>
</body>
</html>"""
    return html_output

def render_invoice_html_from_store(
  invoice: dict,
  store: dict,
  *,
  thermal: bool = False,
  template: str | None = None,  # retained for API compat but no longer used for routing
  preview: bool = False,
) -> str:
  """Unified invoice rendering entry point.

  Always renders through _render_invoice_html_customizer() using:
  1. The deployed customizer template from invoice_receipt_design.customizer.templates, or
  2. The system default settings (_get_system_default_settings) if no deployed template exists.

  Legacy render_invoice_html() and render_invoice_html_modern() are no longer called by
  this function. They exist only as migration backups.

  Args:
    invoice: Invoice data dict.
    store: Store profile dict (from get_store_profile_print_data).
    thermal: True for 80mm thermal, False for A4.
    template: Ignored. Kept for API backward compatibility only.
    preview: True when rendering for design preview, False for production print.
  """
  mode = "preview" if preview else "production"
  format_label = "80mm thermal" if thermal else "A4"

  # Step 1: find deployed customizer template
  info = _find_deployed_sales_bill_template_info(store, thermal=thermal)
  custom_settings = info[0] if info else None
  selected_template_id = info[1] if info else None

  # Step 2: fall back to system default if no deployed template found
  if not custom_settings:
    custom_settings = _get_system_default_settings(thermal=thermal)
    selected_template_id = "system_default"
    logger.info(
      "[InvoiceRender] No deployed template found for %s — using system default. "
      "invoice=%s mode=%s",
      format_label,
      invoice.get("invoice_number") or invoice.get("id") or "(demo)",
      mode,
    )
  else:
    logger.info(
      "[InvoiceRender] template_id=%s format=%s invoice=%s mode=%s",
      selected_template_id,
      format_label,
      invoice.get("invoice_number") or invoice.get("id") or "(demo)",
      mode,
    )

  # Step 3: always render through the customizer pipeline
  html = _render_invoice_html_customizer(invoice, store, custom_settings, thermal=thermal)
  return f"<!-- selected_template:{selected_template_id} render_source:customizer mode:{mode} -->\n" + html


def render_warranty_certificate_html(record: dict, store: dict) -> str:
    title = f"Warranty Certificate {record.get('warranty_number') or record.get('warranty_id') or ''}".strip()
    body = f"""
    {render_store_header(store)}
    <div class="title">Warranty Certificate</div>
    <div class="grid">
      <div><strong>Warranty No</strong><br>{escape(str(record.get("warranty_number") or record.get("warranty_id") or "-"))}</div>
      <div><strong>Status</strong><br>{escape(str(record.get("status") or "-"))}</div>
      <div><strong>Customer</strong><br>{escape(str(record.get("customer_name") or "-"))}</div>
      <div><strong>Phone</strong><br>{escape(str(record.get("customer_phone") or "-"))}</div>
      <div><strong>Product / Service</strong><br>{escape(str(record.get("product_or_service_name") or "-"))}</div>
      <div><strong>Serial / IMEI</strong><br>{escape(str(record.get("serial_number") or record.get("imei_or_serial") or "-"))}</div>
      <div><strong>Start Date</strong><br>{escape(str(record.get("start_date") or "-"))}</div>
      <div><strong>End Date</strong><br>{escape(str(record.get("end_date") or "-"))}</div>
      <div><strong>Coverage</strong><br>{escape(str(record.get("coverage_type") or "-"))}</div>
      <div><strong>Warranty Days</strong><br>{int(record.get("warranty_days") or 0)}</div>
    </div>
    <div class="box"><strong>Warranty Terms</strong><br>{escape(str(store.get("warranty_terms") or record.get("notes") or "-"))}</div>
    <div class="muted" style="margin-top:14px;">Issued by {escape(str(store.get("shop_name") or DEFAULT_SHOP_NAME))} using {SOFTWARE_NAME}.</div>
    """
    return _document_shell(title, body, thermal=False)


def render_advance_receipt_html(receipt: dict, store: dict, *, thermal: bool = True) -> str:
    title = f"Advance Receipt {receipt.get('receipt_number') or receipt.get('advance_number') or ''}".strip()
    body = f"""
    {render_store_header(store, thermal=thermal)}
    <div class="title">Advance Payment Receipt</div>
    <div class="grid">
      <div><strong>Receipt</strong><br>{escape(str(receipt.get("receipt_number") or receipt.get("advance_number") or "-"))}</div>
      <div><strong>Date</strong><br>{escape(str(receipt.get("payment_date") or receipt.get("created_at") or receipt.get("generated_at") or "-"))}</div>
      <div><strong>Customer</strong><br>{escape(str(receipt.get("customer_name") or "-"))}</div>
      <div><strong>Status</strong><br>{escape(str(receipt.get("status") or "-"))}</div>
      <div><strong>Reference</strong><br>{escape(str(receipt.get("reservation_number") or receipt.get("repair_ticket_number") or "-"))}</div>
      <div><strong>Payment Method</strong><br>{escape(str(receipt.get("payment_method") or "-"))}</div>
    </div>
    <table class="totals">
      <tr><td>Estimated Total</td><td class="right">{_safe_float(receipt.get("estimated_total")):,.2f}</td></tr>
      <tr><td><strong>Amount Paid</strong></td><td class="right"><strong>{_safe_float(receipt.get("amount_paid") or receipt.get("amount")):,.2f}</strong></td></tr>
      <tr><td>Remaining Balance</td><td class="right">{_safe_float(receipt.get("remaining_balance")):,.2f}</td></tr>
    </table>
    <div class="muted" style="margin-top:10px;">Received by: {escape(str(receipt.get("received_by_name") or receipt.get("received_by") or "-"))}</div>
    <div class="muted" style="margin-top:8px;">{escape(str(store.get("invoice_footer") or store.get("receipt_message") or ""))}</div>
    """
    return _document_shell(title or "Advance Payment Receipt", body, thermal=thermal)


def render_return_receipt_html(record: dict, store: dict, *, thermal: bool = True) -> str:
    items = record.get("items") or []
    item_rows = "".join(
        "<tr>"
        f"<td>{escape(str(item.get('product_name') or item.get('item_name') or item.get('product_id') or '-'))}</td>"
        f"<td class='right'>{int(item.get('quantity') or 0)}</td>"
        f"<td>{escape(str(item.get('item_condition') or '-'))}</td>"
        f"<td>{escape(str(item.get('restock_action') or '-'))}</td>"
        f"<td class='right'>{_safe_float(item.get('return_amount') or item.get('unit_price')):,.2f}</td>"
        "</tr>"
        for item in items
    )
    if not item_rows:
        item_rows = "<tr><td colspan='5'>No return line items available.</td></tr>"
    title = f"Return Receipt {record.get('return_number') or record.get('return_id') or ''}".strip()
    body = f"""
    {render_store_header(store, thermal=thermal)}
    <div class="title">Return / Refund Receipt</div>
    <div class="grid">
      <div><strong>Return No</strong><br>{escape(str(record.get("return_number") or record.get("return_id") or "-"))}</div>
      <div><strong>Invoice</strong><br>{escape(str(record.get("original_invoice_number") or record.get("invoice_id") or "-"))}</div>
      <div><strong>Customer</strong><br>{escape(str(record.get("customer_name") or "-"))}</div>
      <div><strong>Status</strong><br>{escape(str(record.get("decision_status") or record.get("status") or "-"))}</div>
    </div>
    <table>
      <thead><tr><th>Item</th><th class="right">Qty</th><th>Condition</th><th>Action</th><th class="right">Amount</th></tr></thead>
      <tbody>{item_rows}</tbody>
    </table>
    <table class="totals">
      <tr><td>Total Return</td><td class="right">{_safe_float(record.get("total_return_amount")):,.2f}</td></tr>
      <tr><td><strong>Refund Paid</strong></td><td class="right"><strong>{_safe_float(record.get("refund_amount")):,.2f}</strong></td></tr>
      <tr><td>Store Credit</td><td class="right">{_safe_float(record.get("store_credit_amount")):,.2f}</td></tr>
    </table>
    <div class="muted" style="margin-top:8px;">{escape(str(store.get("return_policy") or store.get("invoice_footer") or ""))}</div>
    """
    return _document_shell(title or "Return Receipt", body, thermal=thermal)


def render_payment_receipt_html(payment: dict, store: dict, *, thermal: bool = True) -> str:
    title = f"Payment Receipt {payment.get('payment_number') or payment.get('id') or ''}".strip()
    body = f"""
    {render_store_header(store, thermal=thermal)}
    <div class="title">Payment Receipt</div>
    <div class="grid">
      <div><strong>Payment No</strong><br>{escape(str(payment.get("payment_number") or payment.get("id") or "-"))}</div>
      <div><strong>Invoice</strong><br>{escape(str(payment.get("invoice_number") or payment.get("invoice_id") or "-"))}</div>
      <div><strong>Customer</strong><br>{escape(str(payment.get("customer_name") or "-"))}</div>
      <div><strong>Date</strong><br>{escape(str(payment.get("created_at") or "-"))}</div>
      <div><strong>Method</strong><br>{escape(str(payment.get("payment_method") or "-"))}</div>
      <div><strong>Reference</strong><br>{escape(str(payment.get("reference_number") or "-"))}</div>
    </div>
    <table class="totals">
      <tr><td><strong>Amount Received</strong></td><td class="right"><strong>{_safe_float(payment.get("amount")):,.2f}</strong></td></tr>
      <tr><td>Invoice Paid Total</td><td class="right">{_safe_float(payment.get("paid_total")):,.2f}</td></tr>
      <tr><td>Balance Due</td><td class="right">{_safe_float(payment.get("balance_due")):,.2f}</td></tr>
    </table>
    <div class="muted" style="margin-top:8px;">{escape(str(payment.get("notes") or store.get("receipt_message") or ""))}</div>
    """
    return _document_shell(title or "Payment Receipt", body, thermal=thermal)


def render_repair_document_html(repair: dict, parts: list[dict], store: dict, *, thermal: bool = False, title: str = "Repair Job Card") -> str:
    part_rows = "".join(
        "<tr>"
        f"<td>{escape(str(row.get('item_name') or row.get('name') or row.get('item_id') or '-'))}</td>"
        f"<td class='right'>{int(row.get('quantity') or 0)}</td>"
        f"<td class='right'>{_safe_float(row.get('unit_cost')):,.2f}</td>"
        f"<td class='right'>{_safe_float(row.get('line_total')):,.2f}</td>"
        "</tr>"
        for row in parts
    )
    if not part_rows:
        part_rows = "<tr><td colspan='4'>No parts consumed.</td></tr>"
    doc_title = f"{title} {repair.get('ticket_no') or repair.get('id') or ''}".strip()
    body = f"""
    {render_store_header(store, thermal=thermal)}
    <div class="title">{escape(title)}</div>
    <div class="grid">
      <div><strong>Job No</strong><br>{escape(str(repair.get("ticket_no") or repair.get("id") or "-"))}</div>
      <div><strong>Status</strong><br>{escape(str(repair.get("status_label") or repair.get("status") or "-"))}</div>
      <div><strong>Customer</strong><br>{escape(str(repair.get("customer_name") or "-"))}</div>
      <div><strong>Phone</strong><br>{escape(str(repair.get("customer_phone") or "-"))}</div>
      <div><strong>Device</strong><br>{escape(str(repair.get("device_model") or "-"))}</div>
      <div><strong>IMEI / Serial</strong><br>{escape(str(repair.get("imei") or "-"))}</div>
      <div><strong>Technician</strong><br>{escape(str(repair.get("technician") or "-"))}</div>
      <div><strong>Priority</strong><br>{escape(str(repair.get("priority") or "-"))}</div>
    </div>
    <div class="box"><strong>Issue</strong><br>{escape(str(repair.get("issue") or "-"))}</div>
    <table>
      <thead><tr><th>Part</th><th class="right">Qty</th><th class="right">Unit</th><th class="right">Total</th></tr></thead>
      <tbody>{part_rows}</tbody>
    </table>
    <table class="totals">
      <tr><td>Estimated Cost</td><td class="right">{_safe_float(repair.get("estimated_cost")):,.2f}</td></tr>
      <tr><td>Advance Paid</td><td class="right">{_safe_float(repair.get("advance_payment")):,.2f}</td></tr>
      <tr><td><strong>Outstanding Balance</strong></td><td class="right"><strong>{_safe_float(repair.get("outstanding_balance")):,.2f}</strong></td></tr>
    </table>
    <div class="grid" style="margin-top:16px;">
      <div class="box"><strong>Customer Signature</strong><br><br></div>
      <div class="box"><strong>Technician / Delivery Signature</strong><br><br></div>
    </div>
    <div class="muted" style="margin-top:8px;">{escape(str(store.get("invoice_footer") or store.get("receipt_message") or ""))}</div>
    """
    return _document_shell(doc_title or title, body, thermal=thermal)


def render_label_sheet_html(labels: list[dict], store: dict, *, paper: str = "label_50x30", title: str = "Barcode Sheet") -> str:
    label_rows = "".join(
        f"""
        <div class="label">
          <div>
            <strong>{escape(str(row.get("name") or row.get("item_name") or row.get("title") or "Label"))}</strong>
            <div class="muted">{escape(str(row.get("subtitle") or row.get("sku") or row.get("entity_ref") or ""))}</div>
          </div>
          <div class="barcode"></div>
          <div class="code">{escape(str(row.get("barcode") or row.get("entity_ref") or row.get("job_code") or ""))}</div>
          <div class="muted">{escape(str(store.get("shop_name") or DEFAULT_SHOP_NAME))}</div>
        </div>
        """
        for row in labels
    )
    if not label_rows:
        label_rows = "<div class='empty'>No queued or referenced label data found.</div>"
    cell = "38mm 25mm" if paper == "label_38x25" else "50mm 30mm"
    return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>{escape(title)}</title>
  <style>
    @page {{ size: A4; margin: 8mm; }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; background: #fff; color: #111; font-family: Arial, sans-serif; }}
    .sheet {{ display: grid; grid-template-columns: repeat(auto-fill, minmax({cell.split()[0]}, 1fr)); gap: 3mm; padding: 2mm; }}
    .label {{ width: {cell.split()[0]}; min-height: {cell.split()[1]}; border: 1px solid #111; border-radius: 3px; padding: 2mm; display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; break-inside: avoid; }}
    .label strong {{ display: block; font-size: 9px; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
    .muted {{ color: #555; font-size: 7px; line-height: 1.1; }}
    .code {{ font-size: 8px; text-align: center; font-weight: 700; letter-spacing: .08em; }}
    .barcode {{ height: 9mm; background: repeating-linear-gradient(90deg, #111 0 1px, #fff 1px 2px, #111 2px 4px, #fff 4px 6px); }}
    .empty {{ padding: 12mm; border: 1px dashed #999; color: #555; }}
  </style>
</head>
<body><main class="sheet">{label_rows}</main></body>
</html>"""



def render_invoice_html_dynamic(invoice_data: dict, store_profile: dict, settings: dict) -> str:
    """Render the Dynamic Builder layout using blocks array."""
    blocks = settings.get("layout", {}).get("blocks", [
        {"id": "header", "type": "header", "enabled": True},
        {"id": "bill_to", "type": "bill_to", "enabled": True},
        {"id": "items", "type": "items", "enabled": True},
        {"id": "totals", "type": "totals", "enabled": True},
        {"id": "footer", "type": "footer", "enabled": True}
    ])
    
    html_parts = []
    
    for block in blocks:
        if not block.get("enabled", False):
            continue
            
        btype = block.get("type")
        if btype == "header":
            html_parts.append(f'''
            <div style="text-align: center; margin-bottom: 20px;">
                <h2 style="margin: 0;">{store_profile.get('store_name', 'Store Name')}</h2>
                <p style="margin: 5px 0;">{store_profile.get('address', '')}</p>
                <p style="margin: 5px 0;">{store_profile.get('phone', '')}</p>
            </div>
            ''')
        elif btype == "bill_to":
            html_parts.append(f'''
            <div style="margin-bottom: 20px; padding: 10px; background: #f8fafc; border-radius: 8px;">
                <div style="font-size: 10px; text-transform: uppercase; color: #64748b;">Billed To</div>
                <div style="font-weight: bold; font-size: 16px;">{invoice_data.get('customer_name', '')}</div>
                <div>{invoice_data.get('customer_phone', '')}</div>
            </div>
            ''')
        elif btype == "items":
            items_html = ""
            for item in invoice_data.get("lines", []):
                items_html += f'''
                <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee;">{item.get('description', '')}</td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: center;">{item.get('qty', 1)}</td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #eee; text-align: right;">{item.get('line_total', 0):.2f}</td>
                </tr>
                '''
            html_parts.append(f'''
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <thead>
                    <tr style="border-bottom: 2px solid #000;">
                        <th style="text-align: left; padding: 8px 0;">Item</th>
                        <th style="text-align: center; padding: 8px 0;">Qty</th>
                        <th style="text-align: right; padding: 8px 0;">Total</th>
                    </tr>
                </thead>
                <tbody>{items_html}</tbody>
            </table>
            ''')
        elif btype == "totals":
            html_parts.append(f'''
            <div style="text-align: right; margin-bottom: 20px;">
                <div>Subtotal: {invoice_data.get('subtotal', 0):.2f}</div>
                <div style="font-weight: bold; font-size: 18px; margin-top: 10px;">Total: {invoice_data.get('grand_total', 0):.2f}</div>
            </div>
            ''')
        elif btype == "footer":
            html_parts.append(f'''
            <div style="text-align: center; margin-top: 30px; font-size: 12px; color: #666;">
                {settings.get('footer', {}).get('thank_you_text', 'Thank you for your business!')}
            </div>
            ''')
            
    content_html = "\n".join(html_parts)
    
    return f'''
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 20px; color: #333; }}
        </style>
    </head>
    <body>
        {content_html}
    </body>
    </html>
    '''

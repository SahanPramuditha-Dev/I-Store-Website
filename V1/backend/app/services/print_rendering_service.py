import json
from html import escape

from sqlalchemy.orm import Session

from app.models import AppSetting

SOFTWARE_NAME = "I Store"
DEFAULT_SHOP_NAME = "I Point"


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

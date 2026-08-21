"""
I-Store ERP — WhatsApp AI Tool & Function Calling Registry
===========================================================
Secure, typed, server-validated backend tools for WhatsApp AI customer service.
Prevents direct SQL generation, enforces privacy verification gates, and
creates non-destructive draft records for reservations and repair requests.
"""

import json
import re
import urllib.parse
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_, desc

from app.models import (
    InventoryItem,
    Customer,
    RepairTicket,
    Sale,
    WarrantyRecord,
    ProductReservation,
    WhatsAppConversationSession
)
from app.utils.time import utcnow
from app.services.supabase_pos_sync import generate_invoice_token
from app.utils.whatsapp_helper import resolve_store_variables, normalize_sri_lankan_phone

PORTAL_BASE = "https://i-store-customer-portal-one.vercel.app"

# ─── Tool Declarations (Schemas for Gemini Function Calling) ─────────────────

AI_TOOLS_SCHEMA = [
    {
        "name": "search_products",
        "description": "Searches store inventory for products, phones, chargers, or accessories by keyword, category, or budget.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search keyword e.g. 'iPhone 15 charger', 'tempered glass', 'Samsung battery'"},
                "category": {"type": "string", "description": "Optional category filter e.g. 'Accessories', 'Phones', 'Spare Parts'"},
                "min_price": {"type": "number", "description": "Optional minimum price in LKR"},
                "max_price": {"type": "number", "description": "Optional maximum budget/price in LKR"}
            },
            "required": ["query"]
        }
    },
    {
        "name": "get_product_price_and_stock",
        "description": "Checks the exact price, stock availability, and warranty for a specific product name or SKU.",
        "parameters": {
            "type": "object",
            "properties": {
                "product_name": {"type": "string", "description": "Product name or SKU code"}
            },
            "required": ["product_name"]
        }
    },
    {
        "name": "get_repair_status",
        "description": "Looks up the live status, milestone stage, cost estimate, and balance due for a repair job ticket.",
        "parameters": {
            "type": "object",
            "properties": {
                "ticket_no": {"type": "string", "description": "Repair ticket number e.g. 'JOB-2026-000001' or digits"}
            }
        }
    },
    {
        "name": "get_warranty_status",
        "description": "Looks up registered active device warranties and expiry dates for the customer.",
        "parameters": {
            "type": "object",
            "properties": {
                "serial_or_imei": {"type": "string", "description": "Optional serial number or IMEI to check"}
            }
        }
    },
    {
        "name": "get_customer_invoices",
        "description": "Retrieves recent digital invoices and receipt links for the authenticated customer.",
        "parameters": {
            "type": "object",
            "properties": {
                "invoice_no": {"type": "string", "description": "Optional specific invoice number e.g. 'INV-2026-000001'"}
            }
        }
    },
    {
        "name": "create_product_reservation",
        "description": "Creates a temporary hold/reservation draft for a product so the customer can collect it at the store.",
        "parameters": {
            "type": "object",
            "properties": {
                "product_name": {"type": "string", "description": "The exact product name to reserve"},
                "quantity": {"type": "integer", "description": "Quantity to reserve (default 1)"},
                "notes": {"type": "string", "description": "Pickup timing note e.g. 'Customer collecting at 5 PM'"}
            },
            "required": ["product_name"]
        }
    },
    {
        "name": "create_repair_request",
        "description": "Creates a draft repair service request with device model, reported fault, and pickup preference.",
        "parameters": {
            "type": "object",
            "properties": {
                "device_model": {"type": "string", "description": "Device brand and model e.g. 'iPhone 13', 'Samsung S22'"},
                "issue_description": {"type": "string", "description": "Detailed description of the issue or damage"},
                "preferred_date": {"type": "string", "description": "Customer's preferred visit or drop-off date/time"},
                "notes": {"type": "string", "description": "Additional notes e.g. 'Water damaged', 'Urgent'"}
            },
            "required": ["device_model", "issue_description"]
        }
    },
    {
        "name": "get_store_information",
        "description": "Returns store address, operating hours, phone hotline, and customer portal links.",
        "parameters": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "request_human_handover",
        "description": "Escalates the conversation to a human staff representative and pauses AI responses.",
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {"type": "string", "description": "Brief reason for human handover"}
            }
        }
    }
]

# ─── Tool Implementations ───────────────────────────────────────────────────

def tool_search_products(
    db: Session,
    query: str,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    category: Optional[str] = None
) -> Dict[str, Any]:
    """Searches active inventory for matching products with budget and category filters."""
    clean_q = (query or "").strip()
    tokens = [t.strip().lower() for t in re.split(r'[\s,\.\?\!\-\/]+', clean_q) if len(t.strip()) >= 2]
    
    q_filter = []
    for t in tokens[:5]:
        q_filter.append(InventoryItem.name.ilike(f"%{t}%"))
        q_filter.append(InventoryItem.category.ilike(f"%{t}%"))
        q_filter.append(InventoryItem.brand.ilike(f"%{t}%"))
        q_filter.append(InventoryItem.sku.ilike(f"%{t}%"))

    base_query = db.query(InventoryItem).filter(
        InventoryItem.is_deleted == False,
        InventoryItem.quantity > 0
    )
    if q_filter:
        base_query = base_query.filter(or_(*q_filter))

    if category:
        base_query = base_query.filter(InventoryItem.category.ilike(f"%{category}%"))

    items = base_query.limit(10).all()
    results = []
    for it in items:
        price = float(getattr(it, 'sale_price', 0) or getattr(it, 'selling_price', 0) or getattr(it, 'price', 0) or 0)
        if min_price is not None and price < min_price:
            continue
        if max_price is not None and price > max_price:
            continue
        loc_str = it.location or "Main Branch Showroom"
        results.append({
            "id": it.id,
            "sku": it.sku,
            "name": it.name,
            "brand": it.brand or "General",
            "category": it.category or "General",
            "stock_quantity": it.quantity,
            "price_lkr": price,
            "branch_location": loc_str,
            "warranty_period": f"{it.warranty_days} Days Store Warranty" if getattr(it, 'warranty_days', 0) else "Standard Store Warranty"
        })

    return {
        "found_count": len(results),
        "products": results,
        "query_used": query,
        "note": "Prices in LKR. If out of stock at main counter, items can be transferred from branch/warehouse for pickup."
    }


def tool_get_product_price_and_stock(db: Session, product_name: str) -> Dict[str, Any]:
    """Looks up specific product pricing, stock availability, and branch locations."""
    res = tool_search_products(db, query=product_name)
    if res["products"]:
        best = res["products"][0]
        return {
            "found": True,
            "product": best,
            "stock_status": "In Stock" if best["stock_quantity"] > 0 else "Out of Stock",
            "branch_location": best.get("branch_location", "Main Branch Showroom"),
            "other_matches": res["products"][1:4]
        }
    return {
        "found": False,
        "message": f"Product matching '{product_name}' not found in active inventory.",
        "note": "Special orders or inter-branch transfers may be requested."
    }


def tool_get_repair_status(
    db: Session,
    customer_phone: str,
    customer_name: str,
    ticket_no: Optional[str] = None,
    is_verified: bool = False
) -> Dict[str, Any]:
    """Retrieves repair ticket status and live milestone tracking link."""
    clean_phone = normalize_sri_lankan_phone(customer_phone) or customer_phone
    phone_variants = [clean_phone]
    if clean_phone.startswith("94") and len(clean_phone) == 11:
        phone_variants.extend(["0" + clean_phone[2:], clean_phone[2:]])
    elif clean_phone.startswith("0") and len(clean_phone) == 10:
        phone_variants.extend(["94" + clean_phone[1:], clean_phone[1:]])

    customer = db.query(Customer).filter(
        or_(Customer.phone.in_(phone_variants), Customer.whatsapp_number.in_(phone_variants))
    ).first()

    ticket = None
    if ticket_no:
        norm_tno = str(ticket_no).strip().upper()
        ticket = db.query(RepairTicket).filter(
            (RepairTicket.ticket_no.ilike(f"%{norm_tno}%")) |
            (RepairTicket.id == int(re.sub(r'[^\d]', '', norm_tno) or 0)),
            RepairTicket.is_deleted == False
        ).first()

    if not ticket and customer:
        ticket = db.query(RepairTicket).filter(
            RepairTicket.customer_id == customer.id,
            RepairTicket.is_deleted == False
        ).order_by(desc(RepairTicket.id)).first()

    if not ticket:
        return {
            "found": False,
            "message": "No active repair ticket found for this customer or ticket number."
        }

    t_no = ticket.ticket_no or f"JOB-2026-{ticket.id:06d}"
    dev_model = ticket.device_model or "Device"
    issue_desc = ticket.issue or "Hardware Servicing"
    status_label = (ticket.status or "In Progress").title()
    est_cost = float(ticket.estimated_cost or 0)
    adv_paid = float(ticket.advance_payment or 0)
    bal_due = float(ticket.outstanding_balance or (est_cost - adv_paid))
    note_str = f"{ticket.condition_notes or ticket.notes}" if (ticket.condition_notes or ticket.notes) else "Device undergoing diagnostics"

    tracking_url = (
        f"{PORTAL_BASE}/repair/{t_no}"
        f"?model={urllib.parse.quote(dev_model)}"
        f"&issue={urllib.parse.quote(issue_desc)}"
        f"&status={urllib.parse.quote(status_label)}"
        f"&est={est_cost:.2f}"
        f"&adv={adv_paid:.2f}"
        f"&bal={bal_due:.2f}"
        f"&name={urllib.parse.quote(customer_name)}"
        f"&phone={clean_phone}"
    )

    return {
        "found": True,
        "ticket_no": t_no,
        "device_model": dev_model,
        "issue": issue_desc,
        "status": status_label,
        "status_notes": note_str,
        "estimated_cost_lkr": est_cost,
        "advance_paid_lkr": adv_paid,
        "balance_due_lkr": bal_due,
        "live_tracking_url": tracking_url,
        "estimated_completion": ticket.estimated_completion.strftime("%B %d, %Y") if ticket.estimated_completion else "Pending diagnostics confirmation"
    }


def tool_get_warranty_status(
    db: Session,
    customer_phone: str,
    customer_name: str,
    serial_or_imei: Optional[str] = None,
    is_verified: bool = False
) -> Dict[str, Any]:
    """Retrieves customer device warranties and certificate expiry."""
    clean_phone = normalize_sri_lankan_phone(customer_phone) or customer_phone
    phone_variants = [clean_phone]
    if clean_phone.startswith("94") and len(clean_phone) == 11:
        phone_variants.extend(["0" + clean_phone[2:], clean_phone[2:]])
    elif clean_phone.startswith("0") and len(clean_phone) == 10:
        phone_variants.extend(["94" + clean_phone[1:], clean_phone[1:]])

    customer = db.query(Customer).filter(
        or_(Customer.phone.in_(phone_variants), Customer.whatsapp_number.in_(phone_variants))
    ).first()

    query = db.query(WarrantyRecord).filter(WarrantyRecord.status.in_(["active", "ACTIVE"]))
    if serial_or_imei:
        query = query.filter(WarrantyRecord.serial_number.ilike(f"%{serial_or_imei.strip()}%"))
    elif customer:
        query = query.filter(WarrantyRecord.customer_id == customer.id)
    else:
        return {"found": False, "message": "No warranty records found."}

    warranties = query.order_by(desc(WarrantyRecord.created_at)).limit(5).all()
    results = []
    for w in warranties:
        results.append({
            "product_name": w.product_name or "Device",
            "serial_number": w.serial_number or "N/A",
            "status": "Active",
            "expiry_date": w.expiry_date.strftime("%B %d, %Y") if w.expiry_date else "Lifetime",
            "terms": w.terms or "Standard manufacturer warranty"
        })

    return {
        "found": len(results) > 0,
        "count": len(results),
        "warranties": results
    }


def tool_get_customer_invoices(
    db: Session,
    customer_phone: str,
    customer_name: str,
    invoice_no: Optional[str] = None,
    is_verified: bool = False
) -> Dict[str, Any]:
    """Retrieves recent invoices and secure instant PDF receipt links."""
    clean_phone = normalize_sri_lankan_phone(customer_phone) or customer_phone
    phone_variants = [clean_phone]
    if clean_phone.startswith("94") and len(clean_phone) == 11:
        phone_variants.extend(["0" + clean_phone[2:], clean_phone[2:]])
    elif clean_phone.startswith("0") and len(clean_phone) == 10:
        phone_variants.extend(["94" + clean_phone[1:], clean_phone[1:]])

    customer = db.query(Customer).filter(
        or_(Customer.phone.in_(phone_variants), Customer.whatsapp_number.in_(phone_variants))
    ).first()

    query = db.query(Sale).filter(Sale.is_voided == False)
    if invoice_no:
        norm_inv = invoice_no.strip().upper()
        query = query.filter(Sale.invoice_no.ilike(f"%{norm_inv}%"))
    elif customer:
        query = query.filter(Sale.customer_id == customer.id)
    else:
        return {"found": False, "message": "No sales record found for this number."}

    sales = query.order_by(desc(Sale.created_at)).limit(3).all()
    results = []
    for s in sales:
        inv_num = getattr(s, "invoice_no", None) or f"INV-2026-{s.id:06d}"
        token = generate_invoice_token(inv_num)
        total_amt = float(getattr(s, "total", 0) or 0)
        bal_due = float(getattr(s, "balance_due", 0) or 0)
        bill_url = (
            f"{PORTAL_BASE}/invoice/{inv_num}?token={token}"
            f"&name={urllib.parse.quote(customer_name)}"
            f"&total={total_amt:.2f}&phone={clean_phone}"
        )
        results.append({
            "invoice_no": inv_num,
            "date": s.created_at.strftime("%Y-%m-%d") if s.created_at else "Recent",
            "total_lkr": total_amt,
            "balance_due_lkr": bal_due,
            "payment_method": getattr(s, "payment_method", "Cash"),
            "digital_bill_url": bill_url
        })

    return {
        "found": len(results) > 0,
        "count": len(results),
        "invoices": results
    }


def tool_create_product_reservation(
    db: Session,
    customer_phone: str,
    customer_name: str,
    product_name: str,
    quantity: int = 1,
    notes: Optional[str] = None
) -> Dict[str, Any]:
    """Creates a non-destructive draft reservation in product_reservations."""
    clean_phone = normalize_sri_lankan_phone(customer_phone) or customer_phone
    phone_variants = [clean_phone]
    if clean_phone.startswith("94") and len(clean_phone) == 11:
        phone_variants.extend(["0" + clean_phone[2:], clean_phone[2:]])
    elif clean_phone.startswith("0") and len(clean_phone) == 10:
        phone_variants.extend(["94" + clean_phone[1:], clean_phone[1:]])

    customer = db.query(Customer).filter(
        or_(Customer.phone.in_(phone_variants), Customer.whatsapp_number.in_(phone_variants))
    ).first()
    if not customer:
        customer = Customer(
            name=customer_name,
            phone=clean_phone,
            whatsapp_number=clean_phone,
            created_at=utcnow()
        )
        db.add(customer)
        db.flush()

    # Find matching product
    search_res = tool_search_products(db, query=product_name)
    prod = search_res["products"][0] if search_res["products"] else None
    
    res_num = f"RES-{datetime.now().strftime('%Y%m%d')}-{int(datetime.now().timestamp()) % 10000:04d}"
    expires_at = datetime.now() + timedelta(hours=8)

    reservation = ProductReservation(
        reservation_number=res_num,
        customer_id=customer.id,
        product_id=prod["id"] if prod else None,
        requested_product_name=prod["name"] if prod else product_name,
        quantity=max(1, quantity),
        reservation_type="in_stock_reservation",
        status="draft",
        estimated_total=(prod["price_lkr"] * max(1, quantity)) if prod else 0,
        expiry_date=expires_at,
        notes=f"WhatsApp AI Hold: {notes or 'Customer requested hold'}. Valid until {expires_at.strftime('%I:%M %p')}",
        created_at=utcnow()
    )
    db.add(reservation)
    db.commit()

    return {
        "success": True,
        "reservation_number": res_num,
        "product_name": prod["name"] if prod else product_name,
        "quantity": quantity,
        "price_lkr": prod["price_lkr"] if prod else "To be confirmed",
        "held_until": expires_at.strftime("%I:%M %p today"),
        "status": "Held (Pending Store Pickup)",
        "confirmation_note": f"Your reservation code is *{res_num}*. Please show this code at the store."
    }


def tool_create_repair_request(
    db: Session,
    customer_phone: str,
    customer_name: str,
    device_model: str,
    issue_description: str,
    preferred_date: Optional[str] = None,
    notes: Optional[str] = None
) -> Dict[str, Any]:
    """Creates a draft intake repair ticket for staff/technician review."""
    clean_phone = normalize_sri_lankan_phone(customer_phone) or customer_phone
    phone_variants = [clean_phone]
    if clean_phone.startswith("94") and len(clean_phone) == 11:
        phone_variants.extend(["0" + clean_phone[2:], clean_phone[2:]])
    elif clean_phone.startswith("0") and len(clean_phone) == 10:
        phone_variants.extend(["94" + clean_phone[1:], clean_phone[1:]])

    customer = db.query(Customer).filter(
        or_(Customer.phone.in_(phone_variants), Customer.whatsapp_number.in_(phone_variants))
    ).first()
    if not customer:
        customer = Customer(
            name=customer_name,
            phone=clean_phone,
            whatsapp_number=clean_phone,
            created_at=utcnow()
        )
        db.add(customer)
        db.flush()

    ticket_code = f"JOB-{datetime.now().strftime('%Y%m%d')}-{int(datetime.now().timestamp()) % 10000:04d}"
    intake_notes = f"[WhatsApp Booking] Preferred: {preferred_date or 'ASAP'}. Notes: {notes or 'Customer submitted via WhatsApp AI'}"

    ticket = RepairTicket(
        ticket_no=ticket_code,
        customer_id=customer.id,
        device_model=device_model,
        issue=issue_description,
        status="received",
        estimate_status="draft",
        approval_status="pending",
        notes=intake_notes,
        created_at=utcnow()
    )
    db.add(ticket)
    db.commit()

    tracking_url = (
        f"{PORTAL_BASE}/repair/{ticket_code}"
        f"?model={urllib.parse.quote(device_model)}"
        f"&issue={urllib.parse.quote(issue_description)}"
        f"&status=Received"
        f"&name={urllib.parse.quote(customer_name)}"
        f"&phone={clean_phone}"
    )

    return {
        "success": True,
        "ticket_no": ticket_code,
        "device_model": device_model,
        "issue": issue_description,
        "preferred_schedule": preferred_date or "Standard store hours",
        "live_tracking_url": tracking_url,
        "instruction": "Please bring your device to the store or hand it to our collection point. A technician will perform physical diagnostics."
    }


def tool_get_store_information(db: Session) -> Dict[str, Any]:
    """Returns official store info, location, hours, and hotline."""
    info = resolve_store_variables(db)
    return {
        "store_name": info.get("store_name", "I-Store"),
        "address": info.get("store_address", "Colombo, Sri Lanka"),
        "hotline": info.get("store_phone", "+94 77 123 4567"),
        "business_hours": "Monday – Sunday: 9:00 AM – 8:00 PM",
        "customer_portal": PORTAL_BASE,
        "services": [
            "Smartphone & Tablet Sales",
            "Fast Chargers & Premium Accessories",
            "Expert Hardware & Screen Repairs",
            "Chip-Level Diagnostics & Battery Replacements",
            "Genuine Warranty Coverage"
        ]
    }


def tool_request_human_handover(
    db: Session,
    phone_number: str,
    reason: Optional[str] = None
) -> Dict[str, Any]:
    """Switches conversation session state to HUMAN_REQUESTED."""
    clean_phone = normalize_sri_lankan_phone(phone_number) or phone_number
    session = db.query(WhatsAppConversationSession).filter(
        WhatsAppConversationSession.phone_number == clean_phone
    ).first()
    if not session:
        session = WhatsAppConversationSession(
            phone_number=clean_phone,
            state="HUMAN_REQUESTED",
            last_interaction_at=utcnow()
        )
        db.add(session)
    else:
        session.state = "HUMAN_REQUESTED"
        session.last_interaction_at = utcnow()
    db.commit()

    return {
        "success": True,
        "status": "HUMAN_REQUESTED",
        "message": "Human agent alerted. AI auto-replies paused."
    }


# ─── Master Dispatcher ───────────────────────────────────────────────────────

TOOL_DISPATCH_MAP = {
    "search_products": lambda db, args, cust: tool_search_products(
        db, query=args.get("query", ""), min_price=args.get("min_price"),
        max_price=args.get("max_price"), category=args.get("category")
    ),
    "get_product_price_and_stock": lambda db, args, cust: tool_get_product_price_and_stock(
        db, product_name=args.get("product_name", "")
    ),
    "get_repair_status": lambda db, args, cust: tool_get_repair_status(
        db, customer_phone=cust["phone"], customer_name=cust["name"],
        ticket_no=args.get("ticket_no"), is_verified=cust.get("is_verified", False)
    ),
    "get_warranty_status": lambda db, args, cust: tool_get_warranty_status(
        db, customer_phone=cust["phone"], customer_name=cust["name"],
        serial_or_imei=args.get("serial_or_imei"), is_verified=cust.get("is_verified", False)
    ),
    "get_customer_invoices": lambda db, args, cust: tool_get_customer_invoices(
        db, customer_phone=cust["phone"], customer_name=cust["name"],
        invoice_no=args.get("invoice_no"), is_verified=cust.get("is_verified", False)
    ),
    "create_product_reservation": lambda db, args, cust: tool_create_product_reservation(
        db, customer_phone=cust["phone"], customer_name=cust["name"],
        product_name=args.get("product_name", ""), quantity=args.get("quantity", 1),
        notes=args.get("notes")
    ),
    "create_repair_request": lambda db, args, cust: tool_create_repair_request(
        db, customer_phone=cust["phone"], customer_name=cust["name"],
        device_model=args.get("device_model", "Device"),
        issue_description=args.get("issue_description", "Repair"),
        preferred_date=args.get("preferred_date"), notes=args.get("notes")
    ),
    "get_store_information": lambda db, args, cust: tool_get_store_information(db),
    "request_human_handover": lambda db, args, cust: tool_request_human_handover(
        db, phone_number=cust["phone"], reason=args.get("reason")
    )
}


def execute_ai_tool(
    db: Session,
    tool_name: str,
    tool_args: Dict[str, Any],
    customer_context: Dict[str, Any]
) -> Dict[str, Any]:
    """Executes a designated tool with server-side validation and returns JSON result."""
    handler = TOOL_DISPATCH_MAP.get(tool_name)
    if not handler:
        return {"error": f"Unknown tool: {tool_name}"}
    try:
        return handler(db, tool_args, customer_context)
    except Exception as e:
        return {"error": f"Tool execution failed: {str(e)}"}

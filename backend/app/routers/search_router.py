from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import String, cast, or_, text
from app.database import get_db
from app.auth import get_current_user, require_permission
from app.models import (
    Customer,
    Expense,
    InventoryItem,
    PurchaseOrder,
    RepairTicket,
    Sale,
    SaleItem,
    Supplier,
    SupplierLedgerEntry,
    WarrantyRecord,
)

router = APIRouter(prefix="/search", tags=["search"])


def _norm(v):
    return str(v or "").strip().lower()


def _score_text(value: str, query: str) -> int:
    t = _norm(value)
    q = _norm(query)
    if not q or not t:
        return 0
    if t == q:
        return 120
    if t.startswith(q):
        return 90
    if q in t:
        return 60
    return 0


def _score_customer(c: Customer, q: str) -> int:
    return max(_score_text(getattr(c, "name", None), q), _score_text(getattr(c, "phone", None), q), _score_text(getattr(c, "email", None), q))


def _score_repair(r: RepairTicket, q: str) -> int:
    score = max(
        _score_text(getattr(r, "ticket_no", None), q),
        _score_text(getattr(r, "imei", None), q),
        _score_text(getattr(r, "device_model", None), q),
    )
    if str(getattr(r, "status", "")).lower() in ("pending", "diagnosing"):
        score += 8
    return score


def _score_inventory(i: InventoryItem, q: str) -> int:
    score = max(_score_text(getattr(i, "name", None), q), _score_text(getattr(i, "sku", None), q))
    if (getattr(i, "quantity", 0) or 0) <= 3:
        score += 6
    return score


def _score_sale(s: Sale, q: str) -> int:
    sid = getattr(s, "id", 0) or 0
    invoice = str(getattr(s, "invoice_no", None) or f"INV-{sid:05d}")
    return max(_score_text(invoice, q), _score_text(sid, q))


def _score_supplier(s: Supplier, q: str) -> int:
    return max(
        _score_text(getattr(s, "name", None), q),
        _score_text(getattr(s, "contact", None), q),
        _score_text(getattr(s, "email", None), q),
    )


def _score_purchase_order(po: PurchaseOrder, q: str) -> int:
    return max(
        _score_text(getattr(po, "po_number", None), q),
        _score_text(getattr(po, "supplier_name", None), q),
        _score_text(getattr(po, "status", None), q),
    )


def _score_expense(expense: Expense, q: str) -> int:
    return max(
        _score_text(getattr(expense, "expense_code", None), q),
        _score_text(getattr(expense, "vendor_name", None), q),
        _score_text(getattr(expense, "reference_no", None), q),
        _score_text(getattr(expense, "description", None), q),
    )


def _score_warranty(record: WarrantyRecord, q: str) -> int:
    return max(
        _score_text(getattr(record, "warranty_code", None), q),
        _score_text(getattr(record, "customer_name", None), q),
        _score_text(getattr(record, "product_or_service_name", None), q),
        _score_text(getattr(record, "imei_or_serial", None), q),
        _score_text(getattr(record, "serial_number", None), q),
    )


def _score_payment(payment: dict, q: str) -> int:
    score = max(
        _score_text(payment.get("payment_ref"), q),
        _score_text(payment.get("counterparty"), q),
        _score_text(payment.get("method"), q),
        _score_text(payment.get("source"), q),
        _score_text(payment.get("status"), q),
    )
    if payment.get("status") == "Pending":
        score += 5
    return score


def _invoice_id_candidates(q: str) -> list[int]:
    raw = str(q or "").strip().upper()
    candidates = []
    if raw.startswith("INV-"):
        digits = "".join(ch for ch in raw.split("-")[-1] if ch.isdigit())
        if digits:
            candidates.append(int(digits))
    if raw.isdigit():
        candidates.append(int(raw))
    return list(dict.fromkeys(candidates))

@router.get('/global', dependencies=[Depends(require_permission("search.global"))])
def global_search(
    q: str = Query(...),
    db: Session = Depends(get_db),
    _=Depends(get_current_user)
):
    search_text = str(q or "").strip()
    if not search_text:
        return {
            "customers": [],
            "repairs": [],
            "inventory": [],
            "sales": [],
            "suppliers": [],
            "purchase_orders": [],
            "payments": [],
            "warranty": [],
            "expenses": [],
        }

    customer_cols = {r[1] for r in db.execute(text("PRAGMA table_info(customers)")).fetchall()}
    has_customer_email = "email" in customer_cols

    # Search Customers
    customer_filters = [Customer.name.ilike(f"%{search_text}%"), Customer.phone.ilike(f"%{search_text}%")]
    customer_select = [Customer.id, Customer.name, Customer.phone]
    if has_customer_email:
        customer_filters.append(Customer.email.ilike(f"%{search_text}%"))
        customer_select.append(Customer.email)
    customers = db.query(*customer_select).filter(Customer.is_deleted == False, or_(*customer_filters)).limit(40).all()  # noqa: E712

    # Search Repairs
    repairs = db.query(
        RepairTicket.id,
        RepairTicket.ticket_no,
        RepairTicket.device_model,
        RepairTicket.status,
        RepairTicket.imei,
    ).filter(
        RepairTicket.is_deleted == False,  # noqa: E712
        or_(
            RepairTicket.ticket_no.ilike(f"%{search_text}%"),
            RepairTicket.imei.ilike(f"%{search_text}%"),
            RepairTicket.device_model.ilike(f"%{search_text}%")
        )
    ).limit(40).all()

    # Search Sales
    sale_filters = [
        cast(Sale.id, String).ilike(f"%{search_text}%"),
        Sale.invoice_no.ilike(f"%{search_text}%"),
    ]
    invoice_ids = _invoice_id_candidates(search_text)
    for invoice_id in invoice_ids:
        sale_filters.append(Sale.id == invoice_id)
    sales = db.query(Sale.id, Sale.invoice_no, Sale.total, Sale.created_at).filter(or_(*sale_filters)).limit(40).all()

    # Search Inventory
    inventory = db.query(
        InventoryItem.id,
        InventoryItem.name,
        InventoryItem.sku,
        InventoryItem.barcode,
        InventoryItem.quantity,
        InventoryItem.brand,
        InventoryItem.model,
    ).filter(
        InventoryItem.is_deleted == False,  # noqa: E712
        or_(
            InventoryItem.name.ilike(f"%{search_text}%"),
            InventoryItem.sku.ilike(f"%{search_text}%"),
            InventoryItem.barcode.ilike(f"%{search_text}%"),
            InventoryItem.brand.ilike(f"%{search_text}%"),
            InventoryItem.model.ilike(f"%{search_text}%"),
        )
    ).limit(40).all()

    # Search Suppliers
    suppliers = db.query(
        Supplier.id,
        Supplier.name,
        Supplier.contact,
        Supplier.email,
    ).filter(
        Supplier.is_deleted == False,  # noqa: E712
        or_(
            Supplier.name.ilike(f"%{search_text}%"),
            Supplier.contact.ilike(f"%{search_text}%"),
            Supplier.email.ilike(f"%{search_text}%"),
            Supplier.address.ilike(f"%{search_text}%"),
        )
    ).limit(40).all()

    # Search Purchase Orders
    purchase_orders = (
        db.query(
            PurchaseOrder.id,
            PurchaseOrder.po_number,
            PurchaseOrder.status,
            PurchaseOrder.total_cost,
            PurchaseOrder.created_at,
            Supplier.name.label("supplier_name"),
        )
        .outerjoin(Supplier, PurchaseOrder.supplier_id == Supplier.id)
        .filter(
            or_(
                PurchaseOrder.po_number.ilike(f"%{search_text}%"),
                PurchaseOrder.status.ilike(f"%{search_text}%"),
                Supplier.name.ilike(f"%{search_text}%"),
            )
        )
        .limit(40)
        .all()
    )

    # Search Expenses
    expenses = db.query(
        Expense.id,
        Expense.expense_code,
        Expense.category,
        Expense.amount,
        Expense.payment_method,
        Expense.status,
        Expense.vendor_name,
        Expense.reference_no,
        Expense.description,
        Expense.expense_date,
    ).filter(
        or_(
            Expense.expense_code.ilike(f"%{search_text}%"),
            Expense.category.ilike(f"%{search_text}%"),
            Expense.vendor_name.ilike(f"%{search_text}%"),
            Expense.reference_no.ilike(f"%{search_text}%"),
            Expense.description.ilike(f"%{search_text}%"),
        )
    ).limit(40).all()

    # Search Warranty
    warranty = db.query(
        WarrantyRecord.id,
        WarrantyRecord.warranty_code,
        WarrantyRecord.customer_name,
        WarrantyRecord.product_or_service_name,
        WarrantyRecord.imei_or_serial,
        WarrantyRecord.serial_number,
        WarrantyRecord.status,
        WarrantyRecord.end_date,
    ).filter(
        or_(
            WarrantyRecord.warranty_code.ilike(f"%{search_text}%"),
            WarrantyRecord.customer_name.ilike(f"%{search_text}%"),
            WarrantyRecord.product_or_service_name.ilike(f"%{search_text}%"),
            WarrantyRecord.imei_or_serial.ilike(f"%{search_text}%"),
            WarrantyRecord.serial_number.ilike(f"%{search_text}%"),
        )
    ).limit(40).all()

    # Search Payments (incoming customer payments + outgoing supplier payments)
    sale_payment_filters = [
        cast(Sale.id, String).ilike(f"%{search_text}%"),
        Sale.invoice_no.ilike(f"%{search_text}%"),
        Customer.name.ilike(f"%{search_text}%"),
        Sale.payment_method.ilike(f"%{search_text}%"),
        cast(Sale.total, String).ilike(f"%{search_text}%"),
    ]
    for invoice_id in invoice_ids:
        sale_payment_filters.append(Sale.id == invoice_id)
    sale_payments = (
        db.query(
            Sale.id,
            Sale.invoice_no,
            Sale.total,
            Sale.payment_method,
            Sale.paid,
            Sale.created_at,
            Customer.name.label("customer_name"),
        )
        .outerjoin(Customer, Sale.customer_id == Customer.id)
        .filter(or_(*sale_payment_filters))
        .order_by(Sale.created_at.desc())
        .limit(40)
        .all()
    )

    supplier_payment_rows = (
        db.query(
            SupplierLedgerEntry.id,
            SupplierLedgerEntry.amount,
            SupplierLedgerEntry.created_at,
            SupplierLedgerEntry.note,
            SupplierLedgerEntry.reference_type,
            Supplier.name.label("supplier_name"),
        )
        .join(Supplier, Supplier.id == SupplierLedgerEntry.supplier_id)
        .filter(
            SupplierLedgerEntry.entry_type == "payment",
            or_(
                Supplier.name.ilike(f"%{search_text}%"),
                SupplierLedgerEntry.note.ilike(f"%{search_text}%"),
                SupplierLedgerEntry.reference_type.ilike(f"%{search_text}%"),
                cast(SupplierLedgerEntry.id, String).ilike(f"%{search_text}%"),
                cast(SupplierLedgerEntry.amount, String).ilike(f"%{search_text}%"),
            ),
        )
        .order_by(SupplierLedgerEntry.created_at.desc())
        .limit(40)
        .all()
    )

    payments = []
    for row in sale_payments:
        payments.append(
            {
                "id": f"sale-{row.id}",
                "source_type": "sale",
                "source_id": row.id,
                "payment_ref": row.invoice_no or f"INV-{row.id:05d}",
                "source": "Sale Invoice",
                "direction": "in",
                "amount": float(row.total or 0),
                "method": row.payment_method or "Unknown",
                "status": "Paid" if bool(row.paid) else "Pending",
                "counterparty": row.customer_name or "Walk-in",
                "created_at": row.created_at,
            }
        )
    for row in supplier_payment_rows:
        payments.append(
            {
                "id": f"supplier-payment-{row.id}",
                "source_type": "supplier_payment",
                "source_id": row.id,
                "payment_ref": f"SUP-PAY-{row.id:05d}",
                "source": "Supplier Payment",
                "direction": "out",
                "amount": float(row.amount or 0),
                "method": "Supplier Settlement",
                "status": "Posted",
                "counterparty": row.supplier_name or "Supplier",
                "created_at": row.created_at,
                "note": row.note,
            }
        )

    customers = sorted(customers, key=lambda c: _score_customer(c, search_text), reverse=True)[:8]
    repairs = sorted(repairs, key=lambda r: _score_repair(r, search_text), reverse=True)[:8]
    sales = sorted(sales, key=lambda s: _score_sale(s, search_text), reverse=True)[:8]
    inventory = sorted(inventory, key=lambda i: _score_inventory(i, search_text), reverse=True)[:8]
    suppliers = sorted(suppliers, key=lambda s: _score_supplier(s, search_text), reverse=True)[:8]
    purchase_orders = sorted(purchase_orders, key=lambda po: _score_purchase_order(po, search_text), reverse=True)[:8]
    expenses = sorted(expenses, key=lambda row: _score_expense(row, search_text), reverse=True)[:8]
    warranty = sorted(warranty, key=lambda row: _score_warranty(row, search_text), reverse=True)[:8]
    payments = sorted(payments, key=lambda row: _score_payment(row, search_text), reverse=True)[:8]

    return {
        "customers": [{"id": c.id, "name": c.name, "phone": c.phone, "email": getattr(c, "email", None)} for c in customers],
        "repairs": [{"id": r.id, "ticket_no": r.ticket_no, "device_model": r.device_model, "status": r.status} for r in repairs],
        "sales": [{"id": s.id, "invoice_no": s.invoice_no or f"INV-{s.id:05d}", "total": s.total, "created_at": s.created_at} for s in sales],
        "inventory": [
            {
                "id": i.id,
                "name": i.name,
                "sku": i.sku,
                "barcode": i.barcode,
                "quantity": i.quantity,
                "brand": i.brand,
                "model": i.model,
            }
            for i in inventory
        ],
        "suppliers": [
            {"id": s.id, "name": s.name, "contact": s.contact, "email": s.email}
            for s in suppliers
        ],
        "purchase_orders": [
            {
                "id": po.id,
                "po_number": po.po_number,
                "supplier_name": po.supplier_name,
                "status": po.status,
                "total_cost": po.total_cost,
                "created_at": po.created_at,
            }
            for po in purchase_orders
        ],
        "payments": payments,
        "warranty": [
            {
                "id": w.id,
                "warranty_code": w.warranty_code,
                "customer_name": w.customer_name,
                "product_or_service_name": w.product_or_service_name,
                "imei_or_serial": w.imei_or_serial,
                "serial_number": w.serial_number,
                "status": w.status,
                "end_date": w.end_date,
            }
            for w in warranty
        ],
        "expenses": [
            {
                "id": e.id,
                "expense_code": e.expense_code,
                "category": e.category,
                "amount": e.amount,
                "payment_method": e.payment_method,
                "status": e.status,
                "vendor_name": e.vendor_name,
                "reference_no": e.reference_no,
                "description": e.description,
                "expense_date": e.expense_date,
            }
            for e in expenses
        ],
    }
@router.get('/suggestions', dependencies=[Depends(require_permission("search.view"))])
def get_suggestions(db: Session = Depends(get_db), _=Depends(get_current_user)):
    from sqlalchemy import func

    # 1) Top sold product names
    top_sold = db.query(
        InventoryItem.name,
        func.count(SaleItem.id).label('sold_count')
    ).join(SaleItem, InventoryItem.id == SaleItem.item_id)\
     .group_by(InventoryItem.id)\
     .order_by(func.count(SaleItem.id).desc())\
     .limit(5).all()

    trending_names = [i.name for i in top_sold]

    # 2) Recent customers
    recent_customers = db.query(Customer).order_by(Customer.created_at.desc()).limit(3).all()
    customer_names = [c.name for c in recent_customers]

    # 3) Recent POs + expense categories + supplier names
    recent_po_numbers = [row.po_number for row in db.query(PurchaseOrder.po_number).order_by(PurchaseOrder.created_at.desc()).limit(2).all()]
    expense_categories = [row.category for row in db.query(Expense.category).filter(Expense.category.isnot(None), Expense.category != "").distinct().limit(3).all()]
    supplier_names = [row.name for row in db.query(Supplier.name).order_by(Supplier.id.desc()).limit(2).all()]

    # Fallback to random inventory names
    if not trending_names:
        import random
        items = db.query(InventoryItem).all()
        trending_names = [i.name for i in random.sample(items, min(len(items), 4))] if items else []

    suggestions = trending_names + customer_names + recent_po_numbers + expense_categories + supplier_names
    suggestions += [
        "Pending repairs older than 3 days",
        "Low stock items",
        "Unpaid invoices",
        "Warranty expiring soon",
    ]

    # Unique and limit
    seen = set()
    result = []
    for s in suggestions:
        if s and s not in seen:
            result.append(s)
            seen.add(s)

    return result[:10]

from typing import List, Optional
from pydantic import BaseModel, ConfigDict
from decimal import Decimal
from datetime import datetime


class SaleItemCreate(BaseModel):
    item_id: Optional[int] = None
    description: Optional[str] = None
    quantity: int = 1
    price: Decimal
    discount_amount: Decimal = Decimal("0.00")


class SaleCreate(BaseModel):
    customer_id: Optional[int] = None
    items: List[SaleItemCreate]
    payment_method: str = "Cash"
    cash_amount: Decimal = Decimal("0.00")
    card_amount: Decimal = Decimal("0.00")


class SaleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    invoice_no: str
    subtotal: Decimal
    discount_total: Decimal
    tax_total: Decimal
    grand_total: Decimal
    payment_status: str
    created_at: datetime

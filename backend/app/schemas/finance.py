from typing import Optional
from pydantic import BaseModel, ConfigDict
from decimal import Decimal
from datetime import datetime


class ExpenseCreate(BaseModel):
    category: str
    amount: Decimal
    tax_amount: Decimal = Decimal("0.00")
    payment_method: str = "Cash"
    description: Optional[str] = None
    vendor: Optional[str] = None


class ExpenseOut(ExpenseCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    date: datetime
    created_at: Optional[datetime] = None

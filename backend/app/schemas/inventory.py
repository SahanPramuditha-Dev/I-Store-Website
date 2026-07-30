from typing import Optional
from pydantic import BaseModel, ConfigDict
from decimal import Decimal


class InventoryItemCreate(BaseModel):
    name: str
    sku: str
    category_id: Optional[int] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    storage: Optional[str] = None
    color: Optional[str] = None
    condition: Optional[str] = None
    product_type: Optional[str] = None
    quantity: int = 0
    cost_price: Decimal = Decimal("0.00")
    selling_price: Decimal = Decimal("0.00")
    wholesale_price: Decimal = Decimal("0.00")


class InventoryItemOut(InventoryItemCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    reorder_level: int = 5
    is_deleted: bool = False

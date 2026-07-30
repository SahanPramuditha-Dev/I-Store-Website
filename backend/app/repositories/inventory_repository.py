from typing import List, Optional
from sqlalchemy.orm import Session
from app.models import InventoryItem, InventorySerial


class InventoryRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, item_id: int) -> Optional[InventoryItem]:
        return self.db.query(InventoryItem).filter(InventoryItem.id == item_id).first()

    def get_serial_by_id(self, serial_id: int) -> Optional[InventorySerial]:
        return self.db.query(InventorySerial).filter(InventorySerial.id == serial_id).first()

    def list_items(self, skip: int = 0, limit: int = 100) -> List[InventoryItem]:
        return (
            self.db.query(InventoryItem)
            .filter(InventoryItem.is_deleted == False)  # noqa: E712
            .offset(skip)
            .limit(limit)
            .all()
        )

    def update_quantity(self, item_id: int, quantity_change: int) -> Optional[InventoryItem]:
        item = self.get_by_id(item_id)
        if item:
            item.quantity = (item.quantity or 0) + quantity_change
            self.db.flush()
        return item

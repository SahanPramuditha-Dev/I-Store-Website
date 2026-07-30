import uuid
import logging
from typing import Optional, List, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models import InventoryItem, InventoryLedger, SyncOutbox

logger = logging.getLogger("istore.inventory_service")


class InventoryService:
    """Enterprise Immutable Inventory Ledger Service enforcing calculation-based stock tracking."""

    @staticmethod
    def get_calculated_stock(db: Session, item_id: int, store_id: Optional[str] = None) -> float:
        """Calculate real-time stock balance from sum of ledger quantity changes."""
        query = db.query(func.coalesce(func.sum(InventoryLedger.quantity_change), 0.0)).filter(
            InventoryLedger.item_id == item_id
        )
        if store_id:
            query = query.filter(InventoryLedger.store_id == store_id)
        return float(query.scalar() or 0.0)

    @staticmethod
    def _record_ledger_and_outbox(
        db: Session,
        item_id: int,
        movement_type: str,
        quantity_change: float,
        unit_cost: float = 0.0,
        reference_id: Optional[str] = None,
        store_id: Optional[str] = None,
        created_by: Optional[int] = None,
        notes: Optional[str] = None,
    ) -> InventoryLedger:
        item = db.query(InventoryItem).filter(InventoryItem.id == item_id).first()
        if not item:
            raise ValueError(f"Inventory item with ID {item_id} does not exist.")

        # Create Ledger Record
        ledger_entry = InventoryLedger(
            id=str(uuid.uuid4()),
            item_id=item_id,
            item_uuid=getattr(item, "uuid", None),
            store_id=store_id,
            movement_type=movement_type.upper(),
            reference_id=reference_id,
            quantity_change=quantity_change,
            unit_cost=unit_cost,
            created_by=created_by,
            notes=notes,
        )
        db.add(ledger_entry)
        db.flush()

        # Update cache on item table for instant reads while maintaining ledger source of truth
        new_calculated = InventoryService.get_calculated_stock(db, item_id, store_id)
        item.quantity = max(0, int(new_calculated))
        db.flush()

        # Enqueue Outbox Sync Event
        outbox_event = SyncOutbox(
            id=str(uuid.uuid4()),
            entity_type="InventoryLedger",
            entity_id=ledger_entry.id,
            action="CREATE",
            payload=f'{{"item_id": {item_id}, "movement_type": "{movement_type}", "quantity_change": {quantity_change}, "reference_id": "{reference_id or ""}"}}',
            status="pending",
        )
        db.add(outbox_event)
        
        return ledger_entry

    @classmethod
    def receive_stock(
        cls,
        db: Session,
        item_id: int,
        quantity: float,
        unit_cost: float,
        reference_id: Optional[str] = None,
        store_id: Optional[str] = None,
        created_by: Optional[int] = None,
        notes: Optional[str] = None,
    ) -> InventoryLedger:
        """Record GRN stock reception (+ quantity)."""
        return cls._record_ledger_and_outbox(
            db, item_id, "GRN", abs(quantity), unit_cost, reference_id, store_id, created_by, notes
        )

    @classmethod
    def sell_stock(
        cls,
        db: Session,
        item_id: int,
        quantity: float,
        unit_cost: float = 0.0,
        reference_id: Optional[str] = None,
        store_id: Optional[str] = None,
        created_by: Optional[int] = None,
        notes: Optional[str] = None,
    ) -> InventoryLedger:
        """Record POS sale deduction (- quantity)."""
        return cls._record_ledger_and_outbox(
            db, item_id, "SALE", -abs(quantity), unit_cost, reference_id, store_id, created_by, notes
        )

    @classmethod
    def return_stock(
        cls,
        db: Session,
        item_id: int,
        quantity: float,
        unit_cost: float = 0.0,
        reference_id: Optional[str] = None,
        store_id: Optional[str] = None,
        created_by: Optional[int] = None,
        notes: Optional[str] = None,
    ) -> InventoryLedger:
        """Record Customer Return (+ quantity)."""
        return cls._record_ledger_and_outbox(
            db, item_id, "RETURN", abs(quantity), unit_cost, reference_id, store_id, created_by, notes
        )

    @classmethod
    def adjust_stock(
        cls,
        db: Session,
        item_id: int,
        quantity_change: float,
        unit_cost: float = 0.0,
        reference_id: Optional[str] = None,
        store_id: Optional[str] = None,
        created_by: Optional[int] = None,
        notes: Optional[str] = None,
    ) -> InventoryLedger:
        """Record Manual Stock Adjustment (+/- quantity)."""
        return cls._record_ledger_and_outbox(
            db, item_id, "ADJUSTMENT", quantity_change, unit_cost, reference_id, store_id, created_by, notes
        )

    @classmethod
    def transfer_stock(
        cls,
        db: Session,
        item_id: int,
        quantity: float,
        from_store_id: str,
        to_store_id: str,
        reference_id: Optional[str] = None,
        created_by: Optional[int] = None,
    ) -> List[InventoryLedger]:
        """Record Store-to-Store Stock Transfer (- at source, + at destination)."""
        out_entry = cls._record_ledger_and_outbox(
            db, item_id, "TRANSFER", -abs(quantity), 0.0, reference_id, from_store_id, created_by, f"Transfer out to {to_store_id}"
        )
        in_entry = cls._record_ledger_and_outbox(
            db, item_id, "TRANSFER", abs(quantity), 0.0, reference_id, to_store_id, created_by, f"Transfer in from {from_store_id}"
        )
        return [out_entry, in_entry]

inventory_service = InventoryService()

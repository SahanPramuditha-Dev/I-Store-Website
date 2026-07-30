from typing import List, Optional
from sqlalchemy.orm import Session, joinedload
from app.models import Sale, SaleItem


class SalesRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, sale_id: int) -> Optional[Sale]:
        return (
            self.db.query(Sale)
            .options(joinedload(Sale.items))
            .filter(Sale.id == sale_id)
            .first()
        )

    def list_sales(self, skip: int = 0, limit: int = 100) -> List[Sale]:
        return (
            self.db.query(Sale)
            .options(joinedload(Sale.items))
            .order_by(Sale.id.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )

    def create(self, sale: Sale) -> Sale:
        self.db.add(sale)
        self.db.flush()
        return sale

    def add_item(self, sale_item: SaleItem) -> SaleItem:
        self.db.add(sale_item)
        self.db.flush()
        return sale_item

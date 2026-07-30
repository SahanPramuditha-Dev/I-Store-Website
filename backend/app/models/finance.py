from app.database import Base
from sqlalchemy import Column, Integer, String, Numeric, DateTime, Boolean, ForeignKey, Text


class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(String, nullable=False, index=True)
    amount = Column(Numeric(12, 2), nullable=False, default=0)
    tax_amount = Column(Numeric(12, 2), default=0)
    payment_method = Column(String, default="Cash")
    description = Column(Text, nullable=True)
    vendor = Column(String, nullable=True)
    receipt_ref = Column(String, nullable=True)
    date = Column(DateTime, nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    is_deleted = Column(Boolean, default=False)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(Integer, nullable=True)
    delete_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, nullable=True)


class AccountingLedgerEntry(Base):
    __tablename__ = "accounting_ledger_entries"

    id = Column(Integer, primary_key=True, index=True)
    entry_code = Column(String, unique=True, index=True, nullable=False)
    entry_date = Column(DateTime, nullable=False, index=True)
    source_module = Column(String, nullable=False)
    source_reference = Column(String, nullable=False)
    account_code = Column(String, nullable=False, index=True)
    account_name = Column(String, nullable=False)
    entry_type = Column(String, nullable=False)
    debit = Column(Numeric(12, 2), default=0)
    credit = Column(Numeric(12, 2), default=0)
    amount = Column(Numeric(12, 2), default=0)
    narrative = Column(Text, nullable=True)
    created_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False)

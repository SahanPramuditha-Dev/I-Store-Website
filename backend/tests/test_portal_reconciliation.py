import json
import pytest
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.database import Base
from app.models import Customer, Sale, SaleItem, SyncOutbox, Return
from app.services.portal_reconciliation import reconcile_customer_bills

@pytest.fixture
def db(monkeypatch):
    monkeypatch.setenv('CLOUDFLARE_PORTAL_ENABLED','true')
    monkeypatch.setenv('CLOUDFLARE_PORTAL_STORE_REF','shop')
    monkeypatch.setenv('CLOUDFLARE_PORTAL_ORGANIZATION_ID','1')
    monkeypatch.setenv('CLOUDFLARE_PORTAL_BRANCH_ID','1')
    monkeypatch.setenv('CLOUDFLARE_RECEIPT_LINK_KEY','k'*43)
    engine=create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        customer=Customer(id=1,name='Synthetic customer',phone='0771234567',organization_id=1)
        other=Customer(id=2,name='Other tenant',phone='0771111111',organization_id=2)
        db.add_all([customer,other])
        db.add_all([Sale(id=1,invoice_no='OLD-1',customer_id=1,organization_id=1,branch_id=1,subtotal=100,total=100,amount_paid=50,balance_due=50,paid=False,created_at=datetime(2020,1,1)),
                    Sale(id=2,invoice_no='OTHER-1',customer_id=2,organization_id=2,branch_id=2,subtotal=100,total=100,created_at=datetime(2020,1,1))])
        db.add(SaleItem(sale_id=1,description='Item',price=100,quantity=1))
        db.commit()
        yield db
    engine.dispose()

def scan(db):
    # Complete a cursor wrap so mutations to older records are revisited.
    return [reconcile_customer_bills(db),reconcile_customer_bills(db)]

def events(db):
    return [json.loads(e.payload) for e in db.query(SyncOutbox).order_by(SyncOutbox.id).all()]

def test_backfill_and_unchanged_records_use_no_additional_cloud_jobs(db):
    scan(db)
    assert len(events(db))==1
    assert events(db)[0]['bill']['issuedAt'].startswith('2020-01-01')
    scan(db)
    assert len(events(db))==1
    assert events(db)[0]['bill']['invoiceRef']=='OLD-1' # no other tenant

def test_payment_refund_and_cancellation_updates(db):
    scan(db)
    sale=db.get(Sale,1); sale.amount_paid=100; sale.balance_due=0; sale.paid=True
    db.commit(); scan(db)
    assert any(e.get('bill',{}).get('amountPaid')==100 for e in events(db))
    db.add(Return(original_invoice_id=1,organization_id=1,customer_id=1,reason='Test',refund_amount=25,decision_status='refunded'))
    db.commit(); scan(db)
    assert any(e.get('bill',{}).get('status')=='Partially refunded' and e['bill']['refundAmount']==25 for e in events(db))
    sale.is_voided=True; db.commit(); scan(db)
    assert any(e.get('bill',{}).get('status')=='Cancelled' for e in events(db))

@pytest.mark.parametrize('change',['phone','customer','delete'])
def test_identity_change_or_deletion_revokes_instead_of_transferring(db,change):
    scan(db)
    if change=='phone': db.get(Customer,1).phone='0777654321'
    elif change=='customer': db.get(Sale,1).customer_id=2
    else: db.get(Sale,1).is_deleted=True
    db.commit(); scan(db)
    assert sum(e.get('revoked') is True for e in events(db))==1
    scan(db)
    assert len(events(db))==2

def test_tenant_must_be_explicit(db,monkeypatch):
    monkeypatch.delenv('CLOUDFLARE_PORTAL_ORGANIZATION_ID')
    assert reconcile_customer_bills(db)['status']=='tenant_configuration_required'
    assert not events(db)


def test_print_link_requires_queued_matching_identity(db, monkeypatch):
    from app.services.cloudflare_portal_sync import printable_portal_url
    monkeypatch.setenv('CLOUDFLARE_PORTAL_URL', 'https://portal.example')
    sale = db.get(Sale, 1)
    assert printable_portal_url(db, sale) is None
    scan(db)
    assert printable_portal_url(db, sale).startswith('https://portal.example/r/')
    assert printable_portal_url(db, db.get(Sale, 2)) is None
    db.get(Customer, 1).phone = '0777654321'
    db.commit()
    assert printable_portal_url(db, sale) is None
    scan(db)
    assert printable_portal_url(db, sale) is None


def test_print_link_rejects_changed_customer_same_phone(db, monkeypatch):
    from app.services.cloudflare_portal_sync import printable_portal_url
    monkeypatch.setenv('CLOUDFLARE_PORTAL_URL', 'https://portal.example')
    scan(db)
    db.add(Customer(id=3, name='Replacement', phone='0771234567', organization_id=1))
    sale = db.get(Sale, 1)
    sale.customer_id = 3
    db.commit()
    assert printable_portal_url(db, sale) is None


def test_print_qr_is_local_and_missing_links_are_omitted():
    from app.services.print_rendering_service import _portal_qr_html, render_invoice_html_from_store
    assert _portal_qr_html({}) == ''
    html = render_invoice_html_from_store({'invoice_number': 'TEST', 'customer_portal_url': 'https://portal.example/r/' + 'a'*43}, {})
    assert 'data:image/svg+xml;base64,' in html
    assert 'api.qrserver.com' not in html
    assert 'sec_' not in html
    assert 'data:image/svg+xml;base64,' not in render_invoice_html_from_store({'invoice_number': 'TEST'}, {})

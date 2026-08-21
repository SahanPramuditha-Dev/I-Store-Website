import logging
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from app.models import WarrantyRecord, Sale, RepairTicket, Customer
from app.utils.whatsapp_helper import log_and_send_whatsapp
from app.services.supabase_pos_sync import generate_invoice_token

logger = logging.getLogger(__name__)

def send_warranty_expiry_reminders(db: Session):
    """Send WhatsApp reminders 30 days before warranty expiry."""
    now = datetime.utcnow()
    horizon = now + timedelta(days=30)
    
    try:
        # query WarrantyRecord where status='active' AND end_date BETWEEN now AND horizon
        expiring_warranties = db.query(WarrantyRecord).filter(
            WarrantyRecord.status == 'active',
            WarrantyRecord.end_date >= now,
            WarrantyRecord.end_date <= horizon
        ).all()
        
        for record in expiring_warranties:
            try:
                # Look up phone
                phone = record.customer_phone
                if not phone and record.customer_id:
                    customer = db.query(Customer).filter(Customer.id == record.customer_id).first()
                    if customer:
                        phone = customer.phone
                
                if phone:
                    variables = {
                        "customer_name": record.customer_name or "Valued Customer",
                        "product_name": record.product_or_service_name or "Product",
                        "serial_number": record.imei_or_serial or record.serial_number or "N/A",
                        "expiry_date": record.end_date.strftime("%Y-%m-%d") if record.end_date else "N/A",
                    }
                    log_and_send_whatsapp(
                        event_type='warranty_expiring',
                        phone=phone,
                        variables=variables,
                        customer_id=record.customer_id
                    )
            except Exception as e:
                logger.warning(f"Failed to send warranty reminder for record {record.id}: {e}")
                
    except Exception as e:
        logger.error(f"Error in send_warranty_expiry_reminders: {e}")


def send_payment_reminders(db: Session):
    """Send WhatsApp reminders for invoices unpaid for 7+ days."""
    now = datetime.utcnow()
    cutoff = now - timedelta(days=7)
    
    try:
        # Query Sale where paid=False AND balance_due>0 AND created_at<cutoff AND customer_id IS NOT NULL
        unpaid_sales = db.query(Sale).filter(
            Sale.paid == False,
            Sale.balance_due > 0,
            Sale.created_at < cutoff,
            Sale.customer_id.isnot(None)
        ).all()
        
        # Group by customer, send one reminder per customer
        processed_customers = set()
        for sale in unpaid_sales:
            try:
                if sale.customer_id in processed_customers:
                    continue
                
                customer = db.query(Customer).filter(Customer.id == sale.customer_id).first()
                if customer and customer.phone:
                    smart_bill_url = f"https://i-store-customer-portal-one.vercel.app/invoice/{sale.invoice_no}?token={generate_invoice_token(sale.invoice_no)}"
                    variables = {
                        "customer_name": customer.name or "Valued Customer",
                        "invoice_number": sale.invoice_no or str(sale.id),
                        "balance_due": f"{sale.balance_due:,.2f}",
                        "smart_bill_url": smart_bill_url
                    }
                    
                    log_and_send_whatsapp(
                        event_type='payment_reminder',
                        phone=customer.phone,
                        variables=variables,
                        customer_id=customer.id,
                        invoice_no=sale.invoice_no
                    )
                    processed_customers.add(sale.customer_id)
            except Exception as e:
                logger.warning(f"Failed to send payment reminder for sale {sale.id}: {e}")
                
    except Exception as e:
        logger.error(f"Error in send_payment_reminders: {e}")


def send_repair_overdue_alerts(db: Session):
    """Send WhatsApp alerts for repairs past estimated completion."""
    now = datetime.utcnow()
    
    try:
        # Query RepairTicket where estimated_completion<now AND status NOT IN ('delivered','cancelled','completed','Delivered','Cancelled')
        overdue_repairs = db.query(RepairTicket).filter(
            RepairTicket.estimated_completion < now,
            ~RepairTicket.status.in_(['delivered', 'cancelled', 'completed', 'Delivered', 'Cancelled'])
        ).all()
        
        for ticket in overdue_repairs:
            try:
                customer = db.query(Customer).filter(Customer.id == ticket.customer_id).first() if ticket.customer_id else None
                phone = customer.phone if customer else getattr(ticket, 'customer_phone', None)
                
                if phone:
                    variables = {
                        "customer_name": customer.name if customer else "Valued Customer",
                        "job_number": ticket.job_number or str(ticket.id),
                        "device_model": ticket.device_model or "Device",
                        "reported_issue": ticket.reported_issue or "Repair",
                        "repair_status": ticket.status or "In Progress",
                        "status_note": "Your repair is overdue. We apologize for the delay.",
                        "estimated_cost": f"{ticket.estimated_cost:,.2f}" if getattr(ticket, 'estimated_cost', None) else "0.00",
                        "advance_paid": f"{ticket.advance_paid:,.2f}" if getattr(ticket, 'advance_paid', None) else "0.00",
                        "balance_due": f"{ticket.balance_due:,.2f}" if getattr(ticket, 'balance_due', None) else "0.00",
                        "repair_tracking_url": f"https://i-store-customer-portal-one.vercel.app/repair/{ticket.job_number}" if getattr(ticket, 'job_number', None) else ""
                    }
                    
                    log_and_send_whatsapp(
                        event_type='repair_status',
                        phone=phone,
                        variables=variables,
                        customer_id=ticket.customer_id,
                        repair_no=ticket.job_number if getattr(ticket, 'job_number', None) else None
                    )
            except Exception as e:
                logger.warning(f"Failed to send repair overdue alert for ticket {ticket.id}: {e}")
                
    except Exception as e:
        logger.error(f"Error in send_repair_overdue_alerts: {e}")


def run_ai_follow_up_job(db: Session):
    """Processes queued AI follow-ups respecting quiet hours and customer responses."""
    import asyncio
    try:
        from app.services.ai_followup_service import process_due_follow_up_queue
        # Run async dispatcher in event loop
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        if loop.is_running():
            asyncio.create_task(process_due_follow_up_queue(db))
        else:
            loop.run_until_complete(process_due_follow_up_queue(db))
    except Exception as e:
        logger.error(f"Error in run_ai_follow_up_job: {e}")


def run_ai_inactivity_resolution_job(db: Session):
    """Auto-resolves stagnant human-requested sessions (35+ min silence) and sends CSAT prompt."""
    import asyncio
    try:
        from app.services.ai_session_resolver import process_inactivity_session_resolutions
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        if loop.is_running():
            asyncio.create_task(process_inactivity_session_resolutions(db))
        else:
            loop.run_until_complete(process_inactivity_session_resolutions(db))
    except Exception as e:
        logger.error(f"Error in run_ai_inactivity_resolution_job: {e}")


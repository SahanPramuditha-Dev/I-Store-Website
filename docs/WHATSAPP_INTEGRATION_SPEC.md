# 📱 I-Store ERP — Full WhatsApp Integration Audit & Technical Specification

## 1. Executive Summary & Recommended Priority Order

This document provides a complete audit of **I-Store ERP** across both the **FastAPI Backend** and **React Frontend**, detailing all WhatsApp messaging integration points, event triggers, settings, permissions, templates, and database schemas.

### Recommended Implementation Phases

| Phase | Module / Feature | Priority | Implementation Focus |
| :--- | :--- | :--- | :--- |
| **Phase 1** | 🧾 POS Sales & Invoices | ⭐⭐⭐⭐⭐ | Automated WhatsApp receipt/invoice PDF sending on checkout. |
| **Phase 1** | 🔧 Repair Management | ⭐⭐⭐⭐⭐ | Status change alerts (`RECEIVED` → `COMPLETED` → `READY_FOR_PICKUP`). |
| **Phase 2** | 🛡️ Warranty Management | ⭐⭐⭐█ | Automated 7-day prior warranty expiry reminders via scheduler. |
| **Phase 2** | 💰 Payments & Ledger | ⭐⭐⭐█ | Partial payment receipt & outstanding balance reminders. |
| **Phase 2** | 👤 Customer CRM | ⭐⭐⭐  | Direct 1-on-1 WhatsApp chat modal in Customer Profile view. |
| **Phase 3** | 🔐 Auth & Security | ⭐⭐⭐█ | Manager PIN override alerts & OTP dispatch. |
| **Phase 3** | 📦 Inventory Alerts | ⭐⭐   | Internal low-stock alerts sent to store owner/manager. |

---

## 2. Complete Integration Matrix Table

| Feature Module | Trigger File / Endpoint | Recipient | Payload Type | Default Trigger Event | Priority |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **POS Sales Checkout** | `backend/app/routers/pos_router.py` (`POST /api/pos/checkout`) | Customer | Text + Link | Automatic upon completing a transaction | ⭐⭐⭐⭐⭐ |
| **Invoice Creation** | `backend/app/routers/invoices_router.py` (`POST /api/invoices`) | Customer | PDF Document | Manual click or automatic on issue | ⭐⭐⭐⭐⭐ |
| **Repair Job Received** | `backend/app/routers/repair_router.py` (`POST /api/repairs`) | Customer | Text + Job ID | Automatic when repair intake is saved | ⭐⭐⭐⭐⭐ |
| **Repair Status Change** | `backend/app/routers/repair_router.py` (`PUT /api/repairs/{id}`) | Customer | Text | Automatic when status changes | ⭐⭐⭐⭐⭐ |
| **Warranty Registration** | `backend/app/routers/warranty_router.py` (`POST /api/warranties`) | Customer | Text | Automatic upon registering serial warranty | ⭐⭐⭐█ |
| **Warranty Expiry Notice** | Scheduled background task in `main.py` | Customer | Text | Scheduled background task (7 days prior) | ⭐⭐⭐█ |
| **Payment Receipt** | `backend/app/routers/payments_router.py` (`POST /api/payments`) | Customer | Text | Automatic when deposit/payment is added | ⭐⭐⭐█ |
| **Direct Customer Chat** | `backend/app/routers/customer_router.py` | Customer | Text / File | Manual click from Customer Profile UI | ⭐⭐⭐ |
| **Low-Stock Alert** | `backend/app/routers/inventory_router.py` | Owner / Admin | Text | Automatic when stock drops below threshold | ⭐⭐ |
| **Security PIN Override** | `backend/app/routers/access_router.py` | Owner / Admin | Text | Automatic when manager override PIN is used | ⭐⭐⭐█ |

---

## 3. Module Categorization & Dynamic Message Templates

### 🧾 1. Sales & POS Receipts
* **Trigger Endpoint**: `POST /api/pos/checkout`
* **Default Template**:
  > *"Dear {customer_name}, thank you for shopping at {store_name}! Your invoice #{invoice_number} for LKR {total_amount} is ready. View receipt: {receipt_url}"*

### 🔧 2. Repair Management
* **Trigger Endpoint**: `PUT /api/repairs/{id}/status`
* **Default Template**:
  > *"Hello {customer_name}, your repair job #{job_number} ({device_model}) status has been updated to: *{repair_status}*. Estimated total: LKR {estimated_cost}. Balance due: LKR {balance_due}."*

### 🛡️ 3. Warranty & Reminders
* **Trigger Endpoint**: Scheduled Job (Daily check at 09:00 AM)
* **Default Template**:
  > *"Dear {customer_name}, your warranty for {product_name} (Serial: {serial_number}) will expire on {expiry_date}. Contact {store_phone} for extension options."*

### 💰 4. Payments & Ledger
* **Trigger Endpoint**: `POST /api/payments`
* **Default Template**:
  > *"Payment Received! Thank you {customer_name}, we received LKR {payment_amount} for Invoice #{invoice_number}. Remaining Balance: LKR {remaining_balance}."*

### 🔐 5. Security & Manager Override
* **Trigger Endpoint**: `POST /api/access/verify-override-pin`
* **Default Template**:
  > *"⚠️ Security Alert: Manager Override PIN used by {cashier_name} for transaction #{transaction_id} on {timestamp}."*

---

## 4. Settings & Customization Controls

The **WhatsApp Settings Panel** inside `frontend/src/components/settings/WhatsAppSettingsCard.jsx` supports four primary sub-sections:

### 1. Connection & Gateway Status
- Real-time connection badge (`CONNECTED`, `UNPAIRED`, `OFFLINE`).
- Embedded live Base64 QR Code scanner.
- Disconnect / Reconnect session control button.

### 2. Per-Module Notification Matrix
Toggle switches stored in database `settings`:
- `whatsapp_send_receipt_on_checkout` (Boolean)
- `whatsapp_send_repair_status_updates` (Boolean)
- `whatsapp_send_warranty_expiry_alerts` (Boolean)
- `whatsapp_send_payment_confirmations` (Boolean)
- `whatsapp_send_security_pin_alerts` (Boolean)
- `whatsapp_send_low_stock_staff_alerts` (Boolean)

### 3. Template Customizer & Live Variable Insertion
A template editor with placeholders:
- Dynamic Variables: `{customer_name}`, `{store_name}`, `{invoice_number}`, `{total_amount}`, `{job_number}`, `{device_model}`, `{repair_status}`, `{balance_due}`, `{date}`.
- Phone Mockup Preview rendering changes in real-time.

### 4. Access Control & Role Permissions
- **Owner / Admin**: Full access to configure templates, view message logs, and toggle integrations.
- **Manager**: Can send manual customer WhatsApp messages and view logs.
- **Cashier / Technician**: Trigger automatic receipts/repair updates on transaction save.

---

## 5. Proposed Database Schema Additions

### `whatsapp_templates` Table
```sql
CREATE TABLE whatsapp_templates (
    id VARCHAR(50) PRIMARY KEY, -- e.g., 'pos_receipt', 'repair_update'
    module_name VARCHAR(50) NOT NULL,
    template_text TEXT NOT NULL,
    is_enabled BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `whatsapp_message_logs` Table
```sql
CREATE TABLE whatsapp_message_logs (
    id VARCHAR(50) PRIMARY KEY,
    recipient_phone VARCHAR(20) NOT NULL,
    recipient_name VARCHAR(100),
    module_name VARCHAR(50) NOT NULL,
    message_body TEXT NOT NULL,
    status VARCHAR(20) NOT NULL, -- 'SENT', 'FAILED', 'PENDING'
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 6. Step-by-Step Implementation Roadmap

1. **Step 1 (Schema & Helper)**: Add `whatsapp_templates` and `whatsapp_message_logs` tables to Alembic migrations and database models.
2. **Step 2 (Router Integration)**: Connect `whatsapp_helper.py` to `pos_router.py`, `repair_router.py`, `payments_router.py`, and `warranty_router.py`.
3. **Step 3 (Settings UI Expansion)**: Add the template customizer and toggle switches matrix to `WhatsAppSettingsCard.jsx`.
4. **Step 4 (CRM Integration)**: Add a `💬 Send WhatsApp` button inside the Customer Details Modal (`customer_router.py` / `CustomerProfileModal.jsx`).

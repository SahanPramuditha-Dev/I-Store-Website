import copy
import json
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auth import get_current_user, hash_password, require_permission
from app.database import get_db
from app.models import AppSetting, Permission, Role, SecurityAuditLog, User
from app.schemas import EmployeeIn, EmployeeUpdateIn, PrintProfileIn, UiPreferencesIn
from app.services.security_service import (
    build_session_payload,
    canonical_role_name,
    clear_user_permission_override,
    enforce_owner_user_change_guard,
    ensure_security_defaults,
    get_active_sessions,
    get_effective_permission_codes,
    get_request_device_info,
    get_request_ip,
    get_security_settings,
    get_user_permission_override_payload,
    has_permission,
    normalize_role_for_legacy,
    record_security_audit,
    role_matrix_payload,
    set_role_permissions,
    set_role_permissions_bulk,
    set_security_settings,
    set_user_permission_override,
    utcnow,
    validate_password_against_policy,
    validate_pin,
)

router = APIRouter(prefix="/settings", tags=["settings"])


def _require_access_permission(db: Session, user: User, permission: str) -> None:
    if not has_permission(db, user, permission):
        raise HTTPException(status_code=403, detail=f"Permission denied: {permission}")

PRINT_PROFILE_KEY = "print_profile"
UI_PREFERENCES_KEY = "ui_preferences"
BUSINESS_PREFS_KEY = "business_preferences"
INTEGRATIONS_PREFS_KEY = "integrations_preferences"
SETTINGS_STATE_KEY = "settings_state_v2"
EMPLOYEE_PROFILES_KEY = "employee_profiles"


DEFAULT_PRINT_PROFILE = {
    "format": "A4",
    "store_name": "I Point",
    "store_address": "No 123, Main Street, Colombo",
    "store_phone": "+94 77 123 4567",
    "store_email": "info@istore.com",
    "store_website": "www.istore.com",
    "tax_number": "",
    "business_reg_no": "",
    "footer_note": "Thank you. Visit again.",
    "show_logo": True,
    "logo_data": "",
    "logo_size": 80,
    "accent_color": "#0ea5e9",
    "font_family": "Inter",
    "show_shop_email": True,
    "show_shop_phone": True,
    "show_shop_website": True,
    "show_tax_no": True,
    "show_reg_no": False,
    "show_customer_address": True,
    "show_customer_phone": True,
    "show_customer_email": False,
    "show_invoice_date": True,
    "show_invoice_time": True,
    "show_cashier_name": True,
    "show_technician_name": True,
    "show_device_imei": True,
    "show_device_serial": False,
    "show_device_color": True,
    "show_device_condition": True,
    "show_device_accessories": True,
    "show_password_field": False,
    "show_sku_column": False,
    "show_warranty_column": True,
    "show_discount_column": True,
    "show_tax_column": True,
    "show_advance_payment": True,
    "show_remaining_balance": True,
    "show_bank_details": True,
    "show_return_policy": True,
    "show_warranty_terms": True,
    "show_signatures": True,
    "show_qr_code": True,
    "slogan": "Your No.01 Mobile Partner",
    "bank_details": "1000526309 - Commercial bank",
    "repair_terms": "1. Minimum diagnostic fee applies.\n2. Not responsible for data loss.",
    "return_policy": "Items can be returned within 7 days with original receipt.",
    "warranty_terms": "Warranty covers hardware defects only.",
    "margin_mm": 10,
    "label_width": 50,
    "label_height": 25,
    "show_curves": True,
    "show_table_borders": True,
    "show_slogan": True,
}

DEFAULT_UI_PREFERENCES = {"theme": "dark", "compact_mode": True}
DEFAULT_BUSINESS_PREFS = {"currency": "LKR", "tax_rate": 0, "date_format": "DD/MM/YYYY"}
DEFAULT_INTEGRATIONS_PREFS = {"whatsapp_api_key": "", "whatsapp_phone_number_id": "", "enable_sms_alerts": False}

DEFAULT_EMPLOYEE_PROFILE = {
    "phone_number": "",
    "email": "",
    "pin": "",
    "profile_photo": "",
    "notes": "",
    "last_login": None,
    "created_by": "system",
    "created_on": None,
}

DEFAULT_SETTINGS_STATE = {
    "store_profile": {
        "business_identity": {
            "shop_name": "I Point",
            "business_type": "Mobile Phone Shop",
            "registration_number": "",
            "tax_vat_number": "",
            "shop_tagline": "Your trusted mobile partner",
            "invoice_footer_text": "Thank you. Visit again.",
            "warranty_terms": "Warranty covers hardware defects only.",
            "receipt_message": "Thank you for your purchase!",
        },
        "contact_information": {
            "primary_phone": "",
            "secondary_phone": "",
            "whatsapp_number": "",
            "email_address": "",
            "website_url": "",
        },
        "address": {
            "address_line_1": "",
            "address_line_2": "",
            "city": "",
            "district": "",
            "province": "",
            "postal_code": "",
            "country": "Sri Lanka",
        },
        "business_hours": {
            "monday": {"open": "09:00", "close": "19:00", "enabled": True},
            "tuesday": {"open": "09:00", "close": "19:00", "enabled": True},
            "wednesday": {"open": "09:00", "close": "19:00", "enabled": True},
            "thursday": {"open": "09:00", "close": "19:00", "enabled": True},
            "friday": {"open": "09:00", "close": "19:00", "enabled": True},
            "saturday": {"open": "09:00", "close": "17:00", "enabled": True},
            "sunday": {"open": "09:00", "close": "14:00", "enabled": False},
            "public_holiday_mode": "Auto-close",
            "after_hours_login_alert": True,
        },
        "logo_branding": {
            "shop_logo": "",
            "favicon": "",
            "receipt_logo_mode": "same_as_shop_logo",
            "receipt_logo": "",
            "logo_position_on_receipt": "Center",
        },
        "social_media": {
            "facebook_url": "",
            "instagram_handle": "",
            "tiktok_handle": "",
        },
    },
    "access_control": {
        "role_definitions": [
            {"role": "Owner", "level": 5, "description": "Full system access, billing, all settings"},
            {"role": "Admin", "level": 4, "description": "All features except billing/license"},
            {"role": "Manager", "level": 3, "description": "Operations + reports, no system settings"},
            {"role": "Accountant", "level": 3, "description": "Financial controls, reports, expenses"},
            {"role": "Storekeeper", "level": 2, "description": "Inventory operations, GRN, stock take"},
            {"role": "Technician", "level": 2, "description": "Repair module only + own jobs"},
            {"role": "Cashier / Staff", "level": 1, "description": "POS + basic customer operations"},
            {"role": "Viewer", "level": 0, "description": "Read-only, no edits"},
        ],
        "permission_matrix": [
            {"module": "Dashboard", "owner": True, "admin": True, "manager": True, "technician": True, "cashier": True, "view_only": True},
            {"module": "POS / Billing", "owner": True, "admin": True, "manager": True, "technician": False, "cashier": True, "view_only": False},
            {"module": "Repair Management", "owner": True, "admin": True, "manager": True, "technician": True, "cashier": False, "view_only": False},
            {"module": "Inventory", "owner": True, "admin": True, "manager": True, "technician": False, "cashier": False, "view_only": False},
            {"module": "Customers", "owner": True, "admin": True, "manager": True, "technician": False, "cashier": True, "view_only": False},
            {"module": "Reports (View)", "owner": True, "admin": True, "manager": True, "technician": False, "cashier": False, "view_only": True},
            {"module": "Reports (Export)", "owner": True, "admin": True, "manager": True, "technician": False, "cashier": False, "view_only": False},
            {"module": "Financial Audit", "owner": True, "admin": True, "manager": True, "technician": False, "cashier": False, "view_only": False},
            {"module": "Audit Trail", "owner": True, "admin": True, "manager": False, "technician": False, "cashier": False, "view_only": False},
            {"module": "Labels", "owner": True, "admin": True, "manager": True, "technician": True, "cashier": True, "view_only": False},
            {"module": "Suppliers", "owner": True, "admin": True, "manager": True, "technician": False, "cashier": False, "view_only": False},
            {"module": "Expenses", "owner": True, "admin": True, "manager": True, "technician": False, "cashier": False, "view_only": False},
            {"module": "Advance Payments", "owner": True, "admin": True, "manager": True, "technician": True, "cashier": True, "view_only": False},
            {"module": "Product Reservations", "owner": True, "admin": True, "manager": True, "technician": True, "cashier": True, "view_only": False},
            {"module": "Settings", "owner": True, "admin": True, "manager": False, "technician": False, "cashier": False, "view_only": False},
            {"module": "Backup", "owner": True, "admin": True, "manager": False, "technician": False, "cashier": False, "view_only": False},
        ],
        "custom_roles": [],
        "session_security_rules": {
            "session_timeout_minutes": 30,
            "max_failed_login_attempts": 5,
            "account_lockout_duration_minutes": 15,
            "require_password_change_days": 90,
            "minimum_password_length": 8,
            "require_complex_password": True,
            "allow_concurrent_logins": False,
            "after_hours_login_mode": "Alert only",
            "pos_pin_login_enabled": True,
            "pin_length": 4,
        },
    },
    "business_ops": {
        "sales_pos_rules": {
            "allow_credit_sales": True,
            "default_credit_limit": 50000,
            "max_credit_override": 100000,
            "allow_selling_below_cost": False,
            "require_customer_above": 10000,
            "void_approval_threshold": 100000,
            "refund_approval_threshold": 100000,
            "auto_apply_loyalty_discount": False,
            "walk_in_customer_default_name": "Walk-in Customer",
            "default_payment_method": "Cash",
            "allow_split_payments": True,
            "enable_rounding": True,
            "rounding_rule": "Nearest 1.00",
        },
        "discount_rules": {
            "max_discount_cashier_percent": 10,
            "max_discount_manager_percent": 25,
            "max_discount_admin_percent": 100,
            "require_reason_above_percent": 10,
            "require_approval_above_percent": 15,
            "allow_freebie_invoice": False,
            "discount_applies_to": {"products": True, "repairs": True, "spare_parts": False},
        },
        "inventory_rules": {
            "low_stock_threshold_default": 5,
            "auto_generate_sku": True,
            "sku_prefix": "IST-",
            "sku_format": "IST-####",
            "track_imei_for_phones": True,
            "allow_negative_stock": False,
            "stock_adjustment_approval_threshold_qty": 25,
            "stock_adjustment_approval_threshold_value": 50000,
            "warn_before_zero_stock": True,
            "dead_stock_definition_days": 60,
            "auto_reorder_suggestion": True,
        },
        "repair_rules": {
            "default_warranty_days": 30,
            "sla_target_standard_hours": 24,
            "sla_target_urgent_hours": 4,
            "auto_assign_technician": False,
            "require_advance_payment": False,
            "minimum_advance_percent": 0,
            "require_full_settlement_before_delivery": True,
            "allow_repair_without_customer": True,
            "auto_increment_job_numbers": True,
            "job_number_prefix": "JOB-",
            "job_number_format": "JOB-YYYYMMDD-###",
            "require_device_condition_photos": True,
        },
        "customer_rules": {
            "auto_register_walk_in_customers": False,
            "require_phone_for_new_customer": True,
            "allow_duplicate_phone_numbers": False,
            "customer_id_format": "CUS-####",
            "dormant_customer_threshold_days": 90,
            "allow_customer_blacklisting": True,
            "show_outstanding_balance_at_pos": True,
        },
        "expense_rules": {
            "require_receipt_reference_above": 1000,
            "approval_required_above": 10000,
            "who_approves_expenses": "Manager",
            "petty_cash_limit": 5000,
            "expense_categories": [
                "Rent",
                "Salary",
                "Utilities",
                "Spare Parts Purchase",
                "Equipment & Tools",
                "Transport",
                "Marketing",
                "Miscellaneous",
            ],
        },
        "return_refund_rules": {
            "return_period_days": 7,
            "allow_returns_without_invoice": False,
            "allow_refund_to_different_payment_method": False,
            "refund_approval_threshold": 100000,
            "allow_store_credit": True,
            "allow_exchanges": True,
            "allow_warranty_replacement": True,
            "restock_returned_sellable_items_automatically": True,
            "require_inspection_before_refund": True,
            "require_manager_approval_for_damaged_returns": True,
            "default_return_policy_text": "Returns allowed within 7 days with invoice. Warranty claims follow product warranty rules. Physical damage is not eligible for refund.",
            "return_receipt_footer_text": "Thank you. Returns are handled per shop policy.",
            "return_reasons": [
                "Defective item",
                "Wrong item sold",
                "Customer changed mind",
                "Warranty claim",
                "Damaged packaging",
                "Not compatible",
                "Duplicate purchase",
                "Incorrect price",
                "Product not working",
                "Other",
            ],
        },
    },
    "financial_settings": {
        "currency_locale": {
            "currency": "LKR",
            "currency_symbol": "LKR",
            "currency_symbol_position": "Before amount",
            "decimal_places": 2,
            "thousand_separator": ",",
            "date_format": "DD/MM/YYYY",
            "time_format": "12-hour",
        },
        "tax_configuration": {
            "enable_tax_on_sales": True,
            "tax_name": "VAT",
            "tax_rate_percent": 0,
            "tax_mode": "Exclusive",
            "apply_tax_to": {"products": True, "repairs": True, "accessories": True},
            "tax_registration_number": "",
            "enable_service_charge": True,
            "service_charge_name": "Service Charge",
            "service_charge_rate_percent": 0,
            "service_charge_on": "Repairs only",
        },
        "payment_methods": {
            "cash": True,
            "card": True,
            "bank_transfer": True,
            "credit": True,
            "cheque": False,
            "online_payment": False,
            "custom_methods": [],
        },
        "cash_drawer": {
            "enable_cash_drawer_integration": True,
            "opening_float_amount": 5000,
            "reconciliation_reminder_time": "19:00",
            "require_daily_reconciliation": True,
        },
        "financial_year": {
            "financial_year_start_month": "January",
            "fiscal_year_name_format": "FY 2026/2027",
            "monthly_closing_required": False,
        },
        "commission_settings": {
            "enable_commission_tracking": True,
            "sales_commission_type": "% of sale value",
            "default_sales_commission_rate_percent": 2,
            "repair_commission_type": "% of repair value",
            "default_repair_commission_rate_percent": 5,
            "commission_calculated_on": "Net (after discount)",
            "per_staff_commission_override": True,
        },
        "advance_payment_settings": {
            "enable_repair_advance": True,
            "enable_product_reservation_advance": True,
            "require_advance_above_amount": 10000,
            "default_minimum_advance_percentage": 30,
            "allow_advance_greater_than_estimate": False,
            "manager_approval_required_for_refund": True,
            "manager_approval_required_for_cancellation": True,
            "auto_apply_advance_to_final_invoice": True,
            "reservation_expiry_days": 14,
            "receipt_template_settings": {
                "show_terms": True,
                "show_estimate_total": True,
                "show_balance_due": True,
            },
        },
    },
    "repair_settings": {
        "repair_status_workflow": [
            {"name": "Received", "color": "blue", "default": True},
            {"name": "Diagnosing", "color": "yellow", "default": False},
            {"name": "Waiting for Parts", "color": "orange", "default": False},
            {"name": "Repairing", "color": "purple", "default": False},
            {"name": "Quality Check", "color": "teal", "default": False},
            {"name": "Completed", "color": "green", "default": False},
            {"name": "Notified", "color": "cyan", "default": False},
            {"name": "Delivered", "color": "gray", "default": False},
            {"name": "Cancelled", "color": "red", "default": False},
        ],
        "repair_categories": [
            "Screen Replacement",
            "Battery Replacement",
            "Charging Port Repair",
            "Speaker / Mic Repair",
            "Software / Flashing",
            "Water Damage",
            "Camera Repair",
            "Button Repair",
            "Back Cover Replacement",
            "Motherboard Repair",
            "Network / Signal Issue",
        ],
        "device_brands": [
            "Samsung",
            "Apple",
            "Redmi",
            "Huawei",
            "Oppo",
            "Vivo",
            "OnePlus",
            "Realme",
            "Nokia",
            "Sony",
            "Motorola",
        ],
        "priority_levels": [
            {"name": "Normal", "sla_hours": 24, "color": "Blue"},
            {"name": "Urgent", "sla_hours": 4, "color": "Orange"},
            {"name": "VIP", "sla_hours": 2, "color": "Purple"},
        ],
        "warranty_quality": {
            "default_warranty_days": 30,
            "warranty_counted_from": "Delivery date",
            "warranty_void_conditions": "Physical damage, water damage, burn damage, seal removed, misuse.",
            "allow_warranty_repair_reopening": True,
            "who_can_open_warranty_job": "Manager+",
            "flag_repeat_repairs_after_times": 2,
            "repair_quality_check_required": True,
        },
        "repair_notes_terms": {
            "default_job_card_terms": "Device not collected within 60 days will not be the responsibility of the shop.",
            "show_terms_on_printed_job_card": True,
            "show_terms_on_receipt": True,
            "show_terms_on_sms_notification": False,
        },
    },
    "invoice_receipt_design": {
        "receipt_format": {
            "paper_size": "80mm Thermal",
            "orientation": "Portrait",
            "font_size": "Medium",
        },
        "default_template": "modern",
        "header_configuration": {
            "show_shop_logo": True,
            "show_shop_name": True,
            "show_address": True,
            "show_phone_number": True,
            "show_email": False,
            "show_website": False,
            "show_vat_tax_number": True,
            "custom_header_text": "Thank you for visiting i Store!",
        },
        "body_configuration": {
            "show_invoice_number": True,
            "show_date_time": True,
            "show_cashier_name": True,
            "show_customer_name": True,
            "show_customer_phone": False,
            "show_imei_on_invoice": True,
            "show_unit_cost": False,
            "show_discount_line": True,
            "show_tax_line": True,
            "show_subtotal": True,
            "show_payment_method": True,
            "show_balance_due": True,
            "show_outstanding_balance": True,
        },
        "footer_configuration": {
            "show_thank_you_message": True,
            "thank_you_text": "Thank you for your purchase!",
            "show_return_policy": True,
            "return_policy_text": "Items can be returned within 7 days with receipt.",
            "show_social_media": False,
            "custom_footer_line_1": "Warranty: 30 days on all repairs",
            "custom_footer_line_2": "Call: 077-XXXXXXX for support",
            "show_qr_code_on_receipt": True,
            "qr_code_content": "https://wa.me/94XXXXXXXXX",
        },
        "repair_job_card_design": {
            "show_device_photo_space": True,
            "show_accessories_checklist": True,
            "show_terms_conditions": True,
            "show_technician_signature_line": True,
            "show_customer_signature_line": True,
            "show_barcode_of_job_id": True,
            "show_qr_code_of_job_id": True,
            "job_card_size": "A5",
        },
    },
    "notifications_alerts": {
        "in_app_notifications": {
            "low_stock_alert": {"enabled": True, "threshold": 5},
            "out_of_stock_alert": {"enabled": True},
            "overdue_payment_alert": {"enabled": True, "days": 7},
            "delayed_repair_alert": {"enabled": True, "mode": "past ETA"},
            "new_repair_job_assigned": {"enabled": True},
            "repair_status_changed": {"enabled": True},
            "cash_reconciliation_reminder": {"enabled": True, "time": "19:00"},
            "unsigned_closing_report": {"enabled": True, "time": "20:00"},
            "goal_behind_target_alert": {"enabled": True, "threshold_percent": 70},
            "failed_login_alert": {"enabled": True, "attempts": 3},
            "large_transaction_alert": {"enabled": True, "amount": 100000},
            "large_discount_alert": {"enabled": True, "percent": 15},
            "void_deletion_alert": {"enabled": True},
            "budget_overspend_alert": {"enabled": True},
            "supplier_payment_due": {"enabled": True, "days_before": 3},
        },
        "notification_recipients": {
            "owner": True,
            "admin": True,
            "manager": True,
            "cashier": False,
            "technician": False,
        },
        "sms_notifications": {
            "sms_gateway": "",
            "api_key": "",
            "sender_name": "iStore",
            "send_job_received": True,
            "send_job_completed": True,
            "send_job_delivered": True,
            "send_invoice_created": False,
            "send_outstanding_payment_reminder": True,
            "send_promotional_messages": False,
            "template_job_received": "Dear {customer}, your {device} has been received. Job ID: {job_id}.",
            "template_job_completed": "Dear {customer}, your repair is complete. Balance: LKR {balance}.",
        },
        "alert_thresholds_summary": [
            {"alert": "Low stock", "trigger_value": "Below 5 units", "notify": "Manager+"},
            {"alert": "Overdue payment", "trigger_value": "After 7 days", "notify": "Manager+"},
            {"alert": "Large transaction", "trigger_value": "Above LKR 100,000", "notify": "Admin+"},
            {"alert": "Large discount", "trigger_value": "Above 15%", "notify": "Manager+"},
            {"alert": "Failed logins", "trigger_value": "After 3 attempts", "notify": "Admin+"},
            {"alert": "Budget overspend", "trigger_value": "Above 100%", "notify": "Manager+"},
        ],
    },
    "appearance_display": {
        "theme": {
            "color_theme": "Dark",
            "accent_color": "#6c63ff",
            "sidebar_style": "Full labels",
            "sidebar_position": "Left",
            "compact_mode": True,
            "animation_speed": "Normal",
        },
        "dashboard_display": {
            "default_date_range_on_load": "Today",
            "show_quick_action_tiles": True,
            "show_low_stock_alerts_on_dashboard": True,
            "show_pending_repairs_widget": True,
            "show_outstanding_balance_widget": True,
            "cards_per_row_reports": 4,
        },
        "pos_display": {
            "show_product_images_in_pos": True,
            "products_per_page_pos_grid": 20,
            "default_pos_view": "Grid",
            "show_stock_qty_in_pos": True,
            "warn_when_stock_below": 3,
            "show_customer_balance_at_checkout": True,
            "calculator_widget_at_pos": True,
        },
        "table_display": {
            "rows_per_page_default": 25,
            "table_density": "Compact",
            "sticky_table_headers": True,
            "show_row_numbers": True,
            "highlight_overdue_rows": True,
        },
        "number_date_display": {
            "date_format": "DD/MM/YYYY",
            "time_format": "12-hour",
            "currency_display": "LKR 12,500.00",
            "large_number_format": "12,500",
            "negative_numbers_format": "(1,500)",
        },
    },
    "backup_data": {
        "auto_backup": {
            "enable_automatic_backup": True,
            "backup_frequency": "Daily",
            "backup_time": "02:00",
            "backup_storage": "Local",
            "local_backup_path": "/backups/istore/",
            "backup_retention_days": 90,
            "compress_backup_files": True,
            "encrypt_backup_files": True,
            "encryption_password": "",
            "notify_on_backup_success": True,
            "notify_on_backup_failure": True,
        },
        "manual_backup": {"last_backup_label": "Not yet created"},
        "data_restore": {"require_confirmation_checkbox": True},
        "data_export": {
            "products_inventory": True,
            "customers": True,
            "suppliers": True,
            "sales_invoices": True,
            "repair_jobs": True,
            "expenses": True,
            "audit_logs": True,
            "format": "CSV",
        },
        "data_cleanup": {
            "clear_old_audit_logs_older_than": "1 year",
            "purge_deleted_records_enabled": False,
            "reset_demo_data_enabled": False,
            "factory_reset_enabled": False,
        },
    },
    "system_apis": {
        "system_information": {
            "application_version": "v2.4.1",
            "last_updated": "",
            "database_size": "",
            "total_records": 0,
            "uptime": "",
            "server_status": "Online",
        },
        "printer_configuration": {
            "default_receipt_printer": "",
            "thermal_printer_repair_labels": "",
            "label_printer_product_labels": "",
            "paper_size_per_printer": "Configured per printer",
        },
        "barcode_scanner": {
            "scanner_input_mode": "USB HID (Keyboard)",
            "scan_prefix_character": "None",
            "scan_suffix_character": "Enter",
            "auto_focus_scan_field": True,
            "scan_beep_sound": True,
            "camera_scan_mobile": True,
        },
        "sms_gateway": {
            "provider": "",
            "api_key": "",
            "api_secret": "",
            "sender_id": "iStore",
        },
        "email_configuration": {
            "smtp_server": "",
            "smtp_port": 587,
            "email_address": "",
            "password": "",
            "sender_name": "iStore POS",
        },
        "external_integrations": {
            "whatsapp_business_api_connected": False,
            "google_drive_backup_connected": False,
            "payment_gateway_connected": False,
            "accounting_software_connected": False,
        },
        "license_subscription": {
            "license_type": "Professional",
            "licensed_to": "i Store",
            "valid_until": "",
            "devices_allowed": 3,
            "devices_used": 1,
            "support_expires": "",
            "status": "Active",
        },
        "developer_advanced": {
            "debug_mode": False,
            "api_access": False,
            "api_key": "",
            "webhook_url": "",
            "log_level": "Error",
        },
    },
}

SECTION_KEYS = set(DEFAULT_SETTINGS_STATE.keys())


def _safe_json_load(raw: str | None, fallback: Any) -> Any:
    if not raw:
        return copy.deepcopy(fallback)
    try:
        parsed = json.loads(raw)
        return parsed if parsed is not None else copy.deepcopy(fallback)
    except json.JSONDecodeError:
        return copy.deepcopy(fallback)


def _deep_merge(base: Any, override: Any) -> Any:
    if isinstance(base, dict) and isinstance(override, dict):
        merged = {k: _deep_merge(v, override.get(k)) if k in override else copy.deepcopy(v) for k, v in base.items()}
        for k, v in override.items():
            if k not in merged:
                merged[k] = copy.deepcopy(v)
        return merged
    if override is None:
        return copy.deepcopy(base)
    return copy.deepcopy(override)


def _get_setting_dict(db: Session, key: str, default_value: dict) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        row = AppSetting(key=key, value=json.dumps(default_value))
        db.add(row)
        db.commit()
        return copy.deepcopy(default_value)
    loaded = _safe_json_load(row.value, default_value)
    if not isinstance(loaded, dict):
        return copy.deepcopy(default_value)
    return loaded


def _save_setting_dict(db: Session, key: str, payload: dict) -> dict:
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if not row:
        row = AppSetting(key=key, value=json.dumps(payload))
        db.add(row)
    else:
        row.value = json.dumps(payload)
    db.commit()
    return payload


def _normalize_employee_profile(profile: dict | None) -> dict:
    merged = copy.deepcopy(DEFAULT_EMPLOYEE_PROFILE)
    if isinstance(profile, dict):
        merged.update(profile)
    if not merged.get("created_on"):
        merged["created_on"] = utcnow().isoformat()
    return merged


def _load_employee_profiles(db: Session) -> dict[str, dict]:
    raw = _get_setting_dict(db, EMPLOYEE_PROFILES_KEY, {})
    result: dict[str, dict] = {}
    for key, value in raw.items():
        result[str(key)] = _normalize_employee_profile(value if isinstance(value, dict) else {})
    return result


def _save_employee_profiles(db: Session, profiles: dict[str, dict]) -> None:
    _save_setting_dict(db, EMPLOYEE_PROFILES_KEY, profiles)


def _build_employee_payload(user: User, profile: dict | None = None) -> dict:
    meta = _normalize_employee_profile(profile)
    return {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "role": user.role,
        "role_id": user.role_id,
        "is_active": bool(user.is_active),
        "phone_number": user.phone_number or meta.get("phone_number", ""),
        "email": user.email or meta.get("email", ""),
        "pin": "",
        "pin_set": bool(user.pin_hash or meta.get("pin")),
        "profile_photo": user.profile_photo or meta.get("profile_photo", ""),
        "notes": user.notes or meta.get("notes", ""),
        "last_login": user.last_login_at.isoformat() if user.last_login_at else meta.get("last_login"),
        "account_locked": bool(user.account_locked_until and user.account_locked_until > utcnow()),
        "account_locked_until": user.account_locked_until.isoformat() if user.account_locked_until else None,
        "failed_login_count": int(user.failed_login_count or 0),
        "created_by": meta.get("created_by", "system"),
        "created_on": user.created_at.isoformat() if user.created_at else meta.get("created_on"),
    }


MODULE_LABEL_TO_CODE = {
    "Dashboard": "dashboard",
    "POS / Billing": "pos",
    "Repair Management": "repairs",
    "Inventory": "inventory",
    "Customers": "customers",
    "Reports (View)": "reports",
    "Reports (Export)": "reports",
    "Financial Audit": "financial_audit",
    "Audit Trail": "audit_logs",
    "Labels": "labels",
    "Suppliers": "suppliers",
    "Expenses": "expenses",
    "Advance Payments": "advance",
    "Product Reservations": "reservation",
    "Warranty": "warranty",
    "Returns": "returns",
    "Settings": "settings",
    "Backup": "backup",
}


MODULE_CODE_TO_LABEL = {v: k for k, v in MODULE_LABEL_TO_CODE.items()}


ROLE_KEY_TO_NAME = {
    "owner": "owner",
    "admin": "admin",
    "manager": "manager",
    "accountant": "accountant",
    "storekeeper": "storekeeper",
    "technician": "technician",
    "cashier": "cashier",
    "viewer": "viewer",
    "view_only": "view_only",
}


def _build_access_control_state_from_security(db: Session, fallback_state: dict) -> dict:
    ensure_security_defaults(db)
    matrix_payload = role_matrix_payload(db)
    role_rows = matrix_payload.get("roles") or []
    role_by_name = {str(row.get("name")): row for row in role_rows}
    role_definitions = [
        {
            "role": row.get("display_name"),
            "level": row.get("level"),
            "description": row.get("description"),
            "id": row.get("id"),
            "is_protected": bool(row.get("is_protected")),
            "name": row.get("name"),
        }
        for row in sorted(role_rows, key=lambda x: (-(int(x.get("level") or 0)), str(x.get("display_name") or "")))
    ]

    role_permissions = matrix_payload.get("role_permissions") or []
    permissions = matrix_payload.get("permissions") or []
    perm_by_id = {int(p["id"]): p for p in permissions if p.get("id") is not None}
    allowed_map: dict[tuple[str, str], bool] = {}
    for rp in role_permissions:
        role_id = rp.get("role_id")
        perm_id = rp.get("permission_id")
        allowed = bool(rp.get("allowed"))
        perm = perm_by_id.get(int(perm_id or 0))
        role_name = None
        for row in role_rows:
            if int(row.get("id") or 0) == int(role_id or 0):
                role_name = row.get("name")
                break
        if not role_name or not perm:
            continue
        module = str(perm.get("module") or "")
        action = str(perm.get("action") or "")
        allowed_map[(role_name, f"{module}.{action}")] = allowed

    permission_matrix = []
    labels = [
        "Dashboard",
        "POS / Billing",
        "Repair Management",
        "Inventory",
        "Customers",
        "Reports (View)",
        "Reports (Export)",
        "Financial Audit",
        "Audit Trail",
        "Labels",
        "Suppliers",
        "Expenses",
        "Advance Payments",
        "Product Reservations",
        "Warranty",
        "Returns",
        "Settings",
        "Backup",
    ]
    for label in labels:
        module_code = MODULE_LABEL_TO_CODE.get(label)
        row = {"module": label}
        for role_key, role_name in ROLE_KEY_TO_NAME.items():
            if role_name == "owner":
                row[role_key] = True
                continue
            role = role_by_name.get(role_name)
            if not role:
                row[role_key] = False
                continue
            if label == "Reports (Export)":
                row[role_key] = bool(allowed_map.get((role_name, "reports.export"), False))
            elif label == "Reports (View)":
                row[role_key] = bool(allowed_map.get((role_name, "reports.view"), False))
            else:
                row[role_key] = bool(allowed_map.get((role_name, f"{module_code}.view"), False))
        permission_matrix.append(row)

    session_rules = get_security_settings(db)
    active_sessions = [build_session_payload(row) for row in get_active_sessions(db)]

    base = copy.deepcopy(fallback_state or {})
    base["role_definitions"] = role_definitions or base.get("role_definitions", [])
    base["permission_matrix"] = permission_matrix or base.get("permission_matrix", [])
    base["session_security_rules"] = {
        **base.get("session_security_rules", {}),
        **session_rules,
    }
    base["active_sessions"] = active_sessions
    return base


def _sync_access_control_to_security(db: Session, section_payload: dict, actor_user_id: int | None = None) -> None:
    ensure_security_defaults(db)
    if not isinstance(section_payload, dict):
        return

    if isinstance(section_payload.get("session_security_rules"), dict):
        set_security_settings(db, section_payload.get("session_security_rules") or {}, updated_by_user_id=actor_user_id)

    matrix = section_payload.get("permission_matrix") or []
    if not isinstance(matrix, list):
        return

    matrix_payload = role_matrix_payload(db)
    roles = list(matrix_payload.get("roles") or [])
    role_by_name = {str(row.get("name")): row for row in roles}
    permissions = list(matrix_payload.get("permissions") or [])
    perm_by_code = {str(p.get("code")): p for p in permissions}

    role_keys = {
        "owner": "owner",
        "admin": "admin",
        "manager": "manager",
        "accountant": "accountant",
        "storekeeper": "storekeeper",
        "technician": "technician",
        "cashier": "cashier",
        "viewer": "viewer",
        "view_only": "view_only",
    }

    for row in matrix:
        label = str(row.get("module") or "")
        module_code = MODULE_LABEL_TO_CODE.get(label)
        if not module_code:
            continue
        for role_key, role_name in role_keys.items():
            role_meta = role_by_name.get(role_name)
            if not role_meta:
                continue
            role_id = int(role_meta.get("id") or 0)
            if role_name == "owner":
                continue
            value = bool(row.get(role_key))

            if label == "Reports (Export)":
                perm = perm_by_code.get("reports.export")
                if perm:
                    set_role_permissions(db, role_id, [int(perm.get("id"))], allowed=value)
                continue
            if label == "Reports (View)":
                perm = perm_by_code.get("reports.view")
                if perm:
                    set_role_permissions(db, role_id, [int(perm.get("id"))], allowed=value)
                continue

            target_perm_ids = [
                int(p.get("id"))
                for p in permissions
                if str(p.get("module")) == module_code
            ]
            if target_perm_ids:
                set_role_permissions(db, role_id, target_perm_ids, allowed=value)


def _ensure_settings_state(db: Session) -> dict:
    stored = _get_setting_dict(db, SETTINGS_STATE_KEY, DEFAULT_SETTINGS_STATE)
    merged = _deep_merge(DEFAULT_SETTINGS_STATE, stored)
    if merged != stored:
        _save_setting_dict(db, SETTINGS_STATE_KEY, merged)
    return merged


def _hydrate_state_from_legacy(state: dict, db: Session) -> dict:
    print_profile = _get_setting_dict(db, PRINT_PROFILE_KEY, DEFAULT_PRINT_PROFILE)
    ui = _get_setting_dict(db, UI_PREFERENCES_KEY, DEFAULT_UI_PREFERENCES)
    business = _get_setting_dict(db, BUSINESS_PREFS_KEY, DEFAULT_BUSINESS_PREFS)
    integrations = _get_setting_dict(db, INTEGRATIONS_PREFS_KEY, DEFAULT_INTEGRATIONS_PREFS)

    state = copy.deepcopy(state)
    state["store_profile"]["business_identity"]["shop_name"] = print_profile.get("store_name", state["store_profile"]["business_identity"]["shop_name"])
    state["store_profile"]["business_identity"]["tax_vat_number"] = print_profile.get("tax_number", state["store_profile"]["business_identity"]["tax_vat_number"])
    state["store_profile"]["business_identity"]["registration_number"] = print_profile.get("business_reg_no", state["store_profile"]["business_identity"]["registration_number"])
    state["store_profile"]["business_identity"]["shop_tagline"] = print_profile.get("slogan", state["store_profile"]["business_identity"]["shop_tagline"])
    state["store_profile"]["contact_information"]["primary_phone"] = print_profile.get("store_phone", state["store_profile"]["contact_information"]["primary_phone"])
    state["store_profile"]["contact_information"]["email_address"] = print_profile.get("store_email", state["store_profile"]["contact_information"]["email_address"])
    state["store_profile"]["contact_information"]["website_url"] = print_profile.get("store_website", state["store_profile"]["contact_information"]["website_url"])
    state["store_profile"]["address"]["address_line_1"] = print_profile.get("store_address", state["store_profile"]["address"]["address_line_1"])
    state["store_profile"]["logo_branding"]["shop_logo"] = print_profile.get("logo_data", state["store_profile"]["logo_branding"]["shop_logo"])
    state["invoice_receipt_design"]["receipt_format"]["paper_size"] = print_profile.get("format", state["invoice_receipt_design"]["receipt_format"]["paper_size"])
    state["invoice_receipt_design"]["footer_configuration"]["thank_you_text"] = print_profile.get(
        "footer_note", state["invoice_receipt_design"]["footer_configuration"]["thank_you_text"]
    )
    state["invoice_receipt_design"]["footer_configuration"]["return_policy_text"] = print_profile.get(
        "return_policy", state["invoice_receipt_design"]["footer_configuration"]["return_policy_text"]
    )
    state["repair_settings"]["repair_notes_terms"]["default_job_card_terms"] = print_profile.get(
        "repair_terms", state["repair_settings"]["repair_notes_terms"]["default_job_card_terms"]
    )
    state["appearance_display"]["theme"]["color_theme"] = "Dark" if ui.get("theme", "dark") == "dark" else "Light"
    state["appearance_display"]["theme"]["compact_mode"] = bool(ui.get("compact_mode", True))
    state["financial_settings"]["currency_locale"]["currency"] = business.get("currency", state["financial_settings"]["currency_locale"]["currency"])
    state["financial_settings"]["currency_locale"]["date_format"] = business.get(
        "date_format", state["financial_settings"]["currency_locale"]["date_format"]
    )
    state["financial_settings"]["tax_configuration"]["tax_rate_percent"] = business.get(
        "tax_rate", state["financial_settings"]["tax_configuration"]["tax_rate_percent"]
    )
    state["notifications_alerts"]["sms_notifications"]["api_key"] = integrations.get(
        "whatsapp_api_key", state["notifications_alerts"]["sms_notifications"]["api_key"]
    )
    return state


def _sync_legacy_settings_from_state(db: Session, state: dict) -> None:
    store = state.get("store_profile", {})
    business_identity = store.get("business_identity", {})
    contact = store.get("contact_information", {})
    address = store.get("address", {})
    branding = store.get("logo_branding", {})

    receipt = state.get("invoice_receipt_design", {})
    receipt_format = receipt.get("receipt_format", {})
    footer_cfg = receipt.get("footer_configuration", {})
    body_cfg = receipt.get("body_configuration", {})
    header_cfg = receipt.get("header_configuration", {})
    repair_terms = state.get("repair_settings", {}).get("repair_notes_terms", {})

    appearance_theme = state.get("appearance_display", {}).get("theme", {})
    financial = state.get("financial_settings", {})
    currency_locale = financial.get("currency_locale", {})
    tax_cfg = financial.get("tax_configuration", {})
    sms_cfg = state.get("notifications_alerts", {}).get("sms_notifications", {})

    legacy_print = _get_setting_dict(db, PRINT_PROFILE_KEY, DEFAULT_PRINT_PROFILE)
    legacy_print.update(
        {
            "format": receipt_format.get("paper_size", legacy_print.get("format", "A4")),
            "store_name": business_identity.get("shop_name", legacy_print.get("store_name", "I Point")),
            "store_address": address.get("address_line_1", legacy_print.get("store_address", "")),
            "store_phone": contact.get("primary_phone", legacy_print.get("store_phone", "")),
            "store_email": contact.get("email_address", legacy_print.get("store_email", "")),
            "store_website": contact.get("website_url", legacy_print.get("store_website", "")),
            "tax_number": business_identity.get("tax_vat_number", legacy_print.get("tax_number", "")),
            "business_reg_no": business_identity.get("registration_number", legacy_print.get("business_reg_no", "")),
            "footer_note": footer_cfg.get("thank_you_text", legacy_print.get("footer_note", "")),
            "logo_data": branding.get("shop_logo", legacy_print.get("logo_data", "")),
            "show_logo": bool(header_cfg.get("show_shop_logo", legacy_print.get("show_logo", True))),
            "show_tax_no": bool(header_cfg.get("show_vat_tax_number", legacy_print.get("show_tax_no", True))),
            "show_customer_phone": bool(body_cfg.get("show_customer_phone", legacy_print.get("show_customer_phone", True))),
            "show_qr_code": bool(footer_cfg.get("show_qr_code_on_receipt", legacy_print.get("show_qr_code", True))),
            "return_policy": footer_cfg.get("return_policy_text", legacy_print.get("return_policy", "")),
            "repair_terms": repair_terms.get("default_job_card_terms", legacy_print.get("repair_terms", "")),
            "slogan": business_identity.get("shop_tagline", legacy_print.get("slogan", "")),
        }
    )
    _save_setting_dict(db, PRINT_PROFILE_KEY, legacy_print)

    legacy_ui = _get_setting_dict(db, UI_PREFERENCES_KEY, DEFAULT_UI_PREFERENCES)
    legacy_ui["theme"] = "dark" if str(appearance_theme.get("color_theme", "Dark")).lower().startswith("dark") else "light"
    legacy_ui["compact_mode"] = bool(appearance_theme.get("compact_mode", True))
    _save_setting_dict(db, UI_PREFERENCES_KEY, legacy_ui)

    legacy_business = _get_setting_dict(db, BUSINESS_PREFS_KEY, DEFAULT_BUSINESS_PREFS)
    legacy_business["currency"] = currency_locale.get("currency", legacy_business.get("currency", "LKR"))
    legacy_business["tax_rate"] = tax_cfg.get("tax_rate_percent", legacy_business.get("tax_rate", 0))
    legacy_business["date_format"] = currency_locale.get("date_format", legacy_business.get("date_format", "DD/MM/YYYY"))
    _save_setting_dict(db, BUSINESS_PREFS_KEY, legacy_business)

    legacy_integrations = _get_setting_dict(db, INTEGRATIONS_PREFS_KEY, DEFAULT_INTEGRATIONS_PREFS)
    legacy_integrations["whatsapp_api_key"] = sms_cfg.get("api_key", legacy_integrations.get("whatsapp_api_key", ""))
    legacy_integrations["enable_sms_alerts"] = bool(
        sms_cfg.get("send_job_received", False)
        or sms_cfg.get("send_job_completed", False)
        or sms_cfg.get("send_outstanding_payment_reminder", False)
    )
    _save_setting_dict(db, INTEGRATIONS_PREFS_KEY, legacy_integrations)


def _build_header_kpis(db: Session, state: dict) -> dict:
    users = db.query(User).all()
    total_staff = len(users)
    try:
        active_staff = len(get_active_sessions(db))
    except Exception:
        active_staff = len([u for u in users if bool(u.is_active)])
    last_backup_row = db.query(AppSetting).filter(AppSetting.key == "last_backup_at").first()
    last_backup = last_backup_row.value if last_backup_row else None

    receipt_format = (
        state.get("invoice_receipt_design", {})
        .get("receipt_format", {})
        .get("paper_size", "80mm Thermal")
    )
    system_version = (
        state.get("system_apis", {})
        .get("system_information", {})
        .get("application_version", "v2.4.1")
    )
    license_status = (
        state.get("system_apis", {})
        .get("license_subscription", {})
        .get("status", "Active")
    )

    return {
        "total_staff": total_staff,
        "active_logins": active_staff,
        "receipt_format": receipt_format,
        "last_backup": last_backup,
        "system_version": system_version,
        "license_status": license_status,
    }


@router.get("/state", dependencies=[Depends(require_permission("settings.view"))])
def get_settings_state(db: Session = Depends(get_db), _=Depends(get_current_user)):
    ensure_security_defaults(db)
    state = _ensure_settings_state(db)
    state = _hydrate_state_from_legacy(state, db)
    state["access_control"] = _build_access_control_state_from_security(db, state.get("access_control", {}))
    return {**state, "_header": _build_header_kpis(db, state)}


@router.put("/state", dependencies=[Depends(require_permission("settings.edit"))])
def update_settings_state(payload: dict, db: Session = Depends(get_db), _=Depends(get_current_user)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload must be a JSON object")

    existing = _ensure_settings_state(db)
    sanitized_payload = {k: v for k, v in payload.items() if k in SECTION_KEYS}
    merged = _deep_merge(existing, sanitized_payload)
    if "access_control" in sanitized_payload:
        _sync_access_control_to_security(db, sanitized_payload.get("access_control") or {}, actor_user_id=getattr(_, "id", None))
        merged["access_control"] = _build_access_control_state_from_security(db, merged.get("access_control", {}))
    _save_setting_dict(db, SETTINGS_STATE_KEY, merged)
    _sync_legacy_settings_from_state(db, merged)
    return {**merged, "_header": _build_header_kpis(db, merged)}


@router.get("/section/{section_key}", dependencies=[Depends(require_permission("settings.view"))])
def get_settings_section(section_key: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    if section_key not in SECTION_KEYS:
        raise HTTPException(status_code=404, detail="Unknown settings section")
    ensure_security_defaults(db)
    state = _ensure_settings_state(db)
    state = _hydrate_state_from_legacy(state, db)
    if section_key == "access_control":
        return _build_access_control_state_from_security(db, state.get("access_control", {}))
    return state.get(section_key, {})


@router.put("/section/{section_key}", dependencies=[Depends(require_permission("settings.edit"))])
def update_settings_section(section_key: str, payload: dict, db: Session = Depends(get_db), _=Depends(get_current_user)):
    if section_key not in SECTION_KEYS:
        raise HTTPException(status_code=404, detail="Unknown settings section")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload must be a JSON object")

    state = _ensure_settings_state(db)
    section_default = copy.deepcopy(DEFAULT_SETTINGS_STATE.get(section_key, {}))
    merged_section = _deep_merge(section_default, payload)
    if section_key == "access_control":
        _sync_access_control_to_security(db, merged_section, actor_user_id=getattr(_, "id", None))
        merged_section = _build_access_control_state_from_security(db, merged_section)
    state[section_key] = merged_section
    _save_setting_dict(db, SETTINGS_STATE_KEY, state)
    _sync_legacy_settings_from_state(db, state)
    return merged_section


@router.get("/employees", dependencies=[Depends(require_permission("access.view"))])
def employees(db: Session = Depends(get_db), _=Depends(get_current_user)):
    _require_access_permission(db, _, "access.view")
    ensure_security_defaults(db)
    users = db.query(User).filter(User.is_deleted == False).order_by(User.id.asc()).all()
    profiles = _load_employee_profiles(db)
    return [_build_employee_payload(user, profiles.get(str(user.id))) for user in users]


@router.post("/employees", dependencies=[Depends(require_permission("access.create_user"))])
def create_employee(payload: EmployeeIn, request: Request, db: Session = Depends(get_db), current=Depends(get_current_user)):
    _require_access_permission(db, current, "access.create_user")
    ensure_security_defaults(db)
    existing = db.query(User).filter(User.username.ilike(payload.username.strip())).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")

    security = get_security_settings(db)
    issues = validate_password_against_policy(payload.password, security)
    if issues:
        raise HTTPException(status_code=400, detail=" ".join(issues))

    canonical = canonical_role_name(payload.role)
    role = db.query(Role).filter(Role.name == canonical).first()
    if not role:
        raise HTTPException(status_code=400, detail=f"Unknown role: {payload.role}")

    pin_hash = None
    if payload.pin:
        if not validate_pin(payload.pin, int(security.get("pin_length", 4) or 4)):
            raise HTTPException(status_code=400, detail="PIN must be numeric and match configured PIN length")
        pin_hash = hash_password(payload.pin)

    user = User(
        username=payload.username.strip(),
        full_name=payload.full_name.strip(),
        password_hash=hash_password(payload.password),
        role=normalize_role_for_legacy(role.name),
        role_id=role.id,
        pin_hash=pin_hash,
        phone_number=(payload.phone_number or "").strip() or None,
        email=(payload.email or "").strip() or None,
        profile_photo=payload.profile_photo or None,
        notes=payload.notes or None,
        last_password_change_at=utcnow(),
        is_active=payload.is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    profiles = _load_employee_profiles(db)
    profiles[str(user.id)] = _normalize_employee_profile(
        {
            "phone_number": payload.phone_number or "",
            "email": payload.email or "",
            "pin": "",
            "profile_photo": payload.profile_photo or "",
            "notes": payload.notes or "",
            "created_by": getattr(current, "username", "system"),
            "created_on": utcnow().isoformat(),
        }
    )
    _save_employee_profiles(db, profiles)

    record_security_audit(
        db,
        action="user_created",
        user_id=getattr(current, "id", None),
        target_type="user",
        target_id=user.id,
        target_ref=user.username,
        detail=f"Created staff account ({user.role})",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
    )
    return _build_employee_payload(user, profiles.get(str(user.id)))


@router.put("/employees/{user_id}", dependencies=[Depends(require_permission("access.edit_user"))])
def update_employee(user_id: int, payload: EmployeeUpdateIn, request: Request, db: Session = Depends(get_db), current=Depends(get_current_user)):
    _require_access_permission(db, current, "access.edit_user")
    ensure_security_defaults(db)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Employee not found")

    role_obj = db.query(Role).filter(Role.id == user.role_id).first() if user.role_id else None
    is_owner = bool((role_obj and role_obj.name == "owner") or canonical_role_name(user.role) == "owner")

    data = payload.model_dump(exclude_none=True)
    if "full_name" in data:
        user.full_name = data["full_name"].strip()
    if "password" in data and data["password"]:
        issues = validate_password_against_policy(data["password"], get_security_settings(db))
        if issues:
            raise HTTPException(status_code=400, detail=" ".join(issues))
        user.password_hash = hash_password(data["password"])
        user.last_password_change_at = utcnow()
    if "role" in data:
        if is_owner:
            canonical = canonical_role_name(data["role"])
            enforce_owner_user_change_guard(db, target_user=user, new_role_name=canonical, deleting=False)
        canonical = canonical_role_name(data["role"])
        new_role = db.query(Role).filter(Role.name == canonical).first()
        if not new_role:
            raise HTTPException(status_code=400, detail=f"Unknown role: {data['role']}")
        user.role_id = new_role.id
        user.role = normalize_role_for_legacy(new_role.name)
    if "is_active" in data:
        if is_owner and not bool(data["is_active"]):
            enforce_owner_user_change_guard(db, target_user=user, new_is_active=False, deleting=False)
        user.is_active = data["is_active"]
    if "phone_number" in data:
        user.phone_number = (data["phone_number"] or "").strip() or None
    if "email" in data:
        user.email = (data["email"] or "").strip() or None
    if "profile_photo" in data:
        user.profile_photo = data["profile_photo"] or None
    if "notes" in data:
        user.notes = data["notes"] or None
    if "pin" in data:
        pin_value = (data.get("pin") or "").strip()
        if pin_value:
            pin_len = int(get_security_settings(db).get("pin_length", 4) or 4)
            if not validate_pin(pin_value, pin_len):
                raise HTTPException(status_code=400, detail=f"PIN must be numeric and {pin_len} digits")
            user.pin_hash = hash_password(pin_value)
    db.commit()
    db.refresh(user)

    profiles = _load_employee_profiles(db)
    profile = _normalize_employee_profile(profiles.get(str(user_id)))
    for field in ("phone_number", "email", "pin", "profile_photo", "notes"):
        if field in data:
            if field == "pin":
                profile[field] = ""
            else:
                profile[field] = data[field] or ""
    profile["last_login"] = user.last_login_at.isoformat() if user.last_login_at else profile.get("last_login")
    profiles[str(user_id)] = profile
    _save_employee_profiles(db, profiles)
    record_security_audit(
        db,
        action="user_updated",
        user_id=getattr(current, "id", None),
        target_type="user",
        target_id=user.id,
        target_ref=user.username,
        detail="Updated staff account",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
    )
    return _build_employee_payload(user, profiles.get(str(user_id)))


@router.delete("/employees/{user_id}", dependencies=[Depends(require_permission("access.disable_user"))])
def delete_employee(user_id: int, request: Request, db: Session = Depends(get_db), current=Depends(get_current_user)):
    _require_access_permission(db, current, "access.disable_user")
    ensure_security_defaults(db)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Employee not found")
    role_obj = db.query(Role).filter(Role.id == user.role_id).first() if user.role_id else None
    is_owner = bool((role_obj and role_obj.name == "owner") or canonical_role_name(user.role) == "owner")
    if is_owner:
        enforce_owner_user_change_guard(db, target_user=user, deleting=True)
    user.is_deleted = True
    user.deleted_at = utcnow()
    user.is_active = False
    db.commit()

    profiles = _load_employee_profiles(db)
    if str(user_id) in profiles:
        del profiles[str(user_id)]
        _save_employee_profiles(db, profiles)
    record_security_audit(
        db,
        action="user_deleted",
        user_id=getattr(current, "id", None),
        target_type="user",
        target_id=user.id,
        target_ref=user.username,
        detail="Soft-deleted staff account",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
    )
    return {"ok": True}


@router.get("/access-control/rbac", dependencies=[Depends(require_permission("access.view"))])
def access_control_rbac(db: Session = Depends(get_db), _=Depends(get_current_user)):
    _require_access_permission(db, _, "access.view")
    ensure_security_defaults(db)
    matrix = role_matrix_payload(db)
    roles = list(matrix.get("roles") or [])
    role_by_name = {str(r.get("name")): r for r in roles}

    role_definitions = []
    ordered = ["owner", "admin", "manager", "accountant", "storekeeper", "technician", "cashier", "viewer", "view_only"]
    for name in ordered:
        row = role_by_name.get(name)
        if not row:
            continue
        role_definitions.append(
            {
                "role": row.get("display_name"),
                "name": row.get("name"),
                "level": row.get("level"),
                "description": row.get("description"),
                "is_protected": bool(row.get("is_protected")),
                "id": row.get("id"),
            }
        )
    return {
        "role_definitions": role_definitions,
        "roles": matrix.get("roles") or [],
        "permissions": matrix.get("permissions") or [],
        "grouped_modules": matrix.get("grouped_modules") or {},
        "role_permissions": matrix.get("role_permissions") or [],
    }


@router.put("/access-control/roles/{role_id}/permissions", dependencies=[Depends(require_permission("access.manage_permissions"))])
def access_control_set_role_permissions(
    role_id: int,
    payload: dict,
    request: Request,
    db: Session = Depends(get_db),
    current=Depends(get_current_user),
):
    _require_access_permission(db, current, "access.manage_permissions")
    ensure_security_defaults(db)
    permission_ids = payload.get("permission_ids") or []
    allowed = bool(payload.get("allowed", True))
    if not isinstance(permission_ids, list):
        raise HTTPException(status_code=400, detail="permission_ids must be an array")
    set_role_permissions(db, role_id, [int(x) for x in permission_ids], allowed=allowed)
    record_security_audit(
        db,
        action="permission_changed",
        user_id=getattr(current, "id", None),
        target_type="role",
        target_id=role_id,
        detail=f"Updated {len(permission_ids)} permission entries",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
    )
    return {"ok": True}


@router.post("/access-control/roles/{role_id}/grant-all", dependencies=[Depends(require_permission("access.manage_permissions"))])
def access_control_grant_all(
    role_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current=Depends(get_current_user),
):
    _require_access_permission(db, current, "access.manage_permissions")
    ensure_security_defaults(db)
    set_role_permissions_bulk(db, role_id, allowed=True)
    record_security_audit(
        db,
        action="permission_changed",
        user_id=getattr(current, "id", None),
        target_type="role",
        target_id=role_id,
        detail="Granted all permissions",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
    )
    return {"ok": True}


@router.post("/access-control/roles/{role_id}/revoke-all", dependencies=[Depends(require_permission("access.manage_permissions"))])
def access_control_revoke_all(
    role_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current=Depends(get_current_user),
):
    _require_access_permission(db, current, "access.manage_permissions")
    ensure_security_defaults(db)
    set_role_permissions_bulk(db, role_id, allowed=False)
    record_security_audit(
        db,
        action="permission_changed",
        user_id=getattr(current, "id", None),
        target_type="role",
        target_id=role_id,
        detail="Revoked all permissions",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
    )
    return {"ok": True}


@router.get("/access-control/users/{user_id}/overrides", dependencies=[Depends(require_permission("access.view"))])
def access_control_get_overrides(user_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    _require_access_permission(db, _, "access.view")
    ensure_security_defaults(db)
    return get_user_permission_override_payload(db, user_id)


@router.put("/access-control/users/{user_id}/overrides", dependencies=[Depends(require_permission("access.manage_permissions"))])
def access_control_set_override(
    user_id: int,
    payload: dict,
    request: Request,
    db: Session = Depends(get_db),
    current=Depends(get_current_user),
):
    _require_access_permission(db, current, "access.manage_permissions")
    ensure_security_defaults(db)
    permission_id = int(payload.get("permission_id") or 0)
    effect = str(payload.get("effect") or "").strip().lower()
    reason = str(payload.get("reason") or "").strip()
    if permission_id <= 0:
        raise HTTPException(status_code=400, detail="permission_id is required")
    row = set_user_permission_override(
        db,
        user_id=user_id,
        permission_id=permission_id,
        effect=effect,
        actor_user_id=getattr(current, "id", None),
        reason=reason,
    )
    permission = db.query(Permission).filter(Permission.id == row.permission_id).first()
    record_security_audit(
        db,
        action="permission_override_changed",
        user_id=getattr(current, "id", None),
        target_type="user",
        target_id=user_id,
        detail=f"Override set: {permission.code if permission else permission_id} -> {effect}",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
    )
    return {"ok": True}


@router.delete("/access-control/users/{user_id}/overrides/{permission_id}", dependencies=[Depends(require_permission("access.manage_permissions"))])
def access_control_delete_override(
    user_id: int,
    permission_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current=Depends(get_current_user),
):
    _require_access_permission(db, current, "access.manage_permissions")
    ensure_security_defaults(db)
    removed = clear_user_permission_override(db, user_id, permission_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Override not found")
    record_security_audit(
        db,
        action="permission_override_deleted",
        user_id=getattr(current, "id", None),
        target_type="user",
        target_id=user_id,
        detail=f"Removed override for permission id {permission_id}",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
    )
    return {"ok": True}


@router.get("/access-control/sessions", dependencies=[Depends(require_permission("access.view_sessions"))])
def access_control_sessions(db: Session = Depends(get_db), _=Depends(get_current_user)):
    _require_access_permission(db, _, "access.view_sessions")
    ensure_security_defaults(db)
    rows = get_active_sessions(db)
    return [build_session_payload(row) for row in rows]


@router.post("/access-control/sessions/{session_id}/terminate", dependencies=[Depends(require_permission("access.force_logout"))])
def access_control_terminate_session(
    session_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current=Depends(get_current_user),
):
    _require_access_permission(db, current, "access.force_logout")
    ensure_security_defaults(db)
    from app.services.security_service import revoke_session

    ok = revoke_session(db, session_id, revoked_by_user_id=getattr(current, "id", None), reason="Force logout by admin")
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    record_security_audit(
        db,
        action="force_logout",
        user_id=getattr(current, "id", None),
        target_type="session",
        target_ref=session_id,
        detail="Session terminated from Access Control",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
    )
    return {"ok": True}


@router.post("/access-control/sessions/terminate-all", dependencies=[Depends(require_permission("access.force_logout"))])
def access_control_terminate_all_sessions(
    payload: dict | None,
    request: Request,
    db: Session = Depends(get_db),
    current=Depends(get_current_user),
):
    _require_access_permission(db, current, "access.force_logout")
    ensure_security_defaults(db)
    current_session = getattr(request.state, "auth_session", None)
    only_user_id = payload.get("user_id") if isinstance(payload, dict) else None
    terminated = 0
    from app.services.security_service import revoke_all_user_sessions

    if only_user_id:
        terminated = revoke_all_user_sessions(
            db,
            int(only_user_id),
            except_session_code=current_session.session_code if current_session else None,
            revoked_by_user_id=getattr(current, "id", None),
            reason="Force logout all by admin",
        )
    else:
        users = db.query(User).filter(User.is_deleted == False).all()
        for user in users:
            terminated += revoke_all_user_sessions(
                db,
                int(user.id),
                except_session_code=current_session.session_code if current_session and current_session.user_id == user.id else None,
                revoked_by_user_id=getattr(current, "id", None),
                reason="Force logout all by admin",
            )

    record_security_audit(
        db,
        action="force_logout_all",
        user_id=getattr(current, "id", None),
        target_type="session",
        target_ref=str(only_user_id or "all"),
        detail="Bulk session termination",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
        metadata={"terminated": terminated},
    )
    return {"ok": True, "terminated": terminated}


@router.get("/access-control/security-rules", dependencies=[Depends(require_permission("access.view"))])
def access_control_security_rules(db: Session = Depends(get_db), _=Depends(get_current_user)):
    _require_access_permission(db, _, "access.view")
    ensure_security_defaults(db)
    return get_security_settings(db)


@router.put("/access-control/security-rules", dependencies=[Depends(require_permission("access.manage_permissions"))])
def access_control_security_rules_update(
    payload: dict,
    request: Request,
    db: Session = Depends(get_db),
    current=Depends(get_current_user),
):
    _require_access_permission(db, current, "access.manage_permissions")
    ensure_security_defaults(db)
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload must be a JSON object")
    saved = set_security_settings(db, payload, updated_by_user_id=getattr(current, "id", None))
    record_security_audit(
        db,
        action="security_rules_changed",
        user_id=getattr(current, "id", None),
        target_type="security_settings",
        detail="Updated security rules",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
    )
    return saved


@router.get("/access-control/audit-logs", dependencies=[Depends(require_permission("audit.view"))])
def access_control_audit_logs(
    limit: int = 100,
    offset: int = 0,
    action: str | None = None,
    result: str | None = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_user),
):
    _require_access_permission(db, _, "access.view")
    ensure_security_defaults(db)
    q = db.query(SecurityAuditLog).order_by(SecurityAuditLog.created_at.desc())
    if action:
        q = q.filter(SecurityAuditLog.action == action)
    if result:
        q = q.filter(SecurityAuditLog.result == result)
    total = q.count()
    rows = q.offset(max(0, offset)).limit(min(max(limit, 1), 500)).all()
    return {
        "total": total,
        "rows": [
            {
                "id": row.id,
                "user_id": row.user_id,
                "user_name": row.user.full_name if row.user else None,
                "action": row.action,
                "target_type": row.target_type,
                "target_id": row.target_id,
                "target_ref": row.target_ref,
                "detail": row.detail,
                "ip_address": row.ip_address,
                "device_info": row.device_info,
                "result": row.result,
                "metadata": _safe_json_load(row.metadata_json, {}),
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ],
    }


@router.get("/access-control/users/{user_id}/effective-permissions", dependencies=[Depends(require_permission("access.view"))])
def access_control_effective_permissions(user_id: int, db: Session = Depends(get_db), _=Depends(get_current_user)):
    _require_access_permission(db, _, "access.view")
    ensure_security_defaults(db)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    codes = sorted(list(get_effective_permission_codes(db, user)))
    return {"user_id": user_id, "permissions": codes}


@router.post("/access-control/users/{user_id}/unlock", dependencies=[Depends(require_permission("access.edit_user"))])
def access_control_unlock_user(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current=Depends(get_current_user),
):
    _require_access_permission(db, current, "access.reset_password")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.failed_login_count = 0
    user.account_locked_until = None
    db.commit()
    record_security_audit(
        db,
        action="account_unlocked",
        user_id=getattr(current, "id", None),
        target_type="user",
        target_id=user.id,
        target_ref=user.username,
        detail="Account unlocked by admin",
        ip_address=get_request_ip(request),
        device_info=get_request_device_info(request),
        result="success",
    )
    return {"ok": True}


@router.get("/print-profile", dependencies=[Depends(require_permission("settings.view"))])
def get_print_profile(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return _get_setting_dict(db, PRINT_PROFILE_KEY, DEFAULT_PRINT_PROFILE)


@router.put("/print-profile", dependencies=[Depends(require_permission("settings.store_profile"))])
def update_print_profile(payload: PrintProfileIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    saved = _save_setting_dict(db, PRINT_PROFILE_KEY, payload.model_dump())
    state = _ensure_settings_state(db)
    state = _hydrate_state_from_legacy(state, db)
    _save_setting_dict(db, SETTINGS_STATE_KEY, state)
    return saved


@router.get("/ui-preferences", dependencies=[Depends(require_permission("settings.view"))])
def get_ui_preferences(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return _get_setting_dict(db, UI_PREFERENCES_KEY, DEFAULT_UI_PREFERENCES)


@router.put("/ui-preferences", dependencies=[Depends(require_permission("settings.edit"))])
def update_ui_preferences(payload: UiPreferencesIn, db: Session = Depends(get_db), _=Depends(get_current_user)):
    saved = _save_setting_dict(db, UI_PREFERENCES_KEY, payload.model_dump())
    state = _ensure_settings_state(db)
    state = _hydrate_state_from_legacy(state, db)
    _save_setting_dict(db, SETTINGS_STATE_KEY, state)
    return saved


@router.get("/business-preferences", dependencies=[Depends(require_permission("settings.view"))])
def get_business_preferences(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return _get_setting_dict(db, BUSINESS_PREFS_KEY, DEFAULT_BUSINESS_PREFS)


@router.put("/business-preferences", dependencies=[Depends(require_permission("settings.business_rules"))])
def update_business_preferences(payload: dict, db: Session = Depends(get_db), _=Depends(get_current_user)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload must be a JSON object")
    saved = _save_setting_dict(db, BUSINESS_PREFS_KEY, payload)
    state = _ensure_settings_state(db)
    state = _hydrate_state_from_legacy(state, db)
    _save_setting_dict(db, SETTINGS_STATE_KEY, state)
    return saved


@router.get("/integrations", dependencies=[Depends(require_permission("settings.view"))])
def get_integrations_preferences(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return _get_setting_dict(db, INTEGRATIONS_PREFS_KEY, DEFAULT_INTEGRATIONS_PREFS)


@router.put("/integrations", dependencies=[Depends(require_permission("settings.system_settings"))])
def update_integrations_preferences(payload: dict, db: Session = Depends(get_db), _=Depends(get_current_user)):
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload must be a JSON object")
    saved = _save_setting_dict(db, INTEGRATIONS_PREFS_KEY, payload)
    state = _ensure_settings_state(db)
    state = _hydrate_state_from_legacy(state, db)
    _save_setting_dict(db, SETTINGS_STATE_KEY, state)
    return saved

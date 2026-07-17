import re

with open('frontend/src/components/settings/InvoiceJobLabelCustomizer.jsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Import BoxedDetailedInvoice
if 'BoxedDetailedInvoice' not in content:
    content = content.replace('import { PrintLabel } from "../print/PrintLabel";', 
                              'import { PrintLabel } from "../print/PrintLabel";\nimport { BoxedDetailedInvoice } from "../print/BoxedDetailedInvoice";')

# 2. Add it to default templates list
if '{ id: "sales_a4_boxed"' not in content:
    boxed_setting = '{ id: "sales_a4_boxed", name: "Boxed Detailed", document: "sales_bill", format: "a4", deployed: true, settings: { ...defaultSalesSettings("a4"), layout: { preset_type: "boxed" } } },'
    # We must mark the old 'sales_a4_default' as deployed: false so this is the default
    content = content.replace('{ id: "sales_a4_default", name: "Default", document: "sales_bill", format: "a4", deployed: true,', 
                              '{ id: "sales_a4_default", name: "Default", document: "sales_bill", format: "a4", deployed: false,')
    content = content.replace('{ id: "sales_a5_formal"', boxed_setting + '\n    { id: "sales_a5_formal"')

if '{ id: "job_a4_boxed"' not in content:
    boxed_job_setting = '{ id: "job_a4_boxed", name: "Boxed Detailed", document: "job_card", format: "a4", deployed: true, settings: { ...defaultJobSettings("a4"), layout: { preset_type: "boxed" } } },'
    content = content.replace('{ id: "job_a4_default", name: "Default", document: "job_card", format: "a4", deployed: true,', 
                              '{ id: "job_a4_default", name: "Default", document: "job_card", format: "a4", deployed: false,')
    content = content.replace('{ id: "job_a5_counter"', boxed_job_setting + '\n    { id: "job_a5_counter"')

# 3. Add to preview renderer
preview_str = '{documentId === "sales_bill" && settings?.layout?.preset_type === "boxed" && <BoxedDetailedInvoice settings={settings} storeProfile={storeProfile} invoice={{ invoice_number: "INV-12345", customer_name: "Sarah Johnson", customer_phone: "+94 77 123 4567", balance_due: 0, subtotal: 8000, discount_total: 500, tax_total: 1215, grand_total: 8715, created_at: "2026-07-16T15:25:00Z", lines: [{ description: "Smartphone Stand", qty: 2, unit_price: 2500, line_total: 5000 }, { description: "Screen Protector", qty: 1, unit_price: 3000, line_total: 3000 }] }} />}\n                  '
if 'preset_type === "boxed"' not in content:
    content = content.replace('{documentId === "sales_bill" && settings?.layout?.preset_type === "premium"', preview_str + '{documentId === "sales_bill" && settings?.layout?.preset_type === "premium"')

job_preview_str = '{documentId === "job_card" && settings?.layout?.preset_type === "boxed" && <BoxedDetailedInvoice settings={settings} storeProfile={storeProfile} invoice={{ repair_details: { brand: "Apple", model: "iPhone 13", imei: "354123456789012", condition: "Fair", accessories: "Charger", reported_issue: "Screen cracked", technician_notes: "Needs new digitizer" } }} />}\n                  '
if 'documentId === "job_card" && settings?.layout?.preset_type === "boxed"' not in content:
    content = content.replace('{documentId === "job_card" && <PrintJobCard', job_preview_str + '{documentId === "job_card" && settings?.layout?.preset_type !== "boxed" && <PrintJobCard')


with open('frontend/src/components/settings/InvoiceJobLabelCustomizer.jsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated Customizer")

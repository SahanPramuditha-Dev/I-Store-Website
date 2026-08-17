# WhatsApp Web Microservice (No-API Integration)

A standalone Node.js REST API microservice built with `whatsapp-web.js` and Express. It automates WhatsApp Web using a headless browser to send and receive WhatsApp messages programmatically without using Meta's paid Cloud API.

---

## 🚀 Quick Start Guide

### 1. Install Dependencies
Open your terminal in the `whatsapp_service` directory:
```bash
cd whatsapp_service
npm install
```

### 2. Start the Service
```bash
npm start
```

### 3. Pair Your Phone (First Time Only)
1. When you run `npm start`, a **QR code** will print directly in your terminal.
2. Open WhatsApp on your mobile phone.
3. Go to **Settings / Menu** -> **Linked Devices** -> **Link a Device**.
4. Scan the QR code in your terminal.
5. Once scanned, you will see `✅ WhatsApp Web Client is CONNECTED and ready!`.

> **Note**: Sessions are saved locally in `.wwebjs_auth/`. You only need to scan the QR code once. On future restarts, it automatically reconnects.

---

## 📡 REST API Documentation

Base URL: `http://localhost:3001`

### 1. Check Connection Status
* **Endpoint**: `GET /status`
* **Response**:
```json
{
  "success": true,
  "status": "CONNECTED",
  "qrCodeAvailable": false
}
```

---

### 2. Send Text Message
* **Endpoint**: `POST /api/send-message`
* **Headers**: `Content-Type: application/json`
* **Body**:
```json
{
  "phone": "94771234567",
  "message": "Hello! Your order #1002 has been confirmed."
}
```
* **Response**:
```json
{
  "success": true,
  "messageId": "false_94771234567@c.us_3EB0...",
  "to": "94771234567",
  "status": "SENT"
}
```

---

### 3. Send Media / Document
* **Endpoint**: `POST /api/send-media`
* **Headers**: `Content-Type: application/json`
* **Body**:
```json
{
  "phone": "94771234567",
  "mediaUrl": "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
  "caption": "Here is your invoice PDF",
  "filename": "Invoice_1002.pdf"
}
```

---

## 🐍 Integration Example (Python / FastAPI Backend)

You can trigger WhatsApp messages directly from your Python backend using `httpx` or `requests`:

```python
import httpx

def send_whatsapp_notification(phone: str, message: str):
    url = "http://localhost:3001/api/send-message"
    payload = {
        "phone": phone,
        "message": message
    }
    response = httpx.post(url, json=payload)
    return response.json()
```

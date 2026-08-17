# Deployment & Production Operations Guide

This guide covers the deployment strategies for **iStore ERP**, supporting **Desktop (Electron/Windows)**, **Local Network / Docker**, and **Cloud (Vercel + Neon PostgreSQL)**.

---

## 1. Architecture Overview

```mermaid
flowchart TD
    subgraph Desktop / Local Deployment
        ElectronApp[Electron Desktop Shell]
        ReactUI[React / Vite Frontend]
        FastAPIBackend[FastAPI Python Backend]
        SQLiteDB[(SQLite Database)]
        WhatsAppSvc[Node.js WhatsApp Microservice]

        ElectronApp --> ReactUI
        ReactUI -->|HTTP / REST| FastAPIBackend
        FastAPIBackend --> SQLiteDB
        FastAPIBackend -->|Internal REST| WhatsAppSvc
    end

    subgraph Cloud Deployment
        VercelFrontend[Vercel Frontend - SPA]
        VercelBackend[Vercel Serverless FastAPI]
        NeonPostgres[(Neon.tech Serverless PostgreSQL)]
        CustomerPortal[Customer Public Tracking Portal]

        VercelFrontend -->|HTTPS| VercelBackend
        VercelBackend -->|SSL Connection Pool| NeonPostgres
        FastAPIBackend -.->|Outbox Cloud Sync| CustomerPortal
    end
```

---

## 2. Desktop Packaging (Electron / Windows)

iStore ERP can be compiled into a standalone Windows installer (.exe) packaging the Python backend with PyInstaller and the React UI with Electron.

### Build Prerequisites
- Windows 10/11
- Node.js 18+ and npm
- Python 3.10+ (with virtual environment)
- Inno Setup 6 (optional, for custom installer compilation)

### Build Commands

Run the automated release build script from project root:
```powershell
.\build-release.bat
```

Or manually:

```powershell
# 1. Build frontend
cd frontend
npm install
npm run build

# 2. Build Python backend bundle
cd ../backend
.venv\Scripts\activate
pip install -r requirements.txt
pyinstaller --noconfirm --onedir --windowed --add-data "app;app" --name "IStoreBackend" app/main.py

# 3. Package Electron
cd ../electron
npm install
npm run dist
```

Installers and binaries are generated in the `electron/dist/` directory.

---

## 3. Cloud Deployment (Vercel + Neon PostgreSQL)

### 3.1. Database Setup (Neon PostgreSQL)
1. Create a PostgreSQL project at [Neon.tech](https://neon.tech).
2. Copy the pooled connection string (`postgresql://username:password@ep-...neon.tech/neondb?sslmode=require`).

### 3.2. Backend Deployment (Vercel)
Deploy `backend/` as a serverless project on Vercel:
- **Root Directory**: `backend`
- **Environment Variables**:
  - `DATABASE_URL`: Your Neon PostgreSQL connection string.
  - `SECRET_KEY`: High-entropy 32+ character string.
  - `CORS_ORIGINS`: Frontend URL (e.g., `https://i-store-website.vercel.app`).
  - `APP_ENV`: `production`

### 3.3. Frontend Deployment (Vercel)
Deploy `frontend/` as a static SPA project on Vercel:
- **Root Directory**: `frontend`
- **Framework Preset**: `Vite`
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Environment Variables**:
  - `VITE_API_URL`: Backend Vercel URL (e.g., `https://i-store-website-by6z.vercel.app`).

---

## 4. Docker Deployment

A multi-container setup running PostgreSQL and FastAPI is provided via `docker-compose.yml`:

```bash
# Start backend and PostgreSQL containers
docker-compose up -d --build

# Inspect logs
docker-compose logs -f backend

# Stop services
docker-compose down
```

---

## 5. Production Environment Variables Reference

| Variable | Description | Example / Recommended |
| :--- | :--- | :--- |
| `APP_ENV` | Environment mode (`development` / `production`) | `production` |
| `SECRET_KEY` | JWT signing secret key | 32+ random characters |
| `DATABASE_URL` | SQLAlchemy connection string | `postgresql://user:pass@host/db?sslmode=require` |
| `CORS_ORIGINS` | Allowed frontend origins (comma separated) | `https://istore.yourdomain.com` |
| `GEMINI_API_KEY` | Google Gemini AI API key | `AQ.Ab8...` |
| `WHATSAPP_SERVICE_SECRET` | Secret token between FastAPI & WhatsApp bot | Strong random secret |
| `WHATSAPP_SERVICE_URL` | Local URL for Node.js WhatsApp microservice | `http://127.0.0.1:3001` |
| `CUSTOMER_PORTAL_URL` | Public tracking URL for digital receipts | `https://i-store-customer-portal.vercel.app` |
| `BACKUP_BEFORE_MIGRATE` | Auto snapshot before DB migrations | `true` |

---

## 6. Database Backups & Rollback Policies

1. **Local SQLite Backup**: Local backups are stored under `backups/` and the OS AppData path. Ensure regular snapshots before running migrations.
2. **Cloud Storage (Firebase / R2)**: Set `FIREBASE_SERVICE_ACCOUNT` or `R2_*` credentials in `.env` to enable offsite backup syncing.
3. **Rollback Strategy**:
   - Application rollback: Reinstall the previous Electron binary / revert Vercel deployment commit.
   - Database rollback: In case of schema migration failure, restore the pre-migration snapshot using `docs/RECOVERY_GUIDE.md` and `docs/BACKUP_RESTORE.md`.

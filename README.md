# I-Store Website (Inventory & POS System)

A web-based POS, inventory, and repair management application. This project has been optimized to deploy the frontend and backend separately on Vercel with a Postgres database on Neon.tech.

## Architecture & Deployment Strategy

*   **Frontend**: Built with React / Vite. Hosted on Vercel at `https://i-store-website.vercel.app`.
*   **Backend**: Built with FastAPI. Hosted on Vercel Serverless at `https://i-store-website-by6z.vercel.app`.
*   **Database**: PostgreSQL hosted on Neon.tech.

---

## Deployment Configuration & Environment Setup

### 1. Backend Environment Variables (Vercel)

Add the following environment variables to your Vercel backend project (`i-store-website-by6z`):

*   **`SQLITE_URL`**: Your Neon PostgreSQL database connection string (e.g. `postgresql://neondb_owner:...@ep-...aws.neon.tech/neondb?sslmode=require`).
*   **`CORS_ORIGINS`**: The origin allowed to connect to the backend (e.g. `https://i-store-website.vercel.app` - without a trailing slash).

### 2. Frontend Configuration

*   The frontend uses `vercel.json` SPA rewrites to ensure React Router client-side routing works without throwing 404 errors on refresh.
*   Ensure that the frontend API target URL points to the Vercel backend deployment domain.

---

## Local Development

### Backend Setup
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

# I-Store Website (Inventory & POS System)

A web-based POS, inventory, and repair management application. This project has been optimized to deploy the frontend and backend separately on Vercel with a Postgres database on Neon.tech.

## Screenshots

The project includes a collection of screenshots for the main modules and workflows. A few highlights are shown below, and the full set is stored in the Screenshots folder.

### Main modules

![Settings](Screenshots/Settings.png)
![Tasks](Screenshots/Tasks.png)
![Timer](Screenshots/Timer.png)
![Video tracker](Screenshots/VideoTracker.png)
![Workspace](Screenshots/Workspace.png)

### Additional captures

![Overview 1](Screenshots/screenshot-01.png)
![Overview 2](Screenshots/screenshot-02.png)
![Overview 3](Screenshots/screenshot-03.png)
![Overview 4](Screenshots/screenshot-04.png)

Additional files are available in the [Screenshots](Screenshots) directory:

- [screenshot-01](Screenshots/screenshot-01.png)
- [screenshot-02](Screenshots/screenshot-02.png)
- [screenshot-03](Screenshots/screenshot-03.png)
- [screenshot-04](Screenshots/screenshot-04.png)
- [screenshot-05](Screenshots/screenshot-05.png)
- [screenshot-06](Screenshots/screenshot-06.png)
- [screenshot-07](Screenshots/screenshot-07.png)
- [screenshot-08](Screenshots/screenshot-08.png)
- [screenshot-09](Screenshots/screenshot-09.png)
- [screenshot-10](Screenshots/screenshot-10.png)
- [screenshot-11](Screenshots/screenshot-11.png)
- [screenshot-12](Screenshots/screenshot-12.png)
- [screenshot-13](Screenshots/screenshot-13.png)
- [screenshot-14](Screenshots/screenshot-14.png)
- [screenshot-15](Screenshots/screenshot-15.png)
- [screenshot-16](Screenshots/screenshot-16.png)
- [screenshot-17](Screenshots/screenshot-17.png)
- [screenshot-18](Screenshots/screenshot-18.png)
- [Settings](Screenshots/Settings.png)
- [Tasks](Screenshots/Tasks.png)
- [Timer](Screenshots/Timer.png)
- [VideoTracker](Screenshots/VideoTracker.png)
- [Workspace](Screenshots/Workspace.png)

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

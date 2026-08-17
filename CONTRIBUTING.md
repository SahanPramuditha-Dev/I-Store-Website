# Contributing to iStore ERP

Thank you for your interest in contributing to **iStore ERP**! We welcome contributions to enhance features, fix bugs, improve performance, and expand documentation.

---

## Code of Conduct

Please be respectful, collaborative, and constructive when opening issues, submitting pull requests, or participating in discussions.

---

## Development Workflow

### 1. Fork & Clone

```bash
git clone https://github.com/SahanPramuditha-Dev/I-Store-Website.git
cd I-Store-Website
```

### 2. Branch Naming Convention

Use clear branch prefixes:
- `feat/feature-name` for new features
- `fix/bug-fix-name` for bug fixes
- `refactor/improvement-name` for code refactoring
- `docs/documentation-update` for documentation changes

```bash
git checkout -b feat/your-feature-name
```

### 3. Environment Setup

1. Copy `.env.example` to `.env` and adjust your variables:
   ```bash
   cp .env.example .env
   ```

2. **Backend Setup:**
   ```bash
   cd backend
   python -m venv .venv
   # Windows:
   .venv\Scripts\activate
   # Linux / macOS:
   source .venv/bin/activate

   pip install -r requirements.txt
   ```

3. **Frontend Setup:**
   ```bash
   cd ../frontend
   npm install
   ```

4. **WhatsApp Microservice (Optional for WhatsApp Bot features):**
   ```bash
   cd ../whatsapp_service
   npm install
   ```

### 4. Running the Dev Environment

You can start the full stack using the automated PowerShell script:
```powershell
.\start_dev.ps1
```
Or start each service independently:
- **Backend:** `cd backend && uvicorn app.main:app --reload --port 8000`
- **Frontend:** `cd frontend && npm run dev`
- **WhatsApp Service:** `cd whatsapp_service && npm start`

---

## Code Guidelines & Standards

### Frontend (React & Vite)
- Use standard React Hooks and modern functional components.
- Maintain CSS variables and theme definitions in `src/styles/theme.js` and `src/index.css`.
- Ensure responsive UI designs across desktop and tablet viewport sizes.
- Verify modals and forms handle errors gracefully with user feedback notifications.

### Backend (FastAPI & SQLAlchemy)
- Adhere to PEP 8 standards.
- Ensure all API endpoints define Pydantic request and response schemas in `backend/app/schemas.py`.
- Handle database sessions with dependency injection (`get_db`).
- Document endpoints and query parameters clearly.

### Database Migrations
- When altering models in `backend/app/models.py`, generate Alembic migrations:
  ```bash
  cd backend
  alembic revision --autogenerate -m "describe_migration"
  alembic upgrade head
  ```

---

## Testing & Verification

Run backend unit and integration tests before submitting PRs:
```bash
cd backend
pytest
```

Run frontend build verification:
```bash
cd frontend
npm run build
```

---

## Submitting Pull Requests

1. Commit your changes with concise and descriptive commit messages.
2. Push your feature branch to your fork.
3. Open a Pull Request against `main`.
4. Provide a clear PR description detailing:
   - Summary of changes
   - Related issue numbers
   - Steps to test/reproduce
   - Screenshots/recordings for UI updates

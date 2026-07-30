"""
Test configuration — ensures every test runs against an isolated temp SQLite
database and NEVER touches the live database/istore.db file.

Strategy
--------
* A session-scoped ``pytest_configure`` hook sets all required env vars before
  any application module is imported.  This guarantees that when app.config /
  app.database are first loaded they already see the temp-file path.
* Each test gets its own ``tmp_path``-based DB so tests cannot share state.
* After every test the SQLAlchemy engine is disposed to release file locks.
"""

import os
import sys
import importlib
from pathlib import Path
import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Module-level sentinel — we patch os.environ BEFORE the app is ever imported.
# If app modules are already cached in sys.modules we reload them in the
# fixture so they pick up the per-test DATABASE_URL.
# ---------------------------------------------------------------------------

def _set_test_env(db_path: str) -> None:
    """Stamp all env vars that app.config.Settings() reads."""
    posix = Path(db_path).as_posix()
    os.environ["APP_ENV"] = "test"
    os.environ["SQLITE_FILE"] = db_path
    os.environ["SQLITE_URL"] = f"sqlite:///{posix}"
    os.environ["DATABASE_URL"] = f"sqlite:///{posix}"
    os.environ["BACKUP_ENCRYPT"] = "false"
    os.environ["SECRET_KEY"] = "test-secret-key-32-chars-minimum!"
    os.environ["CORS_ORIGINS"] = "http://localhost:5173"
    os.environ["SEED_DEMO_DATA"] = "true"


@pytest.fixture()
def client(tmp_path: Path):
    db_file = str(tmp_path / "test_istore.db")
    backup_dir = str(tmp_path / "backups")
    os.environ["BACKUP_FOLDER"] = backup_dir

    _set_test_env(db_file)

    # ------------------------------------------------------------------
    # Reload the entire app module graph so each test gets a fresh engine
    # pointing at its own temp DB.  Order matters: config → database → main.
    # ------------------------------------------------------------------
    app_modules = [k for k in sys.modules if k.startswith("app")]
    for mod in app_modules:
        sys.modules.pop(mod, None)

    import app.config  # noqa: E402 – imported after env is set
    import app.database  # noqa: E402
    import app.main  # noqa: E402

    # Belt-and-suspenders: force settings to re-read the current env
    app.config.settings = app.config.Settings()
    # Also update the module-level db_url so the already-created engine URL
    # is consistent with what we expect (engine is created at import time
    # using app.config.settings which we just refreshed).
    app.database.db_url = app.config.settings.database_url

    with TestClient(app.main.app) as tc:
        yield tc

    # Release file locks so Windows can delete the temp dir
    try:
        app.database.engine.dispose()
    except Exception:
        pass

    # Evict app modules again so the next test starts clean
    for mod in list(sys.modules):
        if mod.startswith("app"):
            sys.modules.pop(mod, None)


@pytest.fixture()
def auth_headers(client: TestClient):
    bootstrap_status = client.get("/auth/bootstrap/status")
    assert bootstrap_status.status_code == 200, bootstrap_status.text
    status_payload = bootstrap_status.json()
    if status_payload.get("setup_required"):
        bootstrap_resp = client.post(
            "/auth/bootstrap/owner",
            json={
                "username": "owner",
                "full_name": "Owner User",
                "password": "Owner#Pass2026",
                "phone_number": "0770000000",
                "email": "owner@example.com",
            },
        )
        assert bootstrap_resp.status_code == 200, bootstrap_resp.text

    resp = client.post(
        "/auth/login",
        data={"username": "owner", "password": "Owner#Pass2026"},
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

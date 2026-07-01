import os
import importlib
from pathlib import Path
import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path: Path):
    db_file = tmp_path / "test_istore.db"
    os.environ["APP_ENV"] = "development"
    os.environ["SQLITE_FILE"] = str(db_file)
    os.environ["SQLITE_URL"] = f"sqlite:///{db_file.as_posix()}"
    os.environ["BACKUP_FOLDER"] = str(tmp_path / "backups")
    os.environ["BACKUP_ENCRYPT"] = "false"
    os.environ["SECRET_KEY"] = "test-secret-key"
    os.environ["CORS_ORIGINS"] = "http://localhost:5173"
    os.environ["SEED_DEMO_DATA"] = "true"

    import app.config
    import app.database
    import app.main
    importlib.reload(app.config)
    importlib.reload(app.database)
    importlib.reload(app.main)

    with TestClient(app.main.app) as tc:
        yield tc
    try:
        app.database.engine.dispose()
    except Exception:
        pass


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

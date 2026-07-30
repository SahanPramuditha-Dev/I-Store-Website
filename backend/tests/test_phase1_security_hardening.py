import pytest
from app.config import Settings


def test_active_staff_requires_auth(client):
    resp = client.get("/auth/active-staff")
    assert resp.status_code == 401, resp.text


def test_active_staff_succeeds_with_auth(client, auth_headers):
    resp = client.get("/auth/active-staff", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    assert isinstance(resp.json(), list)


def test_reset_password_enforces_policy(client, auth_headers):
    # Weak password should fail
    resp = client.post("/auth/users/1/reset-password", json={"new_password": "123"}, headers=auth_headers)
    assert resp.status_code == 400
    assert "password" in resp.text.lower() or "length" in resp.text.lower() or "character" in resp.text.lower() or "policy" in resp.text.lower()


def test_production_secret_key_rejection():
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        Settings(env="production", secret_key="change-this-secret")

from app.services.portal_config import load_portal_config


def test_selected_tenant_never_inherits_shared_portal_credentials(tmp_path, monkeypatch):
    backend = tmp_path / "backend"
    tenant = tmp_path / "tenants" / "IPOINT"
    backend.mkdir()
    tenant.mkdir(parents=True)
    (backend / ".portal-sync.env").write_text("CLOUDFLARE_PORTAL_STORE_REF=other-shop\n")
    monkeypatch.setenv("CLOUDFLARE_PORTAL_STORE_REF", "")
    monkeypatch.delenv("CLOUDFLARE_PORTAL_STORE_REF")
    monkeypatch.setenv("ISTORE_DATA_ROOT", str(tenant))
    load_portal_config(backend)
    import os
    assert not os.getenv("CLOUDFLARE_PORTAL_STORE_REF")
    (tenant / ".portal-sync.env").write_text("CLOUDFLARE_PORTAL_STORE_REF=i-store\n")
    load_portal_config(backend)
    assert os.getenv("CLOUDFLARE_PORTAL_STORE_REF") == "i-store"

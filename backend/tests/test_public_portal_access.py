import pytest
from fastapi import HTTPException

from app.routers.public_portal_router import get_public_invoice, get_public_repair


@pytest.mark.parametrize("endpoint", [get_public_invoice, get_public_repair])
def test_customer_details_require_whatsapp_session(endpoint):
    with pytest.raises(HTTPException) as exc:
        endpoint("INV-1", authorization=None, db=None)
    assert exc.value.status_code == 401


@pytest.mark.parametrize("endpoint", [get_public_invoice, get_public_repair])
def test_invalid_session_rejected_before_lookup(endpoint):
    with pytest.raises(HTTPException) as exc:
        endpoint("INV-1", authorization="Bearer invalid", db=None)
    assert exc.value.status_code == 401

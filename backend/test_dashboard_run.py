import sys
sys.path.insert(0, '.')
import traceback

try:
    from app.database import SessionLocal
    from app.routers.dashboard_router import dashboard
    from unittest.mock import MagicMock

    db = SessionLocal()
    try:
        result = dashboard(period="12m", db=db, _=None)
        print("SUCCESS: Dashboard 12m returned OK")
        print("Keys:", list(result.keys()))
    except Exception as e:
        print(f"RUNTIME ERROR: {e}")
        traceback.print_exc()
    finally:
        db.close()
except Exception as e:
    print(f"SETUP ERROR: {e}")
    traceback.print_exc()

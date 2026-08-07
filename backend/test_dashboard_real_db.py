import sys, os
sys.path.insert(0, '.')
import traceback

os.environ["SQLITE_FILE"] = r"sqlite:///C:/Users/sahan/AppData/Roaming/istore-electron/iStore/iStore/database/istore.db"

try:
    from app.database import SessionLocal
    from app.routers.dashboard_router import dashboard

    db = SessionLocal()
    try:
        result = dashboard(period="12m", db=db, _=None)
        print("SUCCESS: Dashboard 12m returned OK!")
        print("Keys count:", len(result.keys()))
    except Exception as e:
        print(f"RUNTIME ERROR: {e}")
        traceback.print_exc()
    finally:
        db.close()
except Exception as e:
    print(f"SETUP ERROR: {e}")
    traceback.print_exc()

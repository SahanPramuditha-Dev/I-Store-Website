import sys, os
sys.path.insert(0, '.')
import sqlite3

db_path = r"C:\Users\sahan\AppData\Roaming\istore-electron\iStore\iStore\database\istore.db"
os.environ["SQLITE_FILE"] = db_path
os.environ["DATABASE_URL"] = f"sqlite:///{db_path.replace('\\', '/')}"

from app.database import SessionLocal
from app.routers.dashboard_router import dashboard

db = SessionLocal()
try:
    res = dashboard(period="12m", db=db, _=None)
    print("SUCCESS! Dashboard returned OK with keys:")
    print(list(res.keys()))
except Exception as e:
    print("DASHBOARD ERROR:", e)
    import traceback
    traceback.print_exc()
finally:
    db.close()

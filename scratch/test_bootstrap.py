import sys
from app.database import SessionLocal
from app.routers.auth_router import bootstrap_status

db = SessionLocal()
try:
    res = bootstrap_status(db)
    print("Bootstrap status result:", res)
finally:
    db.close()

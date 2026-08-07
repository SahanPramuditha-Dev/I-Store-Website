import sys
sys.path.insert(0, '.')
try:
    from app.routers.dashboard_router import router
    print("Dashboard router import OK")
except Exception as e:
    print(f"IMPORT ERROR: {e}")
    import traceback
    traceback.print_exc()

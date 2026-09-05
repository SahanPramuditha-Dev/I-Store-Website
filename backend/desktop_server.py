"""Entrypoint used by the packaged Electron desktop application."""

import os
import sys

# Ensure the bundled app package is resolvable when running as a PyInstaller
# frozen executable. PyInstaller extracts files to sys._MEIPASS in one-dir mode.
if getattr(sys, "frozen", False):
    bundle_path = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    if bundle_path not in sys.path:
        sys.path.insert(0, bundle_path)
else:
    source_path = os.path.dirname(__file__)
    if source_path not in sys.path:
        sys.path.insert(0, source_path)

import uvicorn
from app.main import app


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.getenv("ISTORE_API_HOST", "127.0.0.1"),
        port=int(os.getenv("ISTORE_API_PORT", "8000")),
        log_level=os.getenv("ISTORE_API_LOG_LEVEL", "info"),
        # The optional httptools wheel is not reliable in frozen Python 3.14
        # builds. h11 is fully supported by Uvicorn and avoids a listener that
        # opens successfully but crashes on every incoming request.
        http="h11",
    )

"""Entrypoint used by the packaged Electron desktop application."""

import os

import uvicorn
from app.main import app


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.getenv("ISTORE_API_HOST", "127.0.0.1"),
        port=int(os.getenv("ISTORE_API_PORT", "8000")),
        log_level=os.getenv("ISTORE_API_LOG_LEVEL", "info"),
    )

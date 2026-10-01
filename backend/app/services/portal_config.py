"""Keep portal credentials inside the selected desktop tenant's data root."""
import os
from pathlib import Path
from dotenv import load_dotenv


def load_portal_config(backend_root):
    data_root = os.getenv("ISTORE_DATA_ROOT")
    root = Path(data_root) if data_root else Path(backend_root)
    # A selected tenant must never inherit another installation's portal file.
    load_dotenv(root / ".portal-sync.env", override=False)

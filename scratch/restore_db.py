import sqlite3
import shutil
import os

backup_db = r"c:\D\Projects\Websites\I Store Website\database\backups\istore_before_clean_reset_20260801_092111.db"
target_db = r"C:\Users\sahan\AppData\Local\iStore\database\istore.db"

print(f"Restoring backup from {backup_db} to {target_db}")

# Stop WAL mode locks if any
if os.path.exists(target_db + "-wal"):
    try:
        os.remove(target_db + "-wal")
    except Exception as e:
        print("Could not remove WAL file:", e)

if os.path.exists(target_db + "-shm"):
    try:
        os.remove(target_db + "-shm")
    except Exception as e:
        print("Could not remove SHM file:", e)

shutil.copy2(backup_db, target_db)

conn = sqlite3.connect(target_db)
print("Restored database integrity check:", conn.execute("PRAGMA integrity_check;").fetchall())
users = conn.execute("SELECT id, username, role FROM users").fetchall()
print("Restored users:", users)

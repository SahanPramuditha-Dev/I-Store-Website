import shutil
import sqlite3
import os

# The path the RUNNING backend is actually using (corrupted)
bad_db = r"C:\Users\sahan\AppData\Roaming\istore-electron\iStore\iStore\database\istore.db"
# Our good backup
good_db = r"c:\D\Projects\Websites\I Store Website\database\backups\istore_before_clean_reset_20260801_092111.db"

print(f"Restoring {good_db} -> {bad_db}")

# Remove WAL/SHM files if any
for ext in ["-wal", "-shm"]:
    p = bad_db + ext
    if os.path.exists(p):
        try:
            os.remove(p)
            print(f"Removed {p}")
        except Exception as e:
            print(f"Could not remove {p}: {e}")

shutil.copy2(good_db, bad_db)
print("Copy done.")

conn = sqlite3.connect(bad_db)
print("Integrity:", conn.execute("PRAGMA integrity_check;").fetchall())
print("Users:", conn.execute("SELECT id, username, role FROM users").fetchall())

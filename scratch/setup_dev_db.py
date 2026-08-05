import shutil
import sqlite3

backup_db = r"c:\D\Projects\Websites\I Store Website\database\backups\istore_before_clean_reset_20260801_092111.db"
target_dev_db = r"c:\D\Projects\Websites\I Store Website\database\istore.db"

print("Copying valid database backup to development project database path...")
shutil.copy2(backup_db, target_dev_db)

conn = sqlite3.connect(target_dev_db)
print("Dev database check:", conn.execute("PRAGMA integrity_check;").fetchall())
users = conn.execute("SELECT id, username, role FROM users").fetchall()
print("Dev database users:", users)

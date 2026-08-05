import sqlite3
import os

paths = [
    r"C:\Users\sahan\AppData\Roaming\iStore\istore.db",
    r"c:\D\Projects\Websites\I Store Website\database\backups\istore_before_clean_reset_20260801_092111.db"
]

for p in paths:
    print("---", p, "---")
    if not os.path.exists(p):
        print("Does not exist")
        continue
    try:
        conn = sqlite3.connect(p)
        users = conn.execute("SELECT id, username, role FROM users").fetchall()
        print(f"Users ({len(users)}):", users)
    except Exception as e:
        print("Error:", e)

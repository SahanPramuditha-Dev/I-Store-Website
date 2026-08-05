import sqlite3

db_path = r"C:\Users\sahan\AppData\Local\iStore\database\istore.db"
print(f"Checking database at {db_path}...")

try:
    conn = sqlite3.connect(db_path)
    res = conn.execute("PRAGMA integrity_check;").fetchall()
    print("Integrity check result:", res)
    
    users = conn.execute("SELECT id, username, role FROM users").fetchall()
    print(f"Users found ({len(users)}):", users)
except Exception as e:
    print("Error during check:", e)

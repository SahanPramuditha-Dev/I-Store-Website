import sqlite3

# Check the corrupted DB the running backend is using
bad_db = r"C:\Users\sahan\AppData\Roaming\istore-electron\iStore\iStore\database\istore.db"
good_db = r"C:\Users\sahan\AppData\Local\iStore\database\istore.db"

for label, path in [("RUNNING (corrupted?)", bad_db), ("RESTORED (good)", good_db)]:
    print(f"\n--- {label} ---")
    print(f"Path: {path}")
    try:
        conn = sqlite3.connect(path)
        result = conn.execute("PRAGMA integrity_check;").fetchall()
        print("Integrity:", result)
        users = conn.execute("SELECT id, username, role FROM users").fetchall()
        print(f"Users ({len(users)}):", users)
    except Exception as e:
        print("Error:", e)

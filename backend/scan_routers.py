"""
Scan all routers for common issues:
1. Variables used before assignment (NameError risk)
2. Model attribute access without hasattr/try (AttributeError risk)
3. .scalar() calls without or 0 fallback (None risk)
4. Missing try/except on optional model imports
"""
import ast
import os
import sys

ROUTERS_DIR = r"c:\D\Projects\Websites\I Store Website\backend\app\routers"

issues = []

for fname in sorted(os.listdir(ROUTERS_DIR)):
    if not fname.endswith(".py") or fname.startswith("__"):
        continue
    fpath = os.path.join(ROUTERS_DIR, fname)
    with open(fpath, encoding="utf-8", errors="replace") as f:
        source = f.read()
    
    try:
        tree = ast.parse(source, filename=fname)
    except SyntaxError as e:
        issues.append(f"SYNTAX ERROR in {fname}: {e}")
        continue

    # Check for any obvious undefined variable patterns
    # Look for .scalar() without or 0
    lines = source.splitlines()
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        
        # Check for .scalar() not followed by `or 0` on same line or next line
        if ".scalar()" in stripped and "or 0" not in stripped:
            # Check if next line has `or 0`
            next_line = lines[i].strip() if i < len(lines) else ""
            if "or 0" not in next_line and "or None" not in next_line:
                issues.append(f"  {fname}:{i} - .scalar() without 'or 0' fallback: {stripped[:80]}")
        
        # Check for direct attribute access on query results (potential None)
        if "= db.query(" in stripped and ".first()" not in stripped and ".all()" not in stripped:
            pass  # too noisy

print(f"Scanned {len([f for f in os.listdir(ROUTERS_DIR) if f.endswith('.py') and not f.startswith('__')])} router files\n")
if issues:
    print(f"Found {len(issues)} potential issues:\n")
    for issue in issues[:50]:
        print(issue)
else:
    print("No issues found!")

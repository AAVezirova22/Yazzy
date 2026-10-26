import os
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
subprocess.run(
    [sys.executable, "-m", "alembic", "upgrade", "head"],
    cwd=root / "backend",
    check=True,
)
if (
    os.getenv("YAZZY_DEMO_ENABLED", "false") == "true"
    and os.getenv("YAZZY_ENV") != "production"
):
    subprocess.run([sys.executable, "-m", "yazzy.bootstrap", "--demo"], check=True)

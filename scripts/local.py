"""Cross-platform local development runner. Requires npm ci and backend uv sync first."""

import argparse
import os
import signal
import subprocess
import time
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database",
        type=Path,
        default=root / "backend/yazzy.db",
        help="Optional isolated SQLite database path",
    )
    args = parser.parse_args()
    # This launcher owns a loopback-only stack. Do not inherit a Compose origin
    # such as localhost:8080 while Vite listens on port 5173.
    env = {
        **os.environ,
        "YAZZY_ENV": "development",
        "YAZZY_DEMO_ENABLED": "true",
        "WEB_ORIGIN": "http://127.0.0.1:5173",
        "DATABASE_URL": "sqlite:///" + args.database.expanduser().resolve().as_posix(),
        "PYTHONPATH": str(root) + os.pathsep + str(root / "backend/src"),
    }
    python = str(
        root
        / "backend/.venv"
        / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    )
    subprocess.run(
        [python, "-m", "alembic", "upgrade", "head"],
        cwd=root / "backend",
        env=env,
        check=True,
    )
    subprocess.run(
        [python, "-m", "yazzy.bootstrap", "--demo"], cwd=root, env=env, check=True
    )
    commands = [
        [
            python,
            "-m",
            "uvicorn",
            "yazzy.api.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8000",
        ],
        [python, "-m", "yazzy.workers.runner", "--local"],
        ["npm.cmd" if os.name == "nt" else "npm", "run", "dev"],
    ]
    children = []
    try:
        for command in commands:
            children.append(
                subprocess.Popen(
                    command, cwd=root, env=env, start_new_session=os.name != "nt"
                )
            )
        print(
            "Open http://127.0.0.1:5173 (http://localhost:5173 also works). Ctrl+C stops all local services.",
            flush=True,
        )
        while all(child.poll() is None for child in children):
            time.sleep(0.25)
        raise SystemExit(
            "A local service stopped. Check its output above; ports 8000 and 5173 must be available."
        )
    except KeyboardInterrupt:
        pass
    finally:
        for child in children:
            if child.poll() is not None:
                continue
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/PID", str(child.pid), "/T", "/F"],
                    check=False,
                    capture_output=True,
                )
            else:
                os.killpg(child.pid, signal.SIGTERM)
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == "__main__":
    main()

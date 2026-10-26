"""Exercise the documented launcher in a browser on both supported loopback hosts.

Only the database path changes; origin/configuration comes from scripts/local.py.
Stop existing development servers on ports 8000/5173 before running this test.
"""

import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx

root = Path(__file__).resolve().parents[1]
artifacts = root / "artifacts"
artifacts.mkdir(exist_ok=True)
for port in [8000, 5173]:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError as error:
            raise SystemExit(
                f"Port {port} is busy. Stop local development servers before testing."
            ) from error

with (
    tempfile.TemporaryDirectory(prefix="yazzy-local-test-") as temporary,
    (artifacts / "local-launcher.log").open("w") as log,
):
    # A stale exported Compose origin must not break the documented local runner.
    env = {
        **os.environ,
        "WEB_ORIGIN": "http://localhost:8080",
        "NO_PROXY": "localhost,127.0.0.1",
        "no_proxy": "localhost,127.0.0.1",
    }
    launcher = subprocess.Popen(
        [
            sys.executable,
            "scripts/local.py",
            "--database",
            str(Path(temporary) / "test.db"),
        ],
        cwd=root,
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=os.name != "nt",
    )
    try:
        with httpx.Client(trust_env=False, timeout=5) as client:
            for port, path in [(8000, "/health"), (5173, "/")]:
                for _ in range(160):
                    if launcher.poll() is not None:
                        raise RuntimeError(
                            "Launcher exited; see artifacts/local-launcher.log"
                        )
                    try:
                        client.get(f"http://127.0.0.1:{port}{path}").raise_for_status()
                        break
                    except httpx.HTTPError:
                        time.sleep(0.25)
                else:
                    raise RuntimeError(f"Port {port} did not become ready")
        npx = "npx.cmd" if os.name == "nt" else "npx"
        for host in ["localhost", "127.0.0.1"]:
            subprocess.run(
                [
                    npx,
                    "playwright",
                    "test",
                    "tests/e2e/local-login.spec.ts",
                    "--grep",
                    f"on {host}$",
                ],
                cwd=root,
                env=env,
                check=True,
            )
            shutil.copyfile(
                artifacts / "playwright-results.json",
                artifacts / f"local-login-{host}.json",
            )
        print(
            "Documented local launcher: browser login and scenario processing pass on localhost and 127.0.0.1."
        )
    finally:
        if launcher.poll() is None:
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/PID", str(launcher.pid), "/T", "/F"],
                    check=False,
                    capture_output=True,
                )
            else:
                launcher.send_signal(signal.SIGINT)
            try:
                launcher.wait(timeout=15)
            except subprocess.TimeoutExpired:
                launcher.kill()
                launcher.wait()

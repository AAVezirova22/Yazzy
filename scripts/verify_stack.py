"""Disposable actual-HTTP integration and browser test, never touches the user's dev database.
Run using the backend virtualenv Python after npm ci and playwright install chromium.
"""

import asyncio
import json
import os
import platform
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from simulator.scenarios import packet

ARTIFACTS = ROOT / "artifacts"
ARTIFACTS.mkdir(exist_ok=True)
children, logs = [], []
npm = "npm.cmd" if os.name == "nt" else "npm"
npx = "npx.cmd" if os.name == "nt" else "npx"


def run(args, cwd=ROOT):
    return subprocess.run(args, cwd=cwd, env=env, check=True)


def start(args, log):
    stream = (ARTIFACTS / log).open("w")
    logs.append(stream)
    child = subprocess.Popen(
        args,
        cwd=ROOT,
        env=env,
        stdout=stream,
        stderr=subprocess.STDOUT,
        start_new_session=os.name != "nt",
    )
    children.append(child)


def percentile(values, fraction):
    return sorted(values)[min(len(values) - 1, int((len(values) - 1) * fraction))]


async def measure(run_data):
    elapsed, failed = [], []
    semaphore = asyncio.Semaphore(20)
    async with httpx.AsyncClient(
        base_url="http://127.0.0.1:8000", trust_env=False, timeout=60
    ) as client:

        async def upload(index, device, chunk):
            data = packet(
                device["deviceId"],
                device["assignmentId"],
                run_data["id"],
                42,
                run_data["startAt"],
                index,
                start_step=chunk * 6,
                steps=6,
            )
            async with semaphore:
                start_at = time.perf_counter()
                response = await client.post(
                    "/api/v1/telemetry/batches",
                    json=data,
                    headers={"Authorization": "Device " + device["deviceToken"]},
                )
                elapsed.append((time.perf_counter() - start_at) * 1000)
                if response.status_code != 202:
                    failed.append(response.status_code)

        before = time.perf_counter()
        await asyncio.gather(
            *(
                upload(i, d, c)
                for i, d in enumerate(run_data["enrolments"])
                for c in range(5)
            )
        )
        seconds = time.perf_counter() - before
    assert not failed, failed
    return {
        "storage": "SQLite WAL",
        "devices": 20,
        "batches": 100,
        "samplesPerBatch": 48,
        "concurrency": 20,
        "errors": len(failed),
        "batchesPerSecond": 100 / seconds,
        "latencyMs": {
            "p50": percentile(elapsed, 0.5),
            "p95": percentile(elapsed, 0.95),
            "p99": percentile(elapsed, 0.99),
        },
        "platform": platform.platform(),
        "reportedCpuCount": os.cpu_count(),
        "productionCapacityClaim": False,
    }


with tempfile.TemporaryDirectory(prefix="yazzy-stack-") as temporary:
    env = {
        **os.environ,
        "YAZZY_DEMO_ENABLED": "true",
        "YAZZY_ENV": "development",
        "DATABASE_URL": "sqlite:///" + str(Path(temporary) / "test.db"),
        "PYTHONPATH": str(ROOT / "backend/src") + os.pathsep + str(ROOT),
        "WEB_ORIGIN": "http://127.0.0.1:5173",
        "NO_PROXY": "127.0.0.1,localhost",
        "no_proxy": "127.0.0.1,localhost",
    }
    try:
        run([sys.executable, "-m", "alembic", "upgrade", "head"], ROOT / "backend")
        run([sys.executable, "-m", "alembic", "check"], ROOT / "backend")
        run([sys.executable, "-m", "yazzy.bootstrap", "--demo"])
        start(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "yazzy.api.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                "8000",
            ],
            "stack-api.log",
        )
        start(
            [sys.executable, "-m", "yazzy.workers.runner", "--local"],
            "stack-worker.log",
        )
        start([npm, "run", "dev"], "stack-web.log")
        with httpx.Client(trust_env=False, timeout=10) as client:
            for port, path in [(8000, "/health"), (5173, "/")]:
                for _ in range(160):
                    try:
                        client.get(f"http://127.0.0.1:{port}{path}").raise_for_status()
                        break
                    except httpx.HTTPError:
                        if any(p.poll() is not None for p in children):
                            raise RuntimeError(
                                "Service exited; see artifacts/stack-*.log"
                            )
                        time.sleep(0.25)
                else:
                    raise RuntimeError(f"Service {port} did not start")
        with httpx.Client(
            base_url="http://127.0.0.1:8000", trust_env=False, timeout=60
        ) as client:
            auth = client.post("/api/v1/auth/demo?mode=fleet")
            auth.raise_for_status()
            client.headers["X-CSRF-Token"] = auth.json()["csrfToken"]
            # A separate HTTP request sees the committed login immediately.
            client.get("/api/v1/auth/me").raise_for_status()
            r = client.post("/api/v1/simulation/runs", json={"vehicles": 20})
            r.raise_for_status()
            benchmark = r.json()
            client.post(
                f"/api/v1/simulation/runs/{benchmark['id']}/clock?tick=300"
            ).raise_for_status()
            measurements = asyncio.run(measure(benchmark))
            summaries = []
            for _ in range(10):
                t = time.perf_counter()
                client.get(
                    "/api/v1/organisations/demo-mobility/fleet"
                ).raise_for_status()
                summaries.append((time.perf_counter() - t) * 1000)
            measurements["summaryP95Ms"] = percentile(summaries, 0.95)
            (ARTIFACTS / "load-result.json").write_text(
                json.dumps(measurements, indent=2) + "\n"
            )
            print("Bounded load measurement:", json.dumps(measurements), flush=True)
        run(
            [
                sys.executable,
                "-m",
                "simulator.runner",
                "--scenario",
                "DRIFT_HISTORY",
                "--vehicles",
                "12",
                "--reset",
                "--queue",
                str(Path(temporary) / "queue.db"),
            ]
        )
        with httpx.Client(
            base_url="http://127.0.0.1:8000", trust_env=False, timeout=60
        ) as client:
            auth = client.post("/api/v1/auth/demo?mode=fleet")
            auth.raise_for_status()
            for _ in range(240):
                result = client.get("/api/v1/organisations/demo-mobility/fleet").json()
                if (
                    len(result.get("vehicles", [])) == 12
                    and sum(v["findingCount"] for v in result["vehicles"]) == 3
                ):
                    break
                time.sleep(0.5)
            else:
                raise RuntimeError(
                    "Expected three synthetic drift findings were not produced"
                )
            print(
                "Actual HTTP fleet: 12 vehicles, 168 batches, three expected drift findings.",
                flush=True,
            )
        # Separate processes also support constrained serverless Chromium distributions.
        for name in ["fleet evidence", "personal garage", "mobile viewport"]:
            run([npx, "playwright", "test", "--grep", name])
            shutil.copyfile(
                ARTIFACTS / "playwright-results.json",
                ARTIFACTS / ("playwright-" + name.replace(" ", "-") + ".json"),
            )
        print("Full HTTP and browser checks passed.", flush=True)
    finally:
        for child in children:
            if child.poll() is None:
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
        for stream in logs:
            stream.close()

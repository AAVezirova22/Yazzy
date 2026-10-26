import argparse
import time

import httpx

from simulator.queue import Queue
from simulator.scenarios import SCENARIOS, packet


def main():
    p = argparse.ArgumentParser(
        description="Virtual devices submit authenticated telemetry over HTTP; no database access"
    )
    p.add_argument("--url", default="http://localhost:8000")
    p.add_argument("--scenario", choices=SCENARIOS, default="DRIFT_HISTORY")
    p.add_argument("--vehicles", type=int, default=12)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--queue", default="simulator-queue.db")
    p.add_argument("--offline", action="store_true")
    p.add_argument("--flush-only", action="store_true")
    p.add_argument("--reset", action="store_true")
    p.add_argument("--live", action="store_true")
    args = p.parse_args()
    queue = Queue(args.queue)
    with httpx.Client(base_url=args.url, timeout=60, trust_env=False) as client:
        if args.flush_only:
            print({"flushed": queue.flush(client)})
            return
        auth = client.post("/api/v1/auth/demo?mode=fleet")
        auth.raise_for_status()
        client.headers["X-CSRF-Token"] = auth.json()["csrfToken"]
        if args.reset:
            runs_response = client.get("/api/v1/simulation/runs")
            runs_response.raise_for_status()
            for run in runs_response.json():
                if run["status"] != "RESET":
                    client.post(
                        f"/api/v1/simulation/runs/{run['id']}/control",
                        json={"action": "RESET"},
                    ).raise_for_status()
        result = client.post(
            "/api/v1/simulation/runs",
            json={
                "scenario": args.scenario,
                "vehicles": args.vehicles,
                "seed": args.seed,
            },
        )
        result.raise_for_status()
        run = result.json()
        if args.live:
            tick = 0
            while True:
                state = next(
                    (
                        r
                        for r in client.get("/api/v1/simulation/runs").json()
                        if r["id"] == run["id"]
                    ),
                    None,
                )
                if not state or state["status"] == "RESET":
                    return
                if state["status"] == "PAUSED":
                    time.sleep(1)
                    continue
                client.post(
                    f"/api/v1/simulation/runs/{run['id']}/clock?tick={tick * 60 + 50}"
                ).raise_for_status()
                for index, d in enumerate(run["enrolments"]):
                    batch = packet(
                        d["deviceId"],
                        d["assignmentId"],
                        run["id"],
                        args.seed,
                        run["startAt"],
                        index,
                        0,
                        args.scenario,
                        tick * 6,
                        6,
                    )
                    queue.put(batch, d["deviceToken"])
                try:
                    queue.flush(client)
                except httpx.HTTPError:
                    print(
                        "Network interrupted; virtual-device queue retained", flush=True
                    )
                tick += 1
                time.sleep(max(0.1, 60 / state["speed"]))
        days = (
            17
            if args.scenario == "RECOVERY"
            else 14
            if args.scenario == "DRIFT_HISTORY"
            else 1
        )
        client.post(
            f"/api/v1/simulation/runs/{run['id']}/clock?tick={(days - 1) * 86400 + 600}"
        ).raise_for_status()
        batches = []
        for day in range(days):
            for index, d in enumerate(run["enrolments"]):
                batch = packet(
                    d["deviceId"],
                    d["assignmentId"],
                    run["id"],
                    args.seed,
                    run["startAt"],
                    index,
                    day,
                    args.scenario,
                )
                batches.append((batch, d["deviceToken"]))
        if args.scenario == "OUT_OF_ORDER":
            batches.reverse()
        for batch, token in batches:
            queue.put(batch, token)
        if not args.offline:
            print(
                {
                    "flushed": queue.flush(client),
                    "runId": run["id"],
                    "origin": "SIMULATED",
                }
            )
        else:
            print({"buffered": len(batches), "recovery": "Run again with --flush-only"})


if __name__ == "__main__":
    main()

import asyncio
import json
import sqlite3
from pathlib import Path

import httpx
import pytest
from simulator.queue import Queue
from simulator.scenarios import packet
from sqlalchemy import func, select

from yazzy.infrastructure.db import transaction
from yazzy.infrastructure.http_limits import RequestLimits
from yazzy.infrastructure.models import Job, Sample, Trip
from yazzy.modules.trips.domain import Observation, segment
from yazzy.retention import purge
from yazzy.workers.runner import drain, run_job


def test_offline_queue_survives_restart_and_lost_ack(tmp_path):
    path = tmp_path / "queue.db"
    q = Queue(path, max_batches=1)
    batch = {"batchId": "one", "samples": [{"value": 10}]}
    q.put(batch, "test-virtual-token")
    q.put(batch, "test-virtual-token")
    with pytest.raises(BufferError):
        q.put({"batchId": "two"}, "token")
    with pytest.raises(ValueError):
        q.put({**batch, "samples": []}, "token")
    q.db.close()
    q = Queue(path)
    attempts = []

    def responder(request):
        attempts.append(json.loads(request.content))
        if len(attempts) == 1:
            raise httpx.ReadTimeout("ack lost")
        return httpx.Response(202, json={"accepted": True, "duplicate": True})

    with httpx.Client(transport=httpx.MockTransport(responder)) as client:
        # Queue accepts a client with the actual API base URL.
        client.base_url = "http://testserver"
        with pytest.raises(httpx.ReadTimeout):
            q.flush(client)
        assert q.db.execute("SELECT count(*) FROM queue").fetchone()[0] == 1
        assert q.flush(client) == 1
    assert attempts[0] == attempts[1]
    assert q.db.execute("SELECT count(*) FROM queue").fetchone()[0] == 0


def test_twenty_device_reverse_replay_and_reset_fences_jobs(fleet_client):
    run = fleet_client.post(
        "/api/v1/simulation/runs", json={"vehicles": 20, "scenario": "CITY"}
    ).json()
    assert (
        fleet_client.post(f"/api/v1/simulation/runs/{run['id']}/clock?tick=600").status_code == 200
    )
    batches = []
    for index, device in enumerate(run["enrolments"]):
        data = packet(
            device["deviceId"], device["assignmentId"], run["id"], 42, run["startAt"], index
        )
        batches.append((device, data))
    jobs = []
    for device, data in reversed(batches):
        result = fleet_client.post(
            "/api/v1/telemetry/batches",
            json=data,
            headers={"Authorization": "Device " + device["deviceToken"]},
        )
        assert result.status_code == 202, result.text
        jobs.append(result.json()["jobId"])
    drain()
    with transaction() as db:
        before = {t.id: t.metrics for t in db.scalars(select(Trip))}
        sample_count = db.scalar(select(func.count()).select_from(Sample))
    for device, data in batches:
        result = fleet_client.post(
            "/api/v1/telemetry/batches",
            json=data,
            headers={"Authorization": "Device " + device["deviceToken"]},
        )
        assert result.json()["duplicate"] is True
    drain()
    with transaction() as db:
        assert before == {t.id: t.metrics for t in db.scalars(select(Trip))}
        assert sample_count == db.scalar(select(func.count()).select_from(Sample))
    # A delivery left in the broker cannot recreate deleted simulation results.
    result = fleet_client.post(
        f"/api/v1/simulation/runs/{run['id']}/control", json={"action": "RESET"}
    )
    assert result.status_code == 200
    assert run_job(jobs[0], "demo-mobility") is False
    with transaction() as db:
        assert db.scalar(select(func.count()).select_from(Trip)) == 0
        assert db.scalar(select(func.count()).select_from(Sample)) == 0


def test_retention_preserves_summaries_and_waits_for_work(fleet_client):
    run = fleet_client.post("/api/v1/simulation/runs", json={"vehicles": 10}).json()
    job = fleet_client.post(f"/api/v1/simulation/runs/{run['id']}/tick?history=true").json()[
        "jobId"
    ]
    with transaction() as db:
        assert (
            purge(db, "demo-mobility", now=run["startAt"] + 100 * 86400)["skipped"]
            == "JOBS_PENDING"
        )
    drain()
    with transaction() as db:
        assert db.get(Job, job).status == "COMPLETED"
        trip_count = db.scalar(select(func.count()).select_from(Trip))
        assert trip_count > 0
        assert purge(db, "demo-mobility", now=run["startAt"] + 100 * 86400)["deletedSamples"] > 0
        assert db.scalar(select(func.count()).select_from(Trip)) == trip_count
        assert all(t.metrics["route"] == [] for t in db.scalars(select(Trip)))


def test_chunked_body_limit_rejects_before_application():
    invoked, sent = [], []

    async def application(scope, receive, send):
        invoked.append(True)

    messages = iter(
        [
            {"type": "http.request", "body": b"a" * 6, "more_body": True},
            {"type": "http.request", "body": b"b" * 6, "more_body": False},
        ]
    )

    async def receive():
        return next(messages)

    async def send(message):
        sent.append(message)

    asyncio.run(
        RequestLimits(application, max_bytes=10)(
            {"type": "http", "path": "/api/v1/telemetry/batches", "client": ("127.0.0.1", 123)},
            receive,
            send,
        )
    )
    assert not invoked
    assert sent[0]["status"] == 413


def test_backup_restore_contains_committed_queue(tmp_path):
    q = Queue(tmp_path / "source.db")
    q.put({"batchId": "persisted"}, "virtual-test-token")
    restored = sqlite3.connect(tmp_path / "restored.db")
    q.db.backup(restored)
    q.db.close()
    assert json.loads(restored.execute("SELECT payload FROM queue").fetchone()[0]) == {
        "batchId": "persisted"
    }
    assert restored.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    restored.close()


def test_shared_trip_fixtures():
    path = Path(__file__).resolve().parents[2] / "contracts/fixtures/trip-state-v1.json"
    for case in json.loads(path.read_text())["cases"]:
        rows = [
            Observation(t, signal, value)
            for t, speed, ignition in case["observations"]
            for signal, value in [("VEHICLE_SPEED", speed), ("IGNITION", ignition)]
        ]
        result = segment(rows, case["observations"][-1][0])
        assert (result[-1]["status"] if result else "IDLE") == case["expected"], case["name"]

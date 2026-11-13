import dataclasses
import time

import pytest
from fastapi.testclient import TestClient

from yazzy.api import main
from yazzy.config import Settings, _database_url
from yazzy.infrastructure.db import transaction
from yazzy.infrastructure.models import Job, Organisation
from yazzy.workers import runner


def hosted(monkeypatch, password="correct horse battery"):
    monkeypatch.setattr(
        main,
        "settings",
        dataclasses.replace(main.settings, environment="staging", access_password=password),
    )


def test_database_url_is_normalised_for_psycopg():
    assert _database_url("postgres://u:p@h/db").startswith("postgresql+psycopg://u:p@h/db")
    assert _database_url("postgresql://u:p@h/db?sslmode=require") == (
        "postgresql+psycopg://u:p@h/db?sslmode=require"
    )
    assert _database_url("postgresql+psycopg://u:p@h/db") == "postgresql+psycopg://u:p@h/db"
    assert _database_url("sqlite:///./x.db") == "sqlite:///./x.db"


def test_hosted_demo_login_requires_a_strong_password():
    with pytest.raises(ValueError, match="YAZZY_ACCESS_PASSWORD"):
        Settings(environment="staging", demo_enabled=True, access_password="short").validate()
    Settings(environment="staging", demo_enabled=True, access_password="x" * 12).validate()
    Settings(environment="development", demo_enabled=True).validate()  # local stays frictionless


def test_demo_login_rejects_missing_or_wrong_password(monkeypatch):
    hosted(monkeypatch)
    monkeypatch.setattr(time, "sleep", lambda _s: None)
    with TestClient(main.app) as c:
        assert c.get("/api/v1/auth/config").json()["passwordRequired"] is True
        for headers in ({}, {"X-Access-Password": "wrong"}):
            r = c.post("/api/v1/auth/demo?mode=personal", headers=headers)
            assert r.status_code == 401
            assert r.json()["detail"]["code"] == "ACCESS_PASSWORD_REQUIRED"
            assert "yazzy_session" not in r.cookies


def test_demo_login_accepts_password_and_sets_secure_cookie(monkeypatch):
    hosted(monkeypatch)
    with TestClient(main.app) as c:
        r = c.post(
            "/api/v1/auth/demo?mode=personal",
            headers={"X-Access-Password": "correct horse battery"},
        )
        assert r.status_code == 200
        assert "secure" in r.headers["set-cookie"].lower()


def test_ping_does_not_need_the_database():
    with TestClient(main.app) as c:
        assert c.get("/ping").json() == {"status": "ok"}


def test_embedded_worker_runs_jobs_queued_by_a_request():
    # Queue a job that no longer applies; the embedded worker must pick it up and settle it.
    with transaction() as db:
        tenant = db.get(Organisation, "personal-sandbox").id
    with transaction(tenant) as db:
        db.add(
            Job(
                tenant_id=tenant,
                kind="SIMULATE",
                key="test-embedded-worker",
                status="PENDING",
                payload={"runId": "missing", "runGeneration": 0},
            )
        )
    stop = runner.start_embedded(idle_seconds=5)
    try:
        deadline = time.time() + 10
        while time.time() < deadline:
            with transaction(tenant) as db:
                statuses = {j.status for j in db.query(Job).filter(Job.tenant_id == tenant)}
            if statuses and statuses <= {"COMPLETED", "FAILED", "CANCELLED"}:
                break
            time.sleep(0.2)
        assert statuses <= {"COMPLETED", "FAILED", "CANCELLED"}, statuses
    finally:
        stop()

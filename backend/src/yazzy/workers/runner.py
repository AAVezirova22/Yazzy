"""Durable SQL job ledger doubles as a transactional outbox.

Redis is a delivery hint. --local polls the same ledger without a broker.
"""

import argparse
import logging
import threading
import time

from celery import Celery
from sqlalchemy import func, or_, select, update

from yazzy.config import settings
from yazzy.infrastructure.db import transaction
from yazzy.infrastructure.models import Job, Organisation, SimulationRun, Vehicle
from yazzy.modules.trips.service import reconcile

logger = logging.getLogger("yazzy.worker")
celery = Celery("yazzy", broker=settings.redis_url)
celery.conf.update(
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_soft_time_limit=100,
    task_time_limit=120,
    task_serializer="json",
    accept_content=["json"],
    broker_connection_retry_on_startup=True,
)


def run_job(job_id, tenant_id):
    now = time.time()
    with transaction(tenant_id) as db:
        job = db.scalar(
            select(Job).where(Job.id == job_id, Job.tenant_id == tenant_id).with_for_update()
        )
        if (
            not job
            or job.status in {"COMPLETED", "FAILED", "CANCELLED"}
            or (job.status == "RUNNING" and job.lease_until > now)
        ):
            return False
        if job.attempts >= 5:
            job.status = "FAILED"
            return False
        job.generation += 1
        job.attempts += 1
        job.status, job.lease_until = "RUNNING", now + 120
        generation, payload, kind, attempts = job.generation, job.payload, job.kind, job.attempts
    try:
        with transaction(tenant_id) as db:
            # Reset, ingestion and workers share run -> vehicle lock ordering.
            run = (
                db.scalar(
                    select(SimulationRun)
                    .where(SimulationRun.id == payload["runId"])
                    .with_for_update()
                )
                if payload.get("runId")
                else None
            )
            # Lock lease for publication; expired/stale generations cannot write results.
            job = db.scalar(
                select(Job).where(Job.id == job_id, Job.tenant_id == tenant_id).with_for_update()
            )
            if (
                job.generation != generation
                or job.status != "RUNNING"
                or job.lease_until < time.time()
            ):
                return False
            if payload.get("runId") and (
                not run or run.status == "RESET" or run.generation != payload["runGeneration"]
            ):
                job.status = "CANCELLED"
                return False
            if kind == "RECONCILE":
                # Lock the vehicle first: uploads take the same lock, so the jobs queued now are
                # all there will be until this commits, and their readings are all visible.
                db.scalar(
                    select(Vehicle)
                    .where(Vehicle.id == payload["vehicleId"], Vehicle.tenant_id == tenant_id)
                    .with_for_update()
                )
                queued = list(
                    db.scalars(
                        select(Job).where(
                            Job.tenant_id == tenant_id,
                            Job.kind == "RECONCILE",
                            Job.status == "PENDING",
                            Job.id != job_id,
                            Job.payload["vehicleId"].as_string() == payload["vehicleId"],
                        )
                    )
                )
                payloads = [payload, *[q.payload for q in queued]]
                # Jobs queued before ranges existed rebuild the last three days instead.
                ranges = (
                    None
                    if any("ranges" not in p for p in payloads)
                    else [r for p in payloads for r in p["ranges"]]
                )
                result = reconcile(
                    db, tenant_id, payload["vehicleId"], payload.get("runId"), ranges=ranges
                )
                for q in queued:
                    q.status, q.result = "COMPLETED", {"coalescedInto": job_id}
                if result.get("remaining"):
                    db.add(
                        Job(
                            tenant_id=tenant_id,
                            kind="RECONCILE",
                            key=f"continue:{job_id}:{generation}",
                            payload={**payload, "ranges": result["remaining"]},
                        )
                    )
            elif kind == "SIMULATE":
                from yazzy.modules.fleet.simulation import advance

                result = advance(db, run, history=payload.get("history", False))
            elif kind == "EXPORT":
                from yazzy.modules.fleet.service import build_export

                result = build_export(db, tenant_id, payload)
            else:
                raise ValueError("UNSUPPORTED_JOB_KIND")
            if job.lease_until < time.time():
                raise TimeoutError("JOB_LEASE_EXPIRED")
            job.result, job.status, job.error = result, "COMPLETED", None
        return True
    except Exception as exc:
        with transaction(tenant_id) as db:
            db.execute(
                update(Job)
                .where(Job.id == job_id, Job.generation == generation)
                .values(
                    status="FAILED"
                    if attempts >= 5 or isinstance(exc, PermissionError)
                    else "PENDING",
                    lease_until=0,
                    error=type(exc).__name__,
                    published_at=0,
                )
            )
        logger.exception("job_failed", extra={"job_id": job_id})
        return False


@celery.task(name="yazzy.process")
def process(job_id, tenant_id):
    return run_job(job_id, tenant_id)


def due_jobs(db):
    return list(
        db.scalars(
            select(Job)
            .where(
                Job.tenant_id == db.info.get("tenant_id"),
                or_(
                    # A pending job's lease_until is the earliest it may run (0: at once).
                    (Job.status == "PENDING") & (Job.lease_until <= time.time()),
                    (Job.status == "RUNNING") & (Job.lease_until < time.time()),
                ),
            )
            .order_by(Job.created_at)
            .limit(100)
        )
    )


def tenants(tenant_id=None):
    if tenant_id:
        return [tenant_id]
    with transaction() as db:
        return list(db.scalars(select(Organisation.id)))


def enumerate_due(tenant_id=None):
    result: list[tuple[str, str, float, str]] = []
    for tenant in tenants(tenant_id):
        with transaction(tenant) as db:
            result.extend((j.id, j.tenant_id, j.published_at, j.kind) for j in due_jobs(db))
    return result


def next_deferred(tenant_id=None):
    """When the earliest waiting job falls due, or None when no job waits."""
    times = []
    for tenant in tenants(tenant_id):
        with transaction(tenant) as db:
            times.append(
                db.scalar(
                    select(func.min(Job.lease_until)).where(
                        Job.tenant_id == tenant,
                        Job.status == "PENDING",
                        Job.lease_until > time.time(),
                    )
                )
            )
    return min((t for t in times if t), default=None)


def drain(tenant_id=None, limit=1000):
    count = 0
    while count < limit:
        jobs = [(j, t) for j, t, _, _ in enumerate_due(tenant_id)]
        if not jobs:
            break
        for job_id, tenant in jobs:
            run_job(job_id, tenant)
            count += 1
    return count


_wake = threading.Event()


def wake_embedded():
    """Tell the embedded worker that a write request may have queued a job."""
    _wake.set()


def start_embedded(idle_seconds: float = 600, reconcile_pause: float = 15):
    """Run the --local polling loop on a thread inside the API process.

    Free hosts have no separate worker, and constant polling would keep a serverless
    database awake, so the thread sleeps until a write request wakes it (or idle_seconds
    pass, which also recovers jobs whose lease expired). Returns a stop function.

    A recording phone uploads every few seconds and each batch queues a trip rebuild that
    re-reads the vehicle's samples. While the car drives those jobs wait (see
    settings.rebuild_delay_seconds) and the thread sleeps until the first falls due. After a
    pass that only rebuilt trips the thread pauses for reconcile_pause, so the uploads
    arriving meanwhile share one rebuild and the API keeps answering on a 0.1-CPU host.
    """
    stop = threading.Event()

    def loop():
        while not stop.is_set():
            kinds, wait = set(), idle_seconds
            try:
                for job_id, tenant, _, kind in enumerate_due():
                    kinds.add(kind)
                    run_job(job_id, tenant)
                if not kinds:
                    later = next_deferred()
                    if later:
                        wait = min(wait, max(1.0, later - time.time()))
            except Exception:
                logger.exception("embedded_worker_pass_failed")
                stop.wait(5)
                continue
            if kinds:
                # Retries and chained jobs may be due immediately; trip rebuilds can wait.
                stop.wait(reconcile_pause if kinds == {"RECONCILE"} else 1)
                continue
            _wake.wait(timeout=wait)
            _wake.clear()
            stop.wait(0.3)  # let the request that woke us commit

    thread = threading.Thread(target=loop, name="yazzy-embedded-worker", daemon=True)
    thread.start()

    def shutdown():
        stop.set()
        _wake.set()
        thread.join(timeout=5)

    return shutdown


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--local", action="store_true")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    while True:
        jobs = enumerate_due()
        for job_id, tenant, published, _ in jobs:
            if args.local:
                run_job(job_id, tenant)
            elif time.time() - published > 30:
                try:
                    process.apply_async(args=[job_id, tenant])
                    with transaction(tenant) as db:
                        db.execute(
                            update(Job).where(Job.id == job_id).values(published_at=time.time())
                        )
                except Exception:
                    logger.warning("broker_unavailable; SQL work retained")
        if args.once:
            return
        time.sleep(1)


if __name__ == "__main__":
    main()

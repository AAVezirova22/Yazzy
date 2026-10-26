"""Durable SQL job ledger doubles as a transactional outbox.

Redis is a delivery hint. --local polls the same ledger without a broker.
"""

import argparse
import logging
import time

from celery import Celery
from sqlalchemy import or_, select, update

from yazzy.config import settings
from yazzy.infrastructure.db import transaction
from yazzy.infrastructure.models import Job, Organisation, SimulationRun
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
                result = reconcile(db, tenant_id, payload["vehicleId"], payload.get("runId"))
                # Inputs accepted before the locked reconciliation are represented by this result.
                db.execute(
                    update(Job)
                    .where(
                        Job.tenant_id == tenant_id,
                        Job.kind == "RECONCILE",
                        Job.status == "PENDING",
                        Job.payload["vehicleId"].as_string() == payload["vehicleId"],
                    )
                    .values(status="COMPLETED", result={"coalescedInto": job_id})
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
                    Job.status == "PENDING",
                    (Job.status == "RUNNING") & (Job.lease_until < time.time()),
                ),
            )
            .order_by(Job.created_at)
            .limit(100)
        )
    )


def enumerate_due(tenant_id=None):
    if tenant_id:
        tenants = [tenant_id]
    else:
        with transaction() as db:
            tenants = list(db.scalars(select(Organisation.id)))
    result: list[tuple[str, str, float]] = []
    for tenant in tenants:
        with transaction(tenant) as db:
            result.extend((j.id, j.tenant_id, j.published_at) for j in due_jobs(db))
    return result


def drain(tenant_id=None, limit=1000):
    count = 0
    while count < limit:
        jobs = [(j, t) for j, t, _ in enumerate_due(tenant_id)]
        if not jobs:
            break
        for job_id, tenant in jobs:
            run_job(job_id, tenant)
            count += 1
    return count


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--local", action="store_true")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    while True:
        jobs = enumerate_due()
        for job_id, tenant, published in jobs:
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

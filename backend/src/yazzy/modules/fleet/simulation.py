import secrets

from fastapi import Depends
from sqlalchemy import delete, select

from yazzy.api.schemas import SimulationControl, SimulationInput
from yazzy.infrastructure.db import get_db
from yazzy.infrastructure.models import (
    Assignment,
    Baseline,
    Batch,
    Device,
    Finding,
    Job,
    Sample,
    SimulationRun,
    Trip,
    Vehicle,
    WorkOrder,
)
from yazzy.modules.fleet.service import serialize
from yazzy.modules.identity.policy import audit, authenticate, digest, fail, require_role, scoped
from yazzy.modules.telemetry.contracts import TelemetryBatch
from yazzy.modules.telemetry.service import ingest


def require_demo(db, ctx):
    from yazzy.infrastructure.models import Organisation

    require_role(ctx, {"FLEET_OWNER"})
    if not db.get(Organisation, ctx.tenant_id).is_demo:
        fail("SIMULATION_REAL_TENANT_DENIED", 403)


def advance(db, run, history=False):
    from simulator.scenarios import packet

    if run.status != "RUNNING":
        return {"paused": True}
    devices = list(
        db.scalars(
            select(Device)
            .where(Device.tenant_id == run.tenant_id, Device.run_id == run.id)
            .order_by(Device.name)
        )
    )
    if history and run.tick > 0:
        return {"duplicate": True}
    days = 17 if run.scenario == "RECOVERY" else 14 if run.scenario == "DRIFT_HISTORY" else 1
    day_steps = [(day, 0, 61) for day in range(days)] if history else [(0, run.tick * 6, 6)]
    run.virtual_now = (
        run.start_at + (days - 1) * 86400 + 600 if history else run.start_at + run.tick * 60 + 50
    )
    count = 0
    for index, device in enumerate(devices):
        assignment = db.scalar(
            select(Assignment).where(
                Assignment.device_id == device.id, Assignment.valid_until.is_(None)
            )
        )
        for day, step, length in day_steps:
            payload = packet(
                device.id,
                assignment.id,
                run.id,
                run.seed,
                run.start_at,
                index,
                day,
                run.scenario,
                step,
                length,
            )
            ingest(db, device, TelemetryBatch.model_validate(payload))
            if run.scenario == "DUPLICATES":
                ingest(db, device, TelemetryBatch.model_validate(payload))
            count += 1
    run.tick = (days - 1) * 1440 + 11 if history else run.tick + 1
    if history:
        run.status = "PAUSED"
    db.flush()
    return {"batches": count, "virtualNow": run.virtual_now}


def install_routes(app):
    @app.get("/api/v1/simulation/runs")
    def list_runs(ctx=Depends(authenticate), db=Depends(get_db, scope="function")):
        require_demo(db, ctx)
        return [
            serialize(r)
            for r in db.scalars(
                select(SimulationRun)
                .where(SimulationRun.tenant_id == ctx.tenant_id)
                .order_by(SimulationRun.created_at.desc())
                .limit(30)
            )
        ]

    @app.post("/api/v1/simulation/runs", status_code=201)
    def create_run(
        data: SimulationInput, ctx=Depends(authenticate), db=Depends(get_db, scope="function")
    ):
        require_demo(db, ctx)
        if db.scalar(
            select(SimulationRun).where(
                SimulationRun.tenant_id == ctx.tenant_id, SimulationRun.status != "RESET"
            )
        ):
            fail("RESET_ACTIVE_RUN_FIRST", 409)
        # Fixed scenario epoch makes repeated seeded runs numerically reproducible.
        start = 1790841600.0
        run = SimulationRun(
            tenant_id=ctx.tenant_id,
            scenario=data.scenario,
            seed=data.seed,
            start_at=start,
            virtual_now=start,
            speed=data.speed,
            status="RUNNING",
        )
        db.add(run)
        db.flush()
        enrollments = []
        for i in range(data.vehicles):
            v = Vehicle(
                tenant_id=ctx.tenant_id,
                name=f"YAZ {i + 1:03d}",
                make=["Toyota", "Škoda", "Volkswagen"][i % 3],
                model=["Corolla", "Octavia", "Golf"][i % 3],
                year=2021 + i % 4,
                origin="SIMULATED",
                powertrain="HYBRID" if i % 3 == 0 else "ICE",
                fuel_type="PETROL",
                odometer_km=30000 + i * 7210,
                capabilities={
                    "verificationStatus": "SYNTHETIC",
                    "supportedSignals": [
                        "VEHICLE_SPEED",
                        "ENGINE_RPM",
                        "FUEL_RATE",
                        "COOLANT_TEMP",
                        "SHORT_FUEL_TRIM",
                        "GPS",
                    ],
                    "backgroundRecording": "SIMULATED",
                    "crankingVoltage": "NOT_VERIFIED",
                },
            )
            db.add(v)
            db.flush()
            token = secrets.token_urlsafe(40)
            d = Device(
                tenant_id=ctx.tenant_id,
                name=f"Virtual {i:03d}",
                token_hash=digest(token),
                origin="SIMULATED",
                source="SIMULATED_FLEET",
                run_id=run.id,
            )
            db.add(d)
            db.flush()
            a = Assignment(
                tenant_id=ctx.tenant_id, device_id=d.id, vehicle_id=v.id, valid_from=start
            )
            db.add(a)
            db.flush()
            enrollments.append(
                {"deviceId": d.id, "assignmentId": a.id, "vehicleId": v.id, "deviceToken": token}
            )
        audit(db, ctx, "SIMULATION_CREATED", run.id, {"scenario": data.scenario, "seed": data.seed})
        return {**serialize(run), "enrolments": enrollments}

    @app.post("/api/v1/simulation/runs/{run_id}/control")
    def control(
        run_id: str,
        data: SimulationControl,
        ctx=Depends(authenticate),
        db=Depends(get_db, scope="function"),
    ):
        require_demo(db, ctx)
        run = scoped(db, SimulationRun, ctx, run_id)
        run = db.scalar(
            select(SimulationRun)
            .where(SimulationRun.id == run.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if run.status == "RESET":
            fail("OLD_SIMULATION_RUN", 409)
        if data.action == "RESET":
            run.status, run.generation = "RESET", run.generation + 1
            devices = list(
                db.scalars(
                    select(Device).where(Device.tenant_id == ctx.tenant_id, Device.run_id == run.id)
                )
            )
            device_ids = [d.id for d in devices]
            vehicle_ids = list(
                db.scalars(
                    select(Assignment.vehicle_id).where(
                        Assignment.tenant_id == ctx.tenant_id, Assignment.device_id.in_(device_ids)
                    )
                )
            )
            for cls in [Sample, Trip, Finding, Baseline]:
                db.execute(
                    delete(cls).where(
                        cls.__table__.c.tenant_id == ctx.tenant_id, cls.__table__.c.run_id == run.id
                    )
                )
            db.execute(
                delete(Batch).where(
                    Batch.tenant_id == ctx.tenant_id, Batch.device_id.in_(device_ids)
                )
            )
            for job in db.scalars(select(Job).where(Job.tenant_id == ctx.tenant_id)):
                if job.payload.get("runId") == run.id:
                    job.status = "CANCELLED"
            for d in devices:
                d.revoked = True
            for v in db.scalars(
                select(Vehicle).where(
                    Vehicle.tenant_id == ctx.tenant_id, Vehicle.id.in_(vehicle_ids)
                )
            ):
                v.archived = True
            for w in db.scalars(
                select(WorkOrder).where(
                    WorkOrder.tenant_id == ctx.tenant_id, WorkOrder.vehicle_id.in_(vehicle_ids)
                )
            ):
                w.status = "CANCELLED"
        elif data.action == "PAUSE":
            run.status = "PAUSED"
        elif data.action in {"START", "RESUME"}:
            run.status = "RUNNING"
        elif data.action == "SPEED":
            if data.speed is None:
                fail("SPEED_REQUIRED", 422)
            run.speed = data.speed
        audit(db, ctx, "SIMULATION_" + data.action, run.id)
        return serialize(run)

    @app.post("/api/v1/simulation/runs/{run_id}/tick", status_code=202)
    def tick(
        run_id: str,
        history: bool = False,
        ctx=Depends(authenticate),
        db=Depends(get_db, scope="function"),
    ):
        require_demo(db, ctx)
        run = scoped(db, SimulationRun, ctx, run_id)
        # Required work goes to the durable ledger; API does not run long scenarios.
        job = Job(
            tenant_id=ctx.tenant_id,
            kind="SIMULATE",
            key=f"simulate:{run.id}:{run.tick}",
            payload={"runId": run.id, "runGeneration": run.generation, "history": history},
        )
        existing = db.scalar(select(Job).where(Job.key == job.key))
        if existing:
            return {"jobId": existing.id}
        db.add(job)
        db.flush()
        return {"jobId": job.id}

    @app.post("/api/v1/simulation/runs/{run_id}/clock")
    def clock(
        run_id: str, tick: int, ctx=Depends(authenticate), db=Depends(get_db, scope="function")
    ):
        require_demo(db, ctx)
        run = scoped(db, SimulationRun, ctx, run_id)
        if (
            run.status != "RUNNING"
            or tick < run.virtual_now - run.start_at
            or tick > run.virtual_now - run.start_at + 31 * 86400
        ):
            fail("INVALID_DEMO_CLOCK", 409)
        run.tick = max(run.tick, tick // 60 + 1)
        run.virtual_now = run.start_at + tick
        return {"virtualNow": run.virtual_now}

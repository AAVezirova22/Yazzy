# Delivery evaluation — 26 October 2026

## Verified here

| Check | Result | Scope |
|---|---|---|
| Backend/domain tests | 70 passing | API authorisation, CSRF, local origin regression, revoked/stale access, idempotency, provenance, assignment times, limits, leases, reset fencing, offline queue, retention, trips, fuel, baselines, property tests, prompt/quote policy |
| Actual HTTP fleet | Pass | 168 accepted batches; 12 virtual vehicles; 14 virtual days; exactly three expected drift findings; actual API and separate worker |
| Browser workflows | 5 passing | Fleet evidence/advisor confirmation/quote/work order/chart/trip/export; personal empty garage/add vehicle/fuel; 390 px viewport without horizontal overflow; documented launcher login and scenario processing on localhost and 127.0.0.1 |
| Web build/type checking | Pass | React production build and both web/mobile TypeScript checks |
| Mobile bundles | Pass | iOS and Android Metro/Hermes exports; this does not compile Swift/Kotlin or prove background capture |
| Android project generation | Pass | Expo prebuild and local native-module autolinking; SDK compilation not run |
| SQL migration consistency | Pass | Upgrade to head and Alembic metadata check on a fresh SQLite database |
| PostgreSQL semantics | Pass in PGlite | Forced RLS with a non-owner role; no tenant leakage; composite tenant foreign-key rejection; transaction context reset; downgrade/upgrade round-trip |
| Queue recovery | Pass | Durable restart, lost-ack retry, full-queue behavior, no silent eviction, SQLite backup/restore |
| ML research | Reproducible synthetic report | Vehicle-disjoint/time-ordered splits; preprocessing fit on training only; simple-rule comparison; no production model promoted |

The delivery runtime is Linux x86-64. Tests use Python 3.12, a disposable SQLite WAL database and a local Chromium distribution. Browser checks were run in separate processes because that constrained Chromium distribution supports a single browser context reliably. They use no personal accounts or car data. The PostgreSQL semantic test uses embedded WASM PostgreSQL (PGlite), **not a full PostgreSQL/Celery/Redis deployment**. Native build CI and full PostgreSQL CI are supplied but have not run on GitHub.

The test suite emits one Starlette/httpx TestClient deprecation warning. It does not fail the tests; migrate that testing adapter when upgrading the pinned framework stack.

## Bounded load result

A disposable actual-HTTP measurement submitted 100 batches, each containing 48 samples, across 20 virtual devices with concurrency 20. All 100 acknowledgements succeeded. API, polling worker and Vite ran in the same shared container; the runtime reported nine logical CPUs. No dedicated CPU/memory reservation or disk-throughput guarantee was available.

| Measurement | Observed |
|---|---:|
| Throughput | 72.45 batches/second |
| Ingestion p50 | 87.50 ms |
| Ingestion p95 | 800.48 ms |
| Ingestion p99 | 1264.71 ms |
| Fleet summary p95, ten reads | 38.65 ms |
| HTTP errors | 0 |

Earlier reruns varied from 61.83 to 69.15 batches/second, with p95 between 922 and 1282 ms; the subsecond latency target was not consistently met. The table records the original delivery run, also preserved in `load-measurement.json`. These are a small engineering measurement, not a production capacity claim. The plan's 100 envelopes/second target was **not achieved** in this run. Memory/pool saturation, sustained PostgreSQL load, disk growth and production projection-lag SLOs remain unmeasured. Rerun `scripts/verify_stack.py` on declared target infrastructure; reports are written under `artifacts/`.

## Local login regression fix — 26 October 2026

The shipped API accepted `localhost:5173` while Vite served `127.0.0.1:5173`, causing `403 ORIGIN_DENIED`. A regression test reproduced this failure before the fix. Development now accepts both loopback names at the configured scheme and port for login, CORS and authenticated mutations. Production and staging retain exact origin matching. Other hosts and ports remain rejected, and CSRF tokens are still required.

The local runner explicitly configures its origin, monitors all services and stops their process trees on exit. Vite fails when port 5173 is occupied instead of changing ports. The new `verify_local.py` launches the actual `scripts/local.py` with a disposable database and a deliberately stale inherited origin, then verifies browser login and completed scenario processing at both supported URLs. The default database path and ordinary setup commands are unchanged.

This revision reran all 70 backend tests, all five browser workflows, the actual HTTP scenario, SQLite migration consistency, backend lint/types, web/mobile TypeScript checks and the web production build before commit. The bounded HTTP regression run accepted all 100 batches, measured 70.52 batches/second and 1184.31 ms ingestion p95, and still does not meet the release target. Mobile bundles, Android prebuild, PGlite checks and ML results in the table above are retained evidence from the original delivery; they were not rerun for this origin-only application change. No native binary, physical-device or production qualification is newly claimed.

## ML interpretation

The included experiment uses 40 fictional vehicles and 45 generated days, with 700 training, 60 validation and 60 test rows after disjoint vehicle/time selection. Ridge fuel MAE is 0.01543 L, versus 0.72292 L for a constant and 0.01506 L for the known generator rule. The learned model does not beat that rule. Trip-label balanced accuracy is 1.0 on generator-defined labels, which is expected and is not real-car accuracy. Promotion is explicitly rejected. See `ml/evaluation/` and the model card.

## Release blockers and untested paths

- No actual Vgate/car/iPhone/Android device is connected. Neither Swift/Kotlin application binary nor physical recording, GPS timing, background continuity, adapter sleep/reconnect, battery drain or real fuel accuracy has been verified.
- Full Compose startup, PostgreSQL backup restore, Redis/Celery failover under real process termination, production OIDC/TLS, mobile token renewal and hosted CI have not been exercised.
- The default advisor is deterministic evidence logic. No live external model, failure forecast, exact fitment/price service, notification delivery or production monitoring is being represented as verified.
- Dependency auditing reports five high-severity package entries (four from the node-forge/Expo chain and one name/range match for the local image-size adapter), zero moderate/low and zero critical. The audit is not clean: the Expo chain includes the unpatched node-forge 1.4.0 signature-verification advisory. The local image-size compatibility package can also be flagged by version range, although its parser is the patched 2.0.4 implementation. Both the legacy adapter and mobile asset bundling are tested. Vite/PostCSS/URI-decoder/esbuild updates were applied; see the lockfile and rerun `npm audit` at release.
- Native support, real-data model validation, large-retention scaling and the additional unimplemented features listed in STATUS remain open. Passing synthetic tests does not satisfy these gates.

A final local commit is created only after the available verification passes. No remote push or deployment is part of this delivery.

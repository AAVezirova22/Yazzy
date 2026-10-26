# Yazzy

Vehicle telemetry, trip and fuel analysis, evidence-backed trends, and an independent simulated fleet. React web, Expo mobile with Swift/Kotlin BLE recorders, FastAPI, SQLAlchemy, PostgreSQL and Celery/Redis.

**You can use the complete browser demonstration without car data.** The personal garage contains an empty real-car record. The fictional fleet uses a separate tenant and labels simulated telemetry, findings, advisor responses and exports.

This is an implemented and tested engineering prototype. It is **not a qualified real-car release**. Physical iPhone/Android capture, native binary builds, live OIDC, production deployment and real diagnostic accuracy remain release gates. Read [verification and remaining gates](docs/EVALUATION.md) and the [requirement coverage](docs/STATUS.md) before presenting it as completion of the entire implementation plan.

## Start locally

Prerequisites: Python 3.12, Node 24, npm, and `uv` 0.13.4. Run from this repository:

```sh
npm ci --ignore-scripts
uv sync --project backend --frozen
python scripts/local.py
```

After setting everything up for iphone:
For normal development uses:
```sh
npx expo start --dev-client
```
And if you need to rebuild or reinstall the native app
```sh
npx expo run:ios --device
```
1. To keep Tailscale running in the background:
```sh
tailscale serve --bg 8000
```
2. Start the backend from the project root:
```sh
python scripts/local.py
```
3. Start the mobile development server in another terminal, also starting from the project root:
```sh
cd apps/mobile
npx expo start --dev-client
```

Open **http://127.0.0.1:5173** or **http://localhost:5173**. Both addresses are accepted by the local development server. Choose **Explore the demo fleet** or **Start my garage**. On the fleet page, create a scenario and generate accelerated history. The local worker processes the same durable job ledger used by Celery. No external AI key is required.

For a 12-vehicle, 14-day scenario uploaded through the real HTTP API, in a second terminal:

```sh
uv run --project backend python -m simulator.runner --scenario DRIFT_HISTORY --vehicles 12 --reset
```

`--reset` resets the current **demo run only**. Never use the local demo login for a public deployment. `scripts/local.py` explicitly enables it on loopback. To use PostgreSQL/Redis instead:

```sh
python scripts/configure.py
docker compose up --build
```

Open **http://localhost:8080**. To stream a fleet independently of either phone:

```sh
docker compose --profile demo up simulator
```

Compose definitions are included; the full Docker deployment was not run in the delivery environment. Docker image/native CI jobs must pass in your environment before a release.

## Verify

```sh
uv run --project backend pytest backend/tests -q
uv run --project backend ruff check backend scripts simulator
uv run --project backend mypy --config-file backend/pyproject.toml backend/src/yazzy
npm run typecheck
npm run build
node scripts/check_image_compat.cjs
npx playwright install chromium
uv run --project backend python scripts/verify_stack.py
uv run --project backend python scripts/verify_local.py
```

The two Python verification scripts start disposable API, worker and browser-test servers on ports 8000/5173; stop local development servers first. `verify_stack.py` creates a temporary database, submits telemetry over HTTP, verifies three drift findings, measures bounded load, and tests fleet, garage and mobile-width workflows. `verify_local.py` exercises the documented launcher and real browser clicks on both loopback addresses, including when an old `WEB_ORIGIN` value is exported. Both leave reports in ignored `artifacts/`, without touching your development database.

`contracts/openapi.json` and the TypeScript schema are generated from the running API definitions:

```sh
uv run --project backend python scripts/export_contracts.py
npm run contracts
```

## Local login returns 403

In the first archive, Vite opened `127.0.0.1:5173` while the API default allowed only `localhost:5173`. That mismatch returns `ORIGIN_DENIED` on demo login. This revision shares the exact configured development loopback scheme/port between both names; production still accepts only its explicit origin. The local runner sets its own development origin and Vite refuses to silently switch to port 5174.

Stop the previous runner, replace the source with this revision, and start `python scripts/local.py` again. Your SQLite database is not replaced or erased. With an old checkout, the immediate macOS/Linux workaround is `WEB_ORIGIN=http://127.0.0.1:5173 python scripts/local.py`, then opening exactly `http://127.0.0.1:5173`. Close any older development server already using ports 8000/5173.

## Collect your first car data

Follow [mobile setup and qualification](docs/HARDWARE.md). You need a development build containing `YazzyRecorder`; Expo Go cannot load this custom module. The MacBook/iPhone and Windows/Android instructions use the same repository and an HTTPS backend reachable by the phone.

The recorder discovers the actual BLE service and characteristics. It does not assume a Vgate UUID, verified background operation, cranking voltage, or any available manufacturer-specific PID. Bluetooth Classic transport is not implemented. Unsupported measurements stay unavailable.

## Project guide

- [User guide and fleet demonstration](docs/USER_GUIDE.md)
- [Architecture, ER diagram and decisions](docs/ARCHITECTURE.md)
- [Deployment, security, retention and recovery](docs/OPERATIONS.md)
- [Hardware matrix and release checklist](docs/HARDWARE.md)
- [Evaluation and measured limits](docs/EVALUATION.md)
- [Plan coverage and outstanding work](docs/STATUS.md)
- [Original supplied plan](docs/IMPLEMENTATION_PLAN.md)
- [Dataset catalogue](ml/datasets/catalogue.json) and [trend model card](ml/model-cards/warm-idle-trend.md)

The default advisor is labelled deterministic evidence logic. It does not make a live LLM call. ML benchmarks are synthetic research only; no trained model is promoted and no failure probability, date, exact part fitment or price is invented.

Source, contracts, migrations, locks and CI are included. Secrets, personal telemetry, databases, screenshots, dependency caches and native generated projects are excluded.

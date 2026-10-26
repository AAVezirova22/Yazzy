# Implementation coverage

This repository implements a runnable product core and a tested synthetic fleet. **The full plan's definition of done has not been achieved.** In particular, native binaries and actual adapter/phone combinations are not qualified, no real car data was supplied, and deployment/provider integration cannot be validated without those environments. The remaining items below are not hidden behind passing simulation tests.

| Plan sections | Delivered | Remaining gate or narrower scope |
|---|---|---|
| 1–7, architecture and workflow | Modular Python/TypeScript monorepo, migrations, locks, generated contracts, CI definitions, local Git history | No supplied GitHub remote, hosted CI run or release artifact signing |
| 8–9, hardware/mobile | Expo screens; native BLE discovery, selected GATT profile, read-only polling, SQLite queue, GPS, uploads/retries; Android foreground service | Native build and real iPhone/Android lifecycle qualification; Classic transport not implemented; mobile feature parity is narrower than web |
| 10, fleet simulation | 10–20 identities, dedicated tenant, deterministic scenarios, virtual clock, pause/resume/speed/reset, HTTP CLI, durable offline queue | Continuous live control requires server connectivity; no physical cellular tracker integration is claimed |
| 11–12, OBD safety | Allowlisted setup/read commands, PID discovery/conversion, fragmented response buffers, timeouts; Python DTC decoder | Native DTC acquisition, per-ECU identity qualification, adaptive PID scheduling and full capability-report persistence need field work |
| 13–17, domain/auth/ingestion | Organisations/roles/vehicles/devices/assignments; interval validation; batch and sequence idempotency; atomic SQL outbox; bounded schemas | Live OIDC/provider enrollment and production workload testing pending |
| 18–22, trips/location | Provisional native state; authoritative Python replay; stop-start/hybrid cases, uncertain ends, GPS fallback, explicit gaps, split/merge corrections | Real labelled drives and shared native compiled-fixture results pending; cross-session automatic reconnection/merge remains conservative; map is schematic |
| 23–24, fuel | Time integration, validated counter/odometer gates, qualified petrol-MAF gate, missing-coverage abstention, ratio-of-sums, manual purchases/tank intervals | Real refuelling calibration, per-method accuracy and period-cost allocation not validated; estimated cost remains unavailable |
| 25–28, coverage/baselines | Warm-idle fuel-trim regime, frozen reference, persistence, immutable evidence, repair reset | Warm-up, MAF/MAP plausibility and wider context regressions are not production detectors |
| 29–32, battery/forecast/research | Explicit unsupported-claim fields and no fabricated probabilities/dates | Cranking qualification, calibrated failure forecasting, acoustic collection and federated learning deferred as research |
| 33–39, evidence/advisor/quotes | Evidence cards, deterministic labelled advisor, expiring confirmation flow, reauthorisation/version checks, verified manual quotes | Live model adapter not wired; autonomous tool calling, PDF OCR/upload and external part/price services not implemented |
| 40–44, dashboard/workflow/API | Fleet search, state/freshness, telemetry, findings, work orders, service outcomes, charts, exports, audit, mobile core screens | Commercial map/navigation, booking schedule, richer trip editing and full mobile screen parity not implemented |
| 45–48, recovery/security/privacy/scale | Outbox leases/fencing, scoped exports/events, CSRF, JWT/OIDC code, RLS migration, payload/rate limits, scoped retention/erasure | Native push delivery, production metrics/traces/alerts, object storage, incremental large-retention projections and 100 batches/s target pending |
| 49–51, datasets/collection | Versioned catalogue, checksum/licence-aware CSV importer, separate synthetic research benchmark | Public datasets not downloaded; own labelled data and confirmed repair outcomes absent |
| 52–54, testing/evaluation | Backend/domain/property tests, HTTP replay, browser flows, embedded PostgreSQL RLS/migrations, synthetic ML comparison, injection tests | Full native builds, hardware tests, real-data accuracy, live-model evaluation, sustained production load and PostgreSQL restore drill remain |
| 55–60, delivery/acceptance | Compose, setup/provisioning/recovery guides, architecture/ER, hardware matrix, user/demo guide, evaluation and release gates | No deployed production service; full definition of done remains open |
| 61–62, evidence/principles | Original source register retained; synthetic and real evidence kept distinct | Recheck third-party dataset terms and platform versions at acquisition/release |

## Required next release gates

1. Run hosted native and PostgreSQL CI plus Compose smoke tests, address compiler/platform failures and unresolved dependency advisories.
2. Build on the MacBook/iPhone and Windows/Android setup. Measure the actual Vgate's firmware, transport, sensors, reconnect/sleep and screen-off behavior.
3. Record real drives and independent fuel references. Evaluate segmentation and fuel error against labelled data; do not substitute synthetic scores.
4. Exercise the selected OIDC provider, production TLS/proxy settings, mobile token refresh, restricted database role, backups/restore, retention and operational alerts.
5. Expand the bounded prototype processing/UI where a pilot actually needs it; meet measured throughput targets before claiming them.
6. Add additional health detectors or a live advisor only after their evidence contracts, evaluation and permissions are verified.

The user does not need to buy a cellular tracker or supply car telemetry to run the delivered fleet demonstration. Physical qualification, however, cannot be completed remotely without access to the adapter, car and phones.

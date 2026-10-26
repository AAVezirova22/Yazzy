# User guide and demonstration

## With no car data

Start the local stack and choose **Start my garage**. The first car is a record only: no trips, invented fuel totals or health score. Add your vehicle name/make/model and real fuel purchases if you have them. Asking whether the battery will fail returns insufficient data.

The web app includes overview, searchable vehicles, telemetry charts, trip/stationary summaries, health evidence, work orders, service history, advisor/quote review, CSV reports, audit and privacy settings. The mobile app includes garage, BLE qualification, native recorder controls/status, trips, findings, service history and evidence advisor. Advanced trip editing and exports are primarily web/API workflows.

## Fleet demonstration without either phone

1. Choose **Explore the demo fleet**. Create `DRIFT_HISTORY` with 12 vehicles and seed 42, then generate history; or run the README's HTTP simulator command. Wait for the worker to finish. The expected result is three synthetic fuel-trim drift findings.
2. Inspect the persistent simulation label and virtual scenario time. Position dots are a schematic coordinate overview, not a navigation map or a commercial basemap.
3. Open YAZ 001, inspect speed/RPM charts, trip coverage and health evidence. Expand a trip to see method, gaps, engine-off pauses and end reason. Split a trip at its midpoint only when that is the intended correction; merge and exact-time split are also available through the API.
4. Open Advisor and explain the finding. It is explicitly a deterministic evidence response. The data supports a trend; it does not establish a failed part or predict a date.
5. Prepare an inspection work order. Review the proposal and explicitly confirm. Open Maintenance, advance the task and record the actual service outcome. A baseline reset starts a new evidence episode; it does not turn an AI suggestion into a repair label.
6. Enter a fictional, verified mechanic quote. The review separates diagnostic evidence from unverified parts/fitment/pricing. Quotes cannot execute actions.
7. Export CSV; every row preserves origin and calculation method/coverage. Check the audit trail.
8. Reset the selected simulation and reproduce it using the same seed. This archives the demo vehicles, revokes its virtual devices and cancels outstanding jobs. Your personal garage is a separate tenant.

For continuous changing readings, use `CITY --live`; the simulator reads pause/resume/speed/reset controls and uses its own durable upload queue. Keep its API connection available for control-clock coordination. The server-side Generate history control also invokes the same ingestion service but is not a network outage test.

## Offline/retry demonstration

With the local stack running:

```sh
uv run --project backend python -m simulator.runner --scenario CITY --vehicles 12 --reset --offline --queue offline-demo.db
uv run --project backend python -m simulator.runner --flush-only --queue offline-demo.db
```

The first command provisions virtual identities and writes pending batches without uploading telemetry. The second resumes the same on-disk queue. Only accepted batches are removed; a lost acknowledgement causes safe retry. Keep the queue private because it contains virtual device credentials. If you reset the run before flushing, those credentials are revoked; do not relabel the old records into a new run.

Scenarios include normal city/stop-start motion, missing sensors, GPS loss, duplicates, reversed delivery, drift history and recovery. All are generated fixtures. They are not your car's measurements or validation of real faults.

## Meaning of unavailable values

A dash means no usable observation. Missing fuel is not zero. Driving with missing GPS can still have OBD speed distance; each result reports its source. Long missing intervals are excluded from integration. Stationary fuel and purchased fuel remain distinct. Efficiency excludes sessions without full paired fuel/distance coverage.

An engine stop is not proof of parking. When connection/end evidence is lost, the trip remains uncertain. Lack of findings does not establish overall vehicle health. Manual tank intervals are a comparison reference; they do not automatically qualify MAF estimates.

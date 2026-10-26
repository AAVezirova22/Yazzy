# Deployment and operations

## Development boundaries

The included local runner uses SQLite and a ledger-polling worker. Compose uses PostgreSQL, Redis, dispatcher, Celery worker, API and nginx/web. Demo login is explicitly gated and prohibited by production configuration. Do not expose a demo-enabled backend or the Vite server to the public Internet.

`python scripts/configure.py` creates ignored random local credentials and never overwrites an existing environment file. Compose separates the migration owner from `yazzy_app`, a runtime role without superuser/BYPASSRLS permissions. Database and Redis ports are internal; only loopback web/API ports are published.

## Production gate

1. Run all CI jobs, Docker smoke checks and physical-device qualification. Resolve the release blockers in EVALUATION and STATUS.
2. Use separate staging and production databases/secrets; disable `YAZZY_DEMO_ENABLED`, set `YAZZY_ENV=production`, configure an HTTPS OIDC issuer/audience/client and a strong shared session secret. Configure the provider's allowed web callback `/api/v1/auth/callback` and mobile `yazzy://` PKCE redirect. Provider-specific audience and refresh behavior must be tested with actual tokens.
3. Terminate TLS at a trusted proxy and set `WEB_ORIGIN` to the canonical browser origin. Strip untrusted forwarding headers. Configure API proxy trust explicitly for that network. Native collectors require a reachable HTTPS URL. Redis requires private networking/authentication according to the hosting environment.
4. Run migrations once using migration-owner credentials. Run API/workers with the restricted runtime role. Never disable RLS to fix a missing tenant context.
5. Provision trusted OIDC subjects administratively:

```sh
uv run --project backend python scripts/provision_user.py --tenant my-garage --name 'My garage' --subject 'exact-provider-sub' --role OWNER
```

Use the administrative database connection for this command. No public self-registration grants tenant membership. Device enrollment requires an authorised vehicle owner/manager and returns the plaintext device secret only at enrollment. Native storage uses Keychain or Android Keystore-backed encryption.

No deployment, cloud account, OIDC tenant, GitHub remote or signing identity was configured during implementation. CI definitions are not evidence of a successful hosted CI run. Optional object storage, push delivery, commercial maps and a live model provider are not deployed.

## Recovery

The SQL job ledger is the source of required work. Redis loss leaves pending rows for publication retry. Workers use leases, bounded attempts and generation checks; inspect failed jobs through `/api/v1/operations` and application logs. Recover the cause before retrying; never reset attempt counters blindly or delete source telemetry to hide failure.

A migration failure blocks API startup in Compose. Restore to a fresh database and validate before switching traffic; code rollback alone does not reverse a schema migration.

For PostgreSQL, take encrypted `pg_dump --format=custom` backups with an operations role and use provider point-in-time recovery if available. Periodically restore into a separate empty database, run migrations/checks and compare tenant-scoped counts, trip totals and job status. Then test read-only application paths with the restricted runtime role. The delivery tested SQLite queue backup/restore and PostgreSQL migration reversal on PGlite; **a production PostgreSQL backup restore has not been demonstrated**. Define RPO/RTO with the pilot owner instead of inventing values.

## Retention and deletion

Run `uv run --project backend python -m yazzy.retention --tenant TENANT_ID` as a scheduled operational job after reviewing settings. The default is 30 days of raw telemetry and 90 days of detailed route points. Purge skips tenants with outstanding jobs and preserves trip summaries. Actor preferences use the shortest configured tenant retention. Database backups need their own expiry/erasure policy.

Vehicle erasure requires an archived vehicle and an explicit matching name confirmation via the API. It revokes associated collectors, removes raw/derived data and prepared actions, cancels/scrubs exports, and leaves an audit/tombstone record. Do not delete database volumes as a substitute for scoped erasure. Research/audio permissions default off; no research upload is implemented.

## Limits and observability

Upload limits: 1 MB, 1000 samples; per-IP API rate limit 2400/minute, backed by Redis in production. Reconciliation explicitly refuses more than 100,000 retained samples per vehicle. Export/report limits and raw chart downsampling bound read work; larger pilot retention needs incremental session processing and paginated projections.

Requests return correlation IDs. Jobs expose status/attempts/errors and the operations view shows queue state. A durable audit stream is available; there is no production metrics/tracing backend or on-call alert integration. Add measured pool, CPU, memory, disk, dead-job, ingestion-lag and capture-gap monitoring before claiming operational SLOs.

## Dependency notes

Lockfiles are checked in. Keep development/build services on loopback. `packages/image-size-compat` is a private compatibility adapter for legacy Metro path-based calls, forwarding to the patched `image-size` 2.0.4 buffer parser. Its local 1.2.2 compatibility version can be flagged by name/range-based scanners despite using the patched parser; the adapter and real mobile bundling are tested.

The current Expo toolchain still depends on `node-forge` 1.4.0 with a reported signature-verification advisory and no newer published version found during implementation. Do not claim a clean dependency audit. Do not enable untrusted update/signing-certificate processing; resolve this before production distribution. Full details and the final audit count are in EVALUATION.

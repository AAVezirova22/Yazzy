# Hosting Yazzy (Railway + Vercel + GitHub Releases)

Runs without your laptop.

| Piece | Where | Why |
|---|---|---|
| API + job worker | **Railway** (Hobby plan, EU West), service `yazzy-api` | Long-running Python process that never sleeps. The worker runs inside the API (`YAZZY_EMBEDDED_WORKER=true`). |
| Database | **Railway** Postgres, same project | Next to the API on Railway's private network, so their traffic is not metered. |
| Web app (static React) | **Vercel** | `apps/web/vercel.json` proxies `/api/*` to Railway so cookies stay same-origin. |
| Android updates | **GitHub Releases**, tag `android` | `scripts/build_apk.py --publish`; the app downloads updates from there. |

Until November 2026 the API ran on Render's free plan with a Neon free database. Neon blocked the database once
its monthly outgoing data ran out, so both were replaced; the old data was not carried over.

Hosted mode runs with `YAZZY_ENV=staging`, **not** `production` (production forbids the demo login and requires OIDC).
Because the demo login is then reachable from the internet, the API **refuses to start** unless
`YAZZY_ACCESS_PASSWORD` (12+ characters) is set. The web login and the phone app both ask for it.

## Railway project `yazzy`
- **Postgres:** Railway's Postgres template. The API does not use its superuser: it logs in as `yazzy`, an
  ordinary role (no superuser, no BYPASSRLS) that owns the `yazzy` database, so the forced row-level security applies.
  The database has no public address; open a temporary TCP proxy (`railway tcp-proxy create -s Postgres --port 5432`)
  only when you need to reach it from outside, and delete it afterwards.
- **yazzy-api:** built from `infrastructure/backend.Dockerfile`, started with `sh scripts/start-api.sh` (migrations,
  demo seed, then uvicorn), health check `/ping`, one replica in EU West (the Hobby plan allows one region).
  These settings are stored on the service itself, not in a config file.
- **Public address:** `https://yazzy-api-production.up.railway.app`.

### Deploying the API
Deploys are not tied to GitHub pushes; run them from the repository root after a backend change:
```sh
npx @railway/cli up -s yazzy-api --detach
```
`railway login` once per computer (it opens the browser to approve), and `railway link` to the `yazzy` project.
Follow the deploy with `railway deployment list -s yazzy-api` and `railway logs -s yazzy-api`.

## Vercel (web)
1. If the API address changes, edit the two destinations in `apps/web/vercel.json`.
2. **Add New → Project**, import the repo. Vercel lists the apps it found: choose **Import single project** on **`web`** (root directory `apps/web`).
   Do not import `backend` or `ml`, and do not group them with *Services*: the API runs on Railway.
   `apps/web/vercel.json` supplies the install (from the repo root, for the npm workspaces), build and output settings.
   Leave "Include source files outside of the Root Directory" enabled.
3. Deploy, then make sure the API's `WEB_ORIGIN` equals the final Vercel URL (login checks the `Origin` header).
   Preview deployments and custom domains have different origins; set `WEB_ORIGIN` to the one you actually use.

### Deploys from any contributor
On the Hobby plan Vercel only deploys commits authored by the project owner; pushes from other GitHub accounts
show a red ✗ ("Deployment Blocked"). `.github/workflows/vercel-deploy.yml` works around this by calling a deploy hook
on every push to `main`. One-time setup, done by the **Vercel project owner**:
1. Vercel → the `web` project → **Settings → Git → Deploy Hooks**: name `github-main`, branch `main`, **Create Hook**. Copy the URL.
2. GitHub → the repo → **Settings → Secrets and variables → Actions → New repository secret**:
   name `VERCEL_DEPLOY_HOOK`, value the hook URL. Treat it like a password: anyone with it can trigger deploys.
3. GitHub → **Actions → Vercel deploy → Run workflow** to deploy the current `main` and check it works.

The ✗ from Vercel's own Git check still appears on other authors' commits; the deployment that matters is the one
the hook starts (visible in Vercel's Deployments list).

## Phone app
APKs built by `scripts/build_apk.py` use the Railway address by default (`EXPO_PUBLIC_API_URL` in
`apps/mobile/.env.local`). Phones that saved the old Render address move to it on launch, keeping the access password;
their recorder must be reset (Drive › Reset recorder) and paired again, because the old pairing lived in the old database.

## Behaviour to expect
- **Worker:** the embedded worker sleeps until a write request arrives. While a car drives, trip rebuilds wait up to
  `YAZZY_REBUILD_DELAY_SECONDS` (300) and share one pass; ignition off rebuilds at once.
- **Row-level security:** the migrations enable and *force* RLS, and the app sets the tenant on every transaction.
- **Cost:** the Hobby plan includes $5 of usage a month; set a usage alert under Railway's billing settings.

## Environment variables (yazzy-api)
| Variable | Value |
|---|---|
| `YAZZY_ENV` | `staging` |
| `YAZZY_DEMO_ENABLED` | `true` |
| `YAZZY_EMBEDDED_WORKER` | `true` |
| `YAZZY_ACCESS_PASSWORD` | 12+ characters, required |
| `DATABASE_URL` | `postgresql://yazzy:…@postgres.railway.internal:5432/yazzy` (private network) |
| `WEB_ORIGIN` | the Vercel URL, e.g. `https://yazzy-navy.vercel.app` |
| `SESSION_SECRET` | random, 48+ characters |

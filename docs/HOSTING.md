# Hosting Yazzy for free (Vercel + Render + Neon)

Runs without your laptop. All three have free tiers; check their current limits before relying on them.

| Piece | Where | Why |
|---|---|---|
| Web app (static React) | **Vercel** | Serverless/static only. `apps/web/vercel.json` proxies `/api/*` to Render so cookies stay same-origin. |
| API + job worker | **Render** free web service | Long-running Python process. The worker runs inside the API (`YAZZY_EMBEDDED_WORKER=true`). |
| Database | **Neon** free Postgres | Render's free disk is wiped on redeploy and its free Postgres expires after 30 days. |

Hosted mode runs with `YAZZY_ENV=staging`, **not** `production` (production forbids the demo login and requires OIDC).
Because the demo login is then reachable from the internet, the API **refuses to start** unless
`YAZZY_ACCESS_PASSWORD` (12+ characters) is set. The web login and the phone app both ask for it.

## 1. Neon (database)
1. Create a project at neon.tech. Copy the **direct** connection string (host without `-pooler`).
   It looks like `postgresql://user:pass@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require`.
   The app converts it to the `psycopg` driver URL itself.
2. Nothing else: Render runs the migrations on every start.

## 2. Render (API)
1. Push this branch to GitHub. In Render choose **New → Blueprint** and select the repo/branch; it reads `render.yaml`.
2. Fill the three prompted values:
   - `DATABASE_URL`: the Neon string from step 1.
   - `YAZZY_ACCESS_PASSWORD`: pick a long random password.
   - `WEB_ORIGIN`: your Vercel URL, e.g. `https://yazzy.vercel.app` (no trailing slash). If you do not know it yet, put a placeholder and update it after step 3.
3. Deploy. Note the service URL (default `https://yazzy-api.onrender.com`).

## 3. Vercel (web)
1. If your Render URL differs from `https://yazzy-api.onrender.com`, edit the two destinations in `apps/web/vercel.json`.
2. **Add New → Project**, import the repo. Vercel lists the apps it found: choose **Import single project** on **`web`** (root directory `apps/web`).
   Do not import `backend` or `ml`, and do not group them with *Services*: the API runs on Render.
   `apps/web/vercel.json` supplies the install (from the repo root, for the npm workspaces), build and output settings.
   Leave "Include source files outside of the Root Directory" enabled.
3. Deploy, then make sure Render's `WEB_ORIGIN` equals the final Vercel URL exactly (login checks the `Origin` header).
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

## 4. Phone app
Enter the Render URL (`https://yazzy-api.onrender.com`) in the **API address** field and your access password, then tap
**Open local personal sandbox**. The password is kept in the device keychain. No native rebuild is needed, and Tailscale is no longer required.
To make the Render URL the default, set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env`.

## Behaviour to expect
- **Cold starts:** after ~15 minutes without requests Render sleeps the service; the next request takes roughly 30-60 s while it boots and runs migrations.
  The recorder buffers readings on the phone, so a slow first upload is fine. `GET /ping` is a cheap, database-free liveness endpoint if you want a pinger.
- **Worker:** the embedded worker sleeps until a write request arrives, so an idle app does not keep Neon's compute awake.
- **Row-level security:** the migrations enable and *force* RLS, and the app sets the tenant on every transaction, so it works whether or not your database role bypasses RLS (tested against Postgres 17 as an ordinary, non-bypass owner role).
  Hosted Postgres does not create the separate restricted `yazzy_app` role that Docker Compose uses; add it yourself if you want that extra layer.
- **Data:** hosted data persists in Neon. The Docker Compose / SQLite local setup is unchanged.

## Environment variables
| Variable | Value |
|---|---|
| `YAZZY_ENV` | `staging` |
| `YAZZY_DEMO_ENABLED` | `true` |
| `YAZZY_EMBEDDED_WORKER` | `true` |
| `YAZZY_ACCESS_PASSWORD` | 12+ characters, required |
| `DATABASE_URL` | Neon connection string |
| `WEB_ORIGIN` | the Vercel URL |
| `SESSION_SECRET` | generated by `render.yaml` |

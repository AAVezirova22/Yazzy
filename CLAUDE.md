# Yazzy

## Android APK must stay current
After any change that affects the mobile app (anything under `apps/mobile/`, `packages/api-client/`, or root `package.json`/`package-lock.json`), rebuild and publish the APK before finishing:

```sh
python scripts/build_apk.py --publish
```

- Commit first: the build number is the git commit count, and installed apps only offer an update when it is higher than theirs.
- `--publish` uploads the APK to the GitHub release tagged `android` (not to the API or database) with the manifest `yazzy-android.json`; the app reads that manifest from GitHub and its Home tab shows an "Update available" card, so the user never downloads APKs by hand. It signs in with `GITHUB_TOKEN` if set, else with git's saved GitHub credential. Confirm it prints `Published: installed apps will offer build <n>`.
- The `android` tag is only a download shelf; publishing never pushes commits.

- Use `--clean` after changing `app.json`, `app.config.js`, `apps/mobile/plugins/`, native module code, or dependencies.
- Confirm it prints `APK ready: ...Yazzy-<version>.apk` and tell the user the APK was updated.
- Never commit `apps/mobile/.env.local` (holds the Google Maps key) or the APK; both are gitignored.
- The build needs `EXPO_NO_METRO_WORKSPACE_ROOT=1`; the script sets it. Do not call Gradle directly without it.

## Hosted API runs on Railway
After a backend change (anything under `backend/`, `infrastructure/backend.Dockerfile` or `scripts/start-api.sh`), deploy it from the repo root once the change is committed: `npx @railway/cli up -s yazzy-api --detach`, then confirm `railway deployment list -s yazzy-api` shows SUCCESS and `https://yazzy-api-production.up.railway.app/health` answers. Pushing to GitHub does not deploy the API. See `docs/HOSTING.md`.

# Yazzy

## Android APK must stay current
After any change that affects the mobile app (anything under `apps/mobile/`, `packages/api-client/`, or root `package.json`/`package-lock.json`), rebuild and publish the APK before finishing:

```sh
python scripts/build_apk.py --publish
```

- Commit first: the build number is the git commit count, and installed apps only offer an update when it is higher than theirs.
- `--publish` uploads the APK to the API (in 4 MB parts) so the app's Home tab shows an "Update available" card; the user no longer downloads APKs by hand. It needs `YAZZY_RELEASE_TOKEN` in `apps/mobile/.env.local` (same value is set on Render). Confirm it prints `Published: installed apps will offer build <n>`.

- Use `--clean` after changing `app.json`, `app.config.js`, `apps/mobile/plugins/`, native module code, or dependencies.
- Confirm it prints `APK ready: ...Yazzy-<version>.apk` and tell the user the APK was updated.
- Never commit `apps/mobile/.env.local` (holds the Google Maps key) or the APK; both are gitignored.
- The build needs `EXPO_NO_METRO_WORKSPACE_ROOT=1`; the script sets it. Do not call Gradle directly without it.

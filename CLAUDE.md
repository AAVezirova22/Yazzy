# Yazzy

## Android APK must stay current
After any change that affects the mobile app (anything under `apps/mobile/`, `packages/api-client/`, or root `package.json`/`package-lock.json`), rebuild the APK before finishing:

```sh
python scripts/build_apk.py
```

- Use `--clean` after changing `app.json`, `app.config.js`, `apps/mobile/plugins/`, native module code, or dependencies.
- Confirm it prints `APK ready: ...Yazzy-<version>.apk` and tell the user the APK was updated.
- Never commit `apps/mobile/.env.local` (holds the Google Maps key) or the APK; both are gitignored.
- The build needs `EXPO_NO_METRO_WORKSPACE_ROOT=1`; the script sets it. Do not call Gradle directly without it.

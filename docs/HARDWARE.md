# Mobile development and hardware qualification

## Current matrix

| Combination | Implementation | Binary build | Actual capture | Screen-off/restart | Supported PIDs |
|---|---|---|---|---|---|
| Vgate iCar Pro Bluetooth 4.0 + iPhone | CoreBluetooth BLE + SQLite + CoreLocation | Pending Xcode run | Not tested | Not tested | Must discover on the owned unit/car |
| Vgate iCar Pro Bluetooth 4.0 + Android | GATT BLE + foreground service + SQLite/GPS | Pending Android SDK run | Not tested | Not tested | Must discover on the owned unit/car |
| Android Bluetooth Classic | Not implemented | Not applicable | Not qualified | Not qualified | Unknown |
| 10–20 virtual devices | Seeded HTTP simulator | Python | Tested synthetic telemetry | Durable queue tested | Explicit synthetic profile |

Hardware labels remain `PENDING_DEVICE_TEST`. JavaScript/Hermes bundles passing is not a native binary build or proof of BLE/background operation. No OBD adapter is reachable from the delivery environment.

## MacBook and iPhone

1. Install Python 3.12, Node 24, uv, Xcode and command-line tools, and CocoaPods. Run `npm ci --ignore-scripts` at the root.
2. Start a reachable HTTPS development backend. Set `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_OIDC_ISSUER` and `EXPO_PUBLIC_OIDC_CLIENT_ID` in your shell before the build. For an isolated local backend, the explicit personal sandbox login is also available. A phone's `localhost` is the phone, not your Mac.
3. In `apps/mobile`, run `npx expo prebuild --platform ios`, then `npx expo run:ios --device`. Select your signing team and bundle identifier in Xcode as required. These instructions have not been executed against Xcode in this environment.
4. The app includes Bluetooth and foreground/background location descriptions. Grant permissions deliberately. Select your real vehicle, scan while parked, inspect the actual adapter and choose discovered writable/notify characteristics from the same service.
5. Start recording; compare speed/RPM/coolant against a trusted reference. Stop explicitly and upload. Do not mark transport or sensors qualified until measured.

## Windows and Android

1. Install Python 3.12, Node 24, uv, Android Studio/SDK and its supported Java runtime. Run `npm ci --ignore-scripts` at the root.
2. In PowerShell set `$env:EXPO_PUBLIC_API_URL='https://your-development-host'` and your OIDC variables. Provision your identity as described in OPERATIONS.
3. In `apps/mobile`, run `npx expo prebuild --platform android`, then `npx expo run:android --device`. Trip maps on Android use Google Maps: create a Maps SDK for Android key and build with `GOOGLE_MAPS_API_KEY=<key> npx expo run:android --device` (PowerShell: `$env:GOOGLE_MAPS_API_KEY='<key>'`). Without a key the trip screen draws a plain route sketch instead of a map. iOS uses Apple Maps and needs no key. The emulator cannot verify Bluetooth. Use a physical Android phone with USB debugging for the hardware spike.
4. Grant nearby-device, location and notification permissions. Start recording from the foreground. Verify the ongoing notification and Stop action. Android restrictions and vendor battery management can still interrupt recording.
5. If your unit requires Classic SPP, stop qualification and add/verify that transport before claiming Android support. Do not guess a BLE service to make the UI appear connected.

## Repeatable checks

```sh
python scripts/test_native_domain.py --language swift
python scripts/test_native_domain.py --language kotlin
```

These compile the actual pure native trip/decoder files against `contracts/fixtures/trip-state-v1.json`. Run on machines with `swiftc` or `kotlinc`/Java. They fail if the compiler is unavailable. CI also builds the entire generated iOS/Android projects; those CI jobs were authored but not executed in the delivery environment.

Record adapter model/firmware, vehicle/powertrain, phone OS, app commit, discovered GATT UUIDs, supported PID masks, per-PID response times, malformed/multi-ECU responses and GPS accuracy. Preserve no credentials in the qualification report.

For each platform, test at least:

- Cold start and warm idle; supported/unsupported sensors and no-data replies.
- Stop-start queue, engine-off movement where applicable, ordinary parking and manual stop.
- Screen locked, app background, explicit OS termination, reboot and reconnection.
- Adapter unplug/sleep, lost BLE, tunnel/GPS denial, network outage and recovery.
- Upload acknowledgement lost, queue growth/pressure and assignment change with queued data.
- Recorded duration, observed gaps, battery use and native release-mode UI responsiveness.

A passenger or stationary operator handles controls. Never clear codes, actuate components or induce a vehicle fault for a test. Existing module-voltage observations are not a qualified cranking minimum. Record limitations honestly and keep unknown values unknown.

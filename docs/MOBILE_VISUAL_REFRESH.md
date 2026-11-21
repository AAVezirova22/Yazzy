# Yazzy — Home, Drive and navigation refresh

This revision starts from the uploaded original source, not the earlier concept designs. It changes the shared React Native UI used by both iPhone and Android.

## What changed

- Home: light white-to-blue-grey studio background, realistic three-quarter car asset, existing vehicle name and switch action, make/model line below the image, recorder status, and four equal-width square shortcuts. The car image is a generic illustrative asset, not an asserted photo or model match for the selected vehicle. No “All good” status is added.
- Status: original square cards, order and actions preserved. An unavailable weekly distance now displays “—”; a loaded empty trip list still totals 0.
- Drive: pale blue gradient, dark speed/RPM text, light status badges and dividers. Stop/disarm uses the same blue action treatment as Start. All recorder controls, BLE setup, queue handling, permissions, validation and warnings are retained.
- Navigation: same Home / Trips / Health / Drive / More order and recorder dot, with 68-point targets. iOS keeps the floating glass dock. Android uses a fixed, full-width light bar flush with the bottom edge, without outer corner rounding, floating margins or elevation. Its background extends behind the system navigation area, while bottom safe-area padding keeps controls above system gestures/buttons. Active selection glides into place; Reduce Motion disables that movement. Drive’s accessible label includes recording, waiting or off state. Safe-area clearance and Android keyboard hiding remain.
- Other original screens retain their original layouts and styling.

## Liquid Glass and fallback

The new NavigationMaterial component uses expo-glass-effect ~0.1.10 and expo-blur ~15.0.8, installed with Expo SDK 54 compatibility resolution. Both package.json and the lockfile are updated.

- iPhone with iOS 26+ and a build compiled with Xcode 26+: native regular GlassView, forced light appearance, after both native availability checks pass.
- Older/unsupported iPhones: systemChromeMaterialLight BlurView.
- Reduce Transparency: solid white surface, including while the accessibility preference loads.
- Android: a bottom-fixed light surface with a top hairline and matching selection movement. It does not pretend to be native Apple Liquid Glass. SDK 54 Android native blur is experimental, so this implementation avoids it.

The shared source makes the visual revision available on both platforms. Actual glass/refraction cannot be judged from the static preview.

## Implementation

New files: components/LightSurface.tsx, components/NavigationMaterial.tsx and assets/images/car-hero.png. Changed files: components/tabs/Garage.tsx, components/tabs/Drive.tsx, components/Tabs.tsx, components/kit.tsx, components/theme.ts, app/index.tsx, mobile package.json and the root package-lock.json.

LightSurface is static react-native-svg. The car is a bundled transparent PNG (~1.7 MB), so no renderer, network image dependency or live 3D engine is needed. It was generated from the user-provided visual reference, and is not an OEM asset. Existing Manrope fonts and Ionicons are retained. Content corners remain 2–6 points; only the iOS floating navigation uses 20-point outer corners. Both platforms retain the 12-point selection surface; Android’s outer bar has square edges.

## Validation

- Mobile TypeScript: passed.
- iOS Metro/Hermes export: passed.
- Android Metro/Hermes export: passed.
- Recorder and adapter logic checked against the original archive; callbacks and actions preserved.
- Earlier visual reference prepared at 390 × 844 and 412 × 915; it predates the Android bottom-fixed revision. HTML has idle, armed and live presentation states; unavailable readings remain “—”. These are implementation references, not captured device screenshots.
- Native device testing, glass rendering and installed builds are not verified here. This Linux environment has no Android SDK or Xcode. The project’s APK build script stops with “Android SDK not found”; no APK or GitHub release was produced.

## Run this revision

From the repository root, run `npm ci`, then `npm run typecheck --workspace apps/mobile`.

Rebuild the development client because this revision adds native dependencies. From apps/mobile, run `npx expo run:ios` on a Mac or `npx expo run:android` with the Android SDK installed. Restart Metro with `npx expo start --dev-client` if needed. Use Xcode 26+ to compile the native Liquid Glass path; the fallback remains available otherwise.

For the repository’s release APK workflow, apply these changes to the real git checkout, commit there (versionCode uses commit count), then run `python scripts/build_apk.py --clean --publish` with the established SDK, signing and GitHub setup. This source archive does not contain local credentials or a git history.

Device review: switch all five tabs; rotate/resize if enabled; check each recorder state; test Reduce Motion and Reduce Transparency; inspect the dock over scrolled content, with the Android keyboard and gesture/three-button navigation; verify start/stop, upload, adapter selection and vehicle switching with real hardware. Existing native recording behavior was not changed.

"""Build the Release iOS app (apps/mobile) with xcodebuild and install it on a connected iPhone.

Usage (from the repository root, iPhone plugged in and unlocked):
    python3 scripts/build_ios.py                 # build, install and launch on the connected iPhone
    python3 scripts/build_ios.py --no-launch     # install only
    python3 scripts/build_ios.py --pods          # force `pod install` first (after native dependency changes)
    python3 scripts/build_ios.py --device NAME   # pick a phone by name or UDID when several are connected

Why this exists instead of `npx expo run:ios --device`: Expo CLI 54 refuses to start when Xcode has no Simulator.app,
and Xcode 27 no longer ships one. This runs the same build and install steps without that check.

Reads apps/mobile/.env and .env.local (both gitignored) for EXPO_PUBLIC_API_URL; the URL is baked into the bundle.
Needs: Xcode (signed in to your Apple ID, Settings > Accounts), CocoaPods, and Developer Mode on the phone.
Free Apple IDs sign for 7 days; rerun this script to renew the profile and reinstall.
"""

import argparse
import fcntl
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MOBILE = ROOT / "apps/mobile"
IOS = MOBILE / "ios"
DEFAULT_API = "https://yazzy-api-production.up.railway.app"
SCHEME = "Yazzy"
# Build output must live outside ~/Documents and ~/Desktop: when those folders sync to iCloud, macOS tags the files
# with Finder/File Provider attributes and codesign then refuses them ("resource fork, Finder information, or similar
# detritus not allowed"). Xcode's own DerivedData folder is outside them for the same reason.
BUILD_DIR = Path.home() / "Library/Caches/yazzy-ios-build"
# iOS 27 crashes at launch ("NoSceneLifecycleAdoption") for apps linked against the iOS 27 SDK that still use the old
# AppDelegate-only lifecycle, which is what Expo SDK 54 / React Native 0.81 generate. Stamping the executable with an
# older SDK version keeps iOS 27 in its compatibility mode. Dev installs only: remove this once the app adopts UIScene
# (or Expo/React Native is upgraded) and pass --no-sdk-compat to check.
COMPAT_SDK = "26.5"
MARKER = "Xcode 27 rejects pod targets below iOS 15.0"

# Xcode 27 rejects pod targets below iOS 15 (react-native-maps' privacy bundle is set to 11.0). ios/ is generated and
# gitignored, so `expo prebuild` can regenerate the Podfile without this; build() puts it back before every build.
PODFILE_ANCHOR = "      :ccache_enabled => ccache_enabled?(podfile_properties),\n    )\n  end\n"
PODFILE_FIX = """      :ccache_enabled => ccache_enabled?(podfile_properties),
    )

    # {marker}
    minimum = (podfile_properties['ios.deploymentTarget'] || '15.1').to_f
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        current = config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = minimum.to_s if current && current.to_f < minimum
      end
    end
    installer.pods_project.build_configurations.each do |config|
      current = config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
      config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = minimum.to_s if current && current.to_f < minimum
    end
  end
""".format(marker=MARKER)


def read_env_file(path: Path) -> dict:
    values = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def run(command, cwd, env=None, check=True):
    print("$", " ".join(str(part) for part in command), flush=True)
    return subprocess.run([str(part) for part in command], cwd=cwd, env=env, check=check)


def ensure_podfile_fix() -> bool:
    """Returns True when the Podfile had to be patched, which means the Pods project needs regenerating."""
    podfile = IOS / "Podfile"
    text = podfile.read_text(encoding="utf-8")
    if MARKER in text:
        return False
    if PODFILE_ANCHOR not in text:
        print("warning: could not add the iOS 15 deployment-target fix to ios/Podfile (its layout changed); "
              "the build may fail on pods set to iOS 11.", flush=True)
        return False
    podfile.write_text(text.replace(PODFILE_ANCHOR, PODFILE_FIX, 1), encoding="utf-8")
    print("Added the Xcode 27 deployment-target fix to ios/Podfile", flush=True)
    return True


def find_iphone(wanted: str | None) -> dict:
    """The connected physical iPhone/iPad as {name, udid, identifier}; exits with advice when there is not exactly one."""
    with tempfile.TemporaryDirectory() as folder:
        out = Path(folder) / "devices.json"
        subprocess.run(["xcrun", "devicectl", "list", "devices", "--json-output", str(out)],
                       check=True, capture_output=True)
        devices = json.loads(out.read_text(encoding="utf-8"))["result"]["devices"]
    phones = []
    for device in devices:
        hardware, props, link = device.get("hardwareProperties", {}), device.get("deviceProperties", {}), \
            device.get("connectionProperties", {})
        if hardware.get("platform") != "iOS" or hardware.get("reality") != "physical":
            continue
        phones.append({"name": props.get("name", "iPhone").replace("\xa0", " "), "udid": hardware.get("udid"),
                       "identifier": device.get("identifier"), "connected": link.get("tunnelState") == "connected"})
    if wanted:
        phones = [p for p in phones if wanted.lower() in p["name"].lower() or wanted == p["udid"]]
    ready = [p for p in phones if p["connected"]]
    if not ready:
        known = ", ".join(p["name"] for p in phones) or "none"
        sys.exit(f"No connected iPhone found (paired: {known}). Plug it in, unlock it and tap Trust, "
                 "and make sure Developer Mode is on (Settings > Privacy & Security).")
    if len(ready) > 1:
        sys.exit("Several iPhones are connected: " + ", ".join(p["name"] for p in ready)
                 + ". Pass --device with part of the name.")
    return ready[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--pods", action="store_true", help="run `pod install` before building")
    parser.add_argument("--no-launch", action="store_true", help="install the app but do not open it")
    parser.add_argument("--device", help="name (or part of it) or UDID of the iPhone to use")
    parser.add_argument("--no-sdk-compat", action="store_true",
                        help=f"do not stamp the app as linked against iOS {COMPAT_SDK} (it then crashes on iOS 27)")
    args = parser.parse_args()

    if sys.platform != "darwin":
        sys.exit("Building for iOS needs a Mac with Xcode.")

    file_env = {**read_env_file(MOBILE / ".env"), **read_env_file(MOBILE / ".env.local")}
    env = {**os.environ, **{k: v for k, v in file_env.items() if k not in os.environ}}
    env.setdefault("EXPO_PUBLIC_API_URL", DEFAULT_API)

    bundle_id = json.loads((MOBILE / "app.json").read_text(encoding="utf-8"))["expo"]["ios"]["bundleIdentifier"]
    phone = find_iphone(args.device)
    print(f"iPhone: {phone['name']} ({phone['udid']})  API: {env['EXPO_PUBLIC_API_URL']}", flush=True)

    if not IOS.exists():
        run(["npx", "expo", "prebuild", "--platform", "ios", "--no-install"], MOBILE, env)
    patched = ensure_podfile_fix()
    if args.pods or patched or not (IOS / "Pods").exists():
        run(["pod", "install"], IOS, env)

    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    # One build at a time: two xcodebuild runs on the same output folder fail with "database is locked".
    lock = open(BUILD_DIR / ".lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        sys.exit("Another build_ios.py run is already building. Wait for it to finish, then run this again.")

    settings = []
    if not args.no_sdk_compat:
        # -platform_version <platform> <min OS> <SDK>: keep the real minimum OS, report the older SDK.
        minimum = re.search(r"IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);",
                            (IOS / "Yazzy.xcodeproj/project.pbxproj").read_text(encoding="utf-8"))
        settings.append(f"OTHER_LDFLAGS=$(inherited) -Wl,-platform_version,ios,{minimum.group(1) if minimum else '15.1'},{COMPAT_SDK}")
    run(["xcodebuild", "-workspace", "Yazzy.xcworkspace", "-scheme", SCHEME, "-configuration", "Release",
         "-destination", f"id={phone['udid']}", "-derivedDataPath", BUILD_DIR,
         "-allowProvisioningUpdates", "-quiet", "build", *settings], IOS, env)

    app = BUILD_DIR / "Build/Products/Release-iphoneos" / f"{SCHEME}.app"
    if not app.is_dir():
        sys.exit(f"Build finished but {app} was not found.")
    run(["xcrun", "devicectl", "device", "install", "app", "--device", phone["identifier"], app], ROOT)
    print(f"\nInstalled {bundle_id} on {phone['name']}", flush=True)

    if not args.no_launch:
        opened = run(["xcrun", "devicectl", "device", "process", "launch", "--device", phone["identifier"],
                      "--terminate-existing", bundle_id], ROOT, check=False)
        if opened.returncode != 0:
            print("Installed, but it could not be opened automatically (is the phone unlocked?). Open it by hand.")


if __name__ == "__main__":
    main()

"""Build a standalone release APK of the Expo mobile app (apps/mobile).

Usage (from the repository root):
    python scripts/build_apk.py           # regenerate native project, build, copy APK to repo root
    python scripts/build_apk.py --clean   # wipe apps/mobile/android first (after native/config changes misbehave)

Reads apps/mobile/.env.local (gitignored) for GOOGLE_MAPS_API_KEY and EXPO_PUBLIC_API_URL.
Output: Yazzy-<version>.apk in the repository root (gitignored).
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MOBILE = ROOT / "apps/mobile"
ANDROID = MOBILE / "android"
DEFAULT_API = "https://yazzy-api.onrender.com"
# Phones only: skipping the x86 emulator ABIs halves native build time and APK size.
ABIS = "armeabi-v7a,arm64-v8a"


def read_env_file(path: Path) -> dict:
    values = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def find_sdk() -> Path:
    for candidate in (
        os.environ.get("ANDROID_HOME"),
        os.environ.get("ANDROID_SDK_ROOT"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Android", "Sdk"),
        os.path.expanduser("~/Library/Android/sdk"),
        os.path.expanduser("~/Android/Sdk"),
    ):
        if candidate and (Path(candidate) / "platform-tools").is_dir():
            return Path(candidate)
    sys.exit("Android SDK not found. Install platform-tools, platforms;android-36, "
             "build-tools;36.0.0, ndk;27.1.12297006 and cmake;3.22.1, or set ANDROID_HOME.")


def run(command, cwd, env):
    print("$", " ".join(command), flush=True)
    subprocess.run(command, cwd=cwd, env=env, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--clean", action="store_true", help="delete apps/mobile/android before prebuild")
    args = parser.parse_args()

    sdk = find_sdk()
    file_env = read_env_file(MOBILE / ".env.local")
    if not (os.environ.get("GOOGLE_MAPS_API_KEY") or file_env.get("GOOGLE_MAPS_API_KEY")):
        print("warning: no GOOGLE_MAPS_API_KEY; trips will show a route sketch instead of a map", flush=True)
    version_code = subprocess.run(["git", "rev-list", "--count", "HEAD"], cwd=ROOT,
                                  capture_output=True, text=True, check=True).stdout.strip()
    env = {
        **os.environ,
        **{k: v for k, v in file_env.items() if k not in os.environ},
        "ANDROID_HOME": str(sdk),
        "NODE_ENV": "production",
        "CI": "1",
        # Metro must use apps/mobile as its root; with the workspace root the Gradle
        # bundling step cannot resolve the expo-router entry on Windows.
        "EXPO_NO_METRO_WORKSPACE_ROOT": "1",
        "YAZZY_VERSION_CODE": version_code,
    }
    env.setdefault("EXPO_PUBLIC_API_URL", DEFAULT_API)

    npx = "npx.cmd" if os.name == "nt" else "npx"
    prebuild = [npx, "expo", "prebuild", "--platform", "android", "--no-install"]
    gradlew = ANDROID / ("gradlew.bat" if os.name == "nt" else "gradlew")
    if args.clean:
        # A running Gradle daemon locks build outputs on Windows, which makes --clean fail with EBUSY.
        if gradlew.exists():
            subprocess.run([str(gradlew), "--stop"], cwd=ANDROID, env=env, check=False)
        prebuild.append("--clean")
    run(prebuild, MOBILE, env)

    props = ANDROID / "gradle.properties"
    text = re.sub(r"(?m)^reactNativeArchitectures=.*$", "reactNativeArchitectures=" + ABIS,
                  props.read_text(encoding="utf-8"))
    # Compile Kotlin in short-lived processes and run Gradle without a daemon: background daemons
    # keep build outputs locked on Windows and break the next --clean.
    if "kotlin.compiler.execution.strategy" not in text:
        text = text.rstrip("\n") + "\nkotlin.compiler.execution.strategy=out-of-process\n"
    props.write_text(text, encoding="utf-8")
    sdk_path = sdk.as_posix().replace(":", "\\:")
    (ANDROID / "local.properties").write_text(f"sdk.dir={sdk_path}\n", encoding="utf-8")

    run([str(gradlew), "assembleRelease", "--no-daemon"], ANDROID, env)

    version = json.loads((MOBILE / "app.json").read_text(encoding="utf-8"))["expo"]["version"]
    built = ANDROID / "app/build/outputs/apk/release/app-release.apk"
    target = ROOT / f"Yazzy-{version}.apk"
    shutil.copyfile(built, target)
    print(f"\nAPK ready: {target}  (versionCode {version_code}, API {env['EXPO_PUBLIC_API_URL']})")


if __name__ == "__main__":
    main()

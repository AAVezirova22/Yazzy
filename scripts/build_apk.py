"""Build a standalone release APK of the Expo mobile app (apps/mobile).

Usage (from the repository root):
    python scripts/build_apk.py           # regenerate native project, build, copy APK to repo root
    python scripts/build_apk.py --clean   # wipe apps/mobile/android first (after native/config changes misbehave)
    python scripts/build_apk.py --publish # also put it on GitHub, so installed apps offer a one-tap update

--publish uploads the APK to the GitHub release `android` of this repository (never to the API or its
database) with a small manifest, yazzy-android.json, that installed apps check. It signs in to GitHub
with GITHUB_TOKEN from the environment or apps/mobile/.env.local, else with the credential git uses
to push (Git Credential Manager).
Reads apps/mobile/.env.local (gitignored) for GOOGLE_MAPS_API_KEY and EXPO_PUBLIC_API_URL.
Output: Yazzy-<version>.apk in the repository root (gitignored).
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MOBILE = ROOT / "apps/mobile"
ANDROID = MOBILE / "android"
DEFAULT_API = "https://yazzy-api-production.up.railway.app"
# Phones only: skipping the x86 emulator ABIs halves native build time and APK size.
ABIS = "armeabi-v7a,arm64-v8a"
# The GitHub release that holds the APK. Its tag is only a fixed shelf, not a source version.
RELEASE_TAG = "android"
MANIFEST = "yazzy-android.json"


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
    parser.add_argument("--publish", action="store_true", help="put the APK on GitHub for in-app updates")
    args = parser.parse_args()

    sdk = find_sdk()
    file_env = read_env_file(MOBILE / ".env.local")
    if not (os.environ.get("GOOGLE_MAPS_API_KEY") or file_env.get("GOOGLE_MAPS_API_KEY")):
        print("warning: no GOOGLE_MAPS_API_KEY; trips will show a route sketch instead of a map", flush=True)
    version_code = git("rev-list", "--count", "HEAD")
    repo = github_repo()
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
        # Where the app looks for updates (app.config.js).
        "YAZZY_UPDATES_URL": f"https://github.com/{repo}/releases/download/{RELEASE_TAG}",
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
    if args.publish:
        publish(target, env, repo, int(version_code), version)


def git(*args) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()


def github_repo() -> str:
    """owner/name of the origin remote, e.g. AAVezirova22/Yazzy."""
    match = re.search(r"github\.com[:/]([^/]+/[^/]+?)(?:\.git)?/?$", git("remote", "get-url", "origin"))
    if not match:
        sys.exit("The origin remote is not a GitHub repository; in-app updates are published to GitHub Releases.")
    return match.group(1)


def github_token(env: dict) -> str:
    token = env.get("GITHUB_TOKEN") or env.get("GH_TOKEN")
    if token:
        return token
    # The same sign-in git uses to push. Never prompt: fail instead, so the build cannot hang.
    quiet = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never"}
    result = subprocess.run(["git", "credential", "fill"], cwd=ROOT, input="protocol=https\nhost=github.com\n\n",
                            capture_output=True, text=True, env=quiet, timeout=60)
    for line in result.stdout.splitlines():
        if line.startswith("password="):
            return line[len("password="):]
    sys.exit("--publish needs GitHub access: push to GitHub once with git, or set GITHUB_TOKEN in apps/mobile/.env.local.")


class GitHub:
    def __init__(self, repo: str, token: str):
        self.repo, self.token = repo, token

    def call(self, method, url, body=None, content_type="application/json", attempts=3, missing_ok=False):
        if not url.startswith("https://"):
            url = f"https://api.github.com/repos/{self.repo}{url}"
        data = json.dumps(body).encode() if isinstance(body, dict) else body
        for attempt in range(attempts):
            request = urllib.request.Request(url, data=data, method=method, headers={
                "Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28", "Content-Type": content_type})
            try:
                with urllib.request.urlopen(request, timeout=900) as response:
                    return json.loads(response.read() or b"null")
            except urllib.error.HTTPError as error:
                if error.code == 404 and missing_ok:
                    return None
                if error.code < 500 or attempt == attempts - 1:
                    detail = error.read().decode(errors="replace")[:300]
                    hint = " (the GitHub sign-in cannot write to this repository)" if error.code in (401, 403, 404) else ""
                    sys.exit(f"Publish failed: GitHub {method} {url.split('?')[0]} -> HTTP {error.code}{hint}: {detail}")
            except (urllib.error.URLError, TimeoutError) as error:
                if attempt == attempts - 1:
                    sys.exit(f"Publish failed: {error}")
            print("  retrying...", flush=True)
            time.sleep(3 * (attempt + 1))

    def upload(self, release: dict, name: str, data: bytes, content_type: str):
        for asset in release["assets"]:
            # A failed earlier upload leaves an asset of the same name that blocks this one.
            if asset["name"] == name:
                self.delete(asset)
        url = release["upload_url"].split("{")[0] + "?" + urllib.parse.urlencode({"name": name})
        return self.call("POST", url, data, content_type, attempts=2)

    def delete(self, asset: dict):
        self.call("DELETE", f"/releases/assets/{asset['id']}", missing_ok=True)


def build_of(name: str) -> int:
    match = re.fullmatch(r"Yazzy-(\d+)\.apk", name)
    return int(match.group(1)) if match else -1


def publish(apk: Path, env: dict, repo: str, version_code: int, version: str):
    hub = GitHub(repo, github_token(env))
    data = apk.read_bytes()
    commit = git("rev-parse", "--short", "HEAD")
    release = hub.call("GET", f"/releases/tags/{RELEASE_TAG}", missing_ok=True) or hub.call("POST", "/releases", {
        "tag_name": RELEASE_TAG, "name": "Yazzy for Android", "body": "Created by scripts/build_apk.py --publish.",
        "make_latest": "true"})

    name = f"Yazzy-{version_code}.apk"
    print(f"Uploading {len(data) // 1048576} MB to GitHub release '{RELEASE_TAG}' of {repo}...", flush=True)
    hub.upload(release, name, data, "application/vnd.android.package-archive")
    manifest = {
        "versionCode": version_code, "version": version, "apk": name, "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(), "md5": hashlib.md5(data).hexdigest(),
        "commit": commit, "publishedAt": int(time.time()),
    }
    # The manifest goes up only after the APK is complete, so apps never see a build they cannot download.
    hub.upload(release, MANIFEST, json.dumps(manifest, indent=1).encode(), "application/json")
    hub.call("PATCH", f"/releases/{release['id']}", {
        "name": "Yazzy for Android", "make_latest": "true",
        "body": (f"Build {version_code} (version {version}, commit {commit}).\n\n"
                 f"Installed apps offer this update on the Home tab. To install by hand, open {name} on the phone.\n\n"
                 "Published by scripts/build_apk.py --publish; this tag is a download shelf, not a source version.")})
    # Keep the previous build too, so a download that started a moment ago can still finish.
    release = hub.call("GET", f"/releases/{release['id']}")
    older = sorted((a for a in release["assets"] if 0 <= build_of(a["name"]) < version_code),
                   key=lambda a: build_of(a["name"]), reverse=True)
    for asset in older[1:]:
        hub.delete(asset)

    # Read the manifest back the way the phone does, through GitHub's public download link.
    public = f"https://github.com/{repo}/releases/download/{RELEASE_TAG}/{MANIFEST}"
    for _ in range(10):
        try:
            with urllib.request.urlopen(urllib.request.Request(public, headers={"Cache-Control": "no-cache"}),
                                        timeout=30) as response:
                if json.loads(response.read()).get("versionCode") == version_code:
                    print(f"Published: installed apps will offer build {version_code}")
                    return
        except (urllib.error.URLError, TimeoutError, ValueError):
            pass
        time.sleep(3)
    sys.exit(f"Uploaded, but {public} does not show build {version_code} yet; run --publish again if it stays so.")


if __name__ == "__main__":
    main()

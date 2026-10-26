"""Compile actual Swift/Kotlin domain code against shared fixtures; requires native compilers."""

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
module = root / "apps/mobile/modules/yazzy-recorder"
cases = json.loads((root / "contracts/fixtures/trip-state-v1.json").read_text())[
    "cases"
]
p = argparse.ArgumentParser()
p.add_argument("--language", required=True, choices=["swift", "kotlin"])
a = p.parse_args()
compiler = shutil.which("swiftc" if a.language == "swift" else "kotlinc")
if not compiler:
    raise SystemExit(f"{a.language} compiler unavailable; native checks NOT performed")
with tempfile.TemporaryDirectory(prefix="yazzy-native-") as directory:
    d = Path(directory)
    if a.language == "swift":
        statements = ["import Foundation"]
        for i, case in enumerate(cases):
            statements.append(f"var trip{i}=TripState()")
            statements += [
                f"trip{i}.observe(time:{t}.0,speed:{s}.0,ignition:{ign}.0)"
                for t, s, ign in case["observations"]
            ]
            statements.append(
                f'precondition(trip{i}.snapshot(now:{case["observations"][-1][0]}.0)=="{case["expected"]}","{case["name"]}")'
            )
        statements += [
            'precondition(!ElmDecoder.allowed("04"))',
            'precondition(!ElmDecoder.allowed("ATZ\\r04"))',
            'precondition(ElmDecoder.decode("41 0C 1A F8",command:"010C").first?.1==1726)',
            'precondition(ElmDecoder.decode("41 0C 1A ZZ F8",command:"010C").isEmpty)',
            'print("Swift fixtures and decoder checks passed")',
        ]
        (d / "main.swift").write_text("\n".join(statements))
        subprocess.run(
            [
                compiler,
                str(module / "ios/TripState.swift"),
                str(module / "ios/ElmDecoder.swift"),
                str(d / "main.swift"),
                "-o",
                str(d / "native-test"),
            ],
            check=True,
        )
        subprocess.run([str(d / "native-test")], check=True)
    else:
        statements = ["import expo.modules.yazzyrecorder.*", "fun main(){"]
        for i, case in enumerate(cases):
            statements.append(f"val trip{i}=TripState()")
            statements += [
                f"trip{i}.observe({t}.0,{s}.0,{ign}.0)"
                for t, s, ign in case["observations"]
            ]
            statements.append(
                f'check(trip{i}.snapshot({case["observations"][-1][0]}.0)=="{case["expected"]}")'
            )
        statements += [
            'check(!ElmDecoder.allowed("04"))',
            'check(!ElmDecoder.allowed("ATZ\\r04"))',
            'check(ElmDecoder.decode("41 0C 1A F8","010C").first().second==1726.0)',
            'check(ElmDecoder.decode("41 0C 1A ZZ F8","010C").isEmpty())',
            'println("Kotlin fixtures and decoder checks passed")',
            "}",
        ]
        (d / "Main.kt").write_text("\n".join(statements))
        source = module / "android/src/main/java/expo/modules/yazzyrecorder"
        subprocess.run(
            [
                compiler,
                str(source / "TripState.kt"),
                str(source / "ElmDecoder.kt"),
                str(d / "Main.kt"),
                "-include-runtime",
                "-d",
                str(d / "native-test.jar"),
            ],
            check=True,
        )
        subprocess.run(["java", "-jar", str(d / "native-test.jar")], check=True)

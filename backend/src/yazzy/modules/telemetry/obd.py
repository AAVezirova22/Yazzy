"""Read-only ELM protocol parser, independent of Bluetooth or HTTP.

One request in flight. Call feed until a prompt arrives; never infer missing data as zero.
"""

import re

PID_SIGNALS = {
    "0C": ("ENGINE_RPM", "rpm", 2, lambda b: (256 * b[0] + b[1]) / 4),
    "0D": ("VEHICLE_SPEED", "km/h", 1, lambda b: b[0]),
    "05": ("COOLANT_TEMP", "degC", 1, lambda b: b[0] - 40),
    "0F": ("INTAKE_TEMP", "degC", 1, lambda b: b[0] - 40),
    "46": ("AMBIENT_TEMP", "degC", 1, lambda b: b[0] - 40),
    "0B": ("INTAKE_PRESSURE", "kPa", 1, lambda b: b[0]),
    "10": ("MAF", "g/s", 2, lambda b: (256 * b[0] + b[1]) / 100),
    "04": ("ENGINE_LOAD", "%", 1, lambda b: b[0] * 100 / 255),
    "11": ("THROTTLE", "%", 1, lambda b: b[0] * 100 / 255),
    "06": ("SHORT_FUEL_TRIM", "%", 1, lambda b: (b[0] - 128) * 100 / 128),
    "07": ("LONG_FUEL_TRIM", "%", 1, lambda b: (b[0] - 128) * 100 / 128),
    "2F": ("FUEL_LEVEL", "%", 1, lambda b: b[0] * 100 / 255),
    "42": ("MODULE_VOLTAGE", "V", 2, lambda b: (256 * b[0] + b[1]) / 1000),
    "5E": ("FUEL_RATE", "L/h", 2, lambda b: (256 * b[0] + b[1]) / 20),
}
SETUP = {"ATZ", "ATE0", "ATL0", "ATS1", "ATH0", "ATSP0", "ATI", "ATDP", "ATRV"}
ALLOWLIST = (
    SETUP | {"01" + p for p in PID_SIGNALS} | {"0100", "0120", "0140", "0160", "03", "07", "0A"}
)


def approved_command(command: str) -> bytes:
    command = command.strip().upper()
    if command not in ALLOWLIST:
        raise ValueError("Vehicle write or unknown command forbidden")
    return (command + "\r").encode("ascii")


class ElmFrames:
    def __init__(self):
        self.buffer = ""

    def feed(self, data: bytes) -> list[str]:
        self.buffer += data.decode("ascii", errors="replace")
        if len(self.buffer) > 8192:
            self.buffer = ""
            raise ValueError("ELM response exceeds bounded buffer")
        parts = self.buffer.split(">")
        self.buffer = parts.pop()
        return parts


def decode(response: str, command: str) -> list[dict]:
    approved_command(command)
    command = command.strip().upper()
    if command == "ATRV":
        matches = re.findall(r"(?m)^\s*(\d{1,2}\.\d{1,3})V\s*$", response)
        return [{"signal": "ADAPTER_VOLTAGE", "value": float(v), "unit": "V"} for v in matches]
    values = []
    for line in response.replace("\r", "\n").splitlines():
        line = line.strip().upper()
        if not line or line.replace(" ", "") == command or not re.fullmatch(r"[0-9A-F :]+", line):
            continue
        # Optional 11/29-bit ECU header and CAN byte count. Keep individual replies.
        words = line.split()
        ecu = None
        if words and len(words[0]) in {3, 8}:
            ecu = words.pop(0)
            if words and len(words[0]) == 2:
                words.pop(0)
        cleaned = "".join(words)
        if ":" in cleaned or len(cleaned) % 2:
            continue
        try:
            frame = bytes.fromhex(cleaned)
        except ValueError:
            continue
        if (
            command.startswith("01")
            and len(frame) >= 2
            and frame[:2] == bytes.fromhex("41" + command[2:])
        ):
            pid = command[2:]
            if pid in PID_SIGNALS:
                signal, unit, size, calc = PID_SIGNALS[pid]
                if len(frame) >= size + 2:
                    values.append(
                        {"signal": signal, "unit": unit, "value": calc(frame[2:]), "ecu": ecu}
                    )
            elif len(frame) >= 6:
                mask = int.from_bytes(frame[2:6], "big")
                supported = [
                    f"{int(pid, 16) + n + 1:02X}" for n in range(32) if mask & (1 << (31 - n))
                ]
                values.append({"supportedPids": supported, "ecu": ecu})
        elif command in {"03", "07", "0A"} and frame and frame[0] == int(command, 16) + 64:
            for a, b in zip(frame[1::2], frame[2::2], strict=False):
                if a or b:
                    values.append(
                        {
                            "signal": "DTC",
                            "unit": "code",
                            "value": f"{'PCBU'[a >> 6]}{(a >> 4) & 3}{a & 15:X}{b:02X}",
                            "ecu": ecu,
                        }
                    )
    return values

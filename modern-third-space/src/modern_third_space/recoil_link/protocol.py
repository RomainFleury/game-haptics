"""
Radio packet and USB line codec for the Recoil Link dongle.

Byte layout matches recoil-link/firmware/common/recoil_protocol.h.
The frozen vectors are checked by the firmware at boot and by
tests/test_recoil_link_protocol.py.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

PACKET_LEN = 12
MAGIC_TX = 0xA5
MAGIC_ACK = 0x5A
VERSION = 1

CMD_PULSE = 1
CMD_ON = 2
CMD_OFF = 3
CMD_STOP = 4
CMD_PING = 5

FLAG_CLAMPED = 1 << 0
FLAG_DUPLICATE = 1 << 1
FLAG_DROPPED = 1 << 2
FLAG_THERMAL = 1 << 3

MIN_PULSE_MS = 5
MAX_PULSE_MS = 100
MIN_OFF_MS = 20
LEASE_MS = 350
MAX_CONTINUOUS_ON_MS = 1000
THERMAL_COOL_MS = 500
LEASE_REFRESH_S = 0.15

RF_CHANNEL = 76
PRODUCT_NAME = "Recoil Link TX"

_OK_RE = re.compile(r"^OK (\d+) (\d+) (\d+) (\d+) (\d+)\s*$")
_ERR_RE = re.compile(r"^ERR (\w+)\s*$")


def xor_checksum(body: bytes) -> int:
    value = 0
    for byte in body:
        value ^= byte
    return value & 0xFF


def clamp_pulse_ms(duration_ms: int) -> int:
    return max(MIN_PULSE_MS, min(MAX_PULSE_MS, int(duration_ms)))


def pack_tx(command: int, output: int, sequence: int, duration_ms: int = 0) -> bytes:
    raw = bytearray(PACKET_LEN)
    raw[0] = MAGIC_TX
    raw[1] = VERSION
    raw[2] = command & 0xFF
    raw[3] = output & 0xFF
    raw[4] = sequence & 0xFF
    raw[5] = (sequence >> 8) & 0xFF
    raw[6] = duration_ms & 0xFF
    raw[7] = (duration_ms >> 8) & 0xFF
    raw[11] = xor_checksum(raw[:11])
    return bytes(raw)


def unpack_tx(data: bytes) -> Optional[dict]:
    if len(data) < PACKET_LEN:
        return None
    if data[0] != MAGIC_TX or data[1] != VERSION:
        return None
    if data[11] != xor_checksum(data[:11]):
        return None
    if not CMD_PULSE <= data[2] <= CMD_PING:
        return None
    return {
        "command": data[2],
        "output": data[3],
        "sequence": data[4] | (data[5] << 8),
        "duration_ms": data[6] | (data[7] << 8),
    }


def pack_ack(command: int, state: int, sequence: int, flags: int = 0) -> bytes:
    raw = bytearray(PACKET_LEN)
    raw[0] = MAGIC_ACK
    raw[1] = VERSION
    raw[2] = command & 0xFF
    raw[3] = 1 if state else 0
    raw[4] = sequence & 0xFF
    raw[5] = (sequence >> 8) & 0xFF
    raw[6] = flags & 0xFF
    raw[11] = xor_checksum(raw[:11])
    return bytes(raw)


def format_command(op: str, output: int = 0, duration_ms: Optional[int] = None) -> bytes:
    name = op.strip().upper()
    if name == "PULSE":
        if duration_ms is None:
            raise ValueError("PULSE requires duration_ms")
        return f"PULSE {int(output)} {int(duration_ms)}\n".encode("ascii")
    if name in ("ON", "OFF"):
        return f"{name} {int(output)}\n".encode("ascii")
    if name in ("STOP", "PING"):
        return f"{name}\n".encode("ascii")
    raise ValueError(f"unknown command {op}")


@dataclass
class LineResult:
    ok: bool
    seq: int = 0
    state: int = 0
    millivolts: int = 0
    flags: int = 0
    ack_seq: int = 0
    error: Optional[str] = None
    raw: str = ""


def parse_line(line: str) -> LineResult:
    text = line.strip()
    ok_match = _OK_RE.match(text)
    if ok_match:
        seq, state, mv, flags, ack_seq = (int(part) for part in ok_match.groups())
        return LineResult(
            ok=True,
            seq=seq,
            state=state,
            millivolts=mv,
            flags=flags,
            ack_seq=ack_seq,
            raw=text,
        )
    err_match = _ERR_RE.match(text)
    if err_match:
        return LineResult(ok=False, error=err_match.group(1), raw=text)
    return LineResult(ok=False, error="BAD_LINE", raw=text)

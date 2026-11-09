"""Unit tests for the Recoil Link packet layout and dongle line codec."""

from __future__ import annotations

from modern_third_space.recoil_link.protocol import (
    FLAG_THERMAL,
    LEASE_MS,
    MAX_CONTINUOUS_ON_MS,
    MAX_PULSE_MS,
    MIN_OFF_MS,
    MIN_PULSE_MS,
    THERMAL_COOL_MS,
    clamp_pulse_ms,
    format_command,
    pack_ack,
    pack_tx,
    parse_line,
    unpack_tx,
)


def test_frozen_pulse_vector_matches_firmware_self_test():
    raw = pack_tx(command=1, output=0, sequence=1, duration_ms=25)
    assert raw.hex() == "a501010001001900000000bd"
    decoded = unpack_tx(raw)
    assert decoded == {"command": 1, "output": 0, "sequence": 1, "duration_ms": 25}


def test_frozen_ack_vector():
    raw = pack_ack(command=1, state=1, sequence=1, flags=0)
    assert raw.hex() == "5a010101010000000000005a"


def test_bad_checksum_is_rejected():
    raw = bytearray(pack_tx(command=1, output=0, sequence=1, duration_ms=25))
    raw[11] ^= 0xFF
    assert unpack_tx(bytes(raw)) is None


def test_limits_match_receiver_header():
    assert MIN_PULSE_MS == 5
    assert MAX_PULSE_MS == 100
    assert MIN_OFF_MS == 20
    assert LEASE_MS == 350
    assert MAX_CONTINUOUS_ON_MS == 20000
    assert THERMAL_COOL_MS == 10000
    assert clamp_pulse_ms(1) == 5
    assert clamp_pulse_ms(25) == 25
    assert clamp_pulse_ms(400) == 100


def test_usb_lines():
    assert format_command("pulse", duration_ms=25) == b"PULSE 0 25\n"
    assert format_command("ON") == b"ON 0\n"
    assert format_command("stop") == b"STOP\n"
    ok = parse_line("OK 4 1 0 8 3\n")
    assert ok.ok and ok.seq == 4 and ok.state == 1 and ok.flags == FLAG_THERMAL and ok.ack_seq == 3
    err = parse_line("ERR TIMEOUT\n")
    assert not err.ok and err.error == "TIMEOUT"


class _FakeSerial:
    def __init__(self) -> None:
        self.is_open = True
        self.written: list[bytes] = []
        self.response = b"OK 1 0 0 0 0\n"

    def write(self, data: bytes) -> int:
        self.written.append(bytes(data))
        return len(data)

    def flush(self) -> None:
        return None

    def readline(self) -> bytes:
        if self.written and self.written[-1].startswith(b"PULSE"):
            return b"OK 7 1 0 0 6\n"
        return self.response

    def close(self) -> None:
        self.is_open = False


def test_link_pulse_sends_one_clamped_command_and_does_not_retry():
    from modern_third_space.recoil_link.link import RecoilLink

    fake = _FakeSerial()
    link = RecoilLink()
    link.connect("COM9", opener=lambda _port: fake, settle_s=0)
    result = link.pulse(2)
    assert result.ok and result.seq == 7 and result.state == 1
    pulses = [payload for payload in fake.written if payload.startswith(b"PULSE")]
    assert pulses == [b"PULSE 0 5\n"]
    link.disconnect(stop=False)
    assert fake.written[-1] == b"PULSE 0 5\n"
    assert not fake.is_open


def test_pulse_cancels_on_hold():
    import time

    from modern_third_space.recoil_link.link import RecoilLink

    fake = _FakeSerial()
    link = RecoilLink()
    link.connect("COM9", opener=lambda _port: fake, settle_s=0)
    assert link.set_hold(True).ok
    result = link.pulse(25)
    assert result.ok
    assert link._holding is False
    time.sleep(0.4)
    assert fake.written[-1] == b"PULSE 0 25\n"
    link.disconnect(stop=False)

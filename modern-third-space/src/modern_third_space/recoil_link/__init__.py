"""Wireless solenoid recoil link (nRF52840 dongle + receiver)."""

from .link import LinkStatus, RecoilLink, list_recoil_ports
from .protocol import (
    MAX_PULSE_MS,
    MIN_PULSE_MS,
    PRODUCT_NAME,
    clamp_pulse_ms,
    format_command,
    pack_tx,
    parse_line,
)

__all__ = [
    "LinkStatus",
    "MAX_PULSE_MS",
    "MIN_PULSE_MS",
    "PRODUCT_NAME",
    "RecoilLink",
    "clamp_pulse_ms",
    "format_command",
    "list_recoil_ports",
    "pack_tx",
    "parse_line",
]

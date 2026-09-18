"""
USB LC relay controller for solenoid / recoil prototyping.

Opens a serial port and sends the 4-byte LC protocol frames.
Pulse helpers turn the relay on briefly then off (safe for solenoids).

Safety:
- Pulses are clamped to >= 25 ms (hardware often misses OFF below that)
- Fire pulses arm a 1.0 s safety timer that forces OFF
- Reload holds use a longer window (RELOAD_HOLD_SAFETY_S), hard-capped at MAX_SAFETY_OFF_S
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

from .discovery import list_ports
from .protocol import DEFAULT_ADDRESS, DEFAULT_BAUD, build_frame
from .recoil import MIN_RECOIL_MS, MAX_ON_MS

logger = logging.getLogger(__name__)

SAFETY_OFF_S = 1.0
# Empty-slide reload can sit locked for several seconds before cock_forward / SetSlideBack.
# Keep a hard cap so a missed release event cannot leave the solenoid energized forever.
RELOAD_HOLD_SAFETY_S = 30.0
MAX_SAFETY_OFF_S = 30.0


@dataclass
class RelayStatus:
    """Snapshot of relay connection state."""

    connected: bool
    port: Optional[str] = None
    baud: int = DEFAULT_BAUD
    address: int = DEFAULT_ADDRESS
    is_on: bool = False
    last_error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "connected": self.connected,
            "port": self.port,
            "baud": self.baud,
            "address": self.address,
            "is_on": self.is_on,
            "last_error": self.last_error,
        }


class RelayController:
    """Thread-safe USB LC relay controller with 1s safety OFF."""

    def __init__(self) -> None:
        self._serial = None
        self._port: Optional[str] = None
        self._baud: int = DEFAULT_BAUD
        self._address: int = DEFAULT_ADDRESS
        self._is_on: bool = False
        self._last_error: Optional[str] = None
        self._lock = threading.RLock()
        self._safety_timer: Optional[threading.Timer] = None

    def status(self) -> RelayStatus:
        with self._lock:
            return RelayStatus(
                connected=self._serial is not None and getattr(self._serial, "is_open", False),
                port=self._port,
                baud=self._baud,
                address=self._address,
                is_on=self._is_on,
                last_error=self._last_error,
            )

    def connect(
        self,
        port: str,
        baud: int = DEFAULT_BAUD,
        address: int = DEFAULT_ADDRESS,
    ) -> None:
        """Open the serial port for the relay module."""
        if not port:
            raise ValueError("port is required")
        if baud <= 0:
            raise ValueError(f"baud must be positive, got {baud}")
        if not 0 <= address <= 0xFF:
            raise ValueError(f"address must be 0-255, got {address}")

        try:
            import serial
        except ImportError as exc:
            raise RuntimeError(
                "pyserial is required for USB relay support. Install with: pip install pyserial"
            ) from exc

        with self._lock:
            self.disconnect()
            try:
                self._serial = serial.Serial(
                    port=port,
                    baudrate=baud,
                    bytesize=serial.EIGHTBITS,
                    parity=serial.PARITY_NONE,
                    stopbits=serial.STOPBITS_ONE,
                    timeout=1.0,
                    write_timeout=1.0,
                )
                # Give the USB-UART bridge a moment after open.
                time.sleep(0.05)
                self._port = port
                self._baud = baud
                self._address = address
                self._is_on = False
                self._last_error = None
                logger.info("Relay connected on %s @ %s baud (addr=0x%02X)", port, baud, address)
            except Exception as exc:
                self._serial = None
                self._port = None
                self._last_error = str(exc)
                raise

    def disconnect(self) -> None:
        """Close the serial port (best-effort OFF first)."""
        with self._lock:
            self._cancel_safety_off()
            if self._serial is not None:
                try:
                    if self._is_on:
                        self._write_frame(False)
                except Exception:
                    pass
                try:
                    self._serial.close()
                except Exception:
                    pass
            self._serial = None
            self._port = None
            self._is_on = False

    def set(self, on: bool, *, safety_s: Optional[float] = None) -> None:
        """
        Turn the relay on or off.

        When turning ON, arms a safety OFF timer (default SAFETY_OFF_S, overridable
        via safety_s, capped at MAX_SAFETY_OFF_S).
        """
        with self._lock:
            self._ensure_connected()
            self._write_frame(on)
            self._is_on = on
            if on:
                timeout = SAFETY_OFF_S if safety_s is None else float(safety_s)
                if timeout < SAFETY_OFF_S:
                    timeout = SAFETY_OFF_S
                if timeout > MAX_SAFETY_OFF_S:
                    timeout = MAX_SAFETY_OFF_S
                self._arm_safety_off(timeout)
            else:
                self._cancel_safety_off()

    def on(self) -> None:
        self.set(True)

    def off(self) -> None:
        self.set(False)

    def pulse(self, duration_ms: int = 40) -> None:
        """
        Activate the relay briefly for recoil-style feedback.

        Turns ON, waits duration_ms, then turns OFF.
        Duration is clamped to [MIN_RECOIL_MS, MAX_ON_MS] (25–1000 ms).
        A 1s safety OFF is armed for the ON window.
        """
        duration_ms = int(duration_ms)
        if duration_ms < MIN_RECOIL_MS:
            duration_ms = MIN_RECOIL_MS
        if duration_ms > MAX_ON_MS:
            duration_ms = MAX_ON_MS

        with self._lock:
            self._ensure_connected()
            self._write_frame(True)
            self._is_on = True
            self._arm_safety_off(SAFETY_OFF_S)
            try:
                time.sleep(duration_ms / 1000.0)
            finally:
                try:
                    self._write_frame(False)
                finally:
                    self._is_on = False
                    self._cancel_safety_off()

    def _arm_safety_off(self, timeout_s: float = SAFETY_OFF_S) -> None:
        """Schedule a forced OFF after timeout_s (must hold lock)."""
        self._cancel_safety_off()
        timeout_s = float(timeout_s)

        def _fire() -> None:
            try:
                with self._lock:
                    if self._serial is None or not self._is_on:
                        return
                    self._write_frame(False)
                    self._is_on = False
                    self._safety_timer = None
                    logger.warning(
                        "Relay safety OFF after %.1fs — forced de-energize",
                        timeout_s,
                    )
            except Exception as exc:
                logger.warning("Relay safety OFF failed: %s", exc)

        timer = threading.Timer(timeout_s, _fire)
        timer.daemon = True
        self._safety_timer = timer
        timer.start()

    def _cancel_safety_off(self) -> None:
        timer = self._safety_timer
        self._safety_timer = None
        if timer is not None:
            timer.cancel()

    def _ensure_connected(self) -> None:
        if self._serial is None or not getattr(self._serial, "is_open", False):
            raise RuntimeError("Relay is not connected")

    def _write_frame(self, on: bool) -> None:
        assert self._serial is not None
        frame = build_frame(on, self._address)
        try:
            written = self._serial.write(frame)
            self._serial.flush()
            if written != len(frame):
                raise RuntimeError(f"Incomplete write: {written}/{len(frame)} bytes")
            self._last_error = None
            logger.debug("Relay frame sent: %s", frame.hex(" ").upper())
        except Exception as exc:
            self._last_error = str(exc)
            raise


__all__ = [
    "RelayController",
    "RelayStatus",
    "list_ports",
    "DEFAULT_ADDRESS",
    "DEFAULT_BAUD",
    "SAFETY_OFF_S",
]

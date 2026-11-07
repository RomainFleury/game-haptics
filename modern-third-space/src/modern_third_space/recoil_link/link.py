"""
USB CDC session to the Recoil Link dongle.

Pulse timing happens on the receiver. This class sends one PULSE and returns
as soon as the dongle reports delivery. It does not retry PULSE: a lost ack
can mean the receiver already started the stroke.

ON is a lease. A background refresh keeps the receiver's 350 ms window alive.
The receiver still drops the coil after 1 s continuous and cools for 500 ms.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

from ..relay.discovery import list_ports
from .protocol import (
    LEASE_REFRESH_S,
    PRODUCT_NAME,
    clamp_pulse_ms,
    format_command,
    parse_line,
    LineResult,
)

logger = logging.getLogger(__name__)

Opener = Callable[[str], Any]


def _port_blob(port: Dict[str, Any]) -> str:
    return " ".join(
        str(port.get(key) or "")
        for key in ("description", "manufacturer", "product", "hwid")
    ).lower()


def list_recoil_ports() -> List[Dict[str, Any]]:
    """Serial ports, with likely_recoil set on the Recoil Link dongle."""
    ports = list_ports()
    needle = PRODUCT_NAME.lower()
    for port in ports:
        port["likely_recoil"] = needle in _port_blob(port)
    ports.sort(key=lambda port: (0 if port.get("likely_recoil") else 1, port.get("device") or ""))
    return ports


@dataclass
class LinkStatus:
    connected: bool
    port: Optional[str] = None
    holding: bool = False
    last_error: Optional[str] = None
    last_seq: int = 0
    output_on: bool = False
    flags: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "connected": self.connected,
            "port": self.port,
            "holding": self.holding,
            "last_error": self.last_error,
            "last_seq": self.last_seq,
            "output_on": self.output_on,
            "flags": self.flags,
            "product": PRODUCT_NAME,
        }


def _open_serial(port: str):
    import serial

    return serial.Serial(
        port=port,
        baudrate=115200,
        timeout=0.08,
        write_timeout=0.3,
    )


class RecoilLink:
    """Thread-safe session to one dongle. output index is always 0."""

    def __init__(self) -> None:
        self._serial = None
        self._port: Optional[str] = None
        self._lock = threading.RLock()
        self._last_error: Optional[str] = None
        self._last = LineResult(ok=False)
        self._holding = False
        self._lease_stop = threading.Event()
        self._lease_thread: Optional[threading.Thread] = None

    def status(self) -> LinkStatus:
        with self._lock:
            connected = self._serial is not None and bool(getattr(self._serial, "is_open", False))
            return LinkStatus(
                connected=connected,
                port=self._port,
                holding=self._holding,
                last_error=self._last_error,
                last_seq=self._last.seq,
                output_on=bool(self._last.state) if self._last.ok else False,
                flags=self._last.flags,
            )

    def connect(
        self,
        port: str,
        *,
        opener: Optional[Opener] = None,
        settle_s: float = 0.2,
    ) -> None:
        if not port:
            raise ValueError("port is required")
        open_port = opener or _open_serial
        self.disconnect()
        with self._lock:
            try:
                self._serial = open_port(port)
                self._port = port
                self._last_error = None
            except Exception as exc:
                self._serial = None
                self._port = None
                self._last_error = str(exc)
                raise
        if settle_s > 0:
            time.sleep(settle_s)
        result = self.ping()
        if not result.ok:
            error = result.error or "PING failed"
            self.disconnect()
            raise RuntimeError(error)

    def disconnect(self, *, stop: bool = True) -> None:
        self._stop_lease()
        with self._lock:
            serial = self._serial
            self._serial = None
            self._port = None
            self._holding = False
            if serial is not None:
                try:
                    if stop and getattr(serial, "is_open", False):
                        serial.write(format_command("STOP"))
                        if hasattr(serial, "flush"):
                            serial.flush()
                except Exception:
                    pass
                try:
                    serial.close()
                except Exception:
                    pass

    def ping(self) -> LineResult:
        return self._exchange("PING")

    def pulse(self, duration_ms: int) -> LineResult:
        """Send one PULSE. Does not wait out the stroke and does not retry."""
        return self._exchange("PULSE", duration_ms=clamp_pulse_ms(duration_ms))

    def set_hold(self, on: bool) -> LineResult:
        """
        Hold the coil with a refreshed ON lease, or release it.

        The receiver duty-cycles a long hold (1 s on, 500 ms cool) so the
        JF-0826B cannot stay energized for the whole reload.
        """
        if on:
            result = self._exchange("ON")
            if not result.ok:
                result = self._exchange("ON")
            if result.ok:
                self._start_lease()
            return result
        self._stop_lease()
        result = self._exchange("OFF")
        if not result.ok:
            result = self._exchange("STOP")
        return result

    def stop(self) -> LineResult:
        self._stop_lease()
        return self._exchange("STOP")

    def _start_lease(self) -> None:
        with self._lock:
            self._holding = True
            self._lease_stop.clear()
            if self._lease_thread is not None and self._lease_thread.is_alive():
                return
            self._lease_thread = threading.Thread(
                target=self._lease_loop,
                name="recoil-lease",
                daemon=True,
            )
            self._lease_thread.start()

    def _stop_lease(self) -> None:
        thread = None
        with self._lock:
            self._holding = False
            self._lease_stop.set()
            thread = self._lease_thread
            self._lease_thread = None
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=1.0)

    def _lease_loop(self) -> None:
        while not self._lease_stop.wait(LEASE_REFRESH_S):
            with self._lock:
                if not self._holding or self._serial is None:
                    return
            try:
                result = self._exchange("ON")
            except Exception as exc:
                logger.warning("Recoil lease refresh failed: %s", exc)
                continue
            if not result.ok:
                logger.warning("Recoil lease refresh rejected: %s", result.error)

    def _exchange(self, op: str, duration_ms: Optional[int] = None) -> LineResult:
        with self._lock:
            self._ensure_open()
            try:
                payload = format_command(op, 0, duration_ms)
                self._serial.write(payload)
                if hasattr(self._serial, "flush"):
                    self._serial.flush()
                raw = self._serial.readline()
            except Exception as exc:
                self._last_error = str(exc)
                self._last = LineResult(ok=False, error=str(exc))
                raise
            if isinstance(raw, bytes):
                text = raw.decode("ascii", errors="replace")
            else:
                text = str(raw or "")
            result = parse_line(text)
            if not text.strip():
                result = LineResult(ok=False, error="TIMEOUT", raw="")
            self._last = result
            self._last_error = None if result.ok else result.error
            return result

    def _ensure_open(self) -> None:
        if self._serial is None or not getattr(self._serial, "is_open", False):
            raise RuntimeError("recoil link is not connected")

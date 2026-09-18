"""
Gunman Contracts Standalone integration manager.

A MelonLoader mod in the game connects to the daemon as a TCP client and sends
`gunmancontracts_event` commands. This manager maps those events to vest cells and
optional USB-relay solenoid recoil.

Harmony hooks are adapted from:
https://github.com/floh-bhaptics/GunmanContracts_bhaptics

Solenoid recoil inspiration (fire + dual wield; no public source):
https://github.com/Astienth/GunmanContracts_Provolver
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from ..relay.recoil import (
    DEFAULT_RECOIL_MS,
    duration_ms_for_weapon,
    parse_solenoid_settings,
)
from ..vest.cell_layout import (
    LEFT_ARM,
    LEFT_SIDE,
    LOWER_CELLS,
    RIGHT_ARM,
    RIGHT_SIDE,
    Cell,
)

logger = logging.getLogger(__name__)

GameEventCallback = Callable[[str, dict], None]
TriggerCallback = Callable[[int, int], None]
RecoilCallback = Callable[[int], None]
RecoilHoldCallback = Callable[[bool], None]

_FIRE_RECOIL_EVENTS = {
    "gun_fire": "pistol",
    "shotgun_fire": "shotgun",
    "rifle_fire": "rifle",
}

# Solenoid hold: slide_lock (OnOutOfAmmo) → ON; slide_release (SetSlideBack(0)) or
# cock_forward (OnCockingHandleReleased at real slide-forward) → OFF.
# Do not end hold on FPSReleaseSlide — that fires at reload button press.
_RELOAD_HOLD_START_EVENTS = frozenset({"slide_lock"})
_RELOAD_HOLD_END_EVENTS = frozenset({"slide_release", "cock_forward"})

# Toggle keys shown in the UI / passed via enabled_events on start.
DEFAULT_ENABLED_EVENTS: Dict[str, bool] = {
    "gun_fire": True,
    "shotgun_fire": True,
    "rifle_fire": True,
    "bow_fire": True,
    "player_hit": True,
    "holster_in": True,
    "holster_out": True,
    "mag_eject": True,
    "reload": True,
    "cock_back": True,
    "cock_forward": True,
    "slide_lock": True,
    "slide_release": True,
    "ammo_pouch": True,
    "heartbeat": True,
    "healing": True,
}

# Internal control events map onto the heartbeat / healing toggles.
_EVENT_TOGGLE_ALIASES: Dict[str, str] = {
    "heartbeat_start": "heartbeat",
    "heartbeat_stop": "heartbeat",
}

_HEARTBEAT_INTERVAL_S = 1.0


@dataclass
class GunmanContractsEvent:
    """Parsed event from the Gunman Contracts MelonLoader mod."""

    type: str
    raw: str = ""
    params: Dict[str, Any] = field(default_factory=dict)
    timestamp: float = 0.0

    def __post_init__(self) -> None:
        if self.timestamp == 0.0:
            self.timestamp = time.time()


def normalize_enabled_events(raw: Optional[Dict[str, Any]]) -> Dict[str, bool]:
    """Merge a partial enabled_events payload with defaults (all True)."""
    enabled = dict(DEFAULT_ENABLED_EVENTS)
    if isinstance(raw, dict):
        for key, value in raw.items():
            if isinstance(key, str) and key in enabled:
                enabled[key] = bool(value)
    return enabled


def toggle_key_for_event(event_type: str) -> str:
    """Map a raw event name to its UI / enabled_events toggle key."""
    return _EVENT_TOGGLE_ALIASES.get(event_type, event_type)


def _hand_is_left(hand: Optional[str]) -> Optional[bool]:
    raw = str(hand or "").strip().lower()
    if raw in ("left", "l"):
        return True
    if raw in ("right", "r"):
        return False
    return None


def cells_for_hit_angle(angle: Optional[float]) -> List[int]:
    """
    Map bHaptics-style hit rotation to vest cells.

    0° is front, 90° is left, 180° is back, 270° is right.
    """
    if angle is None:
        return [Cell.FRONT_UPPER_LEFT, Cell.FRONT_UPPER_RIGHT]
    try:
        a = float(angle) % 360.0
    except (TypeError, ValueError):
        return [Cell.FRONT_UPPER_LEFT, Cell.FRONT_UPPER_RIGHT]
    if a < 0:
        a += 360.0
    if a < 45.0 or a >= 315.0:
        return [Cell.FRONT_UPPER_LEFT, Cell.FRONT_UPPER_RIGHT]
    if a < 135.0:
        return list(LEFT_SIDE)
    if a < 225.0:
        return [Cell.BACK_UPPER_LEFT, Cell.BACK_UPPER_RIGHT]
    return list(RIGHT_SIDE)


def map_event_to_haptics(event: GunmanContractsEvent) -> List[Tuple[int, int]]:
    """Map a Gunman Contracts event to vest (cell, speed) commands."""
    event_type = str(event.type or "")
    hand_left = _hand_is_left(event.params.get("hand"))
    angle = event.params.get("angle")
    holster = str(event.params.get("holster") or "hip").strip().lower()
    commands: List[Tuple[int, int]] = []

    if event_type == "gun_fire":
        speed = 5
        cells = LEFT_ARM if hand_left else RIGHT_ARM if hand_left is False else LEFT_ARM + RIGHT_ARM
        commands.extend((cell, speed) for cell in cells)

    elif event_type == "shotgun_fire":
        speed = 8
        if hand_left is True:
            cells = list(LEFT_SIDE)
        elif hand_left is False:
            cells = list(RIGHT_SIDE)
        else:
            cells = list(LEFT_SIDE) + list(RIGHT_SIDE)
        commands.extend((cell, speed) for cell in cells)

    elif event_type == "rifle_fire":
        speed = 6
        cells = LEFT_ARM if hand_left else RIGHT_ARM if hand_left is False else LEFT_ARM + RIGHT_ARM
        commands.extend((cell, speed) for cell in cells)

    elif event_type == "bow_fire":
        speed = 5
        cells = LEFT_ARM if hand_left else RIGHT_ARM if hand_left is False else LEFT_ARM + RIGHT_ARM
        commands.extend((cell, speed) for cell in cells)

    elif event_type == "player_hit":
        hit_angle = angle if isinstance(angle, (int, float)) else None
        commands.extend((cell, 7) for cell in cells_for_hit_angle(hit_angle))

    elif event_type in ("holster_in", "holster_out"):
        speed = 3
        if holster == "shoulder":
            if hand_left is True:
                commands.append((Cell.BACK_UPPER_LEFT, speed))
            elif hand_left is False:
                commands.append((Cell.BACK_UPPER_RIGHT, speed))
            else:
                commands.append((Cell.BACK_UPPER_LEFT, speed))
                commands.append((Cell.BACK_UPPER_RIGHT, speed))
        else:
            # hip (default)
            if hand_left is True:
                commands.append((Cell.FRONT_LOWER_LEFT, speed))
            elif hand_left is False:
                commands.append((Cell.FRONT_LOWER_RIGHT, speed))
            else:
                commands.append((Cell.FRONT_LOWER_LEFT, speed))
                commands.append((Cell.FRONT_LOWER_RIGHT, speed))

    elif event_type == "mag_eject":
        speed = 4
        cells = LEFT_ARM if hand_left else RIGHT_ARM if hand_left is False else LEFT_ARM + RIGHT_ARM
        commands.extend((cell, speed) for cell in cells)

    elif event_type == "reload":
        speed = 4
        if hand_left is True:
            commands.append((Cell.FRONT_LOWER_LEFT, speed))
        elif hand_left is False:
            commands.append((Cell.FRONT_LOWER_RIGHT, speed))
        else:
            commands.append((Cell.FRONT_LOWER_LEFT, speed))
            commands.append((Cell.FRONT_LOWER_RIGHT, speed))

    elif event_type in ("cock_back", "cock_forward", "slide_lock", "slide_release"):
        speed = 3
        cells = LEFT_ARM if hand_left else RIGHT_ARM if hand_left is False else LEFT_ARM + RIGHT_ARM
        commands.extend((cell, speed) for cell in cells)

    elif event_type == "ammo_pouch":
        commands.append((Cell.FRONT_UPPER_LEFT, 3))
        commands.append((Cell.FRONT_UPPER_RIGHT, 3))

    elif event_type == "heartbeat":
        commands.append((Cell.FRONT_LOWER_LEFT, 2))
        commands.append((Cell.FRONT_LOWER_RIGHT, 2))

    elif event_type == "healing":
        commands.extend((cell, 4) for cell in LOWER_CELLS)

    # heartbeat_start / heartbeat_stop are control-only (no one-shot cells)
    return commands


class GunmanContractsManager:
    """
    TCP-client handler for Gunman Contracts Standalone.

    Start/stop enable processing so stray events do nothing until armed.
    """

    def __init__(
        self,
        on_game_event: Optional[GameEventCallback] = None,
        on_trigger: Optional[TriggerCallback] = None,
        on_recoil: Optional[RecoilCallback] = None,
        on_recoil_hold: Optional[RecoilHoldCallback] = None,
    ) -> None:
        self.on_game_event = on_game_event
        self.on_trigger = on_trigger
        self.on_recoil = on_recoil
        self.on_recoil_hold = on_recoil_hold
        self._enabled = False
        self.events_received = 0
        self.last_event_ts: Optional[float] = None
        self.last_event_type: Optional[str] = None
        self._solenoid_enabled = True
        self._solenoid_recoil_ms = DEFAULT_RECOIL_MS
        self._solenoid_hold_on_reload = False
        self._reload_hold_active = False
        self._enabled_events: Dict[str, bool] = dict(DEFAULT_ENABLED_EVENTS)
        self._heartbeat_stop = threading.Event()
        self._heartbeat_thread: Optional[threading.Thread] = None
        self._heartbeat_lock = threading.Lock()

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def is_running(self) -> bool:
        return self._enabled

    @property
    def enabled_events(self) -> Dict[str, bool]:
        return dict(self._enabled_events)

    def is_event_enabled(self, event_type: str) -> bool:
        key = toggle_key_for_event(event_type)
        if key not in self._enabled_events:
            # Unknown events are ignored for haptics but still logged upstream.
            return False
        return bool(self._enabled_events.get(key, False))

    def enable(
        self,
        solenoid_recoil: Optional[Dict[str, Any]] = None,
        enabled_events: Optional[Dict[str, Any]] = None,
    ) -> None:
        settings = parse_solenoid_settings(solenoid_recoil)
        self._solenoid_enabled = bool(settings["enabled"])
        self._solenoid_recoil_ms = int(settings["duration_ms"])
        self._solenoid_hold_on_reload = bool(settings.get("hold_on_reload", False))
        self._enabled_events = normalize_enabled_events(enabled_events)
        self._enabled = True
        logger.info(
            "[gunmancontracts] enabled (solenoid_recoil=%s duration_ms=%s hold_on_reload=%s enabled_events=%s)",
            self._solenoid_enabled,
            self._solenoid_recoil_ms,
            self._solenoid_hold_on_reload,
            self._enabled_events,
        )

    def disable(self) -> None:
        self._stop_heartbeat()
        self._set_reload_hold(False)
        self._enabled = False
        logger.info("[gunmancontracts] disabled")

    def start(
        self,
        solenoid_recoil: Optional[Dict[str, Any]] = None,
        enabled_events: Optional[Dict[str, Any]] = None,
    ) -> Tuple[bool, Optional[str]]:
        self.enable(solenoid_recoil, enabled_events=enabled_events)
        return True, None

    def stop(self) -> bool:
        self.disable()
        return True

    def process_event(
        self,
        event_name: str,
        hand: Optional[str] = None,
        priority: int = 0,
        angle: Optional[float] = None,
        weapon: Optional[str] = None,
        holster: Optional[str] = None,
    ) -> bool:
        """Handle one gunmancontracts_event from the game mod. Returns False if ignored."""
        if not self._enabled:
            return False
        name = str(event_name or "").strip()
        if not name:
            return False

        params: Dict[str, Any] = {"priority": int(priority or 0)}
        if hand:
            params["hand"] = str(hand)
        if angle is not None:
            try:
                params["angle"] = float(angle)
            except (TypeError, ValueError):
                pass
        if weapon:
            params["weapon"] = str(weapon)
        if holster:
            params["holster"] = str(holster)

        event = GunmanContractsEvent(type=name, raw=name, params=params)
        self.events_received += 1
        self.last_event_ts = event.timestamp
        self.last_event_type = name

        if self.on_game_event:
            self.on_game_event(name, params)

        # Control events always update heartbeat state when the toggle allows start.
        if name == "heartbeat_start":
            if self.is_event_enabled("heartbeat"):
                self._start_heartbeat()
            return True
        if name == "heartbeat_stop":
            self._stop_heartbeat()
            return True

        # Reload solenoid hold is independent of vest per-event toggles.
        if self._solenoid_hold_on_reload:
            if name in _RELOAD_HOLD_START_EVENTS:
                self._set_reload_hold(True)
            elif name in _RELOAD_HOLD_END_EVENTS:
                self._set_reload_hold(False)

        if not self.is_event_enabled(name):
            return True

        for cell, speed in map_event_to_haptics(event):
            self._trigger(cell, speed)

        if self._solenoid_enabled and name in _FIRE_RECOIL_EVENTS:
            weapon_key = str(weapon or _FIRE_RECOIL_EVENTS[name])
            duration_ms = duration_ms_for_weapon(weapon_key, self._solenoid_recoil_ms)
            self._pulse_recoil(duration_ms)

        return True

    def _trigger(self, cell: int, speed: int) -> None:
        if not self.on_trigger:
            return
        self.on_trigger(int(cell), int(speed))

    def _pulse_recoil(self, duration_ms: int) -> None:
        if not self.on_recoil:
            return
        self.on_recoil(int(duration_ms))

    def _set_reload_hold(self, on: bool) -> None:
        if bool(on) == bool(self._reload_hold_active):
            return
        self._reload_hold_active = bool(on)
        if not self.on_recoil_hold:
            return
        try:
            self.on_recoil_hold(bool(on))
        except Exception as exc:
            logger.warning("[gunmancontracts] reload hold failed: %s", exc)

    def _start_heartbeat(self) -> None:
        with self._heartbeat_lock:
            if self._heartbeat_thread is not None and self._heartbeat_thread.is_alive():
                return
            self._heartbeat_stop.clear()
            thread = threading.Thread(
                target=self._heartbeat_loop,
                name="gunmancontracts-heartbeat",
                daemon=True,
            )
            self._heartbeat_thread = thread
            thread.start()
            logger.info("[gunmancontracts] low-health heartbeat started")

    def _stop_heartbeat(self) -> None:
        with self._heartbeat_lock:
            self._heartbeat_stop.set()
            thread = self._heartbeat_thread
            self._heartbeat_thread = None
        if thread is not None and thread.is_alive():
            thread.join(timeout=1.5)
            logger.info("[gunmancontracts] low-health heartbeat stopped")

    def _heartbeat_loop(self) -> None:
        # Immediate first pulse, then every interval until stopped.
        while self._enabled and not self._heartbeat_stop.is_set():
            if self.is_event_enabled("heartbeat"):
                for cell, speed in map_event_to_haptics(GunmanContractsEvent(type="heartbeat")):
                    self._trigger(cell, speed)
            if self._heartbeat_stop.wait(_HEARTBEAT_INTERVAL_S):
                break

"""
Cyberpunk 2077 integration manager.

A RED4ext + redscript companion mod in the game connects to the daemon as a
TCP client and sends `cyberpunk_event` commands. This manager maps those events
to vest cells and optional USB-relay / wireless solenoid recoil.

Prior art (do not redistribute OWO Nexus assets — write original hooks):
- OWO Skin Cyberpunk 2077 (GingasVR) / bHaptics CP2077 event surface
- redscript hooks: ShootEvents.OnEnter, player gameHitEvent
"""

from __future__ import annotations

import logging
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
    RIGHT_ARM,
    RIGHT_SIDE,
    Cell,
)

logger = logging.getLogger(__name__)

GameEventCallback = Callable[[str, dict], None]
TriggerCallback = Callable[[int, int], None]
RecoilCallback = Callable[[int], None]

# Fire events → default solenoid weapon key when `weapon` is omitted.
_FIRE_RECOIL_EVENTS = {
    "gun_fire": "pistol",
    "shotgun_fire": "shotgun",
    "rifle_fire": "rifle",
    "smg_fire": "pistol",
    "sniper_fire": "rifle",
}

# Toggle keys shown in the UI / passed via enabled_events on start.
DEFAULT_ENABLED_EVENTS: Dict[str, bool] = {
    "gun_fire": True,
    "shotgun_fire": True,
    "rifle_fire": True,
    "smg_fire": True,
    "sniper_fire": True,
    "player_hit": True,
}


@dataclass
class CyberpunkEvent:
    """Parsed event from the Cyberpunk 2077 RED4ext mod."""

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
    return event_type


def _hand_is_left(hand: Optional[str]) -> Optional[bool]:
    raw = str(hand or "").strip().lower()
    if raw in ("left", "l"):
        return True
    if raw in ("right", "r"):
        return False
    return None


def cells_for_hit_angle(angle: Optional[float]) -> List[int]:
    """
    Map hit rotation to vest cells.

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


def _arm_cells(hand_left: Optional[bool]) -> List[int]:
    if hand_left is True:
        return list(LEFT_ARM)
    if hand_left is False:
        return list(RIGHT_ARM)
    return list(LEFT_ARM) + list(RIGHT_ARM)


def _side_cells(hand_left: Optional[bool]) -> List[int]:
    if hand_left is True:
        return list(LEFT_SIDE)
    if hand_left is False:
        return list(RIGHT_SIDE)
    return list(LEFT_SIDE) + list(RIGHT_SIDE)


def map_event_to_haptics(event: CyberpunkEvent) -> List[Tuple[int, int]]:
    """Map a Cyberpunk event to vest (cell, speed) commands."""
    event_type = str(event.type or "")
    hand_left = _hand_is_left(event.params.get("hand"))
    angle = event.params.get("angle")
    intensity = event.params.get("intensity")
    commands: List[Tuple[int, int]] = []

    hit_speed = 7
    if isinstance(intensity, (int, float)):
        # Scale 0..1 intensity into vest speed 3..9.
        try:
            t = max(0.0, min(1.0, float(intensity)))
            hit_speed = int(round(3 + t * 6))
        except (TypeError, ValueError):
            hit_speed = 7

    if event_type == "gun_fire":
        commands.extend((cell, 5) for cell in _arm_cells(hand_left))

    elif event_type == "smg_fire":
        commands.extend((cell, 5) for cell in _arm_cells(hand_left))

    elif event_type == "rifle_fire":
        commands.extend((cell, 6) for cell in _arm_cells(hand_left))

    elif event_type == "sniper_fire":
        commands.extend((cell, 7) for cell in _arm_cells(hand_left))

    elif event_type == "shotgun_fire":
        commands.extend((cell, 8) for cell in _side_cells(hand_left))

    elif event_type == "player_hit":
        hit_angle = angle if isinstance(angle, (int, float)) else None
        commands.extend((cell, hit_speed) for cell in cells_for_hit_angle(hit_angle))

    return commands


class CyberpunkManager:
    """
    TCP-client handler for Cyberpunk 2077.

    Start/stop enable processing so stray events do nothing until armed.
    """

    def __init__(
        self,
        on_game_event: Optional[GameEventCallback] = None,
        on_trigger: Optional[TriggerCallback] = None,
        on_recoil: Optional[RecoilCallback] = None,
    ) -> None:
        self.on_game_event = on_game_event
        self.on_trigger = on_trigger
        self.on_recoil = on_recoil
        self._enabled = False
        self.events_received = 0
        self.last_event_ts: Optional[float] = None
        self.last_event_type: Optional[str] = None
        self._solenoid_enabled = True
        self._solenoid_recoil_ms = DEFAULT_RECOIL_MS
        self._enabled_events: Dict[str, bool] = dict(DEFAULT_ENABLED_EVENTS)

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
        self._enabled_events = normalize_enabled_events(enabled_events)
        self._enabled = True
        logger.info(
            "[cyberpunk] enabled (solenoid_recoil=%s duration_ms=%s enabled_events=%s)",
            self._solenoid_enabled,
            self._solenoid_recoil_ms,
            self._enabled_events,
        )

    def disable(self) -> None:
        self._enabled = False
        logger.info("[cyberpunk] disabled")

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
        intensity: Optional[float] = None,
    ) -> bool:
        """Handle one cyberpunk_event from the game mod. Returns False if ignored."""
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
        if intensity is not None:
            try:
                params["intensity"] = float(intensity)
            except (TypeError, ValueError):
                pass

        event = CyberpunkEvent(type=name, raw=name, params=params)
        self.events_received += 1
        self.last_event_ts = event.timestamp
        self.last_event_type = name

        if self.on_game_event:
            self.on_game_event(name, params)

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

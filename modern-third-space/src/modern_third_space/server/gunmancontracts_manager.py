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

_FIRE_RECOIL_EVENTS = {
    "gun_fire": "pistol",
    "shotgun_fire": "shotgun",
    "rifle_fire": "rifle",
}


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

    elif event_type == "heartbeat":
        commands.append((Cell.FRONT_LOWER_LEFT, 2))
        commands.append((Cell.FRONT_LOWER_RIGHT, 2))

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

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def is_running(self) -> bool:
        return self._enabled

    def enable(self, solenoid_recoil: Optional[Dict[str, Any]] = None) -> None:
        settings = parse_solenoid_settings(solenoid_recoil)
        self._solenoid_enabled = bool(settings["enabled"])
        self._solenoid_recoil_ms = int(settings["duration_ms"])
        self._enabled = True
        logger.info(
            "[gunmancontracts] enabled (solenoid_recoil=%s duration_ms=%s)",
            self._solenoid_enabled,
            self._solenoid_recoil_ms,
        )

    def disable(self) -> None:
        self._enabled = False
        logger.info("[gunmancontracts] disabled")

    def start(self, solenoid_recoil: Optional[Dict[str, Any]] = None) -> Tuple[bool, Optional[str]]:
        self.enable(solenoid_recoil)
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

"""
Titanfall 2 VR integration manager.

CircuitLord's Titanfall 2 VR campaign mod plus Florian's Northstar plugin
(https://github.com/floh-bhaptics/Titanfall2VR_bhaptics) already detect shots,
damage, and movement. That plugin plays bHaptics and ProTube locally. This
manager is the daemon side: a TCP client sends `titanfall2_event` commands,
and those map to vest cells and optional USB-relay solenoid recoil.

Event names follow the plugin's bHaptics keys (`impact`, `recoil_pistol_r`
is sent here as `recoil_pistol` plus `hand`) and ProTube groups (`full`,
`heavy`, `pistol`, `rifle`).
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from ..relay.recoil import (
    DEFAULT_RECOIL_MS,
    clamp_duration_ms,
    duration_ms_for_weapon,
    parse_solenoid_settings,
)
from ..vest.cell_layout import (
    ALL_CELLS,
    LEFT_ARM,
    LEFT_SIDE,
    LOWER_CELLS,
    RIGHT_ARM,
    RIGHT_SIDE,
    UPPER_CELLS,
    Cell,
)

logger = logging.getLogger(__name__)

GameEventCallback = Callable[[str, dict], None]
TriggerCallback = Callable[[int, int], None]
RecoilCallback = Callable[[int], None]

# Solenoid pulse. Titan weapons rumble instead of a sharp kick, matching
# Florian's PT_Rumble (pilot guns still kick).
_SOLENOID_EVENTS = frozenset(
    {
        "recoil_pistol",
        "recoil_rifle",
        "recoil_shotgun",
        "recoil_heavy",
        "recoil_titan",
        "recoil_titan_rockets",
    }
)

DEFAULT_ENABLED_EVENTS: Dict[str, bool] = {
    "recoil_pistol": True,
    "recoil_rifle": True,
    "recoil_shotgun": True,
    "recoil_heavy": True,
    "recoil_titan": True,
    "recoil_titan_rockets": True,
    "charge": True,
    "impact": True,
    "explosion": True,
    "heartbeat": True,
    "healing": True,
    "player_spawned": True,
    "player_killed": True,
    "player_enter_titan": True,
    "player_exit_titan": True,
    "shield_damage": True,
    "player_jump": True,
    "player_dodge": True,
    "player_land": True,
    "player_mantle": True,
    "begin_wallrun": True,
    "end_wallrun": True,
    "zipline": True,
    "titan_hit": True,
    "titan_destroyed": True,
    "titan_melee": True,
    "titan_footstep": True,
    "titanfall": True,
}


@dataclass
class Titanfall2Event:
    """Parsed event from a Titanfall 2 VR TCP client."""

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

    0° is front, 90° is left, 180° is back, 270° is right. Florian's
    BH_HitAngle uses the same convention.
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


def canonical_event_type(event_name: str, group: Optional[str] = None) -> str:
    """
    Fold plugin aliases onto the toggle keys in DEFAULT_ENABLED_EVENTS.

    Pilot shots may arrive as `gun_fire` plus a ProTube group (`full`,
    `heavy`, `pistol`, `rifle`) or as `recoil_<group>`. Vest playback names
    from the Squirrel scripts pass through unchanged.
    """
    name = str(event_name or "").strip().lower()
    grp = str(group or "").strip().lower()

    if name in ("gun_fire", "recoil", "pt_kick"):
        name = {
            "full": "recoil_shotgun",
            "shotgun": "recoil_shotgun",
            "heavy": "recoil_heavy",
            "pistol": "recoil_pistol",
            "rifle": "recoil_rifle",
        }.get(grp, "recoil_rifle")
    elif name in ("titan_shot", "titan_fire", "pt_rumble"):
        name = "recoil_titan"
    elif name in ("titan_rockets", "shoulder_rockets"):
        name = "recoil_titan_rockets"
    elif name in ("player_death", "death"):
        name = "player_killed"
    elif name in ("hit", "player_hit", "damage"):
        name = "impact"
    elif name in ("pt_charge",):
        name = "charge"

    # BH_Play("recoil_pistol_r") style, if a forwarder keeps the side suffix.
    for prefix in ("recoil_pistol", "recoil_rifle", "recoil_shotgun"):
        if name in (f"{prefix}_l", f"{prefix}_r", f"{prefix}_left", f"{prefix}_right"):
            return prefix
    return name


def _scaled_speed(base: int, intensity: Optional[float]) -> int:
    """Scale a 1–10 vest speed by a 0..1 intensity multiplier."""
    if intensity is None:
        return base
    try:
        factor = float(intensity)
    except (TypeError, ValueError):
        return base
    if factor <= 0:
        return 0
    return max(1, min(10, int(round(base * factor))))


def _arm_cells(hand_left: Optional[bool]) -> List[int]:
    if hand_left is True:
        return list(LEFT_ARM)
    if hand_left is False:
        return list(RIGHT_ARM)
    # Plugin default when the hand is unknown: main hand is right.
    return list(RIGHT_ARM)


def _side_cells(hand_left: Optional[bool]) -> List[int]:
    if hand_left is True:
        return list(LEFT_SIDE)
    if hand_left is False:
        return list(RIGHT_SIDE)
    return list(RIGHT_SIDE)


def map_event_to_haptics(event: Titanfall2Event) -> List[Tuple[int, int]]:
    """Map a Titanfall 2 event to vest (cell, speed) commands."""
    event_type = str(event.type or "")
    hand_left = _hand_is_left(event.params.get("hand"))
    intensity = event.params.get("intensity")
    angle = event.params.get("angle")
    commands: List[Tuple[int, int]] = []

    def add(cells: List[int], speed: int) -> None:
        scaled = _scaled_speed(speed, intensity if isinstance(intensity, (int, float)) else None)
        if scaled <= 0:
            return
        commands.extend((cell, scaled) for cell in cells)

    if event_type == "recoil_pistol":
        add(_arm_cells(hand_left), 5)
    elif event_type == "recoil_rifle":
        add(_arm_cells(hand_left), 6)
    elif event_type == "recoil_shotgun":
        add(_side_cells(hand_left), 8)
    elif event_type == "recoil_heavy":
        add(_side_cells(hand_left), 7)
    elif event_type == "recoil_titan":
        add(list(UPPER_CELLS), 7)
    elif event_type == "recoil_titan_rockets":
        add(list(ALL_CELLS), 8)
    elif event_type == "charge":
        # Fraction 0 stops the charge rumble.
        add(_arm_cells(hand_left), 8)
    elif event_type == "impact":
        hit_angle = angle if isinstance(angle, (int, float)) else None
        add(cells_for_hit_angle(hit_angle), 7)
    elif event_type == "explosion":
        hit_angle = angle if isinstance(angle, (int, float)) else None
        add(cells_for_hit_angle(hit_angle), 8)
    elif event_type == "titanfall":
        hit_angle = angle if isinstance(angle, (int, float)) else None
        cells = list(dict.fromkeys(cells_for_hit_angle(hit_angle) + list(LOWER_CELLS)))
        add(cells, 9)
    elif event_type == "heartbeat":
        add([Cell.FRONT_LOWER_LEFT, Cell.FRONT_LOWER_RIGHT], 2)
    elif event_type == "healing":
        add(list(LOWER_CELLS), 4)
    elif event_type == "player_spawned":
        add(list(LOWER_CELLS), 3)
    elif event_type == "player_killed":
        add(list(ALL_CELLS), 10)
    elif event_type == "player_enter_titan":
        add(list(UPPER_CELLS), 5)
    elif event_type == "player_exit_titan":
        add(list(LOWER_CELLS), 4)
    elif event_type == "shield_damage":
        add([Cell.FRONT_UPPER_LEFT, Cell.FRONT_UPPER_RIGHT], 5)
    elif event_type == "player_jump":
        add([Cell.BACK_LOWER_LEFT, Cell.BACK_LOWER_RIGHT], 3)
    elif event_type == "player_dodge":
        add(list(UPPER_CELLS), 4)
    elif event_type == "player_land":
        add(list(LOWER_CELLS), 5)
    elif event_type == "player_mantle":
        add(list(UPPER_CELLS), 4)
    elif event_type == "begin_wallrun":
        add([Cell.FRONT_UPPER_LEFT, Cell.FRONT_UPPER_RIGHT], 3)
    elif event_type == "end_wallrun":
        add(list(LOWER_CELLS), 2)
    elif event_type == "zipline":
        add([Cell.FRONT_UPPER_LEFT, Cell.FRONT_UPPER_RIGHT], 2)
    elif event_type == "titan_hit":
        add([Cell.FRONT_UPPER_LEFT, Cell.FRONT_UPPER_RIGHT], 7)
    elif event_type == "titan_destroyed":
        add(list(ALL_CELLS), 10)
    elif event_type == "titan_melee":
        add([Cell.FRONT_UPPER_LEFT, Cell.FRONT_UPPER_RIGHT], 6)
    elif event_type == "titan_footstep":
        add(list(LOWER_CELLS), 4)

    return commands


def recoil_duration_ms(event_type: str, weapon: Optional[str], default_ms: int) -> int:
    """
    Pulse length for gun and Titan solenoid feedback.

    Weapon class names win when they already match a known profile
    (``mp_weapon_shotgun``). Otherwise the event group supplies the profile,
    so Mastiff (``full``) still gets a shotgun kick.
    """
    if event_type == "recoil_titan_rockets":
        return clamp_duration_ms(max(default_ms, 90))
    if event_type == "recoil_titan":
        return clamp_duration_ms(max(default_ms, 50))

    hint = {
        "recoil_heavy": "sniper",
        "recoil_shotgun": "shotgun",
        "recoil_rifle": "rifle",
        "recoil_pistol": "pistol",
    }.get(event_type)
    if hint is None:
        return duration_ms_for_weapon(weapon, default_ms)

    from_hint = duration_ms_for_weapon(hint, default_ms)
    if not weapon:
        return from_hint
    from_weapon = duration_ms_for_weapon(weapon, default_ms)
    if from_weapon == clamp_duration_ms(default_ms) and from_hint != from_weapon:
        return from_hint
    return from_weapon


class Titanfall2Manager:
    """
    TCP-client handler for Titanfall 2 VR.

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
        if event_type not in self._enabled_events:
            return False
        return bool(self._enabled_events.get(event_type, False))

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
            "[titanfall2] enabled (solenoid_recoil=%s duration_ms=%s enabled_events=%s)",
            self._solenoid_enabled,
            self._solenoid_recoil_ms,
            self._enabled_events,
        )

    def disable(self) -> None:
        self._enabled = False
        logger.info("[titanfall2] disabled")

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
        group: Optional[str] = None,
    ) -> bool:
        """Handle one titanfall2_event. Returns False if the integration is stopped."""
        if not self._enabled:
            return False
        raw_name = str(event_name or "").strip()
        if not raw_name:
            return False

        name = canonical_event_type(raw_name, group)
        params: Dict[str, Any] = {"priority": int(priority or 0), "raw": raw_name}
        if hand:
            params["hand"] = str(hand)
        elif raw_name.lower().endswith("_l") or raw_name.lower().endswith("_left"):
            params["hand"] = "left"
        elif raw_name.lower().endswith("_r") or raw_name.lower().endswith("_right"):
            params["hand"] = "right"
        if angle is not None:
            try:
                params["angle"] = float(angle)
            except (TypeError, ValueError):
                pass
        if weapon:
            params["weapon"] = str(weapon)
        if group:
            params["group"] = str(group)
        if intensity is not None:
            try:
                params["intensity"] = float(intensity)
            except (TypeError, ValueError):
                pass

        event = Titanfall2Event(type=name, raw=raw_name, params=params)
        self.events_received += 1
        self.last_event_ts = event.timestamp
        self.last_event_type = name

        if self.on_game_event:
            self.on_game_event(name, params)

        if not self.is_event_enabled(name):
            return True

        for cell, speed in map_event_to_haptics(event):
            self._trigger(cell, speed)

        if self._solenoid_enabled and name in _SOLENOID_EVENTS:
            duration_ms = recoil_duration_ms(name, weapon, self._solenoid_recoil_ms)
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

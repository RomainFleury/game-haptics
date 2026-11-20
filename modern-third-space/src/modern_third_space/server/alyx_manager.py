"""
Half-Life: Alyx Integration Manager for the vest daemon.

This module provides console.log file watching to receive game events from
Half-Life: Alyx. The game events are emitted via Lua scripts (tactsuit.lua)
that write to the console log when launched with -condebug.

Original Lua scripts by floh-bhaptics:
https://www.nexusmods.com/halflifealyx/mods/6

When Alyx game events are detected, they are passed to callbacks which the
daemon uses to:
1. Trigger haptic effects on the vest
2. Broadcast events to all connected clients
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Thread
from typing import Callable, Optional, List

from ..vest.cell_layout import (
    Cell,
    FRONT_CELLS,
    BACK_CELLS,
    ALL_CELLS,
    LEFT_SIDE,
    RIGHT_SIDE,
    UPPER_CELLS,
)
from ..relay.recoil import (
    DEFAULT_RECOIL_MS,
    duration_ms_for_weapon,
    parse_solenoid_settings,
)

logger = logging.getLogger(__name__)


# =============================================================================
# Event Parser (Phase 2)
# =============================================================================

@dataclass
class AlyxEvent:
    """Parsed event from Alyx console log."""
    type: str
    raw: str
    params: dict
    timestamp: float = 0.0
    
    def __post_init__(self):
        if self.timestamp == 0.0:
            self.timestamp = time.time()


# Event format: [Tactsuit] {EventType|param1|param2|...}
TACTSUIT_PATTERN = re.compile(r'\[Tactsuit\]\s*\{([^}]+)\}')


def parse_tactsuit_line(line: str) -> Optional[AlyxEvent]:
    """
    Parse a [Tactsuit] {...} line from console.log.
    
    Returns AlyxEvent if valid, None otherwise.
    """
    match = TACTSUIT_PATTERN.search(line)
    if not match:
        return None
    
    content = match.group(1)
    parts = content.split('|')
    
    if not parts:
        return None
    
    event_type = parts[0]
    params = {}
    
    # Parse parameters based on event type
    if event_type == "PlayerHurt" and len(parts) >= 6:
        params = {
            "health": int(parts[1]) if parts[1].isdigit() else 100,
            "enemy_class": parts[2],
            "angle": float(parts[3]) if parts[3].replace('.', '').isdigit() else 0.0,
            "enemy_name": parts[4],
            "enemy_debug_name": parts[5],
        }
    elif event_type == "PlayerShootWeapon" and len(parts) >= 2:
        params = {"weapon": parts[1]}
    elif event_type == "PlayerDeath" and len(parts) >= 2:
        params = {"damagebits": int(parts[1]) if parts[1].isdigit() else 0}
    elif event_type == "PlayerHealth" and len(parts) >= 2:
        params = {"health": int(parts[1]) if parts[1].isdigit() else 100}
    elif event_type == "PlayerHeal" and len(parts) >= 2:
        params = {"angle": float(parts[1]) if parts[1].replace('.', '').replace('-', '').isdigit() else 0.0}
    elif event_type in ("PlayerGrabbityPull", "PlayerGrabbityLockStart", "PlayerGrabbityLockStop",
                         "GrabbityGloveCatch") and len(parts) >= 2:
        params = {"is_primary_hand": parts[1].lower() == "true"}
    elif event_type in ("PlayerDropAmmoInBackpack", "PlayerDropResinInBackpack",
                         "PlayerRetrievedBackpackClip", "PlayerStoredItemInItemholder",
                         "PlayerRemovedItemFromItemholder", "PlayerUsingHealthstation") and len(parts) >= 2:
        params = {"left_side": parts[1] == "1"}
    elif event_type == "PrimaryHandChanged" and len(parts) >= 2:
        params = {"is_primary_left": parts[1].lower() == "true"}
    elif event_type == "ItemPickup" and len(parts) >= 3:
        params = {"item": parts[1], "left_shoulder": parts[2] == "1"}
    elif event_type == "ItemReleased" and len(parts) >= 3:
        params = {"item": parts[1], "left_hand_used": parts[2] == "1"}
    elif event_type == "PlayerShotgunUpgradeGrenadeLauncherState" and len(parts) >= 2:
        params = {"state": int(parts[1]) if parts[1].isdigit() else 0}
    # Events with no params
    elif event_type in ("PlayerGrabbedByBarnacle", "PlayerReleasedByBarnacle",
                         "PlayerCoughStart", "PlayerCoughEnd", "TwoHandStart", "TwoHandEnd",
                         "PlayerOpenedGameMenu", "PlayerClosedGameMenu", "Reset",
                         "PlayerPistolClipInserted", "PlayerPistolChamberedRound",
                         "PlayerShotgunShellLoaded", "PlayerShotgunLoadedShells"):
        params = {}
    
    return AlyxEvent(type=event_type, raw=content, params=params)


# =============================================================================
# Haptic Mapper (Phase 3)
# =============================================================================

#
# Per-event haptics gating
#
# We keep the defaults aligned with the UI:
# - PlayerHurt + PlayerDeath default ON
# - everything else default OFF (opt-in)
#

DEFAULT_ENABLED_EVENTS: dict[str, bool] = {
    # Core
    "PlayerHurt": True,
    "PlayerDeath": True,
    # Opt-in (curated list)
    "PlayerShootWeapon": False,
    "PlayerHealth": False,
    "PlayerHeal": False,
    "PlayerUsingHealthstation": False,
    "PlayerGrabbityPull": False,
    "PlayerGrabbityLockStart": False,
    "PlayerGrabbityLockStop": False,
    "GrabbityGloveCatch": False,
    "PlayerGrabbedByBarnacle": False,
    "PlayerReleasedByBarnacle": False,
    "PlayerCoughStart": False,
    "PlayerCoughEnd": False,
    "TwoHandStart": False,
    "TwoHandEnd": False,
    "Reset": False,
    "PlayerDropAmmoInBackpack": False,
    "PlayerDropResinInBackpack": False,
    "PlayerRetrievedBackpackClip": False,
    "PlayerStoredItemInItemholder": False,
    "PlayerRemovedItemFromItemholder": False,
    "ItemPickup": False,
    "ItemReleased": False,
    "PlayerPistolClipInserted": False,
    "PlayerPistolChamberedRound": False,
    "PlayerShotgunShellLoaded": False,
    "PlayerShotgunLoadedShells": False,
    "PlayerShotgunUpgradeGrenadeLauncherState": False,
}

# Cooldowns (seconds) for spammy events. Others default to 0.
DEFAULT_EVENT_COOLDOWN_S: dict[str, float] = {
    "PlayerShootWeapon": 0.08,
    "PlayerHealth": 1.0,
    "PlayerCoughStart": 0.75,
    "PlayerCoughEnd": 0.25,
    "Reset": 2.0,
}


@dataclass
class AlyxHapticsSettings:
    """
    Per-event haptics settings for Alyx.

    v1 schema (as passed via daemon command):
      {
        "enabled_events": {"PlayerHurt": true, "PlayerShootWeapon": false, ...},
        "solenoid_recoil": {"enabled": true, "duration_ms": 40}
      }
    """

    enabled_events: dict[str, bool]
    cooldown_s: dict[str, float]
    _last_trigger_ts: dict[str, float]
    solenoid_recoil_enabled: bool = True
    solenoid_recoil_ms: int = DEFAULT_RECOIL_MS

    @classmethod
    def from_payload(cls, payload: Optional[dict]) -> "AlyxHapticsSettings":
        enabled = dict(DEFAULT_ENABLED_EVENTS)
        cooldown_s = dict(DEFAULT_EVENT_COOLDOWN_S)
        solenoid = parse_solenoid_settings(payload)

        if isinstance(payload, dict):
            raw_enabled = payload.get("enabled_events")
            if isinstance(raw_enabled, dict):
                for k, v in raw_enabled.items():
                    if isinstance(k, str):
                        enabled[k] = bool(v)

            raw_cd = payload.get("cooldowns")
            if isinstance(raw_cd, dict):
                for k, v in raw_cd.items():
                    if isinstance(k, str):
                        try:
                            cooldown_s[k] = max(0.0, float(v))
                        except Exception:
                            pass

        return cls(
            enabled_events=enabled,
            cooldown_s=cooldown_s,
            _last_trigger_ts={},
            solenoid_recoil_enabled=bool(solenoid["enabled"]),
            solenoid_recoil_ms=int(solenoid["duration_ms"]),
        )

    def is_enabled(self, event_type: str) -> bool:
        return bool(self.enabled_events.get(event_type, False))


def angle_to_cells(angle: float) -> List[int]:
    """
    Convert damage angle (0-360°) to vest cells.
    
    Angle reference (relative to player facing):
    - 0° = Front
    - 90° = Left  
    - 180° = Back
    - 270° = Right
    
    Uses correct hardware cell layout from cell_layout module:
          FRONT                    BACK
      ┌─────┬─────┐          ┌─────┬─────┐
      │  2  │  5  │  Upper   │  1  │  6  │
      ├─────┼─────┤          ├─────┼─────┤
      │  3  │  4  │  Lower   │  0  │  7  │
      └─────┴─────┘          └─────┴─────┘
        L     R                L     R
    """
    # Normalize angle to 0-360
    angle = angle % 360
    
    if angle < 45 or angle >= 315:
        # Front upper cells
        return [Cell.FRONT_UPPER_LEFT, Cell.FRONT_UPPER_RIGHT]
    elif 45 <= angle < 135:
        # Left side (from player perspective)
        return LEFT_SIDE
    elif 135 <= angle < 225:
        # Back
        return BACK_CELLS
    else:  # 225 <= angle < 315
        # Right side
        return RIGHT_SIDE


def map_event_to_haptics(
    event: AlyxEvent,
    settings: Optional[AlyxHapticsSettings] = None,
    primary_is_left: Optional[bool] = None,
) -> List[tuple[int, int]]:
    """
    Map an Alyx event to haptic commands.
    
    Returns list of (cell, speed) tuples.
    
    Uses correct hardware cell layout from cell_layout module.
    """
    st = settings or AlyxHapticsSettings.from_payload(None)
    if not st.is_enabled(event.type):
        return []

    commands: List[tuple[int, int]] = []

    def _hand_is_left(is_primary_hand: bool) -> bool:
        # If we don't know, assume primary is right (default False).
        pil = bool(primary_is_left) if primary_is_left is not None else False
        # is_primary_hand refers to whichever hand is currently primary.
        # If primary is left, primary-hand events are left; otherwise they're right.
        return pil == bool(is_primary_hand)
    
    if event.type == "PlayerHurt":
        angle = event.params.get("angle", 0.0)
        health = event.params.get("health", 100)
        cells = angle_to_cells(angle)
        
        # Intensity based on remaining health (lower health = already hurt = stronger effect)
        speed = 8 if health < 30 else (6 if health < 60 else 5)
        
        for cell in cells:
            commands.append((cell, speed))
    
    elif event.type == "PlayerDeath":
        # Full vest strong effect
        for cell in ALL_CELLS:
            commands.append((cell, 10))

    elif event.type == "PlayerShootWeapon":
        weapon = str(event.params.get("weapon", "") or "")
        wl = weapon.lower()
        if "shotgun" in wl:
            speed = 7
        elif "rapidfire" in wl or "smg" in wl:
            speed = 4
        else:
            speed = 5
        # Recoil pulse on front upper cells
        commands.append((Cell.FRONT_UPPER_LEFT, speed))
        commands.append((Cell.FRONT_UPPER_RIGHT, speed))

    elif event.type == "PlayerHealth":
        health = event.params.get("health", 100)
        try:
            health_i = int(health)
        except Exception:
            health_i = 100
        if health_i <= 30:
            # Heartbeat-like: subtle left-side pulse
            commands.append((Cell.FRONT_UPPER_LEFT, 3))
            commands.append((Cell.FRONT_LOWER_LEFT, 3))

    elif event.type in ("PlayerHeal", "PlayerUsingHealthstation"):
        # Soothing wave on front
        for cell in FRONT_CELLS:
            commands.append((cell, 2))

    elif event.type in ("PlayerGrabbityPull", "PlayerGrabbityLockStart", "PlayerGrabbityLockStop", "GrabbityGloveCatch"):
        is_primary_hand = bool(event.params.get("is_primary_hand", True))
        is_left = _hand_is_left(is_primary_hand)

        if event.type == "PlayerGrabbityPull":
            speed = 3
        elif event.type == "GrabbityGloveCatch":
            speed = 4
        elif event.type == "PlayerGrabbityLockStart":
            speed = 3
        else:  # PlayerGrabbityLockStop
            speed = 2

        if is_left:
            commands.append((Cell.FRONT_UPPER_LEFT, speed))
            commands.append((Cell.FRONT_LOWER_LEFT, speed))
        else:
            commands.append((Cell.FRONT_UPPER_RIGHT, speed))
            commands.append((Cell.FRONT_LOWER_RIGHT, speed))

    elif event.type == "PlayerGrabbedByBarnacle":
        # Strong pull-up effect on back upper cells
        commands.append((Cell.BACK_UPPER_LEFT, 8))
        commands.append((Cell.BACK_UPPER_RIGHT, 8))

    elif event.type == "PlayerReleasedByBarnacle":
        # Release tap on back upper cells
        commands.append((Cell.BACK_UPPER_LEFT, 4))
        commands.append((Cell.BACK_UPPER_RIGHT, 4))

    elif event.type == "PlayerCoughStart":
        # Subtle chest pulses (front cells)
        for cell in FRONT_CELLS:
            commands.append((cell, 2))

    elif event.type == "PlayerCoughEnd":
        # Small “end” tap (lower front)
        commands.append((Cell.FRONT_LOWER_LEFT, 1))
        commands.append((Cell.FRONT_LOWER_RIGHT, 1))

    elif event.type == "TwoHandStart":
        # Subtle shoulder/upper feedback
        commands.append((Cell.FRONT_UPPER_LEFT, 2))
        commands.append((Cell.FRONT_UPPER_RIGHT, 2))

    elif event.type == "TwoHandEnd":
        commands.append((Cell.FRONT_UPPER_LEFT, 1))
        commands.append((Cell.FRONT_UPPER_RIGHT, 1))

    elif event.type == "Reset":
        # Quick full-vest pulse on spawn
        for cell in ALL_CELLS:
            commands.append((cell, 3))

    elif event.type in (
        "PlayerDropAmmoInBackpack",
        "PlayerDropResinInBackpack",
        "PlayerRetrievedBackpackClip",
        "PlayerStoredItemInItemholder",
        "PlayerRemovedItemFromItemholder",
    ):
        left = bool(event.params.get("left_side", False))
        cell = Cell.BACK_UPPER_LEFT if left else Cell.BACK_UPPER_RIGHT
        speed = 4 if event.type == "PlayerRetrievedBackpackClip" else 3
        commands.append((cell, speed))

    elif event.type == "ItemPickup":
        left = bool(event.params.get("left_shoulder", False))
        cell = Cell.BACK_UPPER_LEFT if left else Cell.BACK_UPPER_RIGHT
        commands.append((cell, 3))

    elif event.type == "ItemReleased":
        left = bool(event.params.get("left_hand_used", False))
        if left:
            commands.append((Cell.FRONT_LOWER_LEFT, 2))
        else:
            commands.append((Cell.FRONT_LOWER_RIGHT, 2))

    elif event.type in ("PlayerPistolClipInserted", "PlayerPistolChamberedRound"):
        speed = 3 if event.type == "PlayerPistolClipInserted" else 2
        commands.append((Cell.FRONT_UPPER_LEFT, speed))
        commands.append((Cell.FRONT_UPPER_RIGHT, speed))

    elif event.type in ("PlayerShotgunShellLoaded", "PlayerShotgunLoadedShells"):
        speed = 4
        commands.append((Cell.FRONT_UPPER_LEFT, speed))
        commands.append((Cell.FRONT_UPPER_RIGHT, speed))

    elif event.type == "PlayerShotgunUpgradeGrenadeLauncherState":
        # State change tap
        try:
            state = int(event.params.get("state", 0))
        except Exception:
            state = 0
        speed = 5 if state else 3
        commands.append((Cell.FRONT_LOWER_LEFT, speed))
        commands.append((Cell.FRONT_LOWER_RIGHT, speed))
    
    # If not mapped, do nothing (even if enabled).
    if not commands:
        return []

    # Apply cooldown AFTER mapping, so non-triggering events don't consume cooldown windows.
    cd = float(st.cooldown_s.get(event.type, 0.0) or 0.0)
    if cd > 0.0:
        now = time.time()
        last = float(st._last_trigger_ts.get(event.type, 0.0) or 0.0)
        if (now - last) < cd:
            return []
        st._last_trigger_ts[event.type] = now

    return commands


# =============================================================================
# Console Log Watcher (Phase 1)
# =============================================================================

class ConsoleLogWatcher:
    """
    Watches Half-Life: Alyx console.log for [Tactsuit] events.
    
    The game must be launched with -condebug to enable console logging.
    """
    
    DEFAULT_POLL_INTERVAL = 0.05  # 50ms
    
    def __init__(
        self,
        log_path: Path,
        on_event: Callable[[AlyxEvent], None],
        poll_interval: float = DEFAULT_POLL_INTERVAL,
    ):
        self.log_path = log_path
        self.on_event = on_event
        self.poll_interval = poll_interval
        
        self._running = False
        self._last_position = 0
        self._thread: Optional[Thread] = None
    
    def start(self) -> tuple[bool, Optional[str]]:
        """Start watching the console log."""
        if self._running:
            return False, "Already watching"
        
        if not self.log_path.exists():
            return False, f"Console log not found: {self.log_path}"
        
        self._running = True
        self._last_position = self.log_path.stat().st_size  # Start from end
        
        self._thread = Thread(target=self._watch_loop, daemon=True)
        self._thread.start()
        
        logger.info(f"Started watching: {self.log_path}")
        return True, None
    
    def stop(self):
        """Stop watching the console log."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=1.0)
            self._thread = None
        logger.info("Stopped watching console log")
    
    def _watch_loop(self):
        """Main watch loop running in background thread."""
        while self._running:
            try:
                self._check_for_new_lines()
            except FileNotFoundError:
                # Log file may be deleted/recreated
                self._last_position = 0
            except Exception as e:
                logger.error(f"Error reading console log: {e}")
            
            time.sleep(self.poll_interval)
    
    def _check_for_new_lines(self):
        """Check for new lines in the console log."""
        if not self.log_path.exists():
            return
        
        current_size = self.log_path.stat().st_size
        
        # Handle log truncation (game restart)
        if current_size < self._last_position:
            logger.info("Console log truncated, resetting position")
            self._last_position = 0
        
        if current_size == self._last_position:
            return
        
        try:
            with open(self.log_path, 'r', encoding='utf-8', errors='ignore') as f:
                f.seek(self._last_position)
                new_content = f.read()
                self._last_position = f.tell()
            
            for line in new_content.splitlines():
                if "[Tactsuit]" in line:
                    event = parse_tactsuit_line(line)
                    if event:
                        self.on_event(event)
        
        except IOError as e:
            # File may be locked by game
            logger.debug(f"IOError reading log (game may have lock): {e}")


# =============================================================================
# Alyx Manager (Phase 4 - Daemon Integration)
# =============================================================================

# Callback types
GameEventCallback = Callable[[str, dict], None]
TriggerCallback = Callable[[int, int], None]
RecoilCallback = Callable[[int], None]  # duration_ms


class AlyxManager:
    """
    Manages Half-Life: Alyx integration within the daemon.
    
    This class:
    1. Watches console.log for [Tactsuit] events
    2. Parses and maps events to haptic commands
    3. Triggers haptic effects via callback
    4. Reports events via callback (for broadcasting to clients)
    
    Args:
        on_game_event: Called when a game event is detected
                      (event_type, params) -> None
        on_trigger: Called to trigger a haptic effect
                   (cell, speed) -> None
        on_recoil: Called to pulse USB relay solenoid (duration_ms) -> None
    """
    
    # Default paths for console.log
    DEFAULT_LOG_PATHS = [
        # Windows
        Path("C:/Program Files (x86)/Steam/steamapps/common/Half-Life Alyx/game/hlvr/console.log"),
        # Linux (Proton)
        Path.home() / ".steam/steam/steamapps/common/Half-Life Alyx/game/hlvr/console.log",
        # macOS (unlikely but included)
        Path.home() / "Library/Application Support/Steam/steamapps/common/Half-Life Alyx/game/hlvr/console.log",
    ]
    
    def __init__(
        self,
        on_game_event: Optional[GameEventCallback] = None,
        on_trigger: Optional[TriggerCallback] = None,
        on_recoil: Optional[RecoilCallback] = None,
    ):
        self.on_game_event = on_game_event
        self.on_trigger = on_trigger
        self.on_recoil = on_recoil
        
        self._log_path: Optional[Path] = None
        self._watcher: Optional[ConsoleLogWatcher] = None
        self._running = False

        # Runtime config/state
        self._haptics_settings: AlyxHapticsSettings = AlyxHapticsSettings.from_payload(None)
        self._primary_is_left: bool = False
        self._last_recoil_ts: float = 0.0
        
        # Stats
        self._events_received = 0
        self._last_event_ts: Optional[float] = None
        self._last_event_type: Optional[str] = None
    
    @property
    def is_running(self) -> bool:
        return self._running
    
    @property
    def log_path(self) -> Optional[Path]:
        return self._log_path
    
    @property
    def events_received(self) -> int:
        return self._events_received
    
    @property
    def last_event_ts(self) -> Optional[float]:
        return self._last_event_ts
    
    def auto_detect_log_path(self) -> Optional[Path]:
        """Try to auto-detect the console.log path."""
        for path in self.DEFAULT_LOG_PATHS:
            if path.exists():
                return path
        
        # Also check parent directories exist (game installed but no log yet)
        for path in self.DEFAULT_LOG_PATHS:
            if path.parent.exists():
                return path
        
        return None
    
    def start(
        self,
        log_path: Optional[str] = None,
        alyx_settings: Optional[dict] = None,
    ) -> tuple[bool, Optional[str]]:
        """
        Start watching for Alyx events.
        
        Args:
            log_path: Path to console.log, or None for auto-detect
            alyx_settings: Optional Alyx settings payload passed from daemon command
            
        Returns:
            (success, error_message)
        """
        if self._running:
            return False, "Alyx integration already running"
        
        # Determine log path
        if log_path:
            self._log_path = Path(log_path)
        else:
            self._log_path = self.auto_detect_log_path()
        
        if not self._log_path:
            return False, "Could not find console.log. Ensure Half-Life Alyx is installed and launched with -condebug"

        # Store per-event haptics settings for this run (restart required to apply changes)
        self._haptics_settings = AlyxHapticsSettings.from_payload(alyx_settings)
        # Reset primary-hand tracking (updated via PrimaryHandChanged events)
        self._primary_is_left = False
        
        # Create watcher
        self._watcher = ConsoleLogWatcher(
            log_path=self._log_path,
            on_event=self._on_alyx_event,
        )
        
        success, error = self._watcher.start()
        if not success:
            self._watcher = None
            return False, error
        
        self._running = True
        self._events_received = 0
        self._last_event_ts = None
        
        logger.info(f"Alyx integration started, watching: {self._log_path}")
        return True, None
    
    def stop(self) -> bool:
        """Stop watching for Alyx events."""
        if not self._running:
            return False
        
        if self._watcher:
            self._watcher.stop()
            self._watcher = None
        
        self._running = False
        self._haptics_settings = AlyxHapticsSettings.from_payload(None)
        logger.info("Alyx integration stopped")
        return True
    
    def _on_alyx_event(self, event: AlyxEvent):
        """Called when an Alyx event is detected."""
        self._events_received += 1
        self._last_event_ts = event.timestamp
        self._last_event_type = event.type
        
        logger.debug(f"Alyx event: {event.type} - {event.params}")

        # Track primary hand changes for hand-relative events.
        if event.type == "PrimaryHandChanged":
            self._primary_is_left = bool(event.params.get("is_primary_left", False))
        
        # Emit event to callback (for broadcasting)
        if self.on_game_event:
            self.on_game_event(event.type, event.params)
        
        # Map to haptics and trigger
        haptic_commands = map_event_to_haptics(
            event,
            settings=self._haptics_settings,
            primary_is_left=self._primary_is_left,
        )
        for cell, speed in haptic_commands:
            self._trigger(cell, speed)

        # Independent solenoid recoil on weapon fire (does not require vest toggle)
        if event.type == "PlayerShootWeapon":
            self._maybe_recoil(event)
    
    def _maybe_recoil(self, event: AlyxEvent) -> None:
        """Pulse USB relay solenoid if enabled and past cooldown."""
        st = self._haptics_settings
        if not st.solenoid_recoil_enabled or not self.on_recoil:
            return

        cd = float(st.cooldown_s.get("PlayerShootWeapon", 0.08) or 0.08)
        now = time.time()
        if (now - self._last_recoil_ts) < cd:
            return
        self._last_recoil_ts = now

        weapon = str(event.params.get("weapon", "") or "")
        duration_ms = duration_ms_for_weapon(weapon, st.solenoid_recoil_ms)
        try:
            self.on_recoil(duration_ms)
        except Exception as exc:
            logger.warning("Alyx solenoid recoil failed: %s", exc)
    
    def _trigger(self, cell: int, speed: int):
        """Trigger a haptic effect via callback."""
        if self.on_trigger:
            self.on_trigger(cell, speed)


# =============================================================================
# Mod/Script Resources
# =============================================================================

# URL to download the mod scripts
MOD_DOWNLOAD_URL = "https://www.nexusmods.com/halflifealyx/mods/6?tab=files"
MOD_GITHUB_URL = "https://github.com/floh-bhaptics/HalLifeAlyx_OWO/releases"

# Skill manifest addition required for the mod to work
SKILL_MANIFEST_ADDITION = """
# Add this line to: Half-Life Alyx/game/hlvr/cfg/skill_manifest.cfg
script_reload_code tactsuit.lua
"""

def get_mod_info() -> dict:
    """Get information about the required mod."""
    return {
        "name": "bHaptics Tactsuit for Half-Life: Alyx",
        "description": "Lua scripts that emit game events to console.log",
        "download_url": MOD_DOWNLOAD_URL,
        "github_url": MOD_GITHUB_URL,
        "install_instructions": [
            "1. Browse to Half-Life Alyx/game/hlvr/console.log (launch once with -condebug if missing)",
            "2. Click Install Mod — copies tactsuit.lua and adds script_reload_code tactsuit.lua to skill_manifest.cfg",
            "3. Start this integration, then use Launch via Steam (-condebug is included)",
        ],
        "skill_manifest_addition": SKILL_MANIFEST_ADDITION.strip(),
    }


def generate_skill_manifest_content() -> str:
    """Generate the skill_manifest.cfg content with mod enabled."""
    return """exec skill.cfg
exec skill_episodic.cfg
exec skill_hlvr.cfg

script_reload_code tactsuit.lua
"""


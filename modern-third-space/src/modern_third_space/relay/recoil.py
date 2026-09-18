"""
Solenoid / USB-relay recoil helpers shared by game integrations.

Maps weapon names to pulse durations. Pulse is skipped unless the relay is connected
(callers should still gate on user settings).
"""

from __future__ import annotations

from typing import Any, Dict, Optional

DEFAULT_RECOIL_MS = 40
MIN_RECOIL_MS = 25  # Below ~20–25 ms the LC module often misses OFF
MAX_RECOIL_MS = 120  # UI/game tuning cap for recoil feel
MAX_ON_MS = 1000  # Hard cap — safety timer also forces OFF at 1.0 s

# L4D2 weapon_fire / classname tokens that should not pulse the solenoid.
# Event strings are usually without the "weapon_" prefix (e.g. "melee", "pipe_bomb").
_NO_RECOIL_WEAPONS = frozenset(
    {
        # Melee slot (all bats/axes/katanas report as "melee")
        "melee",
        # Specific melee classnames / subtypes (if logged that way)
        "baseball_bat",
        "cricket_bat",
        "crowbar",
        "electric_guitar",
        "fireaxe",
        "frying_pan",
        "golfclub",
        "katana",
        "knife",
        "machete",
        "pitchfork",
        "shovel",
        "tonfa",
        "riotshield",
        "guandao",
        "sword",
        # Chainsaw
        "chainsaw",
        # Throwables / explosive "grenades"
        "molotov",
        "pipe_bomb",
        "pipebomb",
        "vomitjar",
        "vomit_jar",
        "bile_jar",
    }
)


def normalize_weapon_key(weapon: Optional[str]) -> str:
    """Lowercase weapon id with optional 'weapon_' prefix stripped."""
    w = (weapon or "").strip().lower().replace("-", "_").replace(" ", "_")
    if w.startswith("weapon_"):
        w = w[len("weapon_") :]
    return w


def should_pulse_recoil_for_weapon(weapon: Optional[str]) -> bool:
    """
    Return False for weapons that should not trigger mechanical recoil.

    Used by L4D2 (and safe to call elsewhere): skips melee, chainsaw, and grenades.
    Unknown / empty weapon names still pulse (fail open for guns we haven't listed).
    """
    key = normalize_weapon_key(weapon)
    if not key or key == "unknown":
        return True
    if key in _NO_RECOIL_WEAPONS:
        return False
    # Substring guards for odd classname variants
    if "chainsaw" in key:
        return False
    if key.endswith("_melee") or key.startswith("melee_"):
        return False
    if any(k in key for k in ("molotov", "pipe_bomb", "vomitjar")):
        return False
    return True


def clamp_duration_ms(duration_ms: int) -> int:
    return max(MIN_RECOIL_MS, min(MAX_RECOIL_MS, int(duration_ms)))


def clamp_on_ms(duration_ms: int) -> int:
    """Clamp any ON duration to hardware-safe bounds (25–1000 ms)."""
    return max(MIN_RECOIL_MS, min(MAX_ON_MS, int(duration_ms)))


def duration_ms_for_weapon(weapon: Optional[str], default_ms: int = DEFAULT_RECOIL_MS) -> int:
    """
    Pick a pulse length from a weapon class / name string.

    Longer for slow heavy weapons; shorter for automatic fire.
    """
    w = normalize_weapon_key(weapon)
    if any(k in w for k in ("shotgun", "shell", "autoshotgun", "pumpshotgun", "chrome", "spas")):
        return clamp_duration_ms(max(default_ms, 70))
    if any(k in w for k in ("sniper", "hunting", "military", "awp", "scout", "magnum")):
        return clamp_duration_ms(max(default_ms, 55))
    if any(k in w for k in ("smg", "uzi", "rapidfire", "mp5", "silenced")):
        return clamp_duration_ms(min(default_ms, 25))
    if any(k in w for k in ("rifle", "ak47", "m16", "scar", "desert", "ar2")):
        return clamp_duration_ms(min(default_ms, 35))
    if any(k in w for k in ("pistol", "pistol_magnum", "dual")):
        return clamp_duration_ms(default_ms)
    return clamp_duration_ms(default_ms)


def parse_solenoid_settings(payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Normalize solenoid recoil settings from a daemon/UI payload.

    Accepted shapes:
      {"solenoid_recoil": {"enabled": true, "duration_ms": 40, "hold_on_reload": false}}
      {"enabled": true, "duration_ms": 40, "hold_on_reload": true}
    """
    enabled = True
    duration_ms = DEFAULT_RECOIL_MS
    hold_on_reload = False

    raw: Any = payload
    if isinstance(payload, dict) and "solenoid_recoil" in payload:
        raw = payload.get("solenoid_recoil")

    if isinstance(raw, dict):
        if "enabled" in raw:
            enabled = bool(raw.get("enabled"))
        if raw.get("duration_ms") is not None:
            try:
                duration_ms = clamp_duration_ms(int(raw["duration_ms"]))
            except (TypeError, ValueError):
                duration_ms = DEFAULT_RECOIL_MS
        if "hold_on_reload" in raw:
            hold_on_reload = bool(raw.get("hold_on_reload"))
        elif "holdOnReload" in raw:
            hold_on_reload = bool(raw.get("holdOnReload"))

    return {
        "enabled": enabled,
        "duration_ms": duration_ms,
        "hold_on_reload": hold_on_reload,
    }

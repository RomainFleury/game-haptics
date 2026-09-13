"""
Game Integration Registry - Defines the structure and requirements for game integrations.

This module provides:
1. A registry of all supported game integrations
2. Schema validation for integration components
3. Utilities for checking integration consistency

All new game integrations MUST be registered here and pass validation tests.
"""

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import List, Optional, Dict, Any, Callable
import importlib
import inspect


class IntegrationType(Enum):
    """Type of integration method used to receive game events."""
    HTTP_GSI = "http_gsi"           # HTTP POST endpoint (e.g., CS2 GSI)
    LOG_FILE = "log_file"           # Console.log file watching (e.g., Alyx, L4D2)
    TCP_CLIENT = "tcp_client"       # Game mod connects to daemon as TCP client (e.g., SimHub plugin)
    PLUGIN = "plugin"               # External plugin (e.g., SimHub)
    SCREEN_CAPTURE = "screen_capture"  # Visual signal detection via screen capture (generic)


class IntegrationStatus(Enum):
    """Development status of an integration."""
    STABLE = "stable"               # Fully implemented and tested
    BETA = "beta"                   # Working but may have issues
    PLANNED = "planned"             # Documented but not implemented
    DEPRECATED = "deprecated"       # No longer maintained


@dataclass
class GameIntegrationSpec:
    """
    Specification for a game integration.
    
    This defines what components a game integration should have
    and where they are located.
    """
    # Required fields
    game_id: str                    # Unique identifier (e.g., "cs2", "alyx", "simhub")
    game_name: str                  # Display name (e.g., "Counter-Strike 2")
    integration_type: IntegrationType
    status: IntegrationStatus
    
    # Manager module (Python path relative to modern_third_space.server)
    manager_module: Optional[str] = None    # e.g., "cs2_manager"
    manager_class: Optional[str] = None     # e.g., "CS2Manager"
    
    # Standalone integration module (Python path relative to modern_third_space.integrations)
    integration_module: Optional[str] = None  # e.g., "cs2_gsi"
    integration_class: Optional[str] = None   # e.g., "CS2GSIIntegration"
    
    # Daemon commands (if managed by daemon)
    daemon_commands: List[str] = field(default_factory=list)  # e.g., ["cs2_start", "cs2_stop", "cs2_status"]
    
    # Event types emitted by this integration
    event_types: List[str] = field(default_factory=list)  # e.g., ["player_damage", "player_death"]
    
    # Cell mapping function (if directional damage is supported)
    has_directional_damage: bool = False
    
    # Documentation file (relative to project root)
    docs_file: Optional[str] = None  # e.g., "docs-external-integrations-ideas/CS2_INTEGRATION.md"
    
    # Required launch options or setup for the game
    launch_options: Optional[str] = None  # e.g., "-condebug"
    
    # Whether this integration requires an external mod to be installed
    requires_external_mod: bool = False
    mod_url: Optional[str] = None


# =============================================================================
# GAME INTEGRATION REGISTRY
# =============================================================================
# All game integrations MUST be registered here.
# This is the source of truth for what integrations exist.

GAME_INTEGRATIONS: Dict[str, GameIntegrationSpec] = {}


def register_integration(spec: GameIntegrationSpec) -> GameIntegrationSpec:
    """Register a game integration specification."""
    if spec.game_id in GAME_INTEGRATIONS:
        raise ValueError(f"Integration '{spec.game_id}' is already registered")
    GAME_INTEGRATIONS[spec.game_id] = spec
    return spec


def get_integration(game_id: str) -> Optional[GameIntegrationSpec]:
    """Get a game integration specification by ID."""
    return GAME_INTEGRATIONS.get(game_id)


def list_integrations(
    status: Optional[IntegrationStatus] = None,
    integration_type: Optional[IntegrationType] = None
) -> List[GameIntegrationSpec]:
    """List all registered integrations, optionally filtered."""
    integrations = list(GAME_INTEGRATIONS.values())
    
    if status:
        integrations = [i for i in integrations if i.status == status]
    if integration_type:
        integrations = [i for i in integrations if i.integration_type == integration_type]
    
    return integrations


# =============================================================================
# REGISTERED GAME INTEGRATIONS
# =============================================================================
# Add new game integrations here.

# Counter-Strike 2 (GSI)
register_integration(GameIntegrationSpec(
    game_id="cs2",
    game_name="Counter-Strike 2",
    integration_type=IntegrationType.HTTP_GSI,
    status=IntegrationStatus.STABLE,
    manager_module="cs2_manager",
    manager_class="CS2Manager",
    integration_module="cs2_gsi",
    integration_class="CS2GSIIntegration",
    daemon_commands=["cs2_start", "cs2_stop", "cs2_status", "cs2_generate_config"],
    event_types=["player_damage", "player_death", "player_flash", "bomb_planted", "bomb_exploded", "round_start"],
    has_directional_damage=False,  # CS2 GSI doesn't provide hit direction
    docs_file="docs-external-integrations-ideas/CS2_INTEGRATION.md",
))

# Half-Life: Alyx
register_integration(GameIntegrationSpec(
    game_id="alyx",
    game_name="Half-Life: Alyx",
    integration_type=IntegrationType.LOG_FILE,
    status=IntegrationStatus.STABLE,
    manager_module="alyx_manager",
    manager_class="AlyxManager",
    daemon_commands=["alyx_start", "alyx_stop", "alyx_status", "alyx_get_mod_info"],
    event_types=[
        "PlayerHurt", "PlayerDeath", "PlayerShootWeapon", "PlayerHealth",
        "PlayerHeal", "PlayerGrabbityPull", "GrabbityGloveCatch",
        "PlayerGrabbedByBarnacle", "PlayerCoughStart", "Reset"
    ],
    has_directional_damage=True,
    docs_file="docs-external-integrations-ideas/ALYX_INTEGRATION.md",
    launch_options="-condebug",
    requires_external_mod=True,
    mod_url="https://www.nexusmods.com/halflifealyx/mods/6",
))

# Left 4 Dead 2
register_integration(GameIntegrationSpec(
    game_id="l4d2",
    game_name="Left 4 Dead 2",
    integration_type=IntegrationType.LOG_FILE,
    status=IntegrationStatus.STABLE,
    manager_module="l4d2_manager",
    manager_class="L4D2Manager",
    daemon_commands=["l4d2_start", "l4d2_stop", "l4d2_status"],
    event_types=[
        "player_damage", "player_death", "player_incap", "weapon_fire",
        "adrenaline_used", "player_healed"
    ],
    has_directional_damage=True,
    launch_options="-condebug",
))

# Pistol Whip (MelonLoader TCP client)
register_integration(GameIntegrationSpec(
    game_id="pistolwhip",
    game_name="Pistol Whip",
    integration_type=IntegrationType.TCP_CLIENT,
    status=IntegrationStatus.BETA,
    manager_module="pistolwhip_manager",
    manager_class="PistolWhipManager",
    daemon_commands=["pistolwhip_start", "pistolwhip_stop", "pistolwhip_status", "pistolwhip_event"],
    event_types=[
        "gun_fire", "shotgun_fire", "empty_gun_fire", "melee_hit",
        "reload_hip", "reload_shoulder", "player_hit", "death",
        "low_health", "healing",
    ],
    has_directional_damage=False,
    docs_file="docs-external-integrations-ideas/PISTOLWHIP_INTEGRATION.md",
    requires_external_mod=True,
    mod_url="https://github.com/floh-bhaptics/PistolWhip_bhaptics",
))

# Warhammer 40,000: Battle Sister (MelonLoader TCP client)
register_integration(GameIntegrationSpec(
    game_id="battlesister",
    game_name="Warhammer 40,000: Battle Sister",
    integration_type=IntegrationType.TCP_CLIENT,
    status=IntegrationStatus.BETA,
    manager_module="battlesister_manager",
    manager_class="BattleSisterManager",
    daemon_commands=["battlesister_start", "battlesister_stop", "battlesister_status", "battlesister_event"],
    event_types=[
        "gun_fire", "shotgun_fire", "melee_hit", "two_hand",
        "player_hit", "blade_hit", "explosion", "death",
        "low_health", "low_health_end",
    ],
    has_directional_damage=True,
    docs_file="docs-external-integrations-ideas/BATTLESISTER_INTEGRATION.md",
    requires_external_mod=True,
    mod_url="https://github.com/floh-bhaptics/BattleSister_bhaptics",
))

# Gunman Contracts Standalone (MelonLoader TCP client)
register_integration(GameIntegrationSpec(
    game_id="gunmancontracts",
    game_name="Gunman Contracts Standalone",
    integration_type=IntegrationType.TCP_CLIENT,
    status=IntegrationStatus.BETA,
    manager_module="gunmancontracts_manager",
    manager_class="GunmanContractsManager",
    daemon_commands=[
        "gunmancontracts_start",
        "gunmancontracts_stop",
        "gunmancontracts_status",
        "gunmancontracts_event",
    ],
    event_types=[
        "gun_fire", "shotgun_fire", "rifle_fire", "bow_fire",
        "player_hit", "holster_in", "holster_out", "heartbeat",
    ],
    has_directional_damage=True,
    docs_file="docs-external-integrations-ideas/GUNMANCONTRACTS_INTEGRATION.md",
    requires_external_mod=True,
    mod_url="https://github.com/floh-bhaptics/GunmanContracts_bhaptics",
))

# Generic Screen Health Watcher (screen capture)
register_integration(GameIntegrationSpec(
    game_id="screen_health",
    game_name="Generic Screen Health (Screen Capture)",
    integration_type=IntegrationType.SCREEN_CAPTURE,
    status=IntegrationStatus.BETA,
    manager_module="screen_health_manager",
    manager_class="ScreenHealthManager",
    daemon_commands=["screen_health_start", "screen_health_stop", "screen_health_status"],
    event_types=["hit_recorded"],
    has_directional_damage=True,
    docs_file="docs-feature-ideas/generic-screen-health-watcher/conception/initial-project.md",
))


# =============================================================================
# VALIDATION UTILITIES
# =============================================================================

def validate_integration(spec: GameIntegrationSpec) -> List[str]:
    """
    Validate that a game integration spec is complete and consistent.
    
    Returns a list of validation errors (empty if valid).
    """
    errors = []
    
    # Must have game_id and game_name
    if not spec.game_id:
        errors.append("game_id is required")
    if not spec.game_name:
        errors.append("game_name is required")
    
    # If status is STABLE or BETA, must have manager or integration
    if spec.status in (IntegrationStatus.STABLE, IntegrationStatus.BETA):
        if not spec.manager_module and not spec.integration_module:
            errors.append("STABLE/BETA integrations must have manager_module or integration_module")
        
        # If manager exists, check it's importable
        if spec.manager_module:
            try:
                module = importlib.import_module(f"modern_third_space.server.{spec.manager_module}")
                if spec.manager_class and not hasattr(module, spec.manager_class):
                    errors.append(f"Manager class '{spec.manager_class}' not found in {spec.manager_module}")
            except ImportError as e:
                errors.append(f"Cannot import manager module: {e}")
        
        # If integration exists, check it's importable
        if spec.integration_module:
            try:
                module = importlib.import_module(f"modern_third_space.integrations.{spec.integration_module}")
                if spec.integration_class and not hasattr(module, spec.integration_class):
                    errors.append(f"Integration class '{spec.integration_class}' not found in {spec.integration_module}")
            except ImportError as e:
                errors.append(f"Cannot import integration module: {e}")
    
    # Daemon commands should follow naming convention
    for cmd in spec.daemon_commands:
        if not cmd.startswith(spec.game_id):
            errors.append(f"Daemon command '{cmd}' should start with '{spec.game_id}_'")
    
    # If has_directional_damage, should have event with damage angle
    # (This is advisory, not an error)
    
    return errors


def validate_all_integrations() -> Dict[str, List[str]]:
    """
    Validate all registered integrations.
    
    Returns a dict of game_id -> list of errors.
    Only includes integrations with errors.
    """
    results = {}
    for game_id, spec in GAME_INTEGRATIONS.items():
        errors = validate_integration(spec)
        if errors:
            results[game_id] = errors
    return results


# =============================================================================
# INTEGRATION COMPONENT CHECKING
# =============================================================================

def check_manager_has_required_methods(spec: GameIntegrationSpec) -> List[str]:
    """
    Check that a manager class has required methods.
    
    Required for log-file watchers:
    - start(self, ...) -> tuple[bool, Optional[str]]
    - stop(self) -> bool
    - is_running property
    
    Required for TCP client handlers:
    - process_event(self, ...) -> bool
    - enable(self) -> None
    - disable(self) -> None
    - enabled property
    
    Returns list of missing methods.
    """
    if not spec.manager_module or not spec.manager_class:
        return []
    
    try:
        module = importlib.import_module(f"modern_third_space.server.{spec.manager_module}")
        cls = getattr(module, spec.manager_class)
    except (ImportError, AttributeError):
        return [f"Cannot import {spec.manager_class}"]
    
    missing = []
    
    if spec.integration_type == IntegrationType.LOG_FILE:
        # Log file watchers should have start/stop
        required = ["start", "stop"]
        properties = ["is_running"]
    elif spec.integration_type == IntegrationType.TCP_CLIENT:
        # TCP client handlers should have process_event
        required = ["process_event", "enable", "disable"]
        properties = ["enabled"]
    else:
        required = []
        properties = []
    
    for method in required:
        if not hasattr(cls, method) or not callable(getattr(cls, method)):
            missing.append(f"method: {method}")
    
    for prop in properties:
        if not hasattr(cls, prop):
            missing.append(f"property: {prop}")
    
    return missing


def check_haptic_mapping_function(spec: GameIntegrationSpec) -> Optional[str]:
    """
    Check that an integration has a haptic mapping function.
    
    Expected: map_event_to_haptics(event) -> List[Tuple[int, int]]
    
    Returns error message or None if valid.
    """
    if not spec.manager_module:
        return None
    
    try:
        module = importlib.import_module(f"modern_third_space.server.{spec.manager_module}")
    except ImportError:
        return f"Cannot import {spec.manager_module}"
    
    if not hasattr(module, "map_event_to_haptics"):
        return "Missing map_event_to_haptics function"
    
    func = getattr(module, "map_event_to_haptics")
    if not callable(func):
        return "map_event_to_haptics is not callable"
    
    # Check signature
    sig = inspect.signature(func)
    if len(sig.parameters) < 1:
        return "map_event_to_haptics should accept at least one parameter (event)"
    
    return None

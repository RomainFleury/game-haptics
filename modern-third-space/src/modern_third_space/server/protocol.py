"""
Protocol definitions for the vest daemon.

This module defines the JSON message format for communication between
clients and the daemon. All messages are newline-delimited JSON.

Message Types:
- Commands: Client → Daemon requests
- Events: Daemon → All Clients broadcasts  
- Responses: Daemon → Requesting Client replies
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Union
from enum import Enum


class CommandType(Enum):
    """Valid command types from clients."""
    # Health check
    PING = "ping"
    # Device discovery & selection
    LIST = "list"
    SELECT_DEVICE = "select_device"
    GET_SELECTED_DEVICE = "get_selected_device"
    CLEAR_DEVICE = "clear_device"
    # Multi-vest commands
    LIST_CONNECTED_DEVICES = "list_connected_devices"
    SET_MAIN_DEVICE = "set_main_device"
    DISCONNECT_DEVICE = "disconnect_device"
    # Mock device commands
    CREATE_MOCK_DEVICE = "create_mock_device"
    REMOVE_MOCK_DEVICE = "remove_mock_device"
    # Player management commands
    CREATE_PLAYER = "create_player"
    ASSIGN_PLAYER = "assign_player"
    UNASSIGN_PLAYER = "unassign_player"
    LIST_PLAYERS = "list_players"
    GET_PLAYER_DEVICE = "get_player_device"
    # Game-specific player mapping commands
    SET_GAME_PLAYER_MAPPING = "set_game_player_mapping"
    CLEAR_GAME_PLAYER_MAPPING = "clear_game_player_mapping"
    LIST_GAME_PLAYER_MAPPINGS = "list_game_player_mappings"
    # Vest control
    CONNECT = "connect"
    DISCONNECT = "disconnect"
    TRIGGER = "trigger"
    STOP = "stop"
    STATUS = "status"
    # CS2 GSI integration
    CS2_START = "cs2_start"
    CS2_STOP = "cs2_stop"
    CS2_STATUS = "cs2_status"
    CS2_GENERATE_CONFIG = "cs2_generate_config"
    # Half-Life: Alyx integration
    ALYX_START = "alyx_start"
    ALYX_STOP = "alyx_stop"
    ALYX_STATUS = "alyx_status"
    ALYX_GET_MOD_INFO = "alyx_get_mod_info"
    # Left 4 Dead 2 integration
    L4D2_START = "l4d2_start"
    L4D2_STOP = "l4d2_stop"
    L4D2_STATUS = "l4d2_status"
    # Pistol Whip (MelonLoader TCP client)
    PISTOLWHIP_START = "pistolwhip_start"
    PISTOLWHIP_STOP = "pistolwhip_stop"
    PISTOLWHIP_STATUS = "pistolwhip_status"
    PISTOLWHIP_EVENT = "pistolwhip_event"
    # Warhammer 40,000: Battle Sister (MelonLoader TCP client)
    BATTLESISTER_START = "battlesister_start"
    BATTLESISTER_STOP = "battlesister_stop"
    BATTLESISTER_STATUS = "battlesister_status"
    BATTLESISTER_EVENT = "battlesister_event"
    # Gunman Contracts Standalone (MelonLoader TCP client)
    GUNMANCONTRACTS_START = "gunmancontracts_start"
    GUNMANCONTRACTS_STOP = "gunmancontracts_stop"
    GUNMANCONTRACTS_STATUS = "gunmancontracts_status"
    GUNMANCONTRACTS_EVENT = "gunmancontracts_event"
    # Generic Screen Health Watcher (screen capture)
    SCREEN_HEALTH_START = "screen_health_start"
    SCREEN_HEALTH_STOP = "screen_health_stop"
    SCREEN_HEALTH_STATUS = "screen_health_status"
    SCREEN_HEALTH_TEST = "screen_health_test"
    # Daemon-wide OCR engine (ammo recoil)
    OCR_LIST_ENGINES = "ocr_list_engines"
    OCR_GET_SETTINGS = "ocr_get_settings"
    OCR_SET_ENGINE = "ocr_set_engine"
    # Predefined effects
    PLAY_EFFECT = "play_effect"
    LIST_EFFECTS = "list_effects"
    STOP_EFFECT = "stop_effect"
    # USB LC relay (solenoid / recoil)
    RELAY_LIST_PORTS = "relay_list_ports"
    RELAY_CONNECT = "relay_connect"
    RELAY_DISCONNECT = "relay_disconnect"
    RELAY_STATUS = "relay_status"
    RELAY_SET = "relay_set"
    RELAY_PULSE = "relay_pulse"
    RELAY_MOUSE_START = "relay_mouse_start"
    RELAY_MOUSE_STOP = "relay_mouse_stop"
    RELAY_MOUSE_STATUS = "relay_mouse_status"


class EventType(Enum):
    """Event types broadcast to all clients."""
    # Device selection
    DEVICE_SELECTED = "device_selected"
    DEVICE_CLEARED = "device_cleared"
    DEVICES_CHANGED = "devices_changed"
    # Multi-vest events
    DEVICE_CONNECTED = "device_connected"
    DEVICE_DISCONNECTED = "device_disconnected"
    MAIN_DEVICE_CHANGED = "main_device_changed"
    # Mock device events
    MOCK_DEVICE_CREATED = "mock_device_created"
    MOCK_DEVICE_REMOVED = "mock_device_removed"
    # Player management events
    PLAYER_ASSIGNED = "player_assigned"
    PLAYER_UNASSIGNED = "player_unassigned"
    # Game-specific player mapping events
    GAME_PLAYER_MAPPING_CHANGED = "game_player_mapping_changed"
    # Connection
    CONNECTED = "connected"
    DISCONNECTED = "disconnected"
    # Commands
    EFFECT_TRIGGERED = "effect_triggered"
    ALL_STOPPED = "all_stopped"
    # Clients
    CLIENT_CONNECTED = "client_connected"
    CLIENT_DISCONNECTED = "client_disconnected"
    # Errors
    ERROR = "error"
    # CS2 GSI integration
    CS2_STARTED = "cs2_started"
    CS2_STOPPED = "cs2_stopped"
    CS2_GAME_EVENT = "cs2_game_event"
    # Half-Life: Alyx integration
    ALYX_STARTED = "alyx_started"
    ALYX_STOPPED = "alyx_stopped"
    ALYX_GAME_EVENT = "alyx_game_event"
    # Left 4 Dead 2 integration
    L4D2_STARTED = "l4d2_started"
    L4D2_STOPPED = "l4d2_stopped"
    L4D2_GAME_EVENT = "l4d2_game_event"
    # Pistol Whip
    PISTOLWHIP_STARTED = "pistolwhip_started"
    PISTOLWHIP_STOPPED = "pistolwhip_stopped"
    PISTOLWHIP_GAME_EVENT = "pistolwhip_game_event"
    # Warhammer 40,000: Battle Sister
    BATTLESISTER_STARTED = "battlesister_started"
    BATTLESISTER_STOPPED = "battlesister_stopped"
    BATTLESISTER_GAME_EVENT = "battlesister_game_event"
    # Gunman Contracts Standalone
    GUNMANCONTRACTS_STARTED = "gunmancontracts_started"
    GUNMANCONTRACTS_STOPPED = "gunmancontracts_stopped"
    GUNMANCONTRACTS_GAME_EVENT = "gunmancontracts_game_event"
    # Generic Screen Health Watcher (screen capture)
    SCREEN_HEALTH_STARTED = "screen_health_started"
    SCREEN_HEALTH_STOPPED = "screen_health_stopped"
    SCREEN_HEALTH_HIT = "screen_health_hit"
    SCREEN_HEALTH_HEALTH = "screen_health_health"
    SCREEN_HEALTH_VALUE = "screen_health_value"
    SCREEN_HEALTH_DEBUG = "screen_health_debug"
    SCREEN_HEALTH_RECOIL = "screen_health_recoil"
    # Predefined effects
    EFFECT_STARTED = "effect_started"
    EFFECT_COMPLETED = "effect_completed"
    # USB LC relay (solenoid / recoil)
    RELAY_CONNECTED = "relay_connected"
    RELAY_DISCONNECTED = "relay_disconnected"
    RELAY_STATE_CHANGED = "relay_state_changed"
    RELAY_PULSED = "relay_pulsed"
    RELAY_MOUSE_STARTED = "relay_mouse_started"
    RELAY_MOUSE_STOPPED = "relay_mouse_stopped"


@dataclass
class Command:
    """A command from a client."""
    cmd: str
    req_id: Optional[str] = None
    # Device selection params
    bus: Optional[int] = None
    address: Optional[int] = None
    serial: Optional[str] = None
    # Trigger params
    cell: Optional[int] = None
    speed: Optional[int] = None
    # CS2 GSI params
    gsi_port: Optional[int] = None
    # Half-Life: Alyx params
    log_path: Optional[str] = None
    # Half-Life: Alyx settings (optional)
    # Passed on alyx_start to control per-event haptics gating.
    # Expected schema (v1):
    # {
    #   "enabled_events": { "PlayerHurt": true, "PlayerShootWeapon": false, ... }
    # }
    alyx_settings: Optional[Dict[str, Any]] = None
    # Generic params
    message: Optional[str] = None  # Used for player name or other messages
    # Generic game event params (for TCP client integrations)
    event: Optional[str] = None  # Event name
    hand: Optional[str] = None   # "left" or "right" for hand-specific events
    priority: Optional[int] = None
    angle: Optional[float] = None  # Damage angle in degrees
    weapon: Optional[str] = None  # Optional weapon class (pistol/shotgun/rifle/…)
    holster: Optional[str] = None  # Optional holster slot ("hip" | "shoulder")
    damage: Optional[float] = None  # Damage amount
    health_remaining: Optional[float] = None  # Remaining health
    cause: Optional[str] = None  # Death cause
    # Predefined effects params
    effect_name: Optional[str] = None  # Effect to play
    # Multi-vest support
    device_id: Optional[str] = None  # Target specific device
    player_id: Optional[str] = None  # Target global player's device
    game_id: Optional[str] = None  # Game identifier for game-specific mapping
    player_num: Optional[int] = None  # Player number (1, 2, 3...) for game-specific mapping
    # Generic screen health watcher params
    profile: Optional[Dict[str, Any]] = None  # Screen health profile JSON
    output_dir: Optional[str] = None  # Optional output dir for test/debug artifacts
    # For screen_health_test only: tight row-major BGRA bytes on disk (path + dimensions; see daemon).
    frame_bgra_path: Optional[str] = None
    frame_bgra_base64: Optional[str] = None  # legacy; prefer frame_bgra_path
    frame_width: Optional[int] = None
    frame_height: Optional[int] = None
    # USB LC relay params
    port: Optional[str] = None  # Serial port path (e.g. COM3)
    baud: Optional[int] = None  # Serial baud rate (default 9600)
    switch_address: Optional[int] = None  # Relay switch address (default 0x01)
    on: Optional[bool] = None  # Relay on/off for relay_set
    duration_ms: Optional[int] = None  # Pulse duration for relay_pulse
    solenoid_recoil: Optional[Dict[str, Any]] = None  # {"enabled": bool, "duration_ms": int}
    fire_mode: Optional[str] = None  # single | burst | fullauto
    fire_rate_rpm: Optional[int] = None  # rounds per minute
    burst_count: Optional[int] = None  # shots per burst
    ocr_engine: Optional[str] = None  # ammo OCR backend id

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Command":
        """Parse a command from a dictionary."""
        return cls(
            cmd=data.get("cmd", ""),
            req_id=data.get("req_id"),
            bus=data.get("bus"),
            address=data.get("address"),
            serial=data.get("serial"),
            cell=data.get("cell"),
            speed=data.get("speed"),
            gsi_port=data.get("gsi_port"),
            log_path=data.get("log_path"),
            alyx_settings=data.get("alyx_settings"),
            message=data.get("message"),
            event=data.get("event"),
            hand=data.get("hand"),
            priority=data.get("priority"),
            angle=data.get("angle"),
            weapon=data.get("weapon"),
            holster=data.get("holster"),
            damage=data.get("damage"),
            health_remaining=data.get("health_remaining"),
            cause=data.get("cause"),
            effect_name=data.get("effect_name"),
            device_id=data.get("device_id"),
            player_id=data.get("player_id"),
            game_id=data.get("game_id"),
            player_num=data.get("player_num"),
            profile=data.get("profile"),
            output_dir=data.get("output_dir"),
            frame_bgra_path=data.get("frame_bgra_path"),
            frame_bgra_base64=data.get("frame_bgra_base64"),
            frame_width=data.get("frame_width"),
            frame_height=data.get("frame_height"),
            port=data.get("port"),
            baud=data.get("baud"),
            switch_address=data.get("switch_address"),
            on=data.get("on"),
            duration_ms=data.get("duration_ms"),
            solenoid_recoil=data.get("solenoid_recoil"),
            fire_mode=data.get("fire_mode"),
            fire_rate_rpm=data.get("fire_rate_rpm"),
            burst_count=data.get("burst_count"),
            ocr_engine=data.get("ocr_engine"),
        )
    
    @classmethod
    def from_json(cls, line: str) -> "Command":
        """Parse a command from a JSON line."""
        data = json.loads(line.strip())
        return cls.from_dict(data)
    
    def is_valid(self) -> bool:
        """Check if command type is valid."""
        try:
            CommandType(self.cmd)
            return True
        except ValueError:
            return False


@dataclass
class Event:
    """An event broadcast to all clients."""
    event: str
    ts: float = field(default_factory=time.time)
    # Device info
    device: Optional[Dict[str, Any]] = None
    devices: Optional[List[Dict[str, Any]]] = None
    # Command info
    cell: Optional[int] = None
    speed: Optional[int] = None
    # Client info
    client_id: Optional[str] = None
    client_name: Optional[str] = None
    # Error info
    message: Optional[str] = None
    # CS2 GSI info
    gsi_port: Optional[int] = None
    event_type: Optional[str] = None  # For cs2_game_event: "damage", "death", etc.
    amount: Optional[int] = None      # For damage amount
    intensity: Optional[int] = None   # For flash intensity
    # Half-Life: Alyx info
    log_path: Optional[str] = None
    params: Optional[Dict[str, Any]] = None  # For alyx_game_event params
    # Generic game event info
    hand: Optional[str] = None  # "left" or "right" for hand-specific events
    # Predefined effects info
    effect_name: Optional[str] = None  # Name of effect being played/completed
    # Multi-vest support
    device_id: Optional[str] = None  # Device ID that triggered the event
    player_id: Optional[str] = None  # Player ID that triggered the event
    player_num: Optional[int] = None  # Player number for game-specific events
    game_id: Optional[str] = None  # Game ID for game-specific events
    # Generic screen health watcher
    profile_name: Optional[str] = None
    score: Optional[float] = None
    direction: Optional[str] = None
    health_percent: Optional[float] = None
    detector: Optional[str] = None
    health_value: Optional[int] = None
    # USB LC relay events
    port: Optional[str] = None
    on: Optional[bool] = None
    duration_ms: Optional[int] = None
    relay: Optional[Dict[str, Any]] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary, excluding None values."""
        result = {"event": self.event, "ts": self.ts}
        for key, value in asdict(self).items():
            if key not in ("event", "ts") and value is not None:
                result[key] = value
        return result
    
    def to_json(self) -> str:
        """Convert to JSON line (with newline)."""
        return json.dumps(self.to_dict()) + "\n"


@dataclass
class Response:
    """A response to a specific client."""
    response: str
    req_id: Optional[str] = None
    # Multi-vest support
    device_id: Optional[str] = None
    # Status response
    connected: Optional[bool] = None
    device: Optional[Dict[str, Any]] = None
    # List response
    devices: Optional[List[Dict[str, Any]]] = None
    # Error response
    message: Optional[str] = None
    # Success indicator
    ok: Optional[bool] = None
    success: Optional[bool] = None  # Alternative to ok for some responses
    # Ping response
    alive: Optional[bool] = None
    has_device_selected: Optional[bool] = None
    client_count: Optional[int] = None
    # CS2 GSI response
    gsi_port: Optional[int] = None
    running: Optional[bool] = None
    events_received: Optional[int] = None
    last_event_ts: Optional[float] = None
    last_event_type: Optional[str] = None
    config_content: Optional[str] = None
    filename: Optional[str] = None
    # Half-Life: Alyx response
    log_path: Optional[str] = None
    mod_info: Optional[Dict[str, Any]] = None
    # Generic screen health watcher response
    profile_name: Optional[str] = None
    last_hit_ts: Optional[float] = None
    test_result: Optional[Dict[str, Any]] = None
    # Predefined effects response
    effects: Optional[List[Dict[str, Any]]] = None
    categories: Optional[List[str]] = None
    # USB LC relay response
    ports: Optional[List[Dict[str, Any]]] = None
    relay: Optional[Dict[str, Any]] = None
    on: Optional[bool] = None
    duration_ms: Optional[int] = None
    pulses: Optional[int] = None
    fire_mode: Optional[str] = None
    fire_rate_rpm: Optional[int] = None
    burst_count: Optional[int] = None
    interval_ms: Optional[int] = None
    # Daemon OCR settings
    ocr_engine: Optional[str] = None
    ocr_engines: Optional[List[Dict[str, Any]]] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary, excluding None values."""
        result = {"response": self.response}
        for key, value in asdict(self).items():
            if key != "response" and value is not None:
                result[key] = value
        return result
    
    def to_json(self) -> str:
        """Convert to JSON line (with newline)."""
        return json.dumps(self.to_dict()) + "\n"


# Factory functions for common events
def event_device_selected(device: Dict[str, Any]) -> Event:
    return Event(event=EventType.DEVICE_SELECTED.value, device=device)

def event_device_cleared() -> Event:
    return Event(event=EventType.DEVICE_CLEARED.value)

def event_devices_changed(devices: List[Dict[str, Any]]) -> Event:
    return Event(event=EventType.DEVICES_CHANGED.value, devices=devices)

def event_connected(device: Dict[str, Any]) -> Event:
    return Event(event=EventType.CONNECTED.value, device=device)

def event_disconnected() -> Event:
    return Event(event=EventType.DISCONNECTED.value)

def event_effect_triggered(cell: int, speed: int, device_id: Optional[str] = None) -> Event:
    """Create an effect_triggered event."""
    return Event(
        event=EventType.EFFECT_TRIGGERED.value,
        cell=cell,
        speed=speed,
        device_id=device_id,
    )

def event_all_stopped(device_id: Optional[str] = None) -> Event:
    """Create an all_stopped event."""
    return Event(
        event=EventType.ALL_STOPPED.value,
        device_id=device_id,
    )

def event_client_connected(client_id: str, client_name: Optional[str] = None) -> Event:
    return Event(event=EventType.CLIENT_CONNECTED.value, client_id=client_id, client_name=client_name)

def event_client_disconnected(client_id: str) -> Event:
    return Event(event=EventType.CLIENT_DISCONNECTED.value, client_id=client_id)

def event_error(message: str) -> Event:
    return Event(event=EventType.ERROR.value, message=message)

# Multi-vest event helpers
def event_device_connected(device: Dict[str, Any], device_id: str) -> Event:
    """Create a device_connected event."""
    event_data = device.copy()
    event_data["device_id"] = device_id
    return Event(
        event=EventType.DEVICE_CONNECTED.value,
        device=event_data,
        device_id=device_id,
    )

def event_device_disconnected(device_id: str) -> Event:
    """Create a device_disconnected event."""
    return Event(
        event=EventType.DEVICE_DISCONNECTED.value,
        device_id=device_id,
    )

def event_mock_device_created(device: Dict[str, Any], device_id: str) -> Event:
    """Create a mock_device_created event."""
    event_data = device.copy()
    event_data["device_id"] = device_id
    return Event(
        event=EventType.MOCK_DEVICE_CREATED.value,
        device=event_data,
        device_id=device_id,
    )

def event_mock_device_removed(device_id: str) -> Event:
    """Create a mock_device_removed event."""
    return Event(
        event=EventType.MOCK_DEVICE_REMOVED.value,
        device_id=device_id,
    )

def event_main_device_changed(device_id: str, device: Optional[Dict[str, Any]] = None) -> Event:
    """Create a main_device_changed event."""
    return Event(
        event=EventType.MAIN_DEVICE_CHANGED.value,
        device_id=device_id,
        device=device,
    )

# Player management event helpers
def event_player_assigned(player_id: str, device_id: str, name: Optional[str] = None) -> Event:
    """Create a player_assigned event."""
    return Event(
        event=EventType.PLAYER_ASSIGNED.value,
        player_id=player_id,
        device_id=device_id,
        message=name,  # Use message field for player name
    )

def event_player_unassigned(player_id: str) -> Event:
    """Create a player_unassigned event."""
    return Event(
        event=EventType.PLAYER_UNASSIGNED.value,
        player_id=player_id,
    )

# Game-specific player mapping event helpers
def event_game_player_mapping_changed(game_id: str, player_num: int, device_id: Optional[str] = None) -> Event:
    """Create a game_player_mapping_changed event."""
    return Event(
        event=EventType.GAME_PLAYER_MAPPING_CHANGED.value,
        game_id=game_id,
        player_num=player_num,
        device_id=device_id,
    )


# Factory functions for common responses
def response_ok(req_id: Optional[str] = None) -> Response:
    return Response(response="ok", req_id=req_id, ok=True)

def response_error(message: str, req_id: Optional[str] = None) -> Response:
    return Response(response="error", req_id=req_id, message=message)

def response_list(devices: List[Dict[str, Any]], req_id: Optional[str] = None) -> Response:
    return Response(response="list", req_id=req_id, devices=devices)

def response_status(connected: bool, device: Optional[Dict[str, Any]], req_id: Optional[str] = None) -> Response:
    return Response(response="status", req_id=req_id, connected=connected, device=device)

def response_get_selected_device(device: Optional[Dict[str, Any]], req_id: Optional[str] = None) -> Response:
    return Response(response="get_selected_device", req_id=req_id, device=device)

# Multi-vest response helpers
def response_list_connected_devices(devices: List[Dict[str, Any]], req_id: Optional[str] = None) -> Response:
    """Response for list_connected_devices command."""
    return Response(response="list_connected_devices", req_id=req_id, success=True, devices=devices)

def response_set_main_device(
    success: bool,
    device_id: Optional[str] = None,
    device: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    """Response for set_main_device command."""
    device_dict = device.copy() if device else None
    if device_id and device_dict is not None and "device_id" not in device_dict:
        device_dict["device_id"] = device_id
    return Response(
        response="set_main_device",
        req_id=req_id,
        success=success,
        device_id=device_id,
        device=device_dict,
        message=error,
    )

def response_disconnect_device(success: bool, device_id: Optional[str] = None, error: Optional[str] = None, req_id: Optional[str] = None) -> Response:
    """Response for disconnect_device command."""
    return Response(
        response="disconnect_device",
        req_id=req_id,
        success=success,
        device_id=device_id,
        message=error,
    )

# Mock device response helpers
def response_create_mock_device(success: bool, device_id: Optional[str] = None, device: Optional[Dict[str, Any]] = None, error: Optional[str] = None, req_id: Optional[str] = None) -> Response:
    """Response for create_mock_device command."""
    # Include device_id in device dict if provided
    device_dict = device.copy() if device else {}
    if device_id and device_dict:
        device_dict["device_id"] = device_id
    
    return Response(
        response="create_mock_device",
        req_id=req_id,
        success=success,
        device=device_dict if device_dict else device,
        message=error,
    )

def response_remove_mock_device(success: bool, device_id: Optional[str] = None, error: Optional[str] = None, req_id: Optional[str] = None) -> Response:
    """Response for remove_mock_device command."""
    # Create device dict if device_id is provided
    device = {"device_id": device_id} if device_id else None
    return Response(
        response="remove_mock_device",
        req_id=req_id,
        success=success,
        device=device,
        message=error,
    )

# Player management response helpers
def response_create_player(success: bool, player_id: Optional[str] = None, name: Optional[str] = None, error: Optional[str] = None, req_id: Optional[str] = None) -> Response:
    """Response for create_player command."""
    return Response(
        response="create_player",
        req_id=req_id,
        success=success,
        message=error or name,  # Use message for name or error
    )

def response_assign_player(success: bool, player_id: Optional[str] = None, device_id: Optional[str] = None, error: Optional[str] = None, req_id: Optional[str] = None) -> Response:
    """Response for assign_player command."""
    return Response(
        response="assign_player",
        req_id=req_id,
        success=success,
        message=error,
    )

def response_unassign_player(success: bool, player_id: Optional[str] = None, error: Optional[str] = None, req_id: Optional[str] = None) -> Response:
    """Response for unassign_player command."""
    return Response(
        response="unassign_player",
        req_id=req_id,
        success=success,
        message=error,
    )

def response_list_players(players: List[Dict[str, Any]], req_id: Optional[str] = None) -> Response:
    """Response for list_players command."""
    return Response(response="list_players", req_id=req_id, devices=players)  # Reuse devices field for players list

def response_get_player_device(device_id: Optional[str], player_id: Optional[str] = None, error: Optional[str] = None, req_id: Optional[str] = None) -> Response:
    """Response for get_player_device command."""
    # Create device dict if device_id is provided
    device = {"device_id": device_id} if device_id else None
    return Response(
        response="get_player_device",
        req_id=req_id,
        device=device,
        message=error,
    )

# Game-specific player mapping response helpers
def response_set_game_player_mapping(success: bool, game_id: Optional[str] = None, player_num: Optional[int] = None, device_id: Optional[str] = None, error: Optional[str] = None, req_id: Optional[str] = None) -> Response:
    """Response for set_game_player_mapping command."""
    return Response(
        response="set_game_player_mapping",
        req_id=req_id,
        success=success,
        message=error,
    )

def response_clear_game_player_mapping(success: bool, game_id: Optional[str] = None, error: Optional[str] = None, req_id: Optional[str] = None) -> Response:
    """Response for clear_game_player_mapping command."""
    return Response(
        response="clear_game_player_mapping",
        req_id=req_id,
        success=success,
        message=error,
    )

def response_list_game_player_mappings(mappings: List[Dict[str, Any]], req_id: Optional[str] = None) -> Response:
    """Response for list_game_player_mappings command."""
    return Response(response="list_game_player_mappings", req_id=req_id, devices=mappings)  # Reuse devices field for mappings list

def response_ping(
    connected: bool,
    has_device_selected: bool,
    client_count: int,
    req_id: Optional[str] = None,
) -> Response:
    """
    Ping response with daemon state summary.
    
    Useful for:
    - Checking if daemon is alive
    - Getting quick overview of state
    - Electron startup checks
    """
    return Response(
        response="ping",
        req_id=req_id,
        alive=True,
        connected=connected,
        has_device_selected=has_device_selected,
        client_count=client_count,
    )


# -------------------------------------------------------------------------
# CS2 GSI events and responses
# -------------------------------------------------------------------------

def event_cs2_started(gsi_port: int) -> Event:
    """CS2 GSI server started."""
    return Event(event=EventType.CS2_STARTED.value, gsi_port=gsi_port)

def event_cs2_stopped() -> Event:
    """CS2 GSI server stopped."""
    return Event(event=EventType.CS2_STOPPED.value)

def event_cs2_game_event(
    event_type: str,
    amount: Optional[int] = None,
    intensity: Optional[int] = None,
) -> Event:
    """
    CS2 game event (damage, death, flash, etc.).
    
    Args:
        event_type: Type of event ("damage", "death", "flash", "bomb_planted", etc.)
        amount: For damage events, the amount of damage
        intensity: For flash events, the flash intensity
    """
    return Event(
        event=EventType.CS2_GAME_EVENT.value,
        event_type=event_type,
        amount=amount,
        intensity=intensity,
    )

def response_cs2_start(success: bool, gsi_port: int, error: Optional[str] = None, req_id: Optional[str] = None) -> Response:
    """Response to cs2_start command."""
    return Response(
        response="cs2_start",
        req_id=req_id,
        success=success,
        gsi_port=gsi_port,
        message=error,
    )

def response_cs2_stop(success: bool, req_id: Optional[str] = None) -> Response:
    """Response to cs2_stop command."""
    return Response(
        response="cs2_stop",
        req_id=req_id,
        success=success,
    )

def response_cs2_status(
    running: bool,
    gsi_port: Optional[int] = None,
    events_received: int = 0,
    last_event_ts: Optional[float] = None,
    req_id: Optional[str] = None,
) -> Response:
    """Response to cs2_status command."""
    return Response(
        response="cs2_status",
        req_id=req_id,
        running=running,
        gsi_port=gsi_port,
        events_received=events_received,
        last_event_ts=last_event_ts,
    )

def response_cs2_generate_config(
    config_content: str,
    filename: str = "gamestate_integration_thirdspace.cfg",
    req_id: Optional[str] = None,
) -> Response:
    """Response to cs2_generate_config command."""
    return Response(
        response="cs2_generate_config",
        req_id=req_id,
        config_content=config_content,
        filename=filename,
    )


# -------------------------------------------------------------------------
# Half-Life: Alyx events and responses
# -------------------------------------------------------------------------

def event_alyx_started(log_path: str) -> Event:
    """Alyx integration started watching console.log."""
    return Event(event=EventType.ALYX_STARTED.value, log_path=log_path)

def event_alyx_stopped() -> Event:
    """Alyx integration stopped."""
    return Event(event=EventType.ALYX_STOPPED.value)

def event_alyx_game_event(
    event_type: str,
    params: Optional[Dict[str, Any]] = None,
) -> Event:
    """
    Alyx game event (damage, shoot, death, etc.).
    
    Args:
        event_type: Type of event ("PlayerHurt", "PlayerShootWeapon", "PlayerDeath", etc.)
        params: Event-specific parameters (angle, health, weapon, etc.)
    """
    return Event(
        event=EventType.ALYX_GAME_EVENT.value,
        event_type=event_type,
        params=params,
    )

def response_alyx_start(
    success: bool,
    log_path: Optional[str] = None,
    error: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    """Response to alyx_start command."""
    return Response(
        response="alyx_start",
        req_id=req_id,
        success=success,
        log_path=log_path,
        message=error,
    )

def response_alyx_stop(success: bool, req_id: Optional[str] = None) -> Response:
    """Response to alyx_stop command."""
    return Response(
        response="alyx_stop",
        req_id=req_id,
        success=success,
    )

def response_alyx_status(
    running: bool,
    log_path: Optional[str] = None,
    events_received: int = 0,
    last_event_ts: Optional[float] = None,
    req_id: Optional[str] = None,
) -> Response:
    """Response to alyx_status command."""
    return Response(
        response="alyx_status",
        req_id=req_id,
        running=running,
        log_path=log_path,
        events_received=events_received,
        last_event_ts=last_event_ts,
    )

def response_alyx_get_mod_info(
    mod_info: Dict[str, Any],
    req_id: Optional[str] = None,
) -> Response:
    """Response to alyx_get_mod_info command with mod download/install info."""
    return Response(
        response="alyx_get_mod_info",
        req_id=req_id,
        mod_info=mod_info,
    )


# =============================================================================
# Left 4 Dead 2 Integration Protocol
# =============================================================================

def event_l4d2_started(log_path: str) -> Event:
    """Event when Left 4 Dead 2 integration starts."""
    return Event(event=EventType.L4D2_STARTED.value, log_path=log_path)


def event_l4d2_stopped() -> Event:
    """Event when Left 4 Dead 2 integration stops."""
    return Event(event=EventType.L4D2_STOPPED.value)


def event_l4d2_game_event(
    event_type: str,
    params: Optional[Dict[str, Any]] = None,
) -> Event:
    """
    Left 4 Dead 2 game event (player_damage, player_death, weapon_fire, etc.).
    
    Args:
        event_type: Type of event ("player_damage", "player_death", "weapon_fire", etc.)
        params: Event parameters (victim, attacker, damage, weapon, etc.)
    """
    return Event(
        event=EventType.L4D2_GAME_EVENT.value,
        event_type=event_type,
        params=params,
    )


def response_l4d2_start(
    success: bool,
    log_path: Optional[str] = None,
    error: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    """Response to l4d2_start command."""
    return Response(
        response="l4d2_start",
        req_id=req_id,
        success=success,
        log_path=log_path,
        message=error,
    )


def response_l4d2_stop(
    success: bool,
    error: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    """Response to l4d2_stop command."""
    return Response(
        response="l4d2_stop",
        req_id=req_id,
        success=success,
        message=error,
    )


def response_l4d2_status(
    running: bool,
    log_path: Optional[str] = None,
    events_received: int = 0,
    last_event_ts: Optional[float] = None,
    last_event_type: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    """Response to l4d2_status command."""
    return Response(
        response="l4d2_status",
        req_id=req_id,
        running=running,
        log_path=log_path,
        events_received=events_received,
        last_event_ts=last_event_ts,
        last_event_type=last_event_type,
    )


def event_pistolwhip_started() -> Event:
    return Event(event=EventType.PISTOLWHIP_STARTED.value)


def event_pistolwhip_stopped() -> Event:
    return Event(event=EventType.PISTOLWHIP_STOPPED.value)


def event_pistolwhip_game_event(
    event_type: str,
    params: Optional[Dict[str, Any]] = None,
) -> Event:
    return Event(
        event=EventType.PISTOLWHIP_GAME_EVENT.value,
        event_type=event_type,
        params=params,
        hand=(params or {}).get("hand"),
    )


def response_pistolwhip_start(
    success: bool,
    error: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="pistolwhip_start",
        req_id=req_id,
        success=success,
        message=error,
    )


def response_pistolwhip_stop(success: bool, req_id: Optional[str] = None) -> Response:
    return Response(
        response="pistolwhip_stop",
        req_id=req_id,
        success=success,
    )


def response_pistolwhip_status(
    running: bool,
    events_received: int = 0,
    last_event_ts: Optional[float] = None,
    last_event_type: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="pistolwhip_status",
        req_id=req_id,
        running=running,
        events_received=events_received,
        last_event_ts=last_event_ts,
        last_event_type=last_event_type,
    )


def response_pistolwhip_event(
    success: bool,
    error: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="pistolwhip_event",
        req_id=req_id,
        success=success,
        message=error,
    )


def event_battlesister_started() -> Event:
    return Event(event=EventType.BATTLESISTER_STARTED.value)


def event_battlesister_stopped() -> Event:
    return Event(event=EventType.BATTLESISTER_STOPPED.value)


def event_battlesister_game_event(
    event_type: str,
    params: Optional[Dict[str, Any]] = None,
) -> Event:
    return Event(
        event=EventType.BATTLESISTER_GAME_EVENT.value,
        event_type=event_type,
        params=params,
        hand=(params or {}).get("hand"),
    )


def response_battlesister_start(
    success: bool,
    error: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="battlesister_start",
        req_id=req_id,
        success=success,
        message=error,
    )


def response_battlesister_stop(success: bool, req_id: Optional[str] = None) -> Response:
    return Response(
        response="battlesister_stop",
        req_id=req_id,
        success=success,
    )


def response_battlesister_status(
    running: bool,
    events_received: int = 0,
    last_event_ts: Optional[float] = None,
    last_event_type: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="battlesister_status",
        req_id=req_id,
        running=running,
        events_received=events_received,
        last_event_ts=last_event_ts,
        last_event_type=last_event_type,
    )


def response_battlesister_event(
    success: bool,
    error: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="battlesister_event",
        req_id=req_id,
        success=success,
        message=error,
    )


def event_gunmancontracts_started() -> Event:
    return Event(event=EventType.GUNMANCONTRACTS_STARTED.value)


def event_gunmancontracts_stopped() -> Event:
    return Event(event=EventType.GUNMANCONTRACTS_STOPPED.value)


def event_gunmancontracts_game_event(
    event_type: str,
    params: Optional[Dict[str, Any]] = None,
) -> Event:
    return Event(
        event=EventType.GUNMANCONTRACTS_GAME_EVENT.value,
        event_type=event_type,
        params=params,
        hand=(params or {}).get("hand"),
    )


def response_gunmancontracts_start(
    success: bool,
    error: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="gunmancontracts_start",
        req_id=req_id,
        success=success,
        message=error,
    )


def response_gunmancontracts_stop(success: bool, req_id: Optional[str] = None) -> Response:
    return Response(
        response="gunmancontracts_stop",
        req_id=req_id,
        success=success,
    )


def response_gunmancontracts_status(
    running: bool,
    events_received: int = 0,
    last_event_ts: Optional[float] = None,
    last_event_type: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="gunmancontracts_status",
        req_id=req_id,
        running=running,
        events_received=events_received,
        last_event_ts=last_event_ts,
        last_event_type=last_event_type,
    )


def response_gunmancontracts_event(
    success: bool,
    error: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="gunmancontracts_event",
        req_id=req_id,
        success=success,
        message=error,
    )


# =============================================================================
# Generic Screen Health Watcher Protocol
# =============================================================================

def event_screen_health_started(profile_name: str) -> Event:
    return Event(event=EventType.SCREEN_HEALTH_STARTED.value, profile_name=profile_name)


def event_screen_health_stopped() -> Event:
    return Event(event=EventType.SCREEN_HEALTH_STOPPED.value)


def event_screen_health_hit(
    direction: Optional[str],
    score: float,
    roi: Optional[str] = None,
) -> Event:
    return Event(
        event=EventType.SCREEN_HEALTH_HIT.value,
        event_type="hit_recorded",
        params={"roi": roi} if roi else None,
        direction=direction,
        score=score,
    )


def event_screen_health_health(health_percent: float, detector: Optional[str] = None) -> Event:
    return Event(
        event=EventType.SCREEN_HEALTH_HEALTH.value,
        event_type="health_percent",
        health_percent=float(health_percent),
        detector=detector,
    )


def event_screen_health_value(health_value: int, detector: Optional[str] = None) -> Event:
    return Event(
        event=EventType.SCREEN_HEALTH_VALUE.value,
        event_type="health_value",
        health_value=int(health_value),
        detector=detector,
    )


def event_screen_health_ammo_value(ammo_value: int, detector: Optional[str] = None) -> Event:
    """Ammo counter OCR readout (Screen Health recoil channel)."""
    return Event(
        event=EventType.SCREEN_HEALTH_VALUE.value,
        event_type="ammo_value",
        health_value=int(ammo_value),
        detector=detector,
    )


def event_screen_health_recoil(
    *,
    roi: Optional[str] = None,
    value: Optional[int] = None,
    prev_value: Optional[int] = None,
    drop: Optional[int] = None,
    duration_ms: Optional[int] = None,
) -> Event:
    """Ammo decrease → solenoid recoil pulse."""
    params: Dict[str, Any] = {}
    if roi is not None:
        params["roi"] = roi
    if value is not None:
        params["value"] = int(value)
    if prev_value is not None:
        params["prev_value"] = int(prev_value)
    if drop is not None:
        params["drop"] = int(drop)
    if duration_ms is not None:
        params["duration_ms"] = int(duration_ms)
    return Event(
        event=EventType.SCREEN_HEALTH_RECOIL.value,
        event_type="recoil_fired",
        detector=roi,
        health_value=int(value) if value is not None else None,
        duration_ms=int(duration_ms) if duration_ms is not None else None,
        params=params or None,
    )


def event_screen_health_debug(params: Dict[str, Any], detector: Optional[str] = None) -> Event:
    """
    Debug event for calibration: emits evaluated detector values and (optionally)
    saved ROI crop filenames.
    """
    return Event(
        event=EventType.SCREEN_HEALTH_DEBUG.value,
        event_type="debug",
        detector=detector,
        params=params,
    )


def response_screen_health_start(
    success: bool,
    profile_name: Optional[str] = None,
    error: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="screen_health_start",
        req_id=req_id,
        success=success,
        profile_name=profile_name,
        message=error,
    )


def response_screen_health_stop(success: bool, error: Optional[str] = None, req_id: Optional[str] = None) -> Response:
    return Response(
        response="screen_health_stop",
        req_id=req_id,
        success=success,
        message=error,
    )


def response_screen_health_status(
    running: bool,
    profile_name: Optional[str],
    events_received: int = 0,
    last_event_ts: Optional[float] = None,
    last_hit_ts: Optional[float] = None,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="screen_health_status",
        req_id=req_id,
        running=running,
        profile_name=profile_name,
        events_received=events_received,
        last_event_ts=last_event_ts,
        last_hit_ts=last_hit_ts,
    )


def response_screen_health_test(
    success: bool,
    test_result: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="screen_health_test",
        req_id=req_id,
        success=success,
        test_result=test_result,
        message=error,
    )


# -------------------------------------------------------------------------
# Predefined Effects events and responses
# -------------------------------------------------------------------------

def event_effect_started(effect_name: str) -> Event:
    """Event when an effect starts playing."""
    return Event(
        event=EventType.EFFECT_STARTED.value,
        effect_name=effect_name,
    )

def event_effect_completed(effect_name: str) -> Event:
    """Event when an effect finishes playing."""
    return Event(
        event=EventType.EFFECT_COMPLETED.value,
        effect_name=effect_name,
    )

def response_play_effect(
    success: bool,
    effect_name: Optional[str] = None,
    error: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    """Response to play_effect command."""
    return Response(
        response="play_effect",
        req_id=req_id,
        success=success,
        message=error,
    )

def response_list_effects(
    effects: List[Dict[str, Any]],
    categories: List[str],
    req_id: Optional[str] = None,
) -> Response:
    """Response to list_effects command with all available effects."""
    return Response(
        response="list_effects",
        req_id=req_id,
        effects=effects,
        categories=categories,
    )


# -------------------------------------------------------------------------
# USB LC relay (solenoid / recoil)
# -------------------------------------------------------------------------

def event_relay_connected(relay: Dict[str, Any]) -> Event:
    return Event(event=EventType.RELAY_CONNECTED.value, relay=relay, port=relay.get("port"))

def event_relay_disconnected() -> Event:
    return Event(event=EventType.RELAY_DISCONNECTED.value)

def event_relay_state_changed(on: bool, relay: Optional[Dict[str, Any]] = None) -> Event:
    return Event(event=EventType.RELAY_STATE_CHANGED.value, on=on, relay=relay)

def event_relay_pulsed(duration_ms: int, relay: Optional[Dict[str, Any]] = None) -> Event:
    return Event(event=EventType.RELAY_PULSED.value, duration_ms=duration_ms, relay=relay)

def event_relay_mouse_started(duration_ms: int) -> Event:
    return Event(event=EventType.RELAY_MOUSE_STARTED.value, duration_ms=duration_ms)

def event_relay_mouse_stopped() -> Event:
    return Event(event=EventType.RELAY_MOUSE_STOPPED.value)

def response_relay_list_ports(
    ports: List[Dict[str, Any]],
    req_id: Optional[str] = None,
) -> Response:
    return Response(response="relay_list_ports", req_id=req_id, ok=True, ports=ports)

def response_relay_connect(
    success: bool,
    relay: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="relay_connect",
        req_id=req_id,
        success=success,
        ok=success,
        relay=relay,
        message=error,
    )

def response_relay_disconnect(
    success: bool,
    error: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="relay_disconnect",
        req_id=req_id,
        success=success,
        ok=success,
        message=error,
    )

def response_relay_status(
    relay: Dict[str, Any],
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="relay_status",
        req_id=req_id,
        ok=True,
        connected=bool(relay.get("connected")),
        relay=relay,
    )

def response_relay_set(
    success: bool,
    on: Optional[bool] = None,
    relay: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="relay_set",
        req_id=req_id,
        success=success,
        ok=success,
        on=on,
        relay=relay,
        message=error,
    )

def response_relay_pulse(
    success: bool,
    duration_ms: Optional[int] = None,
    relay: Optional[Dict[str, Any]] = None,
    error: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="relay_pulse",
        req_id=req_id,
        success=success,
        ok=success,
        duration_ms=duration_ms,
        relay=relay,
        message=error,
    )

def response_relay_mouse_start(
    success: bool,
    running: bool = False,
    duration_ms: Optional[int] = None,
    fire_mode: Optional[str] = None,
    fire_rate_rpm: Optional[int] = None,
    burst_count: Optional[int] = None,
    interval_ms: Optional[int] = None,
    pulses: Optional[int] = None,
    error: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="relay_mouse_start",
        req_id=req_id,
        success=success,
        ok=success,
        running=running,
        duration_ms=duration_ms,
        fire_mode=fire_mode,
        fire_rate_rpm=fire_rate_rpm,
        burst_count=burst_count,
        interval_ms=interval_ms,
        pulses=pulses,
        message=error,
    )

def response_relay_mouse_stop(
    success: bool,
    running: bool = False,
    error: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="relay_mouse_stop",
        req_id=req_id,
        success=success,
        ok=success,
        running=running,
        message=error,
    )

def response_relay_mouse_status(
    running: bool,
    duration_ms: Optional[int] = None,
    pulses: Optional[int] = None,
    fire_mode: Optional[str] = None,
    fire_rate_rpm: Optional[int] = None,
    burst_count: Optional[int] = None,
    interval_ms: Optional[int] = None,
    error: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="relay_mouse_status",
        req_id=req_id,
        ok=True,
        success=True,
        running=running,
        duration_ms=duration_ms,
        pulses=pulses,
        fire_mode=fire_mode,
        fire_rate_rpm=fire_rate_rpm,
        burst_count=burst_count,
        interval_ms=interval_ms,
        message=error,
    )


def response_ocr_list_engines(
    engines: List[Dict[str, Any]],
    ocr_engine: str,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="ocr_list_engines",
        req_id=req_id,
        ok=True,
        success=True,
        ocr_engine=ocr_engine,
        ocr_engines=engines,
    )


def response_ocr_get_settings(
    ocr_engine: str,
    engines: Optional[List[Dict[str, Any]]] = None,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="ocr_get_settings",
        req_id=req_id,
        ok=True,
        success=True,
        ocr_engine=ocr_engine,
        ocr_engines=engines,
    )


def response_ocr_set_engine(
    success: bool,
    ocr_engine: Optional[str] = None,
    error: Optional[str] = None,
    req_id: Optional[str] = None,
) -> Response:
    return Response(
        response="ocr_set_engine",
        req_id=req_id,
        success=success,
        ok=success,
        ocr_engine=ocr_engine,
        message=error,
    )


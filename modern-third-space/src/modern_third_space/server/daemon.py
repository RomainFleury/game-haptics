"""
Vest Daemon - centralized TCP server for vest control.

This daemon:
- Maintains a single connection to the vest hardware
- Accepts multiple TCP client connections
- Routes commands to the vest
- Broadcasts events to all connected clients

Usage:
    python -m modern_third_space.cli daemon --port 5050
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import signal
from pathlib import Path
from typing import Any, Dict, Optional

from ..vest import VestController, VestStatus, list_devices, get_effect, all_effects_to_dict, effect_to_dict
from .client_manager import Client, ClientManager
from .vest_registry import VestControllerRegistry
from .player_manager import PlayerManager
from .game_player_mapping import GamePlayerMapping
from .protocol import (
    Command,
    CommandType,
    Event,
    Response,
    event_connected,
    event_device_cleared,
    event_device_selected,
    event_disconnected,
    event_effect_triggered,
    event_all_stopped,
    event_error,
    event_cs2_started,
    event_cs2_stopped,
    event_cs2_game_event,
    event_device_connected,
    event_device_disconnected,
    event_main_device_changed,
    event_mock_device_created,
    event_mock_device_removed,
    event_player_assigned,
    event_player_unassigned,
    event_game_player_mapping_changed,
    response_error,
    response_get_selected_device,
    response_list,
    response_ok,
    response_ping,
    response_status,
    response_cs2_start,
    response_cs2_stop,
    response_cs2_status,
    response_cs2_generate_config,
    response_list_connected_devices,
    response_set_main_device,
    response_disconnect_device,
    response_create_mock_device,
    response_remove_mock_device,
    response_create_player,
    response_assign_player,
    response_unassign_player,
    response_list_players,
    response_get_player_device,
    response_set_game_player_mapping,
    response_clear_game_player_mapping,
    response_list_game_player_mappings,
)
from .cs2_manager import CS2Manager, generate_cs2_config
from .alyx_manager import AlyxManager, get_mod_info as get_alyx_mod_info
from .l4d2_manager import L4D2Manager
from .pistolwhip_manager import PistolWhipManager
from .battlesister_manager import BattleSisterManager
from .gunmancontracts_manager import GunmanContractsManager
from .ocr_settings import load_ocr_settings, save_ocr_settings
from .screen_health_manager import ScreenHealthManager
from .screen_ocr import list_ocr_engines, normalize_text_ocr_engine
from .protocol import (
    event_alyx_started,
    event_alyx_stopped,
    event_alyx_game_event,
    response_alyx_start,
    response_alyx_stop,
    response_alyx_status,
    response_alyx_get_mod_info,
    event_l4d2_started,
    event_l4d2_stopped,
    event_l4d2_game_event,
    response_l4d2_start,
    response_l4d2_stop,
    response_l4d2_status,
    event_pistolwhip_started,
    event_pistolwhip_stopped,
    event_pistolwhip_game_event,
    response_pistolwhip_start,
    response_pistolwhip_stop,
    response_pistolwhip_status,
    response_pistolwhip_event,
    event_battlesister_started,
    event_battlesister_stopped,
    event_battlesister_game_event,
    response_battlesister_start,
    response_battlesister_stop,
    response_battlesister_status,
    response_battlesister_event,
    event_gunmancontracts_started,
    event_gunmancontracts_stopped,
    event_gunmancontracts_game_event,
    response_gunmancontracts_start,
    response_gunmancontracts_stop,
    response_gunmancontracts_status,
    response_gunmancontracts_event,
    event_screen_health_started,
    event_screen_health_stopped,
    event_screen_health_hit,
    event_screen_health_health,
    event_screen_health_value,
    event_screen_health_ammo_value,
    event_screen_health_recoil,
    event_screen_health_debug,
    response_screen_health_start,
    response_screen_health_stop,
    response_screen_health_status,
    response_screen_health_test,
    response_ocr_list_engines,
    response_ocr_get_settings,
    response_ocr_set_engine,
    # Predefined effects
    event_effect_started,
    event_effect_completed,
    response_play_effect,
    response_list_effects,
    # USB LC relay
    event_relay_connected,
    event_relay_disconnected,
    event_relay_state_changed,
    event_relay_pulsed,
    response_relay_list_ports,
    response_relay_connect,
    response_relay_disconnect,
    response_relay_status,
    response_relay_set,
    response_relay_pulse,
    event_relay_mouse_started,
    event_relay_mouse_stopped,
    response_relay_mouse_start,
    response_relay_mouse_stop,
    response_relay_mouse_status,
)
from ..relay import RelayController, list_ports as list_relay_ports, DEFAULT_ADDRESS, DEFAULT_BAUD
from ..relay.mouse_recoil import MouseRecoilListener

logger = logging.getLogger(__name__)


class VestDaemon:
    """
    TCP server daemon for vest control.
    
    Manages:
    - TCP server accepting client connections
    - Device selection state
    - Vest controller instance
    - Event broadcasting
    """
    
    DEFAULT_PORT = 5050
    DEFAULT_HOST = "127.0.0.1"
    
    def __init__(self, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> None:
        self.host = host
        self.port = port
        
        # State - Multi-vest support
        self._registry = VestControllerRegistry()
        self._player_manager = PlayerManager()
        self._game_mapping = GamePlayerMapping()
        # Keep _selected_device for backward compatibility (refers to main device)
        self._selected_device: Optional[Dict[str, Any]] = None
        # Legacy: _controller now refers to main device controller (for backward compatibility)
        self._controller: Optional[VestController] = None
        self._clients = ClientManager()
        self._server: Optional[asyncio.Server] = None
        self._running = False
        
        # CS2 GSI manager
        self._cs2_manager = CS2Manager(
            on_game_event=self._on_cs2_game_event,
            on_trigger=self._on_cs2_trigger,
        )
        
        # Half-Life: Alyx manager
        self._alyx_manager = AlyxManager(
            on_game_event=self._on_alyx_game_event,
            on_trigger=self._on_alyx_trigger,
            on_recoil=self._on_solenoid_recoil,
        )
        
        # Left 4 Dead 2 manager
        self._l4d2_manager = L4D2Manager(
            on_game_event=self._on_l4d2_game_event,
            on_trigger=self._on_l4d2_trigger,
            on_recoil=self._on_solenoid_recoil,
        )

        self._pistolwhip_manager = PistolWhipManager(
            on_game_event=self._on_pistolwhip_game_event,
            on_trigger=self._on_pistolwhip_trigger,
            on_recoil=self._on_solenoid_recoil,
        )

        self._battlesister_manager = BattleSisterManager(
            on_game_event=self._on_battlesister_game_event,
            on_trigger=self._on_battlesister_trigger,
            on_recoil=self._on_solenoid_recoil,
        )

        self._gunmancontracts_manager = GunmanContractsManager(
            on_game_event=self._on_gunmancontracts_game_event,
            on_trigger=self._on_gunmancontracts_trigger,
            on_recoil=self._on_solenoid_recoil,
        )

        # Generic Screen Health Watcher manager
        self._ocr_settings = load_ocr_settings()
        self._screen_health_manager = ScreenHealthManager(
            on_game_event=self._on_screen_health_game_event,
            on_trigger=self._on_screen_health_trigger,
            on_recoil=self._on_solenoid_recoil,
            get_ocr_engine=lambda: str(self._ocr_settings.get("engine") or "windows_ocr"),
        )

        # USB LC relay (solenoid / recoil)
        self._relay = RelayController()
        self._mouse_recoil = MouseRecoilListener(on_pulse=self._on_solenoid_recoil)
        
        self._loop: Optional[asyncio.AbstractEventLoop] = None
    
    @property
    def selected_device(self) -> Optional[Dict[str, Any]]:
        """Currently selected device."""
        return self._selected_device
    
    @property
    def is_connected(self) -> bool:
        """Whether connected to a vest (main device)."""
        controller = self._registry.get_controller()
        return controller is not None and controller.status().connected
    
    async def start(self) -> None:
        """Start the daemon server."""
        self._running = True
        self._loop = asyncio.get_running_loop()
        self._server = await asyncio.start_server(
            self._handle_client,
            self.host,
            self.port,
        )
        
        addr = self._server.sockets[0].getsockname()
        logger.info(f"Vest daemon listening on {addr[0]}:{addr[1]}")
        print(f"[VEST] Daemon started on {addr[0]}:{addr[1]}", flush=True)
        
        async with self._server:
            await self._server.serve_forever()
    
    async def stop(self) -> None:
        """Stop the daemon server."""
        self._running = False
        
        # Stop CS2 GSI if running
        if self._cs2_manager.is_running:
            self._cs2_manager.stop()
        
        # Stop Alyx integration if running
        if self._alyx_manager.is_running:
            self._alyx_manager.stop()
        if self._pistolwhip_manager.enabled:
            self._pistolwhip_manager.disable()
        if self._battlesister_manager.enabled:
            self._battlesister_manager.disable()
        if self._gunmancontracts_manager.enabled:
            self._gunmancontracts_manager.disable()

        # Disconnect USB relay if connected
        try:
            self._mouse_recoil.stop()
        except Exception:
            pass
        try:
            self._relay.disconnect()
        except Exception:
            pass
        
        # Disconnect from all vests
        for device_id in list(self._registry._controllers.keys()):
            self._registry.remove_device(device_id)
        self._controller = None
        self._selected_device = None
        
        # Close server
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
        
        logger.info("Vest daemon stopped")
        print("[VEST] Daemon stopped", flush=True)
    
    async def _handle_client(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        """Handle a client connection."""
        client = await self._clients.add_client(writer)
        addr = writer.get_extra_info("peername")
        logger.info(f"Client {client.id} connected from {addr}")
        print(f"[VEST] Client {client.id} connected from {addr}", flush=True)
        
        try:
            while self._running:
                # Read a line (command)
                try:
                    line = await asyncio.wait_for(
                        reader.readline(),
                        timeout=None,  # No timeout, wait indefinitely
                    )
                except asyncio.CancelledError:
                    break
                except (ConnectionResetError, BrokenPipeError, OSError) as e:
                    # Client disconnected abruptly (common on Windows)
                    logger.debug(f"Client {client.id} connection lost: {e}")
                    break
                except ValueError as e:
                    # readline() raises ValueError when a line exceeds StreamReader limit (default 64 KiB)
                    logger.error("Client %s: command line exceeds read buffer (%s)", client.id, e)
                    try:
                        err = response_error("Command line exceeds server read buffer limit")
                        await self._clients.send_to_client(client, err.to_json())
                    except Exception:
                        pass
                    break

                if not line:
                    # Client disconnected
                    break
                
                # Parse and handle command
                try:
                    line_str = line.decode().strip()
                    if not line_str:
                        continue
                    
                    command = Command.from_json(line_str)
                    response = await self._handle_command(client, command)
                    
                    # Send response to this client
                    if response:
                        await self._clients.send_to_client(client, response.to_json())
                        
                except json.JSONDecodeError as e:
                    error_resp = response_error(f"Invalid JSON: {e}")
                    await self._clients.send_to_client(client, error_resp.to_json())
                except Exception as e:
                    logger.exception(f"Error handling command from {client.id}")
                    error_resp = response_error(str(e))
                    await self._clients.send_to_client(client, error_resp.to_json())
        
        finally:
            await self._clients.remove_client(client)
            try:
                # Check if writer is already closed before attempting to close
                if not writer.is_closing() and not writer.transport.is_closing():
                    writer.close()
                    try:
                        await writer.wait_closed()
                    except (BrokenPipeError, ConnectionResetError, OSError, RuntimeError):
                        # Client already disconnected or transport closed - this is normal
                        pass
            except (BrokenPipeError, ConnectionResetError, OSError, RuntimeError, AttributeError):
                # Client already disconnected or transport already closed - this is normal
                pass
            except Exception as e:
                logger.debug(f"Error closing client connection: {e}")
            logger.info(f"Client {client.id} disconnected")
            print(f"[VEST] Client {client.id} disconnected")
    
    async def _handle_command(self, client: Client, command: Command) -> Optional[Response]:
        """
        Handle a command and return a response.
        
        Also broadcasts events as side effects.
        """
        if not command.is_valid():
            return response_error(f"Unknown command: {command.cmd}", command.req_id)
        
        cmd_type = CommandType(command.cmd)
        
        # Health check
        if cmd_type == CommandType.PING:
            return await self._cmd_ping(command)
        
        # Device discovery & selection
        if cmd_type == CommandType.LIST:
            return await self._cmd_list(command)
        
        if cmd_type == CommandType.SELECT_DEVICE:
            return await self._cmd_select_device(command)
        
        if cmd_type == CommandType.GET_SELECTED_DEVICE:
            return await self._cmd_get_selected_device(command)
        
        if cmd_type == CommandType.CLEAR_DEVICE:
            return await self._cmd_clear_device(command)
        
        # Multi-vest commands
        if cmd_type == CommandType.LIST_CONNECTED_DEVICES:
            return await self._cmd_list_connected_devices(command)
        
        if cmd_type == CommandType.SET_MAIN_DEVICE:
            return await self._cmd_set_main_device(command)
        
        if cmd_type == CommandType.DISCONNECT_DEVICE:
            return await self._cmd_disconnect_device(command)
        
        # Mock device commands
        if cmd_type == CommandType.CREATE_MOCK_DEVICE:
            return await self._cmd_create_mock_device(command)
        
        if cmd_type == CommandType.REMOVE_MOCK_DEVICE:
            return await self._cmd_remove_mock_device(command)
        
        # Player management commands
        if cmd_type == CommandType.CREATE_PLAYER:
            return await self._cmd_create_player(command)
        
        if cmd_type == CommandType.ASSIGN_PLAYER:
            return await self._cmd_assign_player(command)
        
        if cmd_type == CommandType.UNASSIGN_PLAYER:
            return await self._cmd_unassign_player(command)
        
        if cmd_type == CommandType.LIST_PLAYERS:
            return await self._cmd_list_players(command)
        
        if cmd_type == CommandType.GET_PLAYER_DEVICE:
            return await self._cmd_get_player_device(command)
        
        # Game-specific player mapping commands
        if cmd_type == CommandType.SET_GAME_PLAYER_MAPPING:
            return await self._cmd_set_game_player_mapping(command)
        
        if cmd_type == CommandType.CLEAR_GAME_PLAYER_MAPPING:
            return await self._cmd_clear_game_player_mapping(command)
        
        if cmd_type == CommandType.LIST_GAME_PLAYER_MAPPINGS:
            return await self._cmd_list_game_player_mappings(command)
        
        # Vest control (requires selected device)
        if cmd_type == CommandType.CONNECT:
            return await self._cmd_connect(command)
        
        if cmd_type == CommandType.DISCONNECT:
            return await self._cmd_disconnect(command)
        
        if cmd_type == CommandType.TRIGGER:
            return await self._cmd_trigger(command)
        
        if cmd_type == CommandType.STOP:
            return await self._cmd_stop(command)
        
        if cmd_type == CommandType.STATUS:
            return await self._cmd_status(command)
        
        # CS2 GSI commands
        if cmd_type == CommandType.CS2_START:
            return await self._cmd_cs2_start(command)
        
        if cmd_type == CommandType.CS2_STOP:
            return await self._cmd_cs2_stop(command)
        
        if cmd_type == CommandType.CS2_STATUS:
            return await self._cmd_cs2_status(command)
        
        if cmd_type == CommandType.CS2_GENERATE_CONFIG:
            return await self._cmd_cs2_generate_config(command)
        
        # Half-Life: Alyx commands
        if cmd_type == CommandType.ALYX_START:
            return await self._cmd_alyx_start(command)
        
        if cmd_type == CommandType.ALYX_STOP:
            return await self._cmd_alyx_stop(command)
        
        if cmd_type == CommandType.ALYX_STATUS:
            return await self._cmd_alyx_status(command)
        
        if cmd_type == CommandType.ALYX_GET_MOD_INFO:
            return await self._cmd_alyx_get_mod_info(command)
        
        # Left 4 Dead 2 commands
        if cmd_type == CommandType.L4D2_START:
            return await self._cmd_l4d2_start(command)
        
        if cmd_type == CommandType.L4D2_STOP:
            return await self._cmd_l4d2_stop(command)
        
        if cmd_type == CommandType.L4D2_STATUS:
            return await self._cmd_l4d2_status(command)

        if cmd_type == CommandType.PISTOLWHIP_START:
            return await self._cmd_pistolwhip_start(command)

        if cmd_type == CommandType.PISTOLWHIP_STOP:
            return await self._cmd_pistolwhip_stop(command)

        if cmd_type == CommandType.PISTOLWHIP_STATUS:
            return await self._cmd_pistolwhip_status(command)

        if cmd_type == CommandType.PISTOLWHIP_EVENT:
            return await self._cmd_pistolwhip_event(command)

        if cmd_type == CommandType.BATTLESISTER_START:
            return await self._cmd_battlesister_start(command)

        if cmd_type == CommandType.BATTLESISTER_STOP:
            return await self._cmd_battlesister_stop(command)

        if cmd_type == CommandType.BATTLESISTER_STATUS:
            return await self._cmd_battlesister_status(command)

        if cmd_type == CommandType.BATTLESISTER_EVENT:
            return await self._cmd_battlesister_event(command)

        if cmd_type == CommandType.GUNMANCONTRACTS_START:
            return await self._cmd_gunmancontracts_start(command)

        if cmd_type == CommandType.GUNMANCONTRACTS_STOP:
            return await self._cmd_gunmancontracts_stop(command)

        if cmd_type == CommandType.GUNMANCONTRACTS_STATUS:
            return await self._cmd_gunmancontracts_status(command)

        if cmd_type == CommandType.GUNMANCONTRACTS_EVENT:
            return await self._cmd_gunmancontracts_event(command)

        # Generic Screen Health Watcher commands
        if cmd_type == CommandType.SCREEN_HEALTH_START:
            return await self._cmd_screen_health_start(command)

        if cmd_type == CommandType.SCREEN_HEALTH_STOP:
            return await self._cmd_screen_health_stop(command)

        if cmd_type == CommandType.SCREEN_HEALTH_STATUS:
            return await self._cmd_screen_health_status(command)

        if cmd_type == CommandType.SCREEN_HEALTH_TEST:
            return await self._cmd_screen_health_test(command)

        if cmd_type == CommandType.OCR_LIST_ENGINES:
            return await self._cmd_ocr_list_engines(command)

        if cmd_type == CommandType.OCR_GET_SETTINGS:
            return await self._cmd_ocr_get_settings(command)

        if cmd_type == CommandType.OCR_SET_ENGINE:
            return await self._cmd_ocr_set_engine(command)
        
        # Predefined effects commands
        if cmd_type == CommandType.PLAY_EFFECT:
            return await self._cmd_play_effect(command)
        
        if cmd_type == CommandType.LIST_EFFECTS:
            return await self._cmd_list_effects(command)
        
        if cmd_type == CommandType.STOP_EFFECT:
            return await self._cmd_stop_effect(command)

        # USB LC relay commands
        if cmd_type == CommandType.RELAY_LIST_PORTS:
            return await self._cmd_relay_list_ports(command)

        if cmd_type == CommandType.RELAY_CONNECT:
            return await self._cmd_relay_connect(command)

        if cmd_type == CommandType.RELAY_DISCONNECT:
            return await self._cmd_relay_disconnect(command)

        if cmd_type == CommandType.RELAY_STATUS:
            return await self._cmd_relay_status(command)

        if cmd_type == CommandType.RELAY_SET:
            return await self._cmd_relay_set(command)

        if cmd_type == CommandType.RELAY_PULSE:
            return await self._cmd_relay_pulse(command)

        if cmd_type == CommandType.RELAY_MOUSE_START:
            return await self._cmd_relay_mouse_start(command)

        if cmd_type == CommandType.RELAY_MOUSE_STOP:
            return await self._cmd_relay_mouse_stop(command)

        if cmd_type == CommandType.RELAY_MOUSE_STATUS:
            return await self._cmd_relay_mouse_status(command)
        
        return response_error(f"Command not implemented: {command.cmd}", command.req_id)
    
    # -------------------------------------------------------------------------
    # Command handlers
    # -------------------------------------------------------------------------
    
    async def _cmd_ping(self, command: Command) -> Response:
        """
        Health check - returns daemon state summary.
        
        Useful for clients to check if daemon is alive and get
        a quick overview of the current state.
        """
        return response_ping(
            connected=self.is_connected,
            has_device_selected=self._selected_device is not None,
            client_count=self._clients.client_count,
            req_id=command.req_id,
        )
    
    async def _cmd_list(self, command: Command) -> Response:
        """List available devices (includes real USB devices and mock devices)."""
        # Get real USB devices
        devices = list_devices()
        
        # Add mock devices from registry
        mock_devices = self._registry.list_devices()
        for mock_device in mock_devices:
            if self._registry.is_mock_device(mock_device["device_id"]):
                # Format mock device to match real device format
                devices.append({
                    "vendor_id": mock_device.get("vendor_id", "0x1234"),
                    "product_id": mock_device.get("product_id", "0x5678"),
                    "bus": mock_device.get("bus"),
                    "address": mock_device.get("address"),
                    "serial_number": mock_device.get("serial_number"),
                    "is_mock": True,  # Flag to identify mock devices
                })
        
        return response_list(devices, command.req_id)
    
    async def _cmd_select_device(self, command: Command) -> Response:
        """Select a device to use (adds to registry, doesn't replace)."""
        # Find the device
        devices = list_devices()
        selected = None
        
        if command.serial:
            # Select by serial
            for d in devices:
                if d.get("serial_number") == command.serial:
                    selected = d
                    break
        elif command.bus is not None and command.address is not None:
            # Select by bus + address
            for d in devices:
                if d.get("bus") == command.bus and d.get("address") == command.address:
                    selected = d
                    break
        else:
            return response_error("Must specify bus+address or serial", command.req_id)
        
        if selected is None:
            return response_error("Device not found", command.req_id)
        
        # Add device to registry (or get existing if already connected)
        try:
            device_id, controller = self._registry.add_device(
                device_id=command.device_id,  # Optional: allow specifying device_id
                device_info=selected
            )
            
            # Update selected device (for backward compatibility)
            self._selected_device = selected
            self._controller = controller  # Keep for backward compatibility
            
            # Broadcast device selected event (include device_id)
            event_data = selected.copy()
            event_data["device_id"] = device_id
            await self._clients.broadcast(event_device_selected(event_data))
            
            # Also broadcast device_connected event for multi-vest support
            await self._clients.broadcast(event_device_connected(selected, device_id))
            
            return response_ok(command.req_id)
        except ValueError as e:
            return response_error(str(e), command.req_id)
    
    async def _cmd_get_selected_device(self, command: Command) -> Response:
        """Get the currently selected device."""
        return response_get_selected_device(self._selected_device, command.req_id)
    
    async def _cmd_clear_device(self, command: Command) -> Response:
        """Clear device selection."""
        # Disconnect first
        if self._controller is not None:
            self._controller.disconnect()
            self._controller = None
        
        self._selected_device = None
        
        # Broadcast device cleared event
        await self._clients.broadcast(event_device_cleared())
        
        return response_ok(command.req_id)
    
    async def _cmd_list_connected_devices(self, command: Command) -> Response:
        """List all currently connected devices."""
        devices = self._registry.list_devices()
        return response_list_connected_devices(devices, command.req_id)
    
    async def _cmd_set_main_device(self, command: Command) -> Response:
        """Set the main device."""
        if not command.device_id:
            return response_set_main_device(
                success=False,
                error="device_id is required",
                req_id=command.req_id,
            )
        
        success = self._registry.set_main_device(command.device_id)
        if not success:
            return response_set_main_device(
                success=False,
                error=f"Device {command.device_id} not found",
                req_id=command.req_id,
            )
        
        # Get device info for event (may be None for mock devices)
        device_info = self._registry.get_device_info(command.device_id)
        
        # Broadcast main device changed event (non-blocking, don't fail on error)
        try:
            await self._clients.broadcast(
                event_main_device_changed(command.device_id, device_info)
            )
        except Exception as e:
            logger.warning(f"Failed to broadcast main_device_changed event: {e}")
        
        return response_set_main_device(
            success=True,
            device_id=command.device_id,
            device=device_info,
            req_id=command.req_id,
        )
    
    async def _cmd_disconnect_device(self, command: Command) -> Response:
        """Disconnect a specific device by device_id."""
        if not command.device_id:
            return response_disconnect_device(
                success=False,
                error="device_id is required",
                req_id=command.req_id,
            )
        
        if not self._registry.has_device(command.device_id):
            return response_disconnect_device(
                success=False,
                error=f"Device {command.device_id} not found",
                req_id=command.req_id,
            )
        
        # Remove device from registry
        self._registry.remove_device(command.device_id)
        
        # Update _controller if it was the disconnected device
        main_id = self._registry.get_main_device_id()
        if main_id:
            self._controller = self._registry.get_controller()
        else:
            self._controller = None
            self._selected_device = None
        
        # Check if it's a mock device
        is_mock = self._registry.is_mock_device(command.device_id)
        
        # Broadcast device disconnected event
        if is_mock:
            await self._clients.broadcast(event_mock_device_removed(command.device_id))
        else:
            await self._clients.broadcast(event_device_disconnected(command.device_id))
        
        return response_disconnect_device(
            success=True,
            device_id=command.device_id,
            req_id=command.req_id,
        )
    
    async def _cmd_create_mock_device(self, command: Command) -> Response:
        """Create a new mock device for testing."""
        try:
            device_id, controller = self._registry.add_mock_device()
            device_info = self._registry.get_device_info(device_id)
            
            # Broadcast mock device created event
            await self._clients.broadcast(event_mock_device_created(device_info, device_id))
            
            return response_create_mock_device(
                success=True,
                device_id=device_id,
                device=device_info,
                req_id=command.req_id,
            )
        except ValueError as e:
            return response_create_mock_device(
                success=False,
                error=str(e),
                req_id=command.req_id,
            )
    
    async def _cmd_remove_mock_device(self, command: Command) -> Response:
        """Remove a mock device."""
        if not command.device_id:
            return response_remove_mock_device(
                success=False,
                error="device_id is required",
                req_id=command.req_id,
            )
        
        if not self._registry.is_mock_device(command.device_id):
            return response_remove_mock_device(
                success=False,
                error=f"Device {command.device_id} is not a mock device",
                req_id=command.req_id,
            )
        
        if not self._registry.has_device(command.device_id):
            return response_remove_mock_device(
                success=False,
                error=f"Device {command.device_id} not found",
                req_id=command.req_id,
            )
        
        # Remove device from registry
        self._registry.remove_device(command.device_id)
        
        # Broadcast mock device removed event
        await self._clients.broadcast(event_mock_device_removed(command.device_id))
        
        return response_remove_mock_device(
            success=True,
            device_id=command.device_id,
            req_id=command.req_id,
        )
    
    async def _cmd_connect(self, command: Command) -> Response:
        """Connect to the selected device (or device_id if specified)."""
        # If device_id specified, connect to that device
        if command.device_id:
            controller = self._registry.get_controller(command.device_id)
            if controller is None:
                return response_error(f"Device {command.device_id} not found in registry", command.req_id)
            
            device_info = self._registry.get_device_info(command.device_id)
            if device_info:
                await self._clients.broadcast(event_connected(device_info))
            return response_ok(command.req_id)
        
        # Otherwise, connect to selected device (backward compatibility)
        if self._selected_device is None:
            return response_error("No device selected", command.req_id)
        
        # Device should already be in registry from select_device
        # Just verify connection
        controller = self._registry.get_controller()
        if controller is None or not controller.status().connected:
            return response_error("Device not connected. Use select_device first.", command.req_id)
        
        # Broadcast connected event
        await self._clients.broadcast(event_connected(self._selected_device))
        return response_ok(command.req_id)
    
    async def _cmd_disconnect(self, command: Command) -> Response:
        """Disconnect from the vest (or specific device_id if provided)."""
        # If device_id specified, disconnect that device
        if command.device_id:
            if not self._registry.has_device(command.device_id):
                return response_error(f"Device {command.device_id} not found", command.req_id)
            
            self._registry.remove_device(command.device_id)
            # Update _controller if it was the disconnected device
            if self._controller == self._registry.get_controller():
                self._controller = self._registry.get_controller()
            await self._clients.broadcast(event_disconnected())
            return response_ok(command.req_id)
        
        # Otherwise, disconnect main device (backward compatibility)
        main_id = self._registry.get_main_device_id()
        if main_id:
            self._registry.remove_device(main_id)
            self._controller = None
            self._selected_device = None
        
        # Broadcast disconnected event
        await self._clients.broadcast(event_disconnected())
        
        return response_ok(command.req_id)
    
    async def _cmd_create_player(self, command: Command) -> Response:
        """Create a new player."""
        if not command.player_id:
            return response_create_player(
                success=False,
                error="player_id is required",
                req_id=command.req_id,
            )
        
        # Get name from command (could be in a name field or message field)
        # For now, we'll use a simple approach - name can be passed via message or a new field
        name = getattr(command, 'name', None) or (command.message if hasattr(command, 'message') else None)
        
        player = self._player_manager.create_player(command.player_id, name)
        
        return response_create_player(
            success=True,
            player_id=player.player_id,
            name=player.name,
            req_id=command.req_id,
        )
    
    async def _cmd_assign_player(self, command: Command) -> Response:
        """Assign a player to a device."""
        if not command.player_id:
            return response_assign_player(
                success=False,
                error="player_id is required",
                req_id=command.req_id,
            )
        
        if not command.device_id:
            return response_assign_player(
                success=False,
                error="device_id is required",
                req_id=command.req_id,
            )
        
        # Verify device exists
        if not self._registry.has_device(command.device_id):
            return response_assign_player(
                success=False,
                error=f"Device {command.device_id} not found",
                req_id=command.req_id,
            )
        
        # Create player if doesn't exist
        if not self._player_manager.has_player(command.player_id):
            self._player_manager.create_player(command.player_id)
        
        # Assign player to device
        success = self._player_manager.assign_player(command.player_id, command.device_id)
        if not success:
            return response_assign_player(
                success=False,
                error="Failed to assign player",
                req_id=command.req_id,
            )
        
        # Get player info for event
        player = self._player_manager.get_player(command.player_id)
        
        # Broadcast player assigned event
        await self._clients.broadcast(
            event_player_assigned(command.player_id, command.device_id, player.name if player else None)
        )
        
        return response_assign_player(
            success=True,
            player_id=command.player_id,
            device_id=command.device_id,
            req_id=command.req_id,
        )
    
    async def _cmd_unassign_player(self, command: Command) -> Response:
        """Unassign a player from their device."""
        if not command.player_id:
            return response_unassign_player(
                success=False,
                error="player_id is required",
                req_id=command.req_id,
            )
        
        if not self._player_manager.has_player(command.player_id):
            return response_unassign_player(
                success=False,
                error=f"Player {command.player_id} not found",
                req_id=command.req_id,
            )
        
        success = self._player_manager.unassign_player(command.player_id)
        if not success:
            return response_unassign_player(
                success=False,
                error="Failed to unassign player",
                req_id=command.req_id,
            )
        
        # Broadcast player unassigned event
        await self._clients.broadcast(
            event_player_unassigned(command.player_id)
        )
        
        return response_unassign_player(
            success=True,
            player_id=command.player_id,
            req_id=command.req_id,
        )
    
    async def _cmd_list_players(self, command: Command) -> Response:
        """List all players."""
        players = self._player_manager.list_players()
        return response_list_players(players, command.req_id)
    
    async def _cmd_get_player_device(self, command: Command) -> Response:
        """Get the device_id assigned to a player."""
        if not command.player_id:
            return response_get_player_device(
                device_id=None,
                error="player_id is required",
                req_id=command.req_id,
            )
        
        device_id = self._player_manager.get_player_device(command.player_id)
        return response_get_player_device(
            device_id=device_id,
            player_id=command.player_id,
            req_id=command.req_id,
        )
    
    async def _cmd_set_game_player_mapping(self, command: Command) -> Response:
        """Set a game-specific player mapping."""
        if not command.game_id:
            return response_set_game_player_mapping(
                success=False,
                error="game_id is required",
                req_id=command.req_id,
            )
        
        if command.player_num is None:
            return response_set_game_player_mapping(
                success=False,
                error="player_num is required",
                req_id=command.req_id,
            )
        
        if not command.device_id:
            return response_set_game_player_mapping(
                success=False,
                error="device_id is required",
                req_id=command.req_id,
            )
        
        # Verify device exists
        if not self._registry.has_device(command.device_id):
            return response_set_game_player_mapping(
                success=False,
                error=f"Device {command.device_id} not found",
                req_id=command.req_id,
            )
        
        # Set the mapping
        self._game_mapping.set_mapping(command.game_id, command.player_num, command.device_id)
        
        # Broadcast mapping changed event
        await self._clients.broadcast(
            event_game_player_mapping_changed(command.game_id, command.player_num, command.device_id)
        )
        
        return response_set_game_player_mapping(
            success=True,
            game_id=command.game_id,
            player_num=command.player_num,
            device_id=command.device_id,
            req_id=command.req_id,
        )
    
    async def _cmd_clear_game_player_mapping(self, command: Command) -> Response:
        """Clear a game-specific player mapping."""
        if not command.game_id:
            return response_clear_game_player_mapping(
                success=False,
                error="game_id is required",
                req_id=command.req_id,
            )
        
        # Clear mapping (player_num is optional - if None, clears all for game)
        success = self._game_mapping.clear_mapping(command.game_id, command.player_num)
        if not success:
            return response_clear_game_player_mapping(
                success=False,
                error=f"Game {command.game_id} has no mappings",
                req_id=command.req_id,
            )
        
        # Broadcast mapping changed event (device_id=None indicates cleared)
        await self._clients.broadcast(
            event_game_player_mapping_changed(command.game_id, command.player_num or 0, None)
        )
        
        return response_clear_game_player_mapping(
            success=True,
            game_id=command.game_id,
            req_id=command.req_id,
        )
    
    async def _cmd_list_game_player_mappings(self, command: Command) -> Response:
        """List all game-specific player mappings."""
        # If game_id provided, list only for that game
        mappings = self._game_mapping.list_mappings(command.game_id if command.game_id else None)
        return response_list_game_player_mappings(mappings, command.req_id)
    
    def _resolve_device_id(self, command: Command) -> Optional[str]:
        """
        Resolve device_id from command using fallback logic:
        1. Direct device_id
        2. Game-specific mapping (game_id + player_num)
        3. Global player mapping (player_id)
        4. Main device
        """
        # 1. Direct device_id
        if command.device_id:
            return command.device_id
        
        # 2. Game-specific mapping (game_id + player_num)
        if command.game_id and command.player_num is not None:
            device_id = self._game_mapping.get_mapping(command.game_id, command.player_num)
            if device_id:
                return device_id
        
        # 3. Global player mapping (player_id)
        if command.player_id:
            device_id = self._player_manager.get_player_device(command.player_id)
            if device_id:
                return device_id
        
        # 4. Main device (fallback)
        return self._registry.get_main_device_id()
    
    async def _cmd_trigger(self, command: Command) -> Response:
        """Trigger an effect (on specified device_id, game_id+player_num, player_id, or main device)."""
        if command.cell is None or command.speed is None:
            return response_error("Must specify cell and speed", command.req_id)
        
        # Resolve device_id using fallback logic
        target_device_id = self._resolve_device_id(command)
        
        # Get controller for resolved device_id
        controller = self._registry.get_controller(target_device_id)
        
        # If no controller found, try to auto-connect main device (backward compatibility)
        if controller is None:
            if self._selected_device is None:
                return response_error("No device selected and no device_id specified", command.req_id)
            
            # Auto-connect main device
            try:
                device_id, controller = self._registry.add_device(
                    device_id=None,
                    device_info=self._selected_device
                )
                self._controller = controller  # Update for backward compatibility
                await self._clients.broadcast(event_connected(self._selected_device))
            except ValueError as e:
                return response_error(str(e), command.req_id)
        
        # Check if connected
        if not controller.status().connected:
            return response_error("Device not connected", command.req_id)
        
        # Trigger the effect
        success = controller.trigger_effect(command.cell, command.speed)
        
        if success:
            # Broadcast effect triggered event (include resolved device_id)
            await self._clients.broadcast(event_effect_triggered(
                command.cell, 
                command.speed,
                device_id=target_device_id
            ))
            return response_ok(command.req_id)
        else:
            error_msg = controller.status().last_error or "Failed to trigger effect"
            return response_error(error_msg, command.req_id)
    
    async def _cmd_stop(self, command: Command) -> Response:
        """Stop all effects (on specified device_id or all devices)."""
        # If device_id specified, stop that device only
        if command.device_id:
            controller = self._registry.get_controller(command.device_id)
            if controller is None:
                return response_error(f"Device {command.device_id} not found", command.req_id)
            controller.stop_all()
            await self._clients.broadcast(event_all_stopped(device_id=command.device_id))
            return response_ok(command.req_id)
        
        # Otherwise, stop all devices (backward compatibility)
        for controller in self._registry._controllers.values():
            controller.stop_all()
        
        # Broadcast all stopped event
        await self._clients.broadcast(event_all_stopped())
        
        return response_ok(command.req_id)
    
    async def _cmd_status(self, command: Command) -> Response:
        """Get connection status (for specified device_id or main device)."""
        # If device_id specified, get status for that device
        if command.device_id:
            controller = self._registry.get_controller(command.device_id)
            if controller is None:
                return response_status(
                    connected=False,
                    device=None,
                    req_id=command.req_id,
                )
            status = controller.status()
            device_info = self._registry.get_device_info(command.device_id)
            return response_status(
                connected=status.connected,
                device=device_info,
                req_id=command.req_id,
            )
        
        # Otherwise, get status for main device (backward compatibility)
        controller = self._registry.get_controller()
        if controller is None:
            return response_status(
                connected=False,
                device=self._selected_device,
                req_id=command.req_id,
            )
        
        status = controller.status()
        device_info = None
        if status.connected:
            device_info = {
                "bus": status.device_bus,
                "address": status.device_address,
                "serial_number": status.device_serial_number,
                "vendor_id": status.device_vendor_id,
                "product_id": status.device_product_id,
            }
        
        return response_status(
            connected=status.connected,
            device=device_info,
            req_id=command.req_id,
        )
    
    # -------------------------------------------------------------------------
    # CS2 GSI command handlers
    # -------------------------------------------------------------------------
    
    async def _cmd_cs2_start(self, command: Command) -> Response:
        """Start the CS2 GSI server."""
        gsi_port = command.gsi_port or CS2Manager.DEFAULT_GSI_PORT
        
        success, error = self._cs2_manager.start(gsi_port)
        
        if success:
            # Broadcast CS2 started event
            await self._clients.broadcast(event_cs2_started(gsi_port))
            print(f"[CS2] GSI started on port {gsi_port}")
        
        return response_cs2_start(
            success=success,
            gsi_port=gsi_port,
            error=error,
            req_id=command.req_id,
        )
    
    async def _cmd_cs2_stop(self, command: Command) -> Response:
        """Stop the CS2 GSI server."""
        success = self._cs2_manager.stop()
        
        if success:
            # Broadcast CS2 stopped event
            await self._clients.broadcast(event_cs2_stopped())
            print("[CS2] GSI stopped")
        
        return response_cs2_stop(success=success, req_id=command.req_id)
    
    async def _cmd_cs2_status(self, command: Command) -> Response:
        """Get CS2 GSI status."""
        return response_cs2_status(
            running=self._cs2_manager.is_running,
            gsi_port=self._cs2_manager.gsi_port,
            events_received=self._cs2_manager.events_received,
            last_event_ts=self._cs2_manager.last_event_ts,
            req_id=command.req_id,
        )
    
    async def _cmd_cs2_generate_config(self, command: Command) -> Response:
        """Generate CS2 GSI config file content."""
        gsi_port = command.gsi_port or CS2Manager.DEFAULT_GSI_PORT
        config_content = generate_cs2_config(gsi_port)
        
        return response_cs2_generate_config(
            config_content=config_content,
            req_id=command.req_id,
        )
    
    # -------------------------------------------------------------------------
    # CS2 GSI callbacks (called from HTTP thread)
    # -------------------------------------------------------------------------
    
    def _on_cs2_game_event(self, event_type: str, amount: Optional[int], intensity: Optional[int]):
        """
        Called when CS2 detects a game event.
        
        This is called from the HTTP server thread, so we need to schedule
        the broadcast on the event loop.
        """
        if self._loop is None:
            return
        
        event = event_cs2_game_event(event_type, amount, intensity)
        asyncio.run_coroutine_threadsafe(
            self._clients.broadcast(event),
            self._loop,
        )
    
    def _on_cs2_trigger(self, cell: int, speed: int):
        """
        Called when CS2 wants to trigger a haptic effect.
        
        Defaults to main device (backward compatible).
        This performs the actual vest trigger synchronously since
        the vest controller is thread-safe for simple operations.
        """
        # Get main device controller (backward compatible - always uses main device)
        main_device_id = self._registry.get_main_device_id()
        if main_device_id is None:
            return  # No device available
        
        controller = self._registry.get_controller(main_device_id)
        if controller is None or not controller.status().connected:
            return  # Device not connected
        
        # Trigger effect (synchronous, thread-safe)
        controller.trigger_effect(cell, speed)
        
        # Broadcast event (async)
        if self._loop is not None:
            event = event_effect_triggered(cell, speed, device_id=main_device_id)
            asyncio.run_coroutine_threadsafe(
                self._clients.broadcast(event),
                self._loop,
            )
    
    # -------------------------------------------------------------------------
    # Half-Life: Alyx command handlers
    # -------------------------------------------------------------------------
    
    async def _cmd_alyx_start(self, command: Command) -> Response:
        """Start the Alyx console log watcher."""
        log_path = command.log_path  # Can be None for auto-detect
        
        success, error = self._alyx_manager.start(
            log_path,
            alyx_settings=command.alyx_settings,
        )
        
        if success:
            actual_path = str(self._alyx_manager.log_path) if self._alyx_manager.log_path else None
            # Broadcast Alyx started event
            await self._clients.broadcast(event_alyx_started(actual_path or ""))
            print(f"[ALYX] Integration started, watching: {actual_path}")
        
        return response_alyx_start(
            success=success,
            log_path=str(self._alyx_manager.log_path) if self._alyx_manager.log_path else None,
            error=error,
            req_id=command.req_id,
        )
    
    async def _cmd_alyx_stop(self, command: Command) -> Response:
        """Stop the Alyx console log watcher."""
        success = self._alyx_manager.stop()
        
        if success:
            # Broadcast Alyx stopped event
            await self._clients.broadcast(event_alyx_stopped())
            print("[ALYX] Integration stopped")
        
        return response_alyx_stop(success=success, req_id=command.req_id)
    
    async def _cmd_alyx_status(self, command: Command) -> Response:
        """Get Alyx integration status."""
        return response_alyx_status(
            running=self._alyx_manager.is_running,
            log_path=str(self._alyx_manager.log_path) if self._alyx_manager.log_path else None,
            events_received=self._alyx_manager.events_received,
            last_event_ts=self._alyx_manager.last_event_ts,
            req_id=command.req_id,
        )
    
    async def _cmd_alyx_get_mod_info(self, command: Command) -> Response:
        """Get Alyx mod info (download URLs, install instructions)."""
        mod_info = get_alyx_mod_info()
        return response_alyx_get_mod_info(
            mod_info=mod_info,
            req_id=command.req_id,
        )
    
    # -------------------------------------------------------------------------
    # Alyx callbacks (called from watcher thread)
    # -------------------------------------------------------------------------
    
    def _on_alyx_game_event(self, event_type: str, params: dict):
        """
        Called when Alyx detects a game event.
        
        This is called from the file watcher thread, so we need to schedule
        the broadcast on the event loop.
        """
        if self._loop is None:
            return
        
        event = event_alyx_game_event(event_type, params)
        asyncio.run_coroutine_threadsafe(
            self._clients.broadcast(event),
            self._loop,
        )
    
    def _on_alyx_trigger(self, cell: int, speed: int):
        """
        Called when Alyx wants to trigger a haptic effect.
        
        Defaults to main device (backward compatible).
        This performs the actual vest trigger synchronously since
        the vest controller is thread-safe for simple operations.
        """
        # Get main device controller (backward compatible - always uses main device)
        main_device_id = self._registry.get_main_device_id()
        if main_device_id is None:
            return  # No device available
        
        controller = self._registry.get_controller(main_device_id)
        if controller is None or not controller.status().connected:
            return  # Device not connected
        
        # Trigger effect (synchronous, thread-safe)
        controller.trigger_effect(cell, speed)
        
        # Broadcast effect triggered event (async)
        if self._loop is not None:
            event = event_effect_triggered(cell, speed, device_id=main_device_id)
            asyncio.run_coroutine_threadsafe(
                self._clients.broadcast(event),
                self._loop,
            )

    def _on_solenoid_recoil(self, duration_ms: int) -> None:
        """
        Pulse the USB LC relay for mechanical recoil.

        Called from game-integration watcher threads. No-ops if relay is disconnected.
        """
        status = self._relay.status()
        if not status.connected:
            return
        try:
            from ..relay import clamp_on_ms

            duration_ms = clamp_on_ms(int(duration_ms))
            self._relay.pulse(duration_ms)
            if self._loop is not None:
                from .protocol import event_relay_pulsed

                asyncio.run_coroutine_threadsafe(
                    self._clients.broadcast(
                        event_relay_pulsed(int(duration_ms), self._relay.status().to_dict())
                    ),
                    self._loop,
                )
        except Exception as exc:
            logger.warning("Solenoid recoil pulse failed: %s", exc)
    
    # -------------------------------------------------------------------------
    # Left 4 Dead 2 commands
    # -------------------------------------------------------------------------
    
    async def _cmd_l4d2_start(self, command: Command) -> Response:
        """Start watching Left 4 Dead 2 console.log."""
        logger.info(f"[L4D2] Received start command: log_path={command.log_path}, player_name={command.message}")
        log_path = command.log_path
        player_name = command.message  # Using message field for player name
        
        success, error = self._l4d2_manager.start(
            log_path=log_path,
            player_name=player_name,
            solenoid_recoil=command.solenoid_recoil,
        )
        
        if success:
            log_path_str = str(self._l4d2_manager.log_path) if self._l4d2_manager.log_path else None
            await self._clients.broadcast(event_l4d2_started(log_path_str or ""))
            return response_l4d2_start(success=True, log_path=log_path_str, req_id=command.req_id)
        else:
            return response_l4d2_start(success=False, error=error, req_id=command.req_id)
    
    async def _cmd_l4d2_stop(self, command: Command) -> Response:
        """Stop watching Left 4 Dead 2 console.log."""
        success = self._l4d2_manager.stop()
        if success:
            await self._clients.broadcast(event_l4d2_stopped())
        return response_l4d2_stop(success=success, req_id=command.req_id)
    
    async def _cmd_l4d2_status(self, command: Command) -> Response:
        """Get Left 4 Dead 2 integration status."""
        log_path_str = str(self._l4d2_manager.log_path) if self._l4d2_manager.log_path else None
        return response_l4d2_status(
            running=self._l4d2_manager.is_running,
            events_received=self._l4d2_manager.events_received,
            last_event_ts=self._l4d2_manager.last_event_ts,
            last_event_type=None,  # L4D2 manager doesn't track last event type yet
            log_path=log_path_str,
            req_id=command.req_id,
        )
    
    # -------------------------------------------------------------------------
    # Left 4 Dead 2 callbacks
    # -------------------------------------------------------------------------
    
    def _on_l4d2_game_event(self, event_type: str, params: dict):
        """
        Called when Left 4 Dead 2 manager processes a game event.
        
        Broadcasts the event to all connected clients for UI display.
        """
        if self._loop is None:
            return
        
        # Schedule broadcast in event loop
        asyncio.run_coroutine_threadsafe(
            self._clients.broadcast(event_l4d2_game_event(event_type, params)),
            self._loop,
        )
    
    def _on_l4d2_trigger(self, cell: int, speed: int):
        """
        Called when Left 4 Dead 2 manager wants to trigger a haptic effect.
        
        Triggers the effect on the main device.
        """
        # Get main device controller
        main_device_id = self._registry.get_main_device_id()
        if main_device_id is None:
            return  # No device available
        
        controller = self._registry.get_controller(main_device_id)
        if controller is None or not controller.status().connected:
            return  # Device not connected
        
        # Trigger effect (synchronous, thread-safe)
        controller.trigger_effect(cell, speed)
        
        # Broadcast event (async)
        if self._loop is not None:
            event = event_effect_triggered(cell, speed, device_id=main_device_id)
            asyncio.run_coroutine_threadsafe(
                self._clients.broadcast(event),
                self._loop,
            )

    async def _cmd_pistolwhip_start(self, command: Command) -> Response:
        success, error = self._pistolwhip_manager.start(solenoid_recoil=command.solenoid_recoil)
        if success:
            await self._clients.broadcast(event_pistolwhip_started())
            return response_pistolwhip_start(success=True, req_id=command.req_id)
        return response_pistolwhip_start(success=False, error=error, req_id=command.req_id)

    async def _cmd_pistolwhip_stop(self, command: Command) -> Response:
        success = self._pistolwhip_manager.stop()
        if success:
            await self._clients.broadcast(event_pistolwhip_stopped())
        return response_pistolwhip_stop(success=success, req_id=command.req_id)

    async def _cmd_pistolwhip_status(self, command: Command) -> Response:
        return response_pistolwhip_status(
            running=self._pistolwhip_manager.enabled,
            events_received=self._pistolwhip_manager.events_received,
            last_event_ts=self._pistolwhip_manager.last_event_ts,
            last_event_type=self._pistolwhip_manager.last_event_type,
            req_id=command.req_id,
        )

    async def _cmd_pistolwhip_event(self, command: Command) -> Response:
        handled = self._pistolwhip_manager.process_event(
            str(command.event or ""),
            hand=command.hand,
            priority=int(command.priority or 0),
        )
        if not handled:
            return response_pistolwhip_event(
                success=False,
                error="Pistol Whip integration is not started",
                req_id=command.req_id,
            )
        return response_pistolwhip_event(success=True, req_id=command.req_id)

    def _on_pistolwhip_game_event(self, event_type: str, params: dict) -> None:
        if self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(
            self._clients.broadcast(event_pistolwhip_game_event(event_type, params)),
            self._loop,
        )

    def _on_pistolwhip_trigger(self, cell: int, speed: int) -> None:
        main_device_id = self._registry.get_main_device_id()
        if main_device_id is None:
            return
        controller = self._registry.get_controller(main_device_id)
        if controller is None or not controller.status().connected:
            return
        controller.trigger_effect(cell, speed)
        if self._loop is not None:
            event = event_effect_triggered(cell, speed, device_id=main_device_id)
            asyncio.run_coroutine_threadsafe(self._clients.broadcast(event), self._loop)

    async def _cmd_battlesister_start(self, command: Command) -> Response:
        success, error = self._battlesister_manager.start(solenoid_recoil=command.solenoid_recoil)
        if success:
            await self._clients.broadcast(event_battlesister_started())
            return response_battlesister_start(success=True, req_id=command.req_id)
        return response_battlesister_start(success=False, error=error, req_id=command.req_id)

    async def _cmd_battlesister_stop(self, command: Command) -> Response:
        success = self._battlesister_manager.stop()
        if success:
            await self._clients.broadcast(event_battlesister_stopped())
        return response_battlesister_stop(success=success, req_id=command.req_id)

    async def _cmd_battlesister_status(self, command: Command) -> Response:
        return response_battlesister_status(
            running=self._battlesister_manager.enabled,
            events_received=self._battlesister_manager.events_received,
            last_event_ts=self._battlesister_manager.last_event_ts,
            last_event_type=self._battlesister_manager.last_event_type,
            req_id=command.req_id,
        )

    async def _cmd_battlesister_event(self, command: Command) -> Response:
        handled = self._battlesister_manager.process_event(
            str(command.event or ""),
            hand=command.hand,
            priority=int(command.priority or 0),
            angle=command.angle,
        )
        if not handled:
            return response_battlesister_event(
                success=False,
                error="Battle Sister integration is not started",
                req_id=command.req_id,
            )
        return response_battlesister_event(success=True, req_id=command.req_id)

    def _on_battlesister_game_event(self, event_type: str, params: dict) -> None:
        if self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(
            self._clients.broadcast(event_battlesister_game_event(event_type, params)),
            self._loop,
        )

    def _on_battlesister_trigger(self, cell: int, speed: int) -> None:
        main_device_id = self._registry.get_main_device_id()
        if main_device_id is None:
            return
        controller = self._registry.get_controller(main_device_id)
        if controller is None or not controller.status().connected:
            return
        controller.trigger_effect(cell, speed)
        if self._loop is not None:
            event = event_effect_triggered(cell, speed, device_id=main_device_id)
            asyncio.run_coroutine_threadsafe(self._clients.broadcast(event), self._loop)

    async def _cmd_gunmancontracts_start(self, command: Command) -> Response:
        success, error = self._gunmancontracts_manager.start(solenoid_recoil=command.solenoid_recoil)
        if success:
            await self._clients.broadcast(event_gunmancontracts_started())
            return response_gunmancontracts_start(success=True, req_id=command.req_id)
        return response_gunmancontracts_start(success=False, error=error, req_id=command.req_id)

    async def _cmd_gunmancontracts_stop(self, command: Command) -> Response:
        success = self._gunmancontracts_manager.stop()
        if success:
            await self._clients.broadcast(event_gunmancontracts_stopped())
        return response_gunmancontracts_stop(success=success, req_id=command.req_id)

    async def _cmd_gunmancontracts_status(self, command: Command) -> Response:
        return response_gunmancontracts_status(
            running=self._gunmancontracts_manager.enabled,
            events_received=self._gunmancontracts_manager.events_received,
            last_event_ts=self._gunmancontracts_manager.last_event_ts,
            last_event_type=self._gunmancontracts_manager.last_event_type,
            req_id=command.req_id,
        )

    async def _cmd_gunmancontracts_event(self, command: Command) -> Response:
        handled = self._gunmancontracts_manager.process_event(
            str(command.event or ""),
            hand=command.hand,
            priority=int(command.priority or 0),
            angle=command.angle,
            weapon=command.weapon,
            holster=command.holster,
        )
        if not handled:
            return response_gunmancontracts_event(
                success=False,
                error="Gunman Contracts integration is not started",
                req_id=command.req_id,
            )
        return response_gunmancontracts_event(success=True, req_id=command.req_id)

    def _on_gunmancontracts_game_event(self, event_type: str, params: dict) -> None:
        if self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(
            self._clients.broadcast(event_gunmancontracts_game_event(event_type, params)),
            self._loop,
        )

    def _on_gunmancontracts_trigger(self, cell: int, speed: int) -> None:
        main_device_id = self._registry.get_main_device_id()
        if main_device_id is None:
            return
        controller = self._registry.get_controller(main_device_id)
        if controller is None or not controller.status().connected:
            return
        controller.trigger_effect(cell, speed)
        if self._loop is not None:
            event = event_effect_triggered(cell, speed, device_id=main_device_id)
            asyncio.run_coroutine_threadsafe(self._clients.broadcast(event), self._loop)

    # -------------------------------------------------------------------------
    # Generic Screen Health Watcher commands
    # -------------------------------------------------------------------------

    async def _cmd_screen_health_start(self, command: Command) -> Response:
        """Start the generic screen health watcher with a profile JSON."""
        if not command.profile:
            return response_screen_health_start(
                success=False,
                error="profile is required",
                req_id=command.req_id,
            )

        success, error = self._screen_health_manager.start(command.profile)
        if success:
            profile_name = self._screen_health_manager.status().get("profile_name") or ""
            await self._clients.broadcast(event_screen_health_started(profile_name))

        status = self._screen_health_manager.status()
        return response_screen_health_start(
            success=success,
            profile_name=status.get("profile_name"),
            error=error,
            req_id=command.req_id,
        )

    async def _cmd_screen_health_stop(self, command: Command) -> Response:
        """Stop the generic screen health watcher."""
        success = self._screen_health_manager.stop()
        if success:
            await self._clients.broadcast(event_screen_health_stopped())
        return response_screen_health_stop(success=success, req_id=command.req_id)

    async def _cmd_screen_health_status(self, command: Command) -> Response:
        """Get screen health watcher status."""
        s = self._screen_health_manager.status()
        return response_screen_health_status(
            running=bool(s.get("running")),
            profile_name=s.get("profile_name"),
            events_received=int(s.get("events_received") or 0),
            last_event_ts=s.get("last_event_ts"),
            last_hit_ts=s.get("last_hit_ts"),
            req_id=command.req_id,
        )

    async def _cmd_screen_health_test(self, command: Command) -> Response:
        """
        Test a screen health profile once (validate + capture ROI(s) + evaluate).

        This is intended for calibration/debug and avoids starting the continuous loop.
        """
        if not command.profile:
            return response_screen_health_test(success=False, error="profile is required", req_id=command.req_id)

        path_s = (command.frame_bgra_path or "").strip()
        b64_legacy = (command.frame_bgra_base64 or "").strip()
        if (not path_s and not b64_legacy) or command.frame_width is None or command.frame_height is None:
            return response_screen_health_test(
                success=False,
                error=(
                    "frame_bgra_path (raw BGRA file) or legacy frame_bgra_base64, plus frame_width "
                    "and frame_height, are required for screen_health_test"
                ),
                req_id=command.req_id,
            )
        try:
            fw_req = int(command.frame_width)
            fh_req = int(command.frame_height)
        except (TypeError, ValueError):
            return response_screen_health_test(
                success=False,
                error="frame_width and frame_height must be integers",
                req_id=command.req_id,
            )
        if fw_req <= 0 or fh_req <= 0:
            return response_screen_health_test(
                success=False,
                error="frame_width and frame_height must be positive",
                req_id=command.req_id,
            )

        frame_file: Optional[Path] = None
        if path_s:
            frame_file = Path(path_s).expanduser().resolve()
            if not frame_file.is_file():
                return response_screen_health_test(
                    success=False,
                    error=f"frame_bgra_path is not a file: {frame_file}",
                    req_id=command.req_id,
                )
            try:
                raw_bgra = frame_file.read_bytes()
            except OSError as e:
                return response_screen_health_test(
                    success=False,
                    error=f"failed to read frame_bgra_path: {e}",
                    req_id=command.req_id,
                )
        else:
            try:
                raw_bgra = base64.b64decode(b64_legacy, validate=False)
            except Exception as e:
                return response_screen_health_test(
                    success=False,
                    error=f"invalid frame_bgra_base64: {e}",
                    req_id=command.req_id,
                )

        # Always log/print test runs for debugging (even if profile debug mode is off).
        try:
            prof_name = None
            mon_idx = None
            tick_ms = None
            if isinstance(command.profile, dict):
                prof_name = command.profile.get("name")
                cap = command.profile.get("capture") if isinstance(command.profile.get("capture"), dict) else None
                if cap:
                    mon_idx = cap.get("monitor_index")
                    tick_ms = cap.get("tick_ms")
        except Exception:
            prof_name = None
            mon_idx = None
            tick_ms = None

        src_tag = f"path={frame_file}" if frame_file is not None else "legacy_base64"
        msg0 = (
            f"[screen_health_test] start req_id={command.req_id} "
            f"profile={prof_name or '<unnamed>'} monitor_index={mon_idx} tick_ms={tick_ms} "
            f"output_dir={command.output_dir or '<none>'} "
            f"frame={fw_req}x{fh_req} bytes={len(raw_bgra)} {src_tag}"
        )
        logger.info(msg0)
        print(msg0)

        try:
            ok, result, err = self._screen_health_manager.test_profile_once(
                command.profile,
                frame_bgra_bytes=raw_bgra,
                frame_width=fw_req,
                frame_height=fh_req,
                output_dir=command.output_dir,
            )
            if ok and result:
                msg1 = (
                    f"[screen_health_test] ok req_id={command.req_id} "
                    f"total_ms={float(result.get('total_ms') or 0.0):.2f} "
                    f"frame={result.get('frame')} output_dir={result.get('output_dir')}"
                )
                logger.info(msg1)
                print(msg1)

                detectors = result.get("detectors") if isinstance(result.get("detectors"), list) else []
                for d in detectors:
                    if not isinstance(d, dict):
                        continue
                    dtype = d.get("type")
                    name = d.get("name")
                    cap_ms = d.get("capture_ms")
                    eval_ms = d.get("eval_ms")
                    if dtype == "redness_rois":
                        score = d.get("score")
                        thr = d.get("threshold")
                        hit = d.get("hit")
                        line = (
                            f"[screen_health_test] redness name={name} score={score} threshold={thr} hit={hit} "
                            f"cap_ms={cap_ms} eval_ms={eval_ms} image={d.get('image_path')}"
                        )
                    elif dtype == "color_vignette":
                        score = d.get("score")
                        thr = d.get("threshold")
                        hit = d.get("hit")
                        line = (
                            f"[screen_health_test] color_vignette name={name} score={score} threshold={thr} "
                            f"hit={hit} target_rgb={d.get('target_rgb')} tolerance_l1={d.get('tolerance_l1')} "
                            f"cap_ms={cap_ms} eval_ms={eval_ms} image={d.get('image_path')}"
                        )
                    elif dtype == "health_bar":
                        line = (
                            f"[screen_health_test] health_bar name={name} mode={d.get('mode')} "
                            f"percent={d.get('percent')} cap_ms={cap_ms} eval_ms={eval_ms} image={d.get('image_path')}"
                        )
                    elif dtype in ("health_number", "ammo_number"):
                        if d.get("error"):
                            line = (
                                f"[screen_health_test] {dtype} name={name} error={d.get('error')} "
                                f"engine={d.get('engine')} cap_ms={cap_ms} eval_ms={eval_ms}"
                            )
                        else:
                            line = (
                                f"[screen_health_test] {dtype} name={name} read={d.get('read')} "
                                f"ocr_text={d.get('ocr_text')!r} digits={d.get('digits')} "
                                f"engine={d.get('engine')} rect={d.get('rect_px')} "
                                f"cap_ms={cap_ms} eval_ms={eval_ms} image={d.get('image_path')}"
                            )
                    else:
                        line = f"[screen_health_test] detector type={dtype} name={name} cap_ms={cap_ms} eval_ms={eval_ms}"
                    logger.info(line)
                    print(line)

                errors = result.get("errors") if isinstance(result.get("errors"), list) else []
                for e in errors:
                    if not e:
                        continue
                    line = f"[screen_health_test] warning req_id={command.req_id} {e}"
                    logger.warning(line)
                    print(line)
            else:
                msg1 = f"[screen_health_test] failed req_id={command.req_id} error={err or '<unknown>'}"
                logger.warning(msg1)
                print(msg1)
            return response_screen_health_test(success=ok, test_result=result, error=err, req_id=command.req_id)
        except Exception as e:
            msg1 = f"[screen_health_test] exception req_id={command.req_id} error={str(e)}"
            logger.exception(msg1)
            print(msg1)
            return response_screen_health_test(success=False, error=str(e), req_id=command.req_id)
        finally:
            if frame_file is not None:
                try:
                    frame_file.unlink(missing_ok=True)
                except OSError:
                    pass

    async def _cmd_ocr_list_engines(self, command: Command) -> Response:
        active = str(self._ocr_settings.get("engine") or "windows_ocr")
        engines = list_ocr_engines(active)
        return response_ocr_list_engines(engines=engines, ocr_engine=active, req_id=command.req_id)

    async def _cmd_ocr_get_settings(self, command: Command) -> Response:
        active = str(self._ocr_settings.get("engine") or "windows_ocr")
        engines = list_ocr_engines(active)
        return response_ocr_get_settings(ocr_engine=active, engines=engines, req_id=command.req_id)

    async def _cmd_ocr_set_engine(self, command: Command) -> Response:
        raw = (command.ocr_engine or "").strip()
        if not raw:
            return response_ocr_set_engine(False, error="ocr_engine is required", req_id=command.req_id)
        try:
            engine = normalize_text_ocr_engine(raw)
            self._ocr_settings = save_ocr_settings(engine)
        except Exception as e:
            return response_ocr_set_engine(False, error=str(e), req_id=command.req_id)
        return response_ocr_set_engine(True, ocr_engine=engine, req_id=command.req_id)

    # -------------------------------------------------------------------------
    # Generic Screen Health Watcher callbacks
    # -------------------------------------------------------------------------

    def _on_screen_health_game_event(self, event_type: str, params: dict):
        """
        Called when ScreenHealthManager emits a game event.

        Called from the manager thread, so broadcast must be scheduled
        on the asyncio loop.
        """
        if self._loop is None:
            return

        if event_type == "hit_recorded":
            direction = params.get("direction")
            score = float(params.get("score") or 0.0)
            roi = params.get("roi")
            event = event_screen_health_hit(direction=direction, score=score, roi=roi)
        elif event_type == "health_percent":
            detector = params.get("detector")
            percent = float(params.get("percent") or 0.0)
            event = event_screen_health_health(health_percent=percent, detector=detector)
        elif event_type == "health_value":
            detector = params.get("detector")
            value = int(params.get("value") or 0)
            event = event_screen_health_value(health_value=value, detector=detector)
        elif event_type == "ammo_value":
            detector = params.get("detector")
            value = int(params.get("value") or 0)
            event = event_screen_health_ammo_value(ammo_value=value, detector=detector)
        elif event_type == "recoil_fired":
            event = event_screen_health_recoil(
                roi=params.get("roi"),
                value=params.get("value"),
                prev_value=params.get("prev_value"),
                drop=params.get("drop"),
                duration_ms=params.get("duration_ms"),
            )
        elif event_type == "debug":
            detector = params.get("detector")
            event = event_screen_health_debug(params=params, detector=detector)
        else:
            event = event_error(f"Unknown screen_health event_type: {event_type}")

        asyncio.run_coroutine_threadsafe(
            self._clients.broadcast(event),
            self._loop,
        )

    def _on_screen_health_trigger(self, cell: int, speed: int):
        """
        Called when ScreenHealthManager wants to trigger a haptic effect.

        Triggers the effect on the main device.
        """
        main_device_id = self._registry.get_main_device_id()
        if main_device_id is None:
            return  # No device available

        controller = self._registry.get_controller(main_device_id)
        if controller is None or not controller.status().connected:
            return  # Device not connected

        controller.trigger_effect(cell, speed)

        # Broadcast effect triggered event (async)
        if self._loop is not None:
            event = event_effect_triggered(cell, speed, device_id=main_device_id)
            asyncio.run_coroutine_threadsafe(
                self._clients.broadcast(event),
                self._loop,
            )
    
    # -------------------------------------------------------------------------
    # Predefined Effects command handlers
    # -------------------------------------------------------------------------
    
    async def _cmd_play_effect(self, command: Command) -> Response:
        """
        Play a predefined effect.
        
        The effect will run asynchronously, triggering cells according to
        its step pattern.
        """
        if not command.effect_name:
            return response_error("Missing effect_name", command.req_id)
        
        effect = get_effect(command.effect_name)
        if effect is None:
            return response_error(f"Unknown effect: {command.effect_name}", command.req_id)
        
        # Resolve device_id using multi-vest logic
        target_device_id = self._resolve_device_id(command)
        
        # Get controller for resolved device_id
        controller = self._registry.get_controller(target_device_id)
        
        # If no controller found, try to auto-connect main device (backward compatibility)
        if controller is None:
            if self._selected_device is None:
                return response_error("No device selected and no device_id specified", command.req_id)
            
            # Auto-connect main device
            try:
                device_id, controller = self._registry.add_device(
                    device_id=None,
                    device_info=self._selected_device
                )
                self._controller = controller  # Update for backward compatibility
                await self._clients.broadcast(event_connected(self._selected_device))
                target_device_id = device_id
            except ValueError as e:
                return response_error(str(e), command.req_id)
        
        # Check if connected
        if not controller.status().connected:
            return response_error("Device not connected", command.req_id)
        
        # Start the effect playback in background
        asyncio.create_task(self._play_effect_sequence(effect, controller, target_device_id))
        
        return response_play_effect(
            success=True,
            effect_name=command.effect_name,
            req_id=command.req_id,
        )
    
    async def _play_effect_sequence(self, effect, controller, device_id: str = None) -> None:
        """
        Play an effect's step sequence.
        
        This runs asynchronously, triggering cells according to the effect's
        timing pattern.
        """
        from ..vest.effects import Effect
        
        # Broadcast effect started
        await self._clients.broadcast(event_effect_started(effect.name))
        
        try:
            for step in effect.steps:
                # Trigger all cells in this step
                for cell in step.cells:
                    if controller is not None:
                        controller.trigger_effect(cell, step.speed)
                    # Broadcast individual trigger with device_id
                    await self._clients.broadcast(event_effect_triggered(cell, step.speed, device_id=device_id))
                
                # Wait for step duration
                await asyncio.sleep(step.duration_ms / 1000.0)
                
                # Stop cells (speed 0)
                for cell in step.cells:
                    if controller is not None:
                        controller.trigger_effect(cell, 0)
                
                # Wait for delay before next step
                if step.delay_ms > 0:
                    await asyncio.sleep(step.delay_ms / 1000.0)
        
        finally:
            # Broadcast effect completed
            await self._clients.broadcast(event_effect_completed(effect.name))
    
    async def _cmd_list_effects(self, command: Command) -> Response:
        """
        List all available predefined effects.
        
        Returns effects organized by category.
        """
        effects_data = all_effects_to_dict()
        return response_list_effects(
            effects=effects_data["effects"],
            categories=effects_data["categories"],
            req_id=command.req_id,
        )
    
    async def _cmd_stop_effect(self, command: Command) -> Response:
        """
        Stop all cells (emergency stop for effects).
        
        This stops all cells immediately.
        """
        if self._controller is not None:
            for cell in range(8):
                self._controller.trigger_effect(cell, 0)
        
        await self._clients.broadcast(event_all_stopped())
        return response_ok(command.req_id)

    # -------------------------------------------------------------------------
    # USB LC relay (solenoid / recoil)
    # -------------------------------------------------------------------------

    async def _cmd_relay_list_ports(self, command: Command) -> Response:
        """List available serial ports for the USB LC relay."""
        try:
            ports = await asyncio.to_thread(list_relay_ports)
            return response_relay_list_ports(ports, req_id=command.req_id)
        except Exception as exc:
            return response_error(str(exc), command.req_id)

    async def _cmd_relay_connect(self, command: Command) -> Response:
        """Open the serial port for the USB LC relay module."""
        if not command.port:
            return response_relay_connect(
                success=False,
                error="port is required",
                req_id=command.req_id,
            )

        baud = command.baud if command.baud is not None else DEFAULT_BAUD
        address = (
            command.switch_address
            if command.switch_address is not None
            else DEFAULT_ADDRESS
        )

        try:
            await asyncio.to_thread(self._relay.connect, command.port, baud, address)
            status = self._relay.status().to_dict()
            await self._clients.broadcast(event_relay_connected(status))
            return response_relay_connect(
                success=True,
                relay=status,
                req_id=command.req_id,
            )
        except Exception as exc:
            return response_relay_connect(
                success=False,
                error=str(exc),
                req_id=command.req_id,
            )

    async def _cmd_relay_disconnect(self, command: Command) -> Response:
        """Close the USB LC relay serial port."""
        try:
            self._mouse_recoil.stop()
            await asyncio.to_thread(self._relay.disconnect)
            await self._clients.broadcast(event_relay_disconnected())
            await self._clients.broadcast(event_relay_mouse_stopped())
            return response_relay_disconnect(success=True, req_id=command.req_id)
        except Exception as exc:
            return response_relay_disconnect(
                success=False,
                error=str(exc),
                req_id=command.req_id,
            )

    async def _cmd_relay_status(self, command: Command) -> Response:
        """Return current USB LC relay connection status."""
        return response_relay_status(
            self._relay.status().to_dict(),
            req_id=command.req_id,
        )

    async def _cmd_relay_set(self, command: Command) -> Response:
        """Turn the USB LC relay on or off."""
        if command.on is None:
            return response_relay_set(
                success=False,
                error="on is required (true/false)",
                req_id=command.req_id,
            )

        try:
            await asyncio.to_thread(self._relay.set, bool(command.on))
            status = self._relay.status().to_dict()
            await self._clients.broadcast(
                event_relay_state_changed(bool(command.on), status)
            )
            return response_relay_set(
                success=True,
                on=bool(command.on),
                relay=status,
                req_id=command.req_id,
            )
        except Exception as exc:
            return response_relay_set(
                success=False,
                error=str(exc),
                req_id=command.req_id,
            )

    async def _cmd_relay_pulse(self, command: Command) -> Response:
        """Pulse the USB LC relay for solenoid recoil feedback."""
        duration_ms = command.duration_ms if command.duration_ms is not None else 40

        try:
            from ..relay import clamp_on_ms

            duration_ms = clamp_on_ms(duration_ms)
            await asyncio.to_thread(self._relay.pulse, duration_ms)
            status = self._relay.status().to_dict()
            await self._clients.broadcast(event_relay_pulsed(duration_ms, status))
            return response_relay_pulse(
                success=True,
                duration_ms=duration_ms,
                relay=status,
                req_id=command.req_id,
            )
        except Exception as exc:
            return response_relay_pulse(
                success=False,
                duration_ms=duration_ms,
                error=str(exc),
                req_id=command.req_id,
            )

    async def _cmd_relay_mouse_start(self, command: Command) -> Response:
        """Start global left-click → solenoid pulse listening."""
        if not self._relay.status().connected:
            return response_relay_mouse_start(
                success=False,
                running=False,
                error="Relay is not connected — connect on the Relay page first",
                req_id=command.req_id,
            )

        from ..relay import clamp_on_ms

        duration_ms = clamp_on_ms(
            command.duration_ms if command.duration_ms is not None else 40
        )
        fire_mode = command.fire_mode or "single"
        fire_rate_rpm = (
            command.fire_rate_rpm if command.fire_rate_rpm is not None else 600
        )
        burst_count = command.burst_count if command.burst_count is not None else 3

        success, error = await asyncio.to_thread(
            self._mouse_recoil.start,
            duration_ms,
            fire_mode,
            fire_rate_rpm,
            burst_count,
        )
        st = self._mouse_recoil.status()
        if success:
            await self._clients.broadcast(event_relay_mouse_started(duration_ms))
            return response_relay_mouse_start(
                success=True,
                running=True,
                duration_ms=st.get("duration_ms"),
                fire_mode=st.get("fire_mode"),
                fire_rate_rpm=st.get("fire_rate_rpm"),
                burst_count=st.get("burst_count"),
                interval_ms=st.get("interval_ms"),
                pulses=st.get("pulses"),
                req_id=command.req_id,
            )
        return response_relay_mouse_start(
            success=False,
            running=False,
            error=error,
            req_id=command.req_id,
        )

    async def _cmd_relay_mouse_stop(self, command: Command) -> Response:
        """Stop global click-based recoil listening."""
        await asyncio.to_thread(self._mouse_recoil.stop)
        await self._clients.broadcast(event_relay_mouse_stopped())
        return response_relay_mouse_stop(
            success=True,
            running=False,
            req_id=command.req_id,
        )

    async def _cmd_relay_mouse_status(self, command: Command) -> Response:
        """Return click-based recoil listener status."""
        st = self._mouse_recoil.status()
        return response_relay_mouse_status(
            running=bool(st.get("running")),
            duration_ms=st.get("duration_ms"),
            pulses=st.get("pulses"),
            fire_mode=st.get("fire_mode"),
            fire_rate_rpm=st.get("fire_rate_rpm"),
            burst_count=st.get("burst_count"),
            interval_ms=st.get("interval_ms"),
            error=st.get("last_error"),
            req_id=command.req_id,
        )


def run_daemon(
    host: str = VestDaemon.DEFAULT_HOST,
    port: int = VestDaemon.DEFAULT_PORT,
    check_existing: bool = True,
) -> None:
    """
    Run the vest daemon (blocking).
    
    This is the main entry point for running the daemon.
    
    Args:
        host: Host to bind to
        port: Port to listen on
        check_existing: If True, check if daemon is already running
    """
    from .lifecycle import (
        get_daemon_status,
        write_pid_file,
        remove_pid_file,
    )
    
    # Force unbuffered output for PyInstaller executables
    import sys
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(line_buffering=True)
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(line_buffering=True)
    
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        force=True,  # Force reconfiguration in case logging was already configured
    )
    
    # Check if daemon is already running
    if check_existing:
        is_running, pid, msg = get_daemon_status(host, port)
        if is_running:
            print(f"[ERROR] {msg}")
            print("Use 'daemon stop' to stop it first, or use a different port.")
            return
    
    daemon = VestDaemon(host=host, port=port)
    
    # Write PID file
    pid_file = write_pid_file(port)
    logger.info(f"PID file: {pid_file}")
    
    # Handle graceful shutdown
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    def shutdown_handler():
        print("\n[VEST] Shutting down...", flush=True)
        loop.create_task(daemon.stop())
    
    # Register signal handlers
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, shutdown_handler)
        except NotImplementedError:
            # Windows doesn't support add_signal_handler
            signal.signal(sig, lambda s, f: shutdown_handler())
    
    try:
        loop.run_until_complete(daemon.start())
    except KeyboardInterrupt:
        pass
    finally:
        loop.run_until_complete(daemon.stop())
        loop.close()
        # Clean up PID file
        remove_pid_file(port)
        logger.info("PID file removed")


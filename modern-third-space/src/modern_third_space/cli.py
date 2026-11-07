"""
Command-line interface for the Modern Third Space Vest bridge.

This CLI provides commands for:
- Health checks (ping)
- Device discovery (list)
- Connection management (status, connect)
- Actuator control (trigger, stop)
- Effect presets (effects)
- Daemon server (daemon start/stop/status)
- Game integrations (cs2 start/stop/generate-config)

Usage:
    python -m modern_third_space.cli <command> [options]

Examples:
    python -m modern_third_space.cli ping
    python -m modern_third_space.cli list
    python -m modern_third_space.cli status
    python -m modern_third_space.cli connect --bus 1 --address 5
    python -m modern_third_space.cli trigger --cell 0 --speed 5
    python -m modern_third_space.cli stop
    python -m modern_third_space.cli daemon start --port 5050
    python -m modern_third_space.cli daemon stop
    python -m modern_third_space.cli daemon status
    python -m modern_third_space.cli cs2 start
    python -m modern_third_space.cli cs2 generate-config
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict

# Import from vest core package
from .vest import VestController, list_devices

# Import UI presets (separate from vest core)
from .presets import default_effects


def _cmd_status(controller: VestController) -> int:
    """Get connection status."""
    status = controller.connect()
    print(status.to_json())
    return 0


def _cmd_trigger(controller: VestController, args: argparse.Namespace) -> int:
    """Trigger a single actuator."""
    if controller.trigger_effect(args.cell, args.speed):
        print(json.dumps({"success": True, "cell": args.cell, "speed": args.speed}))
        return 0
    print(json.dumps({"success": False, "error": controller.status().last_error}))
    return 1


def _cmd_stop(controller: VestController) -> int:
    """Stop all actuators."""
    controller.stop_all()
    print(json.dumps({"success": True, "action": "stop_all"}))
    return 0


def _cmd_effects(_controller: VestController) -> int:
    """List default effect presets (UI data)."""
    effects = default_effects()
    print(json.dumps(effects, indent=2))
    return 0


def _cmd_ping() -> int:
    """Health check - verify CLI is reachable."""
    print(json.dumps({"status": "ok", "message": "Python bridge is reachable"}))
    return 0


def _cmd_list() -> int:
    """List all connected USB vest devices."""
    devices = list_devices()
    print(json.dumps(devices, indent=2))
    return 0


def _cmd_connect(controller: VestController, args: argparse.Namespace) -> int:
    """Connect to a specific device."""
    device_info: Dict[str, Any] = {}
    
    if args.bus is not None and args.address is not None:
        device_info["bus"] = args.bus
        device_info["address"] = args.address
    elif args.serial is not None:
        device_info["serial_number"] = args.serial
    elif args.index is not None:
        device_info["index"] = args.index
    # If none specified, device_info will be empty (connect to first device)
    
    status = controller.connect_to_device(device_info if device_info else None)
    print(status.to_json())
    return 0 if status.connected else 1


# -------------------------------------------------------------------------
# Daemon subcommands
# -------------------------------------------------------------------------

def _cmd_daemon(args: argparse.Namespace) -> int:
    """Handle daemon subcommands."""
    action = getattr(args, "daemon_action", None) or "start"
    
    if action == "start":
        return _daemon_start(args)
    elif action == "stop":
        return _daemon_stop(args)
    elif action == "status":
        return _daemon_status(args)
    else:
        print(f"Unknown daemon action: {action}")
        return 1


def _daemon_start(args: argparse.Namespace) -> int:
    """Start the vest daemon server."""
    from .server import run_daemon
    
    host = args.host
    port = args.port

    # Optional screen health debug flags (helpful for calibration).
    if getattr(args, "screen_health_debug", False):
        os.environ["THIRD_SPACE_SCREEN_HEALTH_DEBUG"] = "1"
    if getattr(args, "screen_health_debug_save", False):
        os.environ["THIRD_SPACE_SCREEN_HEALTH_DEBUG_SAVE"] = "1"
    if getattr(args, "screen_health_debug_dir", None):
        os.environ["THIRD_SPACE_SCREEN_HEALTH_DEBUG_DIR"] = str(args.screen_health_debug_dir)
    if getattr(args, "screen_health_debug_every_n", None):
        os.environ["THIRD_SPACE_SCREEN_HEALTH_DEBUG_EVERY_N"] = str(args.screen_health_debug_every_n)
    
    print(f"[VEST] Starting vest daemon on {host}:{port}...", flush=True)
    run_daemon(host=host, port=port)
    return 0


def _daemon_stop(args: argparse.Namespace) -> int:
    """Stop the vest daemon server."""
    from .server import stop_daemon
    
    host = args.host
    port = args.port
    force = getattr(args, "force", False)
    
    success, message = stop_daemon(host=host, port=port, force=force)
    
    if success:
        print(f"[OK] {message}")
        return 0
    else:
        print(f"[ERROR] {message}")
        return 1


def _daemon_status(args: argparse.Namespace) -> int:
    """Check daemon status."""
    from .server import get_daemon_status, ping_daemon, get_pid_file_path
    
    host = args.host
    port = args.port
    
    is_running, pid, message = get_daemon_status(host, port)
    
    print(f"Daemon: {'[RUNNING]' if is_running else '[NOT RUNNING]'}")
    print(f"Status: {message}")
    print(f"PID file: {get_pid_file_path(port)}")
    
    if is_running:
        # Try to ping for more details
        success, response = ping_daemon(host, port)
        if success:
            print(f"Connected to vest: {'Yes' if response.get('connected') else 'No'}")
            print(f"Device selected: {'Yes' if response.get('has_device_selected') else 'No'}")
            print(f"Connected clients: {response.get('client_count', 0)}")
        else:
            print(f"Ping failed: {response.get('error', 'Unknown error')}")
        return 0
    
    return 1


# -------------------------------------------------------------------------
# CS2 GSI subcommands
# -------------------------------------------------------------------------

def _cmd_cs2(args: argparse.Namespace) -> int:
    """Handle CS2 GSI subcommands."""
    action = getattr(args, "cs2_action", None) or "start"
    
    if action == "start":
        return _cs2_start(args)
    elif action == "generate-config":
        return _cs2_generate_config(args)
    elif action == "status":
        return _cs2_status(args)
    else:
        print(f"Unknown cs2 action: {action}")
        return 1


def _cs2_start(args: argparse.Namespace) -> int:
    """Start the CS2 GSI integration."""
    import asyncio
    from .integrations.cs2_gsi import run_cs2_gsi
    
    gsi_host = getattr(args, "gsi_host", "127.0.0.1")
    gsi_port = getattr(args, "gsi_port", 3000)
    daemon_host = getattr(args, "daemon_host", "127.0.0.1")
    daemon_port = getattr(args, "daemon_port", None)
    
    print(f"[CS2] Starting CS2 GSI integration...")
    print(f"   GSI server: http://{gsi_host}:{gsi_port}")
    if daemon_port:
        print(f"   Daemon: {daemon_host}:{daemon_port}")
    else:
        print(f"   Daemon: auto-discover on {daemon_host}")
    print()
    print("[INFO] Make sure CS2 has the GSI config file:")
    print("   Run: python -m modern_third_space.cli cs2 generate-config")
    print()
    
    try:
        asyncio.run(run_cs2_gsi(
            gsi_host=gsi_host,
            gsi_port=gsi_port,
            daemon_host=daemon_host,
            daemon_port=daemon_port
        ))
    except KeyboardInterrupt:
        print("\n👋 CS2 GSI integration stopped")
    
    return 0


def _cs2_generate_config(args: argparse.Namespace) -> int:
    """Generate CS2 GSI config file."""
    import os
    from .integrations.cs2_gsi import generate_gsi_config, get_cs2_cfg_path
    
    gsi_host = getattr(args, "gsi_host", "127.0.0.1")
    gsi_port = getattr(args, "gsi_port", 3000)
    output_path = getattr(args, "output", None)
    
    config_content = generate_gsi_config(host=gsi_host, port=gsi_port)
    
    if output_path:
        # Write to specified path
        with open(output_path, "w") as f:
            f.write(config_content)
        print(f"[OK] Config written to: {output_path}")
        return 0
    
    # Try to find CS2 directory
    cs2_cfg_path = get_cs2_cfg_path()
    
    if cs2_cfg_path:
        config_file = os.path.join(cs2_cfg_path, "gamestate_integration_thirdspace.cfg")
        
        # Ask for confirmation
        print(f"📂 Found CS2 config directory:")
        print(f"   {cs2_cfg_path}")
        print()
        print(f"📄 Will create:")
        print(f"   {config_file}")
        print()
        print("Config content:")
        print("-" * 40)
        print(config_content)
        print("-" * 40)
        print()
        
        response = input("Write this file? [y/N] ").strip().lower()
        if response == "y":
            with open(config_file, "w") as f:
                f.write(config_content)
            print(f"[OK] Config written!")
            print()
            print("[CS2] Restart CS2 for changes to take effect.")
            return 0
        else:
            print("[CANCELLED]")
            return 1
    else:
        # Print config and manual instructions
        print("[INFO] Could not find CS2 config directory automatically.")
        print()
        print("[INFO] Manually create this file:")
        print("   <CS2_DIR>/game/csgo/cfg/gamestate_integration_thirdspace.cfg")
        print()
        print("Config content:")
        print("-" * 40)
        print(config_content)
        print("-" * 40)
        return 0


def _cs2_status(args: argparse.Namespace) -> int:
    """Check CS2 GSI status."""
    import socket
    from .integrations.cs2_gsi import find_daemon_port, get_cs2_cfg_path
    
    gsi_port = getattr(args, "gsi_port", 3000)
    daemon_host = getattr(args, "daemon_host", "127.0.0.1")
    
    print("[CS2] CS2 GSI Integration Status")
    print("=" * 40)
    
    # Check if GSI port is in use (integration running)
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(0.5)
        result = sock.connect_ex(("127.0.0.1", gsi_port))
        sock.close()
        
        if result == 0:
            print(f"GSI Server: [RUNNING] on port {gsi_port}")
        else:
            print(f"GSI Server: [NOT RUNNING]")
    except Exception:
        print(f"GSI Server: [NOT RUNNING]")
    
    # Check daemon
    daemon_port = find_daemon_port(daemon_host)
    if daemon_port:
        print(f"Vest Daemon: [RUNNING] on port {daemon_port}")
    else:
        print(f"Vest Daemon: [NOT RUNNING]")
    
    # Check CS2 config file
    cs2_cfg_path = get_cs2_cfg_path()
    if cs2_cfg_path:
        import os
        config_file = os.path.join(cs2_cfg_path, "gamestate_integration_thirdspace.cfg")
        if os.path.exists(config_file):
            print(f"GSI Config: [OK] Found at {config_file}")
        else:
            print(f"GSI Config: [MISSING] Not found (run: cs2 generate-config)")
    else:
        print(f"GSI Config: [WARN] CS2 directory not found")
    
    print()
    return 0


def _daemon_request(host: str, port: int, payload: dict) -> dict:
    import json
    import socket

    with socket.create_connection((host, port), timeout=3) as sock:
        sock.sendall((json.dumps(payload) + "\n").encode("utf-8"))
        buf = b""
        sock.settimeout(3)
        while b"\n" not in buf:
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf += chunk
    line = buf.split(b"\n", 1)[0]
    return json.loads(line.decode("utf-8"))


def _cmd_recoil(args: argparse.Namespace) -> int:
    """Bench the wireless dongle, or attach it to the running vest daemon."""
    from .recoil_link import RecoilLink, list_recoil_ports

    action = getattr(args, "recoil_action", None)
    if not action:
        print("Usage: recoil {list,connect,ping,pulse,on,off,stop}")
        return 1
    if action == "list":
        try:
            ports = list_recoil_ports()
        except Exception as exc:
            print(exc)
            return 1
        if not ports:
            print("No serial ports found.")
            return 0
        for port in ports:
            mark = "recoil" if port.get("likely_recoil") else "      "
            print(f"{mark}  {port.get('device') or '':<8} {port.get('description') or ''}")
        return 0

    if getattr(args, "daemon", False):
        host = getattr(args, "daemon_host", None) or "127.0.0.1"
        daemon_port = int(getattr(args, "daemon_port", None) or 5050)
        payload: dict = {"cmd": "recoil_status"}
        if action == "connect":
            if not args.port:
                print("--port is required")
                return 1
            payload = {"cmd": "recoil_connect", "port": args.port}
        elif action == "ping":
            payload = {"cmd": "recoil_status"}
        elif action == "pulse":
            payload = {"cmd": "recoil_pulse", "duration_ms": int(getattr(args, "ms", None) or 25)}
        elif action == "on":
            payload = {"cmd": "recoil_set", "on": True}
        elif action == "off":
            payload = {"cmd": "recoil_set", "on": False}
        elif action == "stop":
            payload = {"cmd": "recoil_set", "on": False}
        else:
            print(f"Unknown recoil action: {action}")
            return 1
        try:
            reply = _daemon_request(host, daemon_port, payload)
        except Exception as exc:
            print(exc)
            return 1
        if action == "on" and reply.get("success", reply.get("ok")):
            print("Lease started on the daemon. Press Enter to release.")
            try:
                input()
            except EOFError:
                pass
            try:
                reply = _daemon_request(host, daemon_port, {"cmd": "recoil_set", "on": False})
            except Exception as exc:
                print(exc)
                return 1
        ok = reply.get("success", reply.get("ok"))
        if not ok:
            print(reply.get("message") or reply)
            return 1
        print(reply)
        return 0

    port = getattr(args, "port", None)
    if not port:
        print("--port is required (or pass --daemon while the vest daemon is running)")
        return 1
    link = RecoilLink()
    result = None
    try:
        link.connect(port)
        if action in ("ping", "connect"):
            result = link.ping()
        elif action == "pulse":
            result = link.pulse(int(getattr(args, "ms", None) or 25))
        elif action == "on":
            result = link.set_hold(True)
            if result.ok:
                print("Lease started. Press Enter to release.")
                try:
                    input()
                except EOFError:
                    pass
                result = link.set_hold(False)
        elif action == "off":
            result = link.set_hold(False)
        elif action == "stop":
            result = link.stop()
        else:
            print(f"Unknown recoil action: {action}")
            return 1
    except Exception as exc:
        print(exc)
        return 1
    finally:
        # STOP would cancel a pulse the receiver has already started timing.
        link.disconnect(stop=action in ("on", "off", "stop"))
    if result is None or not result.ok:
        print(result.error if result is not None else "failed")
        return 1
    print(
        f"OK seq={result.seq} state={result.state} flags={result.flags} ack_seq={result.ack_seq}"
    )
    return 0


def _cmd_relay(args: argparse.Namespace) -> int:
    """Handle relay subcommands (standalone serial, no daemon required)."""
    from .relay_cli import main as relay_main

    action = getattr(args, "relay_action", None)
    if not action:
        print("Usage: relay {list,connect,on,off,pulse}")
        return 1

    # Rebuild argv for relay_cli
    argv = [action]
    if getattr(args, "port", None):
        argv.extend(["--port", args.port])
    if getattr(args, "baud", None) is not None and action != "list":
        argv.extend(["--baud", str(args.baud)])
    if getattr(args, "address", None) is not None and action != "list":
        argv.extend(["--address", str(args.address)])
    if action == "pulse" and getattr(args, "ms", None) is not None:
        argv.extend(["--ms", str(args.ms)])
    return relay_main(argv)


def _cmd_ocr(args: argparse.Namespace) -> int:
    """OCR eval / engine listing (no daemon required)."""
    from pathlib import Path

    from .server.ocr import list_ocr_engines
    from .server.ocr.eval import (
        default_fixture_dir,
        evaluate_folder,
        evaluate_repeats,
        format_eval_table,
        format_repeat_table,
        reports_to_json,
        summaries_to_json,
    )

    action = getattr(args, "ocr_action", None) or "eval"
    if action == "engines":
        for row in list_ocr_engines():
            mark = "ready" if row["available"] else "missing"
            print(f"{row['id']:<22} {mark:<8} {row['label']}")
        return 0

    folder = Path(args.dir) if getattr(args, "dir", None) else default_fixture_dir()
    engines = [args.engine] if getattr(args, "engine", None) else None
    repeats = max(1, int(getattr(args, "repeats", 1) or 1))
    if repeats > 1:
        summaries = evaluate_repeats(folder, engines=engines, repeats=repeats)
        if getattr(args, "json", False):
            print(summaries_to_json(summaries))
        else:
            print(format_repeat_table(summaries, folder))
            if not any(s.images for s in summaries):
                print(f"No labeled images in {folder} (name files like 12.png).")
                return 1
        return 0

    reports = evaluate_folder(folder, engines=engines)
    if getattr(args, "json", False):
        print(reports_to_json(reports))
    else:
        print(format_eval_table(reports, folder))
        if not any(r.total for r in reports):
            print(f"No labeled images in {folder} (name files like 12.png).")
            return 1
    return 0


COMMANDS: Dict[str, Any] = {
    "status": _cmd_status,
    "trigger": _cmd_trigger,
    "stop": _cmd_stop,
    "effects": _cmd_effects,
    "ping": _cmd_ping,
    "list": _cmd_list,
    "connect": _cmd_connect,
    "daemon": _cmd_daemon,
    "cs2": _cmd_cs2,
    "relay": _cmd_relay,
    "recoil": _cmd_recoil,
    "ocr": _cmd_ocr,
}


def build_parser() -> argparse.ArgumentParser:
    """Build the argument parser."""
    parser = argparse.ArgumentParser(
        description="Modern Third Space Vest bridge CLI"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("status", help="Print connection status")
    sub.add_parser("effects", help="List default effect presets")

    trigger = sub.add_parser("trigger", help="Trigger a single actuator")
    trigger.add_argument("--cell", type=int, required=True, help="Cell index (0-7)")
    trigger.add_argument("--speed", type=int, required=True, help="Speed (0-10)")

    sub.add_parser("stop", help="Stop all actuators")
    sub.add_parser("ping", help="Health check - verify CLI is reachable")
    sub.add_parser("list", help="List all connected USB vest devices")
    
    connect = sub.add_parser("connect", help="Connect to a specific device")
    connect.add_argument("--bus", type=int, help="USB bus number (requires --address)")
    connect.add_argument("--address", type=int, help="USB device address (requires --bus)")
    connect.add_argument("--serial", type=str, help="Device serial number")
    connect.add_argument("--index", type=int, help="Device index in list")
    
    # Daemon command with subcommands
    daemon = sub.add_parser("daemon", help="Manage the vest daemon server")
    daemon.add_argument("--host", type=str, default="127.0.0.1", help="Host (default: 127.0.0.1)")
    daemon.add_argument("--port", type=int, default=5050, help="Port (default: 5050)")
    
    daemon_sub = daemon.add_subparsers(dest="daemon_action")
    
    # daemon start
    daemon_start = daemon_sub.add_parser("start", help="Start the daemon")
    daemon_start.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind to")
    daemon_start.add_argument("--port", type=int, default=5050, help="Port to listen on")
    daemon_start.add_argument(
        "--screen-health-debug",
        action="store_true",
        help="Enable Generic Screen Health debug value logs (equivalent to THIRD_SPACE_SCREEN_HEALTH_DEBUG=1)",
    )
    daemon_start.add_argument(
        "--screen-health-debug-save",
        action="store_true",
        help="Save ROI crops as .bmp during Generic Screen Health runs (equivalent to THIRD_SPACE_SCREEN_HEALTH_DEBUG_SAVE=1)",
    )
    daemon_start.add_argument(
        "--screen-health-debug-dir",
        type=str,
        default=None,
        help="Directory to save ROI crops (equivalent to THIRD_SPACE_SCREEN_HEALTH_DEBUG_DIR=...)",
    )
    daemon_start.add_argument(
        "--screen-health-debug-every-n",
        type=int,
        default=None,
        help="Log cadence in ticks (equivalent to THIRD_SPACE_SCREEN_HEALTH_DEBUG_EVERY_N=...)",
    )
    
    # daemon stop
    daemon_stop = daemon_sub.add_parser("stop", help="Stop the daemon")
    daemon_stop.add_argument("--host", type=str, default="127.0.0.1", help="Daemon host")
    daemon_stop.add_argument("--port", type=int, default=5050, help="Daemon port")
    daemon_stop.add_argument("--force", action="store_true", help="Force kill (SIGKILL)")
    
    # daemon status
    daemon_status = daemon_sub.add_parser("status", help="Check daemon status")
    daemon_status.add_argument("--host", type=str, default="127.0.0.1", help="Daemon host")
    daemon_status.add_argument("--port", type=int, default=5050, help="Daemon port")
    
    # -------------------------------------------------------------------------
    # CS2 GSI commands
    # -------------------------------------------------------------------------
    cs2 = sub.add_parser("cs2", help="Counter-Strike 2 GSI integration")
    cs2_sub = cs2.add_subparsers(dest="cs2_action")
    
    # cs2 start
    cs2_start = cs2_sub.add_parser("start", help="Start CS2 GSI integration")
    cs2_start.add_argument("--gsi-host", type=str, default="127.0.0.1", help="GSI server host (default: 127.0.0.1)")
    cs2_start.add_argument("--gsi-port", type=int, default=3000, help="GSI server port (default: 3000)")
    cs2_start.add_argument("--daemon-host", type=str, default="127.0.0.1", help="Vest daemon host")
    cs2_start.add_argument("--daemon-port", type=int, default=None, help="Vest daemon port (auto-discover if not set)")
    
    # cs2 generate-config
    cs2_config = cs2_sub.add_parser("generate-config", help="Generate CS2 GSI config file")
    cs2_config.add_argument("--gsi-host", type=str, default="127.0.0.1", help="GSI server host")
    cs2_config.add_argument("--gsi-port", type=int, default=3000, help="GSI server port")
    cs2_config.add_argument("--output", "-o", type=str, help="Output file path (auto-detect if not set)")
    
    # cs2 status
    cs2_status = cs2_sub.add_parser("status", help="Check CS2 GSI status")
    cs2_status.add_argument("--gsi-port", type=int, default=3000, help="GSI server port")
    cs2_status.add_argument("--daemon-host", type=str, default="127.0.0.1", help="Vest daemon host")

    # -------------------------------------------------------------------------
    # USB LC relay / solenoid recoil
    # -------------------------------------------------------------------------
    relay = sub.add_parser("relay", help="USB LC relay / solenoid recoil (standalone serial)")
    relay_sub = relay.add_subparsers(dest="relay_action")

    relay_sub.add_parser("list", help="List serial ports")

    def _add_relay_port_args(p: argparse.ArgumentParser) -> None:
        p.add_argument("--port", required=True, help="Serial port (e.g. COM3)")
        p.add_argument("--baud", type=int, default=9600, help="Baud rate (default 9600)")
        p.add_argument("--address", type=int, default=1, help="Switch address (default 1)")

    relay_connect = relay_sub.add_parser("connect", help="Open port and report status")
    _add_relay_port_args(relay_connect)

    relay_on = relay_sub.add_parser("on", help="Turn relay ON")
    _add_relay_port_args(relay_on)

    relay_off = relay_sub.add_parser("off", help="Turn relay OFF")
    _add_relay_port_args(relay_off)

    relay_pulse = relay_sub.add_parser("pulse", help="Pulse relay for recoil")
    _add_relay_port_args(relay_pulse)
    relay_pulse.add_argument("--ms", type=int, default=40, help="Pulse duration in ms")

    recoil = sub.add_parser("recoil", help="Wireless nRF52840 solenoid link (standalone serial)")
    recoil_sub = recoil.add_subparsers(dest="recoil_action")
    recoil_sub.add_parser("list", help="List serial ports")

    def _add_recoil_port(p: argparse.ArgumentParser, *, port_required: bool = False) -> None:
        p.add_argument("--port", required=port_required, help="Dongle COM port (e.g. COM5)")
        p.add_argument(
            "--daemon",
            action="store_true",
            help="Talk to the vest daemon (so games use this dongle)",
        )
        p.add_argument("--daemon-host", default="127.0.0.1")
        p.add_argument("--daemon-port", type=int, default=5050)

    recoil_connect = recoil_sub.add_parser("connect", help="Open the dongle on the daemon")
    _add_recoil_port(recoil_connect, port_required=True)
    recoil_ping = recoil_sub.add_parser("ping", help="Confirm the receiver answers")
    _add_recoil_port(recoil_ping)
    recoil_pulse = recoil_sub.add_parser("pulse", help="Fire one receiver-timed pulse")
    _add_recoil_port(recoil_pulse)
    recoil_pulse.add_argument("--ms", type=int, default=25, help="Pulse duration in ms (5-100)")
    recoil_on = recoil_sub.add_parser("on", help="Hold the lease until Enter")
    _add_recoil_port(recoil_on)
    recoil_off = recoil_sub.add_parser("off", help="Release the lease")
    _add_recoil_port(recoil_off)
    recoil_stop = recoil_sub.add_parser("stop", help="Force the receiver output off")
    _add_recoil_port(recoil_stop)

    ocr = sub.add_parser("ocr", help="Ammo OCR eval against HUD crops")
    ocr_sub = ocr.add_subparsers(dest="ocr_action")
    ocr_sub.add_parser("engines", help="List OCR backends and whether they are installed")
    ocr_eval = ocr_sub.add_parser("eval", help="Score engines on tests/fixtures/ammo_ocr")
    ocr_eval.add_argument("--dir", type=str, default=None, help="Folder of images named like 12.png")
    ocr_eval.add_argument("--repeats", type=int, default=1, help="Run N times to measure consistency (e.g. 5)")
    ocr_eval.add_argument("--json", action="store_true", help="Print JSON instead of a table")

    return parser


def main(argv: list[str] | None = None) -> int:
    """Main entry point."""
    parser = build_parser()
    args = parser.parse_args(argv)
    command = args.command
    handler = COMMANDS.get(command)
    
    if handler is None:
        parser.print_help()
        return 1
    
    # Commands that don't need a controller
    if command == "ping":
        return handler()
    if command == "list":
        return handler()
    if command == "daemon":
        return handler(args)
    if command == "cs2":
        return handler(args)
    if command == "relay":
        return handler(args)
    if command == "recoil":
        return handler(args)
    if command == "ocr":
        return handler(args)
    
    # Commands that need a controller
    controller = VestController()
    
    # Commands that need args
    if command in ("trigger", "connect"):
        return handler(controller, args)
    else:
        return handler(controller)


if __name__ == "__main__":
    sys.exit(main())

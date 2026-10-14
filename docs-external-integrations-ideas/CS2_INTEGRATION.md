# Counter-Strike 2 GSI Integration

This document describes how to integrate Counter-Strike 2 with the Third Space Vest using Game State Integration (GSI).

## Overview

```
┌─────────────────────────────────────┐
│        Counter-Strike 2             │
│   (Posts JSON on state changes)     │
└─────────────┬───────────────────────┘
              │ HTTP POST (port 3000)
              ▼
┌─────────────────────────────────────┐
│   CS2 GSI Integration               │
│   (integrations/cs2_gsi.py)         │
│                                     │
│   • Receives CS2 game state         │
│   • Detects events (damage, death)  │
│   • Maps events → haptic effects    │
└─────────────┬───────────────────────┘
              │ TCP client (port 5050)
              ▼
┌─────────────────────────────────────┐
│   Vest Daemon                       │
│   (Broadcasts to all clients)       │
└─────────────┬───────────────────────┘
              │
              ▼
┌─────────────────────────────────────┐
│   Vest Hardware                     │
│   (8 actuator cells)                │
└─────────────────────────────────────┘
```

## Quick Start

### 1. Start the Vest Daemon

```bash
python3 -m modern_third_space.cli daemon start
```

### 2. Generate CS2 Config File

```bash
python3 -m modern_third_space.cli cs2 generate-config
```

This creates `gamestate_integration_thirdspace.cfg` in your CS2 config directory:
- **Windows**: `C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\cfg\`
- **macOS**: `~/Library/Application Support/Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo/cfg/`
- **Linux**: `~/.steam/steam/steamapps/common/Counter-Strike Global Offensive/game/csgo/cfg/`

> **Note**: CS2 still uses the legacy "Counter-Strike Global Offensive" folder name and "csgo" subfolder.

### 3. Start CS2 GSI Integration

```bash
python3 -m modern_third_space.cli cs2 start
```

### 4. Launch Counter-Strike 2

The integration will automatically receive game state updates and trigger haptic feedback.

## CLI Commands

```bash
# Start the integration
python3 -m modern_third_space.cli cs2 start
python3 -m modern_third_space.cli cs2 start --gsi-port 3000 --daemon-port 5050

# Generate CS2 config file
python3 -m modern_third_space.cli cs2 generate-config
python3 -m modern_third_space.cli cs2 generate-config --output /path/to/file.cfg

# Check status
python3 -m modern_third_space.cli cs2 status
```

## Event-to-Haptic Mapping

The integration detects the following game events and triggers corresponding haptic effects:

| Event | Detection | Haptic Effect |
|-------|-----------|---------------|
| **Damage Taken** | Health decreased | Intensity scales with damage: <25=front cells, <50=front+back, 50+=all cells |
| **Death** | Health went to 0 | Full vest pulse (all cells, max intensity) |
| **Flashbang** | Flash amount > 50 | Quick burst on upper cells |
| **Bomb Planted** | Bomb state changed to "planted" | Subtle pulse on lower cells |
| **Bomb Exploded** | Bomb state changed to "exploded" | Maximum intensity all cells |
| **Round Start** | Phase changed to "live" from "freezetime" | Light activation all cells |
| **Got a Kill** | Round kills increased | Quick pulse on front cells |

### Vest Cell Layout

The Third Space Vest has 8 actuator cells:

```
  FRONT          BACK
┌───┬───┐    ┌───┬───┐
│ 0 │ 1 │    │ 4 │ 5 │  Upper
├───┼───┤    ├───┼───┤
│ 2 │ 3 │    │ 6 │ 7 │  Lower
└───┴───┘    └───┴───┘
```

## Configuration

### GSI Config File

The config file tells CS2 what data to send and where:

```cfg
"ThirdSpace Vest Integration"
{
    "uri"          "http://127.0.0.1:3000/"
    "timeout"      "5.0"
    "buffer"       "0.1"
    "throttle"     "0.1"
    "heartbeat"    "10.0"
    "data"
    {
        "provider"                  "1"
        "map"                       "1"
        "round"                     "1"
        "player_id"                 "1"
        "player_state"              "1"
        "player_weapons"            "1"
        "player_match_stats"        "1"
    }
}
```

### Future: Effect Configuration

> **TODO**: Make effect mapping configurable via JSON/YAML config file.

Currently effects are hardcoded. Future versions will allow customization:

```yaml
# Future: effects.yaml
damage:
  cells: [0, 1, 2, 3]
  speed_scale: 0.1  # damage * scale = speed
  duration: 0.3

death:
  cells: all
  speed: 10
  duration: 0.5

# ... etc
```

## Technical Details

### How CS2 GSI Works

1. CS2 reads config files from `game/csgo/cfg/gamestate_integration_*.cfg`
2. When game state changes, CS2 POSTs JSON to the configured URI
3. The JSON includes current state AND `previously` object for change detection
4. Our integration parses this JSON and triggers appropriate haptics

### Implementation Reference

**Haptic event design** (damage, flashbang, bomb, round flow) is inspired by:
- [bHaptics Counter-Strike 2](https://www.bhaptics.com/games/experiences/counter-strike-2/)
- [OWO Counter-Strike 2](https://owogame.com/game/counter-strike-2/)

**GSI listener / parsing** builds on:
- [csgo-gsi-python](https://github.com/Erlendeikeland/csgo-gsi-python) - Simple Python GSI server
- [CSGO-GSI](https://github.com/mdarvanaghi/CSGO-GSI) - Structured Python GSI library
- [CounterStrike2GSI (C#)](https://github.com/antonpup/CounterStrike2GSI) - Full-featured C# library

### Game State JSON Structure

Key fields used for haptic feedback:

```json
{
  "provider": {"name": "Counter-Strike 2", "appid": 730},
  "player": {
    "name": "PlayerName",
    "team": "CT",
    "activity": "playing",
    "state": {
      "health": 75,
      "armor": 100,
      "helmet": true,
      "flashed": 0,
      "burning": 0,
      "round_kills": 1
    }
  },
  "round": {
    "phase": "live",
    "bomb": "planted"
  },
  "map": {
    "name": "de_dust2",
    "phase": "live"
  },
  "previously": {
    "player": {
      "state": {"health": 100}
    }
  }
}
```

## Troubleshooting

### GSI Server Not Receiving Data

1. **Check config file location**: Must be in `game/csgo/cfg/` directory
2. **Restart CS2**: Config is only read on startup
3. **Check firewall**: Allow incoming connections on port 3000
4. **Verify with status**: `python3 -m modern_third_space.cli cs2 status`

### Daemon Not Connected

1. **Start daemon first**: `python3 -m modern_third_space.cli daemon start`
2. **Check daemon status**: `python3 -m modern_third_space.cli daemon status`
3. **Verify port**: Both integration and daemon must use same port

### No Haptic Feedback

1. **Check vest connection**: Is a device selected in the daemon?
2. **Check activity**: Effects only trigger when `player.activity == "playing"`
3. **Check logs**: Run with `--verbose` for detailed logging

## Testing Without CS2

You can test the integration by sending HTTP POST requests:

```bash
# Start daemon and integration
python3 -m modern_third_space.cli daemon start &
python3 -m modern_third_space.cli cs2 start &

# Send test damage payload
curl -X POST http://127.0.0.1:3000 \
  -H "Content-Type: application/json" \
  -d '{
    "provider": {"name": "Counter-Strike 2", "appid": 730},
    "player": {
      "name": "Test",
      "activity": "playing",
      "state": {"health": 50}
    },
    "round": {"phase": "live"},
    "map": {"phase": "live"},
    "previously": {"player": {"state": {"health": 100}}}
  }'
```

## See Also

- [DAEMON_ARCHITECTURE.md](./DAEMON_ARCHITECTURE.md) - Daemon protocol documentation
- [Valve GSI Documentation](https://developer.valvesoftware.com/wiki/Counter-Strike:_Global_Offensive_Game_State_Integration)


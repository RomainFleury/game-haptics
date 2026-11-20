# Half-Life: Alyx Integration

> **Status: ✅ IMPLEMENTED**
>
> The Half-Life: Alyx integration has been fully implemented and is available via the daemon and Electron UI.

This document outlines the strategy and implementation for integrating haptic feedback with Half-Life: Alyx using the Third Space Vest.

## Quick Start

1. **Browse** to `Half-Life Alyx/game/hlvr/console.log` in the app (launch once via Steam with `-condebug` if the file is missing).
2. **Install Mod** in the Alyx page — copies bundled `mods/alyx/tactsuit.lua` into `game/hlvr/scripts/vscripts/` and ensures `skill_manifest.cfg` contains `script_reload_code tactsuit.lua`.
3. **Start** the Alyx integration, then use **Launch via Steam** (`-condebug` is included).

Manual alternative: download scripts from [NexusMods](https://www.nexusmods.com/halflifealyx/mods/6) or [bhaptics-half-life-alyx](https://github.com/bhaptics/bhaptics-half-life-alyx) and merge the skill_manifest line yourself.

### Daemon Commands

```bash
# Start Alyx integration (auto-detect log path)
echo '{"cmd":"alyx_start"}' | nc localhost 5050

# Start with custom log path
echo '{"cmd":"alyx_start","log_path":"/path/to/console.log"}' | nc localhost 5050

# Stop integration
echo '{"cmd":"alyx_stop"}' | nc localhost 5050

# Check status
echo '{"cmd":"alyx_status"}' | nc localhost 5050

# Get mod info (download URLs, install instructions)
echo '{"cmd":"alyx_get_mod_info"}' | nc localhost 5050
```

## Overview

Unlike CS2 which has official Game State Integration (GSI), **Half-Life: Alyx has no official API** for external applications to receive game events. The only viable approach is to use **Lua scripts inside the game** that output events to a console log file, which an external application then monitors.

This is the same approach used by bHaptics and OWO integrations.

## Architecture Comparison

| Aspect               | CS2 GSI                | Half-Life: Alyx                           |
| -------------------- | ---------------------- | ----------------------------------------- |
| **Official API**     | ✅ Yes (HTTP POST)     | ❌ None                                   |
| **Mod Required**     | No                     | **Yes** (Lua scripts)                     |
| **Data Format**      | JSON                   | Custom delimited text                     |
| **Communication**    | HTTP push (real-time)  | File polling                              |
| **Setup Complexity** | Low (config file only) | Higher (scripts + config + launch option) |

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    Half-Life: Alyx                              │
│  ┌────────────────────────────────────────────────────────┐    │
│  │  Lua Scripts (tactsuit.lua)                             │    │
│  │  - Hooks into game events via ListenToGameEvent()       │    │
│  │  - Writes formatted lines to console                    │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ writes [Tactsuit] {...}
┌─────────────────────────────────────────────────────────────────┐
│  console.log (Half-Life Alyx/game/hlvr/console.log)             │
│  Created when game launched with -condebug                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ tails/watches file
┌─────────────────────────────────────────────────────────────────┐
│       Python Integration (integrations/alyx/)                   │
│  • File watcher (polling or watchdog)                          │
│  • Line parser for [Tactsuit] {EventType|params} format        │
│  • Event-to-haptic mapper                                       │
│  • TCP connection to vest daemon                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ TCP commands
┌─────────────────────────────────────────────────────────────────┐
│                    Vest Daemon (port 5050)                      │
│                    └── Third Space Vest                         │
└─────────────────────────────────────────────────────────────────┘
```

## Console Log Event Format

The Lua scripts write events to the console in this format:

```
[Tactsuit] {EventType|param1|param2|...}
```

### Key Events

| Event                      | Format                                                             | Description                    |
| -------------------------- | ------------------------------------------------------------------ | ------------------------------ |
| `PlayerHurt`               | `{PlayerHurt\|health\|enemy_class\|angle\|enemy_name\|debug_name}` | Player took damage             |
| `PlayerShootWeapon`        | `{PlayerShootWeapon\|weapon_class}`                                | Player fired weapon            |
| `PlayerDeath`              | `{PlayerDeath\|damagebits}`                                        | Player died                    |
| `PlayerHealth`             | `{PlayerHealth\|health}`                                           | Health changed (low health)    |
| `PlayerGrabbityPull`       | `{PlayerGrabbityPull\|is_primary_hand}`                            | Gravity glove pull             |
| `GrabbityGloveCatch`       | `{GrabbityGloveCatch\|is_primary_hand}`                            | Caught item with gravity glove |
| `PlayerGrabbedByBarnacle`  | `{PlayerGrabbedByBarnacle}`                                        | Grabbed by barnacle            |
| `PlayerReleasedByBarnacle` | `{PlayerReleasedByBarnacle}`                                       | Released by barnacle           |
| `PlayerHeal`               | `{PlayerHeal\|angle}`                                              | Used health pen                |
| `PlayerCoughStart`         | `{PlayerCoughStart}`                                               | Started coughing (poison gas)  |
| `PlayerCoughEnd`           | `{PlayerCoughEnd}`                                                 | Stopped coughing               |
| `TwoHandStart`             | `{TwoHandStart}`                                                   | Two-handed weapon grip         |
| `TwoHandEnd`               | `{TwoHandEnd}`                                                     | Released two-handed grip       |
| `Reset`                    | `{Reset}`                                                          | Player spawned/respawned       |

### Damage Angle

The `PlayerHurt` event includes a directional angle (0-360°) indicating where the damage came from relative to the player's facing direction:

- 0° = Front
- 90° = Left
- 180° = Back
- 270° = Right

This enables directional haptic feedback on the vest.

### Damage Types (damagebits)

The `PlayerDeath` event includes damage bits that can be decoded to determine the type of death:

- `2` = Bullet
- `8` = Burn
- `64` = Blast
- `256` = Shock
- `1024` = Energy beam
- `131072` = Poison
- `262144` = Radiation
- And more...

## Existing Resources

The bHaptics/OWO mods provide complete, battle-tested implementations:

### Lua Scripts (Game-Side)

**Location**: `misc-documentations/bhaptics-svg-24-nov/alyx-mod/HalLifeAlyx_OWO-2.0.4/`

| File                                              | Purpose                           |
| ------------------------------------------------- | --------------------------------- |
| `scripts/game/hlvr/scripts/vscripts/tactsuit.lua` | Main event listener (~1200 lines) |
| `scripts/game/hlvr/cfg/skill_manifest.cfg`        | Game config to load the script    |

The `tactsuit.lua` script hooks into **50+ game events** including:

- Player damage, death, health changes
- All weapon fire events
- Gravity glove interactions (lock, pull, catch)
- VR-specific events (two-hand grip, item holder, backpack)
- Environmental effects (coughing, barnacle grabs)

### C# Application Logic (Reference)

| File                  | Purpose                                |
| --------------------- | -------------------------------------- |
| `Engine.cs`           | Event processing, state management     |
| `TactsuitVR.cs`       | Enemy type recognition, effect mapping |
| `OWOSensations/*.owo` | 80+ haptic sensation patterns          |

## Recommended Strategy

### What to Reuse

1. **✅ Lua Scripts** - Use the existing `tactsuit.lua` (credit the original author)

   - Proven, comprehensive game event detection
   - Community-tested over years
   - No need to reverse-engineer VScript API

2. **✅ Event Mapping Logic** - Adapt from `Engine.cs` and `TactsuitVR.cs`
   - Enemy type → effect type mapping
   - Directional damage calculations
   - Damage type classification

### What to Build

1. **Console Log Watcher** - Python file watcher
2. **Event Parser** - Parse `{EventType|params}` format
3. **Haptic Mapper** - Map events to our 8-cell vest
4. **Daemon Integration** - Connect to vest daemon (similar to CS2)

## Implementation Plan

### Phase 1: Console Log Watcher

Create `integrations/alyx/log_watcher.py`:

- Use file polling or `watchdog` library
- Tail `console.log` for new lines
- Filter for `[Tactsuit]` prefix

```python
# Pseudo-code
async def watch_console_log(log_path: Path, callback):
    """Watch console.log for new [Tactsuit] events."""
    last_pos = 0
    while True:
        with open(log_path) as f:
            f.seek(last_pos)
            for line in f:
                if "[Tactsuit]" in line:
                    event = parse_tactsuit_event(line)
                    await callback(event)
            last_pos = f.tell()
        await asyncio.sleep(0.05)  # 50ms poll interval
```

### Phase 2: Event Parser

Create `integrations/alyx/event_parser.py`:

- Parse `{EventType|param1|param2}` format
- Return structured event objects

```python
@dataclass
class AlyxEvent:
    type: str
    params: dict

def parse_tactsuit_event(line: str) -> AlyxEvent:
    """Parse [Tactsuit] {EventType|params} line."""
    match = re.search(r'\[Tactsuit\] \{([^}]+)\}', line)
    if not match:
        return None
    parts = match.group(1).split('|')
    event_type = parts[0]
    # Map params based on event type
    ...
```

### Phase 3: Haptic Mapper

Create `integrations/alyx/haptic_mapper.py`:

- Map events to vest cell activations
- Handle directional damage (angle → cell)
- Define effect intensities and durations

```python
def angle_to_cells(angle: float) -> List[int]:
    """Convert damage angle to vest cells."""
    # Front: 0-45, 315-360 → cells 0, 1
    # Left: 45-135 → cells 0, 2
    # Back: 135-225 → cells 2, 3, 6, 7
    # Right: 225-315 → cells 1, 3
    ...

def map_event_to_haptic(event: AlyxEvent) -> Optional[HapticCommand]:
    """Map Alyx event to vest command."""
    if event.type == "PlayerHurt":
        angle = float(event.params.get("angle", 0))
        cells = angle_to_cells(angle)
        return HapticCommand(cells=cells, speed=5)
    ...
```

### Phase 4: Daemon Integration

Two options:

**Option A: Embedded in Daemon** (like CS2)

- Add `alyx_start`, `alyx_stop`, `alyx_status` commands
- Embed log watcher in daemon process
- Broadcast `alyx_game_event` events

**Option B: Separate Process**

- Run as standalone script
- Connect to daemon as TCP client
- Simpler architecture, less coupling

### Phase 5: UI Integration

Add to Electron UI:

- HL:A panel with start/stop controls
- Console.log path configuration
- Auto-detect game installation
- Live event display
- Script installation helper

## User Setup Requirements

1. **Install Lua Scripts**

   ```
   Steam/steamapps/common/Half-Life Alyx/game/hlvr/scripts/vscripts/tactsuit.lua
   ```

2. **Modify Game Config**
   Add to `Steam/steamapps/common/Half-Life Alyx/game/hlvr/cfg/skill_manifest.cfg`:

   ```
   script_reload_code tactsuit.lua
   ```

3. **Enable Console Logging**
   Add `-condebug` to Steam launch options for Half-Life: Alyx

4. **Run Integration**
   Start the HL:A integration from daemon or UI before launching game

## Event-to-Haptic Mapping

### Priority Events (Phase 1)

| Event                | Vest Effect                               |
| -------------------- | ----------------------------------------- |
| `PlayerHurt`         | Directional pulse on cells based on angle |
| `PlayerShootWeapon`  | Light pulse on front cells (recoil)       |
| `PlayerDeath`        | Strong full-vest effect                   |
| `PlayerHealth` (low) | Heartbeat pattern                         |

### VR Interactions (Phase 2)

| Event                     | Vest Effect              |
| ------------------------- | ------------------------ |
| `PlayerGrabbityPull`      | Light front pulse        |
| `GrabbityGloveCatch`      | Short front pulse        |
| `PlayerGrabbedByBarnacle` | Repeating pull-up effect |
| `PlayerHeal`              | Soothing wave effect     |

### Advanced Effects (Phase 3)

| Event                  | Vest Effect              |
| ---------------------- | ------------------------ |
| `PlayerCoughStart/End` | Subtle chest pulses      |
| `TwoHandStart/End`     | Subtle shoulder feedback |
| Backpack interactions  | Shoulder tap effects     |

## Technical Notes

### Console Log Location

```
Steam/steamapps/common/Half-Life Alyx/game/hlvr/console.log
```

On Windows typically:

```
C:\Program Files (x86)\Steam\steamapps\common\Half-Life Alyx\game\hlvr\console.log
```

### File Watching Considerations

1. **Polling vs Events**: File events (inotify/FSEvents) may not work reliably for game log files. Polling at 50ms is recommended.

2. **File Locking**: The game may lock the file. Use read-only mode and handle IOErrors gracefully.

3. **Log Rotation**: The game may clear/rotate the log. Handle file truncation and reset position.

4. **Encoding**: Console.log uses UTF-8 encoding.

## Attribution

The Lua scripts and event detection logic are based on work by:

- **floh-bhaptics** - [bHaptics Tactsuit Integration for Half-Life Alyx](https://www.nexusmods.com/halflifealyx/mods/6)
- **OWO Game** - [OWO Alyx Integration](https://github.com/floh-bhaptics/HalLifeAlyx_OWO)

These projects are credited and their approach adapted for the Third Space Vest.

## References

- [NexusMods - bHaptics Tactsuit for HL:A](https://www.nexusmods.com/halflifealyx/mods/6)
- [GitHub - HalLifeAlyx_OWO](https://github.com/floh-bhaptics/HalLifeAlyx_OWO)
- [Valve VScript API Documentation](https://developer.valvesoftware.com/wiki/Dota_2_Workshop_Tools/Scripting)

## Implementation Details

### Files Created

| File | Description |
|------|-------------|
| `server/alyx_manager.py` | Console log watcher, event parser, haptic mapper, and daemon integration |
| `web/src/components/AlyxIntegrationPanel.tsx` | React UI component |
| `web/src/hooks/useAlyxIntegration.ts` | React hook for state management |
| `web/electron/ipc/alyxHandlers.cjs` | Electron IPC handlers |

### Daemon Commands & Events

**Commands:**
- `alyx_start` - Start watching console.log (optional `log_path` param)
- `alyx_stop` - Stop watching
- `alyx_status` - Get running state, events received, last event time
- `alyx_get_mod_info` - Get mod download URLs and install instructions

**Events (broadcast to all clients):**
- `alyx_started` - Integration started (includes log_path)
- `alyx_stopped` - Integration stopped
- `alyx_game_event` - Game event detected (includes event_type and params)

## Status

**Current**: ✅ **IMPLEMENTED**
- Phase 1: Console Log Watcher ✅
- Phase 2: Event Parser ✅
- Phase 3: Haptic Mapper ✅
- Phase 4: Daemon Integration ✅
- Phase 5: UI Integration ✅

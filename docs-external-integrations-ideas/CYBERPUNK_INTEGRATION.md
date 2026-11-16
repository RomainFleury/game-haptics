# Cyberpunk 2077 Integration

> **Status: BETA** (daemon + UI + RED4ext/redscript companion; build the DLL before play)

Vest hit feedback and gunfire recoil for Cyberpunk 2077 via a **RED4ext** plugin
that TCP-forwards events to the TSC daemon (port 5050). Daemon/UI shape
matches Gunman Contracts; the game side cannot use MelonLoader (REDengine 4).

## Prior art (do not fork)

- [OWO Skin – Cyberpunk 2077](https://www.nexusmods.com/cyberpunk2077/mods/31204) (GingasVR)
  uses RED4ext + redscript for directional damage and per-weapon-class recoil.
  Nexus permissions **disallow modifying that archive without permission** — we
  write original hooks/plugin and credit the idea only.
- Event surface ideas also mirror the older bHaptics CP2077 layer (Nexus page often hidden).
- Hook patterns: [redmodding wiki](https://wiki.redmodding.org/) (`ShootEvents.OnEnter`, player `OnHit`).

## Pieces

| Piece | Location |
| --- | --- |
| Daemon mapping | `modern_third_space/server/cyberpunk_manager.py` |
| Protocol | `cyberpunk_start` / `stop` / `status` / `event` |
| RED4ext plugin + redscript | `cyberpunk-mod/` (`TSC_Cyberpunk.dll`) |
| Packaged copy | `mods/cyberpunk/` |
| Electron page | Games → Cyberpunk 2077 |

## Architecture

```
Cyberpunk 2077 (REDengine 4)
  redscript hooks (ShootEvents / PlayerPuppet.OnHit)
    → TSC_* natives (RED4ext DLL)
      → TCP 5050 → Python daemon → vest / USB solenoid
```

## Event mapping (MVP)

| Event | Vest | Solenoid |
| --- | --- | --- |
| `gun_fire` | Arms (hand) | pistol pulse |
| `smg_fire` | Arms | pistol pulse |
| `rifle_fire` | Arms, speed 6 | rifle pulse |
| `sniper_fire` | Arms, speed 7 | rifle pulse |
| `shotgun_fire` | Full side | shotgun pulse |
| `player_hit` | Directional from `angle` | none |

`angle`: 0 front, 90 left, 180 back, 270 right. `intensity` 0..1 scales hit speed.

Newline JSON:

```json
{"cmd":"cyberpunk_start","solenoid_recoil":{"enabled":true,"duration_ms":40}}
{"cmd":"cyberpunk_event","event":"gun_fire","weapon":"pistol","hand":"right"}
{"cmd":"cyberpunk_event","event":"player_hit","angle":90.0,"intensity":0.8}
{"cmd":"cyberpunk_stop"}
```

## Setup

1. Install [RED4ext](https://www.nexusmods.com/cyberpunk2077/mods/2380) and
   [redscript](https://www.nexusmods.com/cyberpunk2077/mods/1511) into the game folder.
   **Install Mod alone is not enough** — without the RED4ext loader (`bin/x64/winmm.dll`
   or `red4ext/RED4ext.dll`) and redscript (`engine/tools/scc.exe`), the plugin never loads
   and no TCP events appear.
2. Build the plugin (developers only; releases ship the DLL under `mods/cyberpunk/`):

```powershell
cd cyberpunk-mod
.\build.ps1
```

3. In the app: Browse → Cyberpunk 2077 folder → **Install Mod** (copies
   `red4ext/plugins/TSC_Cyberpunk/` + `r6/scripts/TSC Haptics/`).
4. Start the daemon, click **Start** on the Cyberpunk page, then launch the game.
   Optional: enable **Skip REDlauncher** (`--launcher-skip`). That skips REDlauncher only;
   **My Rewards** and **cross-platform saves** need REDlauncher (leave the option off).

Optional remote daemon: `red4ext/plugins/TSC_Cyberpunk/TSC_Config.txt`
with `IP` or `IP:PORT`.

Do **not** run the OWO Skin / bHaptics CP2077 haptic mods at the same time if they
also wrap the same combat hooks.

## Non-goals (v1)

- Vehicles, status DoTs, Kerenzikov, melee suite
- Screen-health vignette fallback
- MelonLoader
- Redistributing OWO Nexus files

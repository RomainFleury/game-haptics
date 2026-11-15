# TSC Cyberpunk 2077

RED4ext plugin + redscript hooks that forward Cyberpunk 2077 combat events to the
TSC vest daemon on `127.0.0.1:5050`.

**MVP events:** directional `player_hit`, weapon-class gunfire (`gun_fire`,
`smg_fire`, `rifle_fire`, `shotgun_fire`, `sniper_fire`) with solenoid recoil.

This is original TSC code. It is **not** a fork of the OWO Nexus mod
(GingasVR) — that archive disallows modification without permission. Event ideas
mirror the public OWO/bHaptics CP2077 surface; hooks follow
[redmodding](https://wiki.redmodding.org/) patterns (`ShootEvents.OnEnter`,
player `OnHit`).

## Requirements

- Cyberpunk 2077 (tested against patch **2.5+** tooling; pin RED4ext to your game build)
- [RED4ext](https://www.nexusmods.com/cyberpunk2077/mods/2380) (loader)
- [redscript](https://www.nexusmods.com/cyberpunk2077/mods/1511)
- Visual Studio 2022 (C++ desktop) + [RED4ext.SDK](https://github.com/WopsS/RED4ext.SDK) to build the DLL
- TSC vest daemon running (`python -m modern_third_space.cli daemon start`)

Do **not** install the OWO Skin / bHaptics CP2077 mods alongside this if they
also hook the same combat paths — pick one haptic stack.

## Layout after install

```
Cyberpunk 2077\
├─ red4ext\plugins\TSC_Cyberpunk\
│  └─ TSC_Cyberpunk.dll
└─ r6\scripts\TSC\
   ├─ Natives.reds
   ├─ FireHooks.reds
   └─ HitHooks.reds
```

Optional daemon host override: create
`red4ext/plugins/TSC_Cyberpunk/TSC_Config.txt` with `IP` or
`IP:PORT` (default `127.0.0.1:5050`).

## Build

1. Clone RED4ext.SDK next to this folder (or set `RED4EXT_SDK`):

```powershell
cd cyberpunk-mod
git clone https://github.com/WopsS/RED4ext.SDK.git deps\RED4ext.SDK
.\build.ps1
```

2. Output:

- `bin\x64\Release\TSC_Cyberpunk.dll`
- Copied into `package\red4ext\plugins\TSC_Cyberpunk\`
- Packaged under `..\mods\cyberpunk\` for Electron Install Mod

## Install

**Users / Install Mod:** the app copies the **prebuilt** tree from
`mods/cyberpunk/` into the game folder. It does **not** compile. Releases and
tags must include `mods/cyberpunk/red4ext/plugins/TSC_Cyberpunk/TSC_Cyberpunk.dll`
(git tracks `mods/**/*.dll`).

1. Install RED4ext + redscript into the game folder.
2. In the app: Browse → Install Mod (or copy `mods/cyberpunk/red4ext` + `r6` into the game root).
3. Start the daemon, open **Games → Cyberpunk 2077**, click **Start**.
4. Launch the game.

**Developers:** run `.\build.ps1` after SDK/API changes, then commit the refreshed
DLL under `mods/cyberpunk/` before tagging.

## Protocol

Newline JSON on port 5050:

```json
{"cmd":"cyberpunk_event","event":"gun_fire","weapon":"pistol","hand":"right"}
{"cmd":"cyberpunk_event","event":"player_hit","angle":90.0,"intensity":0.8}
```

Arm the integration with `cyberpunk_start` from the UI before expecting haptics.

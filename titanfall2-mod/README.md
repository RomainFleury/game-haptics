# ThirdSpace Titanfall 2

Northstar plugin that forwards Titanfall 2 campaign haptic events to the Third Space
daemon on `127.0.0.1:5050`. Event detection is adapted from Florian's
[Titanfall2VR_bhaptics](https://github.com/floh-bhaptics/Titanfall2VR_bhaptics).

**One build works for both:**

- **VR** — CircuitLord Titanfall 2 VR (`TF2VR` profile)
- **Flat** — Northstar (`R2Northstar` profile)

The app’s **Install Mod** copies the same DLL + mod into every Northstar profile it finds under the Titanfall 2 folder.

## Requirements

- Titanfall 2
- For VR: [CircuitLord's installer](https://github.com/CircuitLord/CircuitLordVRModInstaller) (creates `TF2VR`)
- For flat: [Northstar](https://northstar.tf/) (creates `R2Northstar`)
- Visual Studio 2022 with the C++ desktop workload (to build the DLL)
- Third Space vest daemon running

Stock Steam/EA launch without Northstar does **not** load this plugin.

## Build

```powershell
cd titanfall2-mod
msbuild ThirdSpace_Titanfall2.sln /p:Configuration=Release /p:Platform=x64
```

Output:

- `bin\x64\Release\ThirdSpace_Titanfall2.dll`
- `bin\x64\Release\ThirdSpace_Titanfall2.zip` (plugins + mods layout)

## Install

### From the app (recommended)

1. Build the DLL.
2. On the Titanfall 2 page: Browse → Titanfall 2 game folder → **Install Mod (all profiles)**.
3. Start the daemon, click **Start**, then launch VR or Northstar.

### Manual

Copy into each profile you use:

```
Titanfall2\
├─ TF2VR\                 (VR)
│  ├─ plugins\ThirdSpace_Titanfall2.dll
│  └─ mods\ThirdSpace_Titanfall2\
└─ R2Northstar\           (flat)
   ├─ plugins\ThirdSpace_Titanfall2.dll
   └─ mods\ThirdSpace_Titanfall2\
```

Log lines are prefixed `[THIRDSPACE]` in that profile’s `logs` folder.

## Handedness

In VR, recoil uses CircuitLord’s `TF2VR_WeaponHand` when present. On flat Northstar that API is absent, so recoil defaults to the right side. The script looks the function up by name so both profiles compile the same file.

## How it works

Squirrel scripts call `TS_Play` / `TS_PlayParam`. The DLL queues newline JSON:

```json
{"cmd":"titanfall2_event","event":"recoil_pistol_r"}
{"cmd":"titanfall2_event","event":"impact","intensity":1.000,"angle":90.0}
```

See `docs-external-integrations-ideas/TITANFALL2_INTEGRATION.md`.

## Credits

Gameplay hooks and event names follow Florian's Titanfall2VR_bhaptics mod.
Titanfall 2 VR is CircuitLord's. Northstar is R2Northstar.

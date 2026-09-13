# Gunman Contracts Standalone Mod

MelonLoader mod that sends haptic events to the Third Space Vest daemon over TCP 5050.

**Status:** BETA — Harmony patches are adapted from [GunmanContracts_bhaptics](https://github.com/floh-bhaptics/GunmanContracts_bhaptics) and have not been verified in-game yet.

## What to install

Install **`ThirdSpace_GunmanContracts.dll`** into the game `Mods/` folder.

The DLL may not exist in this folder until you build from `gunmancontracts-mod/` (or use **Install Mod** in the Electron UI, which builds if needed).

Do **not** install `GunmanContracts_bhaptics.dll`. That file talks to bHaptics Player, not this daemon.

## Building

Needs MelonLoader 0.6+ already installed in Gunman Contracts Standalone (uses `MelonLoader/net6/*.dll`) and a .NET 6 or 8 SDK.

```powershell
cd gunmancontracts-mod
./build.ps1 -GameDir "F:\SteamLibrary\steamapps\common\Gunman Contracts"
```

That writes `ThirdSpace_GunmanContracts.dll` into this folder.

## Installation

1. Install [MelonLoader 0.6.x or 0.7.x](https://github.com/LavaGang/MelonLoader/releases) into Gunman Contracts Standalone
2. Launch the game once so MelonLoader creates `Mods/`
3. In this app, select the game folder and click **Install Mod**
4. Start the Third Space Vest daemon (TCP 5050)
5. Open Gunman Contracts in this app, click **Start**, then launch the game

Optional remote daemon: create `Mods/ThirdSpace_Config.txt` with `IP` or `IP:PORT`.

## Credits

- Vest hooks: [GunmanContracts_bhaptics](https://github.com/floh-bhaptics/GunmanContracts_bhaptics)
- Recoil inspiration: [GunmanContracts_Provolver](https://github.com/Astienth/GunmanContracts_Provolver)

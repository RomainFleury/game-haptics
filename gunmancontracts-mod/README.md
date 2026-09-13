# Third Space Vest - Gunman Contracts Standalone Mod

MelonLoader mod that sends haptic events to the Third Space Vest daemon (TCP 5050).

Harmony patches are adapted from [GunmanContracts_bhaptics](https://github.com/floh-bhaptics/GunmanContracts_bhaptics).
Fire/recoil event choice is inspired by [GunmanContracts_Provolver](https://github.com/Astienth/GunmanContracts_Provolver) (no public source — we use bHaptics `OnFire`).

Do **not** install `GunmanContracts_bhaptics.dll` for this vest — that talks to bHaptics Player.

## Prerequisites

1. Gunman Contracts Standalone (Steam App ID 2421750)
2. MelonLoader 0.6.x+
3. Third Space Vest daemon on port 5050

## Build

Needs a .NET 6 or 8 SDK. If MelonLoader is installed in the game, pass that folder:

```powershell
./build.ps1 -GameDir "C:\path\to\Gunman Contracts"
```

Game folder candidates: `Gunman Contracts`, `GunmanContracts`.

Copy `..\mods\gunmancontracts\ThirdSpace_GunmanContracts.dll` into the game `Mods/` folder after MelonLoader is installed, or use **Install Mod** in the Electron UI.

## Events

| Event | Notes |
|-------|-------|
| `gun_fire` / `shotgun_fire` / `rifle_fire` | From `ANBHVRGunBase.OnFire` |
| `bow_fire` | From `HVRPhysicsBow.ShootArrow` |
| `player_hit` | From `ANBGameLogic.HurtPlayer` (optional angle) |
| `holster_in` / `holster_out` | Hip or shoulder via `holster` param |
| `heartbeat` | Once on Melon init |

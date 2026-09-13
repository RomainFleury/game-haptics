# Gunman Contracts Standalone Integration

> **Status: BETA** (MelonLoader mod untested in-game)
>
> Harmony patches are adapted from [GunmanContracts_bhaptics](https://github.com/floh-bhaptics/GunmanContracts_bhaptics).
> Solenoid / Provolver-style fire recoil is inspired by [GunmanContracts_Provolver](https://github.com/Astienth/GunmanContracts_Provolver) (fire + dual wield; no public source — we use bHaptics `OnFire` for fire events).
> The game connects to the daemon as a TCP client on port 5050.

## Overview

Gunman Contracts Standalone is a VR shooter by ANB_Seth (Steam App ID **2421750**). The open-source bHaptics mod hooks:

| Class | Method | Our event |
|-------|--------|-----------|
| `ANBHVRGunBase` | `OnFire()` | `gun_fire` / `shotgun_fire` / `rifle_fire` (skip `EnemyGun` / `isBow`) |
| `HVRPhysicsBow` | `ShootArrow()` | `bow_fire` |
| `ANBGameLogic` | `HurtPlayer()` | `player_hit` (directional angle) |
| `ANBGameLogic` | `holsterGun()` / `unholsterGun()` | `holster_in` / `holster_out` |
| Melon init | `OnInitializeMelon` | `heartbeat` (once) |

`MelonGame`: `"ANB_Seth"`, `"GunmanContracts"`.

Do **not** install `GunmanContracts_bhaptics.dll` for this vest — that talks to bHaptics Player. Install `ThirdSpace_GunmanContracts.dll` instead.

Canonical game-haptics work lives under RomainFleury/game-haptics patterns in this repo; do not add qdot upstream refs.

## Architecture

```
Gunman Contracts Standalone (Unity/Il2Cpp)
  MelonLoader → ThirdSpace_GunmanContracts.dll
       TCP 5050 → Python daemon → vest / USB solenoid
```

## Event mapping (8-cell vest)

| Event | Priority | Cells | Notes |
|-------|----------|-------|-------|
| `gun_fire` | 2 | Left or right arm | Pistol/default; solenoid pulse (`pistol`) |
| `shotgun_fire` | 2 | Full left or right side | `isShotgun`; solenoid (`shotgun`) |
| `rifle_fire` | 2 | Arm cells, speed 6 | `FireType.Automatic`; solenoid (`rifle`) |
| `bow_fire` | 2 | Arm for hand | From `HVRPhysicsBow.ShootArrow` |
| `player_hit` | 3 | Front / left / back / right from angle | 0° front, 90° left; omit angle if unknown |
| `holster_in` | 1 | Lower front (hip) or upper back (shoulder) | Optional `holster`: `hip` \| `shoulder` |
| `holster_out` | 1 | Same as holster_in | Side string `right`/`backRight` → right hand |
| `heartbeat` | 0 | Both front lower, speed 2 | Sent once on mod init |

## Solenoid recoil note

USB-relay pulses fire on `gun_fire`, `shotgun_fire`, and `rifle_fire` when solenoid recoil is enabled in the UI. Duration uses `duration_ms_for_weapon` with keys `pistol` / `shotgun` / `rifle`. Dual-wield is supported by the game (two hands grabbing) but each `OnFire` still reports one primary hand for vest mapping — same approach as the Provolver-oriented fire hooks without requiring that closed-source project.

## Setup

1. Install MelonLoader 0.6.x+ into Gunman Contracts Standalone and launch once.
2. Build `gunmancontracts-mod/` and copy `ThirdSpace_GunmanContracts.dll` to `Mods/` (or use Install Mod in the app).
3. Start the daemon, click **Start** on the Gunman Contracts page, then launch the game.

Optional remote daemon: create `Mods/ThirdSpace_Config.txt` with `IP` or `IP:PORT`.

# Titanfall 2 VR Integration

> **Status: BETA** (daemon + Northstar TCP forwarder; build the DLL before play)

Vest and gun haptics for Titanfall 2 campaign — **one plugin for CircuitLord VR (`TF2VR`) and flat Northstar (`R2Northstar`)**. Event detection follows Florian's [Titanfall2VR_bhaptics](https://github.com/floh-bhaptics/Titanfall2VR_bhaptics). Our forwarder sends those events to the Third Space daemon instead of (or in addition to) bHaptics / ProTube.

Stock Steam/EA without Northstar does not load the plugin.

## Pieces

| Piece | Location |
| --- | --- |
| Daemon mapping | `modern_third_space/server/titanfall2_manager.py` |
| Protocol | `titanfall2_start` / `stop` / `status` / `event` |
| Northstar plugin | `titanfall2-mod/` (`ThirdSpace_Titanfall2.dll`) |
| Squirrel hooks | Adapted from Florian (`tf2vr_ts_client.nut`, `tf2vr_ts_server.nut`) |
| Electron page | Games → Titanfall 2 |

## Install

1. Profiles (either or both):
   - VR: [CircuitLord's installer](https://github.com/CircuitLord/CircuitLordVRModInstaller) → `TF2VR`
   - Flat: [Northstar](https://northstar.tf/) → `R2Northstar`
2. Build the plugin:

```powershell
cd titanfall2-mod
msbuild ThirdSpace_Titanfall2.sln /p:Configuration=Release /p:Platform=x64
```

3. In the app: Browse to the **Titanfall 2** folder → **Install Mod (all profiles)**. That copies the same DLL + mod into every Northstar profile found (`TF2VR`, `R2Northstar`, …).
4. Start the daemon, click **Start**, then launch VR or Northstar.

Can sit next to Florian's bHaptics/ProTube plugin in `TF2VR`; dependency name is `TF2VR_THIRDSPACE`, not `TF2VR_BHAPTICS`.

Recoil handedness uses CircuitLord’s `TF2VR_WeaponHand` when present; on flat Northstar it defaults to the right side.

## Event protocol

Newline JSON on port 5050:

```json
{"cmd":"titanfall2_start","solenoid_recoil":{"enabled":true,"duration_ms":40}}
{"cmd":"titanfall2_event","event":"recoil_pistol_r"}
{"cmd":"titanfall2_event","event":"impact","intensity":1.0,"angle":90}
{"cmd":"titanfall2_event","event":"gun_fire","group":"full","hand":"left","weapon":"mp_weapon_mastiff"}
{"cmd":"titanfall2_stop"}
```

`angle`: 0 front, 90 left, 180 back, 270 right (Florian's convention). `intensity` is 0..1.

## Vest and gun mapping

| Event | Vest | Solenoid |
| --- | --- | --- |
| `recoil_pistol` | Weapon arm | Kick |
| `recoil_rifle` | Weapon arm | Shorter kick |
| `recoil_shotgun` / ProTube `full` | Weapon side | Heavy kick |
| `recoil_heavy` | Weapon side | Sniper-length kick |
| `recoil_titan` / rockets | Upper / all cells | Longer pulse |
| `charge` | Weapon arm | None |
| `impact`, `explosion`, `titanfall` | Directional | None |
| `player_killed`, `titan_destroyed` | All cells | None |
| Movement / embark / heartbeat / healing | Light torso | None |

Unknown hand on a pilot shot uses the right arm.

## Credits

Hooks and event names: Florian ([Titanfall2VR_bhaptics](https://github.com/floh-bhaptics/Titanfall2VR_bhaptics)). Titanfall 2 VR: CircuitLord.

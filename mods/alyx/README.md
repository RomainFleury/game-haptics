# Half-Life: Alyx — Tactsuit Lua scripts

Shipped for **Install Mod** in the app. Upstream Lua is from the public
[bhaptics/bhaptics-half-life-alyx](https://github.com/bhaptics/bhaptics-half-life-alyx)
repo (also distributed on [NexusMods](https://www.nexusmods.com/halflifealyx/mods/6)).
We only need the console event emitter (`tactsuit.lua`); we do **not** ship the
bHaptics/OWO Windows companion apps.

## Files

| File | Install target |
| --- | --- |
| `tactsuit.lua` | `Half-Life Alyx/game/hlvr/scripts/vscripts/tactsuit.lua` |

Install Mod also ensures `game/hlvr/cfg/skill_manifest.cfg` contains:

```
script_reload_code tactsuit.lua
```

## App flow

1. Browse to `game/hlvr/console.log` (created after a `-condebug` launch).
2. Click **Install Mod** — copies `tactsuit.lua` and patches `skill_manifest.cfg`.
3. Start the Alyx integration, then launch via Steam (`-condebug` is already on the button).

## Attribution

- Original scripts: ShizOf / bHaptics Tactsuit Alyx mod
- Related OWO port: [floh-bhaptics/HalLifeAlyx_OWO](https://github.com/floh-bhaptics/HalLifeAlyx_OWO)

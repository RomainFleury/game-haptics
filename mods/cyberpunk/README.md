# Cyberpunk 2077 — packaged TSC mod

Ship this folder with releases. **Install Mod** in the app only copies these
files into the Cyberpunk 2077 game root (it does not compile).

## Layout

```
mods/cyberpunk/
├─ red4ext/plugins/TSC_Cyberpunk/TSC_Cyberpunk.dll   ← versioned binary
└─ r6/scripts/TSC/
   ├─ Natives.reds
   ├─ FireHooks.reds
   └─ HitHooks.reds
```

Requirements in the game folder: RED4ext + redscript.

## Refreshing the DLL (developers)

```powershell
cd cyberpunk-mod
.\build.ps1
```

That rebuilds and copies into `mods/cyberpunk/`. Commit the updated DLL when
cutting a release/tag.

See [cyberpunk-mod/README.md](../../cyberpunk-mod/README.md) for protocol details.

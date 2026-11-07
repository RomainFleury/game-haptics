# Titanfall 2 Northstar plugin

Place / build artifacts here for **release packaging** and Electron **Install Mod**:

| Path | Role |
|------|------|
| `ThirdSpace_Titanfall2.dll` | Northstar / TF2VR plugin |
| `ThirdSpace_Titanfall2/` | Northstar mod (`mod.json` + vscripts) |

## Build

```powershell
cd titanfall2-mod
.\build.ps1
```

Requires Visual Studio 2022 (Desktop development with C++) or Build Tools.  
`build.ps1` writes the DLL and copies the Northstar mod package into this folder.

Release scripts (`windows/build-release.bat`, `web/scripts/build-release.mjs`) run that build automatically and refuse to package if these files are missing.

## Install (end user)

1. In the app, set the Titanfall 2 game folder (with `TF2VR` and/or `R2Northstar`).
2. Click **Install Mod** — copies plugin → `plugins\` and mod → `mods\ThirdSpace_Titanfall2\`.
3. Start the vest daemon, then **Start** Titanfall 2 integration.

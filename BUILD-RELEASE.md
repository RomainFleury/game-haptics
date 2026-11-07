# Building a Release

This document describes how to build a distributable Windows installer for Third Space Vest.

## Overview

The build process creates:
1. **vest-daemon.exe** - Standalone Python daemon (via PyInstaller)
2. **Third Space Vest Setup.exe** - Windows installer (via electron-builder)
3. **Third Space Vest-portable.zip** - Portable version (no install needed)

## Prerequisites

### Required Software

| Software | Version | Download |
|----------|---------|----------|
| Python | 3.11+ | [python.org](https://www.python.org/downloads/) |
| Node.js | 18+ (LTS) | [nodejs.org](https://nodejs.org/) |
| Git | Latest | [git-scm.com](https://git-scm.com/) |

### Python Packages

```bash
pip install pyinstaller libusb
```

### Node.js Setup

```bash
corepack enable  # Enables Yarn
```

### Windows Developer Mode (Recommended)

To avoid symbolic link permission errors during the build, enable Windows Developer Mode:

**Option 1: Via Settings (Recommended)**
1. Open Windows Settings (Win + I)
2. Go to **Privacy & Security** → **For developers**
3. Enable **"Developer Mode"**
4. Restart your terminal/PowerShell

**Option 2: Via Registry (Requires Admin)**
Run PowerShell as Administrator and execute:
```powershell
reg add "HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" /t REG_DWORD /f /v AllowDevelopmentWithoutDevLicense /d 1
```

**Why?** Electron-Builder needs to extract code signing tools that contain symbolic links. Without Developer Mode, you'll get "A required privilege is not held by the client" errors.

## Quick Build (Windows)

**First, ensure prerequisites are installed:**

```
windows/check-setup.bat
```

This checks Python, Node.js, and all dependencies. Fix any issues before building.

**Then, double-click to build:**

```
windows/build-release.bat
```

This script:
1. Installs all dependencies
2. Builds the Python daemon
3. Builds the React UI
4. Packages everything into an installer

Output: `web/release/<yyyy-MM-dd_HH-mm_xxxxxxxx>/` (new subfolder each run; avoids reusing locked `win-unpacked`).

## Manual Build Steps

### Step 1: Build Python Daemon

```bash
cd modern-third-space

# Install dependencies
pip install -e .
pip install pyinstaller libusb

# Build daemon executable
cd build
python build-daemon.py
```

Output: `modern-third-space/build/dist/vest-daemon.exe`

### Step 2: Build React App

```bash
cd web

# Install dependencies
yarn install

# Build for production
yarn build
```

Output: `web/dist/`

### Step 3: Package with Electron Builder

```bash
cd web

# Create installer
yarn build:electron
```

Output: `web/release/<yyyy-MM-dd_HH-mm_xxxxxxxx>/`

### Alternative: Build Directory Only (Faster)

For testing without creating an installer:

```bash
yarn build:electron:dir
```

Output: `web/release/<yyyy-MM-dd_HH-mm_xxxxxxxx>/win-unpacked/`

## Build Script Options

The `build-release.mjs` script supports options:

```bash
# Full build
node scripts/build-release.mjs

# Skip daemon (use existing)
node scripts/build-release.mjs --skip-daemon

# Skip renderer (use existing)
node scripts/build-release.mjs --skip-renderer

# Build unpacked directory only
node scripts/build-release.mjs --dir
```

## Output Files

After a successful build:

```
web/release/
├── Third Space Vest Setup 1.0.0.exe    # NSIS installer (~150 MB)
├── Third Space Vest-1.0.0-portable.zip # Portable version
└── win-unpacked/                        # Unpacked app directory
    ├── Third Space Vest.exe
    └── resources/
        ├── daemon/
        │   └── vest-daemon.exe          # Python daemon (PyInstaller)
        └── mods/
            └── l4d2/                     # Bundled game mods
                ├── coop.nut
                └── thirdspacevest_haptics.nut
```

### Bundled Game Mods

Game mods are bundled with the app in `resources/mods/`:

| Game | Files | Install Method |
|------|-------|----------------|
| Left 4 Dead 2 | `*.nut` VScripts | Click "Install Mod" in UI |
| Half-Life: Alyx | Link to NexusMods | External download |
| Pistol Whip / Battle Sister / Gunman | MelonLoader `*.dll` in `mods/<game>/` | **Install Mod** in UI (DLLs must exist under `mods/` at package time) |
| **Titanfall 2** | `ThirdSpace_Titanfall2.dll` + Northstar mod folder | Built by `titanfall2-mod/build.ps1` during release; **Install Mod** copies into TF2VR / R2Northstar |

**Release requirement:** `windows/build-release.bat` and `web/scripts/build-release.mjs` run `scripts/prepare-release-mods.ps1`, which **rebuilds and verifies** every bundled mod and **fails the release** if any artifact is missing:

| Artifact | Built by | Needs on build machine |
|----------|----------|------------------------|
| `mods/titanfall2/ThirdSpace_Titanfall2.dll` (+ Northstar mod folder) | `titanfall2-mod/build.ps1` | VS 2022 C++ Build Tools |
| `mods/pistolwhip/ThirdSpace_PistolWhip.dll` | `pistolwhip-mod/build.ps1` | .NET SDK + Pistol Whip with MelonLoader net6 |
| `mods/battlesister/ThirdSpace_BattleSister.dll` | `battlesister-mod/build.ps1` | .NET SDK + Battle Sister with MelonLoader net6 |
| `mods/gunmancontracts/ThirdSpace_GunmanContracts.dll` | `gunmancontracts-mod/build.ps1` | .NET SDK + Gunman Contracts with MelonLoader net6 |
| L4D2 `*.nut` sources | checked in-repo | present under misc-documentations path |

DLLs under `mods/` stay gitignored; they are produced at release time and copied into the installer by electron-builder.

Manual check:

```powershell
.\scripts\prepare-release-mods.ps1
```

## Distribution

### Installer Version

- Users run `Third Space Vest Setup 1.0.0.exe`
- Creates Start Menu shortcut
- Installs to `C:\Users\<user>\AppData\Local\Programs\Third Space Vest\`
- Can be uninstalled via Windows Settings

### Portable Version

- Users extract `Third Space Vest-1.0.0-portable.zip`
- Run `Third Space Vest.exe` directly
- No installation needed
- Good for USB drives or testing

## Troubleshooting

### "PyInstaller not found"

```bash
pip install pyinstaller
```

### "libusb DLL not found"

```bash
pip install libusb
```

### "Yarn not found"

```bash
corepack enable
# or
npm install -g yarn
```

### "Cannot create symbolic link: A required privilege is not held by the client"

This warning occurs when electron-builder tries to extract code signing tools. Solutions:

1. **Enable Windows Developer Mode** (Recommended - see Prerequisites above)
2. **Run PowerShell as Administrator** when building
3. **The build will still complete** - this is just a warning about code signing tools

Code signing is already disabled in the config, but electron-builder may still download the tools.

### "file source doesn't exist from=...\dist\daemon"

**Error:** `file source doesn't exist from=C:\...\web\dist\daemon`

**Solution:** The daemon must be copied to `dist/daemon/` before electron-builder runs. The `build-release.bat` script does this automatically. If building manually:

```bash
# Ensure daemon is built first
cd modern-third-space/build
python build-daemon.py

# Copy daemon to dist/daemon for bundling
cd ../../web
mkdir -p dist/daemon
copy ..\modern-third-space\build\dist\vest-daemon.exe dist\daemon\
```

The `prebuild:electron` script in `package.json` handles this automatically when using `yarn build:electron`.

### Anti-virus false positive

PyInstaller executables sometimes trigger false positives. Solutions:
1. Add exception to your anti-virus
2. Code-sign the executable (requires certificate)
3. Submit to anti-virus vendors for whitelisting

### Build fails on "extraResources" or "file source doesn't exist"

**Error:** `file source doesn't exist from=...\dist\daemon`

**Solution:** The daemon must be copied to `dist/daemon/` before electron-builder runs. The build script does this automatically, but if building manually:

```bash
# Ensure daemon is built first
cd modern-third-space/build
python build-daemon.py

# Copy daemon to dist/daemon for bundling
cd ../../web
mkdir -p dist/daemon
copy ..\modern-third-space\build\dist\vest-daemon.exe dist\daemon\
```

The `prebuild:electron` script in `package.json` handles this automatically when using `yarn build:electron`.

## CI/CD (Future)

For automated builds, create a GitHub Actions workflow:

```yaml
# .github/workflows/build.yml
name: Build Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          
      - name: Build
        run: |
          cd windows
          build-release.bat
          
      - uses: actions/upload-artifact@v4
        with:
          name: windows-release
          path: web/release
```

## Versioning

Update version in:
1. `web/package.json` - `version` field
2. `modern-third-space/pyproject.toml` - `version` field

The version in `package.json` is used for the installer filename.

## Code Signing (Optional)

For professional distribution without SmartScreen warnings:

1. Obtain a code signing certificate (~$100-400/year)
2. Add to `electron-builder.yml`:

```yaml
win:
  certificateFile: path/to/certificate.pfx
  certificatePassword: YOUR_PASSWORD
```

Or use environment variables:
```yaml
win:
  certificateSubjectName: "Your Company Name"
```

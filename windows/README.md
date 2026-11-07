# Windows Setup

Simple setup for running the Third Space Vest Debugger on Windows.

## Quick Start

### 1. Install Requirements

You need **Node.js** and **Python**:

| Software | How to Install |
|----------|----------------|
| **Node.js** | Download from [nodejs.org](https://nodejs.org/) (LTS version) |
| **Python** | Download from [python.org](https://www.python.org/downloads/) (3.14+) |

> **Important**: During Python installation, check "Add to PATH"

### 2. Check Setup & Install Dependencies

**Double-click** `check-setup.bat`

This will check all prerequisites, install missing packages, and help you configure Python.

### 3. Run the App

**Double-click** `start-all.bat`

This opens two windows:
- **Daemon window** - The Python backend (keep open)
- **App window** - The debugger UI

---

## Scripts

| Script | What it does |
|--------|--------------|
| `check-setup.bat` | Checks all prerequisites, installs packages, configures Python |
| `start-all.bat` | Starts daemon + app together (recommended) |
| `start-daemon.bat` | Starts just the Python daemon |
| `start-ui.bat` | Starts just the Electron app (daemon auto-starts if needed) |
| `build-release.bat` | Builds a distributable installer (see below) |

### Setup Scripts (in `setup/` folder)

These are called by `check-setup.bat` but can also be run individually:

| Script | What it does |
|--------|--------------|
| `setup/check-python.bat` | Checks Python, helps create `.env.bat` |
| `setup/check-node.bat` | Checks Node.js installation |
| `setup/check-yarn.bat` | Checks/installs Yarn 4.11.0 via Corepack |
| `setup/use-corepack-yarn.bat` | Internal: enable Corepack Yarn (called only by check-yarn) |
| `setup/require-corepack-yarn.bat` | Puts Yarn 4.11.0 on PATH; used by start/build scripts |
| `setup/check-python-packages.bat` | Installs `modern_third_space` package |
| `setup/check-libusb.bat` | Installs libusb for USB communication |
| `setup/check-bettercam.bat` | Installs bettercam for Screen Health |
| `setup/check-web-dependencies.bat` | Installs web/node_modules |

---

## Python Version Detection

All scripts automatically detect the best Python to use:

1. **TSV_PYTHON** environment variable (if set in `.env.bat`)
2. **py -3.14** via the Python Launcher (if available)
3. **python** or **python3** as fallback

To pin a specific Python version, create `windows\.env.bat`:

```batch
@echo off
set TSV_PYTHON=py -3.14
```

See `.env.bat.example` for more options, and [python-environment-handling.md](./python-environment-handling.md) for the full rationale.

---

## Building a Release

To create a standalone Windows installer that doesn't require Python or Node.js:

**Double-click** `build-release.bat`

This creates:
- `web/release/<yyyy-MM-dd_HH-mm_xxxxxxxx>/Third Space Vest Setup 1.0.0.exe` - Windows installer
- `web/release/<...>/Third Space Vest-1.0.0-portable.zip` - Portable version

See [BUILD-RELEASE.md](../BUILD-RELEASE.md) for detailed build instructions.

## Detailed Instructions

See [SETUP.md](./SETUP.md) for step-by-step instructions and troubleshooting.

---

## For Developers

The `advanced/` folder contains PowerShell scripts for development setups with nvm-windows:

- `setup-windows.ps1` - Full nvm-based setup
- `dev-windows.ps1` - Development with specific Node version
- `dev-env.ps1` - Environment helper

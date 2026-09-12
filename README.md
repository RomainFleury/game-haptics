# Project Structure

This repository is organized to keep the original `libthirdspacevest` sources intact while adding modern tooling and new documentation archives around them.

**Origin / rename:** We started from [`qdot/libthirdspacevest`](https://github.com/qdot/libthirdspacevest) (Third Space Vest). The project grew to cover custom haptic systems beyond that hardware, so the repository was renamed to **game-haptics**. This repo (**`RomainFleury/game-haptics`**) is the only project that matters: the original parent is archived, we do not use it as git `upstream`, and we will not open PRs or contribute back to it. Legacy Vest sources remain under `legacy-do-not-change/` and must stay untouched.

## TLDR - Quickstart

When starting a chat, just type:

`@.cursor/prompts/onboard.md`

Integrate a new game: 

```text
@.cursor/prompts/new-game-integration.md

I want to add haptic support for Superhot VR
```

### macOS / Linux

```bash
# 1. Install Python package
cd modern-third-space && pip install -e . && cd ..

# 2. Start the Python daemon (in background or separate terminal)
python3 -m modern_third_space.cli daemon start

# 3. Install Node dependencies and start Electron
cd web && yarn install && yarn dev
```

### Windows

1. Install [Node.js LTS](https://nodejs.org/) and [Python 3.14+](https://python.org/)
2. Double-click `windows/check-setup.bat` (checks prerequisites, installs packages)
3. Double-click `windows/start-all.bat`

See [`windows/SETUP.md`](./windows/SETUP.md) for detailed instructions.

---

That's it! The Electron window will open and connect to the daemon. If you see a "sorry-bro" device, install PyUSB: `pip install pyusb` (see `modern-third-space/README.md` for platform-specific notes).

**Verify setup:**

```bash
# Check Python bridge
cd web && yarn check:python

# Check daemon status
python3 -m modern_third_space.cli daemon status
```

### Daemon Commands

```bash
python3 -m modern_third_space.cli daemon start           # Start daemon on port 5050
python3 -m modern_third_space.cli daemon start --port 5051  # Custom port
python3 -m modern_third_space.cli daemon status          # Check if running + health info
python3 -m modern_third_space.cli daemon stop            # Stop the daemon
```

## For AI Assistants

If you're an AI assistant working on this repository, see [`AI_ONBOARDING.md`](./AI_ONBOARDING.md) for a complete onboarding guide.

### Quick Session Starter (Cursor IDE)

Paste this at the start of a new chat for instant context:

```
@.cursorrules @CHANGELOG.md

I'm continuing work on the Third Space Vest project. What would you like me to help with?
```

Or for full context:

```
@AI_ONBOARDING.md @CHANGELOG.md @modern-third-space/TESTING.md

I need help with [your task here].
```

### Key Files for AI Context

| File | Purpose |
|------|---------|
| `.cursorrules` | Auto-loaded project rules, architecture, patterns |
| `.cursorignore` | Excludes legacy code & noise from context |
| `CHANGELOG.md` | Recent changes and project evolution |
| `AI_ONBOARDING.md` | Full onboarding guide |
| `modern-third-space/TESTING.md` | Test examples with curl commands |


## Enough time to do the slow start and introduction and shit

- `legacy-do-not-change/` — verbatim copy of the historical driver/library. Treat as read-only and layer patches elsewhere.
- `modern-third-space/` — Python package that dynamically loads the legacy `thirdspace.py` driver and exposes a modern API plus CLI endpoints for other tooling (Electron debugger, scripts, etc.).
- `web/` — Electron + React + Tailwind workspace (plus Repomix tooling). All Node dependencies, UI code, and yarn-based workflows live here so they stay isolated from the legacy tree. **Run `yarn install` and all other `yarn` commands only from `web/`** (there is no `package.json` at the repository root).
- `misc-documentations/` — curated documentation, assets, and legacy SimHub/bHaptics references (e.g., Alyx mod README, SimHub plugin sources, illustrative images). Nothing here is built or shipped, but it provides design/reference material for future work.

When adding new functionality:

1. Leave `legacy-do-not-change/` unchanged.
2. Build/extend the Python bridge in `modern-third-space/` (install with `pip install -e .` if you need local changes).
3. Place all Node/Electron work under `web/`.
4. Keep documentation dumps, research notes, or third-party integration references under `misc-documentations/`.
5. Use bridging layers (scripts, adapters, etc.) outside the legacy directory if you need to interact with the original driver.

This setup lets us iterate on modern tooling while preserving the historical code for reference.

## Running the Debug Tool

The Electron debugger console allows you to monitor USB connectivity, trigger individual actuators, and inspect command logs.

### Prerequisites

- Node.js v24+ (v24.11.1 recommended — see `web/.nvmrc`)
- Yarn (enabled via `corepack enable`)
- Python 3.14+ (for the `modern-third-space` bridge)

### Windows Quick Setup

**For Windows users**, we provide simple double-click scripts in the `windows/` directory:

1. **Install requirements:**
   - [Node.js LTS](https://nodejs.org/) (click the green LTS button)
   - [Python 3.14+](https://python.org/) (check "Add to PATH" during install)

2. **Check setup & install:** Double-click `windows/check-setup.bat`
   - This checks all prerequisites, installs missing packages, and helps configure Python

3. **Run the app:** Double-click `windows/start-all.bat`

| Script | Purpose |
|--------|---------|
| `check-setup.bat` | Check prerequisites, install packages, configure Python |
| `start-all.bat` | Start daemon + app together |
| `start-daemon.bat` | Start just the Python daemon |
| `start-ui.bat` | Start just the Electron app (daemon auto-starts if needed) |

For detailed instructions and troubleshooting, see [`windows/SETUP.md`](./windows/SETUP.md).

### Setup Steps

**Important:** You must set up the Python package and daemon before starting the Electron app.

1. **Install the Python package:**

   ```bash
   cd modern-third-space
   pip install -e .
   ```

   This installs the `modern-third-space` CLI and its dependencies (including PyUSB).

2. **Verify the Python bridge works:**

   ```bash
   python3 -m modern_third_space.cli ping
   ```

   You should see: `{"status": "ok", "message": "Python bridge is reachable"}`

3. **Start the daemon:**

   ```bash
   python3 -m modern_third_space.cli daemon start
   ```

   You should see: `🦺 Starting vest daemon on 127.0.0.1:5050...`
   
   Keep this running in the background (or use a separate terminal).

4. **Optional: Test device listing:**

   ```bash
   python3 -m modern_third_space.cli list
   ```

   This will show connected USB vests (or a fake device with serial "sorry-bro" if PyUSB isn't installed).

5. **Navigate to the web workspace:**

   ```bash
   cd ../web
   ```

6. **Install Node.js dependencies:**

   ```bash
   corepack enable
   yarn install
   ```

7. **Start the development environment:**

   ```bash
   yarn dev
   ```

   This launches both the Vite dev server (renderer) and the Electron window in parallel.

8. **Or run components separately:**

   ```bash
   # Terminal 1: Start the daemon (if not already running)
   python3 -m modern_third_space.cli daemon start

   # Terminal 2: Start the renderer (React UI)
   cd web && yarn dev:renderer

   # Terminal 3: Start Electron (waits for renderer on port 5173)
   cd web && yarn dev:electron
   ```

The debugger UI will open in an Electron window. It connects to the daemon automatically.

**Note:** If you see errors about PyUSB not being available, see `modern-third-space/README.md` for platform-specific installation instructions.

### Debugging and Verification

After setting up the Python bridge, you can verify your environment is correctly configured:

**From the `web/` directory:**

```bash
yarn check:python
```

This script will:

- ✅ Test the `ping` command to verify the Python CLI is reachable
- ✅ Test the `list` command to check USB device enumeration
- ⚠️  Warn if PyUSB is not installed (shows fake device with serial "sorry-bro")
- 📋 Display connected USB vest devices if any are found

**Manual verification:**

You can also test the Python CLI directly:

```bash
# Test ping
python3 -m modern_third_space.cli ping

# List devices
python3 -m modern_third_space.cli list
```

For more details, see `web/README.md`.

## Building a Release

This section describes how to build a distributable Windows installer. For detailed instructions, see [`BUILD-RELEASE.md`](./BUILD-RELEASE.md).

### Prerequisites

- **Python 3.14+** with `pyinstaller` and `libusb` installed
- **Node.js 18+ (LTS)** with Yarn enabled (`corepack enable`)
- **Yarn** - Use `--ignore-engines` flag if you have yarn 1.22.19 (repomix requires 1.22.22+)

### Quick Build (Windows)

**Option 1: Automated script**

```bash
windows/build-release.bat
```

**Option 2: Manual step-by-step**

1. **Build the Python daemon:**

   ```bash
   cd modern-third-space/build
   python build-daemon.py
   ```

   This creates `modern-third-space/build/dist/vest-daemon.exe` (~8-9 MB)

2. **Install Node.js dependencies:**

   ```bash
   cd web
   yarn install --ignore-engines
   ```

   Note: Use `--ignore-engines` if you get yarn version errors (repomix is a dev tool only).

3. **Build the React app:**

   ```bash
   cd web
   yarn build
   ```

   This creates `web/dist/` with the production React build.

4. **Package with Electron-Builder:**

   ```bash
   cd web
   yarn build:electron
   ```

   This creates (under a **new** folder each run, e.g. `web/release/2026-03-25_15-36_a1b2c3d4/`):
   - `Third Space Vest Setup 1.0.0.exe` - NSIS installer
   - `Third Space Vest-1.0.0-portable.zip` - Portable version
   - `win-unpacked/` - Unpacked app directory

### Build Output

After a successful build, you'll find:

```
web/release/
└── <yyyy-MM-dd_HH-mm_xxxxxxxx>/        # example: 2026-03-25_15-36_a1b2c3d4
    ├── Third Space Vest Setup 1.0.0.exe
    ├── Third Space Vest-1.0.0-portable.zip
    └── win-unpacked/
        ├── Third Space Vest.exe
        └── resources/
            ├── daemon/
            │   └── vest-daemon.exe
            └── mods/
                └── l4d2/
```

### Troubleshooting

**"PyInstaller not found"**
```bash
pip install pyinstaller
```

**"Yarn version incompatible"**
```bash
yarn install --ignore-engines
```

**"react-router-dom not found"**
```bash
cd web
yarn install --ignore-engines
```

**Daemon not bundled in resources/**
- Verify `vest-daemon.exe` exists at `modern-third-space/build/dist/vest-daemon.exe`
- Check `web/electron-builder.yml` extraResources configuration
- Ensure the daemon is built before running `yarn build:electron`

For more detailed troubleshooting and build options, see [`BUILD-RELEASE.md`](./BUILD-RELEASE.md).

## Architecture: Python Daemon

The project uses a **long-running Python daemon** for vest control:

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Electron UI    │     │   Game Mod 1     │     │   Game Mod 2     │
│   (React)        │     │   (C# MelonLoader)│    │   (Python script)│
└────────┬─────────┘     └────────┬─────────┘     └────────┬─────────┘
         │                        │                        │
         │         TCP Socket (localhost:5050)             │
         └────────────────────────┼────────────────────────┘
                                  ▼
                    ┌──────────────────────────┐
                    │     Python Daemon        │
                    │     (server/)            │
                    │                          │
                    │  • Manages vest connection│
                    │  • Accepts N clients     │
                    │  • Broadcasts events     │
                    │  • Routes commands       │
                    └──────────────┬───────────┘
                                   │
                                   ▼
                    ┌──────────────────────────┐
                    │        vest/             │
                    │    (hardware control)    │
                    └──────────────────────────┘
```

**Benefits:**
- Single vest connection (no USB conflicts)
- Event broadcasting (UI sees game mod activity)
- Language agnostic (C#, Python, Node.js can connect)
- Persistent state (connection survives between UI interactions)

See [`docs-external-integrations-ideas/DAEMON_ARCHITECTURE.md`](./docs-external-integrations-ideas/DAEMON_ARCHITECTURE.md) for full protocol documentation.
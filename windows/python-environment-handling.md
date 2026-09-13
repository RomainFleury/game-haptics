## Python environment handling (Windows)

This project needs a **consistent Python version** across:
- build scripts (PyInstaller daemon build)
- validation scripts (libusb, rapidshot)
- dev scripts (start daemon / run with python)

The project now uses **BetterCam** for screen capture, which is compatible with Python 3.14+. Python 3.14 is the recommended version, with 3.11+ as a fallback for older systems.

### Recommended approach: `windows/.env.bat` + `TSV_PYTHON`

We use an optional, local file `windows/.env.bat` that sets environment variables for scripts.

- **File**: `windows/.env.bat` *(local, not committed)*
- **Variable**: `TSV_PYTHON`
  - Can be either:
    - `py -3.14` (recommended if you have the Windows Python Launcher), or
    - an absolute path to `python.exe` (e.g. `C:\Python311\python.exe`), or
    - a venv python path (e.g. `modern-third-space\.venv\Scripts\python.exe`)

Example `windows/.env.bat`:

```bat
@echo off
REM Local overrides (not committed)
set "TSV_PYTHON=py -3.14"
REM or:
REM set "TSV_PYTHON=C:\Python311\python.exe"
REM set "TSV_PYTHON=%~dp0..\modern-third-space\.venv\Scripts\python.exe"
```

### How scripts use it

Windows scripts now do this near the top:

1. If `windows/.env.bat` exists, `call` it (so variables apply to the current process).
2. If `TSV_PYTHON` is defined, use it as the Python command for the script.
3. Otherwise, fall back to:
   - `py -3.14` if available, else
   - `python` / `python3` on `PATH`.

### Files updated to support `TSV_PYTHON`

These scripts load `windows/.env.bat` and prefer `TSV_PYTHON`:

**Main scripts:**
- `windows/check-setup.bat` (orchestrates all setup checks)
- `windows/build-release.bat`
- `windows/start-daemon.bat`
- `windows/start-all.bat`
- `windows/start-ui.bat`

**Individual setup scripts (in `windows/setup/`):**
- `setup/check-python.bat` (also helps create `.env.bat`)
- `setup/check-python-packages.bat`
- `setup/check-libusb.bat`
- `setup/check-rapidshot.bat`

**JavaScript code:**
- `web/electron/daemonBridge.cjs` - reads `TSV_PYTHON` environment variable
- `web/scripts/runPythonCommand.mjs` - reads `TSV_PYTHON` environment variable

### Why we use `.env.bat` (not `.env`)

Batch files can reliably `call` another `.bat` and inherit variables.
Plain `.env` (KEY=VALUE) is convenient but **hard to parse safely** in `.bat` without edge cases.

### Notes / troubleshooting

- If you see BetterCam install failures, ensure you have Python 3.14+ installed.
- If capture still fails even with the right Python, BetterCam may be blocked by:
  - Remote Desktop (RDP)
  - GPU driver / DXGI duplication restrictions
  - locked-down Windows capture policies


# Recoil Link firmware release artifacts

These files are **meant to be committed** so that:

1. A GitHub tag / "Source code (zip)" download includes flashable firmware.
2. Kit Setup / Electron packaged builds can find images without an nRF Connect SDK install.
3. `flash-emitter.ps1` / `flash-receiver.ps1` work from a fresh clone.

| File | Board | How to flash |
|------|--------|----------------|
| `recoil-dongle-dfu.zip` | Nordic PCA10059 emitter | Open DFU → `..\flash-emitter.ps1 -Port COMx` |
| `recoil-dongle.hex` | same | packaging / nRF Connect Programmer |
| `recoil-receiver.uf2` | Nice!Nano-style + SoftDevice | UF2 volume / `..\flash-receiver.ps1` |
| `recoil-receiver-nosd.uf2` | Nice!Nano-style, no SoftDevice | UF2 volume / `-NoSoftDevice` |

Rebuild and refresh this folder before tagging a release:

```powershell
# nRF Connect toolchain shell
.\build.ps1 -NcsRoot C:\ncs\v2.9.0
git add dist/
```

Do **not** commit `../build/` (west intermediates).
Do **not** put Makerdiary-only `recoil-dongle.uf2` here — the lab emitter is PCA10059 Open DFU.

# Recoil Link — step-by-step setup (this bench)

Goal: **plug-and-play wireless solenoid feedback** — game fire → vest daemon → USB emitter → 2.4 GHz ESB → receiver → MOSFET → JF-0826B, with receiver-timed pulses so a lost radio packet cannot leave the coil on.

Hardware locked to what is on the desk: [LAB_HARDWARE.md](./LAB_HARDWARE.md).

```
Game / Kit Setup UI
        │
        ▼
Python daemon :5050
        │  recoil_connect / recoil_pulse
        ▼
Nordic PCA10059  (Recoil Link TX, USB CDC)
        │  ESB 2 Mbps ch 76
        ▼
Nice!Nano-style RX  →  AO3400A  →  JF-0826B
```

---

## 0. Parts checklist

| Qty | Item | Notes |
|-----|------|--------|
| 1 | Nordic **nRF52840 Dongle PCA10059** | Blue USB-A emitter |
| 1 | Nice!Nano-style nRF52840 (USB-C) | Receiver — **no** reset button |
| 0–1 | Spare Nice!Nano-style | Keep **unpowered** while first RX is live |
| 1 | JF-0826B (or similar) solenoid | ~12 V class |
| 1 | Logic-level N-MOSFET | **AO3400A** (or similar Rds(on) @ 2.5–3.3 V). Not IRLZ44N at 3.3 V gate |
| 1 | 1N4007 (or better) flyback diode | Across coil |
| 1 | 100 Ω gate resistor + **100 kΩ** gate pulldown | Pulldown is mandatory |
| 1 | 12 V pack + buck to **5.0 V** | 5 V → receiver RAW/VBUS only — never 12 V into the MCU |
| PC | Windows | This repo + nRF Connect SDK for firmware builds |

---

## 1. One-time PC tools

### 1.1 Repo + Python daemon package

```powershell
cd F:\DEV-SmSSD\libthirdspacevest-simhub\modern-third-space
pip install -e .
```

### 1.2 nRF Connect SDK (firmware builds)

- Install **nRF Connect SDK v2.9.0** (same as `build.ps1` default: `C:\ncs\v2.9.0`).
- Open an **nRF Connect toolchain** shell so `west` works, **or** use `nrfutil toolchain-manager launch --ncs-version …`.

### 1.3 Open DFU packager (emitter flash)

```powershell
pip install "nrfutil==5.2.0"
# provides: python -m nordicsemi …
```

(Newer `nrfutil nrf5sdk-tools` also works; `build.ps1` / `flash-emitter.ps1` try both.)

### 1.4 Electron UI (optional but recommended)

```powershell
cd F:\DEV-SmSSD\libthirdspacevest-simhub\web
yarn install
yarn dev
```

Use **Kit Setup** in the nav (`#/recoil-link`). Wired USB LC relay stays on **Recoil**.

---

## 2. Build firmware artifacts

From an NCS toolchain shell:

```powershell
cd F:\DEV-SmSSD\libthirdspacevest-simhub\recoil-link\firmware
.\build.ps1 -NcsRoot C:\ncs\v2.9.0
```

Produces under `firmware\dist\`:

| File | Board | Flash tool |
|------|--------|------------|
| `recoil-dongle-dfu.zip` | PCA10059 emitter | Open DFU (`flash-emitter.ps1`) |
| `recoil-dongle.hex` | same | packaging / nRF Connect Programmer |
| `recoil-receiver.uf2` | Nice!Nano **with** SoftDevice | `flash-receiver.ps1` / Kit Setup |
| `recoil-receiver-nosd.uf2` | Nice!Nano **without** SoftDevice | `flash-receiver.ps1 -NoSoftDevice` |

Rebuild after any protocol or pin change. TX and RX must stay on the same radio constants (`firmware/common/`).

**Git / releases:** commit the refreshed `firmware/dist/` artifacts (not `firmware/build/`). They are small (~300 KB) and are what GitHub’s source zip and the Electron installer ship. See `firmware/dist/README.md`.

---

## 3. Flash the emitter (PCA10059)

1. Plug the blue dongle into a USB port on the PC.
2. Press the **sideways RESET** (not white SW1).
3. Confirm **red LED** pulses/fades and Device Manager shows a COM port `VID_1915`/`PID_521F` (often COM15). **No drive letter** — that is correct.
4. Flash:

```powershell
cd F:\DEV-SmSSD\libthirdspacevest-simhub\recoil-link\firmware
.\flash-emitter.ps1 -Port COM15
```

5. Unplug and replug **without** holding RESET.
6. New CDC device should appear as **Recoil Link TX** (manufacturer Third Space). Note the new COM port.

If flash fails: stay in red DFU mode, confirm the COM port, retry. Do not use UF2 / Kit Setup “Install” for this board.

---

## 4. Flash the receiver (Nice!Nano-style)

1. Plug **one** receiver USB-C into the PC. Leave the spare unpowered.
2. Short **RST → GND** twice quickly (pads next to each other near USB).
3. Wait for a UF2 volume (`NICENANO` or similar) with `INFO_UF2.TXT`.
4. Flash (script picks SoftDevice vs nosd from INFO unless overridden):

```powershell
cd F:\DEV-SmSSD\libthirdspacevest-simhub\recoil-link\firmware
.\flash-receiver.ps1 -Drive E:
```

Or use **Kit Setup → Install kit firmware** when the receiver shows Ready.

5. Re-plug. Status LED should **blink three times** at boot.

Wrong UF2 (SD vs nosd) → board that never blinks. Try the other image.

---

## 5. Radio check (coil still disconnected)

Power the receiver from the **5 V** buck (or USB) with **P0.10 floating or only to the 100 kΩ pulldown** — no solenoid yet.

```powershell
cd F:\DEV-SmSSD\libthirdspacevest-simhub\modern-third-space
python -m modern_third_space.cli recoil list
python -m modern_third_space.cli recoil ping --port COMx
python -m modern_third_space.cli recoil pulse --port COMx --ms 25
```

- `ping` / `pulse` must return `OK …` (receiver radio ACK).
- Optionally scope **P0.10**: ~25 ms high per pulse.

Or in the UI: Kit Setup → Connect emitter → **Pulse**.

---

## 6. Wire the solenoid (safe order)

Follow the schematic in [README.md](./README.md) (Receiver wiring):

1. Pack − = MOSFET source = receiver GND.
2. 100 kΩ gate → source (pulldown) **before** any coil power.
3. 100 Ω from **P0.10** to gate.
4. Coil + diode; MOSFET drain to coil low side.
5. 12 V only on the coil loop; **5 V only** into receiver RAW.

Then:

```powershell
python -m modern_third_space.cli recoil pulse --port COMx --ms 25
```

Feel one kick. Prefer 20–25 ms; hard cap is 100 ms.

---

## 7. Plug-and-play with games (daemon)

```powershell
python -m modern_third_space.cli daemon start
python -m modern_third_space.cli recoil connect --port COMx --daemon
```

Or Kit Setup → **Connect**. While the link is connected, game solenoid events use the wireless path (wired USB LC relay is left alone).

Stop / disconnect when done:

```powershell
python -m modern_third_space.cli recoil stop --daemon
```

Daemon JSON commands: `recoil_connect`, `recoil_disconnect`, `recoil_status`, `recoil_pulse`, `recoil_set`.

---

## 8. Reliability rules (do not skip)

| Rule | Why |
|------|-----|
| One powered receiver | Same ESB address — two RXs both kick |
| Receiver times the pulse | Lost RF cannot stretch or stick ON |
| 100 kΩ gate pulldown | Safe during reset / boot |
| Logic-level MOSFET @ 3.3 V | IRLZ44N stays half-on |
| No 12 V on MCU | Destroys the board |
| Emitter = Open DFU only | PCA10059 never mounts UF2BOOT |
| Receiver = UF2 only | RST↔GND twice, not nrfutil |
| TX/RX same build generation | Protocol / channel / address must match |

Radio snapshot: ESB 2 Mbps, channel **76**, address base `A5 3C 91 6E` + prefix `D2` — see README “Radio rules”.

---

## 9. Troubleshooting

| Symptom | Check |
|---------|--------|
| No UF2BOOT on emitter | Expected — use RESET + COM + `flash-emitter.ps1` |
| Red pulse forever after “flash” | Flash failed or still in DFU — replug without RESET; re-flash |
| Receiver never blinks | Wrong UF2 (SD vs nosd); retry other image |
| `ERR TIMEOUT` on ping | RX powered? Antenna clear? Only one RX? Same firmware pair? |
| Coil stuck / hot | Pulldown missing; wrong FET; stop with `recoil stop` |
| Daemon can’t open port | Another app/UI holds COM — Disconnect first |

---

## 10. Script index

| Script | Purpose |
|--------|---------|
| `firmware/build.ps1` | Build emitter DFU zip + both receiver UF2s |
| `firmware/flash-emitter.ps1` | Open DFU → PCA10059 |
| `firmware/flash-receiver.ps1` | Copy UF2 → Nice!Nano volume |
| `modern_third_space.cli recoil …` | list / ping / pulse / daemon connect |

Product path later: custom TX/RX PCBs with the **same** protocol and host commands; only board defs and mechanicals change.

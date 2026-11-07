# Recoil Link — Lab Journal

Living notes for the wireless solenoid recoil product. Append as we build, flash, bench, and play. Keep decisions and measured numbers here; keep how-to steps in [README.md](./README.md).

**How to use this file**

- Newest entries at the **top** of [Session log](#session-log).
- Update the tables in place when a fact changes (parts, pin, pulse feel).
- Do not delete rejected paths — one line in [Rejected paths](#rejected-paths) is enough.
- Link out to commits, photos, or issue IDs when useful.

Related:

- Wired USB LC relay: [docs-feature-ideas/usb-relay-solenoid-recoil/](../docs-feature-ideas/usb-relay-solenoid-recoil/)
- Host / firmware how-to: [README.md](./README.md)
- Protocol source of truth: `firmware/common/recoil_protocol.h` (mirrored in `modern_third_space/recoil_link/protocol.py`)

---

## Goal

A **ready-to-make kit** people can build (or we can manufacture) without relying on developer boards as the final form factor.

Functional target: PC game fire events → USB nRF52840 dongle → low-latency 2.4 GHz packets → receiver nRF52840 → MOSFET → JF-0826B solenoid. Target feel ≈ **20–25 ms** stroke. No false fires from RF noise. Pulse length timed on the receiver so radio jitter cannot stretch the coil ON time.

### Product end-state (keep this in mind)

| Prototype now | Kit / production later |
| --- | --- |
| Nordic PCA10059 nRF52840 Dongle (lab TX; was mislabeled Micro Dev) | Custom (or blank OEM) USB dongle PCB — flash once, no “dev kit” markup |
| Nice!Nano V2-style board | Custom receiver PCB: MCU + MOSFET + diode pads + battery / buck + antenna |
| Bench wiring / breadboard | Fixed schematic, BOM, enclosure notes, flash procedure |
| Shared radio address for all units | Per-kit address / pairing (or at least documented unique IDs) |

The Micro Dev and Nice!Nano boards stay the **lab** hardware. Firmware, protocol, pin roles, and safety rules should stay portable so a custom PCB is mostly a new board definition + mechanical design — not a rewrite.

Kit readiness checklist (long-term):

- [ ] Frozen schematic + BOM (solenoid, FET, diode, buck, antenna, connectors)
- [ ] Custom TX and RX PCB designs (or chosen OEM blanks)
- [ ] Factory / user flash path (UF2 or SWD) documented
- [ ] Unique pairing / address so two kits in one room do not cross-fire
- [ ] Assembly guide + smoke-test (`ping` → pulse → coil)
- [ ] Packaging: dongle + receiver + solenoid wiring loom (or clear “bring your own JF-0826B” option)

---

## Current status

| Area | Status | Notes |
| --- | --- | --- |
| Wired USB LC relay | Working | CH340 module, JF-0826B, 1N4007, ~20–25 ms useful pulse; soft floor ~25 ms on the LC module |
| Raw 433 MHz ASK/OOK | Abandoned | Worked electrically; false triggers from mouse/keyboard noise |
| Firmware (dongle + RX) | **UF2s built** | `firmware/dist/recoil-*.uf2` — dongle @0x1000, RX SoftDevice @0x26000, RX nosd @0x1000 |
| Host Python + daemon | In repo | `recoil_*` CLI / daemon commands; games prefer wireless when linked |
| Electron Recoil page | Wired + wireless sections | Connect / pulse for nRF link |
| First wireless bench | Dongle seen on PC | Micro Dev = **COM15** (`VID_1915&PID_521F`). Flash still pending |

---

## Hardware on the desk

| Item | Spec / identity | Role | Notes |
| --- | --- | --- | --- |
| Solenoid | JF-0826B, DC 12 V, ~2 A, push, 20 N / 10 mm | Actuator | Keep short pulses; do not hold continuously |
| Battery bank | 12–12.6 V, 1–3 A max, 2800 mAh | Coil supply | Separate from USB / logic |
| Flyback diode | 1N4007 | Across coil | Stripe (cathode) toward + |
| USB LC relay | CH340, 9600 baud | Wired path | Still valid backup |
| USB dongle | **Nordic PCA10059** (verified photo) | PTX / PC side | Open DFU / COM `1915:521F`; **no UF2BOOT**. Product name after flash: Recoil Link TX |
| Receiver boards | 2× NRF52840 Nice!Nano V2.0-style | PRX / solenoid side | **Power only one.** Same radio address → both would fire |
| MOSFET (433 build) | IRLZ44N | Was for 5 V gate | Poor at 3.3 V gate — replace for RX |
| MOSFET (target) | AO3400A or similar 2.5/3.3 V logic-level | Low-side switch | Gate resistor ~100 Ω + **100 kΩ pulldown** |
| Logic supply | Buck from 12 V → 5 V into Nice!Nano RAW | Receiver power | Never put 12 V on RAW / VCC |
| 433 MHz parts (shelf) | SYN115 / SYN480R, 74HC14, RC, etc. | Abandoned RF path | Keep for parts only |

Fill in as you open packages / measure:

| Item | Serial / batch / seller | Date received | Notes |
| --- | --- | --- | --- |
| Nordic PCA10059 dongle | USB `1915:521F` → **COM15** (DFU) | 2026-11-07 | Open DFU (red pulse). Not Recoil Link TX until serial DFU flashed. See LAB_HARDWARE.md |
| Nice!Nano #1 | Bootloader 0.6.0 · Model `nice!nano` · SoftDevice **S140 6.1.1** | 2026-03-07 | `H:\NICENANO` in UF2. Use **`recoil_receiver`** UF2 (app @ 0x26000), not nosd. CDC `239A:00B3` = COM16 |
| Nice!Nano #2 | | SoftDevice? | Spare — keep unpowered while testing #1 |

---

## Pin and wiring decisions (receiver)

| Signal | Choice | Why |
| --- | --- | --- |
| Gate GPIO | P0.10 (Pro Micro D10) | Free GPIO; not battery ADC / VCC cut |
| Gate drive | Active high → MOSFET gate | Matches firmware `solenoid_gate` |
| Series gate R | 100 Ω | Soften edge / protect pin |
| Gate pulldown | 100 kΩ to source/GND | Coil stays off on reset / floating pin — **required** |
| Avoid | P0.13 | Nice!Nano v2: high cuts VCC |
| Avoid | P0.04 | Battery sense ADC |
| Logic rail | 5 V buck → RAW | 3.3 V I/O on chip; 12 V only on solenoid loop |

Wiring sketch (same as README):

```
12 V pack +  ── solenoid A ── diode stripe on + side
solenoid B ── MOSFET drain
MOSFET source ── pack − ── RX GND
P0.10 ── 100 Ω ── gate ── 100 kΩ ── source
12 V ── buck 5 V ── RX RAW
```

---

## Software map

| Piece | Path |
| --- | --- |
| Protocol (C) | `firmware/common/recoil_protocol.h` / `.c` |
| Radio init | `firmware/common/recoil_radio.c` |
| Dongle firmware | `firmware/tx/` |
| Receiver firmware | `firmware/rx/` |
| Board defs | `firmware/boards/recoil/` |
| Build script | `firmware/build.ps1` |
| Python host | `modern-third-space/src/modern_third_space/recoil_link/` |
| Daemon | `recoil_*` commands; games use wireless if connected |
| CLI | `python -m modern_third_space.cli recoil …` |
| UI | Electron Recoil page → nRF52840 link |
| Unit tests | `modern-third-space/tests/test_recoil_link_protocol.py` |

Radio snapshot (change only with a version bump and both ends flashed):

| Setting | Value |
| --- | --- |
| Link | Nordic ESB DPL, 2 Mbps, CRC-16 |
| Channel | 76 (2476 MHz) |
| Address | base `A5 3C 91 6E`, prefix `D2` |
| Retries | 2 × 600 µs |
| Pulse clamp | 5–100 ms on RX |
| Min off gap | 20 ms |
| ON lease | 350 ms (host refresh ~150 ms) |
| Continuous ON max | 1000 ms then 500 ms cool |

---

## Rejected paths

| Approach | Why it failed / was dropped |
| --- | --- |
| Garage-door style wireless relays | ~75 ms minimum output — ruins 20–25 ms timing |
| Raw 433 MHz as a “wireless wire” | Idle AGC / noise → false solenoid fires (mouse, keyboard, etc.) |
| Continuous carrier / RC-only cleanup | Helps spikes; not enough against long noise runs |
| BLE for the shot path | Connection-event latency / jitter vs ESB |
| IRLZ44N on 3.3 V Nice!Nano gate | Underrated at 3.3 V — keep for 5 V designs only |

---

## Open questions / next work

- [x] Install nRF Connect SDK v2.9.0
- [x] Run `firmware/build.ps1` (UF2s in `firmware/dist/`)
- [x] Confirm Nice!Nano #1 `INFO_UF2.TXT` → SoftDevice S140 → use `recoil_receiver` (not nosd)
- [ ] Confirm Nice!Nano #2 when needed
- [ ] Flash dongle + one receiver; confirm 3 boot blinks
- [ ] `recoil ping` / `recoil pulse --ms 25` with coil disconnected; check P0.10 with meter/scope
- [ ] Wire AO3400A + diode + pack; find best `duration_ms` for feel
- [ ] Latency: USB write → gate rising edge (note USB CDC vs radio share)
- [ ] Pairing / unique address per kit (today all units share one address) — **required for a ready-to-make kit**
- [ ] Battery voltage sense / ACK `mv` field (reserved as 0 today)
- [ ] Custom TX/RX PCBs (replace Micro Dev + Nice!Nano for production)
- [ ] Kit BOM + assembly / flash guide
- [ ] 6 V solenoid variant — only if it clearly simplifies power

---

## Measured results

| Date | Setup | Pulse ms | Feel / notes | Latency / other |
| --- | --- | --- | --- | --- |
| | Wired LC relay + JF-0826B | ~20–25 | Strong 10 mm stroke; LC often misses OFF under ~20–25 ms | |
| | | | | |

---

## Session log

### 2026-03-07 — Dedicated Recoil Link UI page

- New Electron page `#/recoil-link` for kit setup (checklist, connect, pulse).
- Firmware install at `#/recoil-link/flash`. Wired USB LC relay remains on `#/recoil` only.
- UI renamed **Kit Setup** / **Recoil Kit Setup**; live emitter/receiver bootloader Ready status on setup + flash pages.
- Bugfix: `recoilFirmware.cjs` used `../../../` (ipc depth) from `web/electron/` so it never saw `firmware/dist` UF2s — now `../../`.
- Bench: Micro Dev button-hold → COM15 `1915:521F` only (no UF2BOOT MSC). UI now surfaces serial-without-disk.
- **Correction:** lab emitter is **PCA10059**, not Makerdiary. Red pulse + CDC is correct Nordic Open DFU. UF2BOOT never applies. Written `LAB_HARDWARE.md` + `.cursor/rules/recoil-lab-hardware.mdc`.
- Added **`SETUP.md`** end-to-end path; `build.ps1` targets `nrf52840dongle/nrf52840` + DFU zip; `flash-emitter.ps1` / `flash-receiver.ps1`. TX link @ `0x1000`, no DT code partition.
- Nav: **Recoil Link** entry added next to Recoil.

### 2026-03-07 — First successful UF2 build

- Fixed cross-drive west issue by mirroring to `C:\ncs\recoil-link-firmware`.
- Fixed board defconfigs (no `CONFIG_BOARD_*`), GPIOTE in DTS, `usb_write` name clash.
- Artifacts: `dist/recoil-dongle.uf2` (0x1000), `recoil-receiver.uf2` (0x26000), `recoil-receiver-nosd.uf2` (0x1000).
- Next: flash receiver on `H:\NICENANO` via UI or copy, then dongle via UF2BOOT.

### 2026-03-07 — Electron “Install firmware” page

- Added `/recoil/flash`: scans UF2 volumes (`INFO_UF2.TXT`), classifies dongle vs Nice!Nano SoftDevice/nosd, copies the matching UF2.
- User still puts the board in bootloader (button / double-tap). App does the install copy.
- Images from `firmware/dist/*.uf2` or `firmware/build/.../zephyr.uf2` after `build.ps1`.
- Kit angle: same UI path later with bundled release UF2s under `resources/recoil-link/firmware`.

### 2026-03-07 — Receiver #1 plugged (UF2 mode)

- Volume `H:\NICENANO` with `INFO_UF2.TXT`: SoftDevice S140 6.1.1 present → flash **`build\receiver\zephyr\zephyr.uf2`** (`recoil_receiver`), not nosd.
- Model line says `nice!nano` (not “v2”); pin map still treated as Pro Micro / D10 = P0.10 unless layout differs on the clone.
- Dongle still COM15; Adafruit CDC also seen as COM16 while bootloader is up.
- Next: build UF2s, copy receiver image to `H:\`, then flash dongle.

### 2026-03-07 — Product intent: ready-to-make kit

- End goal is a kit others can build / we can manufacture — not forever shipping Micro Dev + Nice!Nano.
- Dev boards are the lab path; custom (or OEM blank) dongle + receiver PCBs are the product path.
- Design rule: keep protocol, safety, and host software board-agnostic; only board defs / mechanicals change for production.

### 2026-03-07 — nRF Connect SDK v2.9.0 installed

- Installed `nrfutil` (winget), then `nrfutil install sdk-manager`, then `nrfutil sdk-manager install v2.9.0`.
- Result: SDK + toolchain **Installed** under `C:\ncs\v2.9.0` and `C:\ncs\toolchains\b620d30767`.
- Warning: Windows could not create some symlinks (Matter/nanopb paths). Enable Developer Mode if a later build hits those; ESB recoil firmware should not need them.
- Next: run `recoil-link\firmware\build.ps1 -NcsRoot C:\ncs\v2.9.0` from an nrfutil toolchain shell, flash dongle UF2 to COM15 board.

### 2026-03-07 — Micro Dev plugged in

- `recoil list` / Device Manager: **COM15** = Nordic `VID_1915&PID_521F` (Adafruit-style UF2 CDC).
- Other USB serial: COM5 = `2833:0051` (not the dongle). Bluetooth COMs ignored.
- No `UF2BOOT` volume mounted (normal run mode, not bootloader).
- Next: build dongle UF2, hold-button plug to `UF2BOOT`, flash, then `recoil ping --port COM15`.

### 2026-03-07 — Repo scaffold for Recoil Link

- Captured full path from wired LC relay → rejected garage remotes → rejected raw 433 MHz → nRF52840 ESB product direction.
- Hardware on hand: Micro Dev dongle + two Nice!Nano-style boards; JF-0826B kit still the actuator.
- Added `recoil-link/` firmware (TX/RX, protocol, board defs), Python `recoil_link`, daemon/`recoil` CLI, Recoil page wireless section.
- Safety rules locked in firmware: RX-timed pulse, sequence dedupe, ON lease, 1 s continuous / 500 ms cool, gate inactive before radio.
- SDK not installed on the build machine yet — first flash still pending.

### YYYY-MM-DD — _title_

- 

---

## Scratch / raw notes

Paste serial dumps, scope captions, shopping lists, or half-formed ideas below. Promote into the tables above when something sticks.

```
(empty)
```

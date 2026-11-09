# Recoil RX flash / SoftDevice attempt log

**Purpose:** Durable record of what was tried on this bench so agents stop
contradicting themselves. Update this file on **every** flash, wipe, restore, or
SoftDevice-state change. Do not rely on chat memory.

**Hardware:** Nice!Nano-style RX (Adafruit UF2 bootloader 0.6.0). SoftDevice when
present = S140 6.1.1. Emitter = Nordic PCA10059 (separate; Open DFU).

**Address rules (2026-11-08):** [RX_BOOT.md](./RX_BOOT.md). `recoil-receiver.uf2`
is stored at `0x26000` and its reset vector is `0x28841`. Flashed to `H:` at
12:58 (A14). Do not follow the old `0x2801` rebuild steps below for a new image.

---

## STOP — overnight handoff (2026-11-07 ~23:20)

**User-observed LEDs (unchanged end state):** red **double-pulse** + blue **loop
blink**. Same symptoms as A2 / A9 / hours of SoftDevice-slot tries. Do **not**
claim progress from LED color theories until the vector check below passes.

### What was actually wrong (found late; not fixed in any flashed image)

SoftDevice-slot UF2 is written at **`0x26000`**, but NCS Partition Manager still
**links the app as if FLASH ORIGIN = `0x0`**. Vector table inside the UF2:

| Field | Current `dist\recoil-receiver.uf2` (2026-11-07 23:18) |
|-------|------------------------------------------------------|
| UF2 load address | `0x26000` (correct place on disk) |
| Initial SP | `0x200088C0` (SoftDevice-safe RAM — OK) |
| **Reset handler** | **`0x00002801` — WRONG** (must be `0x00028xxx`, i.e. `0x26000 + offset`) |

Boot path: SoftDevice jumps to app @ `0x26000` → loads Reset=`0x2801` → CPU
executes **inside SoftDevice flash** → hardfault / garbage → blue blink loop,
no “Recoil Link RX” CDC. CircuitPython works because it is linked with absolute
addresses in the SoftDevice app window.

**Do not flash another SoftDevice-disable / VTOR / RAM theory until Reset ≥
`0x26000`.** Those patches (A10–A12) never had a chance; the image never reached
`main()`.

### Flashes tonight that hit the board

| ID | Image | Result |
|----|-------|--------|
| A11 | SoftDevice-safe RAM + CDC @ `0x26000` | Ejected; then **no USB**; same LEDs |
| A12 | + VTOR restore before SVC @ `0x26000` | Ejected; **no USB / no CDC**; same LEDs |
| A13 | `pm_static_*` to force app @ `0x26000` | **Not verified.** Wrong filename first;
  renamed to `pm_static_recoil_receiver_nrf52840.yml` exists under `rx/` + board
  dir, but last built `dist` still has **Reset=`0x00002801`** and
  `PM_APP_ADDRESS 0x0`. **Do not treat A13 as done.** |

### Backup to restore CircuitPython / known-good SoftDevice app

`firmware/backups/NICENANO-20261107-231338` (saved before A11 flash).

```powershell
cd recoil-link\firmware
.\flash-receiver.ps1 -Drive H: -Restore .\backups\NICENANO-20261107-231338
```

### Tomorrow — single next step (no more parallel SoftDevice guesses)

1. Rebuild SoftDevice-slot RX until **before any flash**:
   ```powershell
   $b = [IO.File]::ReadAllBytes('dist\recoil-receiver.uf2')
   'load=0x{0:X} Reset=0x{1:X8}' -f [BitConverter]::ToUInt32($b,12), [BitConverter]::ToUInt32($b,36)
   ```
   Pass only if Reset is in **`0x00026xxx`–`0x000F3xxx`** (not `0x00002xxx`).
2. Confirm `PM_APP_ADDRESS` / linker `FLASH ORIGIN` = **`0x26000`** (not `0x0`).
3. Flash **once**, log A14 with LED + whether CDC “Recoil Link RX” appears.
4. If still blinking after a correct Reset vector, then revisit SoftDevice release —
   not before.

### Anti-loop rules for the next agent

- Same LEDs as A2/A9/A11/A12 = **same failure class** until Reset vector is fixed.
- Do not add another SoftDevice SYS_INIT / VTOR / RADIO tweak as the “fix” while
  `Reset=0x00002801`.
- `-Save` alone does **not** flash (`flash-receiver.ps1`); need flash path or
  `Copy-Item dist\recoil-receiver.uf2 → H:\`.

---

## Hard rules (verified)

1. **Adafruit UF2 while SoftDevice is PRESENT**
   - App writes land only at **≥ 0x26000**.
   - Writes targeting **0x1000** (nosd) are **silently skipped**. Copy “succeeds”;
     old app keeps running.
2. **Adafruit UF2 while SoftDevice is ABSENT (`SoftDevice: not found`)**
   - App starts at **0x1000**.
   - SoftDevice-region writes **are accepted** (this is how SoftDevice restore works).
   - SoftDevice-linked app @ **0x26000** will **not** boot (MBR jumps to 0x1000).
3. **ESB vs SoftDevice**
   - SoftDevice (BLE stack) **owns the radio** while enabled.
   - Recoil uses **ESB**, which needs the radio → SoftDevice must be **disabled or
     absent** before `esb_init`, or init fails → fail-safe LED.
4. **Cannot wipe SoftDevice over UF2 while it is installed**
   - Needs **SWD** (J-Link / DK / CMSIS-DAP on SWD/SWC pads) + tools
     (`wipe-softdevice.ps1`). USB-only “NICENANO drive” is not enough.
5. **“Probe”** = external SWD debugger dongle + wires to board pads. **Not** USB-C,
   **not** the NICENANO volume, **not** the emitter.

---

## LED codes (current Recoil RX firmware)

| Pattern | Meaning |
|---------|---------|
| Short solid blue, then 3 blinks, then idle off | Boot OK, radio up |
| N blinks (~200 ms), then ~2 s dark, repeat | Fail-safe code N |
| 1 | Protocol self-test |
| 2 | HF clock |
| 3 | `esb_init` |
| 4 | `esb_start_rx` |
| 5 | SoftDevice release failed (SoftDevice-slot build only) |
| 6 | SoftDevice release hook did not run (SoftDevice-slot only) |
| Red 2-pulse / half-pause | Observed with fail-safe; **not** coded by our firmware (charge/other) |
| Red slow blink / charge LED | Often charger / power; **not** our fail-safe codes (those are blue) |

---

## Backup locations

| Path | What |
|------|------|
| `firmware/backups/rx-spare-20261107-201320/` | Spare RX dump (had SoftDevice) |
| `firmware/backups/restore-s140-6.1.1-from-spare.uf2` | SoftDevice-only extract from spare |
| `firmware/backups/NICENANO-20261107-205110/` | CircuitPython-era CURRENT.UF2 |
| `firmware/backups/NICENANO-20261107-205114/` | Auto-save (same era) |
| `firmware/backups/NICENANO-20261107-225412/` | Save before refused nosd |
| `firmware/backups/NICENANO-20261107-225417/` | Auto-save same attempt |
| `firmware/backups/NICENANO-20261107-225825/` | Save before SoftDevice-slot Recoil flash |

Restore:

```powershell
cd recoil-link\firmware
.\flash-receiver.ps1 -Drive H: -Restore .\backups\NICENANO-20261107-225825
```

---

## Attempt log (newest last)

### A1 — Early session: SoftDevice already `not found` on first RX

- **State:** `SoftDevice: not found`
- **Action:** Flash `recoil-receiver-nosd.uf2` (@ 0x1000) repeatedly
- **Result:** Image wrote. Board entered **blue fail-safe loop** (ESB/boot issue under debug; coded blinks added later)
- **Note:** SoftDevice was **already absent**. This was **not** a UF2 wipe of an installed SoftDevice.

### A2 — SoftDevice restore from spare

- **State:** SoftDevice not found
- **Action:** Copy `restore-s140-6.1.1-from-spare.uf2` then `recoil-receiver.uf2` (@ 0x26000)
- **Result:** SoftDevice returned to **S140 6.1.1**. SoftDevice-linked Recoil still fail-safed (ESB vs SoftDevice)

### A3 — Nosd while SoftDevice present (FAILED / no-op)

- **State:** SoftDevice S140 present
- **Action:** Flash nosd @ 0x1000 (script or Kit UI)
- **Result:** Copy looked OK; **Adafruit skipped writes**. Old firmware kept running
- **Lesson:** Never treat nosd copy as success when INFO lists SoftDevice

### A4 — CircuitPython known-good test

- **State:** SoftDevice briefly not found → restored SoftDevice → flashed  
  `S:\Chrome Downloads\adafruit-circuitpython-nice_nano-en_US-10.3.1.uf2` (@ 0x26000)
- **Result:** **WORKED.** `CIRCUITPY` volume, `boot_out.txt` CP 10.3.1, COM19 `VID_239A`
- **Lesson:** SoftDevice-slot apps that **use** SoftDevice (CP) work. Recoil ESB does not, unless SoftDevice is released/absent

### A5 — Flasher hardened (refuse mismatches)

- **Action:** `flash-receiver.ps1` + Kit Setup refuse SoftDevice/nosd mismatches; verify UF2 load address
- **Result:** Policy change only (no radio fix)

### A6 — Product decision: nosd-only + Save/Restore

- **Action:** Recoil flash path = nosd; `-Save` / `-Restore` for SoftDevice apps
- **Result:** Scripts updated. SoftDevice wipe documented as SWD-only via `wipe-softdevice.ps1`

### A7 — SoftDevice wipe script

- **Action:** Wrote `wipe-softdevice.ps1` (nrfutil device page-erase / recover)
- **Result:** **Could not run wipe** — no SWD probe connected; J-Link DLL not installed. nice!nano only shows `serialPorts, usb`

### A8 — Save + refuse nosd (SoftDevice still present)

- **Date:** 2026-11-07 ~20:51 and ~22:54
- **State:** SoftDevice S140 6.1.1, UF2 `H:`
- **Action:** `-Save` then nosd flash
- **Result:** Backup OK; flash **refused** (correct)

### A9 — SoftDevice-slot Recoil with runtime SoftDevice disable

- **Date:** 2026-11-07 ~22:58
- **State:** SoftDevice S140 present
- **Action:** Built `recoil-receiver.uf2` (@ 0x26000) with `recoil_softdevice_release()` in `main()` then ESB; flashed. Backup `NICENANO-20261107-225825`
- **Result (user LED report ~22:59):** **FAILED — same as hours ago.**
  - Red: 2 pulses, short/half pause, repeat
  - Blue: continuous blink (fail-safe; not idle-off)
- **Conclusion:** SoftDevice-slot UF2 **did write** (@ 0x26000 is allowed), but **disable-at-main did not yield a working ESB boot**. Same end state as A2 (SoftDevice-linked Recoil without effective radio). Possible causes to test next (not claims):
  - SoftDevice disable too late (Zephyr already collided with SoftDevice RAM)
  - SVC disable returned success / skipped but radio still owned
  - ESB init still fails after disable (would be fail-safe 3)
  - Release failed (would be fail-safe 5) — continuous blink may hide 2 s gap

### A10 — SoftDevice disable in PRE_KERNEL SYS_INIT (earlier)

- **Date:** 2026-11-07 ~23:00
- **State:** SoftDevice present; A9 failed (same LEDs as hours ago)
- **Action:** `recoil_softdevice_release()` in `SYS_INIT(..., PRE_KERNEL_1, 0)`; main checks ran/result (fail-safe 5/6); rebuilt `recoil-receiver.uf2` @ 0x26000
- **Flash:** *(pending / superseded by A11)*
- **Result / LED:** *(not confirmed; moved to A11 SoftDevice-safe RAM)*

### A11 — SoftDevice-safe RAM + USB CDC (why CircuitPython worked)
- **Date/time:** 2026-11-07 ~23:08 local
- **Hypothesis:** Zephyr/NCS Partition Manager linked SRAM at `0x20000000`, so BSS
  clear wiped SoftDevice RAM before `sd_softdevice_disable` could run.
  CircuitPython keeps APP_RAM_BASE at `0x20004000` — that is why “the python one
  works.”
- **Action:** SoftDevice-slot board `&sram0 { reg = <0x20004000 0x3c000>; }` so
  PM_SRAM_BASE=0x20004000 / SIZE=0x3c000; linker `RAM ORIGIN = 0x20004000`;
  RADIO power cycle after disable; USB CDC printk boot path; rebuild
  SoftDevice-slot `recoil-receiver.uf2` @ `0x26000` (100352 bytes).
- **Verified build:** `linker.cmd` ORIGIN `0x20004000` LENGTH `0x3c000`;
  `PM_SRAM_PRIMARY_ADDRESS 0x20004000`.
- **INFO SoftDevice:** `S140 version 6.1.1` (H: NICENANO)
- **Flash:** 2026-11-07 ~23:14 — copied `dist\recoil-receiver.uf2` @ `0x26000` → `H:\`;
  volume ejected (normal). Backup first: `backups\NICENANO-20261107-231338`
  (note: `flash-receiver.ps1 -Save` is save-only; actual flash was Copy-Item).
- **Result / LED:** Board left USB entirely after eject — no CDC, no NICENANO.
  Suspected hardfault: Zephyr moved `VTOR` before SoftDevice SVC (see A12).
- **COM:** none (VID_239A absent)

### A12 — VTOR restore before SoftDevice disable
- **Date/time:** 2026-11-07 ~23:16 local
- **Hypothesis (secondary / likely moot):** SoftDevice SVCs need VTOR @ `0x1000`.
- **Action:** VTOR save/restore around SVC; rebuild; flashed to H: when NICENANO
  reappeared; volume ejected.
- **Result / LED:** **Same as A11** — red double-pulse + blue loop; no CDC.
- **Note:** Later found Reset=`0x00002801` (see STOP / A13). A12 never reached
  SoftDevice release in a meaningful way.

### A13 — pm_static flash map (INCOMPLETE — stopped for night)
- **Date/time:** 2026-11-07 ~23:18–23:20
- **Hypothesis (PRIMARY):** NCS PM links app @ `0x0` while UF2 stores @ `0x26000`
  → Reset vector wrong → hardfault. Explains identical LEDs across A9–A12.
- **Action:** Added `rx/pm_static_recoil_receiver_nrf52840.yml` (and nosd twin;
  copies under board dirs). First filename lacked `_nrf52840` so PM ignored it.
- **Verified on last `dist`:** still `Reset=0x00002801`, `PM_APP_ADDRESS 0x0`.
  **A13 did not produce a good UF2.** No further flash. See STOP handoff.

### A14 — SoftDevice-slot image with reset vector 0x28841
- Date/time: 2026-11-08 12:58 local
- INFO SoftDevice: S140 version 6.1.1 (`H:` NICENANO)
- Action: `flash-receiver.ps1 -Drive H:`
- Artifact / path: `dist\recoil-receiver.uf2` load `0x26000` Reset `0x00028841` SP `0x200088C0`
- Backup: `firmware\backups\NICENANO-20261108-125803`
- Result: Copy finished. Board left the UF2 drive (normal).
- LED / COM / follow-up: User report 12:59 — red LED on, then 3 blinks, then off. This matches boot success (status LED is P0.15; this board shows it as red). Radio init passed. No COM check yet.

---

## Current intended workflow

| Goal | How |
|------|-----|
| Recoil with SoftDevice still installed (USB only) | `recoil-receiver.uf2` @ 0x26000, reset vector also in `0x26xxx`, `soc_reset_hook` disables S140, then ESB. `flash-receiver.ps1` selects this when INFO lists a SoftDevice |
| Recoil nosd (clean) | SoftDevice must already be `not found`, then `recoil-receiver-nosd.uf2` @ 0x1000. The script refuses this file while SoftDevice is installed |
| Keep CircuitPython | `-Save` before Recoil; `-Restore` backup folder later |
| Wipe SoftDevice | SWD + `wipe-softdevice.ps1` (needs probe + J-Link software) |

---

## Agent checklist (before claiming anything)

- [ ] Read this file
- [ ] Read `INFO_UF2.TXT` SoftDevice line on the live volume
- [ ] Log a new **A#** entry for every flash/save/restore/wipe try (time, INFO SoftDevice, UF2 name, load address, result, LED)
- [ ] Never say “wipe SoftDevice” unless SWD wipe actually ran or INFO already says not found
- [ ] Never say nosd “flashed OK” if SoftDevice was still listed in INFO

### Template for next entry

```
### A# — short title
- Date/time:
- INFO SoftDevice:
- Action:
- Artifact / path:
- Result:
- LED / COM / follow-up:
```

# Lab hardware on hand (verified 2026-11-07)

Canonical inventory for **this bench**. Do not assume Makerdiary Micro Dev or a buttoned Nice!Nano unless those boards are actually present.

**End-to-end procedure:** [SETUP.md](./SETUP.md) (build → flash → wire → daemon).

Photos used: emitter `IMG_7731`, receiver `IMG_7730`.

---

## Emitter (PC USB side) — Nordic nRF52840 Dongle

| Field | Value |
|--------|--------|
| **What it is** | Official **Nordic Semiconductor nRF52840 Dongle** |
| **PCA / Zephyr board** | **PCA10059** · Zephyr: `nrf52840dongle/nrf52840` |
| **What it is not** | Not Makerdiary MDK USB Dongle, not “Micro Dev” |
| **How to recognize** | Blue PCB, Nordic logo, molded **USB-A** stick, white face button **SW1**, tiny **sideways RESET** next to SW1, LEDs LD1/LD2 |
| **SoC** | nRF52840 (USB + 2.4 GHz ESB capable) |
| **Role in kit** | Recoil Link **TX / emitter** (USB CDC ↔ ESB) |

### Enter bootloader (DFU)

1. Use the **sideways RESET** button (SW2) — **not** the white SW1.
2. Press RESET (board already plugged, or press while inserting).
3. **LD2 pulses / fades red** → Open USB bootloader is running.
4. Windows shows **USB Serial** (`VID_1915` & `PID_521F`), e.g. COM15.
5. **There is no UF2BOOT drive.** Never wait for a mass-storage volume on this board.

### Flash method

- **Only:** Nordic Open DFU over that COM port.
- Lab scripts: `firmware/build.ps1` → `dist/recoil-dongle-dfu.zip`, then `firmware/flash-emitter.ps1 -Port COMx`.
- Also fine: nRF Connect Programmer with the same hex/zip.
- **Do not** use Kit Setup UF2 copy for this emitter (no disk).
- Makerdiary `UF2BOOT` / green-LED UF2 instructions **do not apply**.

### Firmware notes

- TX builds against Zephyr board **`nrf52840dongle/nrf52840`** with app linked at **`0x1000`** (Open Bootloader).
- USB product string after flash: **Recoil Link TX**. Status LED uses PCA10059 red (P0.8) when using the stock board aliases.

---

## Receiver (solenoid side) — Nice!Nano–style (no reset switch)

| Field | Value |
|--------|--------|
| **What it is** | **Nice!Nano V2–style** nRF52840 board (Pro Micro footprint, USB-C) |
| **What it is not** | Not a PCA10059; not a board with a factory reset tactile switch |
| **How to recognize** | Black PCB, USB-C, castellated Pro Micro pins, chip marking **nRF52840**, pin labels include **RST** next to **GND** near USB end; **no push-button on the board** |
| **SoC** | nRF52840 |
| **Role in kit** | Recoil Link **RX** (ESB → MOSFET gate, typically **P0.10**) |

### Enter bootloader (UF2)

1. Plug USB-C into the PC.
2. Briefly short **RST → GND** **twice** quickly (tweezers) — same as Nice!Nano double-tap reset.
3. Expect a mass-storage volume (often **`NICENANO`**) with `INFO_UF2.TXT`.
4. If SoftDevice is listed in `INFO_UF2.TXT`, flash **`recoil-receiver.uf2`** (app @ `0x26000`).
5. If no SoftDevice, use **`recoil-receiver-nosd.uf2`** (app @ `0x1000`).
6. Flash **one** receiver only; keep the spare unpowered.

### Flash method

- **UF2 drag-and-drop** (or Kit Setup Install when the NICENANO drive is detected).
- Open DFU / `nrfutil` on the Nordic dongle **does not** apply to this board.

---

## Spare / actuators

| Item | Notes |
|------|--------|
| Second Nice!Nano-style board | Keep **unpowered** while the first RX is in use (same radio address). |
| JF-0826B solenoid + MOSFET | Wire only after ping/pulse with coil disconnected. Gate = receiver **P0.10**. |

---

## Kit Setup UI — what “Ready” means for *this* lab

| Board | Ready to flash means |
|--------|----------------------|
| Emitter (PCA10059) | Red DFU LED + Nordic COM `1915:521F` — **not** a UF2 disk |
| Receiver | `NICENANO` (or similar) UF2 volume mounted |

Until the emitter flash path is Open-DFU in the app, flash the dongle with CLI / nRF Connect Programmer; use the UI for the receiver UF2 step.

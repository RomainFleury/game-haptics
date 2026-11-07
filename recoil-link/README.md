# Recoil Link

Wireless recoil for the JF-0826B. The PC sends a shot to an nRF52840 USB dongle. The dongle sends one Enhanced ShockBurst packet. The receiver nRF52840 turns the MOSFET on and times the pulse itself, then turns it off.

A lost packet can delay the start of a kick. It cannot stretch the kick, and it cannot leave the coil on.

**Start here (this bench):** [SETUP.md](./SETUP.md) — full build → flash → wire → daemon path.  
**Exact boards:** [LAB_HARDWARE.md](./LAB_HARDWARE.md).  
**Session notes:** [JOURNAL.md](./JOURNAL.md).

**Product intent:** a ready-to-make kit. Lab boards today are Nordic **PCA10059** + buttonless Nice!Nano-style RX. Production is custom (or OEM) TX/RX PCBs with the same protocol and host software.

**UI:** **Recoil** (`#/recoil`) connects LC relay or Recoil Link TX for pulse/click. **Kit Setup** (`#/recoil-link`) watches USB/UF2, flashes firmware, and lists parts. CLI: `firmware/flash-emitter.ps1`.

```
PC USB CDC  →  nRF52840 dongle (PTX)
            →  2.4 GHz ESB, 2 Mbps, channel 76
            →  nRF52840 receiver (PRX)
            →  MOSFET
            →  JF-0826B
```

When the dongle is connected to the vest daemon, game recoil uses the wireless link and leaves the relay alone.

## What you have

| Board | Role | Flash |
| --- | --- | --- |
| Nordic nRF52840 Dongle (**PCA10059**) | Emitter on PC | Open DFU → COM `1915:521F` — **no UF2 disk** |
| Nice!Nano V2-style (**no reset button**) | Receiver on solenoid | Short **RST→GND** twice → UF2 volume |
| Second Nice!Nano | Spare | Same firmware/address — power only one |

## Receiver wiring

The gate pin is **P0.10** (Pro Micro D10), driven high to fire. nRF52840 pins are 3.3 V and are not 5 V tolerant.

Use a MOSFET whose on-resistance is specified at 2.5 V or 3.3 V gate, such as an **AO3400A**. The IRLZ44N from the 433 MHz build is only partly on at 3.3 V.

```
12 V pack +  ── solenoid lead A
               │
               └── 1N4007 stripe (cathode)

solenoid lead B ── AO3400A drain
AO3400A source ── pack −, and the receiver GND

P0.10 ── 100 Ω ── AO3400A gate
gate ── 100 kΩ ── source        (required pulldown)

12 V pack ── buck set to 5.0 V ── receiver RAW (or VBUS)
buck GND ── pack −
```

- The 100 kΩ pulldown keeps the coil off while the chip resets or the pin is floating.
- Do not feed 12 V into the Nice!Nano. RAW wants about 5 V.
- Do not use **P0.13** (Nice!Nano v2: driving it high can cut the 3.3 V rail).
- Do not use **P0.04** (battery-sense ADC).
- Keep the solenoid loop away from the chip antenna.
- Receiver hard-caps a pulse at 100 ms and a continuous hold at 1 s, then forces 500 ms off.

Bench order: flash both boards → `ping` with no solenoid → confirm three boot blinks → check P0.10 → then connect the coil. Details in [SETUP.md](./SETUP.md).

## Build & flash (summary)

```powershell
cd recoil-link\firmware
.\build.ps1 -NcsRoot C:\ncs\v2.9.0
.\flash-emitter.ps1 -Port COM15          # after sideways RESET (red LED)
.\flash-receiver.ps1 -Drive E:           # after RST↔GND twice
```

| Artifact | Board |
| --- | --- |
| `dist\recoil-dongle-dfu.zip` | PCA10059 emitter |
| `dist\recoil-receiver.uf2` | Nice!Nano with SoftDevice |
| `dist\recoil-receiver-nosd.uf2` | Nice!Nano without SoftDevice |

## Bench, then games

```powershell
cd modern-third-space
python -m modern_third_space.cli recoil list
python -m modern_third_space.cli recoil ping --port COMx
python -m modern_third_space.cli recoil pulse --port COMx --ms 25

python -m modern_third_space.cli daemon start
python -m modern_third_space.cli recoil connect --port COMx --daemon
```

`pulse` returns when the receiver has the packet. It does not wait out the 25 ms, and it does not retry (a retry could double-kick).

Daemon commands: `recoil_connect`, `recoil_disconnect`, `recoil_status`, `recoil_pulse`, `recoil_set`.

## Radio rules

| Item | Value |
| --- | --- |
| Modulation | Nordic ESB, dynamic payload, 2 Mbps, CRC-16 |
| Channel | 76 (2476 MHz) |
| Address | base `A5 3C 91 6E`, prefix `D2` |
| Retries | 2, 600 µs apart |
| Power | 0 dBm |
| Packet | 12 bytes, XOR over the first 11. See `firmware/common/recoil_protocol.h` |
| Commands | `PULSE`, `ON` (lease), `OFF`, `STOP`, `PING` |
| Pulse window | 5–100 ms, timed on the receiver |
| Gap | 20 ms forced off after each pulse |
| Duplicate sequence | Ignored |
| Hold | 1 s max, then 500 ms cool |

USB lines the dongle accepts:

```
PULSE 0 25
ON 0
OFF 0
STOP
PING
```

Answers `OK <seq> <state> <mv> <flags> <ack_seq>` or `ERR TIMEOUT`. Flag bits: 1 clamped, 2 duplicate, 4 dropped, 8 thermal cutoff.

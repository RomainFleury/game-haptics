# Receiver boot and flash addresses

Short record of the receiver start addresses. Read this before you change the UF2 layout or the SoftDevice hook.

Hardware: Nice!Nano-style receiver, Adafruit UF2 bootloader. SoftDevice, when present, is S140 6.1.1. Emitter: Nordic PCA10059. The emitter is a separate file.

---

## Two receiver files today

`firmware/dist/recoil-receiver.uf2` is for a board that has the SoftDevice. The program address is `0x26000`. The last build has reset vector `0x28841` and stack `0x200088C0`.

`firmware/dist/recoil-receiver-nosd.uf2` is for a board that has no SoftDevice. The program address is `0x1000`. The last build has reset vector `0x3749` and stack `0x200048C0`.

`firmware/dist/recoil-dongle.hex` is the emitter. The program address is `0x1000`. The last build has reset vector `0x3661` and stack `0x200048C0`.

These files were built on 2026-11-08. `recoil-receiver.uf2` was flashed to drive `H:` at 12:58. The emitter file and the no-SoftDevice receiver file were not flashed. The build compile finished. `firmware/RecoilImageCheck.ps1` then failed on the emitter HEX file. The vectors above were read from the built files after that failure.

---

## Why the old receiver file did not start

The old `recoil-receiver.uf2` was stored at `0x26000`. Its reset vector was `0x2801`. The chip jumps to the reset vector. `0x2801` is inside the SoftDevice. The program did not start.

Partition Manager linked the program at address 0. The UF2 step stored the program at the devicetree address. The link address and the file address were different.

---

## Where the program address is set

The SoftDevice receiver address is the code partition in `firmware/boards/recoil/recoil_receiver/recoil_receiver_nrf52840.dts`. The partition starts at `0x26000`.

The receiver without a SoftDevice uses `firmware/boards/recoil/recoil_receiver_nosd/recoil_receiver_nosd_nrf52840.dts`. The partition starts at `0x1000`.

The emitter address is `CONFIG_FLASH_LOAD_OFFSET=0x1000` in `firmware/tx/prj.conf`.

`firmware/rx/sysbuild.conf` and `firmware/tx/sysbuild.conf` set `SB_CONFIG_PARTITION_MANAGER=n`. Partition Manager is off, so the linker uses those addresses. The UF2 file uses the same addresses.

---

## What the chip does at reset

The chip starts at one fixed address. The bootloader on the board chooses that address.

When the SoftDevice is installed, the chip starts at `0x26000`. The bootloader does not write bytes below `0x26000`.

When the SoftDevice is absent, the chip starts at `0x1000`. The bootloader accepts writes in the SoftDevice area.

The flash script cannot change this choice.

A program built for `0x26000` runs only when the chip starts at `0x26000`. Its reset vector is an address in that area (`0x28841` in the last build). If the chip starts at `0x1000`, it does not run that program.

---

## Radio settings

The radio settings are inside the UF2 file. The build copies the channel, the address, and the data rate from `firmware/common/`. The flash script does not send them.

The emitter file and the receiver file must come from the same build.

---

## What the flash script does

`firmware/flash-receiver.ps1` does these steps:

1. It reads `INFO_UF2.TXT` on the `NICENANO` drive.
2. It selects `recoil-receiver.uf2` when that file lists a SoftDevice.
3. It selects `recoil-receiver-nosd.uf2` when the SoftDevice is absent.
4. It checks that the reset vector is inside the program address range.
5. It copies `CURRENT.UF2` into `firmware/backups/`.
6. It copies the new UF2 file onto the drive.

The bootloader writes that file into the chip flash and restarts the board. The script does not erase the SoftDevice. The script does not run the new program.

---

## SoftDevice disable step

The SoftDevice owns the radio while it is enabled. Recoil uses ESB. ESB needs that radio. The SoftDevice receiver must disable the SoftDevice during startup, before the radio starts.

`firmware/rx/boards/recoil_receiver.conf` sets `CONFIG_SOC_RESET_HOOK=y`. Zephyr calls `soc_reset_hook()` at reset, before the normal program start.

`soc_reset_hook()` is in `firmware/common/softdevice_release.c`. It sends SoftDevice command `SD_SOFTDEVICE_DISABLE` and stores the result. `firmware/rx/src/main.c` reads the result. If the result is good, `main` starts ESB.

The build includes this file only for the SoftDevice receiver. The receiver without a SoftDevice does not contain this step.

On 2026-11-08 the flashed board showed the status LED on, then 3 blinks, then off. The disable step ran. The radio start succeeded. The status LED is P0.15. This board shows that LED as red.

---

## One receiver file (not built)

One receiver UF2 file can serve both board states. That file is not built yet. The emitter stays a separate file.

The program stays at `0x26000`. The same UF2 file must also contain a small start block at `0x1000`.

The start block is a few bytes. Those bytes tell the chip to continue at `0x26000`.

When the SoftDevice is present, the bootloader does not write the `0x1000` block. The SoftDevice starts the program at `0x26000`. The program disables the SoftDevice, then starts the radio.

When the SoftDevice is absent, the bootloader writes the `0x1000` block. The chip starts at `0x1000`. The start block jumps to `0x26000`. The program finds no SoftDevice and starts the radio.

The RAM start for that single file must stay at `0x20004000`. The stack is then above the SoftDevice RAM.

The `0x1000` start block is not in the current UF2 file. Add it in the firmware build. Do not add it in the flash script.

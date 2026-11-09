#pragma once

#include <stdbool.h>
#include <stdint.h>

/*
 * SoftDevice-slot builds only (recoil_receiver).
 * soc_reset_hook() disables S140 before Zephyr touches RAM or the radio.
 * The result is kept in .noinit so main() can still see it after BSS clear.
 */
int recoil_softdevice_release(void);
int recoil_softdevice_release_result(void);
bool recoil_softdevice_release_ran(void);

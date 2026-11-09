#include "softdevice_release.h"

#include <stdbool.h>
#include <stdint.h>

#include <zephyr/arch/cpu.h>
#include <zephyr/linker/section_tags.h>

/* S140 SoftDevice Manager SVCs (nrf_sdm.h). */
#define SDM_SVC_BASE 0x10
#define SD_SOFTDEVICE_DISABLE (SDM_SVC_BASE + 1)

#define MBR_SIZE 0x1000u
#define SOFTDEVICE_VTOR 0x1000u
#define SD_INFO_STRUCT_SIZE_OFFSET 0x2000u

/* nRF52840 RADIO.POWER is at peripheral base + 0xFFC, not base + 0. */
#define NRF_RADIO_POWER_ADDR 0x40001FFCu

#define SD_RELEASE_MAGIC 0x524C5344u /* RLSD */

struct sd_release_mem {
	uint32_t magic;
	int32_t result;
};

/*
 * Survives the BSS clear that runs after soc_reset_hook(). A normal global
 * would be wiped before main() could read it.
 */
__noinit static volatile struct sd_release_mem sd_release_state;

__attribute__((naked)) static uint32_t sd_softdevice_disable(void)
{
	__asm volatile(
		"svc %0\n"
		"bx lr\n"
		:
		: "I"(SD_SOFTDEVICE_DISABLE)
		: "r0", "memory");
}

static int softdevice_info_looks_present(void)
{
	volatile uint8_t *size =
		(volatile uint8_t *)(MBR_SIZE + SD_INFO_STRUCT_SIZE_OFFSET);
	uint8_t v = *size;

	return (v >= 0x08u && v < 0x80u) ? 1 : 0;
}

static void radio_power_cycle(void)
{
	volatile uint32_t *power = (volatile uint32_t *)NRF_RADIO_POWER_ADDR;

	*power = 0u;
	*power = 1u;
}

/*
 * SVC is a HardFault while PRIMASK is set. Point VTOR at the SoftDevice
 * table only for the call, and mask IRQs again before restoring the app
 * table so a pending IRQ cannot land in Zephyr before it is initialized.
 */
static int release_now(void)
{
	uint32_t old_vtor;
	uint32_t err;

	sd_release_state.magic = SD_RELEASE_MAGIC;

	if (!softdevice_info_looks_present()) {
		sd_release_state.result = 0;
		return 0;
	}

	old_vtor = SCB->VTOR;
	SCB->VTOR = SOFTDEVICE_VTOR;
	__DSB();
	__ISB();
	__enable_irq();

	err = sd_softdevice_disable();

	__disable_irq();
	SCB->VTOR = old_vtor;
	__DSB();
	__ISB();

	if (err != 0u) {
		sd_release_state.result = -(int32_t)err;
		return sd_release_state.result;
	}

	radio_power_cycle();
	sd_release_state.result = 0;
	return 0;
}

/*
 * reset.S calls this before it raises BASEPRI, and before z_prep_c()
 * relocates VTOR or clears BSS. Stack is the vector-table SP, which the
 * SoftDevice-slot link places above S140 RAM.
 */
void soc_reset_hook(void)
{
	(void)release_now();
}

int recoil_softdevice_release(void)
{
	return release_now();
}

int recoil_softdevice_release_result(void)
{
	if (sd_release_state.magic != SD_RELEASE_MAGIC) {
		return -1;
	}
	return sd_release_state.result;
}

bool recoil_softdevice_release_ran(void)
{
	return sd_release_state.magic == SD_RELEASE_MAGIC;
}

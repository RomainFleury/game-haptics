/*
 * Recoil Link receiver.
 *
 * nRF52840 (nice!nano v2 pinout) receives ESB packets and drives a low-side
 * MOSFET. Pulse length is timed on this board. A lost radio link cannot
 * stretch a pulse. ON is a lease: if refreshes stop, the coil drops.
 * The gate pin is driven low before the radio starts. A hardware pulldown
 * on the gate is still required so a reset or a crashed pin (high-Z) cannot
 * hold the solenoid.
 */

#include "recoil_radio.h"

#include <errno.h>
#include <zephyr/device.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/drivers/watchdog.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/onoff.h>
#include <zephyr/drivers/clock_control.h>
#include <zephyr/drivers/clock_control/nrf_clock_control.h>

#define GATE_NODE DT_NODELABEL(solenoid_gate)
#define LED_NODE DT_NODELABEL(status_led)

static const struct gpio_dt_spec gate = GPIO_DT_SPEC_GET(GATE_NODE, gpios);
static const struct gpio_dt_spec led = GPIO_DT_SPEC_GET(LED_NODE, gpios);

enum out_state {
	ST_IDLE = 0,
	ST_PULSE = 1,
	ST_LEASE = 2,
	ST_COOL = 3,
};

enum deadline_kind {
	DL_NONE = 0,
	DL_RELEASE = 1,
	DL_COOL_DONE = 2,
};

static struct {
	enum out_state state;
	int64_t on_since;
	int64_t deadline;
	enum deadline_kind kind;
	bool pending_pulse;
	uint16_t pending_ms;
	bool pending_lease;
	uint16_t cool_ms;
	uint16_t last_seq;
	bool have_seq;
	uint8_t flags;
	uint8_t last_cmd;
} out;

static K_SEM_DEFINE(packet_sem, 0, 1);
static int wdt_channel = -1;
static const struct device *wdt_dev;

static int clocks_start(void)
{
	int err;
	int res;
	struct onoff_manager *clk_mgr;
	struct onoff_client clk_cli;

	clk_mgr = z_nrf_clock_control_get_onoff(CLOCK_CONTROL_NRF_SUBSYS_HF);
	if (!clk_mgr) {
		return -ENXIO;
	}
	sys_notify_init_spinwait(&clk_cli.notify);
	err = onoff_request(clk_mgr, &clk_cli);
	if (err < 0) {
		return err;
	}
	do {
		err = sys_notify_fetch_result(&clk_cli.notify, &res);
		if (!err && res) {
			return res;
		}
	} while (err);
	return 0;
}

static void drive(bool on)
{
	gpio_pin_set_dt(&gate, on ? 1 : 0);
}

static void preload_ack(void)
{
	uint8_t raw[RECOIL_PACKET_LEN];
	struct recoil_ack_packet ack = {
		.command = out.last_cmd,
		.state = (out.state == ST_PULSE || out.state == ST_LEASE) ? 1 : 0,
		.sequence = out.have_seq ? out.last_seq : 0,
		.flags = out.flags,
	};

	recoil_pack_ack(&ack, raw);
	(void)esb_flush_tx();
	(void)recoil_write_payload(raw);
}

static void arm_deadline(enum deadline_kind kind, int64_t when)
{
	out.kind = kind;
	out.deadline = when;
}

static void enter_cool(int64_t now, uint16_t cool_ms)
{
	drive(false);
	out.state = ST_COOL;
	out.cool_ms = cool_ms;
	arm_deadline(DL_COOL_DONE, now + cool_ms);
}

static void start_pulse(int64_t now, uint16_t duration_ms)
{
	if (!((out.state == ST_PULSE) || (out.state == ST_LEASE))) {
		out.on_since = now;
	}
	drive(true);
	out.state = ST_PULSE;
	arm_deadline(DL_RELEASE, now + duration_ms);
}

static void start_lease(int64_t now)
{
	if (out.state != ST_LEASE && out.state != ST_PULSE) {
		out.on_since = now;
	}
	drive(true);
	out.state = ST_LEASE;
	arm_deadline(DL_RELEASE, now + RECOIL_LEASE_MS);
}

static uint16_t continuous_budget(int64_t now)
{
	int64_t used;

	if (out.state != ST_PULSE && out.state != ST_LEASE) {
		return RECOIL_MAX_CONTINUOUS_ON_MS;
	}
	used = now - out.on_since;
	if (used >= RECOIL_MAX_CONTINUOUS_ON_MS) {
		return 0;
	}
	return (uint16_t)(RECOIL_MAX_CONTINUOUS_ON_MS - used);
}

static void force_thermal(int64_t now)
{
	out.pending_pulse = false;
	out.pending_lease = false;
	out.flags |= RECOIL_FLAG_THERMAL;
	enter_cool(now, RECOIL_THERMAL_COOL_MS);
}

static void finish_deadline(int64_t now)
{
	if (out.kind == DL_NONE || now < out.deadline) {
		return;
	}
	if (out.kind == DL_RELEASE) {
		enter_cool(now, RECOIL_MIN_OFF_MS);
		return;
	}
	out.kind = DL_NONE;
	if (out.pending_pulse) {
		uint16_t ms = out.pending_ms;
		out.pending_pulse = false;
		out.pending_lease = false;
		start_pulse(now, ms);
		return;
	}
	if (out.pending_lease) {
		out.pending_lease = false;
		start_lease(now);
		return;
	}
	out.state = ST_IDLE;
}

static void accept_seq(const struct recoil_tx_packet *packet)
{
	out.last_seq = packet->sequence;
	out.have_seq = true;
	out.last_cmd = packet->command;
}

static void handle_packet(const struct recoil_tx_packet *packet)
{
	int64_t now = k_uptime_get();
	bool clamped = false;
	uint16_t duration_ms;
	uint16_t budget;

	out.flags = 0;
	finish_deadline(now);
	now = k_uptime_get();

	if (packet->output != 0) {
		out.flags |= RECOIL_FLAG_DROPPED;
		return;
	}
	if (out.have_seq && packet->sequence == out.last_seq) {
		out.flags |= RECOIL_FLAG_DUPLICATE;
		out.last_cmd = packet->command;
		return;
	}

	switch (packet->command) {
	case RECOIL_CMD_STOP:
	case RECOIL_CMD_OFF:
		out.pending_pulse = false;
		out.pending_lease = false;
		accept_seq(packet);
		if (out.state == ST_PULSE || out.state == ST_LEASE) {
			enter_cool(now, RECOIL_MIN_OFF_MS);
		}
		break;

	case RECOIL_CMD_PING:
		accept_seq(packet);
		break;

	case RECOIL_CMD_PULSE:
		duration_ms = recoil_clamp_pulse_ms(packet->duration_ms, &clamped);
		if (clamped) {
			out.flags |= RECOIL_FLAG_CLAMPED;
		}
		accept_seq(packet);
		if (out.state == ST_COOL) {
			out.pending_pulse = true;
			out.pending_ms = duration_ms;
			out.pending_lease = false;
			break;
		}
		budget = continuous_budget(now);
		if (budget < RECOIL_MIN_PULSE_MS) {
			force_thermal(now);
			break;
		}
		if (duration_ms > budget) {
			duration_ms = budget;
			out.flags |= RECOIL_FLAG_CLAMPED;
		}
		start_pulse(now, duration_ms);
		break;

	case RECOIL_CMD_ON:
		accept_seq(packet);
		if (out.state == ST_COOL) {
			out.pending_lease = true;
			out.pending_pulse = false;
			break;
		}
		budget = continuous_budget(now);
		if (budget == 0) {
			force_thermal(now);
			break;
		}
		start_lease(now);
		break;

	default:
		out.flags |= RECOIL_FLAG_DROPPED;
		break;
	}
}

static void event_handler(const struct esb_evt *event)
{
	if (event->evt_id == ESB_EVENT_RX_RECEIVED) {
		k_sem_give(&packet_sem);
	}
}

static void drain_packets(void)
{
	struct esb_payload payload;
	struct recoil_tx_packet packet;

	while (esb_read_rx_payload(&payload) == 0) {
		if (!recoil_unpack_tx(payload.data, payload.length, &packet)) {
			continue;
		}
		handle_packet(&packet);
		preload_ack();
	}
}

static void blink(int times)
{
	for (int i = 0; i < times; i++) {
		gpio_pin_set_dt(&led, 1);
		k_sleep(K_MSEC(60));
		gpio_pin_set_dt(&led, 0);
		k_sleep(K_MSEC(60));
	}
}

static void fail_safe_halt(void)
{
	drive(false);
	while (1) {
		gpio_pin_toggle_dt(&led);
		k_sleep(K_MSEC(80));
	}
}

static void watchdog_start(void)
{
	struct wdt_timeout_cfg cfg = {
		.window = {.min = 0, .max = 2000},
		.callback = NULL,
		.flags = WDT_FLAG_RESET_SOC,
	};

	wdt_dev = DEVICE_DT_GET_OR_NULL(DT_NODELABEL(wdt));
	if (wdt_dev == NULL || !device_is_ready(wdt_dev)) {
		wdt_dev = NULL;
		return;
	}
	wdt_channel = wdt_install_timeout(wdt_dev, &cfg);
	if (wdt_channel < 0) {
		wdt_dev = NULL;
		return;
	}
	if (wdt_setup(wdt_dev, WDT_OPT_PAUSE_HALTED_BY_DBG) != 0) {
		wdt_dev = NULL;
	}
}

static void watchdog_feed(void)
{
	if (wdt_dev != NULL && wdt_channel >= 0) {
		(void)wdt_feed(wdt_dev, wdt_channel);
	}
}

int main(void)
{
	int err;

	if (!gpio_is_ready_dt(&gate) || !gpio_is_ready_dt(&led)) {
		return 0;
	}
	gpio_pin_configure_dt(&gate, GPIO_OUTPUT_INACTIVE);
	gpio_pin_configure_dt(&led, GPIO_OUTPUT_INACTIVE);
	drive(false);

	if (!recoil_protocol_self_test()) {
		fail_safe_halt();
	}
	blink(3);

	err = clocks_start();
	if (err) {
		fail_safe_halt();
	}
	err = recoil_esb_init(true, event_handler);
	if (err) {
		fail_safe_halt();
	}
	preload_ack();
	err = esb_start_rx();
	if (err) {
		fail_safe_halt();
	}
	watchdog_start();

	while (1) {
		(void)k_sem_take(&packet_sem, K_MSEC(5));
		watchdog_feed();
		finish_deadline(k_uptime_get());
		drain_packets();
		if (out.state == ST_PULSE || out.state == ST_LEASE) {
			gpio_pin_set_dt(&led, 1);
		} else {
			gpio_pin_set_dt(&led, 0);
		}
	}
	return 0;
}

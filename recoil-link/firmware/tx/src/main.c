/*
 * Recoil Link USB dongle (primary transmitter).
 *
 * Speaks a one-line ASCII protocol on USB CDC and forwards each command as
 * one ESB packet. A shot is a single PULSE: this side does not retry a
 * failed pulse, because the receiver may already have started its timer.
 * ON/OFF/STOP may be retried by the host; the receiver treats them as
 * idempotent.
 *
 *   PULSE <output> <ms>
 *   ON <output>
 *   OFF <output>
 *   STOP
 *   PING
 *
 * Success:
 *   OK <seq> <state> <mv> <flags> <ack_seq>
 * state, flags, and ack_seq come from the ack payload, which describes the
 * previous command. seq is the command just sent. mv is reserved and is 0.
 */

#include "recoil_radio.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <zephyr/device.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/drivers/watchdog.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/onoff.h>
#include <zephyr/drivers/clock_control.h>
#include <zephyr/drivers/clock_control/nrf_clock_control.h>
#include <zephyr/usb/usb_device.h>

/* Custom recoil_dongle board uses status_led / cdc_acm_uart0.
 * Stock PCA10059 (nrf52840dongle) uses led1 (red) / cdc_acm_uart.
 */
#if DT_NODE_EXISTS(DT_NODELABEL(status_led))
#define LED_NODE DT_NODELABEL(status_led)
#elif DT_NODE_EXISTS(DT_ALIAS(led1))
#define LED_NODE DT_ALIAS(led1)
#else
#define LED_NODE DT_ALIAS(led0)
#endif

#if DT_NODE_EXISTS(DT_NODELABEL(cdc_acm_uart0))
#define CDC_NODE DT_NODELABEL(cdc_acm_uart0)
#else
#define CDC_NODE DT_NODELABEL(cdc_acm_uart)
#endif

static const struct device *const usb_uart = DEVICE_DT_GET(CDC_NODE);
static const struct gpio_dt_spec led = GPIO_DT_SPEC_GET(LED_NODE, gpios);

static K_SEM_DEFINE(tx_done, 0, 1);
static volatile int tx_result;
static uint8_t last_ack[RECOIL_PACKET_LEN];
static volatile bool have_ack;
static uint16_t next_seq = 1;
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

static void event_handler(const struct esb_evt *event)
{
	if (event->evt_id == ESB_EVENT_TX_SUCCESS) {
		struct esb_payload rx;
		have_ack = false;
		while (esb_read_rx_payload(&rx) == 0) {
			if (rx.length >= RECOIL_PACKET_LEN) {
				memcpy(last_ack, rx.data, RECOIL_PACKET_LEN);
				have_ack = true;
			}
		}
		tx_result = 1;
		k_sem_give(&tx_done);
	} else if (event->evt_id == ESB_EVENT_TX_FAILED) {
		tx_result = -1;
		k_sem_give(&tx_done);
	}
}

static void cdc_write(const char *text)
{
	for (size_t i = 0; text[i] != '\0'; i++) {
		uart_poll_out(usb_uart, text[i]);
	}
}

static void reply_err(const char *name)
{
	char line[32];
	snprintf(line, sizeof(line), "ERR %s\n", name);
	cdc_write(line);
}

static void reply_ok(uint16_t seq)
{
	struct recoil_ack_packet ack;
	unsigned state = 0;
	unsigned flags = 0;
	unsigned ack_seq = 0;
	char line[64];

	if (have_ack && recoil_unpack_ack(last_ack, RECOIL_PACKET_LEN, &ack)) {
		state = ack.state ? 1 : 0;
		flags = ack.flags;
		ack_seq = ack.sequence;
	}
	snprintf(line, sizeof(line), "OK %u %u 0 %u %u\n", seq, state, flags, ack_seq);
	cdc_write(line);
}

static int send_radio(const struct recoil_tx_packet *packet)
{
	uint8_t raw[RECOIL_PACKET_LEN];
	int err;

	while (k_sem_take(&tx_done, K_NO_WAIT) == 0) {
	}
	have_ack = false;
	tx_result = 0;
	recoil_pack_tx(packet, raw);
	(void)esb_flush_tx();
	err = recoil_write_payload(raw);
	if (err) {
		return err;
	}
	if (k_sem_take(&tx_done, K_MSEC(20)) != 0) {
		(void)esb_flush_tx();
		return -ETIMEDOUT;
	}
	return tx_result > 0 ? 0 : -EIO;
}

static bool parse_u16(const char *text, uint16_t *out)
{
	char *end = NULL;
	unsigned long value;

	if (text == NULL || *text == '\0') {
		return false;
	}
	value = strtoul(text, &end, 10);
	if (end == text || *end != '\0' || value > 65535UL) {
		return false;
	}
	*out = (uint16_t)value;
	return true;
}

static void handle_line(char *line)
{
	char *save = NULL;
	char *word;
	char *arg1;
	char *arg2;
	struct recoil_tx_packet packet = {0};
	uint16_t output = 0;
	uint16_t duration = 0;
	uint16_t seq;
	int err;

	for (char *p = line; *p != '\0'; p++) {
		if (*p == '\r') {
			*p = '\0';
			break;
		}
	}
	word = strtok_r(line, " ", &save);
	if (word == NULL || word[0] == '\0') {
		return;
	}
	for (char *p = word; *p != '\0'; p++) {
		if (*p >= 'a' && *p <= 'z') {
			*p = (char)(*p - 'a' + 'A');
		}
	}
	arg1 = strtok_r(NULL, " ", &save);
	arg2 = strtok_r(NULL, " ", &save);

	if (strcmp(word, "PING") == 0) {
		packet.command = RECOIL_CMD_PING;
	} else if (strcmp(word, "STOP") == 0) {
		packet.command = RECOIL_CMD_STOP;
	} else if (strcmp(word, "ON") == 0) {
		packet.command = RECOIL_CMD_ON;
		if (!parse_u16(arg1, &output)) {
			reply_err("BAD_ARG");
			return;
		}
	} else if (strcmp(word, "OFF") == 0) {
		packet.command = RECOIL_CMD_OFF;
		if (!parse_u16(arg1, &output)) {
			reply_err("BAD_ARG");
			return;
		}
	} else if (strcmp(word, "PULSE") == 0) {
		bool clamped = false;
		packet.command = RECOIL_CMD_PULSE;
		if (!parse_u16(arg1, &output) || !parse_u16(arg2, &duration)) {
			reply_err("BAD_ARG");
			return;
		}
		duration = recoil_clamp_pulse_ms(duration, &clamped);
	} else {
		reply_err("BAD_CMD");
		return;
	}

	if (output != 0) {
		reply_err("BAD_ARG");
		return;
	}

	seq = next_seq;
	if (next_seq == 65535) {
		next_seq = 1;
	} else {
		next_seq++;
	}
	packet.output = 0;
	packet.sequence = seq;
	packet.duration_ms = duration;

	gpio_pin_set_dt(&led, 1);
	err = send_radio(&packet);
	gpio_pin_set_dt(&led, 0);
	if (err == -ETIMEDOUT || err == -EIO) {
		reply_err("TIMEOUT");
		return;
	}
	if (err) {
		reply_err("RADIO");
		return;
	}
	reply_ok(seq);
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
	char line[64];
	size_t used = 0;
	int err;

	if (gpio_is_ready_dt(&led)) {
		gpio_pin_configure_dt(&led, GPIO_OUTPUT_INACTIVE);
	}
	if (!recoil_protocol_self_test() || !device_is_ready(usb_uart)) {
		while (1) {
			if (gpio_is_ready_dt(&led)) {
				gpio_pin_toggle_dt(&led);
			}
			k_sleep(K_MSEC(80));
		}
	}

	err = usb_enable(NULL);
	if (err && err != -EALREADY) {
		return 0;
	}
	err = clocks_start();
	if (err) {
		return 0;
	}
	err = recoil_esb_init(false, event_handler);
	if (err) {
		return 0;
	}
	watchdog_start();

	while (1) {
		uint8_t byte;
		watchdog_feed();
		if (uart_poll_in(usb_uart, &byte) != 0) {
			k_sleep(K_MSEC(1));
			continue;
		}
		if (byte == '\n') {
			line[used] = '\0';
			used = 0;
			handle_line(line);
			continue;
		}
		if (used + 1 < sizeof(line)) {
			line[used++] = (char)byte;
		} else {
			used = 0;
			reply_err("BAD_CMD");
		}
	}
	return 0;
}

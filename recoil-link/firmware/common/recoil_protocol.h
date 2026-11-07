/*
 * Recoil Link radio packet and the limits the receiver enforces.
 *
 * The Python module modern_third_space.recoil_link.protocol mirrors this
 * layout. recoil_protocol_self_test() checks the frozen vectors at boot and
 * refuses to arm the MOSFET if they do not match.
 *
 * TX packet (dongle -> receiver), 12 bytes:
 *   0     magic 0xA5
 *   1     version
 *   2     command
 *   3     output index
 *   4..5  sequence, little-endian
 *   6..7  pulse duration in milliseconds, little-endian (0 unless PULSE)
 *   8..10 reserved 0
 *   11    XOR of bytes 0..10
 *
 * ACK packet (receiver -> dongle, carried in the ESB ack payload):
 *   0     magic 0x5A
 *   1     version
 *   2     last command accepted
 *   3     output state (0 off, 1 energized)
 *   4..5  sequence of that command, little-endian
 *   6     flags
 *   7..10 reserved 0
 *   11    XOR of bytes 0..10
 *
 * The hardware ack for a packet is loaded before that packet arrives, so the
 * ack payload describes the previous command. Delivery is TX_SUCCESS. The
 * payload is status, not the accept/reject bit for the packet in flight.
 */

#ifndef RECOIL_PROTOCOL_H
#define RECOIL_PROTOCOL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define RECOIL_PACKET_LEN 12
#define RECOIL_MAGIC_TX 0xA5
#define RECOIL_MAGIC_ACK 0x5A
#define RECOIL_VERSION 1

#define RECOIL_CMD_PULSE 1
#define RECOIL_CMD_ON 2
#define RECOIL_CMD_OFF 3
#define RECOIL_CMD_STOP 4
#define RECOIL_CMD_PING 5

#define RECOIL_FLAG_CLAMPED (1u << 0)
#define RECOIL_FLAG_DUPLICATE (1u << 1)
#define RECOIL_FLAG_DROPPED (1u << 2)
#define RECOIL_FLAG_THERMAL (1u << 3)

/* Receiver-enforced actuator limits for the JF-0826B at 12 V / ~2 A. */
#define RECOIL_MIN_PULSE_MS 5
#define RECOIL_MAX_PULSE_MS 100
#define RECOIL_MIN_OFF_MS 20
#define RECOIL_LEASE_MS 350
#define RECOIL_MAX_CONTINUOUS_ON_MS 1000
#define RECOIL_THERMAL_COOL_MS 500

/* 2476 MHz, above typical Wi-Fi channel 11. Both ends must match. */
#define RECOIL_RF_CHANNEL 76
#define RECOIL_RETRANSMIT_COUNT 2
#define RECOIL_RETRANSMIT_DELAY_US 600
#define RECOIL_ADDR_PREFIX 0xD2

struct recoil_tx_packet {
	uint8_t command;
	uint8_t output;
	uint16_t sequence;
	uint16_t duration_ms;
};

struct recoil_ack_packet {
	uint8_t command;
	uint8_t state;
	uint16_t sequence;
	uint8_t flags;
};

/* Frozen TX vector: PULSE output 0, seq 1, 25 ms. Checksum 0xBD. */
/* a5 01 01 00 01 00 19 00 00 00 00 bd */

void recoil_pack_tx(const struct recoil_tx_packet *packet, uint8_t out[RECOIL_PACKET_LEN]);
bool recoil_unpack_tx(const uint8_t *data, size_t len, struct recoil_tx_packet *out);

void recoil_pack_ack(const struct recoil_ack_packet *packet, uint8_t out[RECOIL_PACKET_LEN]);
bool recoil_unpack_ack(const uint8_t *data, size_t len, struct recoil_ack_packet *out);

bool recoil_protocol_self_test(void);

uint16_t recoil_clamp_pulse_ms(uint16_t duration_ms, bool *clamped);

#endif

#include "recoil_protocol.h"

#include <string.h>

static uint8_t recoil_xor(const uint8_t *data)
{
	uint8_t x = 0;
	for (int i = 0; i < RECOIL_PACKET_LEN - 1; i++) {
		x ^= data[i];
	}
	return x;
}

void recoil_pack_tx(const struct recoil_tx_packet *packet, uint8_t out[RECOIL_PACKET_LEN])
{
	memset(out, 0, RECOIL_PACKET_LEN);
	out[0] = RECOIL_MAGIC_TX;
	out[1] = RECOIL_VERSION;
	out[2] = packet->command;
	out[3] = packet->output;
	out[4] = (uint8_t)(packet->sequence & 0xFF);
	out[5] = (uint8_t)((packet->sequence >> 8) & 0xFF);
	out[6] = (uint8_t)(packet->duration_ms & 0xFF);
	out[7] = (uint8_t)((packet->duration_ms >> 8) & 0xFF);
	out[11] = recoil_xor(out);
}

bool recoil_unpack_tx(const uint8_t *data, size_t len, struct recoil_tx_packet *out)
{
	if (data == NULL || out == NULL || len < RECOIL_PACKET_LEN) {
		return false;
	}
	if (data[0] != RECOIL_MAGIC_TX || data[1] != RECOIL_VERSION) {
		return false;
	}
	if (data[11] != recoil_xor(data)) {
		return false;
	}
	if (data[2] < RECOIL_CMD_PULSE || data[2] > RECOIL_CMD_PING) {
		return false;
	}
	out->command = data[2];
	out->output = data[3];
	out->sequence = (uint16_t)data[4] | ((uint16_t)data[5] << 8);
	out->duration_ms = (uint16_t)data[6] | ((uint16_t)data[7] << 8);
	return true;
}

void recoil_pack_ack(const struct recoil_ack_packet *packet, uint8_t out[RECOIL_PACKET_LEN])
{
	memset(out, 0, RECOIL_PACKET_LEN);
	out[0] = RECOIL_MAGIC_ACK;
	out[1] = RECOIL_VERSION;
	out[2] = packet->command;
	out[3] = packet->state;
	out[4] = (uint8_t)(packet->sequence & 0xFF);
	out[5] = (uint8_t)((packet->sequence >> 8) & 0xFF);
	out[6] = packet->flags;
	out[11] = recoil_xor(out);
}

bool recoil_unpack_ack(const uint8_t *data, size_t len, struct recoil_ack_packet *out)
{
	if (data == NULL || out == NULL || len < RECOIL_PACKET_LEN) {
		return false;
	}
	if (data[0] != RECOIL_MAGIC_ACK || data[1] != RECOIL_VERSION) {
		return false;
	}
	if (data[11] != recoil_xor(data)) {
		return false;
	}
	out->command = data[2];
	out->state = data[3];
	out->sequence = (uint16_t)data[4] | ((uint16_t)data[5] << 8);
	out->flags = data[6];
	return true;
}

uint16_t recoil_clamp_pulse_ms(uint16_t duration_ms, bool *clamped)
{
	uint16_t clamped_ms = duration_ms;
	if (clamped_ms < RECOIL_MIN_PULSE_MS) {
		clamped_ms = RECOIL_MIN_PULSE_MS;
	}
	if (clamped_ms > RECOIL_MAX_PULSE_MS) {
		clamped_ms = RECOIL_MAX_PULSE_MS;
	}
	if (clamped != NULL) {
		*clamped = clamped_ms != duration_ms;
	}
	return clamped_ms;
}

bool recoil_protocol_self_test(void)
{
	static const uint8_t expect_tx[RECOIL_PACKET_LEN] = {
		0xA5, 0x01, 0x01, 0x00, 0x01, 0x00, 0x19, 0x00, 0x00, 0x00, 0x00, 0xBD,
	};
	static const uint8_t expect_ack[RECOIL_PACKET_LEN] = {
		0x5A, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x5A,
	};
	struct recoil_tx_packet tx = {
		.command = RECOIL_CMD_PULSE,
		.output = 0,
		.sequence = 1,
		.duration_ms = 25,
	};
	struct recoil_ack_packet ack = {
		.command = RECOIL_CMD_PULSE,
		.state = 1,
		.sequence = 1,
		.flags = 0,
	};
	uint8_t raw[RECOIL_PACKET_LEN];
	struct recoil_tx_packet tx_out;
	struct recoil_ack_packet ack_out;

	recoil_pack_tx(&tx, raw);
	if (memcmp(raw, expect_tx, RECOIL_PACKET_LEN) != 0) {
		return false;
	}
	if (!recoil_unpack_tx(raw, RECOIL_PACKET_LEN, &tx_out)) {
		return false;
	}
	if (tx_out.command != RECOIL_CMD_PULSE || tx_out.duration_ms != 25 || tx_out.sequence != 1) {
		return false;
	}

	recoil_pack_ack(&ack, raw);
	if (memcmp(raw, expect_ack, RECOIL_PACKET_LEN) != 0) {
		return false;
	}
	if (!recoil_unpack_ack(raw, RECOIL_PACKET_LEN, &ack_out)) {
		return false;
	}
	return ack_out.state == 1 && ack_out.sequence == 1;
}

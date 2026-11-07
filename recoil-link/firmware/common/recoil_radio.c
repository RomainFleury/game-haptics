#include "recoil_radio.h"

#include <esb.h>
#include <errno.h>

int recoil_esb_init(bool primary_receiver, esb_event_handler handler)
{
	int err;
	uint8_t base_addr_0[4] = {0xA5, 0x3C, 0x91, 0x6E};
	uint8_t base_addr_1[4] = {0xC2, 0xC2, 0xC2, 0xC2};
	uint8_t prefixes[1] = {RECOIL_ADDR_PREFIX};
	struct esb_config config = ESB_DEFAULT_CONFIG;

	config.protocol = ESB_PROTOCOL_ESB_DPL;
	config.bitrate = ESB_BITRATE_2MBPS;
	config.crc = ESB_CRC_16BIT;
	config.mode = primary_receiver ? ESB_MODE_PRX : ESB_MODE_PTX;
	config.event_handler = handler;
	config.retransmit_count = RECOIL_RETRANSMIT_COUNT;
	config.retransmit_delay = RECOIL_RETRANSMIT_DELAY_US;
	config.tx_output_power = 0;
	config.selective_auto_ack = false;
	config.use_fast_ramp_up = true;
	config.payload_length = RECOIL_PACKET_LEN;

	err = esb_init(&config);
	if (err) {
		return err;
	}

	err = esb_set_base_address_0(base_addr_0);
	if (err) {
		return err;
	}
	err = esb_set_base_address_1(base_addr_1);
	if (err) {
		return err;
	}
	err = esb_set_prefixes(prefixes, 1);
	if (err) {
		return err;
	}
	err = esb_set_rf_channel(RECOIL_RF_CHANNEL);
	if (err) {
		return err;
	}
	err = esb_set_tx_power(0);
	if (err) {
		return err;
	}
	return 0;
}

int recoil_write_payload(const uint8_t raw[RECOIL_PACKET_LEN])
{
	struct esb_payload payload = {0};

	payload.length = RECOIL_PACKET_LEN;
	payload.pipe = 0;
	payload.noack = 0;
	memcpy(payload.data, raw, RECOIL_PACKET_LEN);
	return esb_write_payload(&payload);
}

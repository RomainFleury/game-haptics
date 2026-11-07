#ifndef RECOIL_RADIO_H
#define RECOIL_RADIO_H

#include "recoil_protocol.h"

#include <esb.h>
#include <stdbool.h>
#include <string.h>

int recoil_esb_init(bool primary_receiver, esb_event_handler handler);
int recoil_write_payload(const uint8_t raw[RECOIL_PACKET_LEN]);

#endif

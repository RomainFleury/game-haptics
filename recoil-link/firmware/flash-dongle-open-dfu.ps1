# LEGACY / WRONG TARGET FOR THIS BENCH
#
# This script installs a *Makerdiary* UF2 bootloader over Open DFU.
# Lab emitter on hand is Nordic PCA10059 — see ../LAB_HARDWARE.md.
# Do NOT run this against the blue Nordic dongle.
#
# PCA10059 flash (correct shape):
#   1. Press sideways RESET → red LED pulse → note COMx (VID 1915:521F)
#   2. nrfutil pkg generate --hw-version 52 --sd-req 0x00 `
#        --application path\to\zephyr.hex --application-version 1 recoil-dongle-dfu.zip
#   3. python -m nordicsemi dfu serial -pkg recoil-dongle-dfu.zip -p COMx -b 115200
#
# Kept only so nobody reintroduces Makerdiary-only UF2BOOT steps by mistake.

Write-Error "Refusing to run: lab emitter is PCA10059, not Makerdiary. See recoil-link/LAB_HARDWARE.md"
exit 1

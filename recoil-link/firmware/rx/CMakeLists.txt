cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(recoil_rx)

target_sources(app PRIVATE
  src/main.c
  ../common/recoil_protocol.c
  ../common/recoil_radio.c
)
if (CONFIG_BOARD_RECOIL_RECEIVER)
  target_sources(app PRIVATE ../common/softdevice_release.c)
endif()
target_include_directories(app PRIVATE ../common)

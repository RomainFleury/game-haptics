cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(recoil_tx)

target_sources(app PRIVATE
  src/main.c
  ../common/recoil_protocol.c
  ../common/recoil_radio.c
)
target_include_directories(app PRIVATE ../common)

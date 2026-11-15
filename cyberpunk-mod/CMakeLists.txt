cmake_minimum_required(VERSION 3.21)
project(TSC_Cyberpunk LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Point at a local clone of https://github.com/WopsS/RED4ext.SDK
set(RED4EXT_SDK_PATH "${CMAKE_CURRENT_SOURCE_DIR}/deps/RED4ext.SDK" CACHE PATH "Path to RED4ext.SDK")

if(NOT EXISTS "${RED4EXT_SDK_PATH}/CMakeLists.txt")
  message(FATAL_ERROR
    "RED4ext.SDK not found at ${RED4EXT_SDK_PATH}.\n"
    "Clone it: git clone https://github.com/WopsS/RED4ext.SDK.git deps/RED4ext.SDK")
endif()

# Use the SDK as a static library (matches official examples).
set(RED4EXT_HEADER_ONLY OFF CACHE BOOL "" FORCE)
set(RED4EXT_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(RED4EXT_INSTALL OFF CACHE BOOL "" FORCE)
add_subdirectory("${RED4EXT_SDK_PATH}" "${CMAKE_BINARY_DIR}/RED4ext.SDK" EXCLUDE_FROM_ALL)

add_library(TSC_Cyberpunk SHARED
  src/main.cpp
  src/natives.cpp
  src/daemon.cpp
  src/log.cpp
)

target_include_directories(TSC_Cyberpunk PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/src"
)

target_compile_definitions(TSC_Cyberpunk PRIVATE
  WIN32_LEAN_AND_MEAN
  NOMINMAX
  _CRT_SECURE_NO_WARNINGS
)

target_link_libraries(TSC_Cyberpunk PRIVATE
  RED4ext::SDK
  ws2_32
)

set_target_properties(TSC_Cyberpunk PROPERTIES
  OUTPUT_NAME "TSC_Cyberpunk"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin/x64/Release"
  RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/bin/x64/Debug"
)

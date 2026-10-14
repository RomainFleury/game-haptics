#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

namespace logging
{
    enum class Level : int
    {
        Debug = 0,
        Info  = 1,
        Warn  = 2,
        Error = 3,
    };

    // Public builds: Info. Set to Debug while developing the forwarder.
    constexpr Level kMinLevel = Level::Info;

    void Init(HMODULE northstarModule, HMODULE self);

    constexpr bool Enabled(Level level) { return level >= kMinLevel; }

    void Debug(_Printf_format_string_ const char* fmt, ...);
    void Info(_Printf_format_string_ const char* fmt, ...);
    void Warn(_Printf_format_string_ const char* fmt, ...);
    void Error(_Printf_format_string_ const char* fmt, ...);
}

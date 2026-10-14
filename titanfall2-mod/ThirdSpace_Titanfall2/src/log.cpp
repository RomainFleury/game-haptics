#include "log.h"
#include "northstar.h"

#include <cstdarg>
#include <cstdio>
#include <cstring>

namespace
{
    ns::ISys* g_sys = nullptr;
    int64_t   g_pluginHandle = 0;
    char      g_buf[1024];

    void Emit(logging::Level level, const char* msg)
    {
        if (g_sys)
        {
            ns::LogLevel nsLevel = ns::LogLevel::INFO;
            if (level == logging::Level::Warn)
                nsLevel = ns::LogLevel::WARN;
            else if (level == logging::Level::Error)
                nsLevel = ns::LogLevel::ERR;

            // Northstar's Log expects a mutable char*.
            char copy[1024];
            std::strncpy(copy, msg, sizeof(copy) - 1);
            copy[sizeof(copy) - 1] = '\0';
            g_sys->Log(g_pluginHandle, nsLevel, copy);
            return;
        }

        OutputDebugStringA("[THIRDSPACE] ");
        OutputDebugStringA(msg);
        OutputDebugStringA("\n");
    }

    void VLog(logging::Level level, const char* fmt, va_list args)
    {
        if (!logging::Enabled(level))
            return;
        std::vsnprintf(g_buf, sizeof(g_buf), fmt, args);
        Emit(level, g_buf);
    }
}

namespace logging
{
    void Init(HMODULE northstarModule, HMODULE self)
    {
        g_pluginHandle = reinterpret_cast<int64_t>(self);
        if (!northstarModule)
            return;

        auto create = reinterpret_cast<ns::CreateInterfaceFn>(
            GetProcAddress(northstarModule, "CreateInterface"));
        if (!create)
            return;

        int status = 1;
        g_sys = static_cast<ns::ISys*>(create(ns::SYS_VERSION, &status));
        if (status != 0)
            g_sys = nullptr;
    }

    void Debug(const char* fmt, ...)
    {
        va_list args;
        va_start(args, fmt);
        VLog(Level::Debug, fmt, args);
        va_end(args);
    }

    void Info(const char* fmt, ...)
    {
        va_list args;
        va_start(args, fmt);
        VLog(Level::Info, fmt, args);
        va_end(args);
    }

    void Warn(const char* fmt, ...)
    {
        va_list args;
        va_start(args, fmt);
        VLog(Level::Warn, fmt, args);
        va_end(args);
    }

    void Error(const char* fmt, ...)
    {
        va_list args;
        va_start(args, fmt);
        VLog(Level::Error, fmt, args);
        va_end(args);
    }
}

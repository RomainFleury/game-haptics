#include "log.h"

#include <cstdarg>
#include <cstdio>
#include <mutex>
#include <string>

namespace
{
    std::mutex g_mutex;
    FILE* g_file = nullptr;
    HMODULE g_self = nullptr;

    std::wstring PluginDir()
    {
        wchar_t path[MAX_PATH]{};
        if (!g_self || !GetModuleFileNameW(g_self, path, MAX_PATH))
            return L".";
        std::wstring full(path);
        const size_t slash = full.find_last_of(L"\\/");
        if (slash == std::wstring::npos)
            return L".";
        return full.substr(0, slash);
    }

    void Write(logging::Level level, const char* fmt, va_list args)
    {
        if (!logging::Enabled(level))
            return;

        char body[1024];
        vsnprintf(body, sizeof(body), fmt, args);

        const char* tag = "INFO";
        switch (level)
        {
            case logging::Level::Debug: tag = "DEBUG"; break;
            case logging::Level::Info:  tag = "INFO"; break;
            case logging::Level::Warn:  tag = "WARN"; break;
            case logging::Level::Error: tag = "ERROR"; break;
        }

        char line[1100];
        snprintf(line, sizeof(line), "[TSC][%s] %s\n", tag, body);

        OutputDebugStringA(line);

        std::lock_guard<std::mutex> lock(g_mutex);
        if (g_file)
        {
            fputs(line, g_file);
            fflush(g_file);
        }
    }
}

namespace logging
{
    void Init(HMODULE self)
    {
        g_self = self;
        const std::wstring dir = PluginDir();
        const std::wstring path = dir + L"\\TSC_Cyberpunk.log";
        _wfopen_s(&g_file, path.c_str(), L"a");
        Info("Logging started");
    }

    void Debug(const char* fmt, ...)
    {
        va_list args;
        va_start(args, fmt);
        Write(Level::Debug, fmt, args);
        va_end(args);
    }

    void Info(const char* fmt, ...)
    {
        va_list args;
        va_start(args, fmt);
        Write(Level::Info, fmt, args);
        va_end(args);
    }

    void Warn(const char* fmt, ...)
    {
        va_list args;
        va_start(args, fmt);
        Write(Level::Warn, fmt, args);
        va_end(args);
    }

    void Error(const char* fmt, ...)
    {
        va_list args;
        va_start(args, fmt);
        Write(Level::Error, fmt, args);
        va_end(args);
    }
}

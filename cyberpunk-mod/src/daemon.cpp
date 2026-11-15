#include "daemon.h"
#include "log.h"

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cctype>
#include <cstdio>
#include <deque>
#include <fstream>
#include <mutex>
#include <string>
#include <thread>

#pragma comment(lib, "ws2_32.lib")

namespace
{
    constexpr const char* kDefaultHost = "127.0.0.1";
    constexpr const char* kDefaultPort = "5050";
    constexpr size_t      kMaxQueue = 64;
    constexpr auto        kReconnectWait = std::chrono::seconds(3);
    constexpr auto        kIdlePoll = std::chrono::milliseconds(200);

    struct Outgoing
    {
        std::string line;
    };

    std::mutex              g_mutex;
    std::condition_variable g_wake;
    std::deque<Outgoing>    g_queue;
    bool                    g_stopRequested = false;
    size_t                  g_dropped = 0;

    std::thread*           g_worker = nullptr;
    std::atomic<bool>      g_running{ false };
    std::atomic<bool>      g_workerExited{ true };
    std::atomic<bool>      g_connected{ false };

    std::string g_host = kDefaultHost;
    std::string g_port = kDefaultPort;

    std::string ToLower(const char* s)
    {
        std::string out(s ? s : "");
        for (char& c : out)
            c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        return out;
    }

    std::string JsonEscape(const std::string& s)
    {
        std::string out;
        out.reserve(s.size() + 8);
        for (char c : s)
        {
            switch (c)
            {
                case '\\': out += "\\\\"; break;
                case '"':  out += "\\\""; break;
                case '\n': out += "\\n"; break;
                case '\r': out += "\\r"; break;
                default:   out += c; break;
            }
        }
        return out;
    }

    void PushLine(std::string&& line)
    {
        {
            std::lock_guard<std::mutex> lock(g_mutex);
            if (g_queue.size() >= kMaxQueue)
            {
                g_queue.pop_front();
                ++g_dropped;
            }
            g_queue.push_back(Outgoing{ std::move(line) });
        }
        g_wake.notify_one();
    }

    std::wstring PluginDirFromModule()
    {
        HMODULE self = nullptr;
        if (!GetModuleHandleExW(
                GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                reinterpret_cast<LPCWSTR>(&PluginDirFromModule),
                &self) ||
            !self)
        {
            return L".";
        }
        wchar_t path[MAX_PATH]{};
        if (!GetModuleFileNameW(self, path, MAX_PATH))
            return L".";
        std::wstring full(path);
        const size_t slash = full.find_last_of(L"\\/");
        if (slash == std::wstring::npos)
            return L".";
        return full.substr(0, slash);
    }

    void LoadConfig()
    {
        g_host = kDefaultHost;
        g_port = kDefaultPort;

        const std::wstring cfgPath = PluginDirFromModule() + L"\\TSC_Config.txt";
        std::ifstream in(cfgPath);
        if (!in)
            return;

        std::string line;
        if (!std::getline(in, line))
            return;

        // Trim
        while (!line.empty() && (line.back() == '\r' || line.back() == ' ' || line.back() == '\t'))
            line.pop_back();
        size_t start = 0;
        while (start < line.size() && (line[start] == ' ' || line[start] == '\t'))
            ++start;
        line = line.substr(start);
        if (line.empty())
            return;

        const size_t colon = line.find(':');
        if (colon == std::string::npos)
        {
            g_host = line;
        }
        else
        {
            g_host = line.substr(0, colon);
            g_port = line.substr(colon + 1);
        }
        logging::Info("Config host=%s port=%s", g_host.c_str(), g_port.c_str());
    }

    bool ConnectSocket(SOCKET& outSock)
    {
        addrinfo hints{};
        hints.ai_family = AF_UNSPEC;
        hints.ai_socktype = SOCK_STREAM;
        hints.ai_protocol = IPPROTO_TCP;

        addrinfo* result = nullptr;
        if (getaddrinfo(g_host.c_str(), g_port.c_str(), &hints, &result) != 0 || !result)
            return false;

        SOCKET sock = INVALID_SOCKET;
        for (addrinfo* ptr = result; ptr != nullptr; ptr = ptr->ai_next)
        {
            sock = socket(ptr->ai_family, ptr->ai_socktype, ptr->ai_protocol);
            if (sock == INVALID_SOCKET)
                continue;
            if (connect(sock, ptr->ai_addr, static_cast<int>(ptr->ai_addrlen)) == 0)
                break;
            closesocket(sock);
            sock = INVALID_SOCKET;
        }
        freeaddrinfo(result);

        if (sock == INVALID_SOCKET)
            return false;

        DWORD timeoutMs = 500;
        setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<const char*>(&timeoutMs), sizeof(timeoutMs));
        setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&timeoutMs), sizeof(timeoutMs));
        outSock = sock;
        return true;
    }

    bool SendAll(SOCKET sock, const std::string& line)
    {
        const char* data = line.c_str();
        size_t left = line.size();
        while (left > 0)
        {
            const int n = send(sock, data, static_cast<int>(left), 0);
            if (n <= 0)
                return false;
            data += n;
            left -= static_cast<size_t>(n);
        }
        return true;
    }

    void WorkerMain()
    {
        WSADATA wsa{};
        if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0)
        {
            logging::Error("Winsock init failed");
            g_running.store(false);
            g_workerExited.store(true);
            return;
        }

        SOCKET sock = INVALID_SOCKET;
        auto nextConnect = std::chrono::steady_clock::now();

        while (true)
        {
            std::deque<Outgoing> batch;
            size_t dropped = 0;
            {
                std::unique_lock<std::mutex> lock(g_mutex);
                g_wake.wait_for(lock, kIdlePoll, [] { return g_stopRequested || !g_queue.empty(); });
                if (g_stopRequested)
                    break;
                batch.swap(g_queue);
                dropped = g_dropped;
                g_dropped = 0;
            }

            if (dropped > 0)
                logging::Debug("Dropped %zu queued daemon event(s)", dropped);

            if (sock == INVALID_SOCKET)
            {
                const auto now = std::chrono::steady_clock::now();
                if (now >= nextConnect)
                {
                    if (ConnectSocket(sock))
                    {
                        g_connected.store(true);
                        logging::Info("Connected to Third Space daemon at %s:%s", g_host.c_str(), g_port.c_str());
                    }
                    else
                    {
                        g_connected.store(false);
                        nextConnect = now + kReconnectWait;
                    }
                }
            }

            if (sock == INVALID_SOCKET)
                continue;

            for (const Outgoing& item : batch)
            {
                if (!SendAll(sock, item.line))
                {
                    logging::Warn("Lost daemon connection, will reconnect");
                    closesocket(sock);
                    sock = INVALID_SOCKET;
                    g_connected.store(false);
                    nextConnect = std::chrono::steady_clock::now() + kReconnectWait;
                    break;
                }
            }
        }

        if (sock != INVALID_SOCKET)
            closesocket(sock);
        g_connected.store(false);
        WSACleanup();
        g_workerExited.store(true);
    }
}

namespace daemon_tcp
{
    void SendEvent(const char* eventName,
                   const char* hand,
                   const char* weapon,
                   float intensity,
                   float angle)
    {
        if (!eventName || !*eventName || !g_running.load())
            return;

        std::string line = "{\"cmd\":\"cyberpunk_event\",\"event\":\"";
        line += JsonEscape(ToLower(eventName));
        line += '"';

        if (hand && *hand)
        {
            line += ",\"hand\":\"";
            line += JsonEscape(ToLower(hand));
            line += '"';
        }
        if (weapon && *weapon)
        {
            line += ",\"weapon\":\"";
            line += JsonEscape(ToLower(weapon));
            line += '"';
        }
        if (intensity >= 0.0f)
        {
            char buf[32];
            std::snprintf(buf, sizeof(buf), ",\"intensity\":%.3f", intensity);
            line += buf;
        }
        if (angle >= 0.0f)
        {
            char buf[32];
            std::snprintf(buf, sizeof(buf), ",\"angle\":%.1f", angle);
            line += buf;
        }
        line += "}\n";

        logging::Debug("Queue %s", line.c_str());
        PushLine(std::move(line));
    }

    void Play(const char* eventName)
    {
        SendEvent(eventName);
    }

    void Kick(const char* eventName, const char* weapon, const char* hand)
    {
        SendEvent(eventName, hand, weapon);
    }

    void Hit(float angle, float intensity)
    {
        SendEvent("player_hit", nullptr, nullptr, intensity, angle);
    }

    void Startup()
    {
        if (g_running.load())
            return;

        LoadConfig();

        {
            std::lock_guard<std::mutex> lock(g_mutex);
            g_stopRequested = false;
            g_queue.clear();
            g_dropped = 0;
        }
        g_workerExited.store(false);
        g_running.store(true);
        g_worker = new std::thread(WorkerMain);
    }

    bool IsConnected()
    {
        return g_running.load() && g_connected.load();
    }

    bool Shutdown()
    {
        if (!g_worker)
            return true;

        g_running.store(false);
        {
            std::lock_guard<std::mutex> lock(g_mutex);
            g_stopRequested = true;
            g_queue.clear();
        }
        g_wake.notify_one();

        const ULONGLONG deadline = GetTickCount64() + 2000;
        while (!g_workerExited.load() && GetTickCount64() < deadline)
            Sleep(10);

        if (!g_workerExited.load())
        {
            logging::Warn("Daemon worker did not stop in time, keeping plugin loaded");
            g_worker->detach();
            g_worker = nullptr;
            return false;
        }

        g_worker->join();
        delete g_worker;
        g_worker = nullptr;
        return true;
    }
}

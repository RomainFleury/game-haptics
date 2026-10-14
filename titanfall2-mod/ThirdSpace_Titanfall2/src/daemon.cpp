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
#include <deque>
#include <mutex>
#include <string>
#include <thread>

#pragma comment(lib, "ws2_32.lib")

namespace
{
    constexpr const char* kHost = "127.0.0.1";
    constexpr const char* kPort = "5050";
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

    bool ConnectSocket(SOCKET& outSock)
    {
        addrinfo hints{};
        hints.ai_family = AF_UNSPEC;
        hints.ai_socktype = SOCK_STREAM;
        hints.ai_protocol = IPPROTO_TCP;

        addrinfo* result = nullptr;
        if (getaddrinfo(kHost, kPort, &hints, &result) != 0 || !result)
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

        // Non-blocking-ish send timeouts so a hung daemon cannot stall forever.
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
                        logging::Info("Connected to Third Space daemon at %s:%s", kHost, kPort);
                    }
                    else
                    {
                        g_connected.store(false);
                        nextConnect = now + kReconnectWait;
                    }
                }
            }

            if (sock == INVALID_SOCKET)
            {
                // Keep the newest events; drop this batch if we never connect.
                continue;
            }

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
                   const char* group,
                   const char* weapon,
                   float intensity,
                   float angle)
    {
        if (!eventName || !*eventName || !g_running.load())
            return;

        std::string line = "{\"cmd\":\"titanfall2_event\",\"event\":\"";
        line += JsonEscape(ToLower(eventName));
        line += '"';

        if (hand && *hand)
        {
            line += ",\"hand\":\"";
            line += JsonEscape(ToLower(hand));
            line += '"';
        }
        if (group && *group)
        {
            line += ",\"group\":\"";
            line += JsonEscape(ToLower(group));
            line += '"';
        }
        if (weapon && *weapon)
        {
            line += ",\"weapon\":\"";
            line += JsonEscape(weapon);
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

    void PlayParam(const char* eventName, float intensity, float /*duration*/, float angleX, float /*offsetY*/)
    {
        // duration/offsetY are bHaptics-only; vest mapping uses intensity + angle.
        SendEvent(eventName, nullptr, nullptr, nullptr, intensity, angleX);
    }

    void Kick(const char* weaponClass, const char* group, const char* hand)
    {
        SendEvent("gun_fire", hand, group, weaponClass);
    }

    void Charge(float fraction, const char* hand)
    {
        SendEvent("charge", hand, nullptr, nullptr, fraction);
    }

    void Rumble(float power, float /*seconds*/)
    {
        // Titan primary / rockets from the optional gun script.
        SendEvent("recoil_titan", nullptr, nullptr, nullptr, power);
    }

    void Startup()
    {
        if (g_running.load())
            return;

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

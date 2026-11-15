#pragma once
//
// daemon.h - TCP client for the Third Space Vest daemon (default 127.0.0.1:5050).
//
// Sends newline-delimited JSON `cyberpunk_event` commands. Socket work runs on a
// worker thread so a stalled daemon cannot freeze the game.
//

namespace daemon_tcp
{
    void Startup();
    bool Shutdown();

    // True if a TCP session is open (cached).
    bool IsConnected();

    // Queue a cyberpunk_event. Optional fields omitted when null / negative.
    void SendEvent(const char* eventName,
                   const char* hand = nullptr,
                   const char* weapon = nullptr,
                   float intensity = -1.0f,
                   float angle = -1.0f);

    void Play(const char* eventName);
    void Kick(const char* eventName, const char* weapon, const char* hand);
    void Hit(float angle, float intensity);
}

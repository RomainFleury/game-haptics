#pragma once
//
// daemon.h - TCP client for the Third Space Vest daemon (127.0.0.1:5050).
//
// Sends newline-delimited JSON commands. All socket work runs on a worker
// thread so a stalled daemon cannot freeze the game.
//

namespace daemon_tcp
{
    void Startup();
    bool Shutdown();

    // True if a TCP session is open (cached).
    bool IsConnected();

    // Queue a titanfall2_event. Hand / group / weapon / intensity / angle
    // are optional (pass nullptr / omit).
    void SendEvent(const char* eventName,
                   const char* hand = nullptr,
                   const char* group = nullptr,
                   const char* weapon = nullptr,
                   float intensity = -1.0f,
                   float angle = -1.0f);

    // Convenience wrappers used by Squirrel natives.
    void Play(const char* eventName);
    void PlayParam(const char* eventName, float intensity, float duration, float angleX, float offsetY);
    void Kick(const char* weaponClass, const char* group, const char* hand);
    void Charge(float fraction, const char* hand);
    void Rumble(float power, float seconds);
}

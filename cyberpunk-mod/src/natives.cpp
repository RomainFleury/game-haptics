#include "daemon.h"
#include "log.h"
#include "natives.h"

#include <RED4ext/RED4ext.hpp>

namespace
{
    void NativePlay(RED4ext::IScriptable* aContext,
                    RED4ext::CStackFrame* aFrame,
                    void* aOut,
                    int64_t a4)
    {
        RED4EXT_UNUSED_PARAMETER(aContext);
        RED4EXT_UNUSED_PARAMETER(aOut);
        RED4EXT_UNUSED_PARAMETER(a4);

        RED4ext::CString eventName;
        RED4ext::GetParameter(aFrame, &eventName);
        aFrame->code++; // ParamEnd

        if (eventName.Length() > 0)
            daemon_tcp::Play(eventName.c_str());
    }

    void NativeKick(RED4ext::IScriptable* aContext,
                    RED4ext::CStackFrame* aFrame,
                    void* aOut,
                    int64_t a4)
    {
        RED4EXT_UNUSED_PARAMETER(aContext);
        RED4EXT_UNUSED_PARAMETER(aOut);
        RED4EXT_UNUSED_PARAMETER(a4);

        RED4ext::CString eventName;
        RED4ext::CString weapon;
        RED4ext::CString hand;
        RED4ext::GetParameter(aFrame, &eventName);
        RED4ext::GetParameter(aFrame, &weapon);
        RED4ext::GetParameter(aFrame, &hand);
        aFrame->code++;

        if (eventName.Length() > 0)
        {
            daemon_tcp::Kick(
                eventName.c_str(),
                weapon.Length() > 0 ? weapon.c_str() : nullptr,
                hand.Length() > 0 ? hand.c_str() : nullptr);
        }
    }

    void NativeHit(RED4ext::IScriptable* aContext,
                   RED4ext::CStackFrame* aFrame,
                   void* aOut,
                   int64_t a4)
    {
        RED4EXT_UNUSED_PARAMETER(aContext);
        RED4EXT_UNUSED_PARAMETER(aOut);
        RED4EXT_UNUSED_PARAMETER(a4);

        float angle = -1.0f;
        float intensity = 0.7f;
        RED4ext::GetParameter(aFrame, &angle);
        RED4ext::GetParameter(aFrame, &intensity);
        aFrame->code++;

        daemon_tcp::Hit(angle, intensity);
    }

    void RegisterTypes()
    {
    }

    void PostRegisterTypes()
    {
        auto* rtti = RED4ext::CRTTISystem::Get();
        if (!rtti)
        {
            logging::Error("CRTTISystem unavailable; natives not registered");
            return;
        }

        RED4ext::CBaseFunction::Flags flags = {.isNative = true, .isStatic = true};

        {
            auto* play = RED4ext::CGlobalFunction::Create("TSC_Play", "TSC_Play", &NativePlay);
            play->flags = flags;
            play->AddParam("String", "eventName");
            rtti->RegisterFunction(play);
        }

        {
            auto* kick = RED4ext::CGlobalFunction::Create("TSC_Kick", "TSC_Kick", &NativeKick);
            kick->flags = flags;
            kick->AddParam("String", "eventName");
            kick->AddParam("String", "weapon");
            kick->AddParam("String", "hand");
            rtti->RegisterFunction(kick);
        }

        {
            auto* hit = RED4ext::CGlobalFunction::Create("TSC_Hit", "TSC_Hit", &NativeHit);
            hit->flags = flags;
            hit->AddParam("Float", "angle");
            hit->AddParam("Float", "intensity");
            rtti->RegisterFunction(hit);
        }

        logging::Info("Registered TSC_Play / TSC_Kick / TSC_Hit natives");
    }
}

void RegisterTSCNatives()
{
    auto* rtti = RED4ext::CRTTISystem::Get();
    if (!rtti)
    {
        logging::Error("CRTTISystem unavailable at Load; cannot register callbacks");
        return;
    }
    rtti->AddRegisterCallback(RegisterTypes);
    rtti->AddPostRegisterCallback(PostRegisterTypes);
}

//
// squirrel.cpp - TS_* and TSG_* natives for CLIENT and SERVER Squirrel VMs.
// Offsets match Florian's Titanfall2VR_bhaptics / NorthstarLauncher 1.31.x.
//

#include "squirrel.h"
#include "daemon.h"
#include "log.h"

#include <cstddef>
#include <cstdint>

namespace
{
    struct SQVM;
    using HSQUIRRELVM = SQVM*;
    using SQInteger   = long;
    using SQFloat     = float;
    using SQBool      = unsigned long;
    using SQChar      = char;

    enum SQRESULT : SQInteger
    {
        SQRESULT_ERROR   = -1,
        SQRESULT_NULL    = 0,
        SQRESULT_NOTNULL = 1,
    };

    using SQFunction = SQRESULT (*)(HSQUIRRELVM);

    enum class eSQReturnType : int
    {
        Float   = 0x1,
        Integer = 0x5,
        Boolean = 0x6,
        Default = 0x20,
        String  = 0x21,
    };

    struct SQFuncRegistration
    {
        const char*   squirrelFuncName;
        const char*   cppFuncName;
        const char*   helpText;
        const char*   returnTypeString;
        const char*   argTypes;
        uint32_t      unknown1;
        uint32_t      devLevel;
        const char*   shortNameMaybe;
        uint32_t      unknown2;
        eSQReturnType returnType;
        uint32_t*     externalBufferPointer;
        uint64_t      externalBufferSize;
        uint64_t      unknown3;
        uint64_t      unknown4;
        SQFunction    funcPtr;
    };
    static_assert(offsetof(SQFuncRegistration, returnType) == 0x3C, "SQFuncRegistration layout");
    static_assert(offsetof(SQFuncRegistration, funcPtr) == 0x60, "SQFuncRegistration layout");
    static_assert(sizeof(SQFuncRegistration) == 0x68, "SQFuncRegistration layout");

    constexpr size_t kCSquirrelVM_vmContext = 0x3C;

    enum Context : int
    {
        CTX_SERVER = 0,
        CTX_CLIENT = 1,
        CTX_UI     = 2,
        CTX_COUNT
    };

    const char* ContextName(int ctx)
    {
        switch (ctx)
        {
            case CTX_SERVER: return "SERVER";
            case CTX_CLIENT: return "CLIENT";
            case CTX_UI:     return "UI";
        }
        return "?";
    }

    using RegisterSquirrelFuncFn = int64_t (*)(ns::CSquirrelVM* vm, SQFuncRegistration* reg, char unknown);
    using GetStringFn            = const SQChar* (*)(HSQUIRRELVM, SQInteger stackPos);
    using GetFloatFn             = SQFloat (*)(HSQUIRRELVM, SQInteger stackPos);
    using PushBoolFn             = void (*)(HSQUIRRELVM, SQBool value);

    struct Offsets
    {
        const wchar_t* module;
        uintptr_t registerFunc;
        uintptr_t getString;
        uintptr_t getFloat;
        uintptr_t pushBool;
    };

    constexpr Offsets kServerOffsets = { L"server.dll", 0x1DD10, 0x60A0, 0x60E0, 0x3710 };
    constexpr Offsets kClientOffsets = { L"client.dll", 0x108E0, 0x60C0, 0x6100, 0x3710 };

    struct Api
    {
        bool                   ready        = false;
        RegisterSquirrelFuncFn registerFunc = nullptr;
        GetStringFn            getString    = nullptr;
        GetFloatFn             getFloat     = nullptr;
        PushBoolFn             pushBool     = nullptr;
    };

    Api g_api[CTX_COUNT];

    bool ResolveApi(int ctx)
    {
        Api& api = g_api[ctx];
        if (api.ready)
            return true;

        const Offsets& o = (ctx == CTX_SERVER) ? kServerOffsets : kClientOffsets;
        const auto base = reinterpret_cast<uintptr_t>(GetModuleHandleW(o.module));
        if (!base)
        {
            logging::Error("Squirrel: %s not loaded", ctx == CTX_SERVER ? "server.dll" : "client.dll");
            return false;
        }

        api.registerFunc = reinterpret_cast<RegisterSquirrelFuncFn>(base + o.registerFunc);
        api.getString    = reinterpret_cast<GetStringFn>(base + o.getString);
        api.getFloat     = reinterpret_cast<GetFloatFn>(base + o.getFloat);
        api.pushBool     = reinterpret_cast<PushBoolFn>(base + o.pushBool);
        api.ready        = true;
        return true;
    }

    template <int Ctx>
    SQRESULT Native_Play(HSQUIRRELVM vm)
    {
        daemon_tcp::Play(g_api[Ctx].getString(vm, 1));
        return SQRESULT_NULL;
    }

    template <int Ctx>
    SQRESULT Native_PlayParam(HSQUIRRELVM vm)
    {
        const Api& api = g_api[Ctx];
        daemon_tcp::PlayParam(api.getString(vm, 1),
                              api.getFloat(vm, 2),
                              api.getFloat(vm, 3),
                              api.getFloat(vm, 4),
                              api.getFloat(vm, 5));
        return SQRESULT_NULL;
    }

    template <int Ctx>
    SQRESULT Native_IsConnected(HSQUIRRELVM vm)
    {
        g_api[Ctx].pushBool(vm, daemon_tcp::IsConnected() ? 1 : 0);
        return SQRESULT_NOTNULL;
    }

    template <int Ctx>
    SQRESULT Native_Debug(HSQUIRRELVM vm)
    {
        if (logging::Enabled(logging::Level::Debug))
            logging::Debug("[%s script] %s", ContextName(Ctx), g_api[Ctx].getString(vm, 1));
        return SQRESULT_NULL;
    }

    template <int Ctx>
    SQRESULT Native_Warn(HSQUIRRELVM vm)
    {
        logging::Warn("[%s script] %s", ContextName(Ctx), g_api[Ctx].getString(vm, 1));
        return SQRESULT_NULL;
    }

    template <int Ctx>
    SQRESULT Native_Kick(HSQUIRRELVM vm)
    {
        const Api& api = g_api[Ctx];
        daemon_tcp::Kick(api.getString(vm, 1), api.getString(vm, 2), api.getString(vm, 3));
        return SQRESULT_NULL;
    }

    template <int Ctx>
    SQRESULT Native_Charge(HSQUIRRELVM vm)
    {
        const Api& api = g_api[Ctx];
        daemon_tcp::Charge(api.getFloat(vm, 1), api.getString(vm, 2));
        return SQRESULT_NULL;
    }

    template <int Ctx>
    SQRESULT Native_Rumble(HSQUIRRELVM vm)
    {
        const Api& api = g_api[Ctx];
        daemon_tcp::Rumble(api.getFloat(vm, 1), api.getFloat(vm, 2));
        return SQRESULT_NULL;
    }

    template <int Ctx>
    SQRESULT Native_Stop(HSQUIRRELVM)
    {
        return SQRESULT_NULL;
    }

    template <int Ctx>
    SQRESULT Native_GunAvailable(HSQUIRRELVM vm)
    {
        // Always true so the optional gun script runs without ProTube DLLs.
        g_api[Ctx].pushBool(vm, 1);
        return SQRESULT_NOTNULL;
    }

    struct NativeDef
    {
        const char* name;
        const char* returnType;
        eSQReturnType returnTypeId;
        const char* args;
        const char* help;
        SQFunction  server;
        SQFunction  client;
    };

#define TS_NATIVE(fn) &fn<CTX_SERVER>, &fn<CTX_CLIENT>

    const NativeDef kNatives[] = {
        { "TS_Play",        "void", eSQReturnType::Default, "string eventName",
          "Forward a haptic event to the Third Space daemon", TS_NATIVE(Native_Play) },
        { "TS_PlayParam",   "void", eSQReturnType::Default, "string eventName, float intensity, float duration, float angleX, float offsetY",
          "Forward a directional haptic event to the daemon", TS_NATIVE(Native_PlayParam) },
        { "TS_IsConnected", "bool", eSQReturnType::Boolean, "",
          "True if the daemon TCP session is open", TS_NATIVE(Native_IsConnected) },
        { "TS_Debug",       "void", eSQReturnType::Default, "string message",
          "Write to the Third Space plugin log (debug)", TS_NATIVE(Native_Debug) },
        { "TS_Warn",        "void", eSQReturnType::Default, "string message",
          "Write a warning to the Third Space plugin log", TS_NATIVE(Native_Warn) },
        { "TSG_Kick",       "void", eSQReturnType::Default, "string weaponClass, string group, string hand",
          "Forward a gun recoil kick (group: full/heavy/pistol/rifle)", TS_NATIVE(Native_Kick) },
        { "TSG_Charge",     "void", eSQReturnType::Default, "float fraction, string hand",
          "Forward charge-rifle rumble fraction 0..1", TS_NATIVE(Native_Charge) },
        { "TSG_Rumble",     "void", eSQReturnType::Default, "float power, float seconds",
          "Forward Titan weapon rumble", TS_NATIVE(Native_Rumble) },
        { "TSG_Stop",       "void", eSQReturnType::Default, "",
          "No-op stop (daemon has no hold state for Titanfall)", TS_NATIVE(Native_Stop) },
        { "TSG_IsAvailable","bool", eSQReturnType::Boolean, "",
          "Always true when the Third Space plugin is loaded", TS_NATIVE(Native_GunAvailable) },
    };

#undef TS_NATIVE

    constexpr size_t kNativeCount = sizeof(kNatives) / sizeof(kNatives[0]);
    SQFuncRegistration g_regs[CTX_COUNT][kNativeCount] = {};
}

namespace squirrel
{
    void OnVmCreated(ns::CSquirrelVM* vm)
    {
        if (!vm)
            return;

        const int ctx = *reinterpret_cast<const int32_t*>(reinterpret_cast<const uint8_t*>(vm) + kCSquirrelVM_vmContext);
        if (ctx != CTX_SERVER && ctx != CTX_CLIENT)
            return;

        if (!ResolveApi(ctx))
            return;

        for (size_t i = 0; i < kNativeCount; ++i)
        {
            const NativeDef& def = kNatives[i];
            SQFuncRegistration& reg = g_regs[ctx][i];

            reg = SQFuncRegistration{};
            reg.squirrelFuncName = def.name;
            reg.cppFuncName      = def.name;
            reg.helpText         = def.help;
            reg.returnTypeString = def.returnType;
            reg.argTypes         = def.args;
            reg.returnType       = def.returnTypeId;
            reg.funcPtr          = (ctx == CTX_SERVER) ? def.server : def.client;

            g_api[ctx].registerFunc(vm, &reg, 1);
        }

        logging::Debug("Registered %zu TS_*/TSG_* natives in %s VM", kNativeCount, ContextName(ctx));
    }

    void OnVmDestroying(ns::CSquirrelVM* vm)
    {
        (void)vm;
    }
}

#include "daemon.h"
#include "log.h"
#include "natives.h"

#include <RED4ext/RED4ext.hpp>

namespace
{
    HMODULE g_self = nullptr;
}

RED4EXT_C_EXPORT bool RED4EXT_CALL Main(RED4ext::v1::PluginHandle aHandle,
                                        RED4ext::v1::EMainReason aReason,
                                        const RED4ext::v1::Sdk* aSdk)
{
    RED4EXT_UNUSED_PARAMETER(aHandle);
    RED4EXT_UNUSED_PARAMETER(aSdk);

    switch (aReason)
    {
        case RED4ext::v1::EMainReason::Load:
        {
            logging::Init(g_self);
            logging::Info("TSC_Cyberpunk loading");
            RegisterTSCNatives();
            daemon_tcp::Startup();
            break;
        }
        case RED4ext::v1::EMainReason::Unload:
        {
            logging::Info("TSC_Cyberpunk unloading");
            daemon_tcp::Shutdown();
            break;
        }
    }
    return true;
}

RED4EXT_C_EXPORT void RED4EXT_CALL Query(RED4ext::v1::PluginInfo* aInfo)
{
    aInfo->name = L"TSC Cyberpunk";
    aInfo->author = L"TSC / game-haptics";
    aInfo->version = RED4EXT_V1_SEMVER(0, 1, 0);
    aInfo->runtime = RED4EXT_V1_RUNTIME_VERSION_INDEPENDENT;
    aInfo->sdk = RED4EXT_V1_SDK_VERSION_CURRENT;
}

RED4EXT_C_EXPORT uint32_t RED4EXT_CALL Supports()
{
    return RED4EXT_API_VERSION_1;
}

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID)
{
    if (reason == DLL_PROCESS_ATTACH)
    {
        g_self = module;
        DisableThreadLibraryCalls(module);
    }
    return TRUE;
}

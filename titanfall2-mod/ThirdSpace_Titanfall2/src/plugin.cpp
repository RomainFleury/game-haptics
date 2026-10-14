//
// plugin.cpp - Northstar plugin entry for ThirdSpace Titanfall 2 VR forwarder.
//

#include "northstar.h"
#include "log.h"
#include "daemon.h"
#include "squirrel.h"

#include <cstring>

namespace
{
    constexpr const char* kPluginName     = "ThirdSpace_Titanfall2";
    constexpr const char* kPluginVersion  = "0.1.0";
    constexpr const char* kLogName        = "THIRDSPACE";
    constexpr const char* kDependencyName = "TF2VR_THIRDSPACE";
    constexpr int64_t kLogColor = 0x40 | (0xC4 << 8) | (0xFF << 16);

    HMODULE g_self = nullptr;

    class PluginId final : public ns::IPluginId
    {
    public:
        const char* GetString(ns::PluginString prop) override
        {
            switch (prop)
            {
                case ns::PluginString::NAME:            return kPluginName;
                case ns::PluginString::LOG_NAME:        return kLogName;
                case ns::PluginString::DEPENDENCY_NAME: return kDependencyName;
            }
            return nullptr;
        }

        int64_t GetField(ns::PluginField prop) override
        {
            switch (prop)
            {
                case ns::PluginField::CONTEXT: return ns::PluginContext::CLIENT;
                case ns::PluginField::COLOR:   return kLogColor;
            }
            return 0;
        }
    };

    class PluginCallbacks final : public ns::IPluginCallbacks
    {
    public:
        void Init(HMODULE northstarModule, const ns::PluginNorthstarData* initData, bool reloaded) override
        {
            if (initData && initData->pluginHandle)
                g_self = initData->pluginHandle;

            logging::Init(northstarModule, g_self);
            logging::Info("%s v%s loaded%s", kPluginName, kPluginVersion, reloaded ? " (reloaded)" : "");
            daemon_tcp::Startup();
        }

        void Finalize() override {}

        bool Unload() override
        {
            const bool stopped = daemon_tcp::Shutdown();
            logging::Debug("%s %s", kPluginName, stopped ? "unloading" : "stays loaded (worker busy)");
            return stopped;
        }

        void OnSqvmCreated(ns::CSquirrelVM* vm) override
        {
            squirrel::OnVmCreated(vm);
        }

        void OnSqvmDestroying(ns::CSquirrelVM* vm) override
        {
            squirrel::OnVmDestroying(vm);
        }

        void OnLibraryLoaded(HMODULE, const char*) override {}

        void RunFrame() override {}
    };

    PluginId        g_pluginId;
    PluginCallbacks g_callbacks;
}

extern "C" __declspec(dllexport) void* CreateInterface(const char* name, int* status)
{
    void* result = nullptr;

    if (name && std::strcmp(name, ns::PLUGIN_ID_VERSION) == 0)
        result = static_cast<ns::IPluginId*>(&g_pluginId);
    else if (name && std::strcmp(name, ns::PLUGIN_CALLBACKS_VERSION) == 0)
        result = static_cast<ns::IPluginCallbacks*>(&g_callbacks);

    if (status)
        *status = result ? 0 : 1;
    return result;
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

import { usePistolWhipIntegration, PistolWhipGameEvent } from "../../hooks/usePistolWhipIntegration";
import { GameIntegrationPage } from "../../components/GameIntegrationPage";
import {
  MelonModInstallStatus,
  formatMelonInstallMessage,
} from "../../components/MelonModInstallStatus";
import { getIntegratedGame } from "../../data/integratedGames";
import type { GameEvent, EventDisplayInfo, ModInfo } from "../../types/integratedGames";
import { useState } from "react";

const game = getIntegratedGame("pistolwhip")!;

const EVENT_DISPLAY_MAP: Record<string, EventDisplayInfo> = {
  gun_fire: { label: "Pistol Fire", icon: "🔫", color: "text-amber-400" },
  shotgun_fire: { label: "Shotgun Fire", icon: "💥", color: "text-orange-400" },
  empty_gun_fire: { label: "Empty Click", icon: "🔘", color: "text-slate-400" },
  melee_hit: { label: "Melee Hit", icon: "👊", color: "text-yellow-400" },
  reload_hip: { label: "Hip Reload", icon: "🔄", color: "text-blue-300" },
  reload_shoulder: { label: "Shoulder Reload", icon: "🔄", color: "text-blue-400" },
  player_hit: { label: "Hit Taken", icon: "💥", color: "text-red-400" },
  death: { label: "Death", icon: "💀", color: "text-red-500" },
  low_health: { label: "Low Armor", icon: "❤️", color: "text-red-300" },
  healing: { label: "Armor Pickup", icon: "💚", color: "text-green-400" },
};

function formatEventDetails(event: GameEvent): string {
  const params = event.params as { hand?: string; priority?: number };
  if (params?.hand) {
    return params.hand;
  }
  return "";
}

export function PistolWhipIntegrationPage() {
  const {
    status,
    loading,
    error,
    gameEvents,
    solenoidRecoil,
    setSolenoidRecoilSettings,
    gameDir,
    modStatus,
    browseGameDir,
    installMod,
    start,
    stop,
    clearEvents,
  } = usePistolWhipIntegration();

  const [installMessage, setInstallMessage] = useState<string | null>(null);

  const handleInstallMod = async () => {
    setInstallMessage(null);
    const result = await installMod();
    setInstallMessage(formatMelonInstallMessage(result));
  };

  const events: GameEvent[] = gameEvents.map((e: PistolWhipGameEvent) => ({
    id: e.id,
    type: e.type,
    ts: e.ts,
    params: e.params,
  }));

  const modInfo: ModInfo = {
    name: "ThirdSpace_PistolWhip (MelonLoader)",
    downloadUrl: "https://github.com/LavaGang/MelonLoader/releases",
    githubUrl: "https://github.com/floh-bhaptics/PistolWhip_bhaptics",
    installInstructions: [
      "Install MelonLoader 0.6.x or 0.7.x into Pistol Whip and launch once to create Mods/",
          "Select the Pistol Whip folder below and click Install Mod (builds ThirdSpace_PistolWhip.dll if needed)",
      "Start the vest daemon, click Start on this page, then launch Pistol Whip",
    ],
  };

  const configurationPanel = (
    <div className="space-y-4">
      <div className="rounded-lg bg-slate-800/60 p-4 ring-1 ring-white/10">
        <h4 className="text-sm font-medium text-slate-200 mb-3">MelonLoader mod installation</h4>
        <div className="mb-3">
          <label className="text-xs text-slate-400 block mb-1">Pistol Whip game directory</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={gameDir}
              readOnly
              placeholder="Click Browse to select the Pistol Whip folder"
              className="flex-1 rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-white placeholder-slate-500 ring-1 ring-white/10"
            />
            <button
              onClick={browseGameDir}
              disabled={loading}
              className="rounded-lg bg-slate-600/80 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-600 disabled:opacity-50"
            >
              Browse
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Select the folder that contains <code className="bg-slate-700 px-1 rounded">Pistol Whip.exe</code> (MelonLoader creates <code className="bg-slate-700 px-1 rounded">Mods/</code> here)
          </p>
        </div>

        <MelonModInstallStatus
          gameDir={gameDir}
          modDllName="ThirdSpace_PistolWhip.dll"
          modStatus={modStatus}
          loading={loading}
          installMessage={installMessage}
          onInstall={() => void handleInstallMod()}
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-200">Solenoid recoil</h3>
          <span className="text-xs text-slate-500">Pulses on pistol and shotgun fire</span>
        </div>
        <label className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-slate-900/40 border border-slate-700/40 px-3 py-2">
          <div className="min-w-0">
            <div className="text-sm text-slate-200">Pulse USB relay on fire</div>
            <div className="text-xs text-slate-500">Requires a device connected on the Recoil page</div>
          </div>
          <input
            type="checkbox"
            checked={solenoidRecoil.enabled}
            onChange={(e) => setSolenoidRecoilSettings({ enabled: e.target.checked })}
            className="h-4 w-4"
          />
        </label>
        <label className="mt-2 block space-y-1.5 max-w-xs">
          <span className="text-xs text-slate-400">Base pulse (ms)</span>
          <input
            type="number"
            min={25}
            max={120}
            value={solenoidRecoil.durationMs}
            onChange={(e) =>
              setSolenoidRecoilSettings({
                durationMs: Math.max(25, Math.min(120, Number(e.target.value) || 40)),
              })
            }
            className="w-full rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-sm text-white"
          />
        </label>
        <p className="text-xs text-amber-300/80 mt-2">
          Stop and Start the integration after changing these settings.
        </p>
      </div>
    </div>
  );

  const setupGuide = (
    <div className="space-y-3 text-sm">
      <p className="text-slate-300">
        Pistol Whip talks to the daemon over TCP 5050. A MelonLoader mod inside the game sends fire, reload, hit, and death events.
      </p>
      <ol className="list-decimal list-inside space-y-2 text-slate-400">
        <li>
          <strong className="text-slate-300">Install MelonLoader</strong> into Pistol Whip (0.6.x or 0.7.x for Il2Cpp), then launch once so it creates a <code className="bg-slate-800 px-1 rounded">Mods</code> folder.
        </li>
        <li>
          <strong className="text-slate-300">Install the vest mod:</strong> select the Pistol Whip folder above and click Install Mod. That builds <code className="bg-slate-800 px-1 rounded">ThirdSpace_PistolWhip.dll</code> if needed and copies it into <code className="bg-slate-800 px-1 rounded">Mods/</code>.
        </li>
        <li>
          <strong className="text-slate-300">Start this integration</strong> (and the daemon) before launching the game. Events are ignored until Start is pressed.
        </li>
      </ol>
      <p className="text-slate-500 text-xs">
        Optional: create <code className="bg-slate-800 px-1 rounded">Pistol Whip/Mods/ThirdSpace_Config.txt</code> with <code className="bg-slate-800 px-1 rounded">IP</code> or <code className="bg-slate-800 px-1 rounded">IP:PORT</code> if the daemon is not on localhost:5050.
      </p>
    </div>
  );

  return (
    <GameIntegrationPage
      game={game}
      status={{
        running: status.running,
        events_received: status.events_received,
        last_event_ts: status.last_event_ts,
        last_event_type: status.last_event_type,
      }}
      loading={loading}
      error={error}
      events={events}
      eventDisplayMap={EVENT_DISPLAY_MAP}
      onStart={start}
      onStop={stop}
      onClearEvents={clearEvents}
      formatEventDetails={formatEventDetails}
      modInfo={modInfo}
      setupGuide={setupGuide}
      configurationPanel={configurationPanel}
    />
  );
}

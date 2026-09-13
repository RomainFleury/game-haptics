import { useState } from "react";
import { useBattleSisterIntegration, BattleSisterGameEvent } from "../../hooks/useBattleSisterIntegration";
import { GameIntegrationPage } from "../../components/GameIntegrationPage";
import {
  MelonModInstallStatus,
  formatMelonInstallMessage,
} from "../../components/MelonModInstallStatus";
import { getIntegratedGame } from "../../data/integratedGames";
import type { GameEvent, EventDisplayInfo, ModInfo } from "../../types/integratedGames";

const game = getIntegratedGame("battlesister")!;

const EVENT_DISPLAY_MAP: Record<string, EventDisplayInfo> = {
  gun_fire: { label: "Bolter Fire", icon: "🔫", color: "text-amber-400" },
  shotgun_fire: { label: "Grenade Launcher", icon: "💥", color: "text-orange-400" },
  melee_hit: { label: "Melee", icon: "⚔️", color: "text-yellow-400" },
  two_hand: { label: "Two-Hand Brace", icon: "🙌", color: "text-blue-300" },
  player_hit: { label: "Hit Taken", icon: "💥", color: "text-red-400" },
  blade_hit: { label: "Blade Hit", icon: "🗡️", color: "text-red-500" },
  explosion: { label: "Explosion", icon: "💣", color: "text-orange-500" },
  death: { label: "Death", icon: "💀", color: "text-red-500" },
  low_health: { label: "Low Health", icon: "❤️", color: "text-red-300" },
  low_health_end: { label: "Health Recovered", icon: "💚", color: "text-green-400" },
};

function formatEventDetails(event: GameEvent): string {
  const params = event.params as { hand?: string; angle?: number };
  const parts: string[] = [];
  if (params?.hand) parts.push(params.hand);
  if (typeof params?.angle === "number") parts.push(`${Math.round(params.angle)}°`);
  return parts.join(" ");
}

export function BattleSisterIntegrationPage() {
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
  } = useBattleSisterIntegration();

  const [installMessage, setInstallMessage] = useState<string | null>(null);

  const handleInstallMod = async () => {
    setInstallMessage(null);
    const result = await installMod();
    setInstallMessage(formatMelonInstallMessage(result));
  };

  const events: GameEvent[] = gameEvents.map((e: BattleSisterGameEvent) => ({
    id: e.id,
    type: e.type,
    ts: e.ts,
    params: e.params,
  }));

  const modInfo: ModInfo = {
    name: "ThirdSpace_BattleSister (MelonLoader)",
    downloadUrl: "https://github.com/LavaGang/MelonLoader/releases",
    githubUrl: "https://github.com/floh-bhaptics/BattleSister_bhaptics",
    installInstructions: [
      "Install MelonLoader 0.6.x+ into Battle Sister and launch once to create Mods/",
          "Select the Battle Sister folder below and click Install Mod (builds ThirdSpace_BattleSister.dll if needed)",
      "Start the vest daemon, click Start on this page, then launch the game",
    ],
  };

  const configurationPanel = (
    <div className="space-y-4">
      <div className="rounded-lg bg-slate-800/60 p-4 ring-1 ring-white/10">
        <h4 className="text-sm font-medium text-slate-200 mb-3">MelonLoader mod installation</h4>
        <div className="mb-3">
          <label className="text-xs text-slate-400 block mb-1">Battle Sister game directory</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={gameDir}
              readOnly
              placeholder="Click Browse to select the Battle Sister folder"
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
        </div>
        <MelonModInstallStatus
          gameDir={gameDir}
          modDllName="ThirdSpace_BattleSister.dll"
          modStatus={modStatus}
          loading={loading}
          installMessage={installMessage}
          onInstall={() => void handleInstallMod()}
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-200">Solenoid recoil</h3>
          <span className="text-xs text-slate-500">Pulses on bolter and grenade-launcher fire</span>
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
        Battle Sister talks to the daemon over TCP 5050. A MelonLoader mod sends fire, melee, directional hits, explosions, and death.
      </p>
      <ol className="list-decimal list-inside space-y-2 text-slate-400">
        <li>
          <strong className="text-slate-300">Install MelonLoader</strong> into Battle Sister, then launch once so it creates <code className="bg-slate-800 px-1 rounded">Mods</code>.
        </li>
        <li>
          <strong className="text-slate-300">Install the vest mod</strong> with the button above. That builds <code className="bg-slate-800 px-1 rounded">ThirdSpace_BattleSister.dll</code> if needed and copies it into <code className="bg-slate-800 px-1 rounded">Mods/</code>.
        </li>
        <li>
          <strong className="text-slate-300">Start this integration</strong> before launching the game.
        </li>
      </ol>
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

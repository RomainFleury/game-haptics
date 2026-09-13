import { useState } from "react";
import {
  useGunmanContractsIntegration,
  GunmanContractsGameEvent,
} from "../../hooks/useGunmanContractsIntegration";
import { GameIntegrationPage } from "../../components/GameIntegrationPage";
import { getIntegratedGame } from "../../data/integratedGames";
import type { GameEvent, EventDisplayInfo, ModInfo } from "../../types/integratedGames";

const game = getIntegratedGame("gunmancontracts")!;

const EVENT_DISPLAY_MAP: Record<string, EventDisplayInfo> = {
  gun_fire: { label: "Pistol Fire", icon: "🔫", color: "text-amber-400" },
  shotgun_fire: { label: "Shotgun Fire", icon: "💥", color: "text-orange-400" },
  rifle_fire: { label: "Rifle Fire", icon: "🎯", color: "text-yellow-400" },
  bow_fire: { label: "Bow Fire", icon: "🏹", color: "text-lime-400" },
  player_hit: { label: "Hit Taken", icon: "💥", color: "text-red-400" },
  holster_in: { label: "Holster In", icon: "⬇️", color: "text-blue-300" },
  holster_out: { label: "Holster Out", icon: "⬆️", color: "text-blue-400" },
  heartbeat: { label: "Heartbeat", icon: "❤️", color: "text-pink-400" },
};

function formatEventDetails(event: GameEvent): string {
  const params = event.params as { hand?: string; angle?: number; holster?: string };
  const parts: string[] = [];
  if (params?.hand) parts.push(params.hand);
  if (params?.holster) parts.push(params.holster);
  if (typeof params?.angle === "number") parts.push(`${Math.round(params.angle)}°`);
  return parts.join(" ");
}

export function GunmanContractsIntegrationPage() {
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
  } = useGunmanContractsIntegration();

  const [installMessage, setInstallMessage] = useState<string | null>(null);

  const handleInstallMod = async () => {
    setInstallMessage(null);
    const result = await installMod();
    if (result.success) {
      setInstallMessage(
        result.warning
          ? `✓ Mod copied, but MelonLoader is missing — ${result.warning}`
          : `✓ Mod installed: ${result.copiedFiles?.join(", ")}`
      );
    } else {
      setInstallMessage(`✗ Installation failed: ${result.error}`);
    }
  };

  const events: GameEvent[] = gameEvents.map((e: GunmanContractsGameEvent) => ({
    id: e.id,
    type: e.type,
    ts: e.ts,
    params: e.params,
  }));

  const modInfo: ModInfo = {
    name: "ThirdSpace_GunmanContracts (MelonLoader)",
    downloadUrl: "https://github.com/LavaGang/MelonLoader/releases",
    githubUrl: "https://github.com/floh-bhaptics/GunmanContracts_bhaptics",
    installInstructions: [
      "Install MelonLoader 0.6.x+ into Gunman Contracts Standalone and launch once to create Mods/",
      "Select the game folder below and click Install Mod (builds ThirdSpace_GunmanContracts.dll if needed)",
      "Start the vest daemon, click Start on this page, then launch the game",
      "Optional solenoid recoil is inspired by GunmanContracts_Provolver (fire + dual wield); vest fire events come from bHaptics OnFire hooks",
    ],
  };

  const configurationPanel = (
    <div className="space-y-4">
      <div className="rounded-lg bg-slate-800/60 p-4 ring-1 ring-white/10">
        <h4 className="text-sm font-medium text-slate-200 mb-3">MelonLoader mod installation</h4>
        <div className="mb-3">
          <label className="text-xs text-slate-400 block mb-1">Gunman Contracts game directory</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={gameDir}
              readOnly
              placeholder="Click Browse to select the Gunman Contracts folder"
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
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm space-y-1">
            {!gameDir ? (
              <span className="text-slate-500">Select game directory first</span>
            ) : (
              <>
                <div>
                  {modStatus.dllInstalled ? (
                    <span className="text-emerald-400">✓ ThirdSpace_GunmanContracts.dll is in Mods/</span>
                  ) : (
                    <span className="text-yellow-400">⚠ Mod DLL not installed</span>
                  )}
                </div>
                <div>
                  {modStatus.melonLoaderInstalled ? (
                    <span className="text-emerald-400">✓ MelonLoader detected</span>
                  ) : (
                    <span className="text-rose-400">
                      ✗ MelonLoader not found — mods will not load (no live events)
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
          <button
            onClick={handleInstallMod}
            disabled={loading || !gameDir}
            className="rounded-lg bg-blue-600/80 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {modStatus.dllInstalled ? "Reinstall Mod" : "Install Mod"}
          </button>
        </div>
        {gameDir && !modStatus.melonLoaderInstalled && (
          <p className="text-xs text-rose-300/90 mb-2 rounded-lg bg-rose-500/10 ring-1 ring-rose-500/20 px-3 py-2">
            Install{" "}
            <a
              href="https://github.com/LavaGang/MelonLoader/releases"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-rose-200"
            >
              MelonLoader 0.6+
            </a>{" "}
            into this game folder, launch once so it creates{" "}
            <code className="bg-slate-800 px-1 rounded">MelonLoader/</code>, then relaunch the game.
            The in-game “cheats” watermark alone does not mean MelonLoader is installed.
          </p>
        )}
        {installMessage && (
          <p
            className={`text-xs mt-2 ${installMessage.startsWith("✓") ? "text-emerald-400" : "text-red-400"}`}
          >
            {installMessage}
          </p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-200">Solenoid recoil</h3>
          <span className="text-xs text-slate-500">Pulses on pistol, shotgun, and rifle fire</span>
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
        Gunman Contracts Standalone talks to the daemon over TCP 5050. A MelonLoader mod inside the game
        sends fire, bow, hit, and holster events.
      </p>
      <ol className="list-decimal list-inside space-y-2 text-slate-400">
        <li>
          <strong className="text-slate-300">Install MelonLoader</strong> into Gunman Contracts (0.6.x or
          0.7.x for Il2Cpp), then launch once so it creates a{" "}
          <code className="bg-slate-800 px-1 rounded">Mods</code> folder.
        </li>
        <li>
          <strong className="text-slate-300">Install the vest mod</strong> with the button above. That
          builds <code className="bg-slate-800 px-1 rounded">ThirdSpace_GunmanContracts.dll</code> if
          needed and copies it into <code className="bg-slate-800 px-1 rounded">Mods/</code>.
        </li>
        <li>
          <strong className="text-slate-300">Start this integration</strong> (and the daemon) before
          launching the game. Events are ignored until Start is pressed.
        </li>
      </ol>
      <p className="text-slate-500 text-xs">
        Vest hooks follow{" "}
        <a
          className="underline"
          href="https://github.com/floh-bhaptics/GunmanContracts_bhaptics"
          target="_blank"
          rel="noreferrer"
        >
          GunmanContracts_bhaptics
        </a>
        . Solenoid fire/dual-wield feel is inspired by{" "}
        <a
          className="underline"
          href="https://github.com/Astienth/GunmanContracts_Provolver"
          target="_blank"
          rel="noreferrer"
        >
          GunmanContracts_Provolver
        </a>
        .
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

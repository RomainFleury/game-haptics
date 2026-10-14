import { useL4D2Integration } from "../../hooks/useL4D2Integration";
import { GameIntegrationPage } from "../../components/GameIntegrationPage";
import { getIntegratedGame } from "../../data/integratedGames";
import type { GameEvent, EventDisplayInfo, ModInfo } from "../../types/integratedGames";
import { useState } from "react";

const game = getIntegratedGame("l4d2")!;

// Event type to display info mapping
// Keys match event types from the daemon (player_damage, player_death, etc.)
const EVENT_DISPLAY_MAP: Record<string, EventDisplayInfo> = {
  player_damage: { label: "Damage Taken", icon: "💥", color: "text-red-400" },
  player_death: { label: "Player Killed", icon: "💀", color: "text-red-500" },
  player_incap: { label: "Incapacitated", icon: "🩸", color: "text-orange-500" },
  adrenaline_used: { label: "Adrenaline", icon: "💉", color: "text-yellow-400" },
  health_pickup: { label: "Health Pickup", icon: "🩹", color: "text-green-300" },
  player_healed: { label: "Healed", icon: "💚", color: "text-green-400" },
  ammo_pickup: { label: "Ammo Pickup", icon: "🔫", color: "text-blue-300" },
  weapon_fire: { label: "Weapon Fire", icon: "🔫", color: "text-slate-400" },
  infected_spawn: { label: "Infected Spawn", icon: "👾", color: "text-purple-400" },
  infected_hit: { label: "Hit Infected", icon: "🎯", color: "text-green-400" },
  player_kill: { label: "Player Kill", icon: "☠️", color: "text-emerald-400" },
  teammate_death: { label: "Teammate Death", icon: "💔", color: "text-gray-400" },
};

function formatEventDetails(event: GameEvent): string {
  const params = event.params as {
    damage?: number;
    attacker?: string;
    weapon?: string;
    infected?: string;
    player?: string;
    item?: string;
    amount?: number;
  };
  
  if (params?.damage) {
    return `${params.damage} HP`;
  }
  if (params?.amount) {
    return `+${params.amount} HP`;
  }
  if (params?.attacker) {
    return `by ${params.attacker}`;
  }
  if (params?.infected) {
    return params.infected;
  }
  if (params?.weapon) {
    return params.weapon;
  }
  return "";
}

export function L4D2IntegrationPage() {
  const {
    status,
    isLoading,
    error,
    gameEvents,
    logPath,
    setLogPath,
    playerName,
    setPlayerName,
    gameDir,
    modStatus,
    solenoidRecoil,
    setSolenoidRecoilSettings,
    start,
    stop,
    clearEvents,
    browseLogPath,
    browseGameDir,
    installMod,
  } = useL4D2Integration();

  const [installMessage, setInstallMessage] = useState<string | null>(null);

  // Handle mod installation
  const handleInstallMod = async () => {
    setInstallMessage(null);
    const result = await installMod();
    if (result.success) {
      setInstallMessage(`✓ Mod installed successfully! Files copied: ${result.copiedFiles?.join(', ')}`);
    } else {
      setInstallMessage(`✗ Installation failed: ${result.error}`);
    }
  };

  // Convert L4D2 events to generic GameEvent format
  const events: GameEvent[] = gameEvents.map((e, i) => ({
    id: `l4d2-${e.timestamp}-${i}`,
    type: e.event,
    ts: e.timestamp,
    params: e.params as Record<string, unknown>,
  }));

  // Configuration panel
  const configurationPanel = (
    <div className="space-y-4">
      {/* Mod Installation Section */}
      <div className="rounded-lg bg-slate-800/60 p-4 ring-1 ring-white/10">
        <h4 className="text-sm font-medium text-slate-200 mb-3">📦 VScript Mod Installation</h4>
        
        {/* Game Directory */}
        <div className="mb-3">
          <label className="text-xs text-slate-400 block mb-1">L4D2 Game Directory</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={gameDir}
              readOnly
              placeholder="Click 'Browse' to select left4dead2 folder"
              className="flex-1 rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-white placeholder-slate-500 ring-1 ring-white/10"
            />
            <button
              onClick={browseGameDir}
              disabled={isLoading}
              className="rounded-lg bg-slate-600/80 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-600 disabled:opacity-50"
            >
              Browse
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Select the <code className="bg-slate-700 px-1 rounded">left4dead2</code> folder inside your L4D2 installation
          </p>
        </div>

        {/* Mod Status */}
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm">
            {modStatus.installed ? (
              <span className="text-emerald-400">✓ Mod is installed</span>
            ) : gameDir ? (
              <span className="text-yellow-400">⚠ Mod not installed</span>
            ) : (
              <span className="text-slate-500">Select game directory first</span>
            )}
            {gameDir && !modStatus.installed && (modStatus.missingFiles?.length ?? 0) > 0 && (
              <p className="text-xs text-slate-500 mt-1 max-w-md">
                Missing in <code className="bg-slate-700 px-1 rounded">scripts/vscripts</code>:{' '}
                {modStatus.missingFiles!.join(', ')}
              </p>
            )}
          </div>
          <button
            onClick={handleInstallMod}
            disabled={isLoading || !gameDir}
            className="rounded-lg bg-blue-600/80 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {modStatus.installed ? 'Reinstall Mod' : 'Install Mod'}
          </button>
        </div>

        {/* Install Message */}
        {installMessage && (
          <p className={`text-xs mt-2 ${installMessage.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>
            {installMessage}
          </p>
        )}
      </div>

      {/* Log Path */}
      <div>
        <label className="text-sm text-slate-400 block mb-2">Console Log Path</label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={logPath}
            onChange={(e) => setLogPath(e.target.value || null)}
            placeholder="Auto-detect (default: Steam/steamapps/common/Left 4 Dead 2/left4dead2/console.log)"
            className="flex-1 rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-white placeholder-slate-500 ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={browseLogPath}
            disabled={isLoading}
            className="rounded-lg bg-slate-600/80 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-600 disabled:opacity-50"
          >
            Browse
          </button>
        </div>
        {status.log_path && (
          <p className="text-xs text-emerald-400 mt-1">
            ✓ Watching: {status.log_path}
          </p>
        )}
      </div>

      {/* Player Name Filter */}
      <div>
        <label className="text-sm text-slate-400 block mb-2">Player Name (optional)</label>
        <input
          type="text"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value || null)}
          placeholder="Filter events for specific player"
          className="w-full rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-white placeholder-slate-500 ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-slate-500 mt-1">
          Leave empty to receive all damage events
        </p>
      </div>

      {/* Solenoid recoil */}
      <div className="rounded-lg bg-slate-800/60 p-4 ring-1 ring-white/10">
        <h4 className="text-sm font-medium text-slate-200 mb-2">Solenoid recoil</h4>
        <label className="flex items-center justify-between gap-3 rounded-lg bg-slate-900/40 border border-slate-700/40 px-3 py-2">
          <div className="min-w-0">
            <div className="text-sm text-slate-200">Pulse on weapon_fire</div>
            <div className="text-xs text-slate-500">
              Guns only — skips melee, throwables, and chainsaw. Reinstall mod after update so WeaponFire is logged.
              Connect the device on the Recoil page.
            </div>
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
          Stop/Start L4D2 integration after changing these settings.
        </p>
      </div>
    </div>
  );

  const modInfo: ModInfo = {
    name: "Third Space L4D2 VScript mod",
    downloadUrl:
      "https://github.com/RomainFleury/game-haptics/tree/master/misc-documentations/bhaptics-svg-24-nov/l4d2/third-space-vest-mod",
    installInstructions: [
      "Select your L4D2 game directory and click Install Mod",
      "Add -condebug to Steam launch options",
      "Launch L4D2, start a match, then click Start here",
    ],
    credits: {
      summary:
        "Haptic event design (directional damage, weapon fire, healing, death) is inspired by bHaptics and OWO FPS integrations. Console-log watching follows the same -condebug pattern used by Half-Life: Alyx haptic mods. There is no dedicated L4D2 bHaptics/OWO mod — this VScript is ours.",
      links: [
        {
          label: "bHaptics (FPS haptic patterns)",
          url: "https://www.bhaptics.com/games/experiences/counter-strike-2/",
        },
        {
          label: "OWO (FPS haptic patterns)",
          url: "https://owogame.com/game/counter-strike-2/",
        },
        {
          label: "Alyx Tactsuit / console events",
          url: "https://www.nexusmods.com/halflifealyx/mods/6",
        },
      ],
    },
  };

  // Setup guide
  const setupGuide = (
    <div className="space-y-3 text-sm">
      <p className="text-slate-300">
        Left 4 Dead 2 integration requires a VScript mod and console logging enabled.
      </p>
      <ol className="list-decimal list-inside space-y-2 text-slate-400">
        <li>
          <strong className="text-slate-300">Install the VScript mod:</strong>
          <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
            <li>Select your L4D2 game directory above</li>
            <li>Click "Install Mod" to copy the scripts automatically</li>
          </ul>
        </li>
        <li>
          <strong className="text-slate-300">Enable console logging:</strong>
          <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
            <li>Steam → Right-click L4D2 → Properties → Launch Options</li>
            <li>Add: <code className="bg-slate-700 px-1 rounded">-condebug</code></li>
          </ul>
        </li>
        <li>
          <strong className="text-slate-300">Start the game:</strong>
          <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
            <li>Launch L4D2 and start any game mode</li>
            <li>Supported: Campaign, Versus, Survival, Scavenge</li>
            <li>The mod auto-loads for each mode</li>
          </ul>
        </li>
        <li>
          <strong className="text-slate-300">Activate haptics:</strong>
          <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
            <li>Click "Start" in this app</li>
            <li>Take damage in-game to feel the haptic feedback!</li>
          </ul>
        </li>
      </ol>
      <div className="rounded-lg bg-green-900/30 ring-1 ring-green-500/30 p-3 mt-4">
        <p className="text-green-200 text-xs">
          <strong>✅ All game modes supported:</strong> Campaign, Versus, Survival, and Scavenge. 
          The mod automatically enables for each mode with full damage tracking and directional feedback.
        </p>
      </div>
      <p className="text-slate-500 text-xs mt-2">
        💡 Haptic events: Taking damage (directional), incapacitation, death, adrenaline injection
      </p>
      <p className="text-slate-500 text-xs">
        Event design inspired by{" "}
        <a className="underline text-sky-400" href="https://www.bhaptics.com/games/experiences/counter-strike-2/" target="_blank" rel="noreferrer">
          bHaptics
        </a>{" "}
        /{" "}
        <a className="underline text-sky-400" href="https://owogame.com/game/counter-strike-2/" target="_blank" rel="noreferrer">
          OWO
        </a>{" "}
        FPS integrations; log watching follows Alyx-style{" "}
        <a className="underline text-sky-400" href="https://www.nexusmods.com/halflifealyx/mods/6" target="_blank" rel="noreferrer">
          console haptic mods
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
      loading={isLoading}
      error={error}
      events={events}
      eventDisplayMap={EVENT_DISPLAY_MAP}
      onStart={() => start()}
      onStop={stop}
      onClearEvents={clearEvents}
      formatEventDetails={formatEventDetails}
      configurationPanel={configurationPanel}
      setupGuide={setupGuide}
      modInfo={modInfo}
    />
  );
}

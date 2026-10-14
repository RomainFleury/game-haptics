import { useCS2Integration, CS2GameEvent } from "../../hooks/useCS2Integration";
import { GameIntegrationPage } from "../../components/GameIntegrationPage";
import { getIntegratedGame } from "../../data/integratedGames";
import type { GameEvent, EventDisplayInfo, ModInfo } from "../../types/integratedGames";

const game = getIntegratedGame("cs2")!;

// Event type to display info mapping
const EVENT_DISPLAY_MAP: Record<string, EventDisplayInfo> = {
  damage: { label: "Damage", icon: "💥", color: "text-red-400" },
  death: { label: "Death", icon: "💀", color: "text-red-500" },
  flash: { label: "Flashbang", icon: "✨", color: "text-yellow-400" },
  bomb_planted: { label: "Bomb Planted", icon: "💣", color: "text-orange-400" },
  bomb_exploded: { label: "Bomb Exploded", icon: "🔥", color: "text-orange-500" },
  round_start: { label: "Round Start", icon: "🎯", color: "text-green-400" },
  kill: { label: "Kill", icon: "🎖️", color: "text-blue-400" },
};

function formatEventDetails(event: GameEvent): string {
  const cs2Event = event as unknown as CS2GameEvent;
  if (cs2Event.type === "damage" && cs2Event.amount) {
    return `${cs2Event.amount} HP`;
  }
  if (cs2Event.type === "flash" && cs2Event.intensity) {
    return `intensity ${cs2Event.intensity}`;
  }
  return "";
}

export function CS2IntegrationPage() {
  const {
    status,
    gsiPort,
    setGsiPort,
    loading,
    error,
    gameEvents,
    start,
    stop,
    generateConfig,
    clearEvents,
    configPath,
    configExists,
    saveSuccess,
    autoDetect,
    browseForPath,
    saveConfigToCS2,
    clearSaveSuccess,
  } = useCS2Integration();

  const handleDownloadConfig = async () => {
    const result = await generateConfig();
    if (result) {
      const blob = new Blob([result.content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  // Convert CS2 events to generic GameEvent format
  const events: GameEvent[] = gameEvents.map(e => ({
    id: e.id,
    type: e.type,
    ts: e.ts,
    params: { amount: e.amount, intensity: e.intensity },
  }));

  // Configuration panel
  const configurationPanel = (
    <div className="space-y-4">
      {/* Success message */}
      {saveSuccess && (
        <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 flex items-center justify-between">
          <span>✅ {saveSuccess}</span>
          <button onClick={clearSaveSuccess} className="text-emerald-400 hover:text-emerald-300">×</button>
        </div>
      )}

      {/* CS2 Config Path */}
      <div>
        <label className="text-sm text-slate-400 block mb-2">CS2 Config Folder</label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={configPath || ""}
            readOnly
            placeholder="Not set - click Browse or Auto-detect"
            className="flex-1 rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-white placeholder-slate-500 ring-1 ring-white/10 focus:outline-none"
          />
          <button
            onClick={browseForPath}
            disabled={loading}
            className="rounded-lg bg-slate-600/80 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-600 disabled:opacity-50"
          >
            Browse
          </button>
          <button
            onClick={autoDetect}
            disabled={loading}
            className="rounded-lg bg-slate-600/80 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-600 disabled:opacity-50"
            title="Auto-detect CS2 installation folder"
          >
            Auto
          </button>
        </div>
        {configPath && (
          <p className="text-xs text-slate-500 mt-1">
            {configExists ? (
              <span className="text-emerald-400">✓ Config file exists</span>
            ) : (
              <span className="text-amber-400">⚠ No config file yet</span>
            )}
          </p>
        )}
      </div>

      {/* GSI Port */}
      <div>
        <label className="text-sm text-slate-400 block mb-2">GSI Port</label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            value={gsiPort}
            onChange={(e) => setGsiPort(parseInt(e.target.value, 10) || 3000)}
            disabled={status.running || loading}
            min={1024}
            max={65535}
            className="w-24 rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-white ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <span className="text-xs text-slate-500">
            {status.running && status.gsi_port
              ? `Listening on :${status.gsi_port}`
              : "Default: 3000"}
          </span>
        </div>
      </div>

      {/* Config actions */}
      <div className="flex gap-3">
        <button
          onClick={saveConfigToCS2}
          disabled={loading || !configPath}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600/80 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:opacity-50"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
          </svg>
          Save to CS2
        </button>
        <button
          onClick={handleDownloadConfig}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-600/80 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-600 disabled:opacity-50"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download Config
        </button>
      </div>
    </div>
  );

  const modInfo: ModInfo = {
    name: "CS2 Game State Integration",
    downloadUrl:
      "https://developer.valvesoftware.com/wiki/Counter-Strike:_Global_Offensive_Game_State_Integration",
    installInstructions: [
      "Set your CS2 config folder (or Auto-detect)",
      "Click Save to CS2 to write gamestate_integration_thirdspace.cfg",
      "Start CS2, join a match, then click Start here",
    ],
    credits: {
      summary:
        "Haptic event choices (damage, flash, bomb, round flow) are inspired by official bHaptics and OWO Counter-Strike 2 experiences. The GSI listener builds on open Counter-Strike GSI libraries.",
      links: [
        {
          label: "bHaptics Counter-Strike 2",
          url: "https://www.bhaptics.com/games/experiences/counter-strike-2/",
        },
        {
          label: "OWO Counter-Strike 2",
          url: "https://owogame.com/game/counter-strike-2/",
        },
        {
          label: "CounterStrike2GSI (antonpup)",
          url: "https://github.com/antonpup/CounterStrike2GSI",
        },
      ],
    },
  };

  // Setup guide
  const setupGuide = (
    <div className="space-y-3 text-sm">
      <p className="text-slate-300">
        CS2 uses Game State Integration (GSI) to send game events to external applications.
      </p>
      <ol className="list-decimal list-inside space-y-2 text-slate-400">
        <li>Set your CS2 config folder above (or use Auto-detect)</li>
        <li>Click "Save to CS2" to install the GSI config file</li>
        <li>Start CS2 and join a match</li>
        <li>Click "Start" above to begin receiving haptic feedback</li>
      </ol>
      <p className="text-slate-500 text-xs">
        💡 The config file will be saved as <code className="bg-slate-800 px-1 rounded">gamestate_integration_thirdspace.cfg</code>
      </p>
      <p className="text-slate-500 text-xs">
        Haptics inspired by{" "}
        <a className="underline text-sky-400" href="https://www.bhaptics.com/games/experiences/counter-strike-2/" target="_blank" rel="noreferrer">
          bHaptics CS2
        </a>{" "}
        and{" "}
        <a className="underline text-sky-400" href="https://owogame.com/game/counter-strike-2/" target="_blank" rel="noreferrer">
          OWO CS2
        </a>
        ; GSI parsing follows libraries like{" "}
        <a className="underline text-sky-400" href="https://github.com/antonpup/CounterStrike2GSI" target="_blank" rel="noreferrer">
          CounterStrike2GSI
        </a>
        .
      </p>
    </div>
  );

  return (
    <GameIntegrationPage
      game={game}
      status={status}
      loading={loading}
      error={error}
      events={events}
      eventDisplayMap={EVENT_DISPLAY_MAP}
      onStart={start}
      onStop={stop}
      onClearEvents={clearEvents}
      formatEventDetails={formatEventDetails}
      configurationPanel={configurationPanel}
      setupGuide={setupGuide}
      modInfo={modInfo}
    />
  );
}

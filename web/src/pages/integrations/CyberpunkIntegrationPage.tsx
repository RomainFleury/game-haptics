import { useState } from "react";
import {
  useCyberpunkIntegration,
  CyberpunkGameEvent,
} from "../../hooks/useCyberpunkIntegration";
import { GameIntegrationPage } from "../../components/GameIntegrationPage";
import { getIntegratedGame } from "../../data/integratedGames";
import type { GameEvent, EventDisplayInfo, ModInfo } from "../../types/integratedGames";

const game = getIntegratedGame("cyberpunk")!;

function formatInstallMessage(result: {
  success?: boolean;
  copiedFiles?: string[];
  warning?: string;
  error?: string;
}): string {
  if (!result.success) return result.error || "Install failed";
  const copied = result.copiedFiles?.length
    ? `Copied: ${result.copiedFiles.join(", ")}`
    : "Install complete";
  return result.warning ? `${copied}. Warning: ${result.warning}` : copied;
}

const EVENT_DISPLAY_MAP: Record<string, EventDisplayInfo> = {
  gun_fire: { label: "Pistol / Handgun Fire", icon: "🔫", color: "text-amber-400" },
  smg_fire: { label: "SMG Fire", icon: "🔫", color: "text-amber-300" },
  rifle_fire: { label: "Rifle / LMG Fire", icon: "🎯", color: "text-yellow-400" },
  sniper_fire: { label: "Sniper Fire", icon: "🎯", color: "text-yellow-300" },
  shotgun_fire: { label: "Shotgun Fire", icon: "💥", color: "text-orange-400" },
  player_hit: { label: "Hit Taken", icon: "💥", color: "text-red-400" },
};

const EFFECT_TOGGLE_ORDER: string[] = [
  "gun_fire",
  "smg_fire",
  "rifle_fire",
  "sniper_fire",
  "shotgun_fire",
  "player_hit",
];

const EVENT_TOGGLE_HINTS: Record<string, string> = {
  gun_fire: "Handgun / revolver",
  smg_fire: "SMG class",
  rifle_fire: "Assault / precision / LMG",
  sniper_fire: "Sniper rifles",
  shotgun_fire: "Shotgun / dual shotgun",
  player_hit: "Directional when angle is known",
};

function formatEventDetails(event: GameEvent): string {
  const params = event.params as { hand?: string; angle?: number; intensity?: number; weapon?: string };
  const parts: string[] = [];
  if (params?.hand) parts.push(params.hand);
  if (params?.weapon) parts.push(params.weapon);
  if (typeof params?.angle === "number" && params.angle >= 0) {
    parts.push(`${Math.round(params.angle)}°`);
  }
  if (typeof params?.intensity === "number") {
    parts.push(`${Math.round(params.intensity * 100)}%`);
  }
  return parts.join(" ");
}

export function CyberpunkIntegrationPage() {
  const {
    status,
    loading,
    error,
    gameEvents,
    solenoidRecoil,
    setSolenoidRecoilSettings,
    enabledEvents,
    setEventEnabled,
    restartRequired,
    gameDir,
    modStatus,
    browseGameDir,
    installMod,
    checkModInstalled,
    start,
    stop,
    clearEvents,
  } = useCyberpunkIntegration();

  const [installMessage, setInstallMessage] = useState<string | null>(null);

  const handleInstallMod = async () => {
    setInstallMessage(null);
    const result = await installMod();
    setInstallMessage(formatInstallMessage(result));
  };

  const events: GameEvent[] = gameEvents.map((e: CyberpunkGameEvent) => ({
    id: e.id,
    type: e.type,
    ts: e.ts,
    params: e.params,
  }));

  const modInfo: ModInfo = {
    name: "TSC_Cyberpunk (RED4ext + redscript)",
    downloadUrl: "https://www.nexusmods.com/cyberpunk2077/mods/2380",
    githubUrl: "https://wiki.redmodding.org/",
    installInstructions: [
      "Install RED4ext and redscript into Cyberpunk 2077",
      "Select the game folder below and click Install Mod (builds TSC_Cyberpunk.dll if needed)",
      "Start the vest daemon, click Start on this page, then launch the game",
      "Do not run the OWO Skin / bHaptics CP2077 haptic mods at the same time",
    ],
    credits: {
      summary:
        "Original TSC RED4ext/redscript forwarder. Event ideas inspired by the public OWO/bHaptics Cyberpunk haptic surface (not a fork of those Nexus archives).",
      links: [
        {
          label: "OWO Skin – Cyberpunk 2077 (prior art)",
          url: "https://www.nexusmods.com/cyberpunk2077/mods/31204",
        },
        {
          label: "RED4ext",
          url: "https://www.nexusmods.com/cyberpunk2077/mods/2380",
        },
        {
          label: "redscript",
          url: "https://www.nexusmods.com/cyberpunk2077/mods/1511",
        },
      ],
    },
  };

  const configurationPanel = (
    <div className="space-y-4">
      <div className="rounded-lg bg-slate-800/60 p-4 ring-1 ring-white/10">
        <h4 className="text-sm font-medium text-slate-200 mb-3">RED4ext mod installation</h4>
        <div className="mb-3">
          <label className="text-xs text-slate-400 block mb-1">Cyberpunk 2077 game directory</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={gameDir}
              readOnly
              placeholder="Click Browse to select the Cyberpunk 2077 folder"
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
        <div className="space-y-2 text-xs text-slate-400">
          <div>
            Plugin DLL:{" "}
            <span className={modStatus.dllInstalled ? "text-emerald-400" : "text-amber-400"}>
              {modStatus.dllInstalled ? "installed" : "missing"}
            </span>
          </div>
          <div>
            redscript hooks:{" "}
            <span className={modStatus.scriptsInstalled ? "text-emerald-400" : "text-amber-400"}>
              {modStatus.scriptsInstalled ? "installed" : "missing"}
            </span>
          </div>
          <div>
            RED4ext:{" "}
            <span className={modStatus.red4extInstalled ? "text-emerald-400" : "text-amber-400"}>
              {modStatus.red4extInstalled ? "detected" : "not detected"}
            </span>
          </div>
          {modStatus.missingFiles && modStatus.missingFiles.length > 0 && (
            <div className="text-amber-300/90">Missing: {modStatus.missingFiles.join(", ")}</div>
          )}
          {installMessage && <div className="text-slate-300">{installMessage}</div>}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => void handleInstallMod()}
              disabled={loading || !gameDir}
              className="rounded-lg bg-cyan-700/80 px-3 py-2 text-sm font-medium text-white transition hover:bg-cyan-600 disabled:opacity-50"
            >
              Install Mod
            </button>
            <button
              onClick={checkModInstalled}
              disabled={loading}
              className="rounded-lg bg-slate-600/80 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-600 disabled:opacity-50"
            >
              Recheck
            </button>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-200">Solenoid recoil</h3>
          <span className="text-xs text-slate-500">USB relay on the Recoil page</span>
        </div>
        <label className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-slate-900/40 border border-slate-700/40 px-3 py-2">
          <div className="min-w-0">
            <div className="text-sm text-slate-200">Pulse USB relay on fire</div>
            <div className="text-xs text-slate-500">Short pulse on pistol / SMG / rifle / shotgun / sniper</div>
          </div>
          <input
            type="checkbox"
            checked={solenoidRecoil.enabled}
            onChange={(e) => setSolenoidRecoilSettings({ enabled: e.target.checked })}
            className="h-4 w-4"
          />
        </label>
        <label className="mt-2 block space-y-1.5 max-w-xs">
          <span className="text-xs text-slate-400">Base fire pulse (ms)</span>
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
      </div>

      <div className="pt-2 border-t border-slate-700/60">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-200">Haptics (per-event)</h3>
          <span className="text-xs text-slate-500">Defaults: all ON</span>
        </div>

        {restartRequired && status.running && (
          <div className="mt-3 rounded-lg bg-amber-900/20 border border-amber-700/30 px-3 py-2 text-xs text-amber-200">
            Settings saved. Stop and Start the integration to apply changes.
          </div>
        )}

        {!enabledEvents ? (
          <p className="mt-3 text-sm text-slate-500">Loading settings…</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            {EFFECT_TOGGLE_ORDER.map((eventType) => {
              const checked = Boolean(enabledEvents[eventType]);
              const label = EVENT_DISPLAY_MAP[eventType]?.label || eventType;
              const hint = EVENT_TOGGLE_HINTS[eventType];
              return (
                <label
                  key={eventType}
                  className="flex items-center justify-between gap-3 rounded-lg bg-slate-900/40 border border-slate-700/40 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-slate-200 truncate">{label}</div>
                    <div className="text-xs text-slate-500 font-mono truncate">
                      {hint || eventType}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => void setEventEnabled(eventType, e.target.checked)}
                    className="h-4 w-4"
                  />
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const setupGuide = (
    <div className="space-y-3 text-sm">
      <p className="text-slate-300">
        Cyberpunk 2077 talks to the daemon over TCP 5050. A RED4ext plugin plus redscript hooks send
        directional hits and weapon-class gunfire for vest cells and optional solenoid recoil.
      </p>
      <ol className="list-decimal list-inside space-y-2 text-slate-400">
        <li>
          <strong className="text-slate-300">Install RED4ext + redscript</strong> into the Cyberpunk
          2077 folder (same prerequisites as the community OWO haptic mod).
        </li>
        <li>
          <strong className="text-slate-300">Install the vest mod</strong> with the button above. That
          builds <code className="bg-slate-800 px-1 rounded">TSC_Cyberpunk.dll</code> if needed
          and copies plugin + <code className="bg-slate-800 px-1 rounded">r6/scripts/TSC</code>.
        </li>
        <li>
          <strong className="text-slate-300">Start this integration</strong> (and the daemon) before
          launching the game. Events are ignored until Start is pressed.
        </li>
      </ol>
      <p className="text-slate-500 text-xs">
        Prior art:{" "}
        <a
          className="underline"
          href="https://www.nexusmods.com/cyberpunk2077/mods/31204"
          target="_blank"
          rel="noreferrer"
        >
          OWO Skin – Cyberpunk 2077
        </a>{" "}
        (not redistributed; write-your-own hooks).
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

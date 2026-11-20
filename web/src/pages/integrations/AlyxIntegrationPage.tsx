import { useAlyxIntegration, AlyxGameEvent } from "../../hooks/useAlyxIntegration";
import { GameIntegrationPage } from "../../components/GameIntegrationPage";
import { CopyUrlButton } from "../../components/CopyUrlButton";
import { getIntegratedGame } from "../../data/integratedGames";
import type { GameEvent, EventDisplayInfo, ModInfo } from "../../types/integratedGames";

const game = getIntegratedGame("alyx")!;

// Event type to display info mapping
const EVENT_DISPLAY_MAP: Record<string, EventDisplayInfo> = {
  PlayerHurt: { label: "Damage Taken", icon: "💥", color: "text-red-400" },
  PlayerDeath: { label: "Death", icon: "💀", color: "text-red-500" },
  PlayerShootWeapon: { label: "Weapon Fire", icon: "🔫", color: "text-amber-400" },
  PlayerHealth: { label: "Low Health", icon: "❤️", color: "text-red-300" },
  PlayerHeal: { label: "Healing", icon: "💚", color: "text-green-400" },
  PlayerGrabbityPull: { label: "Gravity Pull", icon: "🧲", color: "text-purple-400" },
  GrabbityGloveCatch: { label: "Gravity Catch", icon: "🤚", color: "text-purple-300" },
  PlayerGrabbedByBarnacle: { label: "Barnacle Grab", icon: "🦑", color: "text-orange-400" },
  PlayerReleasedByBarnacle: { label: "Barnacle Release", icon: "🦑", color: "text-orange-300" },
  PlayerCoughStart: { label: "Coughing", icon: "🫁", color: "text-slate-400" },
  PlayerCoughEnd: { label: "Cough End", icon: "🫁", color: "text-slate-500" },
  TwoHandStart: { label: "Two-Hand Grip", icon: "✊", color: "text-blue-400" },
  TwoHandEnd: { label: "Release Grip", icon: "✊", color: "text-blue-300" },
  Reset: { label: "Player Spawn", icon: "🔄", color: "text-green-400" },
  PlayerDropAmmoInBackpack: { label: "Store Ammo", icon: "🎒", color: "text-amber-300" },
  PlayerDropResinInBackpack: { label: "Store Resin", icon: "🎒", color: "text-amber-300" },
  PlayerRetrievedBackpackClip: { label: "Get Clip", icon: "📦", color: "text-amber-400" },
};

const EFFECT_TOGGLE_ORDER: string[] = [
  // Core
  "PlayerHurt",
  "PlayerDeath",

  // Combat + health
  "PlayerShootWeapon",
  "PlayerHealth",
  "PlayerHeal",
  "PlayerUsingHealthstation",

  // Gravity gloves
  "PlayerGrabbityPull",
  "PlayerGrabbityLockStart",
  "PlayerGrabbityLockStop",
  "GrabbityGloveCatch",

  // Environment / interactions
  "PlayerGrabbedByBarnacle",
  "PlayerReleasedByBarnacle",
  "PlayerCoughStart",
  "PlayerCoughEnd",
  "TwoHandStart",
  "TwoHandEnd",
  "Reset",

  // Backpack / itemholder
  "PlayerDropAmmoInBackpack",
  "PlayerDropResinInBackpack",
  "PlayerRetrievedBackpackClip",
  "PlayerStoredItemInItemholder",
  "PlayerRemovedItemFromItemholder",
  "ItemPickup",
  "ItemReleased",

  // Reload / weapon interactions
  "PlayerPistolClipInserted",
  "PlayerPistolChamberedRound",
  "PlayerShotgunShellLoaded",
  "PlayerShotgunLoadedShells",
  "PlayerShotgunUpgradeGrenadeLauncherState",
];

const EVENT_TOGGLE_LABEL_OVERRIDES: Record<string, string> = {
  PlayerUsingHealthstation: "Use Health Station",
  PlayerGrabbityLockStart: "Gravity Lock Start",
  PlayerGrabbityLockStop: "Gravity Lock Stop",
  PlayerStoredItemInItemholder: "Item Holder Store",
  PlayerRemovedItemFromItemholder: "Item Holder Remove",
  ItemPickup: "Item Pickup",
  ItemReleased: "Item Released",
  PlayerPistolClipInserted: "Pistol Reload: Clip Inserted",
  PlayerPistolChamberedRound: "Pistol Reload: Chamber Round",
  PlayerShotgunShellLoaded: "Shotgun Reload: Shell Loaded",
  PlayerShotgunLoadedShells: "Shotgun Reload: Loaded Shells",
  PlayerShotgunUpgradeGrenadeLauncherState: "Shotgun: Grenade Launcher State",
};

function getToggleLabel(eventType: string): string {
  return EVENT_TOGGLE_LABEL_OVERRIDES[eventType] || EVENT_DISPLAY_MAP[eventType]?.label || eventType;
}

function formatEventDetails(event: GameEvent): string {
  const alyxEvent = event as unknown as AlyxGameEvent;
  if (alyxEvent.type === "PlayerHurt" && alyxEvent.params?.health !== undefined) {
    return `HP: ${alyxEvent.params.health}`;
  }
  if (alyxEvent.type === "PlayerShootWeapon" && alyxEvent.params?.weapon) {
    return String(alyxEvent.params.weapon);
  }
  return "";
}

export function AlyxIntegrationPage() {
  const {
    status,
    loading,
    error,
    gameEvents,
    modInfo,
    modStatus,
    installMessage,
    savedLogPath,
    enabledEvents,
    solenoidRecoil,
    restartRequired,
    start,
    stop,
    clearEvents,
    browseLogPath,
    setEventEnabled,
    setSolenoidRecoilSettings,
    checkModInstalled,
    installMod,
  } = useAlyxIntegration();

  // Convert Alyx events to generic GameEvent format
  const events: GameEvent[] = gameEvents.map(e => ({
    id: e.id,
    type: e.type,
    ts: e.ts,
    params: e.params,
  }));

  // Mod info for setup
  const modInfoData: ModInfo | undefined = modInfo ? {
    name: "Tactsuit Lua (bundled) + skill_manifest",
    downloadUrl: modInfo.download_url,
    githubUrl: modInfo.github_url,
    installInstructions: [
      "Browse to Half-Life Alyx/game/hlvr/console.log (launch once with -condebug if the file is missing)",
      "Click Install Mod — copies tactsuit.lua into scripts/vscripts and adds script_reload_code tactsuit.lua to skill_manifest.cfg",
      "Start this integration, then Launch via Steam (-condebug is included on the button)",
    ],
    credits: {
      summary:
        "Install Mod ships the public tactsuit.lua emitter from the bHaptics Alyx scripts. We only use console events; we do not run the bHaptics/OWO companion apps.",
      links: [
        {
          label: "bHaptics Tactsuit (NexusMods)",
          url: modInfo.download_url || "https://www.nexusmods.com/halflifealyx/mods/6",
        },
        {
          label: "bhaptics-half-life-alyx (scripts)",
          url: "https://github.com/bhaptics/bhaptics-half-life-alyx",
        },
        {
          label: "HalLifeAlyx_OWO (Florian)",
          url: "https://github.com/floh-bhaptics/HalLifeAlyx_OWO",
        },
      ],
    },
  } : undefined;

  // Configuration panel for log path
  const configurationPanel = (
    <div className="space-y-4">
      <div className="rounded-lg bg-slate-800/60 p-4 ring-1 ring-white/10 space-y-3">
        <h4 className="text-sm font-medium text-slate-200">Mod installation</h4>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Console log path</label>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={savedLogPath || status.log_path || ""}
              placeholder="Browse to game/hlvr/console.log first..."
              className="flex-1 rounded-lg bg-slate-900/50 border border-slate-600 px-3 py-2 text-sm text-slate-300 placeholder-slate-500"
            />
            <button
              onClick={browseLogPath}
              disabled={loading}
              className="rounded-lg bg-slate-600 hover:bg-slate-500 px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50"
            >
              Browse...
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Usually:{" "}
            <code className="bg-slate-800 px-1 rounded">
              Steam/steamapps/common/Half-Life Alyx/game/hlvr/console.log
            </code>
          </p>
        </div>

        <div className="space-y-1 text-xs text-slate-400">
          <div>
            tactsuit.lua:{" "}
            <span className={modStatus.luaInstalled ? "text-emerald-400" : "text-amber-400"}>
              {modStatus.luaInstalled ? "installed" : "missing"}
            </span>
          </div>
          <div>
            skill_manifest.cfg:{" "}
            <span className={modStatus.skillManifestPatched ? "text-emerald-400" : "text-amber-400"}>
              {modStatus.skillManifestPatched
                ? "has script_reload_code tactsuit.lua"
                : "needs script_reload_code tactsuit.lua"}
            </span>
          </div>
          {modStatus.missingFiles && modStatus.missingFiles.length > 0 && (
            <div className="text-amber-300/90">Missing: {modStatus.missingFiles.join(", ")}</div>
          )}
          {installMessage && <div className="text-slate-300">{installMessage}</div>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={() => void installMod()}
              disabled={loading || !(savedLogPath || status.log_path)}
              className="rounded-lg bg-cyan-700/80 px-3 py-2 text-sm font-medium text-white transition hover:bg-cyan-600 disabled:opacity-50"
            >
              {modStatus.installed ? "Reinstall Mod" : "Install Mod"}
            </button>
            <button
              onClick={() => void checkModInstalled()}
              disabled={loading}
              className="rounded-lg bg-slate-600/80 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-600 disabled:opacity-50"
            >
              Recheck
            </button>
          </div>
          {!(savedLogPath || status.log_path) && (
            <p className="text-amber-200/80">
              Select console.log first — Install Mod uses that path to find{" "}
              <code className="bg-slate-800 px-1 rounded">game/hlvr</code>.
            </p>
          )}
        </div>
      </div>

      <div className="pt-2 border-t border-slate-700/60">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-200">Solenoid recoil</h3>
          <span className="text-xs text-slate-500">Independent of vest Weapon Fire</span>
        </div>
        <label className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-slate-900/40 border border-slate-700/40 px-3 py-2">
          <div className="min-w-0">
            <div className="text-sm text-slate-200">Pulse on PlayerShootWeapon</div>
            <div className="text-xs text-slate-500">Requires device connected on Recoil page</div>
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
      </div>

      <div className="pt-2 border-t border-slate-700/60">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-200">Haptics (per-event)</h3>
          <span className="text-xs text-slate-500">
            Defaults: damage/death ON, others OFF
          </span>
        </div>

        {restartRequired && status.running && (
          <div className="mt-3 rounded-lg bg-amber-900/20 border border-amber-700/30 px-3 py-2 text-xs text-amber-200">
            Settings saved. Stop and Start the Alyx integration to apply changes.
          </div>
        )}

        {!enabledEvents ? (
          <p className="mt-3 text-sm text-slate-500">Loading settings…</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            {EFFECT_TOGGLE_ORDER.map((eventType) => {
              const checked = Boolean(enabledEvents[eventType]);
              const label = getToggleLabel(eventType);
              return (
                <label
                  key={eventType}
                  className="flex items-center justify-between gap-3 rounded-lg bg-slate-900/40 border border-slate-700/40 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-slate-200 truncate">{label}</div>
                    <div className="text-xs text-slate-500 font-mono truncate">{eventType}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => setEventEnabled(eventType, e.target.checked)}
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

  // Setup guide
  const setupGuide = (
    <div className="space-y-3 text-sm">
      <ol className="list-decimal list-outside ml-4 space-y-2 text-slate-400">
        <li>
          <strong className="text-slate-300">Browse</strong> to{" "}
          <code className="bg-slate-800 px-1 rounded">game/hlvr/console.log</code>. If the file is
          missing, Launch via Steam once with <code className="bg-slate-800 px-1 rounded">-condebug</code>{" "}
          (already on the button), then browse again.
        </li>
        <li>
          Click <strong className="text-slate-300">Install Mod</strong> — copies{" "}
          <code className="bg-slate-800 px-1 rounded">tactsuit.lua</code> and adds{" "}
          <code className="bg-slate-800 px-1 rounded">script_reload_code tactsuit.lua</code> to{" "}
          <code className="bg-slate-800 px-1 rounded">skill_manifest.cfg</code> (backs up the cfg first).
        </li>
        <li>
          <strong className="text-slate-300">Start</strong> this integration, then launch the game.
        </li>
      </ol>
      <p className="text-slate-500 text-xs flex flex-wrap items-center gap-2">
        Upstream scripts (optional manual download):
        <CopyUrlButton
          label="Copy Nexus URL"
          url={modInfo?.download_url || "https://www.nexusmods.com/halflifealyx/mods/6"}
        />
      </p>
    </div>
  );

  // Additional stats
  const additionalStats = status.log_path ? (
    <div className="rounded-lg bg-slate-700/30 px-4 py-2">
      <span className="text-slate-400 text-sm">Log:</span>{" "}
      <span className="font-mono text-white text-xs truncate max-w-xs inline-block align-middle" title={status.log_path}>
        ...{status.log_path.slice(-30)}
      </span>
    </div>
  ) : undefined;

  return (
    <GameIntegrationPage
      game={game}
      status={status}
      loading={loading}
      error={error}
      events={events}
      eventDisplayMap={EVENT_DISPLAY_MAP}
      onStart={() => start()}
      onStop={stop}
      onClearEvents={clearEvents}
      formatEventDetails={formatEventDetails}
      modInfo={modInfoData}
      setupGuide={setupGuide}
      configurationPanel={configurationPanel}
      additionalStats={additionalStats}
    />
  );
}

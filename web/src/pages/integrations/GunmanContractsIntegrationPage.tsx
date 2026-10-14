import { useState } from "react";
import {
  useGunmanContractsIntegration,
  GunmanContractsGameEvent,
} from "../../hooks/useGunmanContractsIntegration";
import { GameIntegrationPage } from "../../components/GameIntegrationPage";
import {
  MelonModInstallStatus,
  formatMelonInstallMessage,
} from "../../components/MelonModInstallStatus";
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
  mag_eject: { label: "Mag Eject", icon: "📤", color: "text-cyan-300" },
  reload: { label: "Reload", icon: "🔄", color: "text-cyan-400" },
  cock_back: { label: "Cock Slide Back", icon: "⬅️", color: "text-indigo-300" },
  cock_forward: { label: "Cock Slide Forward", icon: "➡️", color: "text-indigo-400" },
  slide_lock: { label: "Slide Lock (Empty)", icon: "🔒", color: "text-rose-300" },
  slide_release: { label: "Slide Release", icon: "🔓", color: "text-rose-400" },
  ammo_pouch: { label: "Chest Ammo Pouch", icon: "🎒", color: "text-teal-300" },
  heartbeat: { label: "Low Health Heartbeat", icon: "❤️", color: "text-pink-400" },
  heartbeat_start: { label: "Heartbeat Start", icon: "❤️", color: "text-pink-300" },
  heartbeat_stop: { label: "Heartbeat Stop", icon: "💔", color: "text-pink-500" },
  healing: { label: "Healing", icon: "💚", color: "text-green-400" },
  empty_fire: { label: "Empty Click", icon: "🔘", color: "text-slate-400" },
};

/** Toggle order on the integration page (control events share the heartbeat toggle). */
const EFFECT_TOGGLE_ORDER: string[] = [
  "gun_fire",
  "shotgun_fire",
  "rifle_fire",
  "bow_fire",
  "player_hit",
  "holster_in",
  "holster_out",
  "mag_eject",
  "reload",
  "cock_back",
  "cock_forward",
  "slide_lock",
  "slide_release",
  "ammo_pouch",
  "heartbeat",
  "healing",
];

const EVENT_TOGGLE_HINTS: Record<string, string> = {
  holster_in: "Guns and knives",
  holster_out: "Guns and knives",
  mag_eject: "Release mag / grab",
  reload: "Mag insert / shotgun shell",
  slide_lock: "Last round — slide stays open",
  slide_release: "Slide pushed forward on empty reload",
  ammo_pouch: "Chest pouch + pickups",
  heartbeat: "Loops on last health bar",
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
  } = useGunmanContractsIntegration();

  const [installMessage, setInstallMessage] = useState<string | null>(null);

  const handleInstallMod = async () => {
    setInstallMessage(null);
    const result = await installMod();
    setInstallMessage(formatMelonInstallMessage(result));
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
    credits: {
      summary:
        "Vest Harmony hooks follow Florian’s (floh-bhaptics) Gunman Contracts bHaptics mod. Solenoid fire and dual-wield feel are inspired by Astienth’s Provolver bridge.",
      links: [
        {
          label: "GunmanContracts_bhaptics (Florian)",
          url: "https://github.com/floh-bhaptics/GunmanContracts_bhaptics",
        },
        {
          label: "GunmanContracts_Provolver (Astienth)",
          url: "https://github.com/Astienth/GunmanContracts_Provolver",
        },
      ],
    },
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
        <MelonModInstallStatus
          gameDir={gameDir}
          modDllName="ThirdSpace_GunmanContracts.dll"
          modStatus={modStatus}
          loading={loading}
          installMessage={installMessage}
          onInstall={() => void handleInstallMod()}
          onRecheck={checkModInstalled}
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-200">Solenoid recoil</h3>
          <span className="text-xs text-slate-500">USB relay on the Recoil page</span>
        </div>
        <label className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-slate-900/40 border border-slate-700/40 px-3 py-2">
          <div className="min-w-0">
            <div className="text-sm text-slate-200">Pulse USB relay on fire</div>
            <div className="text-xs text-slate-500">Short pulse on pistol / shotgun / rifle fire</div>
          </div>
          <input
            type="checkbox"
            checked={solenoidRecoil.enabled}
            onChange={(e) => setSolenoidRecoilSettings({ enabled: e.target.checked })}
            className="h-4 w-4"
          />
        </label>
        <label className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-slate-900/40 border border-slate-700/40 px-3 py-2">
          <div className="min-w-0">
            <div className="text-sm text-slate-200">Hold USB relay on empty slide lock</div>
            <div className="text-xs text-slate-500">
              ON at `slide_lock` (last round). OFF at `SetSlideBack(0)` / `cock_forward` when the slide
              is pushed forward — not at reload button press.
            </div>
          </div>
          <input
            type="checkbox"
            checked={Boolean(solenoidRecoil.holdOnReload)}
            onChange={(e) => setSolenoidRecoilSettings({ holdOnReload: e.target.checked })}
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
        Gunman Contracts Standalone talks to the daemon over TCP 5050. A MelonLoader mod inside the game
        sends fire, holster, reload, cocking, pouch, hit, and low-health heartbeat events.
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

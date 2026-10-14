import { useState } from "react";
import {
  useTitanfall2Integration,
  Titanfall2GameEvent,
} from "../../hooks/useTitanfall2Integration";
import { GameIntegrationPage } from "../../components/GameIntegrationPage";
import { getIntegratedGame } from "../../data/integratedGames";
import type { GameEvent, EventDisplayInfo, ModInfo } from "../../types/integratedGames";

const game = getIntegratedGame("titanfall2")!;

const EVENT_DISPLAY_MAP: Record<string, EventDisplayInfo> = {
  recoil_pistol: { label: "Pistol Recoil", icon: "🔫", color: "text-amber-400" },
  recoil_rifle: { label: "Rifle Recoil", icon: "🎯", color: "text-yellow-400" },
  recoil_shotgun: { label: "Shotgun Recoil", icon: "💥", color: "text-orange-400" },
  recoil_heavy: { label: "Heavy Recoil", icon: "💣", color: "text-orange-500" },
  recoil_titan: { label: "Titan Shot", icon: "🦾", color: "text-violet-400" },
  recoil_titan_rockets: { label: "Titan Rockets", icon: "🚀", color: "text-violet-500" },
  charge: { label: "Charge Weapon", icon: "⚡", color: "text-cyan-400" },
  impact: { label: "Hit Taken", icon: "💥", color: "text-red-400" },
  explosion: { label: "Explosion", icon: "🔥", color: "text-red-500" },
  heartbeat: { label: "Low Health", icon: "❤️", color: "text-pink-400" },
  healing: { label: "Healing", icon: "💚", color: "text-green-400" },
  player_spawned: { label: "Spawn", icon: "✨", color: "text-slate-300" },
  player_killed: { label: "Death", icon: "💀", color: "text-red-500" },
  player_enter_titan: { label: "Enter Titan", icon: "🤖", color: "text-indigo-400" },
  player_exit_titan: { label: "Exit Titan", icon: "🚪", color: "text-indigo-300" },
  shield_damage: { label: "Shield Hit", icon: "🛡️", color: "text-sky-400" },
  player_jump: { label: "Jump", icon: "⬆️", color: "text-slate-400" },
  player_dodge: { label: "Dodge", icon: "💨", color: "text-slate-300" },
  player_land: { label: "Land", icon: "⬇️", color: "text-slate-400" },
  player_mantle: { label: "Mantle", icon: "🧗", color: "text-slate-300" },
  begin_wallrun: { label: "Wallrun Start", icon: "🏃", color: "text-teal-300" },
  end_wallrun: { label: "Wallrun End", icon: "🛑", color: "text-teal-500" },
  zipline: { label: "Zipline", icon: "🪢", color: "text-teal-400" },
  titan_hit: { label: "Titan Hit", icon: "💢", color: "text-rose-400" },
  titan_destroyed: { label: "Titan Destroyed", icon: "☠️", color: "text-rose-500" },
  titan_melee: { label: "Titan Melee", icon: "👊", color: "text-amber-300" },
  titan_footstep: { label: "Titan Step", icon: "👣", color: "text-stone-400" },
  titanfall: { label: "Titanfall", icon: "☄️", color: "text-orange-400" },
};

function formatEventDetails(event: GameEvent): string {
  const params = event.params as {
    hand?: string;
    angle?: number;
    intensity?: number;
    group?: string;
  };
  const parts: string[] = [];
  if (params?.hand) parts.push(params.hand);
  if (params?.group) parts.push(params.group);
  if (typeof params?.angle === "number") parts.push(`${Math.round(params.angle)}°`);
  if (typeof params?.intensity === "number") parts.push(`${Math.round(params.intensity * 100)}%`);
  return parts.join(" ");
}

export function Titanfall2IntegrationPage() {
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
    checkModInstalled,
    start,
    stop,
    clearEvents,
  } = useTitanfall2Integration();

  const [installMessage, setInstallMessage] = useState<string | null>(null);

  const handleInstallMod = async () => {
    setInstallMessage(null);
    const result = await installMod();
    if (result.success) {
      const names = result.profilesInstalled?.join(", ") || result.destination || "profiles";
      const warn = result.warning ? ` (${result.warning})` : "";
      setInstallMessage(`Installed into ${names}${warn}`);
    } else {
      setInstallMessage(result.error || "Install failed");
    }
  };

  const events: GameEvent[] = gameEvents.map((e: Titanfall2GameEvent) => ({
    id: e.id,
    type: e.type,
    ts: e.ts,
    params: e.params,
  }));

  const modInfo: ModInfo = {
    name: "ThirdSpace_Titanfall2 (Northstar)",
    downloadUrl: "https://github.com/CircuitLord/CircuitLordVRModInstaller",
    githubUrl: "https://github.com/floh-bhaptics/Titanfall2VR_bhaptics",
    installInstructions: [
      "For VR: install Titanfall 2 VR (CircuitLord) — creates TF2VR",
      "For flat: install Northstar — creates R2Northstar",
      "Build titanfall2-mod (msbuild Release|x64) so ThirdSpace_Titanfall2.dll exists",
      "Select the Titanfall 2 folder and click Install Mod (copies into every profile found)",
      "Start the vest daemon, click Start here, then launch VR or Northstar as usual",
    ],
    credits: {
      summary:
        "Event detection and Squirrel hooks are adapted from Florian’s (floh-bhaptics) Titanfall 2 VR bHaptics/ProTube plugin. VR play uses CircuitLord’s Titanfall 2 VR (Northstar TF2VR profile).",
      links: [
        {
          label: "Titanfall2VR_bhaptics (Florian)",
          url: "https://github.com/floh-bhaptics/Titanfall2VR_bhaptics",
        },
        {
          label: "Titanfall 2 VR (CircuitLord)",
          url: "https://github.com/CircuitLord/CircuitLordVRModInstaller",
        },
      ],
    },
  };

  const kindLabel = (kind: string) => {
    if (kind === "vr") return "VR (TF2VR)";
    if (kind === "flat") return "Flat (R2Northstar)";
    return kind;
  };

  const configurationPanel = (
    <div className="space-y-4">
      <div className="rounded-lg bg-slate-800/60 p-4 ring-1 ring-white/10">
        <h4 className="text-sm font-medium text-slate-200 mb-3">Northstar plugin installation</h4>
        <div className="mb-3">
          <label className="text-xs text-slate-400 block mb-1">Titanfall 2 game directory</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={gameDir}
              readOnly
              placeholder="Browse to the Titanfall 2 folder (not only TF2VR)"
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
            Install Mod copies into every Northstar profile it finds (TF2VR and R2Northstar).
          </p>
        </div>
        {modStatus.profiles && modStatus.profiles.length > 0 ? (
          <ul className="mb-3 space-y-1 text-xs">
            {modStatus.profiles.map((p) => (
              <li key={p.dir} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className={p.installed ? "text-emerald-400" : "text-amber-400"}>
                  {p.installed ? "✓" : "○"} {kindLabel(p.kind)} — {p.name}
                </span>
                <span className="text-slate-500 truncate">{p.dir}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-xs text-amber-400">
            No Northstar profiles detected yet. Browse to the Titanfall 2 folder after installing VR and/or Northstar.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleInstallMod}
            disabled={loading || !gameDir}
            className="rounded-lg bg-blue-600/80 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-50"
          >
            Install Mod (all profiles)
          </button>
          <button
            onClick={() => void checkModInstalled()}
            disabled={loading}
            className="rounded-lg bg-slate-600/80 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-600 disabled:opacity-50"
          >
            Recheck
          </button>
        </div>
        {installMessage && (
          <p className="mt-2 text-xs text-slate-300">{installMessage}</p>
        )}
        {!modStatus.sourceAvailable && (
          <p className="mt-2 text-xs text-amber-400/90">
            Build the plugin first: see titanfall2-mod/README.md
          </p>
        )}
      </div>

      <div className="rounded-lg bg-slate-800/60 p-4 ring-1 ring-white/10">
        <h4 className="text-sm font-medium text-slate-200 mb-3">Gun solenoid recoil</h4>
        <label className="flex items-center gap-2 text-sm text-slate-300 mb-2">
          <input
            type="checkbox"
            checked={solenoidRecoil.enabled}
            onChange={(e) =>
              void setSolenoidRecoilSettings({
                ...solenoidRecoil,
                enabled: e.target.checked,
              })
            }
          />
          Enable USB-relay kick on pilot / Titan shots
        </label>
        <label className="text-xs text-slate-400 block mb-1">
          Base pulse (ms): {solenoidRecoil.durationMs}
        </label>
        <input
          type="range"
          min={25}
          max={120}
          value={solenoidRecoil.durationMs}
          onChange={(e) =>
            void setSolenoidRecoilSettings({
              ...solenoidRecoil,
              durationMs: Number(e.target.value),
            })
          }
          className="w-full"
        />
      </div>
    </div>
  );

  const setupGuide = (
    <div className="space-y-3 text-sm">
      <p className="text-slate-300">
        One Northstar plugin forwards Florian-style haptic events to the daemon on TCP 5050. The same build runs in CircuitLord VR and flat Northstar; Install Mod deploys to both profiles.
      </p>
      <ol className="list-decimal list-inside space-y-2 text-slate-400">
        <li>
          <strong className="text-slate-300">VR:</strong> CircuitLord installer →{" "}
          <code className="bg-slate-800 px-1 rounded">TF2VR</code>.{" "}
          <strong className="text-slate-300">Flat:</strong> Northstar →{" "}
          <code className="bg-slate-800 px-1 rounded">R2Northstar</code>.
        </li>
        <li>
          <strong className="text-slate-300">Build</strong>{" "}
          <code className="bg-slate-800 px-1 rounded">titanfall2-mod</code> (Release|x64) to produce{" "}
          <code className="bg-slate-800 px-1 rounded">ThirdSpace_Titanfall2.dll</code>.
        </li>
        <li>
          <strong className="text-slate-300">Install Mod</strong> into the Titanfall 2 folder, Start this integration, then launch VR or Northstar.
        </li>
      </ol>
      <p className="text-slate-500 text-xs">
        Flat play still needs Northstar (not stock Steam alone). VR handedness is used when CircuitLord&apos;s API is present; otherwise recoil defaults to the right side.
      </p>
      <p className="text-slate-500 text-xs">
        Based on Florian&apos;s{" "}
        <a className="underline text-sky-400" href="https://github.com/floh-bhaptics/Titanfall2VR_bhaptics" target="_blank" rel="noreferrer">
          Titanfall2VR_bhaptics
        </a>{" "}
        and CircuitLord&apos;s{" "}
        <a className="underline text-sky-400" href="https://github.com/CircuitLord/CircuitLordVRModInstaller" target="_blank" rel="noreferrer">
          Titanfall 2 VR
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

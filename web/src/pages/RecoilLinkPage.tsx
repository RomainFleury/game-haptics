import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  recoilConnect,
  recoilDisconnect,
  recoilFirmwareListImages,
  recoilFirmwareListTargets,
  recoilListPorts,
  recoilPulse,
  recoilStatus,
  type RecoilFirmwareImage,
  type RecoilFirmwareTarget,
  type RecoilLinkStatus,
  type RecoilSerialHint,
  type RelayPortInfo,
} from "../lib/bridgeApi";

const DEFAULT_PULSE_MS = 25;
const POLL_MS = 2000;

function isEmitterBootloader(t: RecoilFirmwareTarget): boolean {
  if (t.suggestedRole === "dongle") return true;
  const label = (t.volumeLabel || "").toUpperCase();
  return label.includes("UF2BOOT") || label.includes("MDK");
}

function isReceiverBootloader(t: RecoilFirmwareTarget): boolean {
  if (t.suggestedRole === "receiver" || t.suggestedRole === "receiver_nosd") return true;
  const label = (t.volumeLabel || "").toUpperCase();
  return label.includes("NICENANO") || label.includes("NICE!NANO");
}

function driveLabel(t: RecoilFirmwareTarget): string {
  const letter = t.driveLetter ? `${t.driveLetter}:` : "";
  const name = t.volumeLabel || "UF2";
  return letter ? `${letter} ${name}` : name;
}

type BoardReadyCardProps = {
  title: string;
  howTo: string;
  ready: boolean;
  detail: string;
  flashTo: string;
  flashLabel: string;
  flashEnabled: boolean;
};

function BoardReadyCard({
  title,
  howTo,
  ready,
  detail,
  flashTo,
  flashLabel,
  flashEnabled,
}: BoardReadyCardProps) {
  return (
    <div
      className={`rounded-xl p-4 ring-1 space-y-3 ${
        ready
          ? "bg-emerald-500/10 ring-emerald-500/40"
          : "bg-slate-900/60 ring-white/5"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <p className="mt-1 text-sm text-slate-400">{howTo}</p>
        </div>
        <span
          className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${
            ready
              ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/50"
              : "bg-slate-700 text-slate-300 ring-1 ring-slate-600"
          }`}
        >
          {ready ? "Ready to flash" : "Not in bootloader"}
        </span>
      </div>
      <p className={`text-sm ${ready ? "text-emerald-100" : "text-slate-400"}`}>{detail}</p>
      <Link
        to={flashTo}
        className={`inline-flex rounded-lg px-3 py-2 text-sm font-medium ${
          flashEnabled
            ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
            : "bg-slate-700 text-slate-300 pointer-events-none opacity-50"
        }`}
        aria-disabled={!flashEnabled}
      >
        {flashLabel}
      </Link>
    </div>
  );
}

export function RecoilLinkPage() {
  const [ports, setPorts] = useState<RelayPortInfo[]>([]);
  const [targets, setTargets] = useState<RecoilFirmwareTarget[]>([]);
  const [serialHints, setSerialHints] = useState<RecoilSerialHint[]>([]);
  const [images, setImages] = useState<RecoilFirmwareImage[]>([]);
  const [linkPort, setLinkPort] = useState("");
  const [link, setLink] = useState<RecoilLinkStatus | null>(null);
  const [linkMs, setLinkMs] = useState(DEFAULT_PULSE_MS);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const linkConnected = Boolean(link?.connected);

  const emitterBoot = useMemo(() => targets.find(isEmitterBootloader) ?? null, [targets]);
  const receiverBoot = useMemo(() => targets.find(isReceiverBootloader) ?? null, [targets]);
  const recoilPorts = useMemo(
    () => ports.filter((p) => p.likely_recoil),
    [ports]
  );
  const hasDongleImage = images.some((img) => img.role === "dongle");
  const hasReceiverImage = images.some(
    (img) => img.role === "receiver" || img.role === "receiver_nosd"
  );

  const refreshStatus = useCallback(async () => {
    const linkResult = await recoilStatus();
    if (linkResult.success && linkResult.recoil) {
      setLink(linkResult.recoil);
      if (linkResult.recoil.port) {
        setLinkPort(linkResult.recoil.port);
      }
    }
  }, []);

  const refreshPorts = useCallback(async () => {
    try {
      const result = await recoilListPorts();
      if (!result.success) {
        setPorts([]);
        return;
      }
      setPorts(result.ports);
      const preferred = result.ports.find((port) => port.likely_recoil);
      setLinkPort((current) => {
        if (current && result.ports.some((port) => port.device === current)) {
          return current;
        }
        return preferred?.device || result.ports[0]?.device || "";
      });
    } catch {
      setPorts([]);
    }
  }, []);

  const refreshBoards = useCallback(async () => {
    try {
      const [tgtRes, imgRes] = await Promise.all([
        recoilFirmwareListTargets(),
        recoilFirmwareListImages(),
      ]);
      if (tgtRes.success) {
        setTargets(tgtRes.targets || []);
        setSerialHints(tgtRes.serialHints || []);
      }
      if (imgRes.success) setImages(imgRes.images || []);
    } catch {
      /* keep last known */
    }
  }, []);

  useEffect(() => {
    void refreshPorts();
    void refreshStatus();
    void refreshBoards();
    const id = window.setInterval(() => {
      void refreshPorts();
      void refreshStatus();
      void refreshBoards();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshPorts, refreshStatus, refreshBoards]);

  const nextStep = useMemo(() => {
    if (emitterBoot) {
      return {
        title: "Emitter is ready — install firmware now",
        body: `Bootloader drive detected (${driveLabel(emitterBoot)}). Open flash and install the USB emitter image.`,
        cta: { to: "/recoil-link/flash?board=emitter", label: "Install emitter firmware" },
      };
    }
    if (receiverBoot) {
      return {
        title: "Receiver is ready — install firmware now",
        body: `Bootloader drive detected (${driveLabel(receiverBoot)}). Open flash and install the receiver image.`,
        cta: { to: "/recoil-link/flash?board=receiver", label: "Install receiver firmware" },
      };
    }
    if (linkConnected) {
      return {
        title: "Kit linked — try a short pulse",
        body: "Keep the solenoid disconnected for the first pulse. Then wire MOSFET + coil.",
        cta: null,
      };
    }
    if (recoilPorts.length > 0) {
      return {
        title: "Emitter looks flashed — connect it",
        body: `Suggested port ${recoilPorts[0].device}. Use Connect below so games use the wireless path.`,
        cta: null,
      };
    }
    if (serialHints.length > 0 && !emitterBoot) {
      const portsHint = serialHints.map((h) => h.port).join(", ");
      return {
        title: `Emitter plugged (${portsHint}) — Nordic Open DFU (correct for PCA10059)`,
        body: "This lab emitter never mounts a UF2 drive. Press sideways RESET for red LED + COM, then run: recoil-link/firmware/flash-emitter.ps1 -Port COMx (after build.ps1). Full steps: recoil-link/SETUP.md. Receiver UF2 flash is still in Install kit firmware.",
        cta: { to: "/recoil-link/flash?board=receiver", label: "Flash receiver (UF2)" },
      };
    }
    return {
      title: "Put a board into bootloader mode",
      body: "Emitter: hold the button, plug USB, release. Receiver: double-tap reset. This page updates when the drive appears.",
      cta: { to: "/recoil-link/flash", label: "Open firmware installer" },
    };
  }, [emitterBoot, receiverBoot, linkConnected, recoilPorts, serialHints]);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold text-white">Recoil Kit Setup</h1>
        <p className="mt-2 text-sm md:text-base text-slate-400">
          Flash the wireless USB emitter and receiver, then connect the dongle. The wired USB
          relay stays on the{" "}
          <Link to="/recoil" className="text-sky-400 hover:text-sky-300">
            Recoil
          </Link>{" "}
          page — do not use that page for this kit.
        </p>
      </header>

      <section className="rounded-2xl bg-sky-500/10 p-4 md:p-5 ring-1 ring-sky-500/30 space-y-3">
        <p className="text-xs uppercase tracking-wide text-sky-300">What to do now</p>
        <h2 className="text-lg font-semibold text-white">{nextStep.title}</h2>
        <p className="text-sm text-slate-300">{nextStep.body}</p>
        {nextStep.cta && (
          <Link
            to={nextStep.cta.to}
            className="inline-flex rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400"
          >
            {nextStep.cta.label}
          </Link>
        )}
        <p className="text-xs text-slate-500">
          Board detection refreshes every few seconds. Firmware files:{" "}
          {hasDongleImage ? "emitter OK" : "emitter missing"} ·{" "}
          {hasReceiverImage ? "receiver OK" : "receiver missing"}.
        </p>
      </section>

      <section className="rounded-2xl bg-slate-800/80 p-4 md:p-5 shadow-lg ring-1 ring-white/5 space-y-4">
        <div>
          <p className="text-sm uppercase tracking-wide text-slate-400">Live detection</p>
          <h2 className="text-xl font-semibold text-white">Boards plugged in</h2>
          <p className="mt-1 text-sm text-slate-400">
            Status turns green when a board is in UF2 bootloader mode (ready to receive
            firmware). Flash one board at a time; keep the spare receiver unpowered.
          </p>
        </div>

        <BoardReadyCard
          title="1. USB emitter (Nordic PCA10059)"
          howTo="Sideways RESET → red LED pulse + COM port. No UF2 drive. Flash with firmware/flash-emitter.ps1 (see SETUP.md)."
          ready={serialHints.length > 0 && !linkConnected}
          detail={
            linkConnected
              ? "Linked to daemon — games use wireless path."
              : serialHints.length > 0
                ? `Open DFU / Nordic serial: ${serialHints
                    .map((h) => `${h.port} (${h.vidPid})`)
                    .join(", ")}. Run flash-emitter.ps1, then replug without RESET.`
                : recoilPorts.length > 0
                  ? `Running as CDC: ${recoilPorts
                      .map((p) => p.device)
                      .join(", ")}. Connect below after both boards are flashed.`
                  : "Waiting for dongle COM port…"
          }
          flashTo="/recoil-link/flash?board=receiver"
          flashLabel="Emitter uses CLI (flash-emitter.ps1)"
          flashEnabled={false}
        />

        <BoardReadyCard
          title="2. Receiver (Nice!Nano)"
          howTo="No reset button on many clones: briefly short RST to GND twice (tweezers), like a double-tap. Look for a NICENANO drive. Flash only one receiver."
          ready={Boolean(receiverBoot)}
          detail={
            receiverBoot
              ? `Detected ${driveLabel(receiverBoot)} — ${receiverBoot.reason}`
              : "Waiting… no NICENANO drive yet. On your board RST is next to GND on the pin row by the USB end."
          }
          flashTo="/recoil-link/flash?board=receiver"
          flashLabel="Install receiver firmware"
          flashEnabled={Boolean(receiverBoot) && hasReceiverImage}
        />
      </section>

      <section className="rounded-2xl bg-slate-800/80 p-4 md:p-5 shadow-lg ring-1 ring-white/5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-wide text-slate-400">After both boards are flashed</p>
            <h2 className="text-xl font-semibold text-white">3. Connect USB emitter</h2>
            <p className="mt-1 text-sm text-slate-400">
              Plug the emitter normally (no button). Pick its COM port and Connect so game
              recoil uses the radio link.
            </p>
          </div>
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-medium ${
              linkConnected
                ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40"
                : "bg-slate-700 text-slate-300 ring-1 ring-slate-600"
            }`}
          >
            {linkConnected ? "Linked" : "Not linked"}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <label className="block space-y-1.5">
            <span className="text-sm text-slate-400">Dongle COM port</span>
            <select
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white"
              value={linkPort}
              onChange={(e) => setLinkPort(e.target.value)}
              disabled={busy || linkConnected}
            >
              {ports.length === 0 ? (
                <option value="">No COM ports</option>
              ) : (
                ports.map((port) => (
                  <option key={port.device} value={port.device}>
                    {port.likely_recoil ? "Recoil Link — " : ""}
                    {port.device} — {port.description}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm text-slate-400">Pulse (ms)</span>
            <input
              type="number"
              min={5}
              max={100}
              className="w-24 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white"
              value={linkMs}
              onChange={(e) => setLinkMs(Number(e.target.value))}
              disabled={busy}
            />
          </label>
          <div className="flex items-end gap-2">
            <button
              type="button"
              className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white disabled:opacity-50"
              disabled={busy}
              onClick={() => {
                void refreshPorts();
                void refreshBoards();
              }}
            >
              Refresh
            </button>
            {linkConnected ? (
              <>
                <button
                  type="button"
                  className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => {
                    void (async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        const ms = Math.max(5, Math.min(100, linkMs));
                        const result = await recoilPulse(ms);
                        if (!result.success) {
                          setError(result.error || "Pulse failed");
                          return;
                        }
                        setLink(result.recoil ?? link);
                        setMessage(`Pulse ${ms} ms sent`);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  Pulse
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() => {
                    void (async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        const result = await recoilDisconnect();
                        if (!result.success) {
                          setError(result.error || "Disconnect failed");
                          return;
                        }
                        setLink(null);
                        setMessage("Link closed");
                      } catch (err) {
                        setError(err instanceof Error ? err.message : String(err));
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                type="button"
                className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
                disabled={busy || !linkPort}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      const result = await recoilConnect(linkPort);
                      if (!result.success) {
                        setError(result.error || "Connect failed");
                        return;
                      }
                      setLink(result.recoil ?? { connected: true, port: linkPort });
                      setMessage(`Linked on ${linkPort}`);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                Connect
              </button>
            )}
          </div>
        </div>
      </section>

      {message && (
        <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 ring-1 ring-emerald-500/30">
          {message}
        </p>
      )}
      {error && (
        <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-200 ring-1 ring-rose-500/30">
          {error}
        </p>
      )}
    </div>
  );
}

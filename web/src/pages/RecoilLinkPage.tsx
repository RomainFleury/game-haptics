import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  recoilFirmwareFlashEmitter,
  recoilFirmwareListImages,
  recoilFirmwareListTargets,
  recoilListPorts,
  type RecoilFirmwareImage,
  type RecoilFirmwareTarget,
  type RecoilSerialHint,
  type RelayPortInfo,
} from "../lib/bridgeApi";

const POLL_MS = 2000;

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

type WatcherCardProps = {
  title: string;
  howTo: string;
  statusLabel: string;
  statusTone: "ready" | "ok" | "idle";
  detail: string;
  actionLabel?: string;
  actionEnabled?: boolean;
  actionTo?: string;
  onAction?: () => void;
};

function WatcherCard({
  title,
  howTo,
  statusLabel,
  statusTone,
  detail,
  actionLabel,
  actionEnabled = false,
  actionTo,
  onAction,
}: WatcherCardProps) {
  const toneClass =
    statusTone === "ready"
      ? "bg-emerald-500/10 ring-emerald-500/40"
      : statusTone === "ok"
        ? "bg-sky-500/10 ring-sky-500/40"
        : "bg-slate-900/60 ring-white/5";
  const badgeClass =
    statusTone === "ready"
      ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/50"
      : statusTone === "ok"
        ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/50"
        : "bg-slate-700 text-slate-300 ring-1 ring-slate-600";
  const btnClass = `inline-flex rounded-lg px-3 py-2 text-sm font-medium ${
    actionEnabled
      ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
      : "bg-slate-700 text-slate-300 pointer-events-none opacity-50"
  }`;

  return (
    <div className={`rounded-xl p-4 ring-1 space-y-3 ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <p className="mt-1 text-sm text-slate-400">{howTo}</p>
        </div>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${badgeClass}`}>
          {statusLabel}
        </span>
      </div>
      <p
        className={`text-sm ${
          statusTone === "idle" ? "text-slate-400" : "text-slate-100"
        }`}
      >
        {detail}
      </p>
      {actionLabel &&
        (onAction ? (
          <button
            type="button"
            className={btnClass}
            disabled={!actionEnabled}
            onClick={onAction}
          >
            {actionLabel}
          </button>
        ) : (
          <Link to={actionTo || "/recoil-link/flash"} className={btnClass} aria-disabled={!actionEnabled}>
            {actionLabel}
          </Link>
        ))}
    </div>
  );
}

const SHOPPING_LIST = [
  {
    title: "nRF52840 Nice!Nano–style board",
    role: "Receiver",
    note: "Pro Micro pinout, USB-C. Short RST→GND twice for UF2 (NICENANO).",
  },
  {
    title: "Nordic nRF52840 Dongle PCA10059",
    role: "Emitter",
    note: "Blue Nordic USB-A dongle. Open DFU via sideways RESET — not a Makerdiary Micro Dev.",
  },
  {
    title: "Battery pack",
    role: "Power",
    note: "Powers the receiver + solenoid rail (typically 5 V buck for the coil).",
  },
  {
    title: "Solenoid",
    role: "Actuator",
    note: "e.g. JF-0826B class. Keep pulse short — coils overheat.",
  },
  {
    title: "Logic-level MOSFET + flyback diode",
    role: "Driver",
    note: "Gate from receiver P0.10 (with pulldown). Wiring guide coming after receiver flash UX is solid.",
  },
] as const;

export function RecoilLinkPage() {
  const [ports, setPorts] = useState<RelayPortInfo[]>([]);
  const [targets, setTargets] = useState<RecoilFirmwareTarget[]>([]);
  const [serialHints, setSerialHints] = useState<RecoilSerialHint[]>([]);
  const [images, setImages] = useState<RecoilFirmwareImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const receiverBoot = useMemo(() => targets.find(isReceiverBootloader) ?? null, [targets]);
  const openDfuHints = useMemo(
    () => serialHints.filter((h) => h.mode === "open_dfu"),
    [serialHints]
  );
  const recoilTxHints = useMemo(
    () => serialHints.filter((h) => h.mode === "recoil_tx"),
    [serialHints]
  );
  const recoilPorts = useMemo(() => ports.filter((p) => p.likely_recoil), [ports]);
  const hasDongleImage = images.some((img) => img.role === "dongle");
  const hasReceiverImage = images.some(
    (img) => img.role === "receiver" || img.role === "receiver_nosd"
  );
  const emitterReady = openDfuHints.length > 0 && hasDongleImage;
  const emitterFlashed = recoilTxHints.length > 0 || recoilPorts.length > 0;

  const refreshPorts = useCallback(async () => {
    try {
      const result = await recoilListPorts();
      if (!result.success) {
        setPorts([]);
        return;
      }
      setPorts(result.ports);
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
    void refreshBoards();
    const id = window.setInterval(() => {
      void refreshPorts();
      void refreshBoards();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshPorts, refreshBoards]);

  const flashEmitter = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await recoilFirmwareFlashEmitter();
      if (!result.success) {
        setError(result.error || "Emitter flash failed");
        return;
      }
      setMessage(
        result.message ||
          "Emitter flash complete — look for Recoil Link TX, then connect on the Recoil page"
      );
      void refreshPorts();
      void refreshBoards();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [refreshPorts, refreshBoards]);

  const nextStep = useMemo(() => {
    if (openDfuHints.length > 0) {
      return {
        title: "Emitter Open DFU ready — install firmware",
        body: `Red-pulse DFU on ${openDfuHints.map((h) => h.port).join(", ")}. Install uses nrfutil + recoil-dongle-dfu.zip.`,
        showFlashEmitter: true,
      };
    }
    if (receiverBoot) {
      return {
        title: "Receiver UF2 ready — install firmware",
        body: `Bootloader drive ${driveLabel(receiverBoot)}. Install the receiver image, then test on Recoil.`,
        showFlashEmitter: false,
        cta: { to: "/recoil-link/flash?board=receiver", label: "Install receiver firmware" },
      };
    }
    if (emitterFlashed && !receiverBoot) {
      return {
        title: "Emitter looks flashed — flash the receiver next",
        body: "Put the Nice!Nano into UF2 (RST→GND twice). When both boards are done, connect on the Recoil page.",
        showFlashEmitter: false,
        cta: { to: "/recoil", label: "Open Recoil to connect" },
      };
    }
    return {
      title: "Put a board into bootloader mode",
      body: "Emitter: sideways RESET → red LED pulse (Open DFU). Receiver: short RST→GND twice → NICENANO.",
      showFlashEmitter: false,
      cta: { to: "/recoil-link/flash", label: "Open firmware installer" },
    };
  }, [openDfuHints, receiverBoot, emitterFlashed]);

  const emitterStatus = openDfuHints.length
    ? { label: "Ready to flash", tone: "ready" as const }
    : emitterFlashed
      ? { label: "Recoil Link TX", tone: "ok" as const }
      : { label: "Not seen", tone: "idle" as const };

  const receiverStatus = receiverBoot
    ? { label: "UF2 ready", tone: "ready" as const }
    : { label: "Not seen", tone: "idle" as const };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold text-white">Kit Setup</h1>
        <p className="mt-2 text-sm md:text-base text-slate-400">
          Watch for compatible hardware, flash firmware, and gather parts. Day-to-day pulse and
          click testing lives on{" "}
          <Link to="/recoil" className="text-sky-400 hover:text-sky-300">
            Recoil
          </Link>
          .
        </p>
      </header>

      <section className="rounded-2xl bg-sky-500/10 p-4 md:p-5 ring-1 ring-sky-500/30 space-y-3">
        <p className="text-xs uppercase tracking-wide text-sky-300">What to do now</p>
        <h2 className="text-lg font-semibold text-white">{nextStep.title}</h2>
        <p className="text-sm text-slate-300">{nextStep.body}</p>
        <div className="flex flex-wrap gap-2">
          {nextStep.showFlashEmitter && (
            <button
              type="button"
              className="inline-flex rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
              disabled={busy || !emitterReady}
              onClick={() => void flashEmitter()}
            >
              {busy ? "Installing…" : "Install emitter firmware"}
            </button>
          )}
          {"cta" in nextStep && nextStep.cta && (
            <Link
              to={nextStep.cta.to}
              className="inline-flex rounded-lg bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400"
            >
              {nextStep.cta.label}
            </Link>
          )}
          <button
            type="button"
            className="inline-flex rounded-lg border border-slate-500 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            disabled={busy}
            onClick={() => {
              void refreshPorts();
              void refreshBoards();
            }}
          >
            Refresh now
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Detection refreshes every few seconds. Firmware files:{" "}
          {hasDongleImage ? "emitter OK" : "emitter missing"} ·{" "}
          {hasReceiverImage ? "receiver OK" : "receiver missing"}.
        </p>
      </section>

      <section className="rounded-2xl bg-slate-800/80 p-4 md:p-5 shadow-lg ring-1 ring-white/5 space-y-4">
        <div>
          <p className="text-sm uppercase tracking-wide text-slate-400">USB watcher</p>
          <h2 className="text-xl font-semibold text-white">Compatible hardware</h2>
          <p className="mt-1 text-sm text-slate-400">
            Emitter: Open DFU or Recoil Link TX. Receiver: UF2 volume. Flash one board at a time;
            keep the spare receiver unpowered.
          </p>
        </div>

        <WatcherCard
          title="USB emitter (Nordic PCA10059)"
          howTo="Sideways RESET → red LED pulse + COM (VID 1915:521F). No UF2 drive."
          statusLabel={emitterStatus.label}
          statusTone={emitterStatus.tone}
          detail={
            openDfuHints.length > 0
              ? `Open DFU: ${openDfuHints
                  .map((h) => `${h.port} (${h.vidPid})`)
                  .join(", ")}. Install emitter firmware now.`
              : emitterFlashed
                ? `Recoil Link TX on ${
                    recoilTxHints.map((h) => h.port).join(", ") ||
                    recoilPorts.map((p) => p.device).join(", ")
                  }. Connect it on the Recoil page.`
                : "Waiting for dongle COM port…"
          }
          actionLabel={busy ? "Installing…" : "Install emitter firmware"}
          actionEnabled={emitterReady && !busy}
          onAction={() => void flashEmitter()}
        />

        <WatcherCard
          title="Receiver (Nice!Nano)"
          howTo="Short RST→GND twice (tweezers). Look for NICENANO. Flash only one receiver."
          statusLabel={receiverStatus.label}
          statusTone={receiverStatus.tone}
          detail={
            receiverBoot
              ? `Detected ${driveLabel(receiverBoot)} — ${receiverBoot.reason}`
              : "Waiting… no NICENANO drive yet."
          }
          actionLabel="Install receiver firmware"
          actionEnabled={Boolean(receiverBoot) && hasReceiverImage}
          actionTo="/recoil-link/flash?board=receiver"
        />
      </section>

      <section className="rounded-2xl bg-slate-800/80 p-4 md:p-5 shadow-lg ring-1 ring-white/5 space-y-4">
        <div>
          <p className="text-sm uppercase tracking-wide text-slate-400">Parts</p>
          <h2 className="text-xl font-semibold text-white">Shopping list</h2>
          <p className="mt-1 text-sm text-slate-400">
            Kit hardware for this bench. Step-by-step solenoid wiring comes after receiver flash UX
            is locked in.
          </p>
        </div>
        <ul className="space-y-3">
          {SHOPPING_LIST.map((item) => (
            <li
              key={item.title}
              className="rounded-xl bg-slate-900/70 px-4 py-3 ring-1 ring-white/5 space-y-1"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-white">{item.title}</p>
                <span className="text-xs uppercase tracking-wide text-slate-500">{item.role}</span>
              </div>
              <p className="text-sm text-slate-400">{item.note}</p>
            </li>
          ))}
        </ul>
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

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  recoilFirmwareFlash,
  recoilFirmwareFlashEmitter,
  recoilFirmwareListImages,
  recoilFirmwareListTargets,
  type RecoilFirmwareImage,
  type RecoilFirmwareRole,
  type RecoilFirmwareTarget,
  type RecoilSerialHint,
} from "../lib/bridgeApi";

const POLL_MS = 2000;

const ROLE_LABEL: Record<Exclude<RecoilFirmwareRole, "unknown">, string> = {
  dongle: "USB emitter DFU package",
  receiver: "Receiver (SoftDevice)",
  receiver_nosd: "Receiver (no SoftDevice)",
};

function roleLabel(role: RecoilFirmwareRole): string {
  if (role === "unknown") return "Unknown — choose manually";
  return ROLE_LABEL[role];
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
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

export function RecoilFlashPage() {
  const [searchParams] = useSearchParams();
  const boardHint = searchParams.get("board"); // emitter | receiver

  const [images, setImages] = useState<RecoilFirmwareImage[]>([]);
  const [targets, setTargets] = useState<RecoilFirmwareTarget[]>([]);
  const [serialHints, setSerialHints] = useState<RecoilSerialHint[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [roleOverride, setRoleOverride] = useState<RecoilFirmwareRole | "">("");
  const [flashingEmitter, setFlashingEmitter] = useState(false);
  const [flashingReceiver, setFlashingReceiver] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const flashing = flashingEmitter || flashingReceiver;
  const busy = flashing || scanning;

  const openDfuHints = useMemo(
    () => serialHints.filter((h) => h.mode === "open_dfu"),
    [serialHints]
  );
  const recoilTxHints = useMemo(
    () => serialHints.filter((h) => h.mode === "recoil_tx"),
    [serialHints]
  );
  const receiverBoot = useMemo(() => targets.find(isReceiverBootloader) ?? null, [targets]);
  const dongleImage = images.find((img) => img.role === "dongle" && /\.zip$/i.test(img.path));
  const dongleAny = dongleImage || images.find((img) => img.role === "dongle");

  const selected = useMemo(
    () => targets.find((t) => t.path === selectedPath) ?? null,
    [targets, selectedPath]
  );

  const effectiveRole: RecoilFirmwareRole =
    roleOverride || selected?.suggestedRole || "unknown";

  const imageForRole = images.find((img) => img.role === effectiveRole);

  const refresh = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setScanning(true);
    if (!opts?.quiet) setError(null);
    try {
      const [imgRes, tgtRes] = await Promise.all([
        recoilFirmwareListImages(),
        recoilFirmwareListTargets(),
      ]);
      if (!imgRes.success && !opts?.quiet) {
        setError(imgRes.error || "Failed to list firmware images");
      }
      if (!tgtRes.success && !opts?.quiet) {
        setError(tgtRes.error || "Failed to scan boards");
      }
      const nextTargets = tgtRes.targets || [];
      const nextHints = tgtRes.serialHints || [];
      setImages(imgRes.images || []);
      setTargets(nextTargets);
      setSerialHints(nextHints);

      setSelectedPath((prev) => {
        if (prev && nextTargets.some((t) => t.path === prev)) return prev;
        if (boardHint === "receiver") {
          const hit = nextTargets.find(isReceiverBootloader);
          if (hit) return hit.path;
        }
        return nextTargets[0]?.path || "";
      });

      if (!opts?.quiet) {
        setRoleOverride("");
        const dfu = nextHints.filter((h) => h.mode === "open_dfu");
        const tx = nextHints.filter((h) => h.mode === "recoil_tx");
        if (dfu.length) {
          setMessage(
            `Emitter Open DFU on ${dfu.map((h) => h.port).join(", ")} — ready to install.`
          );
        } else if (tx.length) {
          setMessage(
            `Emitter already running as TSC Recoil Link (${tx.map((h) => h.port).join(", ")}).`
          );
        } else if (nextTargets.length) {
          setMessage(`Found ${nextTargets.length} UF2 receiver volume(s)`);
        } else {
          setMessage(
            "Emitter: sideways RESET until red LED pulses. Receiver: short RST→GND twice for NICENANO."
          );
        }
      }
    } catch (err) {
      if (!opts?.quiet) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!opts?.quiet) setScanning(false);
    }
  }, [boardHint]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      void refresh({ quiet: true });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const handleFlashEmitter = async () => {
    setFlashingEmitter(true);
    setError(null);
    setMessage(null);
    try {
      const result = await recoilFirmwareFlashEmitter({
        imagePath: dongleAny?.path,
      });
      if (!result.success) {
        setError(result.error || "Emitter flash failed");
        return;
      }
      setMessage(result.message || "Emitter flash complete");
      window.setTimeout(() => void refresh({ quiet: true }), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFlashingEmitter(false);
    }
  };

  const handleFlashReceiver = async () => {
    if (!selected) {
      setError("Wait until a NICENANO volume shows Ready, then install");
      return;
    }
    if (effectiveRole === "unknown" || effectiveRole === "dongle") {
      setError("Choose Receiver firmware before flashing");
      return;
    }
    if (!imageForRole) {
      setError(`No UF2 on disk for ${roleLabel(effectiveRole)}.`);
      return;
    }
    setFlashingReceiver(true);
    setError(null);
    setMessage(null);
    try {
      const result = await recoilFirmwareFlash({
        targetPath: selected.path,
        role: effectiveRole,
        imagePath: imageForRole.path,
      });
      if (!result.success) {
        setError(result.error || "Flash failed");
        return;
      }
      setMessage(result.message || "Receiver flash complete");
      window.setTimeout(() => void refresh({ quiet: true }), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFlashingReceiver(false);
    }
  };

  const emitterReady = openDfuHints.length > 0 && Boolean(dongleAny) && !flashing;
  const receiverReady =
    Boolean(selected) &&
    effectiveRole !== "unknown" &&
    effectiveRole !== "dongle" &&
    Boolean(imageForRole) &&
    !flashing;

  const emitterStatusTone = openDfuHints.length
    ? "ready"
    : recoilTxHints.length
      ? "ok"
      : "idle";
  const receiverStatusTone = receiverBoot ? "ready" : "idle";

  const statusBox = (tone: "ready" | "ok" | "idle") =>
    tone === "ready"
      ? "bg-emerald-500/10 ring-emerald-500/40"
      : tone === "ok"
        ? "bg-sky-500/10 ring-sky-500/40"
        : "bg-slate-900/60 ring-white/5";

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">
            <Link to="/recoil-link" className="text-sky-400 hover:text-sky-300">
              ← Kit Setup
            </Link>
          </p>
          <h1 className="mt-2 text-2xl md:text-3xl font-bold text-white">Install kit firmware</h1>
          <p className="mt-2 text-sm text-slate-400 max-w-2xl">
            Two independent boards — flash one at a time. Emitter uses{" "}
            <span className="text-emerald-300">Open DFU</span>; receiver uses{" "}
            <span className="text-emerald-300">UF2</span>.
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white disabled:opacity-50 shrink-0"
          disabled={busy}
          onClick={() => void refresh()}
        >
          {scanning ? "Scanning…" : "Refresh now"}
        </button>
      </header>

      {(message || error) && (
        <div
          className={`rounded-lg px-3 py-2 text-sm ring-1 ${
            error
              ? "bg-rose-500/10 text-rose-200 ring-rose-500/30"
              : "bg-emerald-500/10 text-emerald-200 ring-emerald-500/30"
          }`}
        >
          {error || message}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 md:items-stretch">
        {/* Emitter column */}
        <section className="rounded-2xl bg-slate-800/80 p-4 md:p-5 shadow-lg ring-1 ring-white/5 flex flex-col gap-4 min-h-[28rem]">
          <div>
            <p className="text-sm uppercase tracking-wide text-slate-400">Emitter</p>
            <h2 className="text-xl font-semibold text-white">Nordic PCA10059</h2>
            <p className="mt-1 text-sm text-slate-400">
              Sideways RESET → red LED pulse. Open DFU via{" "}
              <code className="text-slate-300">nrfutil</code> +{" "}
              <code className="text-slate-300">recoil-dongle-dfu.zip</code>.
            </p>
          </div>

          <div className={`rounded-xl p-3 ring-1 min-h-[7.5rem] ${statusBox(emitterStatusTone)}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-white">Status</p>
              <span
                className={`text-xs font-medium ${
                  emitterStatusTone === "ready"
                    ? "text-emerald-300"
                    : emitterStatusTone === "ok"
                      ? "text-sky-300"
                      : "text-slate-400"
                }`}
              >
                {openDfuHints.length
                  ? "Ready to flash"
                  : recoilTxHints.length
                    ? "Already TSC Recoil Link"
                    : "Waiting"}
              </span>
            </div>
            <p
              className={`mt-2 text-sm ${
                emitterStatusTone === "idle" ? "text-slate-400" : "text-slate-100"
              }`}
            >
              {openDfuHints.length > 0
                ? `Open DFU on ${openDfuHints.map((h) => `${h.port} (${h.vidPid})`).join(", ")}`
                : recoilTxHints.length > 0
                  ? `Running on ${recoilTxHints.map((h) => h.port).join(", ")}. RESET for red DFU to reflash.`
                  : "No Open DFU COM yet (expect VID_1915&PID_521F)."}
            </p>
            {dongleAny ? (
              <p className="mt-2 text-xs text-slate-500 truncate" title={dongleAny.path}>
                Package: {dongleAny.path.split(/[/\\]/).pop()} ({formatBytes(dongleAny.bytes)})
              </p>
            ) : (
              <p className="mt-2 text-sm text-amber-200">No DFU zip — run firmware build.ps1.</p>
            )}
          </div>

          <div className="mt-auto space-y-2">
            <button
              type="button"
              className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-medium text-slate-950 disabled:opacity-50"
              disabled={!emitterReady}
              onClick={() => void handleFlashEmitter()}
            >
              {flashingEmitter ? "Installing…" : "Install emitter (Open DFU)"}
            </button>
            <p className="text-xs text-slate-500">
              Does not touch the receiver. Flash one board at a time.
            </p>
          </div>
        </section>

        {/* Receiver column */}
        <section className="rounded-2xl bg-slate-800/80 p-4 md:p-5 shadow-lg ring-1 ring-white/5 flex flex-col gap-4 min-h-[28rem]">
          <div>
            <p className="text-sm uppercase tracking-wide text-slate-400">Receiver</p>
            <h2 className="text-xl font-semibold text-white">Nice!Nano UF2</h2>
            <p className="mt-1 text-sm text-slate-400">
              Short RST→GND twice. Wait for NICENANO, then install. One receiver only.
            </p>
          </div>

          <div className={`rounded-xl p-3 ring-1 min-h-[7.5rem] ${statusBox(receiverStatusTone)}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-white">UF2 volume</p>
              <span
                className={`text-xs font-medium ${
                  receiverBoot ? "text-emerald-300" : "text-slate-400"
                }`}
              >
                {receiverBoot ? "Ready" : "Waiting"}
              </span>
            </div>
            <p className={`mt-2 text-sm ${receiverBoot ? "text-emerald-100" : "text-slate-400"}`}>
              {receiverBoot
                ? `${driveLabel(receiverBoot)}${receiverBoot.reason ? ` — ${receiverBoot.reason}` : ""}`
                : "No NICENANO drive detected."}
            </p>
          </div>

          <div className="space-y-3 flex-1">
            <label className="block space-y-1.5">
              <span className="text-sm text-slate-400">Detected board</span>
              <select
                className="w-full rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-white disabled:opacity-60"
                value={selectedPath}
                disabled={busy || targets.length === 0}
                onChange={(e) => {
                  setSelectedPath(e.target.value);
                  setRoleOverride("");
                }}
              >
                {targets.length === 0 ? (
                  <option value="">Waiting for UF2 volume…</option>
                ) : (
                  targets.map((t) => (
                    <option key={t.path} value={t.path}>
                      {(t.driveLetter ? `${t.driveLetter}: ` : "") +
                        (t.volumeLabel || "UF2") +
                        ` — ${roleLabel(t.suggestedRole)}`}
                    </option>
                  ))
                )}
              </select>
            </label>

            <div className="rounded-lg bg-slate-900/70 px-3 py-3 text-sm text-slate-300 space-y-1 ring-1 ring-white/5 min-h-[4.5rem]">
              {selected ? (
                <>
                  <p>
                    <span className="text-slate-500">Suggested:</span>{" "}
                    {roleLabel(selected.suggestedRole)}{" "}
                    <span className="text-slate-500">({selected.confidence})</span>
                  </p>
                  <p className="text-slate-400">{selected.reason}</p>
                </>
              ) : (
                <p className="text-slate-500">Board details appear when a UF2 volume is detected.</p>
              )}
            </div>

            <label className="block space-y-1.5">
              <span className="text-sm text-slate-400">Firmware to install</span>
              <select
                className="w-full rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-white disabled:opacity-60"
                value={
                  effectiveRole === "unknown" || effectiveRole === "dongle" ? "" : effectiveRole
                }
                disabled={busy || !selected}
                onChange={(e) =>
                  setRoleOverride((e.target.value || "") as RecoilFirmwareRole | "")
                }
              >
                <option value="">Select…</option>
                <option value="receiver">{ROLE_LABEL.receiver}</option>
                <option value="receiver_nosd">{ROLE_LABEL.receiver_nosd}</option>
              </select>
            </label>
          </div>

          <div className="mt-auto space-y-2">
            <button
              type="button"
              className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-medium text-slate-950 disabled:opacity-50"
              disabled={!receiverReady}
              onClick={() => void handleFlashReceiver()}
            >
              {flashingReceiver ? "Installing…" : "Install receiver (UF2)"}
            </button>
            <p className="text-xs text-slate-500">
              Does not touch the emitter. Keep the spare receiver unpowered.
            </p>
          </div>
        </section>
      </div>

      <section className="rounded-2xl bg-slate-800/80 p-4 shadow-lg ring-1 ring-white/5 space-y-2">
        <h2 className="text-sm font-semibold text-white">Images on disk</h2>
        {images.length === 0 ? (
          <p className="text-sm text-amber-200">No firmware files found under dist/.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            {images.map((img) => (
              <li
                key={`${img.role}-${img.path}`}
                className="rounded-lg bg-slate-900/70 px-3 py-2 ring-1 ring-white/5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-slate-100">{roleLabel(img.role)}</span>
                  <span className="text-slate-400 shrink-0">{formatBytes(img.bytes)}</span>
                </div>
                <p className="mt-1 truncate font-mono text-xs text-slate-500" title={img.path}>
                  {img.path}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

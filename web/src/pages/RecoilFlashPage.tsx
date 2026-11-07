import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  recoilFirmwareFlash,
  recoilFirmwareListImages,
  recoilFirmwareListTargets,
  type RecoilFirmwareImage,
  type RecoilFirmwareRole,
  type RecoilFirmwareTarget,
  type RecoilSerialHint,
} from "../lib/bridgeApi";

const POLL_MS = 2000;

const ROLE_LABEL: Record<Exclude<RecoilFirmwareRole, "unknown">, string> = {
  dongle: "USB emitter (dongle)",
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

export function RecoilFlashPage() {
  const [searchParams] = useSearchParams();
  const boardHint = searchParams.get("board"); // emitter | receiver

  const [images, setImages] = useState<RecoilFirmwareImage[]>([]);
  const [targets, setTargets] = useState<RecoilFirmwareTarget[]>([]);
  const [serialHints, setSerialHints] = useState<RecoilSerialHint[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [roleOverride, setRoleOverride] = useState<RecoilFirmwareRole | "">("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => targets.find((t) => t.path === selectedPath) ?? null,
    [targets, selectedPath]
  );

  const effectiveRole: RecoilFirmwareRole =
    roleOverride || selected?.suggestedRole || "unknown";

  const imageForRole = images.find((img) => img.role === effectiveRole);

  const emitterBoot = useMemo(() => targets.find(isEmitterBootloader) ?? null, [targets]);
  const receiverBoot = useMemo(() => targets.find(isReceiverBootloader) ?? null, [targets]);

  const refresh = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setBusy(true);
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
        setError(tgtRes.error || "Failed to scan for UF2 drives");
      }
      const nextTargets = tgtRes.targets || [];
      const nextHints = tgtRes.serialHints || [];
      setImages(imgRes.images || []);
      setTargets(nextTargets);
      setSerialHints(nextHints);

      setSelectedPath((prev) => {
        if (prev && nextTargets.some((t) => t.path === prev)) return prev;
        if (boardHint === "emitter") {
          const hit = nextTargets.find(isEmitterBootloader);
          if (hit) return hit.path;
        }
        if (boardHint === "receiver") {
          const hit = nextTargets.find(isReceiverBootloader);
          if (hit) return hit.path;
        }
        return nextTargets[0]?.path || "";
      });

      if (!opts?.quiet) {
        setRoleOverride("");
        if (nextTargets.length === 0) {
          if (nextHints.length > 0) {
            setMessage(
              `Saw ${nextHints.map((h) => h.port).join(", ")} (Nordic serial) but no UF2BOOT drive. Hold the button before plugging into a USB2 port until Explorer shows a new drive, then release.`
            );
          } else {
            setMessage(
              "No board in bootloader yet. Emitter: hold button while plugging in. Receiver: double-tap reset. This page watches for the drive."
            );
          }
        } else {
          setMessage(`Found ${nextTargets.length} board(s) ready to flash`);
        }
      }
    } catch (err) {
      if (!opts?.quiet) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (!opts?.quiet) setBusy(false);
    }
  }, [boardHint]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      void refresh({ quiet: true });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const handleFlash = async () => {
    if (!selected) {
      setError("Wait until a board shows as ready, then install");
      return;
    }
    if (effectiveRole === "unknown") {
      setError("Choose Emitter or Receiver firmware before flashing");
      return;
    }
    if (!imageForRole) {
      setError(
        `No UF2 on disk for ${roleLabel(effectiveRole)}. Build firmware first (see below).`
      );
      return;
    }
    setBusy(true);
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
      setMessage(result.message || "Flash complete — unplug/replug normally when done");
      window.setTimeout(() => {
        void refresh({ quiet: true });
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const canInstall =
    Boolean(selected) && effectiveRole !== "unknown" && Boolean(imageForRole) && !busy;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <header>
        <p className="text-sm text-slate-400">
          <Link to="/recoil-link" className="text-sky-400 hover:text-sky-300">
            ← Recoil Kit Setup
          </Link>
        </p>
        <h1 className="mt-2 text-2xl md:text-3xl font-bold text-white">Install kit firmware</h1>
        <p className="mt-2 text-sm md:text-base text-slate-400">
          Do not press Install until a board shows <span className="text-emerald-300">Ready</span>{" "}
          below. Then one click copies the matching <code className="text-slate-300">.uf2</code>.
        </p>
      </header>

      <section className="rounded-2xl bg-slate-800/80 p-4 md:p-5 shadow-lg ring-1 ring-white/5 space-y-3">
        <h2 className="text-lg font-semibold text-white">Waiting for boards (live)</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div
            className={`rounded-xl p-3 ring-1 ${
              emitterBoot
                ? "bg-emerald-500/10 ring-emerald-500/40"
                : "bg-slate-900/60 ring-white/5"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-white">Emitter</p>
              <span
                className={`text-xs font-medium ${
                  emitterBoot ? "text-emerald-300" : "text-slate-400"
                }`}
              >
                {emitterBoot ? "Ready" : "Waiting"}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Hold button → plug USB → release (UF2BOOT)
            </p>
            {emitterBoot ? (
              <p className="mt-2 text-sm text-emerald-100">{driveLabel(emitterBoot)}</p>
            ) : serialHints.length > 0 ? (
              <p className="mt-2 text-sm text-amber-200">
                Serial {serialHints.map((h) => h.port).join(", ")} — not UF2 disk yet
              </p>
            ) : null}
          </div>
          <div
            className={`rounded-xl p-3 ring-1 ${
              receiverBoot
                ? "bg-emerald-500/10 ring-emerald-500/40"
                : "bg-slate-900/60 ring-white/5"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-white">Receiver</p>
              <span
                className={`text-xs font-medium ${
                  receiverBoot ? "text-emerald-300" : "text-slate-400"
                }`}
              >
                {receiverBoot ? "Ready" : "Waiting"}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Double-tap reset, or short RST→GND twice if there is no button (NICENANO)
            </p>
            {receiverBoot && (
              <p className="mt-2 text-sm text-emerald-100">{driveLabel(receiverBoot)}</p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl bg-slate-800/80 p-4 md:p-5 shadow-lg ring-1 ring-white/5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-wide text-slate-400">Firmware files</p>
            <h2 className="text-xl font-semibold text-white">Images on disk</h2>
          </div>
          <button
            type="button"
            className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Refresh now
          </button>
        </div>
        {images.length === 0 ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm text-amber-100 space-y-2">
            <p>No built UF2 files found yet.</p>
            <p className="text-amber-100/80">From an nRF Connect toolchain shell:</p>
            <pre className="overflow-x-auto rounded bg-slate-950/60 p-2 text-xs text-slate-200">
{`cd recoil-link\\firmware
.\\build.ps1 -NcsRoot C:\\ncs\\v2.9.0`}
            </pre>
          </div>
        ) : (
          <ul className="space-y-2 text-sm">
            {images.map((img) => (
              <li
                key={img.role}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-slate-900/70 px-3 py-2 ring-1 ring-white/5"
              >
                <span className="font-medium text-slate-100">{roleLabel(img.role)}</span>
                <span className="text-slate-400">{formatBytes(img.bytes)}</span>
                <span className="w-full truncate font-mono text-xs text-slate-500">{img.path}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-slate-800/80 p-4 md:p-5 shadow-lg ring-1 ring-white/5 space-y-4">
        <div>
          <p className="text-sm uppercase tracking-wide text-slate-400">Install</p>
          <h2 className="text-xl font-semibold text-white">Flash selected board</h2>
        </div>

        {targets.length === 0 ? (
          <p className="text-sm text-slate-400">
            Install stays disabled until a bootloader drive appears above.
          </p>
        ) : (
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-sm text-slate-400">Detected board</span>
              <select
                className="w-full rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-white"
                value={selectedPath}
                disabled={busy}
                onChange={(e) => {
                  setSelectedPath(e.target.value);
                  setRoleOverride("");
                }}
              >
                {targets.map((t) => (
                  <option key={t.path} value={t.path}>
                    {(t.driveLetter ? `${t.driveLetter}: ` : "") +
                      (t.volumeLabel || "UF2") +
                      ` — ${roleLabel(t.suggestedRole)}`}
                  </option>
                ))}
              </select>
            </label>

            {selected && (
              <div className="rounded-lg bg-slate-900/70 px-3 py-3 text-sm text-slate-300 space-y-1 ring-1 ring-white/5">
                <p>
                  <span className="text-slate-500">Suggested:</span>{" "}
                  {roleLabel(selected.suggestedRole)}{" "}
                  <span className="text-slate-500">({selected.confidence})</span>
                </p>
                <p className="text-slate-400">{selected.reason}</p>
                {selected.model && (
                  <p>
                    <span className="text-slate-500">Model:</span> {selected.model}
                  </p>
                )}
                {selected.softDevice && (
                  <p>
                    <span className="text-slate-500">SoftDevice:</span> {selected.softDevice}
                  </p>
                )}
              </div>
            )}

            <label className="block space-y-1.5">
              <span className="text-sm text-slate-400">Firmware to install</span>
              <select
                className="w-full rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-white"
                value={effectiveRole === "unknown" ? "" : effectiveRole}
                disabled={busy || !selected}
                onChange={(e) =>
                  setRoleOverride((e.target.value || "") as RecoilFirmwareRole | "")
                }
              >
                <option value="">Select…</option>
                <option value="dongle">{ROLE_LABEL.dongle}</option>
                <option value="receiver">{ROLE_LABEL.receiver}</option>
                <option value="receiver_nosd">{ROLE_LABEL.receiver_nosd}</option>
              </select>
            </label>

            <button
              type="button"
              className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-medium text-slate-950 disabled:opacity-50"
              disabled={!canInstall}
              onClick={() => void handleFlash()}
            >
              {busy ? "Installing…" : "Install firmware on this board"}
            </button>
          </div>
        )}
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

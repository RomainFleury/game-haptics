import { useState } from "react";

type MelonModStatus = {
  dllInstalled?: boolean;
  melonLoaderInstalled?: boolean;
  /** @deprecated prefer dllInstalled; kept for callers that only set installed */
  installed?: boolean;
};

type Props = {
  gameDir: string;
  modDllName: string;
  modStatus: MelonModStatus;
  loading: boolean;
  installMessage: string | null;
  onInstall: () => void;
  /** Re-scan game folder for MelonLoader + mod DLL (e.g. after installing MelonLoader). */
  onRecheck: () => Promise<void> | void;
};

/**
 * Shared DLL + MelonLoader status for MelonLoader-based game integrations.
 */
export function MelonModInstallStatus({
  gameDir,
  modDllName,
  modStatus,
  loading,
  installMessage,
  onInstall,
  onRecheck,
}: Props) {
  const [rechecking, setRechecking] = useState(false);
  const [recheckMessage, setRecheckMessage] = useState<string | null>(null);
  const dllInstalled = Boolean(modStatus.dllInstalled ?? modStatus.installed);
  const melonLoaderInstalled = Boolean(modStatus.melonLoaderInstalled);
  const busy = loading || rechecking;

  const handleRecheck = async () => {
    if (!gameDir || busy) return;
    setRechecking(true);
    setRecheckMessage(null);
    try {
      await onRecheck();
      setRecheckMessage("✓ Config rechecked");
    } catch (err) {
      setRecheckMessage(
        `✗ Recheck failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setRechecking(false);
    }
  };

  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="text-sm space-y-1 min-w-0">
          {!gameDir ? (
            <span className="text-slate-500">Select game directory first</span>
          ) : (
            <>
              <div>
                {dllInstalled ? (
                  <span className="text-emerald-400">✓ {modDllName} is in Mods/</span>
                ) : (
                  <span className="text-yellow-400">⚠ Mod DLL not installed</span>
                )}
              </div>
              <div>
                {melonLoaderInstalled ? (
                  <span className="text-emerald-400">✓ MelonLoader detected</span>
                ) : (
                  <span className="text-rose-400">
                    ✗ MelonLoader not found — mods will not load (no live events)
                  </span>
                )}
              </div>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void handleRecheck()}
            disabled={busy || !gameDir}
            className="rounded-lg border border-slate-500 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {rechecking ? "Rechecking…" : "Recheck"}
          </button>
          <button
            type="button"
            onClick={onInstall}
            disabled={busy || !gameDir}
            className="rounded-lg bg-blue-600/80 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {dllInstalled ? "Reinstall Mod" : "Install Mod"}
          </button>
        </div>
      </div>
      {gameDir && !melonLoaderInstalled && (
        <p className="text-xs text-rose-300/90 mb-2 rounded-lg bg-rose-500/10 ring-1 ring-rose-500/20 px-3 py-2">
          Install{" "}
          <a
            href="https://github.com/LavaGang/MelonLoader/releases"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-rose-200"
          >
            MelonLoader 0.6+
          </a>{" "}
          into this game folder, launch once so it creates{" "}
          <code className="bg-slate-800 px-1 rounded">MelonLoader/</code>, then click{" "}
          <strong className="text-rose-200">Recheck</strong>. The in-game “cheats” watermark alone
          does not mean MelonLoader is installed.
        </p>
      )}
      {(recheckMessage || installMessage) && (
        <p
          className={`text-xs mt-2 ${
            (recheckMessage || installMessage || "").startsWith("✓") &&
            !(recheckMessage || installMessage || "").includes("MelonLoader is missing")
              ? "text-emerald-400"
              : (recheckMessage || installMessage || "").startsWith("✓")
                ? "text-amber-300"
                : "text-red-400"
          }`}
        >
          {recheckMessage || installMessage}
        </p>
      )}
    </>
  );
}

export function formatMelonInstallMessage(result: {
  success: boolean;
  copiedFiles?: string[];
  warning?: string;
  error?: string;
}): string {
  if (!result.success) {
    return `✗ Installation failed: ${result.error}`;
  }
  if (result.warning) {
    return `✓ Mod copied, but MelonLoader is missing — ${result.warning}`;
  }
  return `✓ Mod installed: ${result.copiedFiles?.join(", ")}`;
}

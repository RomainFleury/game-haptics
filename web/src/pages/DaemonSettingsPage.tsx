import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  ocrListEngines,
  ocrOpenWindowsLanguageSettings,
  ocrSetEngine,
  type OcrEngineInfo,
} from "../lib/bridgeApi";

export function DaemonSettingsPage() {
  const [engines, setEngines] = useState<OcrEngineInfo[]>([]);
  const [active, setActive] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    const result = await ocrListEngines();
    if (!result.success) {
      setError(result.error || "Could not load OCR engines (is the daemon running?)");
      return;
    }
    setEngines(result.ocr_engines ?? []);
    setActive(result.ocr_engine ?? "");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const offered = useMemo(() => {
    const flagged = engines.filter((e) => e.offered_in_ui === true);
    if (flagged.length > 0) return flagged;
    return engines.filter(
      (e) =>
        e.id === "windows_ocr" ||
        e.id === "opencv_knn" ||
        e.id === "rapidocr" ||
        e.id === "tesseract"
    );
  }, [engines]);
  const offeredIds = useMemo(() => new Set(offered.map((e) => e.id)), [offered]);
  const activeHidden = Boolean(active) && engines.some((e) => e.id === active) && !offeredIds.has(active);
  const activeHiddenMeta = engines.find((e) => e.id === active);
  const windowsOcr = engines.find((e) => e.id === "windows_ocr");
  const windowsOcrMissing = windowsOcr?.available === false;

  const selectEngine = async (id: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await ocrSetEngine(id);
      if (!result.success) {
        setError(result.error || "Failed to set OCR engine");
        return;
      }
      setActive(result.ocr_engine || id);
      setMessage(`Ammo OCR engine is now ${result.ocr_engine || id}. Used immediately on Test OCR / Start.`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openLanguageSettings = async (ev: MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    try {
      const result = await ocrOpenWindowsLanguageSettings();
      if (!result.success) {
        setError(result.error || "Could not open Windows Settings");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const cards = offered;

  return (
    <div className="max-w-4xl mx-auto space-y-4 md:space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold text-white">Daemon Settings</h1>
        <p className="mt-2 text-sm md:text-base text-slate-400">
          Live recoil and health-number detectors use <span className="text-slate-200">Windows OCR</span> by
          default. You can override to OpenCV + kNN if it reads a given HUD better. Other backends stay in the
          daemon for lab eval only.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-lg bg-slate-700/80 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600"
        >
          Refresh
        </button>
        {busy && <span className="text-xs text-slate-500">Saving…</span>}
      </div>

      {error && <div className="text-sm text-rose-300">{error}</div>}
      {message && <div className="text-sm text-emerald-300">{message}</div>}

      {windowsOcrMissing && (
        <div className="rounded-xl bg-rose-950/40 p-4 ring-1 ring-rose-500/30 space-y-3">
          <div className="text-sm font-medium text-rose-100">Windows OCR is required for the default digit reader</div>
          <p className="text-sm text-rose-200/90">
            The app already includes the Python OCR bindings. Windows still needs an Optical character recognition
            language pack — we cannot ship that inside the installer.
          </p>
          <ol className="list-decimal list-inside text-sm text-rose-100/90 space-y-1">
            <li>Open Language &amp; region settings</li>
            <li>English (United States) → Language options (add the language if it is missing)</li>
            <li>Features → Optical character recognition → Download</li>
            <li>Restart the daemon, then Refresh</li>
          </ol>
          <button
            type="button"
            onClick={(ev) => void openLanguageSettings(ev)}
            className="rounded-lg bg-rose-600/80 px-4 py-2 text-sm font-medium text-white hover:bg-rose-600"
          >
            Open Windows language settings
          </button>
          {windowsOcr.unavailable_reason && (
            <pre className="whitespace-pre-wrap text-xs text-rose-200/70">{windowsOcr.unavailable_reason}</pre>
          )}
        </div>
      )}

      {activeHidden && activeHiddenMeta && (
        <div className="rounded-xl bg-amber-950/40 p-3 text-sm text-amber-200 ring-1 ring-amber-500/30">
          Currently using lab engine <span className="font-medium text-white">{activeHiddenMeta.label}</span> (
          {activeHiddenMeta.id}). Pick Windows OCR or OpenCV + kNN below for live recoil.
        </div>
      )}

      <div className="grid gap-3">
        {cards.map((eng) => {
          const selected = eng.id === active;
          const isDefault = eng.id === "windows_ocr";
          return (
            <div
              key={eng.id}
              role="button"
              tabIndex={busy ? -1 : 0}
              onClick={() => {
                if (!busy) void selectEngine(eng.id);
              }}
              onKeyDown={(ev) => {
                if (busy) return;
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  void selectEngine(eng.id);
                }
              }}
              className={`text-left rounded-xl p-4 ring-1 transition cursor-pointer ${
                selected
                  ? "bg-blue-950/40 ring-blue-400/60"
                  : "bg-slate-900/40 ring-white/10 hover:ring-white/20"
              } ${busy ? "opacity-60 pointer-events-none" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-white">{eng.label}</span>
                {isDefault ? (
                  <span className="text-[10px] uppercase tracking-wide text-sky-300">default</span>
                ) : (
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">override</span>
                )}
                {selected ? (
                  <span className="text-[10px] uppercase tracking-wide text-blue-300">active</span>
                ) : null}
                {eng.available === false ? (
                  <span className="text-[10px] uppercase tracking-wide text-rose-300">not installed</span>
                ) : (
                  <span className="text-[10px] uppercase tracking-wide text-emerald-400">ready</span>
                )}
              </div>
              {(eng.ui_summary || eng.description) && (
                <p className="mt-2 text-sm text-slate-400">{eng.ui_summary || eng.description}</p>
              )}
              {eng.available === false && (eng.unavailable_reason || eng.install) && (
                <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-500">
                  {eng.unavailable_reason || eng.install}
                </pre>
              )}
              {eng.id === "windows_ocr" && eng.available === false && (
                <button
                  type="button"
                  onClick={(ev) => void openLanguageSettings(ev)}
                  className="mt-3 inline-block rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-blue-300 hover:text-blue-200 pointer-events-auto"
                >
                  Open Windows language settings
                </button>
              )}
            </div>
          );
        })}
      </div>

      {cards.length === 0 && !error && (
        <p className="text-sm text-slate-500">Start the daemon to list OCR engines.</p>
      )}
    </div>
  );
}

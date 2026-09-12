import { useMemo } from "react";
import { SCREEN_HEALTH_PRESETS } from "../../../../data/screenHealthPresets";
import { buildScreenHealthDaemonProfile } from "../buildDaemonProfile";
import { useScreenHealthCalibration } from "../draft/CalibrationContext";
import { useScreenHealthRecoilDraft, useScreenHealthRecoilDraftControls } from "../draft/RecoilDraftContext";
import { useScreenHealthProfileDraftControls } from "../draft/ProfileDraftContext";
import { useScreenHealthColorVignetteDraftControls } from "../draft/ColorVignetteDraftContext";
import { useScreenHealthRednessDraftControls } from "../draft/RednessDraftContext";
import { useScreenHealthHealthBarDraftControls } from "../draft/HealthBarDraftContext";
import { useScreenHealthHealthNumberDraftControls } from "../draft/HealthNumberDraftContext";
import { learnDigitTemplatesFromCanvas, tryReadDigitValueFromCanvas } from "../templateLearning";

const PRESETS = SCREEN_HEALTH_PRESETS as Array<{ preset_id: string; profile: { meta?: unknown } }>;

export function AmmoNumberRecoilSettings(props: {
  lastCapturedImage: { path: string } | null;
  evaluateProfileOnScreenshot: (
    profile: Record<string, any>,
    imagePath: string
  ) => Promise<{ success: boolean; test_result?: Record<string, any> | null; error?: string }>;
}) {
  const { lastCapturedImage, evaluateProfileOnScreenshot } = props;
  const state = useScreenHealthRecoilDraft();
  const {
    setDurationMs,
    setStableReads,
    setHitMinDrop,
    setHitCooldownMs,
    setDigits,
    setInvert,
    setThreshold,
    setScale,
    setHammingMax,
    setTemplateSize,
    setTemplates,
    setLearnValue,
    clearTemplates,
    setOcrEngine,
    setCalibrationError,
    setTestResult,
    readDraft: readRecoilDraft,
  } = useScreenHealthRecoilDraftControls();
  const { getCanvasOrThrow } = useScreenHealthCalibration();
  const { readDraft: readProfileDraft } = useScreenHealthProfileDraftControls();
  const { readDraft: readRednessDraft } = useScreenHealthRednessDraftControls();
  const { readDraft: readColorVignetteDraft } = useScreenHealthColorVignetteDraftControls();
  const { readDraft: readHealthBarDraft } = useScreenHealthHealthBarDraftControls();
  const { readDraft: readHealthNumberDraft } = useScreenHealthHealthNumberDraftControls();

  const primaryRoi = state.zones[0]?.rect ?? null;
  const learnedDigits = useMemo(() => Object.keys(state.templates).sort().join(", "), [state.templates]);
  const templateCount = Object.keys(state.templates).length;

  const onLearn = () => {
    setCalibrationError(null);
    setTestResult(null);
    if (!primaryRoi) throw new Error("No ammo ROI set — draw an ammo box on the screenshot");
    const digitsCount = Math.max(1, Math.floor(state.digits));
    const next = learnDigitTemplatesFromCanvas({
      canvas: getCanvasOrThrow(),
      roi: primaryRoi,
      digitsCount,
      displayedValue: state.learnValue,
      threshold: state.threshold,
      invert: state.invert,
      scale: state.scale,
      templateSize: state.templateSize,
      prevTemplates: state.templates,
    });
    setTemplates(next);
    setOcrEngine("templates");
  };

  const onTestLocal = () => {
    setCalibrationError(null);
    setTestResult(null);
    if (!primaryRoi) throw new Error("No ammo ROI set — draw an ammo box on the screenshot");
    if (!templateCount) throw new Error("Learn at least one digit first (type what's on screen, then Learn)");
    const digitsCount = Math.max(1, Math.floor(state.digits));
    let best: { value: number | null; digits?: string; reason?: string } = {
      value: null,
      reason: "No template match",
    };
    for (let n = 1; n <= digitsCount; n += 1) {
      const result = tryReadDigitValueFromCanvas({
        canvas: getCanvasOrThrow(),
        roi: primaryRoi,
        digitsCount: n,
        threshold: state.threshold,
        invert: state.invert,
        scale: state.scale,
        templateSize: state.templateSize,
        templates: state.templates,
        hammingMax: state.hammingMax,
      });
      if (typeof result.value === "number") {
        best = result;
        break;
      }
      best = result;
    }
    setTestResult(best);
  };

  const onTestDaemon = async () => {
    setCalibrationError(null);
    setTestResult(null);
    if (!state.zones.length) throw new Error("No ammo ROI set — draw an ammo box on the screenshot");
    if (!templateCount) throw new Error("Learn digit templates first — generic OCR fails on stylized HUD fonts");
    const imagePath = lastCapturedImage?.path?.trim();
    if (!imagePath) throw new Error("Capture or select a screenshot first");

    const profile = buildScreenHealthDaemonProfile({
      profileDraft: readProfileDraft(),
      redness: readRednessDraft(),
      colorVignette: readColorVignetteDraft(),
      hb: readHealthBarDraft(),
      hn: readHealthNumberDraft(),
      recoil: readRecoilDraft(),
      presets: PRESETS,
    });
    const result = await evaluateProfileOnScreenshot(profile, imagePath);
    if (!result.success) throw new Error(result.error || "Template test failed");
    const detectors = (result.test_result?.detectors as any[]) || [];
    const ammoHits = detectors.filter(
      (d) =>
        d &&
        (d.type === "ammo_number" ||
          d.type === "health_number" ||
          String(d.name || "").startsWith("ammo"))
    );
    if (!ammoHits.length) {
      setTestResult({ value: null, reason: "No ammo_number result in test output" });
      return;
    }
    const parts = ammoHits.map((ammo) => {
      const label = String(ammo.name || "ammo");
      if (ammo.error) return `${label}: error=${ammo.error}`;
      if (typeof ammo.read === "number") return `${label}=${ammo.read}`;
      return `${label}: no match`;
    });
    const firstRead = ammoHits.find((a) => typeof a.read === "number");
    setTestResult({
      value: typeof firstRead?.read === "number" ? firstRead.read : null,
      digits: firstRead ? String(firstRead.read) : undefined,
      reason: parts.join("; "),
    });
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-400 space-y-1">
        <p>
          Stylized game fonts (RDR, etc.) defeat Windows OCR / Tesseract / RapidOCR. Teach the real digits from your
          screenshot instead — bitmask matching against the HUD font you actually see.
        </p>
        <p>
          Draw a tight ammo box, set Digits to how many are visible right now (e.g.{" "}
          <span className="text-slate-300">1</span> for a lone 7), type that value, Learn. Capture other counts (12, 0,
          …) and Learn again until 0–9 are covered. Templates are shared across dual-wield zones.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-sm text-slate-400 block mb-1">Digits on screen now</label>
          <input
            type="number"
            min={1}
            max={3}
            value={state.digits}
            onChange={(e) => setDigits(Math.max(1, Math.min(3, parseInt(e.target.value, 10) || 1)))}
            className="w-full rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
          />
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Threshold (0..1)</label>
          <input
            type="number"
            step={0.01}
            min={0}
            max={1}
            value={state.threshold}
            onChange={(e) => setThreshold(Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)))}
            className="w-full rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
          />
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Scale</label>
          <input
            type="number"
            min={1}
            value={state.scale}
            onChange={(e) => setScale(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-full rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-400">Invert</label>
        <input
          type="checkbox"
          checked={state.invert}
          onChange={(e) => setInvert(e.target.checked)}
          className="h-4 w-4"
        />
        <span className="text-xs text-slate-500">Tick if digits are dark on a light plate (or vice versa).</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-sm text-slate-400 block mb-1">Hamming max</label>
          <input
            type="number"
            min={0}
            value={state.hammingMax}
            onChange={(e) => setHammingMax(Math.max(0, parseInt(e.target.value, 10) || 0))}
            className="w-full rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
          />
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Template width</label>
          <input
            type="number"
            min={4}
            value={state.templateSize.w}
            onChange={(e) =>
              setTemplateSize({ w: Math.max(4, parseInt(e.target.value, 10) || 4), h: state.templateSize.h })
            }
            className="w-full rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
          />
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Template height</label>
          <input
            type="number"
            min={4}
            value={state.templateSize.h}
            onChange={(e) =>
              setTemplateSize({ w: state.templateSize.w, h: Math.max(4, parseInt(e.target.value, 10) || 4) })
            }
            className="w-full rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-sm text-slate-400 block mb-1">Pulse duration (ms)</label>
          <input
            type="number"
            min={25}
            max={1000}
            value={state.durationMs}
            onChange={(e) => setDurationMs(Math.max(25, parseInt(e.target.value, 10) || 40))}
            className="w-full rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
          />
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Stable reads</label>
          <input
            type="number"
            min={1}
            value={state.stableReads}
            onChange={(e) => setStableReads(parseInt(e.target.value, 10) || 1)}
            className="w-full rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
          />
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Min ammo drop</label>
          <input
            type="number"
            min={1}
            value={state.hitMinDrop}
            onChange={(e) => setHitMinDrop(parseInt(e.target.value, 10) || 1)}
            className="w-full rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
          />
        </div>
        <div>
          <label className="text-sm text-slate-400 block mb-1">Shot cooldown (ms)</label>
          <input
            type="number"
            min={0}
            value={state.hitCooldownMs}
            onChange={(e) => setHitCooldownMs(parseInt(e.target.value, 10) || 0)}
            className="w-full rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
          />
        </div>
      </div>

      <div className="rounded-xl bg-slate-900/40 p-3 ring-1 ring-white/5 space-y-2">
        <div className="text-sm text-white font-medium">Teach digits from screenshot</div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={state.learnValue}
            onChange={(e) => setLearnValue(e.target.value)}
            placeholder={`e.g. ${"7".repeat(Math.max(1, Math.floor(state.digits)))}`}
            className="rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
          />
          <button
            type="button"
            onClick={() => {
              try {
                onLearn();
              } catch (e) {
                setCalibrationError(e instanceof Error ? e.message : "Failed to learn templates");
              }
            }}
            className="rounded-lg bg-emerald-600/80 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-600"
          >
            Learn from screenshot
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                onTestLocal();
              } catch (e) {
                setCalibrationError(e instanceof Error ? e.message : "Failed to test templates");
              }
            }}
            className="rounded-lg bg-slate-600/80 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-600"
          >
            Test match once
          </button>
          <button
            type="button"
            onClick={() => {
              void (async () => {
                try {
                  await onTestDaemon();
                } catch (e) {
                  setCalibrationError(e instanceof Error ? e.message : "Failed to test via daemon");
                }
              })();
            }}
            className="rounded-lg bg-slate-600/80 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-600"
          >
            Test via daemon
          </button>
          <button
            type="button"
            onClick={clearTemplates}
            className="rounded-lg bg-slate-600/80 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-600"
          >
            Clear templates
          </button>
        </div>
        {state.calibrationError && <div className="text-xs text-rose-300">{state.calibrationError}</div>}
        {state.testResult && (
          <div className="text-xs text-slate-300">
            Test result:{" "}
            {typeof state.testResult.value === "number"
              ? `value=${state.testResult.value}${state.testResult.reason ? ` (${state.testResult.reason})` : ""}`
              : `no match${state.testResult.reason ? ` (${state.testResult.reason})` : ""}`}
          </div>
        )}
        <div className="text-xs text-slate-500">
          Learned digits: <span className="font-mono text-slate-300">{learnedDigits || "(none)"}</span>
        </div>
      </div>
    </div>
  );
}

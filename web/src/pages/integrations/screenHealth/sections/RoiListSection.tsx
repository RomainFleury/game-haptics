import { useState } from "react";
import { SCREEN_HEALTH_PRESETS } from "../../../../data/screenHealthPresets";
import { buildScreenHealthDaemonProfile } from "../buildDaemonProfile";
import { DIRECTION_KEYS } from "../constants";
import { useScreenHealthProfileDraftControls } from "../draft/ProfileDraftContext";
import { useScreenHealthColorVignetteDraft, useScreenHealthColorVignetteDraftControls } from "../draft/ColorVignetteDraftContext";
import { useScreenHealthRednessDraft, useScreenHealthRednessDraftControls } from "../draft/RednessDraftContext";
import { useScreenHealthHealthBarDraft, useScreenHealthHealthBarDraftControls } from "../draft/HealthBarDraftContext";
import { useScreenHealthHealthNumberDraft, useScreenHealthHealthNumberDraftControls } from "../draft/HealthNumberDraftContext";
import { useScreenHealthRecoilDraft, useScreenHealthRecoilDraftControls } from "../draft/RecoilDraftContext";
import { getDrawnSetup } from "../drawnSetup";
import { clamp01 } from "../utils";
import type { RoiDraft, RoiRect } from "../draft/types";

const PRESETS = SCREEN_HEALTH_PRESETS as Array<{ preset_id: string; profile: { meta?: unknown } }>;

// Reference resolution for pixel calculations (1920x1080)
const REF_WIDTH = 1920;
const REF_HEIGHT = 1080;

function RoiPreviewInfo({ rect }: { rect: RoiRect }) {
  const percentage = (rect.w * rect.h * 100).toFixed(2);
  const pixelWidth = Math.round(rect.w * REF_WIDTH);
  const pixelHeight = Math.round(rect.h * REF_HEIGHT);

  return (
    <div className="text-xs text-slate-400 mt-2 p-2 rounded bg-slate-800/30">
      <div className="font-medium text-slate-300 mb-1">Capture Preview</div>
      <div>
        <span className="text-slate-300">{percentage}%</span> of screen
      </div>
      <div className="text-slate-500">
        For {REF_WIDTH}x{REF_HEIGHT}px screens: {pixelWidth}×{pixelHeight}px
      </div>
    </div>
  );
}

export function RoiListSection(props: {
  lastCapturedImage: { path: string } | null;
  evaluateProfileOnScreenshot: (
    profile: Record<string, any>,
    imagePath: string
  ) => Promise<{ success: boolean; test_result?: Record<string, any> | null; error?: string }>;
}) {
  const { lastCapturedImage, evaluateProfileOnScreenshot } = props;
  const { readDraft: readProfileDraft } = useScreenHealthProfileDraftControls();
  const redness = useScreenHealthRednessDraft();
  const { readDraft: readRednessDraft, updateRoi, removeRoi } = useScreenHealthRednessDraftControls();
  const colorVignette = useScreenHealthColorVignetteDraft();
  const {
    readDraft: readColorVignetteDraft,
    updateRoi: updateColorVignetteRoi,
    removeRoi: removeColorVignetteRoi,
  } = useScreenHealthColorVignetteDraftControls();
  const hb = useScreenHealthHealthBarDraft();
  const { readDraft: readHealthBarDraft, setRoi: setHealthBarRoi } = useScreenHealthHealthBarDraftControls();
  const hn = useScreenHealthHealthNumberDraft();
  const { readDraft: readHealthNumberDraft, setRoi: setHealthNumberRoi } = useScreenHealthHealthNumberDraftControls();
  const recoil = useScreenHealthRecoilDraft();
  const {
    readDraft: readRecoilDraft,
    clearZones,
    updateZone,
    removeZone,
  } = useScreenHealthRecoilDraftControls();

  const [evaluating, setEvaluating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalResult, setEvalResult] = useState<Record<string, any> | null>(null);

  const rois = redness.rois;
  const colorVignetteRois = colorVignette.rois;
  const healthBarRoi = hb.roi;
  const healthNumberRoi = hn.roi;
  const ammoZones = recoil.zones;
  const drawn = getDrawnSetup({
    rednessRois: rois,
    colorVignetteRois,
    healthBarRoi,
    healthNumberRoi,
    ammoRoi: ammoZones[0]?.rect ?? null,
    ammoZones,
  });

  const hasScreenshotPath = Boolean(lastCapturedImage?.path?.trim());
  const canCapture =
    hasScreenshotPath &&
    (drawn.hasRedness || drawn.hasColorVignette || drawn.hasHealthBar || drawn.hasHealthNumber || drawn.hasAmmo);

  const runEvaluate = async () => {
    const imagePath = lastCapturedImage?.path?.trim();
    if (!imagePath) return;
    setEvaluating(true);
    setEvalError(null);
    setEvalResult(null);
    try {
      const daemonProfile = buildScreenHealthDaemonProfile({
        profileDraft: readProfileDraft(),
        redness: readRednessDraft(),
        colorVignette: readColorVignetteDraft(),
        hb: readHealthBarDraft(),
        hn: readHealthNumberDraft(),
        recoil: readRecoilDraft(),
        presets: PRESETS,
      });
      const result = await evaluateProfileOnScreenshot(daemonProfile, imagePath);
      if (!result.success) {
        setEvalError(result.error || "Evaluation failed");
        return;
      }
      setEvalResult(result.test_result || null);
    } catch (e) {
      setEvalError(e instanceof Error ? e.message : "Evaluation failed");
    } finally {
      setEvaluating(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Drawn boxes</h3>
        <button
          type="button"
          onClick={() => void runEvaluate()}
          disabled={!canCapture || evaluating}
          className="rounded-lg bg-slate-600/80 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-600 disabled:opacity-50"
          title={
            hasScreenshotPath
              ? "Send selected screenshot to the daemon and evaluate ROIs"
              : "Capture or load a screenshot first"
          }
        >
          {evaluating ? "Evaluating…" : "Evaluate boxes (daemon)"}
        </button>
      </div>

      {!hasScreenshotPath && (
        <div className="text-xs text-amber-200/90">Select or capture a calibration screenshot to enable evaluation.</div>
      )}

      {evalError && <div className="text-xs text-rose-300">{evalError}</div>}

      {evalResult && (
        <div className="rounded-xl bg-slate-900/40 p-3 ring-1 ring-white/5 text-sm">
          <div className="text-white font-medium mb-1">Daemon evaluation</div>
          <div className="text-xs text-slate-300 space-y-1">
            <div className="font-mono text-slate-400">
              source={String(evalResult.frame_source || "?")} total_ms=
              {typeof evalResult.total_ms === "number" ? evalResult.total_ms.toFixed(2) : "?"} frame=
              {evalResult.frame && typeof evalResult.frame === "object"
                ? `${evalResult.frame.w}x${evalResult.frame.h}`
                : "?"}
            </div>
            {Array.isArray(evalResult.detectors) && (
              <div className="space-y-1">
                {evalResult.detectors.slice(0, 12).map((d: any, idx: number) => (
                  <div key={idx} className="font-mono text-slate-400">
                    {d.type}:{d.name}{" "}
                    {typeof d.score === "number" ? `score=${d.score.toFixed(3)}` : ""}
                    {typeof d.percent === "number" ? ` percent=${(d.percent * 100).toFixed(1)}%` : ""}
                    {typeof d.overheat_score === "number" ? ` overheat=${d.overheat_score.toFixed(2)}` : ""}
                    {typeof d.read === "number" ? ` read=${d.read}` : d?.read === null ? " read=null" : ""}
                    {typeof d.image_path === "string" ? ` file=${d.image_path}` : ""}
                    {d.error ? ` err=${d.error}` : ""}
                  </div>
                ))}
              </div>
            )}
            {Array.isArray(evalResult.errors) && evalResult.errors.length > 0 && (
              <div className="text-amber-200/80">
                {evalResult.errors.slice(0, 5).map((err: string, i: number) => (
                  <div key={i}>{err}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {drawn.hasHealthBar && healthBarRoi && (
          <div className="rounded-lg bg-slate-700/20 p-3 ring-1 ring-white/5 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Horizontal box start (x)</label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  max="1"
                  value={healthBarRoi.x}
                  onChange={(e) => {
                    const val = clamp01(Number(e.target.value));
                    setHealthBarRoi({ ...healthBarRoi, x: val });
                  }}
                  className="w-full rounded-lg bg-slate-800/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Vertical box start (y)</label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  max="1"
                  value={healthBarRoi.y}
                  onChange={(e) => {
                    const val = clamp01(Number(e.target.value));
                    setHealthBarRoi({ ...healthBarRoi, y: val });
                  }}
                  className="w-full rounded-lg bg-slate-800/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Box width (w)</label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  max="1"
                  value={healthBarRoi.w}
                  onChange={(e) => {
                    const val = clamp01(Number(e.target.value));
                    setHealthBarRoi({ ...healthBarRoi, w: val });
                  }}
                  className="w-full rounded-lg bg-slate-800/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Box height (h)</label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  max="1"
                  value={healthBarRoi.h}
                  onChange={(e) => {
                    const val = clamp01(Number(e.target.value));
                    setHealthBarRoi({ ...healthBarRoi, h: val });
                  }}
                  className="w-full rounded-lg bg-slate-800/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
                />
              </div>
            </div>
            <RoiPreviewInfo rect={healthBarRoi} />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setHealthBarRoi(null)}
                className="rounded-lg bg-rose-600/70 px-3 py-2 text-sm font-medium text-white transition hover:bg-rose-600"
              >
                Clear
              </button>
            </div>
          </div>
      )}

      {drawn.hasHealthNumber && healthNumberRoi && (
          <div className="rounded-lg bg-slate-700/20 p-3 ring-1 ring-white/5 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Horizontal box start (x)</label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  max="1"
                  value={healthNumberRoi.x}
                  onChange={(e) => {
                    const val = clamp01(Number(e.target.value));
                    setHealthNumberRoi({ ...healthNumberRoi, x: val });
                  }}
                  className="w-full rounded-lg bg-slate-800/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Vertical box start (y)</label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  max="1"
                  value={healthNumberRoi.y}
                  onChange={(e) => {
                    const val = clamp01(Number(e.target.value));
                    setHealthNumberRoi({ ...healthNumberRoi, y: val });
                  }}
                  className="w-full rounded-lg bg-slate-800/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Box width (w)</label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  max="1"
                  value={healthNumberRoi.w}
                  onChange={(e) => {
                    const val = clamp01(Number(e.target.value));
                    setHealthNumberRoi({ ...healthNumberRoi, w: val });
                  }}
                  className="w-full rounded-lg bg-slate-800/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Box height (h)</label>
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  max="1"
                  value={healthNumberRoi.h}
                  onChange={(e) => {
                    const val = clamp01(Number(e.target.value));
                    setHealthNumberRoi({ ...healthNumberRoi, h: val });
                  }}
                  className="w-full rounded-lg bg-slate-800/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
                />
              </div>
            </div>
            <RoiPreviewInfo rect={healthNumberRoi} />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setHealthNumberRoi(null)}
                className="rounded-lg bg-rose-600/70 px-3 py-2 text-sm font-medium text-white transition hover:bg-rose-600"
              >
                Clear
              </button>
            </div>
          </div>
      )}

      {drawn.hasRedness && (
        <VignetteRoiCards rois={rois} updateRoi={updateRoi} removeRoi={removeRoi} />
      )}

      {drawn.hasColorVignette && (
        <VignetteRoiCards rois={colorVignetteRois} updateRoi={updateColorVignetteRoi} removeRoi={removeColorVignetteRoi} />
      )}

      {drawn.hasAmmo && ammoZones.length > 0 && (
        <div className="space-y-2">
          {ammoZones.map((z, idx) => (
            <div key={`${z.name}-${idx}`} className="rounded-lg bg-slate-700/20 p-3 ring-1 ring-white/5 space-y-3">
              <div className="text-xs font-medium text-amber-200">
                {recoil.recoilType === "fill_up_bar"
                  ? "Fill-up bar"
                  : ammoZones.length > 1
                    ? `Ammo counter (${idx + 1}/${ammoZones.length})`
                    : "Ammo counter"}
              </div>
              {recoil.recoilType !== "fill_up_bar" && (
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Name</label>
                  <input
                    value={z.name}
                    onChange={(e) => updateZone(idx, { name: e.target.value })}
                    className="w-full rounded-lg bg-slate-800/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
                  />
                </div>
              )}
              <RoiPreviewInfo rect={z.rect} />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (ammoZones.length <= 1) {
                      clearZones();
                    } else {
                      removeZone(idx);
                    }
                  }}
                  className="rounded-lg bg-rose-600/70 px-3 py-2 text-sm font-medium text-white transition hover:bg-rose-600"
                >
                  {ammoZones.length <= 1 ? "Clear" : "Remove"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!drawn.hasRedness &&
        !drawn.hasColorVignette &&
        !drawn.hasHealthBar &&
        !drawn.hasHealthNumber &&
        !drawn.hasAmmo && (
        <div className="text-sm text-slate-500">No boxes yet. Capture a screenshot and draw one.</div>
      )}
    </div>
  );
}

function VignetteRoiCards(props: {
  rois: RoiDraft[];
  updateRoi: (index: number, patch: Partial<RoiDraft>) => void;
  removeRoi: (index: number) => void;
}) {
  const { rois, updateRoi, removeRoi } = props;
  return (
    <div className="space-y-2">
      {rois.map((r, idx) => (
        <div key={`${r.name}-${idx}`} className="rounded-lg bg-slate-700/20 p-3 ring-1 ring-white/5 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Name</label>
              <input
                value={r.name}
                onChange={(e) => updateRoi(idx, { name: e.target.value })}
                className="w-full rounded-lg bg-slate-800/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Direction (optional — defaults to random)</label>
              <select
                value={r.direction || ""}
                onChange={(e) => updateRoi(idx, { direction: e.target.value })}
                className="w-full rounded-lg bg-slate-800/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
              >
                {DIRECTION_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {k || "(none)"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Horizontal box start (x)</label>
              <input
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={r.rect.x}
                onChange={(e) => {
                  const val = clamp01(Number(e.target.value));
                  updateRoi(idx, { rect: { ...r.rect, x: val } });
                }}
                className="w-full rounded-lg bg-slate-800/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Vertical box start (y)</label>
              <input
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={r.rect.y}
                onChange={(e) => {
                  const val = clamp01(Number(e.target.value));
                  updateRoi(idx, { rect: { ...r.rect, y: val } });
                }}
                className="w-full rounded-lg bg-slate-800/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Box width (w)</label>
              <input
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={r.rect.w}
                onChange={(e) => {
                  const val = clamp01(Number(e.target.value));
                  updateRoi(idx, { rect: { ...r.rect, w: val } });
                }}
                className="w-full rounded-lg bg-slate-800/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Box height (h)</label>
              <input
                type="number"
                step="0.001"
                min="0"
                max="1"
                value={r.rect.h}
                onChange={(e) => {
                  const val = clamp01(Number(e.target.value));
                  updateRoi(idx, { rect: { ...r.rect, h: val } });
                }}
                className="w-full rounded-lg bg-slate-800/50 px-3 py-2 text-sm text-white ring-1 ring-white/10"
              />
            </div>
          </div>
          <RoiPreviewInfo rect={r.rect} />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => removeRoi(idx)}
              className="rounded-lg bg-rose-600/70 px-3 py-2 text-sm font-medium text-white transition hover:bg-rose-600"
            >
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

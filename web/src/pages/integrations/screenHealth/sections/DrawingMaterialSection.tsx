import { useScreenHealthHealthBarDraft } from "../draft/HealthBarDraftContext";
import { useScreenHealthHealthNumberDraft } from "../draft/HealthNumberDraftContext";
import { useScreenHealthProfileDraft, useScreenHealthProfileDraftControls } from "../draft/ProfileDraftContext";
import { useScreenHealthRecoilDraft, useScreenHealthRecoilDraftControls } from "../draft/RecoilDraftContext";
import type { RecoilDrawKind } from "../draft/RecoilDraftContext";
import { useScreenHealthColorVignetteDraft } from "../draft/ColorVignetteDraftContext";
import { useScreenHealthRednessDraft } from "../draft/RednessDraftContext";
import { getDrawnSetup, lockedHitDetectorType } from "../drawnSetup";
import type { DetectorType } from "../draft/types";

const HIT_OPTIONS: Array<{ value: DetectorType; label: string }> = [
  { value: "redness_rois", label: "Red vignette" },
  { value: "color_vignette", label: "Color vignette" },
  { value: "health_bar", label: "Health bar" },
  { value: "health_number", label: "Health number" },
];

const RECOIL_OPTIONS: Array<{ value: RecoilDrawKind; label: string }> = [
  { value: "ammo_number", label: "Ammo counter" },
  { value: "fill_up_bar", label: "Fill-up bar" },
];

export function DrawingMaterialSection() {
  const profile = useScreenHealthProfileDraft();
  const { setDetectorType, setCanvasEditTarget } = useScreenHealthProfileDraftControls();
  const redness = useScreenHealthRednessDraft();
  const colorVignette = useScreenHealthColorVignetteDraft();
  const hb = useScreenHealthHealthBarDraft();
  const hn = useScreenHealthHealthNumberDraft();
  const recoil = useScreenHealthRecoilDraft();
  const { setRecoilDrawKind } = useScreenHealthRecoilDraftControls();
  const drawn = getDrawnSetup({
    rednessRois: redness.rois,
    colorVignetteRois: colorVignette.rois,
    healthBarRoi: hb.roi,
    healthNumberRoi: hn.roi,
    ammoRoi: recoil.zones[0]?.rect ?? null,
    ammoZones: recoil.zones,
  });
  const lockedHit = lockedHitDetectorType(drawn);
  const drawingHit = profile.canvasEditTarget === "detector";
  const hitValue = lockedHit ?? profile.detectorType;

  const selectHit = (next: DetectorType) => {
    if (lockedHit && next !== lockedHit) return;
    setDetectorType(next);
    setCanvasEditTarget("detector");
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-white">Draw</h3>
      <p className="text-xs text-slate-500">
        Hit detection is one type only. Recoil is separate (ammo numbers — draw one box per gun — or a fill-up heat bar).
        Settings appear after you draw.
      </p>
      <div className="flex flex-wrap gap-4 items-end">
        <div className="space-y-1">
          <label className="text-sm text-slate-400 block">Hit detection</label>
          <select
            value={hitValue}
            onFocus={() => setCanvasEditTarget("detector")}
            onChange={(e) => selectHit(e.target.value as DetectorType)}
            className={`rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-white ring-1 ${
              drawingHit ? "ring-emerald-400/70" : "ring-white/10"
            }`}
          >
            {HIT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={Boolean(lockedHit && lockedHit !== opt.value)}>
                {opt.label}
              </option>
            ))}
          </select>
          {lockedHit && (
            <p className="text-xs text-slate-500">Clear the current hit boxes to switch type.</p>
          )}
        </div>
        <div className="space-y-1">
          <label className="text-sm text-slate-400 block">Recoil / fire</label>
          <select
            value={recoil.recoilDrawKind}
            onFocus={() => setCanvasEditTarget("recoil")}
            onMouseDown={() => setCanvasEditTarget("recoil")}
            onChange={(e) => setRecoilDrawKind(e.target.value as RecoilDrawKind)}
            className={`rounded-lg bg-slate-700/50 px-3 py-2 text-sm text-white ring-1 ${
              drawingHit ? "ring-white/10" : "ring-amber-400/70"
            }`}
          >
            {RECOIL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

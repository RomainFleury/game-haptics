import { DEFAULT_RECOIL_DRAFT, type RecoilDraftState, type RecoilZoneDraft } from "./draft/RecoilDraftContext";
import { DEFAULT_AMMO_OCR_ENGINE, normalizeAmmoOcrEngine } from "./ammoOcrEngines";

function rgbFrom(raw: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(raw) || raw.length !== 3) return fallback;
  return [
    Math.max(0, Math.min(255, Number(raw[0]) || 0)),
    Math.max(0, Math.min(255, Number(raw[1]) || 0)),
    Math.max(0, Math.min(255, Number(raw[2]) || 0)),
  ];
}


function templatesFromProfile(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v)) out[k] = v.map((x) => (Number(x) ? "1" : "0")).join("");
  }
  return out;
}
function zoneFromRoi(name: string, roi: any, fallbackW: number, fallbackH: number): RecoilZoneDraft {
  return {
    name,
    rect: {
      x: Number(roi?.x ?? 0),
      y: Number(roi?.y ?? 0),
      w: Number(roi?.w ?? fallbackW),
      h: Number(roi?.h ?? fallbackH),
    },
  };
}

/** Build recoil draft fields from a daemon profile JSON object. */
export function recoilDraftFromProfile(p: any): Partial<RecoilDraftState> {
  const r = p?.recoil;
  if (!r || typeof r !== "object" || r.type === "off" || !r.type) {
    return {
      recoilType: "off",
      recoilDrawKind: DEFAULT_RECOIL_DRAFT.recoilDrawKind,
      ocrEngine: DEFAULT_AMMO_OCR_ENGINE,
      durationMs: DEFAULT_RECOIL_DRAFT.durationMs,
      zones: [],
      colorPickMode: null,
      calibrationError: null,
      testResult: null,
      fillUpTestResult: null,
    };
  }

  if (r.type === "fill_up_bar") {
    const colors = r.color_sampling && typeof r.color_sampling === "object" ? r.color_sampling : r;
    const fillUp = r.fill_up && typeof r.fill_up === "object" ? r.fill_up : {};
    // Prefer background_rgb; accept empty_rgb from older profiles.
    const backgroundRaw = colors.background_rgb ?? colors.empty_rgb;
    return {
      recoilType: "fill_up_bar",
      recoilDrawKind: "fill_up_bar",
      durationMs: Number(r.duration_ms ?? DEFAULT_RECOIL_DRAFT.durationMs),
      zones: [zoneFromRoi(String(r.name || "fill_up_bar"), r.roi, 0.16, 0.03)],
      backgroundRgb: rgbFrom(backgroundRaw, DEFAULT_RECOIL_DRAFT.backgroundRgb),
      toleranceL1: Number(colors.tolerance_l1 ?? r.tolerance_l1 ?? DEFAULT_RECOIL_DRAFT.toleranceL1),
      minBackgroundDrop: Number(
        fillUp.min_background_drop ??
          fillUp.min_rise ??
          r.min_background_drop ??
          r.min_rise ??
          DEFAULT_RECOIL_DRAFT.minBackgroundDrop
      ),
      hitCooldownMs: Number(fillUp.cooldown_ms ?? r.cooldown_ms ?? DEFAULT_RECOIL_DRAFT.hitCooldownMs),
      colorPickMode: null,
      calibrationError: null,
      testResult: null,
      fillUpTestResult: null,
    };
  }

  if (r.type !== "ammo_number") {
    return { recoilType: "off", ocrEngine: DEFAULT_AMMO_OCR_ENGINE, calibrationError: null, testResult: null };
  }

  const zonesRaw = Array.isArray(r.zones) ? r.zones : null;
  const zones: RecoilZoneDraft[] =
    zonesRaw && zonesRaw.length > 0
      ? zonesRaw
          .filter((z: any) => z && typeof z === "object" && z.roi)
          .map((z: any, idx: number) => zoneFromRoi(String(z.name || `ammo_${idx + 1}`), z.roi, 0.08, 0.04))
      : r.roi
        ? [zoneFromRoi(String(r.name || "ammo_1"), r.roi, 0.08, 0.04)]
        : [];

  const tmpl = r.templates && typeof r.templates === "object" ? r.templates : {};
  const hasTmplDigits = !!(tmpl as any).digits && typeof (tmpl as any).digits === "object";
  return {
    recoilType: "ammo_number",
    recoilDrawKind: "ammo_number",
    ocrEngine: normalizeAmmoOcrEngine(r.engine === "templates" || hasTmplDigits ? "templates" : r.engine),
    durationMs: Number(r.duration_ms ?? DEFAULT_RECOIL_DRAFT.durationMs),
    zones,
    stableReads: Number(r.readout?.stable_reads ?? 2),
    hitMinDrop: Number(r.hit_on_decrease?.min_drop ?? 1),
    hitCooldownMs: Number(r.hit_on_decrease?.cooldown_ms ?? 50),
    digits: Number(r.digits ?? DEFAULT_RECOIL_DRAFT.digits),
    invert: Boolean(r.preprocess?.invert ?? DEFAULT_RECOIL_DRAFT.invert),
    threshold: Number(r.preprocess?.threshold ?? DEFAULT_RECOIL_DRAFT.threshold),
    scale: Number(r.preprocess?.scale ?? DEFAULT_RECOIL_DRAFT.scale),
    hammingMax: Number((tmpl as any).hamming_max ?? DEFAULT_RECOIL_DRAFT.hammingMax),
    templateSize: {
      w: Number((tmpl as any).width ?? DEFAULT_RECOIL_DRAFT.templateSize.w),
      h: Number((tmpl as any).height ?? DEFAULT_RECOIL_DRAFT.templateSize.h),
    },
    templates: templatesFromProfile((tmpl as any).digits),
    learnValue: "",
    colorPickMode: null,
    calibrationError: null,
    testResult: null,
    fillUpTestResult: null,
  };
}

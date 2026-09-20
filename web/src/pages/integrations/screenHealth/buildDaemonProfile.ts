import type { DetectorType, RecoilType } from "./draft/types";
import { clamp01, clampInt } from "./utils";
import type { AmmoOcrEngineId } from "./ammoOcrEngines";
import { getDrawnSetup, lockedHitDetectorType } from "./drawnSetup";

export type ProfileDraftSnapshot = {
  selectedPresetId: string;
  detectorType: DetectorType;
  profileName: string;
  monitorIndex: number;
  tickMs: number;
};

export type RednessDraftSnapshot = {
  minScore: number;
  cooldownMs: number;
  rois: Array<{ name: string; direction: string; rect: { x: number; y: number; w: number; h: number } }>;
};

export type ColorVignetteDraftSnapshot = {
  minScore: number;
  cooldownMs: number;
  targetRgb: number[];
  toleranceL1: number;
  rois: Array<{ name: string; direction: string; rect: { x: number; y: number; w: number; h: number } }>;
};

export type HealthBarDraftSnapshot = {
  roi: { x: number; y: number; w: number; h: number } | null;
  mode: string;
  filledRgb: number[];
  emptyRgb: number[];
  toleranceL1: number;
  fallbackMode: string;
  fallbackMin: number;
  hitMinDrop: number;
  hitCooldownMs: number;
};

export type HealthNumberDraftSnapshot = {
  roi: { x: number; y: number; w: number; h: number } | null;
  digits: number;
  invert: boolean;
  threshold: number;
  scale: number;
  readMin: number;
  readMax: number;
  stableReads: number;
  hitMinDrop: number;
  hitCooldownMs: number;
  hammingMax: number;
  templateSize: { w: number; h: number };
  templates: Record<string, unknown>;
};

export type RecoilDraftSnapshot = {
  recoilType: RecoilType;
  recoilDrawKind?: "ammo_number" | "fill_up_bar";
  ocrEngine?: AmmoOcrEngineId;
  durationMs: number;
  zones: Array<{ name: string; rect: { x: number; y: number; w: number; h: number } }>;
  /** @deprecated Prefer zones[]; kept for older call sites that still pass a single roi. */
  roi?: { x: number; y: number; w: number; h: number } | null;
  stableReads: number;
  hitMinDrop: number;
  hitCooldownMs: number;
  digits?: number;
  invert?: boolean;
  threshold?: number;
  scale?: number;
  hammingMax?: number;
  templateSize?: { w: number; h: number };
  templates?: Record<string, unknown>;
  backgroundRgb?: number[];
  toleranceL1?: number;
  minBackgroundDrop?: number;
};

function recoilZones(recoil: RecoilDraftSnapshot): Array<{ name: string; rect: { x: number; y: number; w: number; h: number } }> {
  if (Array.isArray(recoil.zones) && recoil.zones.length > 0) return recoil.zones;
  if (recoil.roi) return [{ name: "ammo_1", rect: recoil.roi }];
  return [];
}

function attachRecoil(profile: Record<string, any>, recoil?: RecoilDraftSnapshot): Record<string, any> {
  if (!recoil) return profile;
  const zones = recoilZones(recoil);
  if (zones.length === 0) return profile;
  const kind =
    recoil.recoilType === "fill_up_bar"
      ? "fill_up_bar"
      : recoil.recoilType === "ammo_number"
        ? "ammo_number"
        : recoil.recoilDrawKind === "fill_up_bar"
          ? "fill_up_bar"
          : "ammo_number";
  if (kind === "fill_up_bar") {
    const roi = zones[0].rect;
    return {
      ...profile,
      recoil: {
        type: "fill_up_bar",
        duration_ms: Math.max(25, Math.floor(recoil.durationMs)),
        roi: { x: clamp01(roi.x), y: clamp01(roi.y), w: clamp01(roi.w), h: clamp01(roi.h) },
        orientation: "horizontal",
        color_sampling: {
          background_rgb: (recoil.backgroundRgb ?? [40, 40, 45]).map((v) => clampInt(v, 0, 255)),
          tolerance_l1: clampInt(recoil.toleranceL1 ?? 180, 0, 765),
        },
        fill_up: {
          min_background_drop: Math.max(0.01, Math.min(1, recoil.minBackgroundDrop ?? 0.03)),
          cooldown_ms: Math.max(0, Math.floor(recoil.hitCooldownMs)),
        },
      },
    };
  }
  const templateDigits = recoil.templates && typeof recoil.templates === "object" ? recoil.templates : {};
  const hasTemplates = Object.keys(templateDigits).length > 0;
  const useTemplates = hasTemplates || recoil.ocrEngine === "templates";
  const shared = useTemplates
    ? {
        type: "ammo_number" as const,
        engine: "templates",
        duration_ms: Math.max(25, Math.floor(recoil.durationMs)),
        digits: Math.max(1, Math.floor(recoil.digits ?? 3)),
        preprocess: {
          invert: Boolean(recoil.invert),
          threshold: Math.max(0, Math.min(1, recoil.threshold ?? 0.55)),
          scale: Math.max(1, Math.floor(recoil.scale ?? 2)),
        },
        readout: {
          min: 0,
          max: 999,
          stable_reads: Math.max(1, Math.floor(recoil.stableReads)),
        },
        hit_on_decrease: {
          min_drop: Math.max(1, Math.floor(recoil.hitMinDrop)),
          cooldown_ms: Math.max(0, Math.floor(recoil.hitCooldownMs)),
        },
        templates: {
          template_set_id: "learned_v1",
          hamming_max: Math.max(0, Math.floor(recoil.hammingMax ?? 120)),
          width: Math.max(4, Math.floor(recoil.templateSize?.w ?? 16)),
          height: Math.max(4, Math.floor(recoil.templateSize?.h ?? 24)),
          digits: templateDigits,
        },
      }
    : {
        type: "ammo_number" as const,
        engine: recoil.ocrEngine && recoil.ocrEngine !== "templates" ? recoil.ocrEngine : "daemon",
        duration_ms: Math.max(25, Math.floor(recoil.durationMs)),
        // Text OCR reads variable-width ammo (1–3). `digits` is only a schema upper bound.
        digits: 3,
        readout: {
          min: 0,
          max: 999,
          stable_reads: Math.max(1, Math.floor(recoil.stableReads)),
        },
        hit_on_decrease: {
          min_drop: Math.max(1, Math.floor(recoil.hitMinDrop)),
          cooldown_ms: Math.max(0, Math.floor(recoil.hitCooldownMs)),
        },
      };
  if (zones.length === 1) {
    const roi = zones[0].rect;
    return {
      ...profile,
      recoil: {
        ...shared,
        name: zones[0].name || "ammo_number",
        roi: { x: clamp01(roi.x), y: clamp01(roi.y), w: clamp01(roi.w), h: clamp01(roi.h) },
      },
    };
  }
  return {
    ...profile,
    recoil: {
      ...shared,
      zones: zones.map((z, idx) => ({
        name: z.name || `ammo_${idx + 1}`,
        roi: {
          x: clamp01(z.rect.x),
          y: clamp01(z.rect.y),
          w: clamp01(z.rect.w),
          h: clamp01(z.rect.h),
        },
      })),
    },
  };
}

/**
 * Build daemon JSON (schema v0) from current draft snapshots. Used for save, export, and ROI evaluation.
 */
export function buildScreenHealthDaemonProfile(args: {
  profileDraft: ProfileDraftSnapshot;
  redness: RednessDraftSnapshot;
  colorVignette?: ColorVignetteDraftSnapshot;
  hb: HealthBarDraftSnapshot;
  hn: HealthNumberDraftSnapshot;
  recoil?: RecoilDraftSnapshot;
  presets: Array<{ preset_id: string; profile: { meta?: unknown } }>;
}): Record<string, any> {
  const { profileDraft, redness, colorVignette, hb, hn, recoil, presets } = args;
  const cv = colorVignette ?? { minScore: 0.35, cooldownMs: 200, targetRgb: [220, 40, 40], toleranceL1: 120, rois: [] };
  const presetMeta = (presets.find((p) => p.preset_id === profileDraft.selectedPresetId)?.profile as any)?.meta;
  const drawn = getDrawnSetup({
    rednessRois: redness.rois,
    colorVignetteRois: cv.rois,
    healthBarRoi: hb.roi,
    healthNumberRoi: hn.roi,
    ammoRoi: (recoil ? recoilZones(recoil) : [])[0]?.rect ?? null,
  });
  const hitType = lockedHitDetectorType(drawn);
  const detectors: Record<string, unknown>[] = [];

  const mapVignetteRois = (rois: RednessDraftSnapshot["rois"]) =>
    rois.map((r) => ({
      name: r.name,
      direction: r.direction || undefined,
      rect: {
        x: clamp01(r.rect.x),
        y: clamp01(r.rect.y),
        w: clamp01(r.rect.w),
        h: clamp01(r.rect.h),
      },
    }));

  if (hitType === "health_bar" && hb.roi) {
    const roi = hb.roi;
    detectors.push({
      type: "health_bar",
      name: "health_bar",
      roi: { x: clamp01(roi.x), y: clamp01(roi.y), w: clamp01(roi.w), h: clamp01(roi.h) },
      orientation: "horizontal",
      ...(hb.mode === "color_sampling"
        ? {
            color_sampling: {
              filled_rgb: hb.filledRgb.map((v) => clampInt(v, 0, 255)),
              empty_rgb: hb.emptyRgb.map((v) => clampInt(v, 0, 255)),
              tolerance_l1: clampInt(hb.toleranceL1, 0, 765),
            },
          }
        : {
            threshold_fallback: {
              mode: hb.fallbackMode,
              min: Math.max(0, Math.min(1, hb.fallbackMin)),
            },
          }),
      hit_on_decrease: {
        min_drop: Math.max(0, Math.min(1, hb.hitMinDrop)),
        cooldown_ms: Math.max(0, Math.floor(hb.hitCooldownMs)),
      },
    });
  } else if (hitType === "health_number" && hn.roi) {
    const roi = hn.roi;
    detectors.push({
      type: "health_number",
      name: "health_number",
      engine: "daemon",
      roi: { x: clamp01(roi.x), y: clamp01(roi.y), w: clamp01(roi.w), h: clamp01(roi.h) },
      digits: Math.max(1, Math.floor(hn.digits)),
      readout: {
        min: Math.floor(hn.readMin),
        max: Math.floor(hn.readMax),
        stable_reads: Math.max(1, Math.floor(hn.stableReads)),
      },
      hit_on_decrease: {
        min_drop: Math.max(1, Math.floor(hn.hitMinDrop)),
        cooldown_ms: Math.max(0, Math.floor(hn.hitCooldownMs)),
      },
    });
  } else if (hitType === "color_vignette" && cv.rois.length > 0) {
    detectors.push({
      type: "color_vignette",
      cooldown_ms: cv.cooldownMs,
      threshold: { min_score: cv.minScore },
      target_rgb: cv.targetRgb.map((v) => clampInt(v, 0, 255)),
      tolerance_l1: clampInt(cv.toleranceL1, 0, 765),
      rois: mapVignetteRois(cv.rois),
    });
  } else if (hitType === "redness_rois" && redness.rois.length > 0) {
    detectors.push({
      type: "redness_rois",
      cooldown_ms: redness.cooldownMs,
      threshold: { min_score: redness.minScore },
      rois: mapVignetteRois(redness.rois),
    });
  }

  return attachRecoil(
    {
      schema_version: 0,
      name: profileDraft.profileName,
      meta: presetMeta,
      capture: { source: "monitor", monitor_index: profileDraft.monitorIndex, tick_ms: profileDraft.tickMs },
      detectors,
    },
    recoil
  );
}

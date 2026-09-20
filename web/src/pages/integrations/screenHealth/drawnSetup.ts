import type { DetectorType } from "./draft/types";

export type DrawnSetup = {
  hasRedness: boolean;
  hasColorVignette: boolean;
  hasHealthBar: boolean;
  hasHealthNumber: boolean;
  hasAmmo: boolean;
  hitCount: number;
};

export function getDrawnSetup(args: {
  rednessRois: unknown[];
  colorVignetteRois?: unknown[];
  healthBarRoi: unknown;
  healthNumberRoi: unknown;
  /** True if any recoil ROI exists (ammo zones and/or fill-up). */
  ammoRoi: unknown;
  /** Optional multi ammo zones; when provided, length > 0 also counts as hasAmmo. */
  ammoZones?: unknown[];
}): DrawnSetup {
  const hasRedness = args.rednessRois.length > 0;
  const hasColorVignette = (args.colorVignetteRois?.length ?? 0) > 0;
  const hasHealthBar = Boolean(args.healthBarRoi);
  const hasHealthNumber = Boolean(args.healthNumberRoi);
  const hasAmmo = Boolean(args.ammoRoi) || (args.ammoZones?.length ?? 0) > 0;
  return {
    hasRedness,
    hasColorVignette,
    hasHealthBar,
    hasHealthNumber,
    hasAmmo,
    hitCount:
      Number(hasRedness) + Number(hasColorVignette) + Number(hasHealthBar) + Number(hasHealthNumber),
  };
}

/** Which hit detector is locked, if any boxes of that kind exist. */
export function lockedHitDetectorType(drawn: DrawnSetup): DetectorType | null {
  if (drawn.hasHealthBar) return "health_bar";
  if (drawn.hasHealthNumber) return "health_number";
  if (drawn.hasColorVignette) return "color_vignette";
  if (drawn.hasRedness) return "redness_rois";
  return null;
}

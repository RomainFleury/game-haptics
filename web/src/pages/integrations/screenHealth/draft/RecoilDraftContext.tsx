import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { HealthNumberTestResult, RecoilType, RoiRect } from "./types";
import type { AmmoOcrEngineId } from "../ammoOcrEngines";

export type FillUpBarTestResult = {
  percent: number | null;
  backgroundFraction?: number;
  reason?: string;
} | null;

export type RecoilDrawKind = "ammo_number" | "fill_up_bar";
export type FillUpColorPickMode = null | "background";

export type RecoilZoneDraft = {
  name: string;
  rect: RoiRect;
};

export type RecoilDraftState = {
  recoilType: RecoilType;
  recoilDrawKind: RecoilDrawKind;
  ocrEngine: AmmoOcrEngineId;
  durationMs: number;
  /**
   * Recoil ROIs. Ammo counter supports multiple (dual-wield). Fill-up bar uses at most one.
   * Legacy profiles with a single `roi` load as one zone.
   */
  zones: RecoilZoneDraft[];
  stableReads: number;
  hitMinDrop: number;
  hitCooldownMs: number;
  /** Max digit width for template matching (runtime also tries 1..digits). */
  digits: number;
  invert: boolean;
  threshold: number;
  scale: number;
  hammingMax: number;
  templateSize: { w: number; h: number };
  /** Bitstring templates keyed by digit char "0".."9". */
  templates: Record<string, string>;
  learnValue: string;
  /** Unfilled bar background (often translucent). White/red fill = not-background. */
  backgroundRgb: [number, number, number];
  /** L1 match tolerance; raise for translucent HUDs (default 180). */
  toleranceL1: number;
  /** Min drop in background coverage (0..1) to count as a shot. */
  minBackgroundDrop: number;
  colorPickMode: FillUpColorPickMode;
  calibrationError: string | null;
  testResult: HealthNumberTestResult;
  fillUpTestResult: FillUpBarTestResult;
};

type Actions = {
  setRecoilType: (v: RecoilType) => void;
  setRecoilDrawKind: (v: RecoilDrawKind) => void;
  setOcrEngine: (v: AmmoOcrEngineId) => void;
  setDurationMs: (v: number) => void;
  /** Replace all zones with a single ROI (fill-up) or clear when null. */
  setRoi: (v: RoiRect | null) => void;
  /** Append an ammo zone (dual-wield / multi gun). */
  appendAmmoZone: (rect: RoiRect) => void;
  updateZone: (index: number, patch: Partial<RecoilZoneDraft>) => void;
  removeZone: (index: number) => void;
  clearZones: () => void;
  setStableReads: (v: number) => void;
  setHitMinDrop: (v: number) => void;
  setHitCooldownMs: (v: number) => void;
  setDigits: (v: number) => void;
  setInvert: (v: boolean) => void;
  setThreshold: (v: number) => void;
  setScale: (v: number) => void;
  setHammingMax: (v: number) => void;
  setTemplateSize: (v: { w: number; h: number }) => void;
  setTemplates: (v: Record<string, string>) => void;
  setLearnValue: (v: string) => void;
  clearTemplates: () => void;
  setBackgroundRgb: (v: [number, number, number]) => void;
  setToleranceL1: (v: number) => void;
  setMinBackgroundDrop: (v: number) => void;
  setColorPickMode: (v: FillUpColorPickMode) => void;
  setCalibrationError: (v: string | null) => void;
  setTestResult: (v: HealthNumberTestResult) => void;
  setFillUpTestResult: (v: FillUpBarTestResult) => void;
  replaceAll: (next: Partial<RecoilDraftState>) => void;
  readDraft: () => RecoilDraftState;
};

const StateC = createContext<RecoilDraftState | null>(null);
const ActionsC = createContext<Actions | null>(null);

export const DEFAULT_RECOIL_DRAFT: RecoilDraftState = {
  recoilType: "off",
  recoilDrawKind: "ammo_number",
  ocrEngine: "templates",
  durationMs: 40,
  zones: [],
  stableReads: 2,
  hitMinDrop: 1,
  hitCooldownMs: 50,
  digits: 1,
  invert: false,
  threshold: 0.55,
  scale: 2,
  hammingMax: 120,
  templateSize: { w: 16, h: 24 },
  templates: {},
  learnValue: "",
  backgroundRgb: [40, 40, 45],
  toleranceL1: 180,
  minBackgroundDrop: 0.03,
  colorPickMode: null,
  calibrationError: null,
  testResult: null,
  fillUpTestResult: null,
};

/** Primary / fill-up ROI (first zone), or null. */
export function primaryRecoilRoi(state: Pick<RecoilDraftState, "zones">): RoiRect | null {
  return state.zones[0]?.rect ?? null;
}

function nextAmmoName(existing: RecoilZoneDraft[]): string {
  const used = new Set(existing.map((z) => z.name));
  let i = 1;
  while (used.has(`ammo_${i}`)) i += 1;
  return `ammo_${i}`;
}

export function ScreenHealthRecoilDraftProvider(props: { children: ReactNode }) {
  const initial = DEFAULT_RECOIL_DRAFT;
  const [state, setState] = useState<RecoilDraftState>(initial);
  const stateRef = useRef<RecoilDraftState>(initial);

  const setStateAndRef = (updater: (prev: RecoilDraftState) => RecoilDraftState) => {
    setState((prev) => {
      const next = updater(prev);
      stateRef.current = next;
      return next;
    });
  };

  const actions = useMemo<Actions>(() => {
    return {
      setRecoilType: (v) => setStateAndRef((p) => ({ ...p, recoilType: v })),
      setRecoilDrawKind: (v) =>
        setStateAndRef((p) => ({
          ...p,
          recoilDrawKind: v,
          recoilType: p.zones.length ? v : p.recoilType,
          // Fill-up is a single bar — keep only the first zone if switching from multi-ammo.
          zones: v === "fill_up_bar" && p.zones.length > 1 ? [p.zones[0]] : p.zones,
        })),
      setOcrEngine: (v) => setStateAndRef((p) => ({ ...p, ocrEngine: v })),
      setDurationMs: (v) => setStateAndRef((p) => ({ ...p, durationMs: v })),
      setRoi: (v) =>
        setStateAndRef((p) => {
          if (!v) {
            return { ...p, zones: [], recoilType: "off" };
          }
          const name =
            p.recoilDrawKind === "fill_up_bar"
              ? p.zones[0]?.name || "fill_up_bar"
              : p.zones[0]?.name || "ammo_1";
          return {
            ...p,
            zones: [{ name, rect: v }],
            recoilType: p.recoilDrawKind,
          };
        }),
      appendAmmoZone: (rect) =>
        setStateAndRef((p) => ({
          ...p,
          recoilDrawKind: "ammo_number",
          recoilType: "ammo_number",
          zones: [...p.zones, { name: nextAmmoName(p.zones), rect }],
        })),
      updateZone: (index, patch) =>
        setStateAndRef((p) => ({
          ...p,
          zones: p.zones.map((z, i) => (i === index ? { ...z, ...patch } : z)),
        })),
      removeZone: (index) =>
        setStateAndRef((p) => {
          const zones = p.zones.filter((_, i) => i !== index);
          return {
            ...p,
            zones,
            recoilType: zones.length ? p.recoilType : "off",
          };
        }),
      clearZones: () => setStateAndRef((p) => ({ ...p, zones: [], recoilType: "off" })),
      setStableReads: (v) => setStateAndRef((p) => ({ ...p, stableReads: v })),
      setHitMinDrop: (v) => setStateAndRef((p) => ({ ...p, hitMinDrop: v })),
      setHitCooldownMs: (v) => setStateAndRef((p) => ({ ...p, hitCooldownMs: v })),
      setDigits: (v) => setStateAndRef((p) => ({ ...p, digits: v })),
      setInvert: (v) => setStateAndRef((p) => ({ ...p, invert: v })),
      setThreshold: (v) => setStateAndRef((p) => ({ ...p, threshold: v })),
      setScale: (v) => setStateAndRef((p) => ({ ...p, scale: v })),
      setHammingMax: (v) => setStateAndRef((p) => ({ ...p, hammingMax: v })),
      setTemplateSize: (v) => setStateAndRef((p) => ({ ...p, templateSize: v })),
      setTemplates: (v) => setStateAndRef((p) => ({ ...p, templates: v, ocrEngine: "templates" })),
      setLearnValue: (v) => setStateAndRef((p) => ({ ...p, learnValue: v })),
      clearTemplates: () =>
        setStateAndRef((p) => ({ ...p, templates: {}, testResult: null, calibrationError: null })),
      setBackgroundRgb: (v) => setStateAndRef((p) => ({ ...p, backgroundRgb: v })),
      setToleranceL1: (v) => setStateAndRef((p) => ({ ...p, toleranceL1: v })),
      setMinBackgroundDrop: (v) => setStateAndRef((p) => ({ ...p, minBackgroundDrop: v })),
      setColorPickMode: (v) => setStateAndRef((p) => ({ ...p, colorPickMode: v })),
      setCalibrationError: (v) => setStateAndRef((p) => ({ ...p, calibrationError: v })),
      setTestResult: (v) => setStateAndRef((p) => ({ ...p, testResult: v })),
      setFillUpTestResult: (v) => setStateAndRef((p) => ({ ...p, fillUpTestResult: v })),
      replaceAll: (next) => setStateAndRef((p) => ({ ...p, ...next })),
      readDraft: () => stateRef.current,
    };
  }, []);

  // Template size change invalidates existing bitstrings.
  useEffect(() => {
    setStateAndRef((p) => ({ ...p, templates: {}, testResult: null, calibrationError: null }));
  }, [state.templateSize.w, state.templateSize.h]);

  return (
    <ActionsC.Provider value={actions}>
      <StateC.Provider value={state}>{props.children}</StateC.Provider>
    </ActionsC.Provider>
  );
}

export function useScreenHealthRecoilDraftState() {
  const ctx = useContext(StateC);
  if (!ctx) throw new Error("useScreenHealthRecoilDraftState must be used within ScreenHealthRecoilDraftProvider");
  return ctx;
}

export function useScreenHealthRecoilDraftControls() {
  const ctx = useContext(ActionsC);
  if (!ctx) throw new Error("useScreenHealthRecoilDraftControls must be used within ScreenHealthRecoilDraftProvider");
  return ctx;
}

export function useScreenHealthRecoilDraft() {
  return useScreenHealthRecoilDraftState();
}

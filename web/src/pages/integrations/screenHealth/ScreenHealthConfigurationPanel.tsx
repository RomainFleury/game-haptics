import { useCallback, useEffect, useRef, useState } from "react";
import { SCREEN_HEALTH_PRESETS } from "../../../data/screenHealthPresets";
import { ScreenHealthCalibrationProvider } from "./draft/CalibrationContext";
import {
  ScreenHealthHealthBarDraftProvider,
  useScreenHealthHealthBarDraft,
  useScreenHealthHealthBarDraftControls,
} from "./draft/HealthBarDraftContext";
import {
  ScreenHealthHealthNumberDraftProvider,
  useScreenHealthHealthNumberDraft,
  useScreenHealthHealthNumberDraftControls,
} from "./draft/HealthNumberDraftContext";
import {
  ScreenHealthProfileDraftProvider,
  useScreenHealthProfileDraftControls,
  useScreenHealthProfileDraft,
} from "./draft/ProfileDraftContext";
import {
  ScreenHealthRecoilDraftProvider,
  useScreenHealthRecoilDraft,
  useScreenHealthRecoilDraftControls,
} from "./draft/RecoilDraftContext";
import {
  ScreenHealthColorVignetteDraftProvider,
  useScreenHealthColorVignetteDraft,
  useScreenHealthColorVignetteDraftControls,
} from "./draft/ColorVignetteDraftContext";
import {
  ScreenHealthRednessDraftProvider,
  useScreenHealthRednessDraft,
  useScreenHealthRednessDraftControls,
} from "./draft/RednessDraftContext";
import { CalibrationCanvasSection } from "./sections/CalibrationCanvasSection";
import { CaptureSettingsSection } from "./sections/CaptureSettingsSection";
import { DrawingMaterialSection } from "./sections/DrawingMaterialSection";
import { AmmoNumberRecoilSettings } from "./sections/AmmoNumberRecoilSettings";
import { FillUpBarRecoilSettings } from "./sections/FillUpBarRecoilSettings";
import { ColorVignetteSettings } from "./sections/ColorVignetteSettings";
import { HealthBarSettings } from "./sections/HealthBarSettings";
import { HealthNumberSettings } from "./sections/HealthNumberSettings";
import { PresetProfilesSection } from "./sections/PresetProfilesSection";
import { ProfileControlsSection } from "./sections/ProfileControlsSection";
import { RednessSettings } from "./sections/RednessSettings";
import { RoiListSection } from "./sections/RoiListSection";
import { ScreenshotsSection } from "./sections/ScreenshotsSection";
import { applyDetectorsFromProfile } from "./applyProfileDraft";
import { buildScreenHealthDaemonProfile } from "./buildDaemonProfile";
import {
  getCalibrationScreenshot,
  restoreCalibrationScreenshot,
  type CalibrationScreenshot,
  type RestoreCalibrationScreenshotLoader,
} from "./calibrationScreenshot";
import { getDrawnSetup } from "./drawnSetup";
import {
  profileWithCalibrationScreenshot,
  resolveCalibrationScreenshotForPersist,
  type ScreenshotPersistDecision,
} from "./persistCalibrationScreenshot";
import { screenHealthExportProfile, screenHealthLoadProfile } from "../../../lib/bridgeApi";

type Props = {
  settings: any;
  updateSettings: (patch: any) => Promise<void>;
  chooseScreenshotsDir: () => Promise<void>;
  openScreenshotsDir?: () => Promise<void> | void;
  clearScreenshots: () => Promise<void>;

  lastCapturedImage: { dataUrl: string; width: number; height: number; filename: string; path: string } | null;
  captureCalibrationScreenshot: (monitorIndex: number) => Promise<any>;
  selectExistingScreenshot?: () => Promise<any>;
  loadCalibrationScreenshot?: RestoreCalibrationScreenshotLoader;
  evaluateProfileOnScreenshot: (
    profile: Record<string, any>,
    imagePath: string
  ) => Promise<{ success: boolean; test_result?: Record<string, any> | null; error?: string }>;
  loadFromProfileId?: string;
  profiles?: Array<{ type: "preset" | "local"; id: string; name: string; profile: Record<string, any> }>;
  onSaveProfile?: (
    name: string,
    profile: Record<string, any>,
    options?: { updateId?: string | null }
  ) => Promise<any>;
};

export function ScreenHealthConfigurationPanel(props: Props) {
  // Use minimal template as default, or load from profile if specified
  const defaultPresetId = props.loadFromProfileId || SCREEN_HEALTH_PRESETS[0]?.preset_id || "";
  const dataUrl = props.lastCapturedImage?.dataUrl ?? null;
  return (
    <ScreenHealthProfileDraftProvider defaultPresetId={defaultPresetId}>
      <ScreenHealthRednessDraftProvider>
        <ScreenHealthColorVignetteDraftProvider>
          <ScreenHealthHealthBarDraftProvider>
            <ScreenHealthHealthNumberDraftProvider>
              <ScreenHealthRecoilDraftProvider>
                <ScreenHealthCalibrationProvider dataUrl={dataUrl}>
                  <ScreenHealthConfigurationPanelInner {...props} />
                </ScreenHealthCalibrationProvider>
              </ScreenHealthRecoilDraftProvider>
            </ScreenHealthHealthNumberDraftProvider>
          </ScreenHealthHealthBarDraftProvider>
        </ScreenHealthColorVignetteDraftProvider>
      </ScreenHealthRednessDraftProvider>
    </ScreenHealthProfileDraftProvider>
  );
}

function ScreenHealthConfigurationPanelInner(props: Props) {
  const {
    settings,
    updateSettings,
    chooseScreenshotsDir,
    openScreenshotsDir,
    clearScreenshots,
    lastCapturedImage,
    captureCalibrationScreenshot,
    selectExistingScreenshot,
    loadCalibrationScreenshot,
    evaluateProfileOnScreenshot,
  } = props;

  const loadedShotRef = useRef<CalibrationScreenshot | null>(null);
  const boundPathRef = useRef<string | null>(null);
  const bindScreenshot = useCallback((shot: CalibrationScreenshot | null, path: string | null) => {
    loadedShotRef.current = shot;
    boundPathRef.current = path;
  }, []);
  const [screenshotRestoreError, setScreenshotRestoreError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <DraftFromSelectedPresetSync
        presets={SCREEN_HEALTH_PRESETS as any}
        loadFromProfileId={props.loadFromProfileId}
        profiles={props.profiles}
        loadCalibrationScreenshot={loadCalibrationScreenshot}
        onBoundScreenshot={bindScreenshot}
        onRestoreError={setScreenshotRestoreError}
      />

      <PresetProfilesSection 
        presets={SCREEN_HEALTH_PRESETS as any} 
        profiles={props.profiles}
      />

      <ProfileActionsController 
        presets={SCREEN_HEALTH_PRESETS as any} 
        onSaveProfile={props.onSaveProfile}
        lastCapturedImage={lastCapturedImage}
        loadedShotRef={loadedShotRef}
        boundPathRef={boundPathRef}
        loadCalibrationScreenshot={loadCalibrationScreenshot}
      />

      {screenshotRestoreError && <div className="text-xs text-rose-300">{screenshotRestoreError}</div>}

      <CaptureSettingsSection
        onCapture={captureCalibrationScreenshot}
        onSelectExisting={selectExistingScreenshot}
      />

      <DrawingMaterialSection />
      <CalibrationCanvasSection lastCapturedImage={lastCapturedImage} />

      <DrawnSettings
        lastCapturedImage={lastCapturedImage}
        evaluateProfileOnScreenshot={evaluateProfileOnScreenshot}
      />

      <RoiListSection
        lastCapturedImage={lastCapturedImage}
        evaluateProfileOnScreenshot={evaluateProfileOnScreenshot}
      />

      <ScreenshotsSection
        settings={settings}
        updateSettings={updateSettings}
        chooseScreenshotsDir={chooseScreenshotsDir}
        openScreenshotsDir={openScreenshotsDir as any}
        clearScreenshots={clearScreenshots}
      />
    </div>
  );
}

function DrawnSettings(props: {
  lastCapturedImage: { path: string } | null;
  evaluateProfileOnScreenshot: (
    profile: Record<string, any>,
    imagePath: string
  ) => Promise<{ success: boolean; test_result?: Record<string, any> | null; error?: string }>;
}) {
  const redness = useScreenHealthRednessDraft();
  const colorVignette = useScreenHealthColorVignetteDraft();
  const hb = useScreenHealthHealthBarDraft();
  const hn = useScreenHealthHealthNumberDraft();
  const recoil = useScreenHealthRecoilDraft();
  const drawn = getDrawnSetup({
    rednessRois: redness.rois,
    colorVignetteRois: colorVignette.rois,
    healthBarRoi: hb.roi,
    healthNumberRoi: hn.roi,
    ammoRoi: recoil.zones[0]?.rect ?? null,
    ammoZones: recoil.zones,
  });
  const hasAny =
    drawn.hasRedness || drawn.hasColorVignette || drawn.hasHealthBar || drawn.hasHealthNumber || drawn.hasAmmo;

  return (
    <div className="space-y-4 rounded-xl ring-1 ring-white/10 bg-slate-900/30 p-4">
      <h3 className="text-sm font-semibold text-white">Settings</h3>
      {!hasAny && (
        <p className="text-sm text-slate-500">
          Draw a box first. Hit detection is one type; recoil (ammo or fill-up bar) is optional and separate.
        </p>
      )}
      {drawn.hitCount > 1 && (
        <p className="text-xs text-amber-200/90">
          More than one hit type is drawn. Clear the extra boxes — only one hit type is used.
        </p>
      )}
      {drawn.hasRedness && (
        <div className="space-y-3">
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500">Red vignette</h4>
          <RednessSettings />
        </div>
      )}
      {drawn.hasColorVignette && (
        <div className="space-y-3">
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500">Color vignette</h4>
          <ColorVignetteSettings />
        </div>
      )}
      {drawn.hasHealthBar && (
        <div className="space-y-3">
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500">Health bar</h4>
          <HealthBarSettings />
        </div>
      )}
      {drawn.hasHealthNumber && (
        <div className="space-y-3">
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500">Health number</h4>
          <HealthNumberSettings
            lastCapturedImage={props.lastCapturedImage}
            evaluateProfileOnScreenshot={props.evaluateProfileOnScreenshot}
          />
        </div>
      )}
      {drawn.hasAmmo && recoil.recoilType === "fill_up_bar" && (
        <div className="space-y-3">
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500">Fill-up recoil</h4>
          <FillUpBarRecoilSettings
            lastCapturedImage={props.lastCapturedImage}
            evaluateProfileOnScreenshot={props.evaluateProfileOnScreenshot}
          />
        </div>
      )}
      {drawn.hasAmmo && recoil.recoilType !== "fill_up_bar" && (
        <div className="space-y-3">
          <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500">Ammo recoil</h4>
          <AmmoNumberRecoilSettings
            lastCapturedImage={props.lastCapturedImage}
            evaluateProfileOnScreenshot={props.evaluateProfileOnScreenshot}
          />
        </div>
      )}
    </div>
  );
}

function DraftFromSelectedPresetSync(props: {
  presets: Array<{ preset_id: string; display_name: string; profile: any; exampleScreenshotUrl?: string }>;
  loadFromProfileId?: string;
  profiles?: Array<{ type: "preset" | "local"; id: string; name: string; profile: Record<string, any> }>;
  loadCalibrationScreenshot?: RestoreCalibrationScreenshotLoader;
  onBoundScreenshot: (shot: CalibrationScreenshot | null, path: string | null) => void;
  onRestoreError: (message: string | null) => void;
}) {
  const { presets, loadFromProfileId, profiles, loadCalibrationScreenshot, onBoundScreenshot, onRestoreError } = props;
  const profileState = useScreenHealthProfileDraft();
  const {
    replaceAll: replaceProfileDraft,
    setDetectorType,
    setEditingLocalProfileId,
  } = useScreenHealthProfileDraftControls();
  const { replaceAll: replaceRednessDraft } = useScreenHealthRednessDraftControls();
  const { replaceAll: replaceColorVignetteDraft } = useScreenHealthColorVignetteDraftControls();
  const { replaceAll: replaceHealthBarDraft, setColorPickMode } = useScreenHealthHealthBarDraftControls();
  const { replaceAll: replaceHealthNumberDraft } = useScreenHealthHealthNumberDraftControls();
  const { replaceAll: replaceRecoilDraft } = useScreenHealthRecoilDraftControls();
  const lastAppliedPresetIdRef = useRef<string | null>(null);
  const hasLoadedFromIdRef = useRef(false);

  const applyDetectors = (p: any) =>
    applyDetectorsFromProfile(p, {
      setDetectorType,
      replaceRednessDraft,
      replaceColorVignetteDraft,
      replaceHealthBarDraft,
      replaceHealthNumberDraft,
      replaceRecoilDraft,
      setColorPickMode,
    });

  const restoreShot = async (
    profile: Record<string, any>,
    exampleScreenshotUrl: string | undefined,
    cancelled: () => boolean
  ) => {
    if (!loadCalibrationScreenshot) {
      onBoundScreenshot(null, null);
      return;
    }
    onRestoreError(null);
    try {
      const restored = await restoreCalibrationScreenshot({
        profile,
        exampleScreenshotUrl,
        load: loadCalibrationScreenshot,
      });
      if (cancelled()) return;
      onBoundScreenshot(restored.shot, restored.path);
    } catch (e) {
      if (cancelled()) return;
      onBoundScreenshot(getCalibrationScreenshot(profile), null);
      onRestoreError(e instanceof Error ? e.message : "Failed to load calibration screenshot");
    }
  };

  // Load from profile ID on mount if specified
  useEffect(() => {
    if (!loadFromProfileId || !profiles || hasLoadedFromIdRef.current) return;
    const profile = profiles.find((p) => p.id === loadFromProfileId);
    if (!profile) return;
    hasLoadedFromIdRef.current = true;
    lastAppliedPresetIdRef.current = loadFromProfileId;
    setEditingLocalProfileId(profile.type === "local" ? profile.id : null);
    const p: any = profile.profile;
    replaceProfileDraft({
      selectedPresetId: "__custom__",
      profileName: profile.name || "Loaded Profile",
      monitorIndex: Number(p.capture?.monitor_index || 1),
      tickMs: Number(p.capture?.tick_ms || 50),
    });
    applyDetectors(p);
    const exampleScreenshotUrl =
      profile.type === "preset" ? presets.find((item) => item.preset_id === profile.id)?.exampleScreenshotUrl : undefined;
    let cancelled = false;
    void restoreShot(p, exampleScreenshotUrl, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadFromProfileId, profiles, replaceProfileDraft, setEditingLocalProfileId]);

  useEffect(() => {
    const presetId = profileState.selectedPresetId;
    if (!presetId || presetId === "__custom__") return;
    if (lastAppliedPresetIdRef.current === presetId) return;

    let cancelled = false;
    if (profiles) {
      const localProfile = profiles.find((p) => p.id === presetId && p.type === "local");
      if (localProfile) {
        lastAppliedPresetIdRef.current = presetId;
        setEditingLocalProfileId(localProfile.id);
        const p: any = localProfile.profile;
        replaceProfileDraft({
          selectedPresetId: "__custom__",
          profileName: localProfile.name || "Loaded Profile",
          monitorIndex: Number(p.capture?.monitor_index || 1),
          tickMs: Number(p.capture?.tick_ms || 50),
        });
        applyDetectors(p);
        void restoreShot(p, undefined, () => cancelled);
        return () => {
          cancelled = true;
        };
      }
    }

    const preset = presets.find((p) => p.preset_id === presetId);
    if (!preset) return;

    const p: any = preset.profile;
    replaceProfileDraft({
      profileName: preset.display_name || p.name || "Unnamed Profile",
      monitorIndex: Number(p.capture?.monitor_index || 1),
      tickMs: Number(p.capture?.tick_ms || 50),
    });
    lastAppliedPresetIdRef.current = presetId;
    applyDetectors(p);
    void restoreShot(p, preset.exampleScreenshotUrl, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [presets, profileState.selectedPresetId, replaceProfileDraft, setEditingLocalProfileId, profiles]);

  return null;
}

function ProfileActionsController(props: {
  presets: Array<{ preset_id: string; profile: any }>;
  onSaveProfile?: (
    name: string,
    profile: Record<string, any>,
    options?: { updateId?: string | null }
  ) => Promise<any>;
  lastCapturedImage: { path: string; dataUrl?: string } | null;
  loadedShotRef: { current: CalibrationScreenshot | null };
  boundPathRef: { current: string | null };
  loadCalibrationScreenshot?: RestoreCalibrationScreenshotLoader;
}) {
  const { presets, onSaveProfile, lastCapturedImage, loadedShotRef, boundPathRef, loadCalibrationScreenshot } = props;
  const profileState = useScreenHealthProfileDraft();
  const {
    setProfileName,
    readDraft: readProfileDraft,
    replaceAll: replaceProfileDraft,
    setEditingLocalProfileId,
    setDetectorType,
  } = useScreenHealthProfileDraftControls();
  const { readDraft: readRednessDraft, replaceAll: replaceRednessDraft } = useScreenHealthRednessDraftControls();
  const { readDraft: readColorVignetteDraft, replaceAll: replaceColorVignetteDraft } =
    useScreenHealthColorVignetteDraftControls();
  const { readDraft: readHealthBarDraft, replaceAll: replaceHealthBarDraft, setColorPickMode } =
    useScreenHealthHealthBarDraftControls();
  const { readDraft: readHealthNumberDraft, replaceAll: replaceHealthNumberDraft } =
    useScreenHealthHealthNumberDraftControls();
  const { readDraft: readRecoilDraft, replaceAll: replaceRecoilDraft } = useScreenHealthRecoilDraftControls();

  const [exportError, setExportError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccessKind, setSaveSuccessKind] = useState<"none" | "update" | "new">("none");
  const [imagePrompt, setImagePrompt] = useState<"export" | "update" | "new" | null>(null);
  const [encodingImage, setEncodingImage] = useState(false);

  const buildDaemonProfile = () =>
    buildScreenHealthDaemonProfile({
      profileDraft: readProfileDraft(),
      redness: readRednessDraft(),
      colorVignette: readColorVignetteDraft(),
      hb: readHealthBarDraft(),
      hn: readHealthNumberDraft(),
      recoil: readRecoilDraft(),
      presets,
    });

  const persistWithScreenshot = async (kind: "export" | "update" | "new", decision?: ScreenshotPersistDecision) => {
    const resolved = await resolveCalibrationScreenshotForPersist({
      currentImage: lastCapturedImage,
      loadedShot: loadedShotRef.current,
      boundPath: boundPathRef.current,
      decision,
    });
    if (resolved.status === "needs-prompt") {
      setImagePrompt(kind);
      return;
    }
    setImagePrompt(null);
    loadedShotRef.current = resolved.shot;
    boundPathRef.current = resolved.boundPath;
    return profileWithCalibrationScreenshot(buildDaemonProfile(), resolved.shot);
  };

  const onExport = async (decision?: ScreenshotPersistDecision) => {
    setExportError(null);
    setEncodingImage(true);
    try {
      const profile = await persistWithScreenshot("export", decision);
      if (!profile) return;
      const result = await screenHealthExportProfile(profile);
      if (!result.success && !result.canceled) throw new Error(result.error || "Failed to export profile");
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Failed to export profile");
    } finally {
      setEncodingImage(false);
    }
  };

  const onLoad = async () => {
    setLoadError(null);
    try {
      const result = await screenHealthLoadProfile();
      if (!result.success) {
        if (result.canceled) return;
        throw new Error(result.error || "Failed to load profile");
      }
      const raw: any = result.profile;
      const p: any = raw?.profile && typeof raw.profile === "object" ? raw.profile : raw;
      if (!p || typeof p !== "object") throw new Error("Invalid profile JSON");

      setEditingLocalProfileId(null);
      // Mark as "custom" so preset auto-sync doesn't overwrite user edits.
      replaceProfileDraft({
        selectedPresetId: "__custom__",
        profileName: String(raw?.name || p.name || "Loaded Profile"),
        monitorIndex: Number(p.capture?.monitor_index || 1),
        tickMs: Number(p.capture?.tick_ms || 50),
      });
      applyDetectorsFromProfile(p, {
        setDetectorType,
        replaceRednessDraft,
        replaceColorVignetteDraft,
        replaceHealthBarDraft,
        replaceHealthNumberDraft,
        replaceRecoilDraft,
        setColorPickMode,
      });
      if (loadCalibrationScreenshot) {
        try {
          const restored = await restoreCalibrationScreenshot({
            profile: p,
            load: loadCalibrationScreenshot,
          });
          loadedShotRef.current = restored.shot;
          boundPathRef.current = restored.path;
        } catch (e) {
          loadedShotRef.current = getCalibrationScreenshot(p);
          boundPathRef.current = null;
          setLoadError(
            e instanceof Error
              ? `Profile loaded, but the calibration screenshot could not be shown: ${e.message}`
              : "Profile loaded, but the calibration screenshot could not be shown"
          );
        }
      } else {
        loadedShotRef.current = getCalibrationScreenshot(p);
        boundPathRef.current = null;
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load profile");
    }
  };

  const runSave = async (kind: "update" | "new", decision?: ScreenshotPersistDecision) => {
    if (!onSaveProfile) return;
    const name = profileState.profileName.trim();
    if (!name) {
      setSaveError("Profile name is required");
      return;
    }
    const updateId = kind === "update" ? profileState.editingLocalProfileId : null;
    if (kind === "update" && !updateId) {
      setSaveError("Nothing to update — open a local profile or pick one from Local Profiles.");
      return;
    }
    setSaveError(null);
    setSaveSuccessKind("none");
    setEncodingImage(true);
    try {
      const profile = await persistWithScreenshot(kind, decision);
      if (!profile) return;
      setSaving(true);
      const saved = await onSaveProfile(name, profile, updateId ? { updateId } : undefined);
      if (saved) {
        setSaveSuccessKind(kind);
        window.setTimeout(() => setSaveSuccessKind("none"), kind === "update" ? 8000 : 4000);
      } else {
        setSaveError("Failed to save profile");
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save profile");
    } finally {
      setSaving(false);
      setEncodingImage(false);
    }
  };

  const onImagePromptDecision = (decision: ScreenshotPersistDecision) => {
    if (!imagePrompt) return;
    if (imagePrompt === "export") void onExport(decision);
    else void runSave(imagePrompt, decision);
  };

  const isPresetSelected = presets.some((p) => p.preset_id === profileState.selectedPresetId);
  const canUpdateLocal = Boolean(profileState.editingLocalProfileId);
  const showUpdate = Boolean(onSaveProfile && canUpdateLocal && !isPresetSelected);
  const showSaveNewCopy = Boolean(onSaveProfile);

  return (
    <div className="space-y-3">
      <ProfileControlsSection
        onLoad={onLoad}
        onExport={() => onExport()}
        onUpdateProfile={showUpdate ? () => runSave("update") : undefined}
        onSaveNewCopy={showSaveNewCopy ? () => runSave("new") : undefined}
        saveNewCopyLabel="Save a new copy"
        saving={saving}
        profileName={profileState.profileName}
        setProfileName={setProfileName}
      />

      {exportError && <div className="text-xs text-rose-300">{exportError}</div>}
      {loadError && <div className="text-xs text-rose-300">{loadError}</div>}
      {saveError && <div className="text-xs text-rose-300">{saveError}</div>}
      {saveSuccessKind === "update" && (
        <div className="text-xs text-emerald-300 space-y-1">
          <div>Profile updated.</div>
          <div className="text-slate-400">
            If Screen Health is running with this profile, stop it on the integration page and start it again to load
            changes (no automatic restart).
          </div>
        </div>
      )}
      {saveSuccessKind === "new" && (
        <div className="text-xs text-emerald-300">New local profile saved (separate copy).</div>
      )}

      {imagePrompt && (
        <UpdateCalibrationImageModal
          busy={encodingImage}
          onKeep={() => onImagePromptDecision("keep")}
          onUpdate={() => onImagePromptDecision("update")}
          onCancel={() => setImagePrompt(null)}
        />
      )}
    </div>
  );
}

function UpdateCalibrationImageModal(props: {
  busy: boolean;
  onKeep: () => void;
  onUpdate: () => void;
  onCancel: () => void;
}) {
  const { busy, onKeep, onUpdate, onCancel } = props;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-calibration-image-title"
        className="w-full max-w-md rounded-xl bg-slate-900 p-5 ring-1 ring-white/10 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="update-calibration-image-title" className="text-base font-semibold text-white">
          Update calibration image?
        </h3>
        <p className="text-sm text-slate-300">
          The screenshot on the canvas is different from the one stored in this profile. Do you want to update the
          image?
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg bg-slate-700/80 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onKeep}
            className="rounded-lg bg-slate-600/80 px-3 py-2 text-sm font-medium text-white hover:bg-slate-600 disabled:opacity-50"
          >
            Keep previous
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onUpdate}
            className="rounded-lg bg-emerald-600/90 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {busy ? "Encoding…" : "Update image"}
          </button>
        </div>
      </div>
    </div>
  );
}


import { VestDevice, VestEffect, VestStatus } from "../types";

// Daemon event types
export type DaemonEvent = {
  event: string;
  ts: number;
  // Device events
  device?: {
    bus?: number;
    address?: number;
    serial_number?: string;
    vendor_id?: string;
    product_id?: string;
  };
  devices?: Array<{
    bus: number;
    address: number;
    serial_number?: string;
    vendor_id: string;
    product_id: string;
  }>;
  // Command events
  cell?: number;
  speed?: number;
  // Client events
  client_id?: string;
  client_name?: string;
  // Error events
  message?: string;
  // CS2 GSI events
  gsi_port?: number;
  event_type?: string; // For cs2_game_event: "damage", "death", "flash", etc.
  amount?: number; // For damage events
  intensity?: number; // For flash events
  // Half-Life: Alyx events
  log_path?: string;
  params?: Record<string, unknown>; // For alyx_game_event params
  // Generic Screen Health Watcher events
  direction?: string | null;
  score?: number;
  profile_name?: string | null;
  health_percent?: number;
  detector?: string | null;
  health_value?: number;
  duration_ms?: number;
  hand?: string;
  angle?: number;
  // Screen health debug events (extra payload is in params)
};

export type DaemonStatus = {
  connected: boolean;
};

// CS2 GSI types
export type CS2Status = {
  running: boolean;
  gsi_port?: number | null;
  events_received?: number;
  last_event_ts?: number | null;
  error?: string;
};

export type CS2StartResult = {
  success: boolean;
  gsi_port?: number;
  error?: string;
};

export type CS2StopResult = {
  success: boolean;
  error?: string;
};

export type CS2ConfigResult = {
  success: boolean;
  config_content?: string;
  filename?: string;
  error?: string;
};

// CS2 Config Path types
export type CS2ConfigPathResult = {
  path: string | null;
  configExists: boolean;
};

export type CS2AutoDetectResult = {
  success: boolean;
  path: string | null;
};

export type CS2BrowseResult = {
  success: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
};

export type CS2SaveToCS2Result = {
  success: boolean;
  path?: string;
  error?: string;
};

// Half-Life: Alyx types
export type AlyxStatus = {
  running: boolean;
  log_path?: string | null;
  events_received?: number;
  last_event_ts?: number | null;
  error?: string;
};

export type AlyxStartResult = {
  success: boolean;
  log_path?: string;
  error?: string;
};

export type AlyxStopResult = {
  success: boolean;
  error?: string;
};

export type AlyxModInfo = {
  name: string;
  description: string;
  download_url: string;
  github_url: string;
  install_instructions: string[];
  skill_manifest_addition: string;
};

export type AlyxModInfoResult = {
  success: boolean;
  mod_info?: AlyxModInfo;
  error?: string;
};

export type AlyxBrowseResult = {
  success: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
};

export type SolenoidRecoilSettings = {
  enabled: boolean;
  durationMs: number;
};

export type AlyxSettingsResult = {
  success: boolean;
  logPath?: string | null;
  enabledEvents?: Record<string, boolean>;
  solenoidRecoil?: SolenoidRecoilSettings;
  error?: string;
};

// Predefined Effects Library types
export type EffectStep = {
  cells: number[];
  speed: number;
  duration_ms: number;
  delay_ms: number;
};

export type PredefinedEffect = {
  name: string;
  display_name: string;
  category: string;
  description: string;
  duration_ms: number;
  steps: EffectStep[];
};

export type EffectsListResult = {
  success: boolean;
  effects: PredefinedEffect[];
  categories: string[];
  error?: string;
};

export type PlayEffectResult = {
  success: boolean;
  error?: string;
};

export type RelayPortInfo = {
  device: string;
  description: string;
  hwid: string;
  manufacturer?: string | null;
  product?: string | null;
  serial_number?: string | null;
  vid?: number | null;
  pid?: number | null;
  likely_relay?: boolean;
};

export type RelayStatusInfo = {
  connected: boolean;
  port?: string | null;
  baud?: number;
  address?: number;
  is_on?: boolean;
  last_error?: string | null;
};

export type RelayListPortsResult = {
  success: boolean;
  ports: RelayPortInfo[];
  error?: string;
};

export type RelayConnectResult = {
  success: boolean;
  relay?: RelayStatusInfo;
  error?: string;
};

export type RelayStatusResult = {
  success: boolean;
  connected: boolean;
  relay?: RelayStatusInfo | null;
  error?: string;
};

export type RelaySetResult = {
  success: boolean;
  on?: boolean;
  relay?: RelayStatusInfo;
  error?: string;
};

export type RelayPulseResult = {
  success: boolean;
  duration_ms?: number;
  relay?: RelayStatusInfo;
  error?: string;
};

export type RelayMouseFireMode = "single" | "burst" | "fullauto";

export type RelayMouseStartOptions = {
  durationMs?: number;
  fireMode?: RelayMouseFireMode;
  fireRateRpm?: number;
  burstCount?: number;
};

export type RelayMouseStatusResult = {
  success: boolean;
  running: boolean;
  duration_ms?: number | null;
  fire_mode?: RelayMouseFireMode | string;
  fire_rate_rpm?: number;
  burst_count?: number;
  interval_ms?: number | null;
  pulses?: number;
  error?: string;
};

// -------------------------------------------------------------------------
// Generic Screen Health Watcher types
// -------------------------------------------------------------------------

export type ScreenHealthStatus = {
  running: boolean;
  profile_name?: string | null;
  events_received?: number;
  last_event_ts?: number | null;
  last_hit_ts?: number | null;
  error?: string;
};

export type ScreenHealthStartResult = {
  success: boolean;
  profile_name?: string | null;
  error?: string;
};

export type ScreenHealthStopResult = {
  success: boolean;
  error?: string;
};

export type ScreenHealthTestResult = {
  success: boolean;
  test_result?: Record<string, any> | null;
  error?: string;
};

export type ScreenHealthSettings = {
  screenshotsDir: string | null;
  retentionMaxCount: number;
  retentionMaxAgeDays: number;
};

export type ScreenHealthScreenshotFile = {
  filename: string;
  path: string;
  size: number;
  mtimeMs: number;
};

export type ScreenHealthCalibrationScreenshot = {
  mime: string;
  data: string;
  width: number;
  height: number;
  sha256: string;
};

export type ScreenHealthMaterializeScreenshotResult = {
  success: boolean;
  screenshot?: ScreenHealthCalibrationScreenshot;
  filename?: string;
  path?: string;
  width?: number;
  height?: number;
  dataUrl?: string;
  error?: string;
};

export type ScreenHealthLocalProfile = {
  id: string;
  name: string;
  profile: Record<string, any>;
  createdAt: string;
  updatedAt: string;
};

export type ScreenHealthListProfilesResult = {
  success: boolean;
  profiles?: ScreenHealthLocalProfile[];
  error?: string;
};

export type ScreenHealthSaveProfileResult = {
  success: boolean;
  profile?: ScreenHealthLocalProfile;
  error?: string;
};

export type ScreenHealthDeleteProfileResult = {
  success: boolean;
  error?: string;
};

export type ScreenHealthGetProfileResult = {
  success: boolean;
  profile?: ScreenHealthLocalProfile;
  error?: string;
};

export type OcrEngineInfo = {
  id: string;
  label: string;
  beta?: boolean;
  group?: string;
  description?: string;
  install?: string;
  offered_in_ui?: boolean;
  ui_summary?: string;
  available?: boolean;
  unavailable_reason?: string | null;
  active?: boolean;
};

export type OcrSettingsResult = {
  success: boolean;
  ocr_engine?: string;
  ocr_engines?: OcrEngineInfo[];
  error?: string;
};

// Type definition for the Electron bridge API
declare global {
  interface Window {
    vestBridge?: {
      // Existing API
      ping: () => Promise<{
        success: boolean;
        message?: string;
        error?: string;
        alive?: boolean;
        connected?: boolean;
        has_device_selected?: boolean;
        client_count?: number;
      }>;
      getStatus: () => Promise<VestStatus>;
      getEffects: () => Promise<VestEffect[]>;
      triggerEffect: (
        effect: VestEffect
      ) => Promise<{ success: boolean; error?: string } | void>;
      stopAll: (deviceId?: string) => Promise<{ success: boolean; error?: string } | void>;
      listDevices: () => Promise<VestDevice[]>;
      connectToDevice: (deviceInfo: Partial<VestDevice>) => Promise<VestStatus>;
      getDevicePreference: () => Promise<Partial<VestDevice> | null>;
      saveDevicePreference: (
        deviceInfo: Partial<VestDevice>
      ) => Promise<{ success: boolean; error?: string }>;
      clearDevicePreference: () => Promise<{
        success: boolean;
        error?: string;
      }>;
      // New daemon API
      getDaemonStatus: () => Promise<DaemonStatus>;
      reconnectDaemon: () => Promise<{ success: boolean; error?: string }>;
      onDaemonEvent: (callback: (event: DaemonEvent) => void) => () => void;
      onDaemonStatus: (callback: (status: DaemonStatus) => void) => () => void;
      // CS2 GSI API
      cs2Start: (gsiPort?: number) => Promise<CS2StartResult>;
      cs2Stop: () => Promise<CS2StopResult>;
      cs2Status: () => Promise<CS2Status>;
      cs2GenerateConfig: (gsiPort?: number) => Promise<CS2ConfigResult>;
      // CS2 Config Path Management
      cs2GetConfigPath: () => Promise<CS2ConfigPathResult>;
      cs2SetConfigPath: (configPath: string) => Promise<{ success: boolean; error?: string }>;
      cs2AutoDetectPath: () => Promise<CS2AutoDetectResult>;
      cs2BrowseConfigPath: () => Promise<CS2BrowseResult>;
      cs2SaveConfigToCS2: (gsiPort?: number) => Promise<CS2SaveToCS2Result>;
      // Half-Life: Alyx API
      alyxStart: (logPath?: string) => Promise<AlyxStartResult>;
      alyxStop: () => Promise<AlyxStopResult>;
      alyxStatus: () => Promise<AlyxStatus>;
      alyxGetModInfo: () => Promise<AlyxModInfoResult>;
      alyxBrowseLogPath: () => Promise<AlyxBrowseResult>;
      alyxGetSettings: () => Promise<AlyxSettingsResult>;
      alyxSetSettings: (settings: {
        logPath?: string | null;
        enabledEvents?: Record<string, boolean>;
        solenoidRecoil?: Partial<SolenoidRecoilSettings>;
      }) => Promise<{ success: boolean; error?: string }>;
      alyxSetLogPath: (logPath: string | null) => Promise<{ success: boolean; error?: string }>;
      // Left 4 Dead 2 Integration API
      l4d2Start: (logPath?: string, playerName?: string) => Promise<{
        success: boolean;
        log_path?: string;
        error?: string;
      }>;
      l4d2Stop: () => Promise<{ success: boolean; error?: string }>;
      l4d2Status: () => Promise<{
        success: boolean;
        running: boolean;
        events_received?: number;
        last_event_ts?: number | null;
        last_event_type?: string | null;
        log_path?: string | null;
        error?: string;
      }>;
      l4d2BrowseLogPath: () => Promise<{
        success: boolean;
        logPath?: string;
        canceled?: boolean;
        error?: string;
      }>;
      l4d2GetSettings: () => Promise<{
        success: boolean;
        logPath?: string | null;
        playerName?: string | null;
        solenoidRecoil?: SolenoidRecoilSettings;
        error?: string;
      }>;
      l4d2SetLogPath: (logPath: string | null) => Promise<{ success: boolean; error?: string }>;
      l4d2SetPlayerName: (playerName: string | null) => Promise<{ success: boolean; error?: string }>;
      l4d2SetSolenoidRecoil: (
        solenoidRecoil: Partial<SolenoidRecoilSettings>
      ) => Promise<{ success: boolean; solenoidRecoil?: SolenoidRecoilSettings; error?: string }>;
      // Pistol Whip Integration API
      pistolwhipStart: () => Promise<{ success: boolean; error?: string }>;
      pistolwhipStop: () => Promise<{ success: boolean; error?: string }>;
      pistolwhipStatus: () => Promise<{
        success: boolean;
        running: boolean;
        events_received?: number;
        last_event_ts?: number | null;
        last_event_type?: string | null;
        error?: string;
      }>;
      pistolwhipGetSettings: () => Promise<{
        success: boolean;
        gameDir?: string | null;
        solenoidRecoil?: SolenoidRecoilSettings;
        error?: string;
      }>;
      pistolwhipSetSolenoidRecoil: (
        solenoidRecoil: Partial<SolenoidRecoilSettings>
      ) => Promise<{ success: boolean; solenoidRecoil?: SolenoidRecoilSettings; error?: string }>;
      pistolwhipBrowseGameDir: () => Promise<{
        success: boolean;
        gameDir?: string;
        canceled?: boolean;
        error?: string;
      }>;
      pistolwhipGetGameDir: () => Promise<{
        success: boolean;
        gameDir?: string | null;
        error?: string;
      }>;
      pistolwhipSetGameDir: (gameDir: string | null) => Promise<{ success: boolean; error?: string }>;
      pistolwhipCheckModInstalled: () => Promise<{
        success: boolean;
        installed?: boolean;
        sourceAvailable?: boolean;
        missingFiles?: string[];
        gameDir?: string;
        error?: string;
      }>;
      pistolwhipInstallMod: () => Promise<{
        success: boolean;
        copiedFiles?: string[];
        destination?: string;
        error?: string;
      }>;
      battlesisterStart: () => Promise<{ success: boolean; error?: string }>;
      battlesisterStop: () => Promise<{ success: boolean; error?: string }>;
      battlesisterStatus: () => Promise<{
        success: boolean;
        running: boolean;
        events_received?: number;
        last_event_ts?: number | null;
        last_event_type?: string | null;
        error?: string;
      }>;
      battlesisterGetSettings: () => Promise<{
        success: boolean;
        gameDir?: string | null;
        solenoidRecoil?: SolenoidRecoilSettings;
        error?: string;
      }>;
      battlesisterSetSolenoidRecoil: (
        solenoidRecoil: Partial<SolenoidRecoilSettings>
      ) => Promise<{ success: boolean; solenoidRecoil?: SolenoidRecoilSettings; error?: string }>;
      battlesisterBrowseGameDir: () => Promise<{
        success: boolean;
        gameDir?: string;
        canceled?: boolean;
        error?: string;
      }>;
      battlesisterGetGameDir: () => Promise<{
        success: boolean;
        gameDir?: string | null;
        error?: string;
      }>;
      battlesisterSetGameDir: (gameDir: string | null) => Promise<{ success: boolean; error?: string }>;
      battlesisterCheckModInstalled: () => Promise<{
        success: boolean;
        installed?: boolean;
        sourceAvailable?: boolean;
        missingFiles?: string[];
        gameDir?: string;
        error?: string;
      }>;
      battlesisterInstallMod: () => Promise<{
        success: boolean;
        copiedFiles?: string[];
        destination?: string;
        error?: string;
      }>;
      gunmancontractsStart: () => Promise<{ success: boolean; error?: string }>;
      gunmancontractsStop: () => Promise<{ success: boolean; error?: string }>;
      gunmancontractsStatus: () => Promise<{
        success: boolean;
        running: boolean;
        events_received?: number;
        last_event_ts?: number | null;
        last_event_type?: string | null;
        error?: string;
      }>;
      gunmancontractsGetSettings: () => Promise<{
        success: boolean;
        gameDir?: string | null;
        solenoidRecoil?: SolenoidRecoilSettings;
        error?: string;
      }>;
      gunmancontractsSetSolenoidRecoil: (
        solenoidRecoil: Partial<SolenoidRecoilSettings>
      ) => Promise<{ success: boolean; solenoidRecoil?: SolenoidRecoilSettings; error?: string }>;
      gunmancontractsBrowseGameDir: () => Promise<{
        success: boolean;
        gameDir?: string;
        canceled?: boolean;
        error?: string;
      }>;
      gunmancontractsGetGameDir: () => Promise<{
        success: boolean;
        gameDir?: string | null;
        error?: string;
      }>;
      gunmancontractsSetGameDir: (gameDir: string | null) => Promise<{ success: boolean; error?: string }>;
      gunmancontractsCheckModInstalled: () => Promise<{
        success: boolean;
        installed?: boolean;
        dllInstalled?: boolean;
        melonLoaderInstalled?: boolean;
        sourceAvailable?: boolean;
        missingFiles?: string[];
        gameDir?: string;
        error?: string;
      }>;
      gunmancontractsInstallMod: () => Promise<{
        success: boolean;
        copiedFiles?: string[];
        destination?: string;
        warning?: string;
        error?: string;
      }>;
      // Generic Screen Health Watcher API
      screenHealthExportProfile: (profile: Record<string, any>) => Promise<{
        success: boolean;
        path?: string;
        canceled?: boolean;
        error?: string;
      }>;
      screenHealthLoadProfile: () => Promise<{
        success: boolean;
        profile?: Record<string, any>;
        path?: string;
        canceled?: boolean;
        error?: string;
      }>;
      screenHealthGetSettings: () => Promise<{ success: boolean; settings?: ScreenHealthSettings; error?: string }>;
      screenHealthSetSettings: (settings: Partial<ScreenHealthSettings>) => Promise<{
        success: boolean;
        settings?: ScreenHealthSettings;
        error?: string;
      }>;
      screenHealthChooseScreenshotsDir: () => Promise<{
        success: boolean;
        settings?: ScreenHealthSettings;
        canceled?: boolean;
        error?: string;
      }>;
      screenHealthOpenScreenshotsDir: () => Promise<{ success: boolean; error?: string }>;
      screenHealthListScreenshots: () => Promise<{
        success: boolean;
        files?: ScreenHealthScreenshotFile[];
        error?: string;
      }>;
      screenHealthGetScreenshotDataUrl: (filename: string) => Promise<{
        success: boolean;
        dataUrl?: string;
        error?: string;
      }>;
      screenHealthDeleteScreenshot: (filename: string) => Promise<{ success: boolean; error?: string }>;
      screenHealthClearScreenshots: () => Promise<{ success: boolean; error?: string }>;
      screenHealthSelectExistingScreenshot: () => Promise<{
        success: boolean;
        canceled?: boolean;
        error?: string;
        filename?: string;
        path?: string;
        width?: number;
        height?: number;
        dataUrl?: string;
      }>;
      screenHealthEncodeCalibrationScreenshot: (payload: {
        path?: string;
        dataUrl?: string;
        url?: string;
        shot?: ScreenHealthCalibrationScreenshot;
      }) => Promise<{ success: boolean; screenshot?: ScreenHealthCalibrationScreenshot; error?: string }>;
      screenHealthMaterializeCalibrationScreenshot: (payload: {
        path?: string;
        dataUrl?: string;
        url?: string;
        shot?: ScreenHealthCalibrationScreenshot;
      }) => Promise<ScreenHealthMaterializeScreenshotResult>;
      screenHealthCaptureCalibrationScreenshot: (monitorIndex?: number) => Promise<{
        success: boolean;
        filename?: string;
        path?: string;
        width?: number;
        height?: number;
        dataUrl?: string;
        error?: string;
      }>;
      screenHealthCaptureRoiDebugImages: (
        monitorIndex: number,
        rois: Array<{ name: string; rect: { x: number; y: number; w: number; h: number } }>
      ) => Promise<{
        success: boolean;
        outputs?: ScreenHealthCapturedImage[];
        error?: string;
      }>;
      screenHealthStart: (profile: Record<string, any>) => Promise<ScreenHealthStartResult>;
      screenHealthStop: () => Promise<ScreenHealthStopResult>;
      screenHealthStatus: () => Promise<ScreenHealthStatus>;
      screenHealthTestProfileOnScreenshot: (
        profile: Record<string, any>,
        imagePath: string,
        outputDir?: string | null
      ) => Promise<ScreenHealthTestResult>;
      // Profile management
      screenHealthListProfiles: () => Promise<ScreenHealthListProfilesResult>;
      screenHealthSaveProfile: (profileData: {
        name: string;
        profile: Record<string, any>;
        id?: string;
      }) => Promise<ScreenHealthSaveProfileResult>;
      screenHealthDeleteProfile: (profileId: string) => Promise<ScreenHealthDeleteProfileResult>;
      screenHealthGetProfile: (profileId: string) => Promise<ScreenHealthGetProfileResult>;
      // Multi-Vest Management API
      listConnectedDevices: () => Promise<{
        success: boolean;
        devices?: Array<{
          device_id: string;
          is_main: boolean;
          bus?: number;
          address?: number;
          serial_number?: string;
          is_mock?: boolean;
        }>;
        error?: string;
      }>;
      setMainDevice: (deviceId: string) => Promise<{
        success: boolean;
        error?: string;
      }>;
      disconnectDevice: (deviceId: string) => Promise<{
        success: boolean;
        error?: string;
      }>;
      createMockDevice: () => Promise<{
        success: boolean;
        device_id?: string;
        device?: any;
        error?: string;
      }>;
      removeMockDevice: (deviceId: string) => Promise<{
        success: boolean;
        error?: string;
      }>;
      // Player Management API (backend still supports, but UI removed)
      createPlayer: (playerId: string, name?: string) => Promise<{
        success: boolean;
        error?: string;
      }>;
      assignPlayer: (playerId: string, deviceId: string) => Promise<{
        success: boolean;
        error?: string;
      }>;
      unassignPlayer: (playerId: string) => Promise<{
        success: boolean;
        error?: string;
      }>;
      listPlayers: () => Promise<{
        success: boolean;
        devices?: Array<{
          player_id: string;
          device_id: string | null;
          name: string | null;
        }>;
        error?: string;
      }>;
      getPlayerDevice: (playerId: string) => Promise<{
        success: boolean;
        device_id?: string;
        error?: string;
      }>;
      // Game-Specific Player Mapping API
      setGamePlayerMapping: (
        gameId: string,
        playerNum: number,
        deviceId: string
      ) => Promise<{ success: boolean; error?: string }>;
      clearGamePlayerMapping: (
        gameId: string,
        playerNum?: number
      ) => Promise<{ success: boolean; error?: string }>;
      listGamePlayerMappings: (gameId?: string) => Promise<{
        success: boolean;
        player_mappings?: Array<{
          game_id: string;
          player_num: number;
          device_id: string;
        }>;
        error?: string;
      }>;
      // Predefined Effects Library API
      playEffect: (effectName: string) => Promise<PlayEffectResult>;
      listEffectsLibrary: () => Promise<EffectsListResult>;
      stopEffect: () => Promise<{ success: boolean; error?: string }>;
      ocrListEngines: () => Promise<OcrSettingsResult>;
      ocrGetSettings: () => Promise<OcrSettingsResult>;
      ocrSetEngine: (ocrEngine: string) => Promise<OcrSettingsResult>;
      ocrOpenWindowsLanguageSettings: () => Promise<{ success: boolean; error?: string }>;
      // USB LC relay / solenoid recoil
      relayListPorts: () => Promise<RelayListPortsResult>;
      relayConnect: (
        port: string,
        baud?: number,
        switchAddress?: number
      ) => Promise<RelayConnectResult>;
      relayDisconnect: () => Promise<{ success: boolean; error?: string }>;
      relayStatus: () => Promise<RelayStatusResult>;
      relaySet: (on: boolean) => Promise<RelaySetResult>;
      relayPulse: (durationMs?: number) => Promise<RelayPulseResult>;
      relayMouseStart: (options?: RelayMouseStartOptions) => Promise<RelayMouseStatusResult>;
      relayMouseStop: () => Promise<RelayMouseStatusResult>;
      relayMouseStatus: () => Promise<RelayMouseStatusResult>;
    };
  }
}

function ensureBridge(): NonNullable<Window["vestBridge"]> {
  if (typeof window === "undefined" || !window.vestBridge) {
    throw new Error(
      "Vest bridge is not available. This app must run in Electron."
    );
  }
  return window.vestBridge;
}

export async function fetchStatus(): Promise<VestStatus> {
  return await ensureBridge().getStatus();
}

export async function fetchEffects(): Promise<VestEffect[]> {
  return await ensureBridge().getEffects();
}

export async function triggerEffect(effect: VestEffect): Promise<void> {
  const result = await ensureBridge().triggerEffect(effect);
  // Check if the result indicates an error
  if (
    result &&
    typeof result === "object" &&
    "success" in result &&
    !result.success
  ) {
    throw new Error(result.error || "Failed to trigger effect");
  }
}

export async function stopAll(deviceId?: string): Promise<void> {
  const result = await ensureBridge().stopAll(deviceId);
  // Check if the result indicates an error
  if (
    result &&
    typeof result === "object" &&
    "success" in result &&
    !result.success
  ) {
    throw new Error(result.error || "Failed to stop all");
  }
}

export async function ping(): Promise<{ success: boolean; message?: string }> {
  return await ensureBridge().ping();
}

export async function listDevices(): Promise<VestDevice[]> {
  return await ensureBridge().listDevices();
}

export async function connectToDevice(
  deviceInfo: Partial<VestDevice>
): Promise<VestStatus> {
  return await ensureBridge().connectToDevice(deviceInfo);
}

export async function getDevicePreference(): Promise<Partial<VestDevice> | null> {
  return await ensureBridge().getDevicePreference();
}

export async function saveDevicePreference(
  deviceInfo: Partial<VestDevice>
): Promise<void> {
  const result = await ensureBridge().saveDevicePreference(deviceInfo);
  if (!result.success) {
    throw new Error(result.error || "Failed to save device preference");
  }
}

export async function clearDevicePreference(): Promise<void> {
  const result = await ensureBridge().clearDevicePreference();
  if (!result.success) {
    throw new Error(result.error || "Failed to clear device preference");
  }
}

// New daemon-related functions
export async function getDaemonStatus(): Promise<DaemonStatus> {
  return await ensureBridge().getDaemonStatus();
}

export async function reconnectDaemon(): Promise<void> {
  const result = await ensureBridge().reconnectDaemon();
  if (!result.success) {
    throw new Error(result.error || "Failed to reconnect to daemon");
  }
}

export function subscribeToDaemonEvents(
  callback: (event: DaemonEvent) => void
): () => void {
  return ensureBridge().onDaemonEvent(callback);
}

export function subscribeToDaemonStatus(
  callback: (status: DaemonStatus) => void
): () => void {
  return ensureBridge().onDaemonStatus(callback);
}

// -------------------------------------------------------------------------
// CS2 GSI Integration
// -------------------------------------------------------------------------

/**
 * Start the CS2 GSI server.
 * @param gsiPort Port for the GSI HTTP server (default 3000)
 */
export async function cs2Start(gsiPort = 3000): Promise<CS2StartResult> {
  return await ensureBridge().cs2Start(gsiPort);
}

/**
 * Stop the CS2 GSI server.
 */
export async function cs2Stop(): Promise<CS2StopResult> {
  return await ensureBridge().cs2Stop();
}

/**
 * Get CS2 GSI server status.
 */
export async function cs2Status(): Promise<CS2Status> {
  return await ensureBridge().cs2Status();
}

/**
 * Generate CS2 GSI config file content.
 * @param gsiPort Port for the GSI HTTP server
 */
export async function cs2GenerateConfig(
  gsiPort = 3000
): Promise<CS2ConfigResult> {
  return await ensureBridge().cs2GenerateConfig(gsiPort);
}

// -------------------------------------------------------------------------
// CS2 Config Path Management
// -------------------------------------------------------------------------

/**
 * Get the saved CS2 config path.
 */
export async function cs2GetConfigPath(): Promise<CS2ConfigPathResult> {
  return await ensureBridge().cs2GetConfigPath();
}

/**
 * Set the CS2 config path.
 */
export async function cs2SetConfigPath(configPath: string): Promise<void> {
  const result = await ensureBridge().cs2SetConfigPath(configPath);
  if (!result.success) {
    throw new Error(result.error || "Failed to save config path");
  }
}

/**
 * Auto-detect the CS2 config folder path.
 */
export async function cs2AutoDetectPath(): Promise<CS2AutoDetectResult> {
  return await ensureBridge().cs2AutoDetectPath();
}

/**
 * Open folder browser to select CS2 config path.
 */
export async function cs2BrowseConfigPath(): Promise<CS2BrowseResult> {
  return await ensureBridge().cs2BrowseConfigPath();
}

/**
 * Save the GSI config file directly to the CS2 folder.
 * @param gsiPort Port for the GSI HTTP server
 */
export async function cs2SaveConfigToCS2(
  gsiPort = 3000
): Promise<CS2SaveToCS2Result> {
  return await ensureBridge().cs2SaveConfigToCS2(gsiPort);
}

// -------------------------------------------------------------------------
// Half-Life: Alyx Integration
// -------------------------------------------------------------------------

/**
 * Start the Alyx console log watcher.
 * @param logPath Optional path to console.log (auto-detect if not provided)
 */
export async function alyxStart(logPath?: string): Promise<AlyxStartResult> {
  return await ensureBridge().alyxStart(logPath);
}

/**
 * Stop the Alyx console log watcher.
 */
export async function alyxStop(): Promise<AlyxStopResult> {
  return await ensureBridge().alyxStop();
}

/**
 * Get Alyx integration status.
 */
export async function alyxStatus(): Promise<AlyxStatus> {
  return await ensureBridge().alyxStatus();
}

/**
 * Get Alyx mod info (download URLs, install instructions).
 */
export async function alyxGetModInfo(): Promise<AlyxModInfoResult> {
  return await ensureBridge().alyxGetModInfo();
}

/**
 * Browse for Alyx console.log file.
 */
export async function alyxBrowseLogPath(): Promise<AlyxBrowseResult> {
  return await ensureBridge().alyxBrowseLogPath();
}

/**
 * Get saved Alyx settings.
 */
export async function alyxGetSettings(): Promise<AlyxSettingsResult> {
  return await ensureBridge().alyxGetSettings();
}

/**
 * Set Alyx settings (partial update).
 */
export async function alyxSetSettings(settings: {
  logPath?: string | null;
  enabledEvents?: Record<string, boolean>;
  solenoidRecoil?: Partial<SolenoidRecoilSettings>;
}): Promise<{ success: boolean; error?: string }> {
  return await ensureBridge().alyxSetSettings(settings);
}

/**
 * Set Alyx log path.
 */
export async function alyxSetLogPath(logPath: string | null): Promise<{ success: boolean; error?: string }> {
  return await ensureBridge().alyxSetLogPath(logPath);
}

export type PistolWhipStatus = {
  running: boolean;
  events_received?: number;
  last_event_ts?: number | null;
  last_event_type?: string | null;
  error?: string;
};

export async function pistolwhipStart(): Promise<{ success: boolean; error?: string }> {
  return await ensureBridge().pistolwhipStart();
}

export async function pistolwhipStop(): Promise<{ success: boolean; error?: string }> {
  return await ensureBridge().pistolwhipStop();
}

export async function pistolwhipStatus(): Promise<PistolWhipStatus> {
  return await ensureBridge().pistolwhipStatus();
}

export async function pistolwhipGetSettings(): Promise<{
  success: boolean;
  gameDir?: string | null;
  solenoidRecoil?: SolenoidRecoilSettings;
  error?: string;
}> {
  return await ensureBridge().pistolwhipGetSettings();
}

export async function pistolwhipBrowseGameDir(): Promise<{
  success: boolean;
  gameDir?: string;
  canceled?: boolean;
  error?: string;
}> {
  return await ensureBridge().pistolwhipBrowseGameDir();
}

export async function pistolwhipGetGameDir(): Promise<{
  success: boolean;
  gameDir?: string | null;
  error?: string;
}> {
  return await ensureBridge().pistolwhipGetGameDir();
}

export async function pistolwhipCheckModInstalled(): Promise<{
  success: boolean;
  installed?: boolean;
  sourceAvailable?: boolean;
  missingFiles?: string[];
  gameDir?: string;
  error?: string;
}> {
  return await ensureBridge().pistolwhipCheckModInstalled();
}

export async function pistolwhipInstallMod(): Promise<{
  success: boolean;
  copiedFiles?: string[];
  destination?: string;
  error?: string;
}> {
  return await ensureBridge().pistolwhipInstallMod();
}

export async function pistolwhipSetSolenoidRecoil(
  solenoidRecoil: Partial<SolenoidRecoilSettings>
): Promise<{ success: boolean; solenoidRecoil?: SolenoidRecoilSettings; error?: string }> {
  return await ensureBridge().pistolwhipSetSolenoidRecoil(solenoidRecoil);
}

export type BattleSisterStatus = {
  running: boolean;
  events_received?: number;
  last_event_ts?: number | null;
  last_event_type?: string | null;
  error?: string;
};

export async function battlesisterStart(): Promise<{ success: boolean; error?: string }> {
  return await ensureBridge().battlesisterStart();
}

export async function battlesisterStop(): Promise<{ success: boolean; error?: string }> {
  return await ensureBridge().battlesisterStop();
}

export async function battlesisterStatus(): Promise<BattleSisterStatus> {
  return await ensureBridge().battlesisterStatus();
}

export async function battlesisterGetSettings(): Promise<{
  success: boolean;
  gameDir?: string | null;
  solenoidRecoil?: SolenoidRecoilSettings;
  error?: string;
}> {
  return await ensureBridge().battlesisterGetSettings();
}

export async function battlesisterSetSolenoidRecoil(
  solenoidRecoil: Partial<SolenoidRecoilSettings>
): Promise<{ success: boolean; solenoidRecoil?: SolenoidRecoilSettings; error?: string }> {
  return await ensureBridge().battlesisterSetSolenoidRecoil(solenoidRecoil);
}

export async function battlesisterBrowseGameDir(): Promise<{
  success: boolean;
  gameDir?: string;
  canceled?: boolean;
  error?: string;
}> {
  return await ensureBridge().battlesisterBrowseGameDir();
}

export async function battlesisterCheckModInstalled(): Promise<{
  success: boolean;
  installed?: boolean;
  sourceAvailable?: boolean;
  missingFiles?: string[];
  gameDir?: string;
  error?: string;
}> {
  return await ensureBridge().battlesisterCheckModInstalled();
}

export async function battlesisterInstallMod(): Promise<{
  success: boolean;
  copiedFiles?: string[];
  destination?: string;
  error?: string;
}> {
  return await ensureBridge().battlesisterInstallMod();
}

export type GunmanContractsStatus = {
  success?: boolean;
  running: boolean;
  events_received?: number;
  last_event_ts?: number | null;
  last_event_type?: string | null;
  error?: string;
};

export async function gunmancontractsStart(): Promise<{ success: boolean; error?: string }> {
  return await ensureBridge().gunmancontractsStart();
}

export async function gunmancontractsStop(): Promise<{ success: boolean; error?: string }> {
  return await ensureBridge().gunmancontractsStop();
}

export async function gunmancontractsStatus(): Promise<GunmanContractsStatus> {
  return await ensureBridge().gunmancontractsStatus();
}

export async function gunmancontractsGetSettings(): Promise<{
  success: boolean;
  gameDir?: string | null;
  solenoidRecoil?: SolenoidRecoilSettings;
  error?: string;
}> {
  return await ensureBridge().gunmancontractsGetSettings();
}

export async function gunmancontractsSetSolenoidRecoil(
  solenoidRecoil: Partial<SolenoidRecoilSettings>
): Promise<{ success: boolean; solenoidRecoil?: SolenoidRecoilSettings; error?: string }> {
  return await ensureBridge().gunmancontractsSetSolenoidRecoil(solenoidRecoil);
}

export async function gunmancontractsBrowseGameDir(): Promise<{
  success: boolean;
  gameDir?: string;
  canceled?: boolean;
  error?: string;
}> {
  return await ensureBridge().gunmancontractsBrowseGameDir();
}

export async function gunmancontractsCheckModInstalled(): Promise<{
  success: boolean;
  installed?: boolean;
  dllInstalled?: boolean;
  melonLoaderInstalled?: boolean;
  sourceAvailable?: boolean;
  missingFiles?: string[];
  gameDir?: string;
  error?: string;
}> {
  return await ensureBridge().gunmancontractsCheckModInstalled();
}

export async function gunmancontractsInstallMod(): Promise<{
  success: boolean;
  copiedFiles?: string[];
  destination?: string;
  warning?: string;
  error?: string;
}> {
  return await ensureBridge().gunmancontractsInstallMod();
}

// -------------------------------------------------------------------------
// Predefined Effects Library
// -------------------------------------------------------------------------

/**
 * Play a predefined effect by name.
 * @param effectName Name of the effect to play (e.g., "machinegun_front")
 */
export async function playEffect(effectName: string): Promise<PlayEffectResult> {
  return await ensureBridge().playEffect(effectName);
}

/**
 * List all available predefined effects.
 * Returns effects organized by category.
 */
export async function listEffectsLibrary(): Promise<EffectsListResult> {
  return await ensureBridge().listEffectsLibrary();
}

/**
 * Stop any currently playing effect (emergency stop).
 */
export async function stopEffect(): Promise<{ success: boolean; error?: string }> {
  return await ensureBridge().stopEffect();
}

// -------------------------------------------------------------------------
// Generic Screen Health Watcher
// -------------------------------------------------------------------------

export async function screenHealthExportProfile(profile: Record<string, any>) {
  return await ensureBridge().screenHealthExportProfile(profile);
}

export async function screenHealthLoadProfile() {
  return await ensureBridge().screenHealthLoadProfile();
}

export async function screenHealthGetSettings() {
  return await ensureBridge().screenHealthGetSettings();
}

export async function screenHealthSetSettings(settings: Partial<ScreenHealthSettings>) {
  return await ensureBridge().screenHealthSetSettings(settings);
}

export async function screenHealthChooseScreenshotsDir() {
  return await ensureBridge().screenHealthChooseScreenshotsDir();
}

export async function screenHealthOpenScreenshotsDir() {
  return await ensureBridge().screenHealthOpenScreenshotsDir();
}

export async function screenHealthListScreenshots() {
  return await ensureBridge().screenHealthListScreenshots();
}

export async function screenHealthGetScreenshotDataUrl(filename: string) {
  return await ensureBridge().screenHealthGetScreenshotDataUrl(filename);
}

export async function screenHealthDeleteScreenshot(filename: string) {
  return await ensureBridge().screenHealthDeleteScreenshot(filename);
}

export async function screenHealthClearScreenshots() {
  return await ensureBridge().screenHealthClearScreenshots();
}

export async function screenHealthSelectExistingScreenshot() {
  return await ensureBridge().screenHealthSelectExistingScreenshot();
}

export async function screenHealthEncodeCalibrationScreenshot(payload: {
  path?: string;
  dataUrl?: string;
  url?: string;
  shot?: ScreenHealthCalibrationScreenshot;
}) {
  return await ensureBridge().screenHealthEncodeCalibrationScreenshot(payload);
}

export async function screenHealthMaterializeCalibrationScreenshot(payload: {
  path?: string;
  dataUrl?: string;
  url?: string;
  shot?: ScreenHealthCalibrationScreenshot;
}) {
  return await ensureBridge().screenHealthMaterializeCalibrationScreenshot(payload);
}

export async function screenHealthCaptureCalibrationScreenshot(monitorIndex = 1) {
  return await ensureBridge().screenHealthCaptureCalibrationScreenshot(monitorIndex);
}

export async function screenHealthCaptureRoiDebugImages(
  monitorIndex: number,
  rois: Array<{ name: string; rect: { x: number; y: number; w: number; h: number } }>
) {
  return await ensureBridge().screenHealthCaptureRoiDebugImages(monitorIndex, rois);
}

export async function screenHealthStart(profile: Record<string, any>): Promise<ScreenHealthStartResult> {
  return await ensureBridge().screenHealthStart(profile);
}

export async function screenHealthStop(): Promise<ScreenHealthStopResult> {
  return await ensureBridge().screenHealthStop();
}

export async function screenHealthStatus(): Promise<ScreenHealthStatus> {
  return await ensureBridge().screenHealthStatus();
}

export async function screenHealthTestProfileOnScreenshot(
  profile: Record<string, any>,
  imagePath: string,
  outputDir?: string | null
): Promise<ScreenHealthTestResult> {
  return await ensureBridge().screenHealthTestProfileOnScreenshot(profile, imagePath, outputDir ?? null);
}

/**
 * List all local profiles stored in storage.
 */
export async function screenHealthListProfiles(): Promise<ScreenHealthListProfilesResult> {
  return await ensureBridge().screenHealthListProfiles();
}

/**
 * Save a profile to local storage. Pass `id` to update an existing profile; omit `id` to create a new one.
 */
export async function screenHealthSaveProfile(profileData: {
  name: string;
  profile: Record<string, any>;
  id?: string;
}): Promise<ScreenHealthSaveProfileResult> {
  return await ensureBridge().screenHealthSaveProfile(profileData);
}

/**
 * Delete a profile from local storage.
 * @param profileId Profile ID to delete
 */
export async function screenHealthDeleteProfile(profileId: string): Promise<ScreenHealthDeleteProfileResult> {
  return await ensureBridge().screenHealthDeleteProfile(profileId);
}

/**
 * Get a specific profile by ID from local storage.
 * @param profileId Profile ID to retrieve
 */
export async function screenHealthGetProfile(profileId: string): Promise<ScreenHealthGetProfileResult> {
  return await ensureBridge().screenHealthGetProfile(profileId);
}

export async function ocrListEngines(): Promise<OcrSettingsResult> {
  return await ensureBridge().ocrListEngines();
}

export async function ocrGetSettings(): Promise<OcrSettingsResult> {
  return await ensureBridge().ocrGetSettings();
}

export async function ocrSetEngine(ocrEngine: string): Promise<OcrSettingsResult> {
  return await ensureBridge().ocrSetEngine(ocrEngine);
}

export async function ocrOpenWindowsLanguageSettings(): Promise<{ success: boolean; error?: string }> {
  return await ensureBridge().ocrOpenWindowsLanguageSettings();
}

// -------------------------------------------------------------------------
// USB LC relay / solenoid recoil
// -------------------------------------------------------------------------

export async function relayListPorts(): Promise<RelayListPortsResult> {
  return await ensureBridge().relayListPorts();
}

export async function relayConnect(
  port: string,
  baud = 9600,
  switchAddress = 1
): Promise<RelayConnectResult> {
  return await ensureBridge().relayConnect(port, baud, switchAddress);
}

export async function relayDisconnect(): Promise<{ success: boolean; error?: string }> {
  return await ensureBridge().relayDisconnect();
}

export async function relayStatus(): Promise<RelayStatusResult> {
  return await ensureBridge().relayStatus();
}

export async function relaySet(on: boolean): Promise<RelaySetResult> {
  return await ensureBridge().relaySet(on);
}

export async function relayPulse(durationMs = 40): Promise<RelayPulseResult> {
  return await ensureBridge().relayPulse(durationMs);
}

export async function relayMouseStart(
  options: RelayMouseStartOptions = {}
): Promise<RelayMouseStatusResult> {
  return await ensureBridge().relayMouseStart(options);
}

export async function relayMouseStop(): Promise<RelayMouseStatusResult> {
  return await ensureBridge().relayMouseStop();
}

export async function relayMouseStatus(): Promise<RelayMouseStatusResult> {
  return await ensureBridge().relayMouseStatus();
}

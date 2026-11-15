import { useState, useEffect, useCallback, useRef } from "react";
import {
  cyberpunkStart,
  cyberpunkStop,
  cyberpunkStatus,
  cyberpunkGetSettings,
  cyberpunkSetSolenoidRecoil,
  cyberpunkSetEnabledEvents,
  cyberpunkBrowseGameDir,
  cyberpunkCheckModInstalled,
  cyberpunkInstallMod,
  subscribeToDaemonEvents,
  CyberpunkStatus,
  DaemonEvent,
  SolenoidRecoilSettings,
} from "../lib/bridgeApi";

export type CyberpunkGameEvent = {
  id: string;
  type: string;
  ts: number;
  params?: Record<string, unknown>;
};

export type CyberpunkEnabledEvents = Record<string, boolean>;

const MAX_EVENTS = 50;
const DEFAULT_SOLENOID: SolenoidRecoilSettings = {
  enabled: true,
  durationMs: 40,
};

export function useCyberpunkIntegration() {
  const [status, setStatus] = useState<CyberpunkStatus>({
    running: false,
    events_received: 0,
    last_event_ts: null,
    last_event_type: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gameEvents, setGameEvents] = useState<CyberpunkGameEvent[]>([]);
  const [solenoidRecoil, setSolenoidRecoil] = useState<SolenoidRecoilSettings>(DEFAULT_SOLENOID);
  const [enabledEvents, setEnabledEvents] = useState<CyberpunkEnabledEvents | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const [gameDir, setGameDir] = useState("");
  const [modStatus, setModStatus] = useState<{
    installed: boolean;
    dllInstalled?: boolean;
    scriptsInstalled?: boolean;
    red4extInstalled?: boolean;
    redscriptInstalled?: boolean;
    sourceAvailable?: boolean;
    missingFiles?: string[];
    gameDir?: string;
  }>({ installed: false });
  const eventIdCounter = useRef(0);

  const fetchStatus = useCallback(async (preserveError = false) => {
    try {
      const result = await cyberpunkStatus();
      setStatus(result);
      if (!preserveError) {
        setError(result.error || null);
      }
    } catch (err) {
      if (!preserveError) {
        setError(err instanceof Error ? err.message : "Failed to get status");
      }
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const result = await cyberpunkGetSettings();
      if (result.success) {
        if (result.solenoidRecoil) {
          setSolenoidRecoil(result.solenoidRecoil);
        }
        if (result.enabledEvents) {
          setEnabledEvents(result.enabledEvents);
        }
        if (result.gameDir) {
          setGameDir(result.gameDir);
        }
      }
    } catch (err) {
      console.error("Failed to load Cyberpunk settings:", err);
    }
  }, []);

  const checkModInstalled = useCallback(async () => {
    try {
      const result = await cyberpunkCheckModInstalled();
      if (result.success) {
        setModStatus({
          installed: Boolean(result.installed),
          dllInstalled: Boolean(result.dllInstalled ?? result.installed),
          scriptsInstalled: Boolean(result.scriptsInstalled),
          red4extInstalled: Boolean(result.red4extInstalled),
          redscriptInstalled: Boolean(result.redscriptInstalled),
          sourceAvailable: result.sourceAvailable,
          missingFiles: result.missingFiles,
          gameDir: result.gameDir,
        });
      }
    } catch (err) {
      console.error("Failed to check Cyberpunk mod status:", err);
    }
  }, []);

  const browseGameDir = useCallback(async () => {
    try {
      const result = await cyberpunkBrowseGameDir();
      if (result.success && result.gameDir) {
        setGameDir(result.gameDir);
        await checkModInstalled();
      }
    } catch (err) {
      console.error("Failed to browse Cyberpunk game dir:", err);
    }
  }, [checkModInstalled]);

  const installMod = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await cyberpunkInstallMod();
      if (result.success) {
        await checkModInstalled();
        return {
          success: true,
          copiedFiles: result.copiedFiles,
          warning: result.warning,
        };
      }
      setError(result.error || "Failed to install Cyberpunk mod");
      return { success: false, error: result.error };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to install Cyberpunk mod";
      setError(message);
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  }, [checkModInstalled]);

  const start = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await cyberpunkStart();
      if (result.success) {
        setRestartRequired(false);
        await fetchStatus(true);
      } else {
        setError(result.error || "Failed to start Cyberpunk integration");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Cyberpunk integration");
    } finally {
      setLoading(false);
    }
  }, [fetchStatus]);

  const stop = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await cyberpunkStop();
      if (result.success) {
        await fetchStatus(true);
      } else {
        setError(result.error || "Failed to stop Cyberpunk integration");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop Cyberpunk integration");
    } finally {
      setLoading(false);
    }
  }, [fetchStatus]);

  const clearEvents = useCallback(() => {
    setGameEvents([]);
  }, []);

  const setSolenoidRecoilSettings = useCallback(
    async (partial: Partial<SolenoidRecoilSettings>) => {
      const next = { ...solenoidRecoil, ...partial };
      setSolenoidRecoil(next);
      try {
        await cyberpunkSetSolenoidRecoil(next);
        if (status.running) setRestartRequired(true);
      } catch (err) {
        console.error("Failed to save Cyberpunk solenoid settings:", err);
      }
    },
    [solenoidRecoil, status.running]
  );

  const setEventEnabled = useCallback(
    async (eventType: string, enabled: boolean) => {
      const prev = enabledEvents || {};
      const next: CyberpunkEnabledEvents = { ...prev, [eventType]: enabled };
      setEnabledEvents(next);
      try {
        const result = await cyberpunkSetEnabledEvents(next);
        if (!result.success) {
          setError(result.error || "Failed to save feedback settings");
        } else {
          setError(null);
          if (status.running) setRestartRequired(true);
        }
      } catch (err) {
        console.error("Failed to save Cyberpunk enabled events:", err);
        setError(err instanceof Error ? err.message : "Failed to save feedback settings");
      }
    },
    [enabledEvents, status.running]
  );

  useEffect(() => {
    fetchSettings();
    fetchStatus();
    checkModInstalled();
  }, [fetchSettings, fetchStatus, checkModInstalled]);

  useEffect(() => {
    const unsubscribe = subscribeToDaemonEvents((event: DaemonEvent) => {
      if (event.event === "cyberpunk_game_event") {
        eventIdCounter.current += 1;
        const gameEvent: CyberpunkGameEvent = {
          id: `cyberpunk-${event.ts}-${eventIdCounter.current}`,
          type: event.event_type || "unknown",
          ts: event.ts || Date.now() / 1000,
          params: {
            ...(event.params || {}),
            ...(event.hand ? { hand: event.hand } : {}),
          },
        };
        setGameEvents((prev) => [gameEvent, ...prev].slice(0, MAX_EVENTS));
        fetchStatus(true);
      } else if (event.event === "cyberpunk_started" || event.event === "cyberpunk_stopped") {
        fetchStatus(true);
      }
    });
    return unsubscribe;
  }, [fetchStatus]);

  return {
    status,
    loading,
    error,
    gameEvents,
    solenoidRecoil,
    setSolenoidRecoilSettings,
    enabledEvents,
    setEventEnabled,
    restartRequired,
    gameDir,
    modStatus,
    browseGameDir,
    checkModInstalled,
    installMod,
    start,
    stop,
    clearEvents,
  };
}

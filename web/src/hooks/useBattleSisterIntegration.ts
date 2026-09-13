import { useState, useEffect, useCallback, useRef } from "react";
import {
  battlesisterStart,
  battlesisterStop,
  battlesisterStatus,
  battlesisterGetSettings,
  battlesisterSetSolenoidRecoil,
  battlesisterBrowseGameDir,
  battlesisterCheckModInstalled,
  battlesisterInstallMod,
  subscribeToDaemonEvents,
  BattleSisterStatus,
  DaemonEvent,
  SolenoidRecoilSettings,
} from "../lib/bridgeApi";

export type BattleSisterGameEvent = {
  id: string;
  type: string;
  ts: number;
  params?: Record<string, unknown>;
};

const MAX_EVENTS = 50;
const DEFAULT_SOLENOID: SolenoidRecoilSettings = { enabled: true, durationMs: 40 };

export function useBattleSisterIntegration() {
  const [status, setStatus] = useState<BattleSisterStatus>({
    running: false,
    events_received: 0,
    last_event_ts: null,
    last_event_type: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gameEvents, setGameEvents] = useState<BattleSisterGameEvent[]>([]);
  const [solenoidRecoil, setSolenoidRecoil] = useState<SolenoidRecoilSettings>(DEFAULT_SOLENOID);
  const [gameDir, setGameDir] = useState("");
  const [modStatus, setModStatus] = useState<{
    installed: boolean;
    dllInstalled?: boolean;
    melonLoaderInstalled?: boolean;
    sourceAvailable?: boolean;
    missingFiles?: string[];
    gameDir?: string;
  }>({ installed: false });
  const eventIdCounter = useRef(0);

  const fetchStatus = useCallback(async (preserveError = false) => {
    try {
      const result = await battlesisterStatus();
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
      const result = await battlesisterGetSettings();
      if (result.success) {
        if (result.solenoidRecoil) setSolenoidRecoil(result.solenoidRecoil);
        if (result.gameDir) setGameDir(result.gameDir);
      }
    } catch (err) {
      console.error("Failed to load Battle Sister settings:", err);
    }
  }, []);

  const checkModInstalled = useCallback(async () => {
    try {
      const result = await battlesisterCheckModInstalled();
      if (result.success) {
        setModStatus({
          installed: Boolean(result.installed),
          dllInstalled: Boolean(result.dllInstalled ?? result.installed),
          melonLoaderInstalled: Boolean(result.melonLoaderInstalled),
          sourceAvailable: result.sourceAvailable,
          missingFiles: result.missingFiles,
          gameDir: result.gameDir,
        });
      }
    } catch (err) {
      console.error("Failed to check Battle Sister mod status:", err);
    }
  }, []);

  const browseGameDir = useCallback(async () => {
    try {
      const result = await battlesisterBrowseGameDir();
      if (result.success && result.gameDir) {
        setGameDir(result.gameDir);
        await checkModInstalled();
      }
    } catch (err) {
      console.error("Failed to browse Battle Sister game dir:", err);
    }
  }, [checkModInstalled]);

  const installMod = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await battlesisterInstallMod();
      if (result.success) {
        await checkModInstalled();
        return {
          success: true,
          copiedFiles: result.copiedFiles,
          warning: result.warning,
        };
      }
      setError(result.error || "Failed to install Battle Sister mod");
      return { success: false, error: result.error };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to install Battle Sister mod";
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
      const result = await battlesisterStart();
      if (result.success) await fetchStatus(true);
      else setError(result.error || "Failed to start Battle Sister integration");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start Battle Sister integration");
    } finally {
      setLoading(false);
    }
  }, [fetchStatus]);

  const stop = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await battlesisterStop();
      if (result.success) await fetchStatus(true);
      else setError(result.error || "Failed to stop Battle Sister integration");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop Battle Sister integration");
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
        await battlesisterSetSolenoidRecoil(next);
      } catch (err) {
        console.error("Failed to save Battle Sister solenoid settings:", err);
      }
    },
    [solenoidRecoil]
  );

  useEffect(() => {
    fetchSettings();
    fetchStatus();
    checkModInstalled();
  }, [fetchSettings, fetchStatus, checkModInstalled]);

  useEffect(() => {
    const unsubscribe = subscribeToDaemonEvents((event: DaemonEvent) => {
      if (event.event === "battlesister_game_event") {
        eventIdCounter.current += 1;
        setGameEvents((prev) =>
          [
            {
              id: `battlesister-${event.ts}-${eventIdCounter.current}`,
              type: event.event_type || "unknown",
              ts: event.ts || Date.now() / 1000,
              params: {
                ...(event.params || {}),
                ...(event.hand ? { hand: event.hand } : {}),
                ...(typeof event.angle === "number" ? { angle: event.angle } : {}),
              },
            },
            ...prev,
          ].slice(0, MAX_EVENTS)
        );
        fetchStatus(true);
      } else if (event.event === "battlesister_started" || event.event === "battlesister_stopped") {
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

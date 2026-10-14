import { useState, useEffect, useCallback, useRef } from "react";
import {
  titanfall2Start,
  titanfall2Stop,
  titanfall2Status,
  titanfall2GetSettings,
  titanfall2SetSolenoidRecoil,
  titanfall2BrowseGameDir,
  titanfall2CheckModInstalled,
  titanfall2InstallMod,
  subscribeToDaemonEvents,
  Titanfall2Status,
  DaemonEvent,
  SolenoidRecoilSettings,
  Titanfall2ProfileStatus,
} from "../lib/bridgeApi";

export type Titanfall2GameEvent = {
  id: string;
  type: string;
  ts: number;
  params?: Record<string, unknown>;
};

const MAX_EVENTS = 50;
const DEFAULT_SOLENOID: SolenoidRecoilSettings = {
  enabled: true,
  durationMs: 40,
};

export function useTitanfall2Integration() {
  const [status, setStatus] = useState<Titanfall2Status>({
    running: false,
    events_received: 0,
    last_event_ts: null,
    last_event_type: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gameEvents, setGameEvents] = useState<Titanfall2GameEvent[]>([]);
  const [solenoidRecoil, setSolenoidRecoil] = useState<SolenoidRecoilSettings>(DEFAULT_SOLENOID);
  const [gameDir, setGameDir] = useState("");
  const [modStatus, setModStatus] = useState<{
    installed: boolean;
    allProfilesInstalled?: boolean;
    dllInstalled?: boolean;
    modInstalled?: boolean;
    sourceAvailable?: boolean;
    missingFiles?: string[];
    gameDir?: string;
    gameRoot?: string;
    tf2vrDir?: string;
    profiles?: Titanfall2ProfileStatus[];
  }>({ installed: false });
  const eventIdCounter = useRef(0);

  const fetchStatus = useCallback(async (preserveError = false) => {
    try {
      const result = await titanfall2Status();
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
      const result = await titanfall2GetSettings();
      if (result.success) {
        if (result.solenoidRecoil) {
          setSolenoidRecoil(result.solenoidRecoil);
        }
        if (result.gameDir) {
          setGameDir(result.gameDir);
        }
      }
    } catch (err) {
      console.error("Failed to load Titanfall 2 settings:", err);
    }
  }, []);

  const checkModInstalled = useCallback(async () => {
    try {
      const result = await titanfall2CheckModInstalled();
      if (result.success) {
        setModStatus({
          installed: Boolean(result.installed),
          allProfilesInstalled: Boolean(result.allProfilesInstalled),
          dllInstalled: Boolean(result.dllInstalled),
          modInstalled: Boolean(result.modInstalled),
          sourceAvailable: result.sourceAvailable,
          missingFiles: result.missingFiles,
          gameDir: result.gameDir,
          gameRoot: result.gameRoot,
          tf2vrDir: result.tf2vrDir,
          profiles: result.profiles,
        });
      }
    } catch (err) {
      console.error("Failed to check Titanfall 2 mod:", err);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchSettings();
    checkModInstalled();
  }, [fetchStatus, fetchSettings, checkModInstalled]);

  useEffect(() => {
    const unsub = subscribeToDaemonEvents((event: DaemonEvent) => {
      if (event.event === "titanfall2_game_event") {
        eventIdCounter.current += 1;
        const next: Titanfall2GameEvent = {
          id: `titanfall2-${event.ts}-${eventIdCounter.current}`,
          type: String(event.event_type || "unknown"),
          ts: event.ts || Date.now() / 1000,
          params: (event.params as Record<string, unknown>) || undefined,
        };
        setGameEvents((prev) => [next, ...prev].slice(0, MAX_EVENTS));
        void fetchStatus(true);
      } else if (event.event === "titanfall2_started" || event.event === "titanfall2_stopped") {
        void fetchStatus(true);
      }
    });
    return unsub;
  }, [fetchStatus]);

  const browseGameDir = useCallback(async () => {
    setLoading(true);
    try {
      const result = await titanfall2BrowseGameDir();
      if (result.success && result.gameDir) {
        setGameDir(result.gameDir);
        await checkModInstalled();
      }
      return result;
    } finally {
      setLoading(false);
    }
  }, [checkModInstalled]);

  const installMod = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await titanfall2InstallMod();
      if (!result.success) {
        setError(result.error || "Install failed");
      }
      await checkModInstalled();
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Install failed";
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
      const result = await titanfall2Start();
      if (!result.success) {
        setError(result.error || "Failed to start");
      }
      await fetchStatus(true);
      return result;
    } finally {
      setLoading(false);
    }
  }, [fetchStatus]);

  const stop = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await titanfall2Stop();
      if (!result.success) {
        setError(result.error || "Failed to stop");
      }
      await fetchStatus(true);
      return result;
    } finally {
      setLoading(false);
    }
  }, [fetchStatus]);

  const setSolenoidRecoilSettings = useCallback(async (next: SolenoidRecoilSettings) => {
    setSolenoidRecoil(next);
    try {
      await titanfall2SetSolenoidRecoil(next);
    } catch (err) {
      console.error("Failed to save Titanfall 2 solenoid settings:", err);
    }
  }, []);

  const clearEvents = useCallback(() => setGameEvents([]), []);

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
    installMod,
    checkModInstalled,
    start,
    stop,
    clearEvents,
  };
}

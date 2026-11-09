import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  recoilConnect,
  recoilDisconnect,
  recoilListPorts,
  recoilPulse,
  recoilSet,
  recoilStatus,
  relayConnect,
  relayDisconnect,
  relayMouseStart,
  relayMouseStatus,
  relayMouseStop,
  relayPulse,
  relaySet,
  relayStatus,
  type RecoilLinkStatus,
  type RelayMouseFireMode,
  type RelayPortInfo,
  type RelayStatusInfo,
} from "../lib/bridgeApi";

const DEFAULT_PULSE_MS = 40;
const LC_MIN_PULSE_MS = 40;
const LINK_MIN_PULSE_MS = 5;
const LINK_MAX_PULSE_MS = 100;
const DEFAULT_ADDRESS = 1;
const DEFAULT_BAUD = 9600;
const DEFAULT_FIRE_RATE_RPM = 600;
const MIN_FIRE_RATE_RPM = 60;
const MAX_FIRE_RATE_RPM = 1500;
const DEFAULT_BURST_COUNT = 3;

/** WCH CH340 — USB VID:PID used by common LC USB relay sticks */
const CH340_VID = 0x1a86;
const CH340_PID = 0x7523;
/** ThunderStrikeCompany TSC Recoil Link */
const RECOIL_VID = 0x2fe3;
const RECOIL_PID = 0x0004;

type BackendKind = "link" | "lc" | "other";

function isLikelyRelayPort(port: RelayPortInfo): boolean {
  if (port.likely_relay) return true;
  if (port.vid === CH340_VID && port.pid === CH340_PID) return true;
  const blob = `${port.description} ${port.manufacturer ?? ""} ${port.hwid}`.toLowerCase();
  return blob.includes("ch340") || blob.includes("ch341") || blob.includes("wch.cn");
}

function isLikelyLinkPort(port: RelayPortInfo): boolean {
  if (port.likely_recoil) return true;
  if (port.vid === RECOIL_VID && port.pid === RECOIL_PID) return true;
  const blob = `${port.display_name ?? ""} ${port.product ?? ""} ${port.description} ${port.hwid}`.toLowerCase();
  return blob.includes("recoil link") || blob.includes("vid_2fe3");
}

function backendKind(port: RelayPortInfo | undefined): BackendKind {
  if (!port) return "other";
  if (isLikelyLinkPort(port)) return "link";
  if (isLikelyRelayPort(port)) return "lc";
  return "other";
}

function portOptionLabel(port: RelayPortInfo): string {
  if (isLikelyLinkPort(port)) {
    const name = port.display_name || port.product || "TSC Recoil Link";
    return `${name} (${port.device})`;
  }
  if (isLikelyRelayPort(port)) {
    return `USB LC relay (${port.device})`;
  }
  const name = port.display_name || port.description || "Serial";
  return `${port.device} — ${name}`;
}

function isPortAccessDeniedError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("access is denied") ||
    lower.includes("permissionerror") ||
    lower.includes("permission denied")
  );
}

function pickPreferredPort(ports: RelayPortInfo[], current: string): string {
  if (current) {
    const currentPort = ports.find((p) => p.device === current);
    if (currentPort && (isLikelyLinkPort(currentPort) || isLikelyRelayPort(currentPort))) {
      return current;
    }
  }
  const link = ports.find(isLikelyLinkPort);
  if (link?.device) return link.device;
  const relay = ports.find(isLikelyRelayPort);
  if (relay?.device) return relay.device;
  if (current && ports.some((p) => p.device === current)) return current;
  return ports[0]?.device ?? "";
}

function sortPorts(ports: RelayPortInfo[]): RelayPortInfo[] {
  return [...ports].sort((a, b) => {
    const rank = (p: RelayPortInfo) =>
      isLikelyLinkPort(p) ? 0 : isLikelyRelayPort(p) ? 1 : 2;
    const d = rank(a) - rank(b);
    return d !== 0 ? d : (a.device || "").localeCompare(b.device || "");
  });
}

export function RecoilPage() {
  const [ports, setPorts] = useState<RelayPortInfo[]>([]);
  const [selectedPort, setSelectedPort] = useState("");
  const [baud, setBaud] = useState(DEFAULT_BAUD);
  const [address, setAddress] = useState(DEFAULT_ADDRESS);
  const [pulseMs, setPulseMs] = useState(DEFAULT_PULSE_MS);
  const [relay, setRelay] = useState<RelayStatusInfo | null>(null);
  const [link, setLink] = useState<RecoilLinkStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mouseListening, setMouseListening] = useState(false);
  const [mousePulses, setMousePulses] = useState(0);
  const [fireMode, setFireMode] = useState<RelayMouseFireMode>("single");
  const [fireRateRpm, setFireRateRpm] = useState(DEFAULT_FIRE_RATE_RPM);
  const [burstCount, setBurstCount] = useState(DEFAULT_BURST_COUNT);

  const selected = useMemo(
    () => ports.find((p) => p.device === selectedPort),
    [ports, selectedPort]
  );
  const kind = backendKind(selected);
  const minPulse = kind === "link" ? LINK_MIN_PULSE_MS : LC_MIN_PULSE_MS;
  const maxPulse = kind === "link" ? LINK_MAX_PULSE_MS : 1000;

  const connected =
    kind === "link"
      ? Boolean(link?.connected)
      : kind === "lc"
        ? Boolean(relay?.connected)
        : Boolean(link?.connected || relay?.connected);

  const activeBackend: "link" | "lc" | null = link?.connected
    ? "link"
    : relay?.connected
      ? "lc"
      : null;

  const shotIntervalMs = Math.max(
    Math.max(minPulse, pulseMs),
    Math.round(60000 / Math.max(MIN_FIRE_RATE_RPM, Math.min(MAX_FIRE_RATE_RPM, fireRateRpm)))
  );

  const mouseOptions = useCallback(
    () => ({
      durationMs: Math.max(minPulse, Math.min(maxPulse, pulseMs)),
      fireMode,
      fireRateRpm: Math.max(MIN_FIRE_RATE_RPM, Math.min(MAX_FIRE_RATE_RPM, fireRateRpm)),
      burstCount,
    }),
    [pulseMs, fireMode, fireRateRpm, burstCount, minPulse, maxPulse]
  );

  const refreshStatus = useCallback(async () => {
    const [relayResult, linkResult, mouse] = await Promise.all([
      relayStatus(),
      recoilStatus(),
      relayMouseStatus(),
    ]);
    if (relayResult.success) {
      setRelay(relayResult.relay ?? null);
      if (relayResult.relay?.port) {
        setSelectedPort(relayResult.relay.port);
      }
    }
    if (linkResult.success) {
      setLink(linkResult.recoil ?? null);
      if (linkResult.recoil?.connected && linkResult.recoil.port) {
        setSelectedPort(linkResult.recoil.port);
      }
    }
    if (mouse.success) {
      setMouseListening(Boolean(mouse.running));
      setMousePulses(mouse.pulses ?? 0);
    }
  }, []);

  const refreshPorts = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await recoilListPorts();
      if (!result.success) {
        setError(result.error || "Failed to list USB recoil ports");
        setPorts([]);
        return;
      }
      const next = sortPorts(result.ports);
      setPorts(next);
      setSelectedPort((current) => pickPreferredPort(next, current));
      const known = next.filter((p) => isLikelyLinkPort(p) || isLikelyRelayPort(p));
      if (known.length) {
        setMessage(
          `Found ${known.length} known output(s): ${known.map(portOptionLabel).join(", ")}`
        );
      } else {
        setMessage(`Found ${next.length} serial port(s) — none look like Recoil Link or LC relay`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshPorts();
    void refreshStatus();
  }, [refreshPorts, refreshStatus]);

  useEffect(() => {
    if (!mouseListening) return;
    const id = window.setInterval(() => {
      void relayMouseStatus().then((mouse) => {
        if (mouse.success) {
          setMouseListening(Boolean(mouse.running));
          setMousePulses(mouse.pulses ?? 0);
        }
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [mouseListening]);

  const handleConnect = async () => {
    if (!selectedPort) {
      setError("Select a recoil output first");
      return;
    }
    if (kind === "other") {
      setError("Pick a TSC Recoil Link or USB LC relay — unknown ports are not supported");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      // One active backend — disconnect the other first
      if (kind === "link" && relay?.connected) {
        await relayDisconnect();
        setRelay({ connected: false, is_on: false });
      }
      if (kind === "lc" && link?.connected) {
        await recoilDisconnect();
        setLink(null);
      }

      if (kind === "link") {
        const result = await recoilConnect(selectedPort);
        if (!result.success) {
          setError(result.error || "Connect failed");
          return;
        }
        const linked = result.recoil ?? { connected: true, port: selectedPort };
        setLink(linked);
        const radioWarn = linked.last_error;
        setMessage(
          radioWarn
            ? `Connected — ${portOptionLabel(selected!)}. Radio: ${radioWarn}`
            : `Connected — ${portOptionLabel(selected!)}`
        );
      } else {
        const result = await relayConnect(selectedPort, baud, address);
        if (!result.success) {
          setError(result.error || "Connect failed");
          return;
        }
        setRelay(result.relay ?? null);
        setMessage(`Connected — USB LC relay (${selectedPort})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mouseListening) {
        await relayMouseStop();
        setMouseListening(false);
      }
      if (link?.connected) {
        const result = await recoilDisconnect();
        if (!result.success) {
          setError(result.error || "Disconnect failed");
          return;
        }
        setLink(null);
      }
      if (relay?.connected) {
        const result = await relayDisconnect();
        if (!result.success) {
          setError(result.error || "Disconnect failed");
          return;
        }
        setRelay({ connected: false, is_on: false });
      }
      setMessage("Disconnected");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSet = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (activeBackend === "link") {
        const result = await recoilSet(on);
        if (!result.success) {
          setError(result.error || `Failed to turn output ${on ? "ON" : "OFF"}`);
          return;
        }
        setLink(result.recoil ?? link);
        setMessage(`Output ${on ? "ON" : "OFF"} (Recoil Link)`);
      } else {
        const result = await relaySet(on);
        if (!result.success) {
          setError(result.error || `Failed to turn output ${on ? "ON" : "OFF"}`);
          return;
        }
        setRelay(result.relay ?? null);
        setMessage(`Output ${on ? "ON" : "OFF"}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePulse = async () => {
    const ms = Math.max(minPulse, Math.min(maxPulse, pulseMs));
    setBusy(true);
    setError(null);
    try {
      if (activeBackend === "link") {
        const result = await recoilPulse(ms);
        if (!result.success) {
          setError(result.error || "Pulse failed");
          return;
        }
        setLink(result.recoil ?? link);
        setMessage(`Pulsed ${result.duration_ms ?? ms} ms (Recoil Link)`);
      } else {
        const result = await relayPulse(ms);
        if (!result.success) {
          setError(result.error || "Pulse failed");
          return;
        }
        setRelay(result.relay ?? null);
        setMessage(`Pulsed ${result.duration_ms ?? ms} ms`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleMouseToggle = async (enable: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (enable) {
        if (!connected) {
          setError("Connect a recoil output before enabling click recoil");
          return;
        }
        const result = await relayMouseStart(mouseOptions());
        if (!result.success) {
          setError(result.error || "Failed to start click recoil");
          setMouseListening(false);
          return;
        }
        setMouseListening(true);
        setMousePulses(result.pulses ?? 0);
        const modeLabel =
          fireMode === "single"
            ? "one-by-one"
            : fireMode === "burst"
              ? `burst×${burstCount}`
              : "full-auto";
        setMessage(
          `Click recoil ON (${modeLabel}, ${fireRateRpm} RPM ≈ ${shotIntervalMs} ms)`
        );
      } else {
        const result = await relayMouseStop();
        if (!result.success) {
          setError(result.error || "Failed to stop click recoil");
          return;
        }
        setMouseListening(false);
        setMessage("Click recoil OFF");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!mouseListening || !connected) return;
    void relayMouseStart(mouseOptions());
  }, [mouseListening, connected, mouseOptions]);

  const knownPorts = ports.filter((p) => isLikelyLinkPort(p) || isLikelyRelayPort(p));
  const otherPorts = ports.filter((p) => !isLikelyLinkPort(p) && !isLikelyRelayPort(p));

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold text-white">Recoil</h1>
        <p className="mt-2 text-sm md:text-base text-slate-400">
          Test solenoid output over USB LC relay or TSC Recoil Link. Prefer short pulses — coils
          overheat if left on. Need boards or flash?{" "}
          <Link to="/recoil-link" className="text-sky-400 hover:text-sky-300">
            Kit Setup
          </Link>
          .
        </p>
      </header>

      <section className="rounded-2xl bg-slate-800/80 p-4 md:p-5 shadow-lg ring-1 ring-white/5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-wide text-slate-400">Output</p>
            <h2 className="text-xl font-semibold text-white">Recoil output</h2>
            <p className="mt-1 text-sm text-slate-400">
              Select a known device — TSC Recoil Link or wired USB LC relay.
            </p>
          </div>
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-medium ${
              connected
                ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40"
                : "bg-slate-700 text-slate-300 ring-1 ring-slate-600"
            }`}
          >
            {connected
              ? activeBackend === "link"
                ? "Linked"
                : "Connected"
              : "Disconnected"}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="block space-y-1.5">
            <span className="text-sm text-slate-400">Device</span>
            <select
              className="w-full rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-white"
              value={selectedPort}
              onChange={(e) => setSelectedPort(e.target.value)}
              disabled={busy || connected}
            >
              {ports.length === 0 ? (
                <option value="">
                  {error ? "Port list failed — see error below" : "No serial devices found"}
                </option>
              ) : (
                <>
                  {knownPorts.length > 0 && (
                    <optgroup label="Known outputs">
                      {knownPorts.map((p) => (
                        <option key={p.device} value={p.device}>
                          {portOptionLabel(p)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {otherPorts.length > 0 && (
                    <optgroup label="Other serial ports">
                      {otherPorts.map((p) => (
                        <option key={p.device} value={p.device}>
                          {portOptionLabel(p)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </>
              )}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void refreshPorts()}
              disabled={busy}
              className="w-full sm:w-auto rounded-lg border border-slate-500 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </div>

        {kind === "lc" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-sm text-slate-400">Baud</span>
              <input
                type="number"
                className="w-full rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-white"
                value={baud}
                onChange={(e) => setBaud(Number(e.target.value) || DEFAULT_BAUD)}
                disabled={busy || connected}
                min={1200}
                step={100}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm text-slate-400">Switch address</span>
              <input
                type="number"
                className="w-full rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-white"
                value={address}
                onChange={(e) => setAddress(Number(e.target.value) || DEFAULT_ADDRESS)}
                disabled={busy || connected}
                min={0}
                max={255}
              />
            </label>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {!connected ? (
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={busy || !selectedPort || kind === "other"}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {kind === "link" ? "Connect TSC Recoil Link" : "Connect"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleDisconnect()}
              disabled={busy}
              className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
            >
              Disconnect
            </button>
          )}
        </div>

        {(message || error) && (
          <div
            className={`rounded-xl px-4 py-3 text-sm space-y-1.5 ${
              error
                ? "bg-rose-500/10 text-rose-300 ring-1 ring-rose-500/30"
                : "bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/30"
            }`}
          >
            <p>{error || message}</p>
            {error && isPortAccessDeniedError(error) && (
              <p className="text-rose-200/80 text-xs leading-relaxed">
                Some software is known to lock USB/COM ports — SignalRGB is a common culprit.
                Quit it (or anything else using the port), then try Connect again.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="rounded-2xl bg-slate-800/80 p-4 md:p-5 shadow-lg ring-1 ring-white/5 space-y-4">
        <div>
          <p className="text-sm uppercase tracking-wide text-slate-400">Control</p>
          <h2 className="text-xl font-semibold text-white">Manual control</h2>
        </div>

        <label className="block space-y-1.5 max-w-xs">
          <span className="text-sm text-slate-400">Pulse duration (ms)</span>
          <input
            type="number"
            className="w-full rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-white"
            value={Math.max(minPulse, Math.min(maxPulse, pulseMs))}
            onChange={(e) =>
              setPulseMs(
                Math.max(minPulse, Math.min(maxPulse, Number(e.target.value) || DEFAULT_PULSE_MS))
              )
            }
            disabled={busy || !connected}
            min={minPulse}
            max={maxPulse}
          />
        </label>
        <p className="text-xs text-slate-500">
          {kind === "link"
            ? `Recoil Link: pulses ${LINK_MIN_PULSE_MS}–${LINK_MAX_PULSE_MS} ms. ON holds until OFF, or 20 s, then 10 s off.`
            : `LC relay: minimum ${LC_MIN_PULSE_MS} ms. Any ON is force-cleared after 1 s.`}
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handlePulse()}
            disabled={busy || !connected}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-50"
          >
            Pulse Recoil
          </button>
          <button
            type="button"
            onClick={() => void handleSet(true)}
            disabled={busy || !connected}
            className="rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            ON
          </button>
          <button
            type="button"
            onClick={() => void handleSet(false)}
            disabled={busy || !connected}
            className="rounded-lg border border-slate-500 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
          >
            OFF
          </button>
        </div>
      </section>

      <section className="rounded-2xl bg-slate-800/80 p-4 md:p-5 shadow-lg ring-1 ring-white/5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-wide text-slate-400">Input</p>
            <h2 className="text-xl font-semibold text-white">Click-based recoil</h2>
            <p className="mt-1 text-sm text-slate-400">
              System-wide left mouse button. Works with whichever output is connected.
            </p>
          </div>
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
              mouseListening
                ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40"
                : "bg-slate-700 text-slate-300 ring-1 ring-slate-600"
            }`}
          >
            {mouseListening ? "Listening" : "Off"}
          </span>
        </div>

        <div className="space-y-2">
          <p className="text-sm text-slate-400">Firing mode</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: "single" as const, label: "One by one" },
                { id: "burst" as const, label: "Burst" },
                { id: "fullauto" as const, label: "Full auto" },
              ] as const
            ).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setFireMode(mode.id)}
                disabled={busy}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  fireMode === mode.id
                    ? "bg-blue-600 text-white"
                    : "border border-slate-600 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            {fireMode === "single" && "One pulse per click."}
            {fireMode === "burst" &&
              `Each click fires ${burstCount} pulses spaced by the fire rate.`}
            {fireMode === "fullauto" &&
              "Hold left mouse button to keep firing at the fire rate; release to stop."}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-sm text-slate-400">Fire rate (RPM)</span>
            <input
              type="number"
              className="w-full rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-white"
              value={Math.max(MIN_FIRE_RATE_RPM, Math.min(MAX_FIRE_RATE_RPM, fireRateRpm))}
              onChange={(e) =>
                setFireRateRpm(
                  Math.max(
                    MIN_FIRE_RATE_RPM,
                    Math.min(MAX_FIRE_RATE_RPM, Number(e.target.value) || DEFAULT_FIRE_RATE_RPM)
                  )
                )
              }
              disabled={busy || fireMode === "single"}
              min={MIN_FIRE_RATE_RPM}
              max={MAX_FIRE_RATE_RPM}
              step={10}
            />
            <span className="text-xs text-slate-500">
              Shot spacing ≈ <span className="font-mono text-slate-300">{shotIntervalMs} ms</span>
              {fireMode === "single" ? " (unused in one-by-one)" : ""}
            </span>
          </label>

          {fireMode === "burst" ? (
            <label className="block space-y-1.5">
              <span className="text-sm text-slate-400">Burst count</span>
              <input
                type="number"
                className="w-full rounded-lg bg-slate-900 border border-slate-600 px-3 py-2 text-white"
                value={burstCount}
                onChange={(e) =>
                  setBurstCount(
                    Math.max(1, Math.min(20, Number(e.target.value) || DEFAULT_BURST_COUNT))
                  )
                }
                disabled={busy}
                min={1}
                max={20}
              />
            </label>
          ) : (
            <div className="text-xs text-slate-500 self-end pb-2">
              Pulse length uses Manual control ({Math.max(minPulse, Math.min(maxPulse, pulseMs))}{" "}
              ms).
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {!mouseListening ? (
            <button
              type="button"
              onClick={() => void handleMouseToggle(true)}
              disabled={busy || !connected}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-50"
            >
              Enable click recoil
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleMouseToggle(false)}
              disabled={busy}
              className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
            >
              Disable click recoil
            </button>
          )}
          <span className="text-sm text-slate-400">
            Pulses this session:{" "}
            <span className="text-slate-200 font-mono">{mousePulses}</span>
          </span>
        </div>

        {mouseListening && (
          <p className="text-xs text-amber-200/90 rounded-lg bg-amber-500/10 ring-1 ring-amber-500/20 px-3 py-2">
            Active — left mouse is hooked system-wide. Disable when done testing.
          </p>
        )}
      </section>

      <section className="rounded-2xl bg-slate-900/60 p-4 text-sm text-slate-400 ring-1 ring-white/5 space-y-2">
        <p className="font-medium text-slate-300">Debug</p>
        <p>
          Backend:{" "}
          <span className="text-slate-200">
            {activeBackend === "link"
              ? `TSC Recoil Link (${link?.port || "—"})`
              : activeBackend === "lc"
                ? `USB LC relay (${relay?.port || "—"})`
                : "none"}
          </span>
        </p>
        {activeBackend === "lc" && (
          <p>
            LC protocol (9600 baud): ON{" "}
            <code className="text-slate-200">A0 01 01 A2</code> · OFF{" "}
            <code className="text-slate-200">A0 01 00 A1</code>
          </p>
        )}
        {activeBackend === "link" && (
          <p>
            CLI:{" "}
            <code className="text-slate-200">
              python -m modern_third_space.cli recoil pulse --port {link?.port || "COMx"} --ms 25
            </code>
          </p>
        )}
        {activeBackend !== "link" && (
          <p>
            CLI:{" "}
            <code className="text-slate-200">
              python -m modern_third_space.cli relay pulse --port COM3 --ms 40
            </code>
          </p>
        )}
        {error && <p className="text-rose-300">Last error: {error}</p>}
      </section>
    </div>
  );
}

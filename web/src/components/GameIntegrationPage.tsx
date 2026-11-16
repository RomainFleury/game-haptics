import { Link } from "react-router-dom";
import { useState } from "react";
import type {
  GameIntegrationPageProps,
  GameEvent,
  EventDisplayInfo,
} from "../types/integratedGames";
import { CopyUrlButton } from "./CopyUrlButton";

/**
 * Reusable template for game integration pages.
 * 
 * This provides a consistent layout with:
 * - Title and status
 * - Start/Stop buttons
 * - Launch game button (Steam)
 * - Configuration section (optional)
 * - Setup guide (optional)
 * - Live events log
 */
export function GameIntegrationPage({
  game,
  status,
  loading = false,
  error,
  events,
  eventDisplayMap = {},
  onStart,
  onStop,
  onClearEvents,
  formatEventDetails,
  setupGuide,
  configurationPanel,
  modInfo,
  additionalStats,
  steamLaunchOptionsOverride,
  controlsExtra,
  wide = false,
  children,
}: GameIntegrationPageProps) {
  const launchOptions =
    steamLaunchOptionsOverride !== undefined
      ? steamLaunchOptionsOverride || ""
      : game.steamLaunchOptions || "";
  const steamLaunchUrl = game.steamAppId
    ? `steam://run/${game.steamAppId}${launchOptions ? `//${launchOptions}` : ""}`
    : null;

  // Collapsible section states (setup open by default when a mod is required)
  const [configExpanded, setConfigExpanded] = useState(true);
  const [guideExpanded, setGuideExpanded] = useState(Boolean(modInfo));

  const getEventInfo = (type: string): EventDisplayInfo => {
    return eventDisplayMap[type] || { label: type, icon: "📡", color: "text-slate-400" };
  };

  const getEventDetails = (event: GameEvent): string => {
    if (formatEventDetails) {
      return formatEventDetails(event);
    }
    return "";
  };

  return (
    <div className={`${wide ? "w-full" : "max-w-4xl mx-auto"} space-y-6`}>
      {/* Back link */}
      <Link
        to="/games"
        className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Games
      </Link>

      {/* Header */}
      <header className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <span className="text-4xl">{game.icon}</span>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white">{game.name}</h1>
            <p className="text-slate-400">{game.description}</p>
          </div>
        </div>
        {/* Status badge */}
        <span
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium ${
            status.running
              ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30"
              : "bg-slate-500/20 text-slate-400 ring-1 ring-slate-500/30"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              status.running ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
            }`}
          />
          {status.running ? "Running" : "Stopped"}
        </span>
      </header>

      {/* Upstream credits — always visible when this integration is based on others' mods */}
      {modInfo?.credits && (
        <section className="rounded-xl bg-slate-800/60 border border-slate-700/50 px-4 py-3 text-sm">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
            Credits
          </h2>
          <p className="text-slate-300 mb-2">{modInfo.credits.summary}</p>
          <p className="text-xs text-slate-500 mb-2">Click or right-click a link to copy the URL (paste in your browser).</p>
          <div className="flex flex-wrap gap-2">
            {modInfo.credits.links.map((link) => (
              <CopyUrlButton key={link.url} label={link.label} url={link.url} />
            ))}
          </div>
        </section>
      )}

      {/* Error display */}
      {error && (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-3 text-rose-200">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        </div>
      )}

      {/* Controls */}
      <section className="rounded-2xl bg-slate-800/80 p-4 md:p-6 shadow-lg ring-1 ring-white/5">
        <h2 className="text-lg font-semibold text-white mb-4">Controls</h2>
        
        <div className="flex flex-wrap gap-3">
          {/* Start/Stop button */}
          {!status.running ? (
            <button
              onClick={onStart}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600/80 px-5 py-2.5 font-medium text-white transition hover:bg-emerald-600 disabled:opacity-50"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {loading ? "Starting..." : "Start"}
            </button>
          ) : (
            <button
              onClick={onStop}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600/80 px-5 py-2.5 font-medium text-white transition hover:bg-rose-600 disabled:opacity-50"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
              </svg>
              {loading ? "Stopping..." : "Stop"}
            </button>
          )}

          {/* Launch via Steam button */}
          {steamLaunchUrl && (
            <a
              href={steamLaunchUrl}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-600/80 to-blue-700/80 px-5 py-2.5 font-medium text-white transition hover:from-blue-600 hover:to-blue-700"
              title={`Launch ${game.name} via Steam${launchOptions ? ` (${launchOptions})` : ""}`}
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z"/>
              </svg>
              Launch via Steam
            </a>
          )}
        </div>

        {controlsExtra}

        {/* Stats */}
        {status.running && (
          <div className="mt-4 flex flex-wrap gap-3">
            <div className="rounded-lg bg-slate-700/30 px-4 py-2">
              <span className="text-slate-400 text-sm">Events:</span>{" "}
              <span className="font-mono text-white">{status.events_received ?? 0}</span>
            </div>
            {status.last_event_ts != null && (
              <div className="rounded-lg bg-slate-700/30 px-4 py-2">
                <span className="text-slate-400 text-sm">Last:</span>{" "}
                <span className="font-mono text-white">
                  {new Date(status.last_event_ts * 1000).toLocaleTimeString()}
                </span>
              </div>
            )}
            {status.last_event_type && (
              <div className="rounded-lg bg-slate-700/30 px-4 py-2">
                <span className="text-slate-400 text-sm">Type:</span>{" "}
                <span className="font-mono text-white">{status.last_event_type}</span>
              </div>
            )}
            {additionalStats}
          </div>
        )}
      </section>

      {children}

      {/* Configuration (if provided) */}
      {configurationPanel && (
        <section className="rounded-2xl bg-slate-800/80 shadow-lg ring-1 ring-white/5 overflow-hidden">
          <button
            onClick={() => setConfigExpanded(!configExpanded)}
            className="w-full flex items-center justify-between p-4 md:p-6 text-left hover:bg-slate-700/30 transition"
          >
            <h2 className="text-lg font-semibold text-white">Configuration</h2>
            <svg
              className={`h-5 w-5 text-slate-400 transition-transform ${configExpanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {configExpanded && (
            <div className="px-4 md:px-6 pb-4 md:pb-6">
              {configurationPanel}
            </div>
          )}
        </section>
      )}

      {/* Setup Guide (if provided) */}
      {(setupGuide || modInfo) && (
        <section className="rounded-2xl bg-slate-800/80 shadow-lg ring-1 ring-white/5 overflow-hidden">
          <button
            onClick={() => setGuideExpanded(!guideExpanded)}
            className="w-full flex items-center justify-between p-4 md:p-6 text-left hover:bg-slate-700/30 transition"
          >
            <h2 className="text-lg font-semibold text-white">Setup Guide</h2>
            <svg
              className={`h-5 w-5 text-slate-400 transition-transform ${guideExpanded ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {guideExpanded && (
            <div className="px-4 md:px-6 pb-4 md:pb-6">
              {/* Mod info banner */}
              {modInfo && (
            <div className="mb-4 rounded-xl bg-amber-900/20 border border-amber-700/30 p-4">
              <h3 className="text-sm font-medium text-amber-200 mb-2">
                ⚠️ Mod Required: {modInfo.name}
              </h3>

              <p className="text-xs text-amber-200/60 mb-2">
                Click or right-click a button to copy the download URL, then paste it in your browser.
              </p>

              {/* Download / copy-URL buttons */}
              <div className="flex flex-wrap gap-3 mb-3">
                {(modInfo.downloadLinks?.length
                  ? modInfo.downloadLinks
                  : [{ label: "Copy download URL", url: modInfo.downloadUrl }]
                ).map((link) => (
                  <CopyUrlButton
                    key={link.url}
                    label={link.label}
                    url={link.url}
                    className="inline-flex items-center gap-2 rounded-lg bg-amber-600/80 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-600"
                  />
                ))}
                {modInfo.githubUrl && (
                  <CopyUrlButton
                    label={modInfo.credits ? "Copy original-mod URL" : "Copy GitHub URL"}
                    url={modInfo.githubUrl}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-600/80 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-600"
                  />
                )}
              </div>

              {/* Install instructions */}
              <div className="text-sm text-amber-200/80">
                <p className="font-medium mb-1">Installation:</p>
                <ol className="list-decimal list-inside space-y-1 text-amber-300/70">
                  {modInfo.installInstructions.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
            </div>
          )}

              {setupGuide}
            </div>
          )}
        </section>
      )}

      {/* Live Events Log */}
      <section className="rounded-2xl bg-slate-800/80 p-4 md:p-6 shadow-lg ring-1 ring-white/5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Live Events</h2>
          {events.length > 0 && (
            <button
              onClick={onClearEvents}
              className="text-sm text-slate-400 hover:text-white transition"
            >
              Clear
            </button>
          )}
        </div>

        <div className="rounded-xl bg-slate-900/50 p-4 max-h-80 overflow-y-auto">
          {events.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">
              {status.running
                ? `Waiting for ${game.name} events... (play the game!)`
                : "Start the integration to see live events"}
            </p>
          ) : (
            <ul className="space-y-1">
              {events.map((event) => {
                const info = getEventInfo(event.type);
                const details = getEventDetails(event);
                // Handle both seconds (Unix) and milliseconds timestamps
                const timestamp = event.ts > 1e12 ? event.ts : event.ts * 1000;
                return (
                  <li
                    key={event.id}
                    className="flex items-center gap-2 rounded-lg bg-slate-800/50 px-3 py-2 text-sm"
                  >
                    <span className="text-lg">{info.icon}</span>
                    <span className={`font-medium ${info.color}`}>
                      {info.label}
                    </span>
                    {details && (
                      <span className="text-slate-400">({details})</span>
                    )}
                    <span className="ml-auto text-xs text-slate-500">
                      {new Date(timestamp).toLocaleTimeString()}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

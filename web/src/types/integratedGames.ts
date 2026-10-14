import { ReactNode } from "react";

/**
 * Configuration for an integrated game
 */
export interface IntegratedGameConfig {
  /** Unique identifier for the game */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** Icon (emoji or component) */
  icon: string;
  /** Steam App ID if available (for launch button) */
  steamAppId?: number;
  /** Steam launch options */
  steamLaunchOptions?: string;
  /** Whether this game has a setup guide */
  hasSetupGuide?: boolean;
  /** Whether this game has configuration options */
  hasConfiguration?: boolean;
  /** Whether this game requires a mod */
  requiresMod?: boolean;
  /** Tags for filtering */
  tags?: string[];
}

/**
 * Status of a game integration
 */
export interface GameIntegrationStatus {
  running: boolean;
  events_received?: number;
  last_event_ts?: number | null;
  last_event_type?: string | null;
  [key: string]: unknown;
}

/**
 * A game event in the live log
 */
export interface GameEvent {
  id: string;
  type: string;
  ts: number;
  params?: Record<string, unknown>;
}

/**
 * Event display configuration
 */
export interface EventDisplayInfo {
  label: string;
  icon: string;
  color: string;
}

/**
 * Setup guide step
 */
export interface SetupStep {
  title: string;
  description: string | ReactNode;
  downloadUrl?: string;
  downloadLabel?: string;
}

/**
 * Link to an upstream mod or author we built on.
 */
export interface ModCreditLink {
  label: string;
  url: string;
}

/**
 * Mod information
 */
export interface ModInfo {
  name: string;
  downloadUrl: string;
  /** Upstream / original mod repo (also used as the Setup Guide "Original mod" button). */
  githubUrl?: string;
  installInstructions: string[];
  /**
   * Always-visible attribution when our integration is based on someone else's
   * hooks, effects map, or public mod (e.g. floh-bhaptics).
   */
  credits?: {
    summary: string;
    links: ModCreditLink[];
  };
}

/**
 * Props for the game integration page template
 */
export interface GameIntegrationPageProps {
  /** Game configuration */
  game: IntegratedGameConfig;
  
  /** Current status */
  status: GameIntegrationStatus;
  
  /** Is loading */
  loading?: boolean;
  
  /** Error message */
  error?: string | null;
  
  /** Game events for the log */
  events: GameEvent[];
  
  /** Event type to display info mapping */
  eventDisplayMap?: Record<string, EventDisplayInfo>;
  
  /** Start the integration */
  onStart: () => void;
  
  /** Stop the integration */
  onStop: () => void;
  
  /** Clear events */
  onClearEvents: () => void;
  
  /** Format event details for display */
  formatEventDetails?: (event: GameEvent) => string;
  
  /** Setup guide content */
  setupGuide?: ReactNode;
  
  /** Configuration panel content */
  configurationPanel?: ReactNode;
  
  /** Mod information */
  modInfo?: ModInfo;
  
  /** Additional stats to show */
  additionalStats?: ReactNode;

  /** Use full content width (no max-width cap). Useful for screenshot-heavy UIs. */
  wide?: boolean;

  /** Children content */
  children?: ReactNode;
}

/**
 * Storage for Cyberpunk 2077 integration settings.
 */

const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const SETTINGS_FILE = "cyberpunk-settings.json";

/** Defaults: all MVP feedback ON. */
const DEFAULT_ENABLED_EVENTS = {
  gun_fire: true,
  shotgun_fire: true,
  rifle_fire: true,
  smg_fire: true,
  sniper_fire: true,
  player_hit: true,
};

function getSettingsPath() {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

function normalizeEnabledEvents(raw) {
  const merged = { ...DEFAULT_ENABLED_EVENTS };
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof k === "string" && Object.prototype.hasOwnProperty.call(merged, k)) {
        merged[k] = Boolean(v);
      }
    }
  }
  return merged;
}

function loadSettings() {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    }
  } catch (error) {
    console.error("Error loading Cyberpunk settings:", error);
  }
  return {};
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), "utf-8");
  } catch (error) {
    console.error("Error saving Cyberpunk settings:", error);
  }
}

function getCyberpunkSolenoidRecoil() {
  const settings = loadSettings();
  const solenoid =
    settings.solenoidRecoil && typeof settings.solenoidRecoil === "object"
      ? settings.solenoidRecoil
      : {};
  return {
    enabled: solenoid.enabled !== undefined ? Boolean(solenoid.enabled) : true,
    durationMs:
      typeof solenoid.durationMs === "number" && Number.isFinite(solenoid.durationMs)
        ? Math.max(25, Math.min(120, Math.round(solenoid.durationMs)))
        : 40,
  };
}

function getCyberpunkEnabledEvents() {
  const settings = loadSettings();
  return normalizeEnabledEvents(settings.enabledEvents);
}

function setCyberpunkEnabledEvents(enabledEvents) {
  const settings = loadSettings();
  settings.enabledEvents = normalizeEnabledEvents(enabledEvents);
  saveSettings(settings);
  return settings.enabledEvents;
}

function getCyberpunkGameDir() {
  const settings = loadSettings();
  return settings.gameDir || null;
}

function setCyberpunkGameDir(gameDir) {
  const settings = loadSettings();
  settings.gameDir = gameDir;
  saveSettings(settings);
}

function setCyberpunkSolenoidRecoil(solenoidRecoil) {
  const settings = loadSettings();
  const current = getCyberpunkSolenoidRecoil();
  settings.solenoidRecoil = {
    enabled:
      solenoidRecoil && solenoidRecoil.enabled !== undefined
        ? Boolean(solenoidRecoil.enabled)
        : current.enabled,
    durationMs:
      solenoidRecoil && typeof solenoidRecoil.durationMs === "number"
        ? Math.max(25, Math.min(120, Math.round(solenoidRecoil.durationMs)))
        : current.durationMs,
  };
  saveSettings(settings);
  return settings.solenoidRecoil;
}

/** Default true: skip REDlauncher via --launcher-skip (disables My Rewards / cross-saves). */
function getCyberpunkSkipLauncher() {
  const settings = loadSettings();
  return settings.skipLauncher !== undefined ? Boolean(settings.skipLauncher) : true;
}

function setCyberpunkSkipLauncher(skipLauncher) {
  const settings = loadSettings();
  settings.skipLauncher = Boolean(skipLauncher);
  saveSettings(settings);
  return settings.skipLauncher;
}

module.exports = {
  DEFAULT_ENABLED_EVENTS,
  getCyberpunkGameDir,
  setCyberpunkGameDir,
  getCyberpunkSolenoidRecoil,
  setCyberpunkSolenoidRecoil,
  getCyberpunkEnabledEvents,
  setCyberpunkEnabledEvents,
  getCyberpunkSkipLauncher,
  setCyberpunkSkipLauncher,
};

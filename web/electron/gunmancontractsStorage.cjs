/**
 * Storage for Gunman Contracts Standalone integration settings.
 */

const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const SETTINGS_FILE = "gunmancontracts-settings.json";

/** Defaults: all feedback ON (unlike Alyx which is opt-in). */
const DEFAULT_ENABLED_EVENTS = {
  gun_fire: true,
  shotgun_fire: true,
  rifle_fire: true,
  bow_fire: true,
  player_hit: true,
  holster_in: true,
  holster_out: true,
  mag_eject: true,
  reload: true,
  cock_back: true,
  cock_forward: true,
  slide_lock: true,
  slide_release: true,
  ammo_pouch: true,
  heartbeat: true,
  healing: true,
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
    console.error("Error loading Gunman Contracts settings:", error);
  }
  return {};
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), "utf-8");
  } catch (error) {
    console.error("Error saving Gunman Contracts settings:", error);
  }
}

function getGunmanContractsSolenoidRecoil() {
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
    holdOnReload:
      solenoid.holdOnReload !== undefined ? Boolean(solenoid.holdOnReload) : false,
  };
}

function getGunmanContractsEnabledEvents() {
  const settings = loadSettings();
  return normalizeEnabledEvents(settings.enabledEvents);
}

function setGunmanContractsEnabledEvents(enabledEvents) {
  const settings = loadSettings();
  settings.enabledEvents = normalizeEnabledEvents(enabledEvents);
  saveSettings(settings);
  return settings.enabledEvents;
}

function getGunmanContractsGameDir() {
  const settings = loadSettings();
  return settings.gameDir || null;
}

function setGunmanContractsGameDir(gameDir) {
  const settings = loadSettings();
  settings.gameDir = gameDir;
  saveSettings(settings);
}

function setGunmanContractsSolenoidRecoil(solenoidRecoil) {
  const settings = loadSettings();
  const current = getGunmanContractsSolenoidRecoil();
  settings.solenoidRecoil = {
    enabled:
      solenoidRecoil && solenoidRecoil.enabled !== undefined
        ? Boolean(solenoidRecoil.enabled)
        : current.enabled,
    durationMs:
      solenoidRecoil && typeof solenoidRecoil.durationMs === "number"
        ? Math.max(25, Math.min(120, Math.round(solenoidRecoil.durationMs)))
        : current.durationMs,
    holdOnReload:
      solenoidRecoil && solenoidRecoil.holdOnReload !== undefined
        ? Boolean(solenoidRecoil.holdOnReload)
        : current.holdOnReload,
  };
  saveSettings(settings);
  return settings.solenoidRecoil;
}

module.exports = {
  DEFAULT_ENABLED_EVENTS,
  getGunmanContractsGameDir,
  setGunmanContractsGameDir,
  getGunmanContractsSolenoidRecoil,
  setGunmanContractsSolenoidRecoil,
  getGunmanContractsEnabledEvents,
  setGunmanContractsEnabledEvents,
};

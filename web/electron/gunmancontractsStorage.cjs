/**
 * Storage for Gunman Contracts Standalone integration settings.
 */

const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const SETTINGS_FILE = "gunmancontracts-settings.json";

function getSettingsPath() {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
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
  };
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
  };
  saveSettings(settings);
  return settings.solenoidRecoil;
}

module.exports = {
  getGunmanContractsGameDir,
  setGunmanContractsGameDir,
  getGunmanContractsSolenoidRecoil,
  setGunmanContractsSolenoidRecoil,
};

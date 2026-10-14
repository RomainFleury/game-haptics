/**
 * Storage for Titanfall 2 VR integration settings.
 */

const { app } = require("electron");
const fs = require("fs");
const path = require("path");

const SETTINGS_FILE = "titanfall2-settings.json";

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
    console.error("Error loading Titanfall 2 settings:", error);
  }
  return {};
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), "utf-8");
  } catch (error) {
    console.error("Error saving Titanfall 2 settings:", error);
  }
}

function getTitanfall2SolenoidRecoil() {
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

function setTitanfall2SolenoidRecoil(partial) {
  const settings = loadSettings();
  const current = getTitanfall2SolenoidRecoil();
  const next = {
    enabled: partial.enabled !== undefined ? Boolean(partial.enabled) : current.enabled,
    durationMs:
      partial.durationMs !== undefined
        ? Math.max(25, Math.min(120, Math.round(Number(partial.durationMs))))
        : current.durationMs,
  };
  settings.solenoidRecoil = next;
  saveSettings(settings);
  return next;
}

function getTitanfall2GameDir() {
  const settings = loadSettings();
  return typeof settings.gameDir === "string" ? settings.gameDir : "";
}

function setTitanfall2GameDir(gameDir) {
  const settings = loadSettings();
  settings.gameDir = gameDir || "";
  saveSettings(settings);
  return settings.gameDir;
}

module.exports = {
  getTitanfall2SolenoidRecoil,
  setTitanfall2SolenoidRecoil,
  getTitanfall2GameDir,
  setTitanfall2GameDir,
};

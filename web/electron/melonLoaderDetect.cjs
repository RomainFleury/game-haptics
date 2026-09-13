/**
 * Shared MelonLoader detection for Melon-based game integrations.
 * MelonLoader must inject into the game for Mods/*.dll to load.
 */

const path = require("path");
const fs = require("fs");

const MELON_PROXIES = ["version.dll", "winhttp.dll", "winmm.dll", "dinput8.dll"];

/**
 * @param {string} gameDir
 * @returns {{ installed: boolean, hasMelonDir: boolean, hasProxy: boolean, hasDoorstop: boolean }}
 */
function detectMelonLoader(gameDir) {
  if (!gameDir) {
    return { installed: false, hasMelonDir: false, hasProxy: false, hasDoorstop: false };
  }
  const melonDir = path.join(gameDir, "MelonLoader");
  const hasMelonDir = fs.existsSync(melonDir);
  const hasProxy = MELON_PROXIES.some((name) => fs.existsSync(path.join(gameDir, name)));
  const hasDoorstop = fs.existsSync(path.join(gameDir, "doorstop_config.ini"));
  return {
    installed: hasMelonDir || hasProxy || hasDoorstop,
    hasMelonDir,
    hasProxy,
    hasDoorstop,
  };
}

const MELON_MISSING_WARNING =
  "DLL copied, but MelonLoader is not installed in this folder. Mods will not load until you install MelonLoader 0.6+ and launch the game once.";

module.exports = {
  detectMelonLoader,
  MELON_MISSING_WARNING,
};

/**
 * IPC Handlers for Half-Life: Alyx integration.
 */

const { ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { getDaemonBridge } = require("../daemonBridge.cjs");
const { alyxStorage } = require("../alyxStorage.cjs");

const IS_PACKAGED = !process.env.VITE_DEV_SERVER_URL;
const TACTSUIT_LUA = "tactsuit.lua";
const SKILL_MANIFEST_LINE = "script_reload_code tactsuit.lua";

function repoRoot() {
  return path.resolve(__dirname, "..", "..", "..");
}

function getModSourcePath() {
  if (IS_PACKAGED && process.resourcesPath) {
    const bundled = path.join(process.resourcesPath, "mods", "alyx");
    if (fs.existsSync(path.join(bundled, TACTSUIT_LUA))) {
      return bundled;
    }
  }
  return path.join(repoRoot(), "mods", "alyx");
}

function getTactsuitSourcePath() {
  const src = path.join(getModSourcePath(), TACTSUIT_LUA);
  return fs.existsSync(src) ? src : null;
}

/**
 * console.log lives at Half-Life Alyx/game/hlvr/console.log
 * → vscripts: game/hlvr/scripts/vscripts/
 * → skill_manifest: game/hlvr/cfg/skill_manifest.cfg
 */
function resolveHlvrDirFromLogPath(logPath) {
  if (!logPath || typeof logPath !== "string") return null;
  const dir = path.dirname(logPath);
  if (path.basename(dir).toLowerCase() === "hlvr") {
    return dir;
  }
  // Fallback: walk up looking for hlvr
  let cur = dir;
  for (let i = 0; i < 4; i++) {
    if (path.basename(cur).toLowerCase() === "hlvr") return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return dir;
}

function pathsFromLog(logPath) {
  const hlvrDir = resolveHlvrDirFromLogPath(logPath);
  if (!hlvrDir) return null;
  return {
    hlvrDir,
    vscriptsDir: path.join(hlvrDir, "scripts", "vscripts"),
    luaDest: path.join(hlvrDir, "scripts", "vscripts", TACTSUIT_LUA),
    manifestPath: path.join(hlvrDir, "cfg", "skill_manifest.cfg"),
  };
}

function ensureSkillManifest(manifestPath) {
  const defaultBody = [
    "exec skill.cfg",
    "exec skill_episodic.cfg",
    "exec skill_hlvr.cfg",
    "",
    SKILL_MANIFEST_LINE,
    "",
  ].join("\n");

  if (!fs.existsSync(manifestPath)) {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, defaultBody, "utf8");
    return { patched: true, created: true, alreadyPresent: false };
  }

  const content = fs.readFileSync(manifestPath, "utf8");
  if (content.includes(SKILL_MANIFEST_LINE)) {
    return { patched: false, created: false, alreadyPresent: true };
  }

  const bak = `${manifestPath}.tsc.bak`;
  if (!fs.existsSync(bak)) {
    fs.copyFileSync(manifestPath, bak);
  }

  let next = content;
  if (!next.endsWith("\n")) next += "\n";
  next += `\n${SKILL_MANIFEST_LINE}\n`;
  fs.writeFileSync(manifestPath, next, "utf8");
  return { patched: true, created: false, alreadyPresent: false };
}

function installStatus(logPath) {
  const sourceAvailable = Boolean(getTactsuitSourcePath());
  if (!logPath) {
    return {
      installed: false,
      luaInstalled: false,
      skillManifestPatched: false,
      sourceAvailable,
      missingFiles: ["Select console.log first"],
      reason: "Console log path not set",
    };
  }

  const paths = pathsFromLog(logPath);
  if (!paths) {
    return {
      installed: false,
      luaInstalled: false,
      skillManifestPatched: false,
      sourceAvailable,
      missingFiles: ["Could not resolve game/hlvr from log path"],
      logPath,
    };
  }

  const luaInstalled = fs.existsSync(paths.luaDest);
  let skillManifestPatched = false;
  if (fs.existsSync(paths.manifestPath)) {
    const content = fs.readFileSync(paths.manifestPath, "utf8");
    skillManifestPatched = content.includes(SKILL_MANIFEST_LINE);
  }

  const missingFiles = [];
  if (!luaInstalled) missingFiles.push(`scripts/vscripts/${TACTSUIT_LUA}`);
  if (!skillManifestPatched) missingFiles.push(`cfg/skill_manifest.cfg (+ ${SKILL_MANIFEST_LINE})`);

  return {
    installed: luaInstalled && skillManifestPatched,
    luaInstalled,
    skillManifestPatched,
    sourceAvailable,
    missingFiles,
    logPath,
    hlvrDir: paths.hlvrDir,
    luaDest: paths.luaDest,
    manifestPath: paths.manifestPath,
  };
}

function registerAlyxHandlers(getMainWindow) {
  ipcMain.handle("alyx:start", async (_event, logPath) => {
    const daemon = getDaemonBridge();
    const pathToUse = logPath || alyxStorage.getAlyxLogPath();
    const enabledEvents = alyxStorage.getAlyxEnabledEvents();
    const solenoid = alyxStorage.getAlyxSolenoidRecoil();
    return await daemon.alyxStart(pathToUse, {
      enabled_events: enabledEvents,
      solenoid_recoil: {
        enabled: solenoid.enabled,
        duration_ms: solenoid.durationMs,
      },
    });
  });

  ipcMain.handle("alyx:stop", async () => {
    const daemon = getDaemonBridge();
    return await daemon.alyxStop();
  });

  ipcMain.handle("alyx:status", async () => {
    const daemon = getDaemonBridge();
    return await daemon.alyxStatus();
  });

  ipcMain.handle("alyx:getModInfo", async () => {
    const daemon = getDaemonBridge();
    return await daemon.alyxGetModInfo();
  });

  ipcMain.handle("alyx:browseLogPath", async () => {
    try {
      const mainWindow = getMainWindow();
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "Select Half-Life Alyx console.log",
        properties: ["openFile"],
        filters: [
          { name: "Log Files", extensions: ["log"] },
          { name: "All Files", extensions: ["*"] },
        ],
        message:
          "Select console.log under Half-Life Alyx/game/hlvr/ (create it once by launching with -condebug)",
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const selectedPath = result.filePaths[0];
      alyxStorage.setAlyxLogPath(selectedPath);
      return {
        success: true,
        path: selectedPath,
        modStatus: installStatus(selectedPath),
      };
    } catch (error) {
      console.error("Error in alyx:browseLogPath:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("alyx:getSettings", async () => {
    try {
      const logPath = alyxStorage.getAlyxLogPath();
      return {
        success: true,
        logPath,
        enabledEvents: alyxStorage.getAlyxEnabledEvents(),
        solenoidRecoil: alyxStorage.getAlyxSolenoidRecoil(),
        modStatus: installStatus(logPath),
      };
    } catch (error) {
      console.error("Error in alyx:getSettings:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("alyx:setSettings", async (_event, settings) => {
    try {
      alyxStorage.setAlyxSettings(settings);
      return { success: true };
    } catch (error) {
      console.error("Error in alyx:setSettings:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("alyx:setLogPath", async (_event, logPath) => {
    try {
      alyxStorage.setAlyxLogPath(logPath);
      return { success: true, modStatus: installStatus(logPath) };
    } catch (error) {
      console.error("Error in alyx:setLogPath:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("alyx:checkModInstalled", async () => {
    try {
      const logPath = alyxStorage.getAlyxLogPath();
      return { success: true, ...installStatus(logPath) };
    } catch (error) {
      console.error("Error in alyx:checkModInstalled:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("alyx:installMod", async () => {
    try {
      const logPath = alyxStorage.getAlyxLogPath();
      if (!logPath) {
        return {
          success: false,
          error:
            "Select console.log first (Browse under Configuration). Install Mod uses that path to find game/hlvr.",
        };
      }

      const paths = pathsFromLog(logPath);
      if (!paths) {
        return { success: false, error: "Could not resolve game/hlvr from the console.log path." };
      }

      const luaSource = getTactsuitSourcePath();
      if (!luaSource) {
        return {
          success: false,
          error: `${TACTSUIT_LUA} missing from mods/alyx. A release should ship that file.`,
        };
      }

      fs.mkdirSync(paths.vscriptsDir, { recursive: true });
      fs.copyFileSync(luaSource, paths.luaDest);

      const manifest = ensureSkillManifest(paths.manifestPath);
      const status = installStatus(logPath);

      console.log(
        `[alyx] Installed ${TACTSUIT_LUA} → ${paths.luaDest}; skill_manifest ` +
          `${manifest.alreadyPresent ? "already OK" : manifest.created ? "created" : "patched"}`
      );

      return {
        success: true,
        copiedFiles: [`scripts/vscripts/${TACTSUIT_LUA}`],
        skillManifest: manifest,
        destination: paths.hlvrDir,
        ...status,
      };
    } catch (error) {
      console.error("Error in alyx:installMod:", error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registerAlyxHandlers };

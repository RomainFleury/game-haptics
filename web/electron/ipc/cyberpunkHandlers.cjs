/**
 * IPC handlers for Cyberpunk 2077 (RED4ext + redscript TCP forwarder).
 */

const { ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { getDaemonBridge } = require("../daemonBridge.cjs");
const cyberpunkStorage = require("../cyberpunkStorage.cjs");

const PLUGIN_DLL = "TSC_Cyberpunk.dll";
const PLUGIN_REL = path.join("red4ext", "plugins", "TSC_Cyberpunk", PLUGIN_DLL);
/** Display name in redscript error UI = folder under r6/scripts/ */
const SCRIPT_PACKAGE = "TSC Haptics";
const LEGACY_SCRIPT_PACKAGE = "TSC";
const SCRIPT_FILES = ["Natives.reds", "FireHooks.reds", "HitHooks.reds"];
const IS_PACKAGED = !process.env.VITE_DEV_SERVER_URL;

function repoRoot() {
  return path.resolve(__dirname, "..", "..", "..");
}

/**
 * Packaged: resources/mods/cyberpunk/
 * Dev: mods/cyberpunk/ or cyberpunk-mod/package/
 */
function getPackageRoot() {
  if (IS_PACKAGED && process.resourcesPath) {
    const bundled = path.join(process.resourcesPath, "mods", "cyberpunk");
    if (fs.existsSync(path.join(bundled, PLUGIN_REL)) || fs.existsSync(path.join(bundled, "r6"))) {
      return bundled;
    }
  }
  const root = repoRoot();
  const candidates = [
    path.join(root, "mods", "cyberpunk"),
    path.join(root, "cyberpunk-mod", "package"),
  ];
  for (const dir of candidates) {
    if (
      fs.existsSync(path.join(dir, "r6", "scripts", SCRIPT_PACKAGE)) ||
      fs.existsSync(path.join(dir, "r6", "scripts", LEGACY_SCRIPT_PACKAGE))
    ) {
      return dir;
    }
  }
  return path.join(root, "mods", "cyberpunk");
}

function getDllSourcePath() {
  const pkg = getPackageRoot();
  const candidates = [
    path.join(pkg, PLUGIN_REL),
    path.join(pkg, PLUGIN_DLL),
    path.join(repoRoot(), "cyberpunk-mod", "package", PLUGIN_REL),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function detectRed4ext(gameDir) {
  // Our Install Mod creates red4ext/plugins/… — that alone must NOT count as RED4ext.
  // Real loader: proxy DLL in bin/x64 and/or RED4ext.dll under red4ext/.
  return (
    fs.existsSync(path.join(gameDir, "bin", "x64", "winmm.dll")) ||
    fs.existsSync(path.join(gameDir, "bin", "x64", "version.dll")) ||
    fs.existsSync(path.join(gameDir, "red4ext", "RED4ext.dll"))
  );
}

function detectRedscript(gameDir) {
  // Our Install Mod creates r6/scripts/TSC — look for the compiler, not the folder.
  return fs.existsSync(path.join(gameDir, "engine", "tools", "scc.exe"));
}

function scriptsDirFor(gameOrPkgRoot, packageName = SCRIPT_PACKAGE) {
  return path.join(gameOrPkgRoot, "r6", "scripts", packageName);
}

function resolveScriptsDir(root) {
  const preferred = scriptsDirFor(root, SCRIPT_PACKAGE);
  if (SCRIPT_FILES.every((name) => fs.existsSync(path.join(preferred, name)))) {
    return preferred;
  }
  const legacy = scriptsDirFor(root, LEGACY_SCRIPT_PACKAGE);
  if (SCRIPT_FILES.every((name) => fs.existsSync(path.join(legacy, name)))) {
    return legacy;
  }
  return preferred;
}

function installStatus(gameDir) {
  const dllPath = path.join(gameDir, PLUGIN_REL);
  const scriptsDir = resolveScriptsDir(gameDir);
  const dllInstalled = fs.existsSync(dllPath);
  const missingScripts = SCRIPT_FILES.filter(
    (name) => !fs.existsSync(path.join(scriptsDir, name))
  );
  const scriptsInstalled = missingScripts.length === 0;
  const red4extInstalled = detectRed4ext(gameDir);
  const redscriptInstalled = detectRedscript(gameDir);
  return {
    dllInstalled,
    scriptsInstalled,
    red4extInstalled,
    redscriptInstalled,
    installed:
      dllInstalled && scriptsInstalled && red4extInstalled && redscriptInstalled,
    missingFiles: [
      !dllInstalled ? PLUGIN_REL : null,
      ...missingScripts.map(
        (n) => `r6/scripts/${path.basename(scriptsDir)}/${n}`
      ),
      !red4extInstalled ? "RED4ext loader (Nexus: winmm.dll / RED4ext.dll)" : null,
      !redscriptInstalled ? "redscript (Nexus: engine/tools/scc.exe)" : null,
    ].filter(Boolean),
  };
}

function registerCyberpunkHandlers(getMainWindow) {
  ipcMain.handle("cyberpunk:start", async () => {
    const daemon = getDaemonBridge();
    const solenoid = cyberpunkStorage.getCyberpunkSolenoidRecoil();
    const enabledEvents = cyberpunkStorage.getCyberpunkEnabledEvents();
    return await daemon.cyberpunkStart({
      enabled: solenoid.enabled,
      duration_ms: solenoid.durationMs,
      enabled_events: enabledEvents,
    });
  });

  ipcMain.handle("cyberpunk:stop", async () => {
    return await getDaemonBridge().cyberpunkStop();
  });

  ipcMain.handle("cyberpunk:status", async () => {
    return await getDaemonBridge().cyberpunkStatus();
  });

  ipcMain.handle("cyberpunk:getSettings", async () => {
    try {
      return {
        success: true,
        gameDir: cyberpunkStorage.getCyberpunkGameDir(),
        solenoidRecoil: cyberpunkStorage.getCyberpunkSolenoidRecoil(),
        enabledEvents: cyberpunkStorage.getCyberpunkEnabledEvents(),
        skipLauncher: cyberpunkStorage.getCyberpunkSkipLauncher(),
      };
    } catch (error) {
      console.error("Error in cyberpunk:getSettings:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("cyberpunk:setSkipLauncher", async (_, skipLauncher) => {
    try {
      const saved = cyberpunkStorage.setCyberpunkSkipLauncher(Boolean(skipLauncher));
      return { success: true, skipLauncher: saved };
    } catch (error) {
      console.error("Error in cyberpunk:setSkipLauncher:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("cyberpunk:setSolenoidRecoil", async (_, solenoidRecoil) => {
    try {
      const saved = cyberpunkStorage.setCyberpunkSolenoidRecoil(solenoidRecoil || {});
      return { success: true, solenoidRecoil: saved };
    } catch (error) {
      console.error("Error in cyberpunk:setSolenoidRecoil:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("cyberpunk:setEnabledEvents", async (_, enabledEvents) => {
    try {
      const saved = cyberpunkStorage.setCyberpunkEnabledEvents(enabledEvents || {});
      return { success: true, enabledEvents: saved };
    } catch (error) {
      console.error("Error in cyberpunk:setEnabledEvents:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("cyberpunk:browseGameDir", async () => {
    try {
      const win = getMainWindow?.();
      const result = await dialog.showOpenDialog(win || undefined, {
        title: "Select Cyberpunk 2077 folder",
        properties: ["openDirectory"],
      });
      if (result.canceled || !result.filePaths?.length) {
        return { success: true, canceled: true };
      }
      const selectedPath = result.filePaths[0];
      cyberpunkStorage.setCyberpunkGameDir(selectedPath);
      return { success: true, gameDir: selectedPath };
    } catch (error) {
      console.error("Error in cyberpunk:browseGameDir:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("cyberpunk:getGameDir", async () => {
    try {
      return {
        success: true,
        gameDir: cyberpunkStorage.getCyberpunkGameDir(),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("cyberpunk:setGameDir", async (_, gameDir) => {
    try {
      cyberpunkStorage.setCyberpunkGameDir(gameDir || null);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("cyberpunk:checkModInstalled", async () => {
    try {
      const gameDir = cyberpunkStorage.getCyberpunkGameDir();
      if (!gameDir) {
        return { success: true, installed: false, reason: "Game directory not set" };
      }
      const status = installStatus(gameDir);
      return {
        success: true,
        ...status,
        sourceAvailable: Boolean(getDllSourcePath()) || fs.existsSync(path.join(getPackageRoot(), "r6")),
        gameDir,
      };
    } catch (error) {
      console.error("Error in cyberpunk:checkModInstalled:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("cyberpunk:installMod", async () => {
    try {
      const gameDir = cyberpunkStorage.getCyberpunkGameDir();
      if (!gameDir) {
        return {
          success: false,
          error: "Game directory not set. Select your Cyberpunk 2077 folder first.",
        };
      }

      // Install Mod only copies the shipped binary from mods/cyberpunk (or package/).
      // Developers rebuild into that folder with cyberpunk-mod/build.ps1 — never from the UI.
      const dllSource = getDllSourcePath();
      if (!dllSource) {
        return {
          success: false,
          error:
            `${PLUGIN_DLL} is missing from mods/cyberpunk. ` +
            `A release/tag should ship that file. Developers: run cyberpunk-mod\\build.ps1 ` +
            `to refresh mods/cyberpunk, then try Install Mod again.`,
        };
      }

      const pkg = getPackageRoot();
      const scriptsSrcCandidates = [
        path.join(pkg, "r6", "scripts", SCRIPT_PACKAGE),
        path.join(pkg, "r6", "scripts", LEGACY_SCRIPT_PACKAGE),
      ];
      const scriptsSrc = scriptsSrcCandidates.find((dir) => fs.existsSync(dir));
      if (!scriptsSrc) {
        return {
          success: false,
          error: `redscript package missing under mods/cyberpunk/r6/scripts/${SCRIPT_PACKAGE}`,
        };
      }

      const pluginDestDir = path.join(gameDir, "red4ext", "plugins", "TSC_Cyberpunk");
      const scriptsDestDir = scriptsDirFor(gameDir);
      const legacyScriptsDir = path.join(gameDir, "r6", "scripts", LEGACY_SCRIPT_PACKAGE);
      fs.mkdirSync(pluginDestDir, { recursive: true });
      fs.mkdirSync(scriptsDestDir, { recursive: true });
      fs.copyFileSync(dllSource, path.join(pluginDestDir, PLUGIN_DLL));

      // Remove old package name so redscript errors say "TSC Haptics", not "TSC"
      if (fs.existsSync(legacyScriptsDir)) {
        fs.rmSync(legacyScriptsDir, { recursive: true, force: true });
      }

      const copied = [PLUGIN_REL];
      for (const name of SCRIPT_FILES) {
        const src = path.join(scriptsSrc, name);
        if (!fs.existsSync(src)) {
          return { success: false, error: `Missing script: ${name}` };
        }
        fs.copyFileSync(src, path.join(scriptsDestDir, name));
        copied.push(`r6/scripts/${SCRIPT_PACKAGE}/${name}`);
      }

      console.log(`[cyberpunk] Installed into ${gameDir}: ${copied.join(", ")}`);

      const status = installStatus(gameDir);
      let warning;
      if (!status.red4extInstalled || !status.redscriptInstalled) {
        const missing = [
          !status.red4extInstalled ? "RED4ext" : null,
          !status.redscriptInstalled ? "redscript" : null,
        ].filter(Boolean);
        warning =
          `${missing.join(" + ")} not detected in the game folder. ` +
          `Install from Nexus (loader + scc.exe), then relaunch — events will not fire until both are present.`;
      }

      return {
        success: true,
        copiedFiles: copied,
        destination: gameDir,
        warning,
      };
    } catch (error) {
      console.error("Error in cyberpunk:installMod:", error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registerCyberpunkHandlers };

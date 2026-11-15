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
    if (fs.existsSync(path.join(dir, "r6", "scripts", "TSC"))) {
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
  return (
    fs.existsSync(path.join(gameDir, "red4ext")) ||
    fs.existsSync(path.join(gameDir, "bin", "x64", "winmm.dll"))
  );
}

function detectRedscript(gameDir) {
  return (
    fs.existsSync(path.join(gameDir, "engine", "tools", "scc.exe")) ||
    fs.existsSync(path.join(gameDir, "r6", "scripts"))
  );
}

function installStatus(gameDir) {
  const dllPath = path.join(gameDir, PLUGIN_REL);
  const scriptsDir = path.join(gameDir, "r6", "scripts", "TSC");
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
    installed: dllInstalled && scriptsInstalled && red4extInstalled,
    missingFiles: [
      !dllInstalled ? PLUGIN_REL : null,
      ...missingScripts.map((n) => `r6/scripts/TSC/${n}`),
      !red4extInstalled ? "RED4ext (install from Nexus)" : null,
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
      };
    } catch (error) {
      console.error("Error in cyberpunk:getSettings:", error);
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
      const scriptsSrc = path.join(pkg, "r6", "scripts", "TSC");
      if (!fs.existsSync(scriptsSrc)) {
        return {
          success: false,
          error: `redscript package missing at ${scriptsSrc}`,
        };
      }

      const pluginDestDir = path.join(gameDir, "red4ext", "plugins", "TSC_Cyberpunk");
      const scriptsDestDir = path.join(gameDir, "r6", "scripts", "TSC");
      fs.mkdirSync(pluginDestDir, { recursive: true });
      fs.mkdirSync(scriptsDestDir, { recursive: true });
      fs.copyFileSync(dllSource, path.join(pluginDestDir, PLUGIN_DLL));

      const copied = [PLUGIN_REL];
      for (const name of SCRIPT_FILES) {
        const src = path.join(scriptsSrc, name);
        if (!fs.existsSync(src)) {
          return { success: false, error: `Missing script: ${name}` };
        }
        fs.copyFileSync(src, path.join(scriptsDestDir, name));
        copied.push(`r6/scripts/TSC/${name}`);
      }

      console.log(`[cyberpunk] Installed into ${gameDir}: ${copied.join(", ")}`);

      const status = installStatus(gameDir);
      let warning;
      if (!status.red4extInstalled) {
        warning =
          "RED4ext does not look installed. Install RED4ext from Nexus into the game folder, then relaunch.";
      } else if (!status.redscriptInstalled) {
        warning =
          "redscript does not look installed. Install redscript from Nexus so r6/scripts compile.";
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

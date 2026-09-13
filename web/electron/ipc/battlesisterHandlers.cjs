/**
 * IPC handlers for Warhammer 40,000: Battle Sister.
 *
 * Installs ThirdSpace_BattleSister.dll. Do not install BattleSister_bhaptics.dll
 * (NexusMods Tactsuit dump) — that talks to bHaptics Player, not this daemon.
 */

const { ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { getDaemonBridge } = require("../daemonBridge.cjs");
const battlesisterStorage = require("../battlesisterStorage.cjs");
const { detectMelonLoader, MELON_MISSING_WARNING } = require("../melonLoaderDetect.cjs");

const IS_PACKAGED = !process.env.VITE_DEV_SERVER_URL;
const MOD_DLL = "ThirdSpace_BattleSister.dll";

function repoRoot() {
  return path.resolve(__dirname, "..", "..", "..");
}

function getModSourcePath() {
  if (IS_PACKAGED) {
    const bundledPath = path.join(process.resourcesPath, "mods", "battlesister");
    if (fs.existsSync(path.join(bundledPath, MOD_DLL))) {
      return bundledPath;
    }
  }
  const root = repoRoot();
  const candidates = [
    path.join(root, "mods", "battlesister"),
    path.join(root, "battlesister-mod", "ThirdSpace_BattleSister", "bin", "Release"),
    path.join(root, "battlesister-mod", "ThirdSpace_BattleSister", "bin", "Debug"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, MOD_DLL))) return dir;
  }
  return path.join(root, "mods", "battlesister");
}

function modsFolder(gameDir) {
  return path.join(gameDir, "Mods");
}

function tryBuildMod(gameDir) {
  const script = path.join(repoRoot(), "battlesister-mod", "build.ps1");
  if (!fs.existsSync(script)) {
    return { ok: false, error: `Build script not found: ${script}` };
  }
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script];
  if (gameDir) args.push("-GameDir", gameDir);
  const result = spawnSync("powershell.exe", args, {
    encoding: "utf8",
    timeout: 180000,
    windowsHide: true,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  if (result.error) return { ok: false, error: result.error.message, output };
  if (result.status !== 0) {
    return {
      ok: false,
      error: output.split("\n").filter(Boolean).slice(-8).join(" ").slice(0, 800) || `build.ps1 exited ${result.status}`,
      output,
    };
  }
  return { ok: true, output };
}

function registerBattleSisterHandlers(getMainWindow) {
  ipcMain.handle("battlesister:start", async () => {
    const daemon = getDaemonBridge();
    const solenoid = battlesisterStorage.getBattleSisterSolenoidRecoil();
    return await daemon.battlesisterStart({
      enabled: solenoid.enabled,
      duration_ms: solenoid.durationMs,
    });
  });

  ipcMain.handle("battlesister:stop", async () => {
    return await getDaemonBridge().battlesisterStop();
  });

  ipcMain.handle("battlesister:status", async () => {
    return await getDaemonBridge().battlesisterStatus();
  });

  ipcMain.handle("battlesister:getSettings", async () => {
    try {
      return {
        success: true,
        gameDir: battlesisterStorage.getBattleSisterGameDir(),
        solenoidRecoil: battlesisterStorage.getBattleSisterSolenoidRecoil(),
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("battlesister:setSolenoidRecoil", async (_, solenoidRecoil) => {
    try {
      const saved = battlesisterStorage.setBattleSisterSolenoidRecoil(solenoidRecoil || {});
      return { success: true, solenoidRecoil: saved };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("battlesister:browseGameDir", async () => {
    try {
      const result = await dialog.showOpenDialog(getMainWindow(), {
        title: "Select Battle Sister Game Directory",
        properties: ["openDirectory"],
        message: "Select the Battle Sister folder (contains the game exe; MelonLoader creates Mods/ here)",
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      const selectedPath = result.filePaths[0];
      battlesisterStorage.setBattleSisterGameDir(selectedPath);
      return { success: true, gameDir: selectedPath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("battlesister:getGameDir", async () => {
    try {
      return { success: true, gameDir: battlesisterStorage.getBattleSisterGameDir() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("battlesister:setGameDir", async (_, gameDir) => {
    try {
      battlesisterStorage.setBattleSisterGameDir(gameDir || null);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("battlesister:checkModInstalled", async () => {
    try {
      const gameDir = battlesisterStorage.getBattleSisterGameDir();
      if (!gameDir) {
        return { success: true, installed: false, reason: "Game directory not set" };
      }
      const destPath = path.join(modsFolder(gameDir), MOD_DLL);
      const sourcePath = path.join(getModSourcePath(), MOD_DLL);
      const dllInstalled = fs.existsSync(destPath);
      const melon = detectMelonLoader(gameDir);
      return {
        success: true,
        installed: dllInstalled && melon.installed,
        dllInstalled,
        melonLoaderInstalled: melon.installed,
        sourceAvailable: fs.existsSync(sourcePath),
        missingFiles: dllInstalled ? [] : [MOD_DLL],
        gameDir,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("battlesister:installMod", async () => {
    try {
      const gameDir = battlesisterStorage.getBattleSisterGameDir();
      if (!gameDir) {
        return { success: false, error: "Game directory not set. Select your Battle Sister folder first." };
      }
      let sourcePath = path.join(getModSourcePath(), MOD_DLL);
      if (!fs.existsSync(sourcePath)) {
        const built = tryBuildMod(gameDir);
        if (!built.ok) {
          const melonNet6 = path.join(gameDir, "MelonLoader", "net6", "MelonLoader.dll");
          const melonHint = fs.existsSync(melonNet6)
            ? "Install the .NET 6 or 8 SDK, then click Install Mod again."
            : "Install MelonLoader 0.6+ into this Battle Sister folder, then click Install Mod again.";
          return { success: false, error: `Could not build ${MOD_DLL}. ${melonHint} ${built.error}` };
        }
        sourcePath = path.join(getModSourcePath(), MOD_DLL);
      }
      if (!fs.existsSync(sourcePath)) {
        return {
          success: false,
          error:
            `${MOD_DLL} is still missing after the build. Check battlesister-mod/build.ps1. ` +
            `Do not install BattleSister_bhaptics.dll — that NexusMods file talks to bHaptics Player.`,
        };
      }
      const destDir = modsFolder(gameDir);
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(sourcePath, path.join(destDir, MOD_DLL));

      const melon = detectMelonLoader(gameDir);
      if (!melon.installed) {
        return {
          success: true,
          copiedFiles: [MOD_DLL],
          destination: destDir,
          warning: MELON_MISSING_WARNING,
        };
      }

      return { success: true, copiedFiles: [MOD_DLL], destination: destDir };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registerBattleSisterHandlers };

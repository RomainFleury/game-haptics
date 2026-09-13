/**
 * IPC handlers for Gunman Contracts Standalone integration.
 *
 * Installable artifact is ThirdSpace_GunmanContracts.dll (TCP client to daemon 5050).
 * Harmony reference: https://github.com/floh-bhaptics/GunmanContracts_bhaptics
 * Recoil inspiration: https://github.com/Astienth/GunmanContracts_Provolver
 */

const { ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { getDaemonBridge } = require("../daemonBridge.cjs");
const gunmancontractsStorage = require("../gunmancontractsStorage.cjs");

const IS_PACKAGED = !process.env.VITE_DEV_SERVER_URL;
const MOD_DLL = "ThirdSpace_GunmanContracts.dll";

function repoRoot() {
  return path.resolve(__dirname, "..", "..", "..");
}

/**
 * Directory that contains ThirdSpace_GunmanContracts.dll.
 * Packaged app: resources/mods/gunmancontracts/
 * Dev: mods/gunmancontracts/ or a local MSBuild output folder.
 */
function getModSourcePath() {
  if (IS_PACKAGED) {
    const bundledPath = path.join(process.resourcesPath, "mods", "gunmancontracts");
    if (fs.existsSync(path.join(bundledPath, MOD_DLL))) {
      console.log(`[gunmancontracts] Using bundled mod: ${bundledPath}`);
      return bundledPath;
    }
    console.warn(`[gunmancontracts] Bundled ${MOD_DLL} not found at: ${bundledPath}`);
  }

  const root = repoRoot();
  const candidates = [
    path.join(root, "mods", "gunmancontracts"),
    path.join(root, "gunmancontracts-mod", "ThirdSpace_GunmanContracts", "bin", "Release"),
    path.join(root, "gunmancontracts-mod", "ThirdSpace_GunmanContracts", "bin", "Debug"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, MOD_DLL))) {
      console.log(`[gunmancontracts] Using mod source: ${dir}`);
      return dir;
    }
  }
  return path.join(root, "mods", "gunmancontracts");
}

function modsFolder(gameDir) {
  return path.join(gameDir, "Mods");
}

function tryBuildMod(gameDir) {
  const script = path.join(repoRoot(), "gunmancontracts-mod", "build.ps1");
  if (!fs.existsSync(script)) {
    return { ok: false, error: `Build script not found: ${script}` };
  }
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script];
  if (gameDir) {
    args.push("-GameDir", gameDir);
  }
  const result = spawnSync("powershell.exe", args, {
    encoding: "utf8",
    timeout: 180000,
    windowsHide: true,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  if (result.error) {
    return { ok: false, error: result.error.message, output };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      error: output.split("\n").filter(Boolean).slice(-8).join(" ").slice(0, 800) || `build.ps1 exited ${result.status}`,
      output,
    };
  }
  return { ok: true, output };
}

function registerGunmanContractsHandlers(getMainWindow) {
  ipcMain.handle("gunmancontracts:start", async () => {
    const daemon = getDaemonBridge();
    const solenoid = gunmancontractsStorage.getGunmanContractsSolenoidRecoil();
    return await daemon.gunmancontractsStart({
      enabled: solenoid.enabled,
      duration_ms: solenoid.durationMs,
    });
  });

  ipcMain.handle("gunmancontracts:stop", async () => {
    return await getDaemonBridge().gunmancontractsStop();
  });

  ipcMain.handle("gunmancontracts:status", async () => {
    return await getDaemonBridge().gunmancontractsStatus();
  });

  ipcMain.handle("gunmancontracts:getSettings", async () => {
    try {
      return {
        success: true,
        gameDir: gunmancontractsStorage.getGunmanContractsGameDir(),
        solenoidRecoil: gunmancontractsStorage.getGunmanContractsSolenoidRecoil(),
      };
    } catch (error) {
      console.error("Error in gunmancontracts:getSettings:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("gunmancontracts:setSolenoidRecoil", async (_, solenoidRecoil) => {
    try {
      const saved = gunmancontractsStorage.setGunmanContractsSolenoidRecoil(solenoidRecoil || {});
      return { success: true, solenoidRecoil: saved };
    } catch (error) {
      console.error("Error in gunmancontracts:setSolenoidRecoil:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("gunmancontracts:browseGameDir", async () => {
    try {
      const mainWindow = getMainWindow();
      const result = await dialog.showOpenDialog(mainWindow, {
        title: "Select Gunman Contracts Game Directory",
        properties: ["openDirectory"],
        message:
          "Select the Gunman Contracts Standalone folder (MelonLoader creates Mods/ here after first launch)",
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const selectedPath = result.filePaths[0];
      gunmancontractsStorage.setGunmanContractsGameDir(selectedPath);
      return { success: true, gameDir: selectedPath };
    } catch (error) {
      console.error("Error in gunmancontracts:browseGameDir:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("gunmancontracts:getGameDir", async () => {
    try {
      return {
        success: true,
        gameDir: gunmancontractsStorage.getGunmanContractsGameDir(),
      };
    } catch (error) {
      console.error("Error in gunmancontracts:getGameDir:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("gunmancontracts:setGameDir", async (_, gameDir) => {
    try {
      gunmancontractsStorage.setGunmanContractsGameDir(gameDir || null);
      return { success: true };
    } catch (error) {
      console.error("Error in gunmancontracts:setGameDir:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("gunmancontracts:checkModInstalled", async () => {
    try {
      const gameDir = gunmancontractsStorage.getGunmanContractsGameDir();
      if (!gameDir) {
        return { success: true, installed: false, reason: "Game directory not set" };
      }

      const destPath = path.join(modsFolder(gameDir), MOD_DLL);
      const sourceDir = getModSourcePath();
      const sourcePath = path.join(sourceDir, MOD_DLL);
      return {
        success: true,
        installed: fs.existsSync(destPath),
        sourceAvailable: fs.existsSync(sourcePath),
        missingFiles: fs.existsSync(destPath) ? [] : [MOD_DLL],
        gameDir,
      };
    } catch (error) {
      console.error("Error in gunmancontracts:checkModInstalled:", error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("gunmancontracts:installMod", async () => {
    try {
      const gameDir = gunmancontractsStorage.getGunmanContractsGameDir();
      if (!gameDir) {
        return {
          success: false,
          error: "Game directory not set. Select your Gunman Contracts folder first.",
        };
      }

      const sourceDir = getModSourcePath();
      let sourcePath = path.join(sourceDir, MOD_DLL);
      if (!fs.existsSync(sourcePath)) {
        const built = tryBuildMod(gameDir);
        if (!built.ok) {
          const melonNet6 = path.join(gameDir, "MelonLoader", "net6", "MelonLoader.dll");
          const melonHint = fs.existsSync(melonNet6)
            ? "Install the .NET 6 or 8 SDK, then click Install Mod again."
            : "Install MelonLoader 0.6+ into this Gunman Contracts folder, launch the game once, then click Install Mod again.";
          return {
            success: false,
            error: `Could not build ${MOD_DLL}. ${melonHint} ${built.error}`,
          };
        }
        sourcePath = path.join(getModSourcePath(), MOD_DLL);
      }
      if (!fs.existsSync(sourcePath)) {
        return {
          success: false,
          error:
            `${MOD_DLL} is still missing after the build. Check gunmancontracts-mod/build.ps1. ` +
            `Do not install GunmanContracts_bhaptics.dll — that file talks to bHaptics Player, not this daemon.`,
        };
      }

      const destDir = modsFolder(gameDir);
      fs.mkdirSync(destDir, { recursive: true });
      const destPath = path.join(destDir, MOD_DLL);
      fs.copyFileSync(sourcePath, destPath);
      console.log(`[gunmancontracts] Copied ${MOD_DLL} -> ${destPath}`);

      return {
        success: true,
        copiedFiles: [MOD_DLL],
        destination: destDir,
      };
    } catch (error) {
      console.error("Error in gunmancontracts:installMod:", error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registerGunmanContractsHandlers };

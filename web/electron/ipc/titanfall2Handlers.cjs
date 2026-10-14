/**
 * IPC handlers for Titanfall 2 integration (flat Northstar + CircuitLord VR).
 *
 * Northstar plugin: titanfall2-mod/ThirdSpace_Titanfall2
 * Event hooks adapted from https://github.com/floh-bhaptics/Titanfall2VR_bhaptics
 *
 * Install copies the same DLL + mod into every detected Northstar profile
 * (TF2VR for VR, R2Northstar for flat, plus other profile folders).
 */

const { ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { getDaemonBridge } = require("../daemonBridge.cjs");
const titanfall2Storage = require("../titanfall2Storage.cjs");

const PLUGIN_DLL = "ThirdSpace_Titanfall2.dll";
const MOD_FOLDER = "ThirdSpace_Titanfall2";
const KNOWN_PROFILES = ["TF2VR", "R2Northstar"];

function repoRoot() {
  return path.resolve(__dirname, "..", "..", "..");
}

function getBuiltDllPath() {
  const root = repoRoot();
  const candidates = [
    path.join(root, "titanfall2-mod", "bin", "x64", "Release", PLUGIN_DLL),
    path.join(root, "titanfall2-mod", "bin", "x64", "Debug", PLUGIN_DLL),
    path.join(root, "mods", "titanfall2", PLUGIN_DLL),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function getModSourceDir() {
  const dir = path.join(repoRoot(), "titanfall2-mod", "ThirdSpace_Titanfall2", "mod", MOD_FOLDER);
  return fs.existsSync(path.join(dir, "mod.json")) ? dir : null;
}

function looksLikeNorthstarProfile(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  try {
    const st = fs.statSync(dir);
    if (!st.isDirectory()) return false;
  } catch {
    return false;
  }
  return (
    fs.existsSync(path.join(dir, "Northstar.dll")) ||
    fs.existsSync(path.join(dir, "plugins")) ||
    fs.existsSync(path.join(dir, "mods"))
  );
}

function profileKind(name) {
  const lower = String(name || "").toLowerCase();
  if (lower === "tf2vr") return "vr";
  if (lower === "r2northstar") return "flat";
  return "other";
}

/**
 * Resolve the Titanfall 2 game root from a browse path that may be the game
 * folder or a Northstar profile (TF2VR / R2Northstar).
 */
function resolveGameRoot(gameDir) {
  if (!gameDir) return null;
  const base = path.basename(gameDir).toLowerCase();
  if (KNOWN_PROFILES.map((n) => n.toLowerCase()).includes(base)) {
    return path.dirname(gameDir);
  }
  if (looksLikeNorthstarProfile(gameDir) && fs.existsSync(path.join(path.dirname(gameDir), "Titanfall2.exe"))) {
    return path.dirname(gameDir);
  }
  return gameDir;
}

/**
 * @returns {{ name: string, dir: string, kind: "vr" | "flat" | "other" }[]}
 */
function findNorthstarProfiles(gameDir) {
  const root = resolveGameRoot(gameDir);
  if (!root || !fs.existsSync(root)) return [];

  const found = new Map();

  const add = (name, dir) => {
    if (!looksLikeNorthstarProfile(dir)) return;
    const key = path.resolve(dir).toLowerCase();
    if (found.has(key)) return;
    found.set(key, { name, dir: path.resolve(dir), kind: profileKind(name) });
  };

  for (const name of KNOWN_PROFILES) {
    add(name, path.join(root, name));
  }

  // Selected path is itself a profile
  const selectedBase = path.basename(gameDir || "").toLowerCase();
  if (gameDir && looksLikeNorthstarProfile(gameDir)) {
    const name = KNOWN_PROFILES.find((n) => n.toLowerCase() === selectedBase) || path.basename(gameDir);
    add(name, gameDir);
  }

  // Any sibling profile folder next to NorthstarLauncher.exe
  try {
    if (fs.existsSync(path.join(root, "NorthstarLauncher.exe"))) {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".")) continue;
        add(entry.name, path.join(root, entry.name));
      }
    }
  } catch {
    // ignore unreadable game dirs
  }

  return [...found.values()].sort((a, b) => {
    const order = { vr: 0, flat: 1, other: 2 };
    return (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.name.localeCompare(b.name);
  });
}

function profileInstallStatus(profileDir) {
  const dllPath = path.join(profileDir, "plugins", PLUGIN_DLL);
  const modJson = path.join(profileDir, "mods", MOD_FOLDER, "mod.json");
  const dllInstalled = fs.existsSync(dllPath);
  const modInstalled = fs.existsSync(modJson);
  return {
    dllInstalled,
    modInstalled,
    installed: dllInstalled && modInstalled,
    missingFiles: [
      !dllInstalled ? PLUGIN_DLL : null,
      !modInstalled ? `mods/${MOD_FOLDER}/mod.json` : null,
    ].filter(Boolean),
  };
}

function installIntoProfile(profileDir, sourceDll, sourceMod) {
  const pluginsDir = path.join(profileDir, "plugins");
  const modsDir = path.join(profileDir, "mods", MOD_FOLDER);
  fs.mkdirSync(pluginsDir, { recursive: true });
  fs.mkdirSync(modsDir, { recursive: true });
  fs.copyFileSync(sourceDll, path.join(pluginsDir, PLUGIN_DLL));
  fs.cpSync(sourceMod, modsDir, { recursive: true });
  return {
    plugins: path.join(pluginsDir, PLUGIN_DLL),
    mods: modsDir,
  };
}

function registerTitanfall2Handlers(getMainWindow) {
  ipcMain.handle("titanfall2:start", async () => {
    const daemon = getDaemonBridge();
    const solenoid = titanfall2Storage.getTitanfall2SolenoidRecoil();
    return await daemon.titanfall2Start({
      enabled: solenoid.enabled,
      duration_ms: solenoid.durationMs,
    });
  });

  ipcMain.handle("titanfall2:stop", async () => {
    return await getDaemonBridge().titanfall2Stop();
  });

  ipcMain.handle("titanfall2:status", async () => {
    return await getDaemonBridge().titanfall2Status();
  });

  ipcMain.handle("titanfall2:getSettings", async () => {
    return {
      success: true,
      gameDir: titanfall2Storage.getTitanfall2GameDir() || null,
      solenoidRecoil: {
        enabled: titanfall2Storage.getTitanfall2SolenoidRecoil().enabled,
        durationMs: titanfall2Storage.getTitanfall2SolenoidRecoil().durationMs,
      },
    };
  });

  ipcMain.handle("titanfall2:setSolenoidRecoil", async (_event, solenoidRecoil) => {
    const next = titanfall2Storage.setTitanfall2SolenoidRecoil(solenoidRecoil || {});
    return {
      success: true,
      solenoidRecoil: { enabled: next.enabled, durationMs: next.durationMs },
    };
  });

  ipcMain.handle("titanfall2:browseGameDir", async () => {
    const win = getMainWindow?.();
    const result = await dialog.showOpenDialog(win || undefined, {
      title: "Select Titanfall 2 game folder (installs into TF2VR + R2Northstar)",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths?.[0]) {
      return { success: false, canceled: true };
    }
    const gameDir = result.filePaths[0];
    titanfall2Storage.setTitanfall2GameDir(gameDir);
    return { success: true, gameDir };
  });

  ipcMain.handle("titanfall2:getGameDir", async () => {
    return { success: true, gameDir: titanfall2Storage.getTitanfall2GameDir() || null };
  });

  ipcMain.handle("titanfall2:setGameDir", async (_event, gameDir) => {
    titanfall2Storage.setTitanfall2GameDir(gameDir || "");
    return { success: true };
  });

  ipcMain.handle("titanfall2:checkModInstalled", async () => {
    const gameDir = titanfall2Storage.getTitanfall2GameDir();
    const profiles = findNorthstarProfiles(gameDir).map((p) => ({
      ...p,
      ...profileInstallStatus(p.dir),
    }));
    const sourceDll = getBuiltDllPath();
    const sourceMod = getModSourceDir();
    const anyInstalled = profiles.some((p) => p.installed);
    const allInstalled = profiles.length > 0 && profiles.every((p) => p.installed);
    const missingFiles = profiles.flatMap((p) =>
      (p.missingFiles || []).map((f) => `${p.name}/${f}`)
    );

    return {
      success: true,
      installed: anyInstalled,
      allProfilesInstalled: allInstalled,
      dllInstalled: profiles.some((p) => p.dllInstalled),
      modInstalled: profiles.some((p) => p.modInstalled),
      sourceAvailable: Boolean(sourceDll && sourceMod),
      gameDir: gameDir || undefined,
      gameRoot: resolveGameRoot(gameDir) || undefined,
      profiles,
      // Back-compat for older UI fields
      tf2vrDir: profiles.find((p) => p.kind === "vr")?.dir,
      missingFiles,
    };
  });

  ipcMain.handle("titanfall2:installMod", async () => {
    const gameDir = titanfall2Storage.getTitanfall2GameDir();
    const profiles = findNorthstarProfiles(gameDir);
    if (!profiles.length) {
      return {
        success: false,
        error:
          "No Northstar profile found. Select the Titanfall 2 folder (with TF2VR and/or R2Northstar), or install CircuitLord VR / Northstar first.",
      };
    }
    const sourceDll = getBuiltDllPath();
    const sourceMod = getModSourceDir();
    if (!sourceDll) {
      return {
        success: false,
        error: `Build ${PLUGIN_DLL} first (see titanfall2-mod/README.md)`,
      };
    }
    if (!sourceMod) {
      return { success: false, error: "Mod source folder not found in the repo" };
    }

    const installed = [];
    const errors = [];
    for (const profile of profiles) {
      try {
        installIntoProfile(profile.dir, sourceDll, sourceMod);
        installed.push({
          name: profile.name,
          kind: profile.kind,
          dir: profile.dir,
        });
      } catch (error) {
        errors.push(`${profile.name}: ${error.message || String(error)}`);
      }
    }

    if (!installed.length) {
      return { success: false, error: errors.join("; ") || "Install failed" };
    }

    return {
      success: true,
      destination: installed.map((p) => p.dir).join("; "),
      destinations: installed,
      copiedFiles: [PLUGIN_DLL, `mods/${MOD_FOLDER}`],
      profilesInstalled: installed.map((p) => p.name),
      warning: errors.length ? `Partial install: ${errors.join("; ")}` : undefined,
    };
  });

  ipcMain.handle("titanfall2:openDocs", async () => {
    const doc = path.join(repoRoot(), "docs-external-integrations-ideas", "TITANFALL2_INTEGRATION.md");
    if (fs.existsSync(doc)) {
      await shell.openPath(doc);
      return { success: true };
    }
    return { success: false, error: "Docs not found" };
  });
}

module.exports = {
  registerTitanfall2Handlers,
  findNorthstarProfiles,
  resolveGameRoot,
};

/**
 * IPC handlers for bundled game mods.
 * 
 * These handlers allow the UI to:
 * - Check which mods are bundled with the app
 * - Save/download mod files to user-selected locations
 * - Get mod info (version, readme, etc.)
 */

const { ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");

// Detect if we're running in production (packaged) mode
const IS_PACKAGED = !process.env.VITE_DEV_SERVER_URL;

/**
 * Get the base path for bundled mods.
 * In production: resources/mods/
 * In development: /workspace/mods/
 */
function getModsBasePath() {
  if (IS_PACKAGED) {
    return path.join(process.resourcesPath, "mods");
  }
  // Development: use project mods directory
  return path.resolve(__dirname, "..", "..", "..", "mods");
}

/**
 * Mod configuration - maps mod IDs to their files and metadata.
 */
const MOD_CONFIG = {
  "l4d2": {
    name: "Left 4 Dead 2",
    directory: "l4d2",
    files: ["coop.nut", "thirdspacevest_haptics.nut"],
    targetFolder: "scripts/vscripts",
    description: "VScript mod for Left 4 Dead 2 haptic feedback",
  },
  "alyx": {
    name: "Half-Life: Alyx",
    directory: "alyx",
    files: [], // External mod - no bundled files
    externalUrl: "https://www.nexusmods.com/halflifealyx/mods/6",
    description: "Lua scripts from NexusMods for Half-Life: Alyx",
  },
  "pistolwhip": {
    name: "Pistol Whip",
    directory: "pistolwhip",
    files: ["ThirdSpace_PistolWhip.dll"],
    targetFolder: "Mods",
    description: "MelonLoader TCP client for Pistol Whip haptic feedback",
  },
  "battlesister": {
    name: "Warhammer 40,000: Battle Sister",
    directory: "battlesister",
    files: ["ThirdSpace_BattleSister.dll"],
    targetFolder: "Mods",
    description: "MelonLoader TCP client for Battle Sister haptic feedback",
  },
  "gunmancontracts": {
    name: "Gunman Contracts Standalone",
    directory: "gunmancontracts",
    files: ["ThirdSpace_GunmanContracts.dll"],
    targetFolder: "Mods",
    description: "MelonLoader TCP client for Gunman Contracts haptic feedback",
  },
};

function registerModsHandlers(getMainWindow) {
  /**
   * Get list of all available mods and their status.
   */
  ipcMain.handle("mods:list", async () => {
    try {
      const modsPath = getModsBasePath();
      const mods = [];

      for (const [modId, config] of Object.entries(MOD_CONFIG)) {
        const modPath = path.join(modsPath, config.directory);
        const filesExist = config.files.length > 0 && config.files.every(file => 
          fs.existsSync(path.join(modPath, file))
        );

        mods.push({
          id: modId,
          name: config.name,
          description: config.description,
          bundled: filesExist,
          files: config.files,
          targetFolder: config.targetFolder,
          externalUrl: config.externalUrl || null,
        });
      }

      return { success: true, mods };
    } catch (error) {
      console.error("Error in mods:list:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Check if a specific mod's files are bundled.
   */
  ipcMain.handle("mods:checkBundled", async (_, modId) => {
    try {
      const config = MOD_CONFIG[modId];
      if (!config) {
        return { success: false, error: `Unknown mod: ${modId}` };
      }

      if (config.files.length === 0) {
        return { success: true, bundled: false, reason: "External mod" };
      }

      const modsPath = getModsBasePath();
      const modPath = path.join(modsPath, config.directory);
      
      const fileStatuses = {};
      let allExist = true;
      
      for (const file of config.files) {
        const filePath = path.join(modPath, file);
        const exists = fs.existsSync(filePath);
        fileStatuses[file] = exists;
        if (!exists) allExist = false;
      }

      return {
        success: true,
        bundled: allExist,
        files: fileStatuses,
        modPath,
      };
    } catch (error) {
      console.error("Error in mods:checkBundled:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Save bundled mod file(s) to a user-selected location.
   */
  ipcMain.handle("mods:saveToFolder", async (_, modId) => {
    try {
      const config = MOD_CONFIG[modId];
      if (!config) {
        return { success: false, error: `Unknown mod: ${modId}` };
      }

      if (config.files.length === 0) {
        return { success: false, error: "This mod has no bundled files" };
      }

      const mainWindow = getMainWindow();
      const modsPath = getModsBasePath();
      const modPath = path.join(modsPath, config.directory);

      // Let user select destination folder
      const result = await dialog.showOpenDialog(mainWindow, {
        title: `Select destination for ${config.name} mod files`,
        properties: ["openDirectory", "createDirectory"],
        message: `Select the ${config.targetFolder} folder in your game installation`,
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const destFolder = result.filePaths[0];
      const copiedFiles = [];
      const errors = [];

      for (const file of config.files) {
        const srcPath = path.join(modPath, file);
        const destPath = path.join(destFolder, file);

        if (!fs.existsSync(srcPath)) {
          errors.push(`Source file not found: ${file}`);
          continue;
        }

        try {
          fs.copyFileSync(srcPath, destPath);
          copiedFiles.push(file);
          console.log(`[mods] Copied: ${file} -> ${destPath}`);
        } catch (err) {
          errors.push(`Failed to copy ${file}: ${err.message}`);
        }
      }

      return {
        success: copiedFiles.length > 0,
        copiedFiles,
        destination: destFolder,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      console.error("Error in mods:saveToFolder:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Download a single mod file to user's Downloads folder.
   */
  ipcMain.handle("mods:downloadFile", async (_, modId, fileName) => {
    try {
      const config = MOD_CONFIG[modId];
      if (!config) {
        return { success: false, error: `Unknown mod: ${modId}` };
      }

      if (!config.files.includes(fileName)) {
        return { success: false, error: `File not part of mod: ${fileName}` };
      }

      const mainWindow = getMainWindow();
      const modsPath = getModsBasePath();
      const srcPath = path.join(modsPath, config.directory, fileName);

      if (!fs.existsSync(srcPath)) {
        return { success: false, error: `Bundled file not found: ${fileName}` };
      }

      // Let user choose where to save
      const result = await dialog.showSaveDialog(mainWindow, {
        title: `Save ${fileName}`,
        defaultPath: fileName,
        filters: [
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }

      fs.copyFileSync(srcPath, result.filePath);
      console.log(`[mods] Saved: ${fileName} -> ${result.filePath}`);

      return {
        success: true,
        savedTo: result.filePath,
      };
    } catch (error) {
      console.error("Error in mods:downloadFile:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Open the mods folder in file explorer.
   */
  ipcMain.handle("mods:openFolder", async (_, modId) => {
    try {
      const modsPath = getModsBasePath();
      let folderPath = modsPath;

      if (modId) {
        const config = MOD_CONFIG[modId];
        if (config) {
          folderPath = path.join(modsPath, config.directory);
        }
      }

      if (fs.existsSync(folderPath)) {
        shell.openPath(folderPath);
        return { success: true, path: folderPath };
      } else {
        return { success: false, error: "Folder not found" };
      }
    } catch (error) {
      console.error("Error in mods:openFolder:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * Get README content for a mod.
   */
  ipcMain.handle("mods:getReadme", async (_, modId) => {
    try {
      const config = MOD_CONFIG[modId];
      if (!config) {
        return { success: false, error: `Unknown mod: ${modId}` };
      }

      const modsPath = getModsBasePath();
      const readmePath = path.join(modsPath, config.directory, "README.md");

      if (!fs.existsSync(readmePath)) {
        return { success: true, content: null };
      }

      const content = fs.readFileSync(readmePath, "utf-8");
      return { success: true, content };
    } catch (error) {
      console.error("Error in mods:getReadme:", error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registerModsHandlers };

/**
 * IPC: Recoil Link UF2 flash (dongle + receiver).
 */

const { ipcMain } = require("electron");
const {
  listFirmwareImages,
  listUf2Targets,
  listEmitterSerialHints,
  firmwareSearchRoots,
  flashUf2,
} = require("../recoilFirmware.cjs");

function registerRecoilFirmwareHandlers() {
  ipcMain.handle("recoilFirmware:listImages", async () => {
    try {
      const images = listFirmwareImages();
      return {
        success: true,
        images,
        searchRoots: firmwareSearchRoots(),
      };
    } catch (error) {
      return { success: false, images: [], error: error.message };
    }
  });

  ipcMain.handle("recoilFirmware:listTargets", async () => {
    try {
      const [targets, serialHints] = await Promise.all([
        listUf2Targets(),
        listEmitterSerialHints(),
      ]);
      return { success: true, targets, serialHints };
    } catch (error) {
      return { success: false, targets: [], serialHints: [], error: error.message };
    }
  });

  ipcMain.handle("recoilFirmware:flash", async (_event, payload) => {
    try {
      return await flashUf2({
        targetPath: payload?.targetPath,
        role: payload?.role,
        imagePath: payload?.imagePath,
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  registerRecoilFirmwareHandlers,
};

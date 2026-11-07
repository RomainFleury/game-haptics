/**
 * IPC: Recoil Link firmware flash.
 * - Emitter (PCA10059): Nordic Open DFU via nrfutil device program
 * - Receiver (Nice!Nano): UF2 volume copy
 */

const { ipcMain } = require("electron");
const {
  listFirmwareImages,
  listUf2Targets,
  listEmitterSerialHints,
  firmwareSearchRoots,
  flashUf2,
  flashOpenDfu,
  resolveDongleDfuPackage,
} = require("../recoilFirmware.cjs");

function registerRecoilFirmwareHandlers() {
  ipcMain.handle("recoilFirmware:listImages", async () => {
    try {
      const images = listFirmwareImages();
      const donglePkg = resolveDongleDfuPackage();
      return {
        success: true,
        images,
        searchRoots: firmwareSearchRoots(),
        donglePackage: donglePkg
          ? { path: donglePkg.path, bytes: donglePkg.bytes, source: donglePkg.source }
          : null,
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
      const role = payload?.role;
      // PCA10059 emitter: Open DFU zip (never UF2 disk)
      if (role === "dongle") {
        return await flashOpenDfu({ imagePath: payload?.imagePath });
      }
      return await flashUf2({
        targetPath: payload?.targetPath,
        role,
        imagePath: payload?.imagePath,
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("recoilFirmware:flashEmitter", async (_event, payload) => {
    try {
      return await flashOpenDfu({ imagePath: payload?.imagePath });
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
}

module.exports = {
  registerRecoilFirmwareHandlers,
};

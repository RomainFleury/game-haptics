/**
 * IPC Handlers for USB LC relay / solenoid recoil testing.
 */

const { ipcMain } = require("electron");
const { getDaemonBridge } = require("../daemonBridge.cjs");

function registerRelayHandlers() {
  ipcMain.handle("relay:listPorts", async () => {
    const daemon = getDaemonBridge();
    return await daemon.relayListPorts();
  });

  ipcMain.handle("relay:connect", async (_event, port, baud, switchAddress) => {
    const daemon = getDaemonBridge();
    return await daemon.relayConnect(port, baud, switchAddress);
  });

  ipcMain.handle("relay:disconnect", async () => {
    const daemon = getDaemonBridge();
    return await daemon.relayDisconnect();
  });

  ipcMain.handle("relay:status", async () => {
    const daemon = getDaemonBridge();
    return await daemon.relayStatus();
  });

  ipcMain.handle("relay:set", async (_event, on) => {
    const daemon = getDaemonBridge();
    return await daemon.relaySet(on);
  });

  ipcMain.handle("relay:pulse", async (_event, durationMs) => {
    const daemon = getDaemonBridge();
    return await daemon.relayPulse(durationMs);
  });

  ipcMain.handle("relay:mouseStart", async (_event, options) => {
    const daemon = getDaemonBridge();
    return await daemon.relayMouseStart(options || {});
  });

  ipcMain.handle("relay:mouseStop", async () => {
    const daemon = getDaemonBridge();
    return await daemon.relayMouseStop();
  });

  ipcMain.handle("relay:mouseStatus", async () => {
    const daemon = getDaemonBridge();
    return await daemon.relayMouseStatus();
  });

  ipcMain.handle("recoil:listPorts", async () => {
    const daemon = getDaemonBridge();
    return await daemon.recoilListPorts();
  });

  ipcMain.handle("recoil:connect", async (_event, port) => {
    const daemon = getDaemonBridge();
    return await daemon.recoilConnect(port);
  });

  ipcMain.handle("recoil:disconnect", async () => {
    const daemon = getDaemonBridge();
    return await daemon.recoilDisconnect();
  });

  ipcMain.handle("recoil:status", async () => {
    const daemon = getDaemonBridge();
    return await daemon.recoilStatus();
  });

  ipcMain.handle("recoil:pulse", async (_event, durationMs) => {
    const daemon = getDaemonBridge();
    return await daemon.recoilPulse(durationMs);
  });
}

module.exports = {
  registerRelayHandlers,
};

const { contextBridge, ipcRenderer } = require("electron");

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("vestBridge", {
  // Existing API
  ping: () => ipcRenderer.invoke("vest:ping"),
  getStatus: () => ipcRenderer.invoke("vest:status"),
  getEffects: () => ipcRenderer.invoke("vest:effects"),
  triggerEffect: (effect) => ipcRenderer.invoke("vest:trigger", effect),
  stopAll: (deviceId) => ipcRenderer.invoke("vest:stop", deviceId),
  listDevices: () => ipcRenderer.invoke("vest:listDevices"),
  connectToDevice: (deviceInfo) =>
    ipcRenderer.invoke("vest:connectToDevice", deviceInfo),
  getDevicePreference: () => ipcRenderer.invoke("vest:getDevicePreference"),
  saveDevicePreference: (deviceInfo) =>
    ipcRenderer.invoke("vest:saveDevicePreference", deviceInfo),
  clearDevicePreference: () => ipcRenderer.invoke("vest:clearDevicePreference"),

  // New daemon-related API
  getDaemonStatus: () => ipcRenderer.invoke("vest:getDaemonStatus"),
  reconnectDaemon: () => ipcRenderer.invoke("vest:reconnectDaemon"),

  // Event subscription
  onDaemonEvent: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("vest:event", handler);
    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener("vest:event", handler);
    };
  },

  onDaemonStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("vest:daemon-status", handler);
    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener("vest:daemon-status", handler);
    };
  },

  // CS2 GSI Integration API
  cs2Start: (gsiPort) => ipcRenderer.invoke("cs2:start", gsiPort),
  cs2Stop: () => ipcRenderer.invoke("cs2:stop"),
  cs2Status: () => ipcRenderer.invoke("cs2:status"),
  cs2GenerateConfig: (gsiPort) => ipcRenderer.invoke("cs2:generateConfig", gsiPort),

  // CS2 Config Path Management
  cs2GetConfigPath: () => ipcRenderer.invoke("cs2:getConfigPath"),
  cs2SetConfigPath: (configPath) => ipcRenderer.invoke("cs2:setConfigPath", configPath),
  cs2AutoDetectPath: () => ipcRenderer.invoke("cs2:autoDetectPath"),
  cs2BrowseConfigPath: () => ipcRenderer.invoke("cs2:browseConfigPath"),
  cs2SaveConfigToCS2: (gsiPort) => ipcRenderer.invoke("cs2:saveConfigToCS2", gsiPort),

  // Half-Life: Alyx Integration API
  alyxStart: (logPath) => ipcRenderer.invoke("alyx:start", logPath),
  alyxStop: () => ipcRenderer.invoke("alyx:stop"),
  alyxStatus: () => ipcRenderer.invoke("alyx:status"),
  alyxGetModInfo: () => ipcRenderer.invoke("alyx:getModInfo"),
  alyxBrowseLogPath: () => ipcRenderer.invoke("alyx:browseLogPath"),
  alyxGetSettings: () => ipcRenderer.invoke("alyx:getSettings"),
  alyxSetSettings: (settings) => ipcRenderer.invoke("alyx:setSettings", settings),
  alyxSetLogPath: (logPath) => ipcRenderer.invoke("alyx:setLogPath", logPath),

  // Left 4 Dead 2 Integration API
  l4d2Start: (logPath, playerName) => ipcRenderer.invoke("l4d2:start", logPath, playerName),
  l4d2Stop: () => ipcRenderer.invoke("l4d2:stop"),
  l4d2Status: () => ipcRenderer.invoke("l4d2:status"),
  l4d2BrowseLogPath: () => ipcRenderer.invoke("l4d2:browseLogPath"),
  l4d2GetSettings: () => ipcRenderer.invoke("l4d2:getSettings"),
  l4d2SetLogPath: (logPath) => ipcRenderer.invoke("l4d2:setLogPath", logPath),
  l4d2SetPlayerName: (playerName) => ipcRenderer.invoke("l4d2:setPlayerName", playerName),
  l4d2SetSolenoidRecoil: (solenoidRecoil) =>
    ipcRenderer.invoke("l4d2:setSolenoidRecoil", solenoidRecoil),
  l4d2BrowseGameDir: () => ipcRenderer.invoke("l4d2:browseGameDir"),
  l4d2GetGameDir: () => ipcRenderer.invoke("l4d2:getGameDir"),
  l4d2SetGameDir: (gameDir) => ipcRenderer.invoke("l4d2:setGameDir", gameDir),
  l4d2CheckModInstalled: () => ipcRenderer.invoke("l4d2:checkModInstalled"),
  l4d2InstallMod: () => ipcRenderer.invoke("l4d2:installMod"),

  // Pistol Whip Integration API
  pistolwhipStart: () => ipcRenderer.invoke("pistolwhip:start"),
  pistolwhipStop: () => ipcRenderer.invoke("pistolwhip:stop"),
  pistolwhipStatus: () => ipcRenderer.invoke("pistolwhip:status"),
  pistolwhipGetSettings: () => ipcRenderer.invoke("pistolwhip:getSettings"),
  pistolwhipSetSolenoidRecoil: (solenoidRecoil) =>
    ipcRenderer.invoke("pistolwhip:setSolenoidRecoil", solenoidRecoil),
  pistolwhipBrowseGameDir: () => ipcRenderer.invoke("pistolwhip:browseGameDir"),
  pistolwhipGetGameDir: () => ipcRenderer.invoke("pistolwhip:getGameDir"),
  pistolwhipSetGameDir: (gameDir) => ipcRenderer.invoke("pistolwhip:setGameDir", gameDir),
  pistolwhipCheckModInstalled: () => ipcRenderer.invoke("pistolwhip:checkModInstalled"),
  pistolwhipInstallMod: () => ipcRenderer.invoke("pistolwhip:installMod"),

  battlesisterStart: () => ipcRenderer.invoke("battlesister:start"),
  battlesisterStop: () => ipcRenderer.invoke("battlesister:stop"),
  battlesisterStatus: () => ipcRenderer.invoke("battlesister:status"),
  battlesisterGetSettings: () => ipcRenderer.invoke("battlesister:getSettings"),
  battlesisterSetSolenoidRecoil: (solenoidRecoil) =>
    ipcRenderer.invoke("battlesister:setSolenoidRecoil", solenoidRecoil),
  battlesisterBrowseGameDir: () => ipcRenderer.invoke("battlesister:browseGameDir"),
  battlesisterGetGameDir: () => ipcRenderer.invoke("battlesister:getGameDir"),
  battlesisterSetGameDir: (gameDir) => ipcRenderer.invoke("battlesister:setGameDir", gameDir),
  battlesisterCheckModInstalled: () => ipcRenderer.invoke("battlesister:checkModInstalled"),
  battlesisterInstallMod: () => ipcRenderer.invoke("battlesister:installMod"),

  gunmancontractsStart: () => ipcRenderer.invoke("gunmancontracts:start"),
  gunmancontractsStop: () => ipcRenderer.invoke("gunmancontracts:stop"),
  gunmancontractsStatus: () => ipcRenderer.invoke("gunmancontracts:status"),
  gunmancontractsGetSettings: () => ipcRenderer.invoke("gunmancontracts:getSettings"),
  gunmancontractsSetSolenoidRecoil: (solenoidRecoil) =>
    ipcRenderer.invoke("gunmancontracts:setSolenoidRecoil", solenoidRecoil),
  gunmancontractsBrowseGameDir: () => ipcRenderer.invoke("gunmancontracts:browseGameDir"),
  gunmancontractsGetGameDir: () => ipcRenderer.invoke("gunmancontracts:getGameDir"),
  gunmancontractsSetGameDir: (gameDir) => ipcRenderer.invoke("gunmancontracts:setGameDir", gameDir),
  gunmancontractsCheckModInstalled: () => ipcRenderer.invoke("gunmancontracts:checkModInstalled"),
  gunmancontractsInstallMod: () => ipcRenderer.invoke("gunmancontracts:installMod"),

  // Predefined Effects Library API
  playEffect: (effectName) => ipcRenderer.invoke("effects:play", effectName),
  listEffectsLibrary: () => ipcRenderer.invoke("effects:list"),
  stopEffect: () => ipcRenderer.invoke("effects:stop"),

  // Generic Screen Health Watcher API
  screenHealthExportProfile: (profile) => ipcRenderer.invoke("screenHealth:exportProfile", profile),
  screenHealthLoadProfile: () => ipcRenderer.invoke("screenHealth:loadProfile"),
  screenHealthGetSettings: () => ipcRenderer.invoke("screenHealth:getSettings"),
  screenHealthSetSettings: (settings) => ipcRenderer.invoke("screenHealth:setSettings", settings),
  screenHealthChooseScreenshotsDir: () => ipcRenderer.invoke("screenHealth:chooseScreenshotsDir"),
  screenHealthOpenScreenshotsDir: () => ipcRenderer.invoke("screenHealth:openScreenshotsDir"),
  screenHealthListScreenshots: () => ipcRenderer.invoke("screenHealth:listScreenshots"),
  screenHealthGetScreenshotDataUrl: (filename) => ipcRenderer.invoke("screenHealth:getScreenshotDataUrl", filename),
  screenHealthDeleteScreenshot: (filename) => ipcRenderer.invoke("screenHealth:deleteScreenshot", filename),
  screenHealthClearScreenshots: () => ipcRenderer.invoke("screenHealth:clearScreenshots"),
  screenHealthCaptureCalibrationScreenshot: (monitorIndex) =>
    ipcRenderer.invoke("screenHealth:captureCalibrationScreenshot", monitorIndex),
  screenHealthSelectExistingScreenshot: () => ipcRenderer.invoke("screenHealth:selectExistingScreenshot"),
  screenHealthEncodeCalibrationScreenshot: (payload) =>
    ipcRenderer.invoke("screenHealth:encodeCalibrationScreenshot", payload),
  screenHealthMaterializeCalibrationScreenshot: (payload) =>
    ipcRenderer.invoke("screenHealth:materializeCalibrationScreenshot", payload),
  screenHealthCaptureRoiDebugImages: (monitorIndex, rois) =>
    ipcRenderer.invoke("screenHealth:captureRoiDebugImages", monitorIndex, rois),
  screenHealthStart: (profile) => ipcRenderer.invoke("screenHealth:start", profile),
  screenHealthStop: () => ipcRenderer.invoke("screenHealth:stop"),
  screenHealthStatus: () => ipcRenderer.invoke("screenHealth:status"),
  screenHealthTestProfileOnScreenshot: (profile, imagePath, outputDir) =>
    ipcRenderer.invoke("screenHealth:test", profile, imagePath, outputDir ?? null),
  // Profile management
  screenHealthListProfiles: () => ipcRenderer.invoke("screenHealth:listProfiles"),
  screenHealthSaveProfile: (profileData) => ipcRenderer.invoke("screenHealth:saveProfile", profileData),
  screenHealthDeleteProfile: (profileId) => ipcRenderer.invoke("screenHealth:deleteProfile", profileId),
  screenHealthGetProfile: (profileId) => ipcRenderer.invoke("screenHealth:getProfile", profileId),

  // Multi-Vest Management API
  listConnectedDevices: () => ipcRenderer.invoke("multivist:listConnectedDevices"),
  setMainDevice: (deviceId) => ipcRenderer.invoke("multivist:setMainDevice", deviceId),
  disconnectDevice: (deviceId) => ipcRenderer.invoke("multivist:disconnectDevice", deviceId),
  createPlayer: (playerId, name) => ipcRenderer.invoke("multivist:createPlayer", playerId, name),
  assignPlayer: (playerId, deviceId) => ipcRenderer.invoke("multivist:assignPlayer", playerId, deviceId),
  unassignPlayer: (playerId) => ipcRenderer.invoke("multivist:unassignPlayer", playerId),
  listPlayers: () => ipcRenderer.invoke("multivist:listPlayers"),
  getPlayerDevice: (playerId) => ipcRenderer.invoke("multivist:getPlayerDevice", playerId),
  setGamePlayerMapping: (gameId, playerNum, deviceId) => ipcRenderer.invoke("multivist:setGamePlayerMapping", gameId, playerNum, deviceId),
  clearGamePlayerMapping: (gameId, playerNum) => ipcRenderer.invoke("multivist:clearGamePlayerMapping", gameId, playerNum),
  listGamePlayerMappings: (gameId) => ipcRenderer.invoke("multivist:listGamePlayerMappings", gameId),
  createMockDevice: () => ipcRenderer.invoke("multivist:createMockDevice"),
  removeMockDevice: (deviceId) => ipcRenderer.invoke("multivist:removeMockDevice", deviceId),

  // Bundled Game Mods API
  modsListAll: () => ipcRenderer.invoke("mods:list"),
  modsCheckBundled: (modId) => ipcRenderer.invoke("mods:checkBundled", modId),
  modsSaveToFolder: (modId) => ipcRenderer.invoke("mods:saveToFolder", modId),
  modsDownloadFile: (modId, fileName) => ipcRenderer.invoke("mods:downloadFile", modId, fileName),
  modsOpenFolder: (modId) => ipcRenderer.invoke("mods:openFolder", modId),
  modsGetReadme: (modId) => ipcRenderer.invoke("mods:getReadme", modId),

  ocrListEngines: () => ipcRenderer.invoke("ocr:listEngines"),
  ocrGetSettings: () => ipcRenderer.invoke("ocr:getSettings"),
  ocrSetEngine: (ocrEngine) => ipcRenderer.invoke("ocr:setEngine", ocrEngine),
  ocrOpenWindowsLanguageSettings: () => ipcRenderer.invoke("ocr:openWindowsLanguageSettings"),

  // USB LC relay / solenoid recoil
  relayListPorts: () => ipcRenderer.invoke("relay:listPorts"),
  relayConnect: (port, baud, switchAddress) =>
    ipcRenderer.invoke("relay:connect", port, baud, switchAddress),
  relayDisconnect: () => ipcRenderer.invoke("relay:disconnect"),
  relayStatus: () => ipcRenderer.invoke("relay:status"),
  relaySet: (on) => ipcRenderer.invoke("relay:set", on),
  relayPulse: (durationMs) => ipcRenderer.invoke("relay:pulse", durationMs),
  relayMouseStart: (options) => ipcRenderer.invoke("relay:mouseStart", options),
  relayMouseStop: () => ipcRenderer.invoke("relay:mouseStop"),
  relayMouseStatus: () => ipcRenderer.invoke("relay:mouseStatus"),
});

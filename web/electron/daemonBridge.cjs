/**
 * Daemon Bridge - TCP client for communicating with the vest daemon.
 *
 * This module:
 * - Connects to the Python daemon via TCP
 * - Sends commands and receives responses
 * - Emits events received from the daemon
 *
 * In production (packaged app):
 * - Spawns the bundled vest-daemon.exe from resources/daemon/
 *
 * In development:
 * - Spawns Python directly from modern-third-space/src/
 */

const net = require("net");
const { EventEmitter } = require("events");
const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const { createWriteStream } = require("fs");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 5050;
const RECONNECT_DELAY_MS = 2000;
const CONNECT_TIMEOUT_MS = 5000;

// Detect if we're running in production (packaged) mode
const IS_PACKAGED = !process.env.VITE_DEV_SERVER_URL;

// Path to the modern-third-space src directory (development)
const PYTHON_SRC_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "modern-third-space",
  "src"
);

/**
 * Detect the best Python command to use.
 * 
 * Resolution order:
 * 1. TSV_PYTHON environment variable (e.g., "py -3.14" or "C:\Python314\python.exe")
 * 2. On Windows: py launcher with Python 3.14 (py -3.14)
 * 3. Fallback: python (Windows) or python3 (Unix)
 * 
 * This matches the logic in windows/*.bat scripts for consistency.
 * 
 * @returns {{ cmd: string, args: string[] }} Command and initial args to spawn Python
 */
function detectPythonCommand() {
  // 1. Check TSV_PYTHON environment variable
  const tsvPython = process.env.TSV_PYTHON;
  if (tsvPython) {
    const parts = tsvPython.trim().split(/\s+/);
    console.log(`[daemon] Using TSV_PYTHON: ${tsvPython}`);
    return { cmd: parts[0], args: parts.slice(1) };
  }

  // 2. On Windows, try py launcher with Python 3.14
  if (process.platform === "win32") {
    try {
      // Test if py -3.14 works
      execSync('py -3.14 -c "import sys"', { stdio: "ignore", timeout: 5000 });
      console.log("[daemon] Using Python: py -3.14 (detected via py launcher)");
      return { cmd: "py", args: ["-3.14"] };
    } catch (e) {
      // py -3.14 not available, fall through
      console.log("[daemon] py -3.14 not available, falling back to python");
    }
  }

  // 3. Fallback to python/python3
  const fallback = process.platform === "win32" ? "python" : "python3";
  console.log(`[daemon] Using Python: ${fallback} (default fallback)`);
  return { cmd: fallback, args: [] };
}

/**
 * Get the path to the daemon executable.
 * In production: resources/daemon/vest-daemon.exe
 * In development: Python script
 */
function getDaemonPath() {
  if (IS_PACKAGED) {
    // Production: use bundled executable
    // process.resourcesPath points to the resources folder in the packaged app
    const bundledDaemon = path.join(
      process.resourcesPath,
      "daemon",
      process.platform === "win32" ? "vest-daemon.exe" : "vest-daemon"
    );
    
    if (fs.existsSync(bundledDaemon)) {
      console.log(`[daemon] Using bundled daemon: ${bundledDaemon}`);
      return { type: "exe", path: bundledDaemon };
    }
    
    console.warn(`[daemon] Bundled daemon not found at: ${bundledDaemon}`);
    console.warn("[daemon] Falling back to Python mode");
  }
  
  // Development: use Python
  console.log(`[daemon] Using Python daemon from: ${PYTHON_SRC_PATH}`);
  return { type: "python", path: PYTHON_SRC_PATH };
}

class DaemonBridge extends EventEmitter {
  constructor(host = DEFAULT_HOST, port = DEFAULT_PORT) {
    super();
    this.host = host;
    this.port = port;
    this.socket = null;
    this.buffer = "";
    this.connected = false;
    this.reconnecting = false;
    this.pendingRequests = new Map(); // req_id -> { resolve, reject, timeout }
    this.requestCounter = 0;
    this.daemonProcess = null;
  }

  /**
   * Connect to the daemon.
   * If daemon is not running, optionally start it.
   */
  async connect(autoStartDaemon = true) {
    if (this.connected) {
      return true;
    }

    try {
      await this._tryConnect();
      return true;
    } catch (error) {
      if (autoStartDaemon) {
        console.log("Daemon not running, attempting to start...");
        try {
          await this._startDaemon();
          console.log("[daemon] Startup detection completed, waiting for daemon to be ready...");
          // Wait a bit longer for daemon to fully initialize and start listening
          await new Promise((resolve) => setTimeout(resolve, 2000));
          console.log("[daemon] Attempting connection...");
          await this._tryConnect();
          return true;
        } catch (startError) {
          console.error("[daemon] Failed to start daemon:", startError.message);
          throw startError;
        }
      }
      throw error;
    }
  }

  /**
   * Try to connect to the daemon.
   */
  _tryConnect() {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("Connection timeout"));
      }, CONNECT_TIMEOUT_MS);

      socket.connect(this.port, this.host, () => {
        clearTimeout(timeout);
        this.socket = socket;
        this.connected = true;
        this.buffer = "";

        console.log(`✓ Connected to daemon at ${this.host}:${this.port}`);
        this.emit("daemon:connected");
        resolve();
      });

      socket.on("data", (data) => {
        this._handleData(data);
      });

      socket.on("close", () => {
        this.connected = false;
        this.socket = null;
        console.log("Disconnected from daemon");
        this.emit("daemon:disconnected");
        this._rejectAllPending("Connection closed");
      });

      socket.on("error", (err) => {
        clearTimeout(timeout);
        if (!this.connected) {
          reject(err);
        } else {
          console.error("Daemon connection error:", err.message);
          this.emit("daemon:error", err);
        }
      });
    });
  }

  /**
   * Start the daemon process.
   * Uses bundled executable in production, Python in development.
   */
  _startDaemon() {
    return new Promise((resolve, reject) => {
      console.log("Starting daemon process...");

      const daemonInfo = getDaemonPath();
      let cmd, args, options;
      let logStream = null;

      if (daemonInfo.type === "exe") {
        // Production: run bundled executable
        cmd = daemonInfo.path;
        args = ["daemon", "--port", String(this.port)];
        
        // Create log file for daemon output
        const logDir = path.join(require("os").tmpdir(), "third-space-vest");
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }
        const logFile = path.join(logDir, `daemon-${this.port}.log`);
        logStream = createWriteStream(logFile, { flags: "a" });
        logStream.write(`\n=== Daemon started at ${new Date().toISOString()} ===\n`);
        
        options = {
          cwd: path.dirname(daemonInfo.path),
          detached: true,
          // Pipe stdout/stderr so we can detect startup AND write to log file
          // Note: Console window will be empty because output is piped
          // Check log file for daemon output: %TEMP%\third-space-vest\daemon-{port}.log
          stdio: ["ignore", "pipe", "pipe"],
        };
        console.log(`[daemon] Spawning: ${cmd} ${args.join(" ")}`);
        console.log(`[daemon] Log file: ${logFile}`);
      } else {
        // Development: run Python with proper detection
        const pythonInfo = detectPythonCommand();
        cmd = pythonInfo.cmd;
        args = [
          ...pythonInfo.args,  // e.g., ["-3.14"] for py launcher
          "-u",
          "-m",
          "modern_third_space.cli",
          "daemon",
          "--port",
          String(this.port),
          "start",
          "--screen-health-debug",
          "--screen-health-debug-save",
          "--screen-health-debug-dir",
          path.join(PYTHON_SRC_PATH, "debug_logs"),
          "--screen-health-debug-every-n",
          "10",
        ];
        options = {
          cwd: daemonInfo.path,
          env: {
            ...process.env,
            PYTHONPATH: daemonInfo.path,
          },
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        };
        console.log(`[daemon] Spawning: ${cmd} ${args.join(" ")} (cwd: ${daemonInfo.path})`);
      }

      this.daemonProcess = spawn(cmd, args, options);

      // Don't keep Electron alive just for the daemon
      this.daemonProcess.unref();

      let started = false;

      // Write stdout to log file and check for startup messages
      this.daemonProcess.stdout.on("data", (data) => {
        const output = data.toString();
        if (logStream) {
          logStream.write(output);
        }
        console.log("[daemon]", output.trim());
        
        // Check for startup messages
        if ((output.includes("listening") || 
             output.includes("Starting") || 
             output.includes("Daemon started") || 
             output.includes("started on")) && !started) {
          started = true;
          console.log("[daemon] Detected daemon started from output");
          resolve();
        }
      });

      // Write stderr to log file and check for startup messages
      this.daemonProcess.stderr.on("data", (data) => {
        const output = data.toString();
        if (logStream) {
          logStream.write(`[stderr] ${output}`);
        }
        console.error("[daemon stderr]", output.trim());
        
        // Also check stderr for startup messages
        if ((output.includes("listening") || 
             output.includes("Starting") || 
             output.includes("Daemon started") || 
             output.includes("started on")) && !started) {
          started = true;
          console.log("[daemon] Detected daemon started from stderr");
          resolve();
        }
      });

      // Also check TCP port as a fallback detection method
      const checkPort = () => {
        if (started) return;
        
        const testSocket = new net.Socket();
        testSocket.setTimeout(500);
        
        testSocket.on("connect", () => {
          testSocket.destroy();
          if (!started) {
            started = true;
            console.log("[daemon] Detected daemon started (port connected)");
            resolve();
          }
        });
        
        testSocket.on("error", () => {
          // Port not ready yet, try again
          setTimeout(checkPort, 200);
        });
        
        testSocket.on("timeout", () => {
          testSocket.destroy();
          setTimeout(checkPort, 200);
        });
        
        try {
          testSocket.connect(this.port, this.host);
        } catch (err) {
          setTimeout(checkPort, 200);
        }
      };

      // Start checking for port after a short delay (fallback)
      setTimeout(checkPort, 500);

      this.daemonProcess.on("error", (err) => {
        console.error("[daemon] Process spawn error:", err.message);
        if (logStream) {
          logStream.write(`[ERROR] Process spawn failed: ${err.message}\n`);
          logStream.end();
        }
        if (!started) {
          reject(err);
        }
      });

      this.daemonProcess.on("exit", (code, signal) => {
        console.error(`[daemon] Process exited with code ${code}, signal ${signal}`);
        if (logStream) {
          logStream.write(`[EXIT] Process exited with code ${code}, signal ${signal}\n`);
          logStream.end();
        }
        if (!started && code !== 0) {
          reject(new Error(`Daemon process exited with code ${code}`));
        }
      });

      // Timeout if daemon doesn't start (fallback)
      setTimeout(() => {
        if (!started) {
          started = true;
          console.warn("[daemon] Startup detection timeout - assuming daemon started");
          resolve();
        }
      }, 5000);
    });
  }

  /**
   * Disconnect from the daemon.
   */
  disconnect() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this._rejectAllPending("Disconnected");
  }

  /**
   * Handle incoming data from the daemon.
   */
  _handleData(data) {
    this.buffer += data.toString();

    // Process complete lines
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line);
        this._handleMessage(message);
      } catch (err) {
        console.error("Failed to parse daemon message:", line);
      }
    }
  }

  /**
   * Handle a parsed message from the daemon.
   */
  _handleMessage(message) {
    // Check if this is a response to a pending request
    if (message.response && message.req_id) {
      const pending = this.pendingRequests.get(message.req_id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.req_id);

        if (message.response === "error") {
          pending.reject(new Error(message.message || "Unknown error"));
        } else {
          pending.resolve(message);
        }
        return;
      }
    }

    // Check if this is a response without req_id
    if (message.response) {
      // Find oldest pending request that matches the response type
      // This is a fallback for responses without req_id
      for (const [reqId, pending] of this.pendingRequests.entries()) {
        if (pending.expectedResponse === message.response) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(reqId);

          if (message.response === "error") {
            pending.reject(new Error(message.message || "Unknown error"));
          } else {
            pending.resolve(message);
          }
          return;
        }
      }
    }

    // This is an event - emit it
    if (message.event) {
      this.emit("daemon:event", message);
      this.emit(`event:${message.event}`, message);
    }
  }

  /**
   * Send a command to the daemon and wait for response.
   */
  async sendCommand(cmd, params = {}, timeoutMs = 10000) {
    if (!this.connected) {
      throw new Error("Not connected to daemon");
    }

    const reqId = `req_${++this.requestCounter}_${Date.now()}`;
    const command = { cmd, req_id: reqId, ...params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`Command timeout: ${cmd}`));
      }, timeoutMs);

      this.pendingRequests.set(reqId, {
        resolve,
        reject,
        timeout,
        expectedResponse: cmd, // For matching responses without req_id
      });

      const data = JSON.stringify(command) + "\n";
      this.socket.write(data, (err) => {
        if (err) {
          clearTimeout(timeout);
          this.pendingRequests.delete(reqId);
          reject(err);
        }
      });
    });
  }

  /**
   * Reject all pending requests.
   */
  _rejectAllPending(reason) {
    for (const [reqId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  // -------------------------------------------------------------------------
  // High-level API (matches pythonBridge.cjs interface)
  // -------------------------------------------------------------------------

  /**
   * Ping the daemon (health check).
   */
  async ping() {
    try {
      const response = await this.sendCommand("ping");
      return {
        success: true,
        alive: response.alive,
        connected: response.connected,
        has_device_selected: response.has_device_selected,
        client_count: response.client_count,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get connection status.
   */
  async getStatus() {
    try {
      const response = await this.sendCommand("status");
      return {
        connected: response.connected ?? false,
        device_vendor_id: response.device?.vendor_id ?? null,
        device_product_id: response.device?.product_id ?? null,
        device_bus: response.device?.bus ?? null,
        device_address: response.device?.address ?? null,
        device_serial_number: response.device?.serial_number ?? null,
        last_error: null,
      };
    } catch (error) {
      return {
        connected: false,
        last_error: error.message,
      };
    }
  }

  /**
   * List available devices.
   */
  async listDevices() {
    try {
      const response = await this.sendCommand("list");
      return response.devices ?? [];
    } catch (error) {
      console.error("Failed to list devices:", error.message);
      return [];
    }
  }

  /**
   * Select a device.
   */
  async selectDevice(deviceInfo) {
    const params = {};
    if (deviceInfo?.bus !== undefined && deviceInfo?.address !== undefined) {
      params.bus = deviceInfo.bus;
      params.address = deviceInfo.address;
    } else if (deviceInfo?.serial_number) {
      params.serial = deviceInfo.serial_number;
    }

    await this.sendCommand("select_device", params);
    return { success: true };
  }

  /**
   * Get the currently selected device.
   */
  async getSelectedDevice() {
    try {
      const response = await this.sendCommand("get_selected_device");
      return response.device ?? null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Connect to the selected vest.
   */
  async connectToVest() {
    try {
      await this.sendCommand("connect");
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Disconnect from the vest.
   */
  async disconnectFromVest() {
    try {
      await this.sendCommand("disconnect");
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Trigger an effect.
   * @param {Object} effect - Effect object with cell, speed, and optional device_id/player_id/game_id/player_num
   */
  async triggerEffect(effect) {
    try {
      const params = {
        cell: effect.cell,
        speed: effect.speed,
      };
      
      // Add optional multi-vest parameters
      if (effect.device_id) {
        params.device_id = effect.device_id;
      }
      if (effect.player_id) {
        params.player_id = effect.player_id;
      }
      if (effect.game_id) {
        params.game_id = effect.game_id;
      }
      if (effect.player_num !== undefined) {
        params.player_num = effect.player_num;
      }
      
      await this.sendCommand("trigger", params);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop all effects.
   * @param {string} [deviceId] - Optional device ID to stop effects on
   */
  async stopAll(deviceId) {
    try {
      const params = deviceId ? { device_id: deviceId } : {};
      await this.sendCommand("stop", params);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Legacy: Connect to a specific device (combines select + connect).
   * Kept for backwards compatibility with existing UI.
   */
  async connectToDevice(deviceInfo) {
    try {
      // First select the device
      await this.selectDevice(deviceInfo);
      // Then connect to it
      await this.connectToVest();
      // Get status to return full info
      return await this.getStatus();
    } catch (error) {
      return {
        connected: false,
        last_error: error.message,
      };
    }
  }

  /**
   * Get effects list - all 8 actuators + presets.
   * Note: This is static data, not from daemon.
   *
   * Vest layout:
   *     FRONT           BACK
   *   ┌───────┐      ┌───────┐
   *   │ 0   1 │      │ 4   5 │
   *   │ 2   3 │      │ 6   7 │
   *   └───────┘      └───────┘
   */
  async getEffects() {
    return [
      // All 8 actuators
      { label: "Front Upper Left", cell: 0, speed: 6 },
      { label: "Front Upper Right", cell: 1, speed: 6 },
      { label: "Front Lower Left", cell: 2, speed: 6 },
      { label: "Front Lower Right", cell: 3, speed: 6 },
      { label: "Back Upper Left", cell: 4, speed: 6 },
      { label: "Back Upper Right", cell: 5, speed: 6 },
      { label: "Back Lower Left", cell: 6, speed: 6 },
      { label: "Back Lower Right", cell: 7, speed: 6 },
      // Presets
      { label: "All Front", cell: -1, speed: 6, preset: "front" },
      { label: "All Back", cell: -2, speed: 6, preset: "back" },
      { label: "Full Blast", cell: -3, speed: 10, preset: "all" },
    ];
  }

  // -------------------------------------------------------------------------
  // CS2 GSI Integration API
  // -------------------------------------------------------------------------

  /**
   * Start CS2 GSI server.
   * @param {number} gsiPort - Port for the GSI HTTP server (default 3000)
   */
  async cs2Start(gsiPort = 3000) {
    try {
      const response = await this.sendCommand("cs2_start", { gsi_port: gsiPort });
      return {
        success: response.success ?? false,
        gsi_port: response.gsi_port,
        error: response.message,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Stop CS2 GSI server.
   */
  async cs2Stop() {
    try {
      const response = await this.sendCommand("cs2_stop");
      return {
        success: response.success ?? false,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get CS2 GSI status.
   */
  async cs2Status() {
    try {
      const response = await this.sendCommand("cs2_status");
      return {
        running: response.running ?? false,
        gsi_port: response.gsi_port ?? null,
        events_received: response.events_received ?? 0,
        last_event_ts: response.last_event_ts ?? null,
      };
    } catch (error) {
      return {
        running: false,
        error: error.message,
      };
    }
  }

  /**
   * Generate CS2 GSI config file content.
   * @param {number} gsiPort - Port for the GSI HTTP server
   */
  async cs2GenerateConfig(gsiPort = 3000) {
    try {
      const response = await this.sendCommand("cs2_generate_config", {
        gsi_port: gsiPort,
      });
      return {
        success: true,
        config_content: response.config_content,
        filename: response.filename ?? "gamestate_integration_thirdspace.cfg",
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Half-Life: Alyx Integration API
  // -------------------------------------------------------------------------

  /**
   * Start Alyx console log watcher.
   * @param {string} [logPath] - Optional path to console.log (auto-detect if not provided)
   * @param {Object} [alyxSettings] - Optional alyx_settings payload for daemon (e.g. { enabled_events: {...} })
   */
  async alyxStart(logPath, alyxSettings) {
    try {
      const params = logPath ? { log_path: logPath } : {};
      if (alyxSettings && typeof alyxSettings === "object") {
        params.alyx_settings = alyxSettings;
      }
      const response = await this.sendCommand("alyx_start", params);
      return {
        success: response.success ?? false,
        log_path: response.log_path,
        error: response.message,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Stop Alyx console log watcher.
   */
  async alyxStop() {
    try {
      const response = await this.sendCommand("alyx_stop");
      return {
        success: response.success ?? false,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get Alyx integration status.
   */
  async alyxStatus() {
    try {
      const response = await this.sendCommand("alyx_status");
      return {
        running: response.running ?? false,
        log_path: response.log_path ?? null,
        events_received: response.events_received ?? 0,
        last_event_ts: response.last_event_ts ?? null,
      };
    } catch (error) {
      return {
        running: false,
        error: error.message,
      };
    }
  }

  /**
   * Get Alyx mod info (download URLs, install instructions).
   */
  async alyxGetModInfo() {
    try {
      const response = await this.sendCommand("alyx_get_mod_info");
      return {
        success: true,
        mod_info: response.mod_info,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Left 4 Dead 2 Integration API
  // -------------------------------------------------------------------------

  /**
   * Start Left 4 Dead 2 console log watcher.
   * @param {string} [logPath] - Optional path to console.log (auto-detect if not provided)
   * @param {string} [playerName] - Optional player name to filter events
   */
  async l4d2Start(logPath, playerName, solenoidRecoil) {
    try {
      const params = {};
      if (logPath) {
        params.log_path = logPath;
      }
      if (playerName) {
        params.message = playerName; // Using message field for player name
      }
      if (solenoidRecoil && typeof solenoidRecoil === "object") {
        params.solenoid_recoil = solenoidRecoil;
      }
      const response = await this.sendCommand("l4d2_start", params);
      return {
        success: response.success ?? true,
        log_path: response.log_path,
        error: response.message,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop Left 4 Dead 2 integration.
   */
  async l4d2Stop() {
    try {
      await this.sendCommand("l4d2_stop");
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get Left 4 Dead 2 integration status.
   */
  async l4d2Status() {
    try {
      const response = await this.sendCommand("l4d2_status");
      return {
        success: true,
        running: response.running ?? false,
        events_received: response.events_received ?? 0,
        last_event_ts: response.last_event_ts ?? null,
        last_event_type: response.last_event_type ?? null,
        log_path: response.log_path ?? null,
      };
    } catch (error) {
      return {
        success: false,
        running: false,
        error: error.message,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Pistol Whip Integration API
  // -------------------------------------------------------------------------

  async pistolwhipStart(solenoidRecoil) {
    try {
      const params = {};
      if (solenoidRecoil && typeof solenoidRecoil === "object") {
        params.solenoid_recoil = solenoidRecoil;
      }
      const response = await this.sendCommand("pistolwhip_start", params);
      return {
        success: response.success ?? true,
        error: response.message,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async pistolwhipStop() {
    try {
      await this.sendCommand("pistolwhip_stop");
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async pistolwhipStatus() {
    try {
      const response = await this.sendCommand("pistolwhip_status");
      return {
        success: true,
        running: response.running ?? false,
        events_received: response.events_received ?? 0,
        last_event_ts: response.last_event_ts ?? null,
        last_event_type: response.last_event_type ?? null,
      };
    } catch (error) {
      return {
        success: false,
        running: false,
        error: error.message,
      };
    }
  }

  async battlesisterStart(solenoidRecoil) {
    try {
      const params = {};
      if (solenoidRecoil && typeof solenoidRecoil === "object") {
        params.solenoid_recoil = solenoidRecoil;
      }
      const response = await this.sendCommand("battlesister_start", params);
      return {
        success: response.success ?? true,
        error: response.message,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async battlesisterStop() {
    try {
      await this.sendCommand("battlesister_stop");
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async battlesisterStatus() {
    try {
      const response = await this.sendCommand("battlesister_status");
      return {
        success: true,
        running: response.running ?? false,
        events_received: response.events_received ?? 0,
        last_event_ts: response.last_event_ts ?? null,
        last_event_type: response.last_event_type ?? null,
      };
    } catch (error) {
      return {
        success: false,
        running: false,
        error: error.message,
      };
    }
  }

  async gunmancontractsStart(solenoidRecoil) {
    try {
      const params = {};
      if (solenoidRecoil && typeof solenoidRecoil === "object") {
        params.solenoid_recoil = solenoidRecoil;
      }
      const response = await this.sendCommand("gunmancontracts_start", params);
      return {
        success: response.success ?? true,
        error: response.message,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async gunmancontractsStop() {
    try {
      await this.sendCommand("gunmancontracts_stop");
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async gunmancontractsStatus() {
    try {
      const response = await this.sendCommand("gunmancontracts_status");
      return {
        success: true,
        running: response.running ?? false,
        events_received: response.events_received ?? 0,
        last_event_ts: response.last_event_ts ?? null,
        last_event_type: response.last_event_type ?? null,
      };
    } catch (error) {
      return {
        success: false,
        running: false,
        error: error.message,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Generic Screen Health Watcher API
  // -------------------------------------------------------------------------

  /**
   * Start the screen health watcher with a profile JSON.
   * @param {Object} profile - Profile JSON object (schema_version 0)
   */
  async screenHealthStart(profile) {
    try {
      const response = await this.sendCommand("screen_health_start", { profile });
      return {
        success: response.success ?? false,
        profile_name: response.profile_name ?? null,
        error: response.message,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop the screen health watcher.
   */
  async screenHealthStop() {
    try {
      const response = await this.sendCommand("screen_health_stop");
      return {
        success: response.success ?? false,
        error: response.message,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get screen health watcher status.
   */
  async screenHealthStatus() {
    try {
      const response = await this.sendCommand("screen_health_status");
      return {
        running: response.running ?? false,
        profile_name: response.profile_name ?? null,
        events_received: response.events_received ?? 0,
        last_event_ts: response.last_event_ts ?? null,
        last_hit_ts: response.last_hit_ts ?? null,
      };
    } catch (error) {
      return {
        running: false,
        error: error.message,
      };
    }
  }

  /**
   * Run screen_health_test (profile + frame_bgra_path + frame_width + frame_height; raw BGRA bytes on disk).
   * @param {Object} params - { profile, frame_bgra_path, frame_width, frame_height, output_dir? }
   */
  async screenHealthTest(params) {
    const timeoutMs = 120000;
    try {
      const response = await this.sendCommand("screen_health_test", params, timeoutMs);
      return {
        success: response.success ?? false,
        test_result: response.test_result ?? null,
        error: response.message,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // -------------------------------------------------------------------------
  // Predefined Effects Library API
  // -------------------------------------------------------------------------

  /**
   * Play a predefined effect by name.
   * @param {string} effectName - Name of the effect to play
   */
  async playEffect(effectName) {
    try {
      const response = await this.sendCommand("play_effect", {
        effect_name: effectName,
      });
      return {
        success: response.success ?? false,
        error: response.message,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * List all available predefined effects.
   * Returns effects organized by category.
   */
  async listEffects() {
    try {
      const response = await this.sendCommand("list_effects");
      return {
        success: true,
        effects: response.effects ?? [],
        categories: response.categories ?? [],
      };
    } catch (error) {
      return {
        success: false,
        effects: [],
        categories: [],
        error: error.message,
      };
    }
  }

  /**
   * Stop any currently playing effect (emergency stop).
   */
  async stopEffect() {
    try {
      await this.sendCommand("stop_effect");
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // -------------------------------------------------------------------------
  // Daemon OCR engine (ammo recoil)
  // -------------------------------------------------------------------------

  async ocrListEngines() {
    try {
      const response = await this.sendCommand("ocr_list_engines");
      return {
        success: true,
        ocr_engine: response.ocr_engine,
        ocr_engines: response.ocr_engines ?? [],
      };
    } catch (error) {
      return { success: false, ocr_engines: [], error: error.message };
    }
  }

  async ocrGetSettings() {
    try {
      const response = await this.sendCommand("ocr_get_settings");
      return {
        success: true,
        ocr_engine: response.ocr_engine,
        ocr_engines: response.ocr_engines ?? [],
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async ocrSetEngine(ocrEngine) {
    try {
      const response = await this.sendCommand("ocr_set_engine", { ocr_engine: ocrEngine });
      return {
        success: response.success ?? response.ok ?? false,
        ocr_engine: response.ocr_engine,
        error: response.message,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // -------------------------------------------------------------------------
  // USB LC relay / solenoid recoil
  // -------------------------------------------------------------------------

  async relayListPorts() {
    try {
      const response = await this.sendCommand("relay_list_ports");
      return {
        success: true,
        ports: response.ports ?? [],
      };
    } catch (error) {
      return { success: false, ports: [], error: error.message };
    }
  }

  async relayConnect(port, baud = 9600, switchAddress = 1) {
    try {
      const response = await this.sendCommand("relay_connect", {
        port,
        baud,
        switch_address: switchAddress,
      });
      return {
        success: response.success ?? response.ok ?? false,
        relay: response.relay,
        error: response.message,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async relayDisconnect() {
    try {
      const response = await this.sendCommand("relay_disconnect");
      return {
        success: response.success ?? response.ok ?? true,
        error: response.message,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async relayStatus() {
    try {
      const response = await this.sendCommand("relay_status");
      return {
        success: true,
        connected: response.connected ?? false,
        relay: response.relay ?? null,
      };
    } catch (error) {
      return { success: false, connected: false, relay: null, error: error.message };
    }
  }

  async relaySet(on) {
    try {
      const response = await this.sendCommand("relay_set", { on: !!on });
      return {
        success: response.success ?? response.ok ?? false,
        on: response.on,
        relay: response.relay,
        error: response.message,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async relayPulse(durationMs = 40) {
    try {
      const response = await this.sendCommand(
        "relay_pulse",
        { duration_ms: durationMs },
        Math.max(10000, durationMs + 5000)
      );
      return {
        success: response.success ?? response.ok ?? false,
        duration_ms: response.duration_ms,
        relay: response.relay,
        error: response.message,
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async relayMouseStart(options = {}) {
    try {
      const params = {
        duration_ms: options.durationMs ?? options.duration_ms ?? 40,
        fire_mode: options.fireMode ?? options.fire_mode ?? "single",
        fire_rate_rpm: options.fireRateRpm ?? options.fire_rate_rpm ?? 600,
        burst_count: options.burstCount ?? options.burst_count ?? 3,
      };
      const response = await this.sendCommand("relay_mouse_start", params);
      return {
        success: response.success ?? response.ok ?? false,
        running: response.running ?? false,
        duration_ms: response.duration_ms,
        fire_mode: response.fire_mode,
        fire_rate_rpm: response.fire_rate_rpm,
        burst_count: response.burst_count,
        interval_ms: response.interval_ms,
        pulses: response.pulses ?? 0,
        error: response.message,
      };
    } catch (error) {
      return { success: false, running: false, error: error.message };
    }
  }

  async relayMouseStop() {
    try {
      const response = await this.sendCommand("relay_mouse_stop");
      return {
        success: response.success ?? response.ok ?? true,
        running: response.running ?? false,
        error: response.message,
      };
    } catch (error) {
      return { success: false, running: false, error: error.message };
    }
  }

  async relayMouseStatus() {
    try {
      const response = await this.sendCommand("relay_mouse_status");
      return {
        success: true,
        running: response.running ?? false,
        duration_ms: response.duration_ms ?? null,
        fire_mode: response.fire_mode ?? "single",
        fire_rate_rpm: response.fire_rate_rpm ?? 600,
        burst_count: response.burst_count ?? 3,
        interval_ms: response.interval_ms ?? null,
        pulses: response.pulses ?? 0,
        error: response.message,
      };
    } catch (error) {
      return { success: false, running: false, pulses: 0, error: error.message };
    }
  }
}

// Singleton instance
let instance = null;

function getDaemonBridge() {
  if (!instance) {
    instance = new DaemonBridge();
  }
  return instance;
}

module.exports = {
  DaemonBridge,
  getDaemonBridge,
};


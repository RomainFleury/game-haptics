/**
 * Recoil Link UF2 firmware discovery and flash helpers (Electron main).
 *
 * Both the Micro Dev dongle and Nice!Nano-style receivers use Adafruit-style
 * UF2 bootloaders: enter DFU, mount a mass-storage volume, copy a .uf2 file.
 * The board still has to be put into bootloader mode by the user (button /
 * double-tap reset). This module only detects the volume and writes the image.
 */

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const IS_PACKAGED = !process.env.VITE_DEV_SERVER_URL;

/** @typedef {"dongle" | "receiver" | "receiver_nosd" | "unknown"} FirmwareRole */

const IMAGE_FILES = {
  // PCA10059 uses Open DFU zip; UF2 name kept only as a legacy alias if present.
  dongle: "recoil-dongle-dfu.zip",
  dongle_uf2: "recoil-dongle.uf2",
  dongle_hex: "recoil-dongle.hex",
  receiver: "recoil-receiver.uf2",
  receiver_nosd: "recoil-receiver-nosd.uf2",
};

/**
 * Repo root from this file at web/electron/recoilFirmware.cjs → ../..
 * (Do not use ../../../ — that is for web/electron/ipc/* handlers.)
 */
function repoRoot() {
  return path.resolve(__dirname, "..", "..");
}

/**
 * Candidate directories for prebuilt UF2s (first hit wins per role).
 * Dev build trees are checked after dist/ so a local `build.ps1` result works.
 */
function firmwareSearchRoots() {
  const roots = [];
  if (IS_PACKAGED && process.resourcesPath) {
    roots.push(path.join(process.resourcesPath, "recoil-link", "firmware"));
  }
  const root = repoRoot();
  roots.push(path.join(root, "recoil-link", "firmware", "dist"));
  roots.push(path.join(root, "recoil-link", "firmware", "build"));
  return roots;
}

/**
 * Resolve absolute paths for each firmware role if a file exists.
 * @returns {{ role: FirmwareRole, path: string, source: string, bytes: number }[]}
 */
function listFirmwareImages() {
  const found = [];
  const seen = new Set();

  const tryAdd = (role, filePath, source) => {
    if (seen.has(role) || !fs.existsSync(filePath)) return;
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size < 256) return;
    seen.add(role);
    found.push({ role, path: filePath, source, bytes: st.size });
  };

  for (const root of firmwareSearchRoots()) {
    // Packaged / dist naming (dongle = DFU zip for PCA10059; receivers = UF2)
    tryAdd("dongle", path.join(root, IMAGE_FILES.dongle), root);
    tryAdd("dongle", path.join(root, IMAGE_FILES.dongle_uf2), root);
    tryAdd("dongle", path.join(root, IMAGE_FILES.dongle_hex), root);
    tryAdd("receiver", path.join(root, IMAGE_FILES.receiver), root);
    tryAdd("receiver_nosd", path.join(root, IMAGE_FILES.receiver_nosd), root);

    // west build output layout
    tryAdd("dongle", path.join(root, "dongle", "zephyr", "recoil-dongle-dfu.zip"), root);
    tryAdd("dongle", path.join(root, "dongle", "zephyr", "zephyr.hex"), root);
    tryAdd("dongle", path.join(root, "dongle", "zephyr", "zephyr.uf2"), root);
    tryAdd("receiver", path.join(root, "receiver", "zephyr", "zephyr.uf2"), root);
    tryAdd(
      "receiver_nosd",
      path.join(root, "receiver-nosd", "zephyr", "zephyr.uf2"),
      root
    );
  }

  return found;
}

/**
 * Probe Windows for Nordic/Adafruit CDC that often means a Micro Dev is plugged
 * even when the UF2 mass-storage volume did not mount.
 * @returns {Promise<{ port: string, description: string, vidPid: string }[]>}
 */
async function listEmitterSerialHints() {
  if (process.platform !== "win32") return [];
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        [
          "$ports = Get-CimInstance Win32_SerialPort -ErrorAction SilentlyContinue",
          "$hints = @()",
          "foreach ($p in $ports) {",
          "  $id = [string]$p.PNPDeviceID",
          "  if ($id -match 'VID_1915&PID_521F' -or $id -match 'VID_239A') {",
          "    $hints += [pscustomobject]@{ port = $p.DeviceID; description = $p.Description; vidPid = $Matches[0] }",
          "  }",
          "}",
          "$hints | ConvertTo-Json -Compress",
        ].join("; "),
      ],
      { windowsHide: true, timeout: 8000 }
    );
    const text = String(stdout || "").trim();
    if (!text) return [];
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr
      .filter((h) => h && h.port)
      .map((h) => ({
        port: String(h.port),
        description: String(h.description || ""),
        vidPid: String(h.vidPid || ""),
      }));
  } catch {
    return [];
  }
}

/**
 * Parse Adafruit-style INFO_UF2.TXT into a flat object.
 * @param {string} text
 */
function parseInfoUf2(text) {
  /** @type {Record<string, string>} */
  const fields = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) fields[key] = value;
  }
  return fields;
}

/**
 * @param {Record<string, string>} fields
 * @param {string} volumeLabel
 * @returns {{ role: FirmwareRole, confidence: "high" | "medium" | "low", reason: string }}
 */
function classifyBoard(fields, volumeLabel) {
  const label = String(volumeLabel || "").toUpperCase();
  const model = String(fields.Model || fields.model || "").toLowerCase();
  const boardId = String(fields["Board-ID"] || fields["Board ID"] || "").toLowerCase();
  const soft = String(fields.SoftDevice || fields.Softdevice || "").trim();
  const blob = `${label} ${model} ${boardId}`.toLowerCase();

  if (
    label.includes("NICENANO") ||
    boardId.includes("nicenano") ||
    model.includes("nice!nano") ||
    model.includes("nice nano")
  ) {
    if (soft && !/^none$/i.test(soft)) {
      return {
        role: "receiver",
        confidence: "high",
        reason: `Nice!Nano with SoftDevice (${soft}) → recoil_receiver @ 0x26000`,
      };
    }
    return {
      role: "receiver_nosd",
      confidence: "high",
      reason: "Nice!Nano without SoftDevice → recoil_receiver_nosd @ 0x1000",
    };
  }

  if (
    label.includes("UF2BOOT") ||
    blob.includes("mdk") ||
    blob.includes("dongle") ||
    blob.includes("makerdiary")
  ) {
    return {
      role: "dongle",
      confidence: "high",
      reason: "UF2BOOT / MDK-style volume → recoil_dongle",
    };
  }

  // Generic Adafruit nRF52840 UF2 — user must confirm
  if (blob.includes("nrf52840") || fields["UF2 Bootloader"] || Object.keys(fields).length) {
    return {
      role: "unknown",
      confidence: "low",
      reason: "UF2 volume found but board type is unclear — pick Emitter or Receiver manually",
    };
  }

  return { role: "unknown", confidence: "low", reason: "Unrecognized volume" };
}

/**
 * List Windows drive letters via PowerShell (works for UF2 removable volumes).
 * @returns {Promise<string[]>} e.g. ["H"]
 */
async function listWindowsDriveLetters() {
  if (process.platform !== "win32") {
    // Best-effort: scan /Volumes on macOS, /media on Linux
    const candidates =
      process.platform === "darwin"
        ? ["/Volumes"]
        : ["/media", "/run/media", `/media/${process.env.USER || ""}`];
    const letters = [];
    for (const base of candidates) {
      if (!fs.existsSync(base)) continue;
      for (const name of fs.readdirSync(base)) {
        letters.push(path.join(base, name));
      }
    }
    return letters;
  }

  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Get-Volume | Where-Object { $_.DriveLetter } | ForEach-Object { $_.DriveLetter }",
    ],
    { windowsHide: true, timeout: 8000 }
  );
  return String(stdout)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z]$/.test(s));
}

/**
 * @param {string} letterOrPath  "H" on Windows or absolute mount path elsewhere
 */
function volumeRoot(letterOrPath) {
  if (process.platform === "win32" && /^[A-Za-z]$/.test(letterOrPath)) {
    return `${letterOrPath.toUpperCase()}:\\`;
  }
  return letterOrPath;
}

/**
 * Scan for UF2 bootloader volumes.
 */
async function listUf2Targets() {
  const letters = await listWindowsDriveLetters();
  const targets = [];

  for (const letter of letters) {
    const root = volumeRoot(letter);
    const infoPath = path.join(root, "INFO_UF2.TXT");
    if (!fs.existsSync(infoPath)) continue;

    let infoText = "";
    try {
      infoText = fs.readFileSync(infoPath, "utf8");
    } catch {
      continue;
    }
    const fields = parseInfoUf2(infoText);
    let volumeLabel = "";
    if (process.platform === "win32" && /^[A-Za-z]$/.test(letter)) {
      try {
        const { stdout } = await execFileAsync(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            `(Get-Volume -DriveLetter ${letter}).FileSystemLabel`,
          ],
          { windowsHide: true, timeout: 5000 }
        );
        volumeLabel = String(stdout).trim();
      } catch {
        volumeLabel = "";
      }
    } else {
      volumeLabel = path.basename(root);
    }

    const classification = classifyBoard(fields, volumeLabel);
    targets.push({
      path: root,
      driveLetter: /^[A-Za-z]$/.test(letter) ? letter.toUpperCase() : null,
      volumeLabel,
      info: fields,
      suggestedRole: classification.role,
      confidence: classification.confidence,
      reason: classification.reason,
      softDevice: fields.SoftDevice || fields.Softdevice || null,
      model: fields.Model || null,
      boardId: fields["Board-ID"] || fields["Board ID"] || null,
    });
  }

  return targets;
}

/**
 * Copy a UF2 onto a bootloader volume.
 * UF2 devices often eject mid-copy; EBUSY / ENOENT after a partial write usually means success.
 *
 * @param {{ targetPath: string, role: FirmwareRole, imagePath?: string }} opts
 */
async function flashUf2(opts) {
  const role = opts.role;
  if (!role || role === "unknown") {
    return { success: false, error: "Pick emitter or receiver firmware role" };
  }

  let imagePath = opts.imagePath;
  if (!imagePath) {
    const match = listFirmwareImages().find((img) => img.role === role);
    if (!match) {
      return {
        success: false,
        error: `No UF2 for role "${role}". Build with recoil-link/firmware/build.ps1 or place files in recoil-link/firmware/dist/.`,
      };
    }
    imagePath = match.path;
  }
  if (!fs.existsSync(imagePath)) {
    return { success: false, error: `Firmware file missing: ${imagePath}` };
  }

  const targetRoot = opts.targetPath;
  if (!targetRoot || !fs.existsSync(path.join(targetRoot, "INFO_UF2.TXT"))) {
    return {
      success: false,
      error: "Bootloader volume not found. Put the board in UF2 mode and scan again.",
    };
  }

  const destName = IMAGE_FILES[role] || "firmware.uf2";
  const destPath = path.join(targetRoot, destName);

  try {
    await fs.promises.copyFile(imagePath, destPath);
    return {
      success: true,
      ejected: false,
      role,
      imagePath,
      destPath,
      message: `Wrote ${destName}. Re-plug the board if it does not reboot on its own.`,
    };
  } catch (err) {
    const code = err && err.code;
    // Drive vanished during copy — normal for UF2
    if (
      code === "ENOENT" ||
      code === "EIO" ||
      code === "EBUSY" ||
      code === "EPERM" ||
      code === "UNKNOWN"
    ) {
      return {
        success: true,
        ejected: true,
        role,
        imagePath,
        destPath,
        message:
          "Board ejected during copy (normal for UF2). Wait for reboot, then check the LED / COM port.",
      };
    }
    return { success: false, error: err.message || String(err) };
  }
}

module.exports = {
  IMAGE_FILES,
  listFirmwareImages,
  listUf2Targets,
  listEmitterSerialHints,
  firmwareSearchRoots,
  repoRoot,
  flashUf2,
  parseInfoUf2,
  classifyBoard,
};

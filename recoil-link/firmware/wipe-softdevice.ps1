# Wipe SoftDevice on a Nice!Nano so Recoil nosd (@ 0x1000) can be UF2-flashed.
#
# UF2 alone cannot do this: while SoftDevice is installed, Adafruit skips writes
# below 0x26000. SoftDevice must be erased over SWD.
#
# Wiring (nice!nano back pads):
#   Probe SWDIO → SWD
#   Probe SWCLK → SWC
#   Probe GND   → GND
#   Probe VTref → VCC (3.3 V)  — power the board (USB is fine)
#
# Requires one of:
#   - SEGGER J-Link (+ J-Link software)   [nrfutil device / nrfjprog]
#   - CMSIS-DAP / DAPLink                 [pyocd, if installed]
#
# Leaves Adafruit bootloader @ 0xF4000 intact when page-erase succeeds.
# After success: double-tap RST → INFO should say SoftDevice: not found
# then: .\flash-receiver.ps1 -Drive X:
#
# SoftDevice apps (CircuitPython): save first with flash-receiver.ps1 -Save

param(
    # Erase SoftDevice + application only (0x1000 .. 0xF4000), keep UF2 bootloader.
    [switch]$KeepBootloader = $true,
    # Nuclear: CTRL-AP erase-all (also removes bootloader). Requires -BootloaderHex to recover UF2.
    [switch]$FullRecover,
    [string]$BootloaderHex = "",
    [string]$SerialNumber = ""
)

$ErrorActionPreference = "Stop"
$Nrfutil = Join-Path $env:USERPROFILE ".nrfutil\bin\nrfutil.exe"
if (-not (Test-Path $Nrfutil)) {
    $cmd = Get-Command nrfutil -ErrorAction SilentlyContinue
    if ($cmd) { $Nrfutil = $cmd.Source }
}

# SoftDevice S140 v6 sits above MBR; Adafruit app starts @ 0x26000; bootloader @ 0xF4000.
$SdStart = "0x1000"
$BootloaderStart = "0xF4000"

function Get-SwdDevices {
    if (-not (Test-Path $Nrfutil)) {
        return @()
    }
    $json = & $Nrfutil device list --json 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $json) {
        return @()
    }
    # nrfutil JSON lines: pick objects that look like device entries with traits
    $devices = @()
    foreach ($line in ($json -split "`n")) {
        $t = $line.Trim()
        if (-not $t.StartsWith("{")) { continue }
        try {
            $obj = $t | ConvertFrom-Json
            $inner = $obj
            if ($obj.data) { $inner = $obj.data }
            if ($inner.traits -or $inner.serialNumber -or $inner.serial_number) {
                $devices += $inner
            }
        } catch { }
    }
    return $devices
}

function Test-HasJlinkTrait($dev) {
    $traits = @()
    if ($dev.traits) {
        if ($dev.traits -is [string]) { $traits = @($dev.traits) }
        else { $traits = @($dev.traits) }
    }
    $joined = ($traits | ForEach-Object { "$_" }) -join ","
    return $joined -match '(?i)jlink|segger'
}

Write-Host "=== Recoil SoftDevice wipe (SWD) ==="
Write-Host "Save CircuitPython first if you have not: .\flash-receiver.ps1 -Drive X: -Save"
Write-Host ""

if (-not (Test-Path $Nrfutil)) {
    Write-Error "nrfutil not found. Install Nordic nrfutil and: nrfutil install device"
}

# List what USB sees (helpful when only nice!nano UF2/CDC is plugged)
Write-Host "nrfutil device list:"
& $Nrfutil device list
Write-Host ""

$jlinkHint = & $Nrfutil device list 2>&1 | Out-String
if ($jlinkHint -match 'JLinkARM DLL not found') {
    Write-Warning "SEGGER J-Link software is not installed (DLL missing)."
    Write-Warning "Install from https://www.segger.com/downloads/jlink/ then reconnect the probe."
}

$snrArgs = @()
if ($SerialNumber) {
    $snrArgs = @("--serial-number", $SerialNumber)
}

# Detect a real debug probe (not the nice!nano USB CDC alone)
$listOut = & $Nrfutil device list --traits jlink,devkit 2>&1 | Out-String
$hasProbe = $listOut -match '(?i)jlink|J-Link|Segment|SEGGER|PCA100|DK'
if (-not $hasProbe) {
    Write-Host ""
    Write-Host "No SWD debug probe detected."
    Write-Host ""
    Write-Host "A nice!nano on USB (NICENANO / COM) is NOT enough — SoftDevice wipe needs SWD."
    Write-Host ""
    Write-Host "Do this:"
    Write-Host "  1. .\flash-receiver.ps1 -Drive H: -Save     # if not already saved"
    Write-Host "  2. Wire a J-Link / DK / CMSIS-DAP to the nice!nano SWD/SWC/GND/VCC pads"
    Write-Host "  3. Install SEGGER J-Link pack (for nrfutil device)"
    Write-Host "  4. Re-run: .\wipe-softdevice.ps1"
    Write-Host "  5. Double-tap RST → confirm SoftDevice: not found"
    Write-Host "  6. .\flash-receiver.ps1 -Drive H:"
    Write-Host ""
    Write-Host "Later restore CircuitPython:"
    Write-Host "  .\flash-receiver.ps1 -Drive H: -Restore .\backups\<folder>"
    exit 2
}

if ($FullRecover) {
    if (-not $BootloaderHex -or -not (Test-Path $BootloaderHex)) {
        Write-Error @"
-FullRecover erases the UF2 bootloader too. Pass -BootloaderHex path\to\nice_nano_bootloader-*.hex
(from Adafruit / nice!nano releases), then re-enter UF2 and flash nosd.
"@
    }
    Write-Host "Full recover (erase-all)..."
    & $Nrfutil device recover @snrArgs --traits jlink,devkit
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Host "Programming bootloader hex: $BootloaderHex"
    & $Nrfutil device program --firmware $BootloaderHex @snrArgs --traits jlink,devkit
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $Nrfutil device reset @snrArgs --traits jlink,devkit
    Write-Host "Done. If this hex included SoftDevice, INFO may still list S140 — use a nosd bootloader hex or page-erase path instead."
    exit 0
}

# Default: erase MBR..bootloader gap (SoftDevice + app), keep bootloader.
Write-Host "Erasing SoftDevice + application ($SdStart .. $BootloaderStart), keeping UF2 bootloader..."
& $Nrfutil device erase --pages "${SdStart}-${BootloaderStart}" @snrArgs --traits jlink,devkit --family nrf52
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Error @"
Page erase failed (SoftDevice may be protected). Options:
  A) Fix probe/J-Link install and retry
  B) .\wipe-softdevice.ps1 -FullRecover -BootloaderHex <nice_nano_bootloader.hex>
     (then ensure SoftDevice is absent, or erase SoftDevice pages again)
"@
}

& $Nrfutil device reset @snrArgs --traits jlink,devkit 2>$null

Write-Host ""
Write-Host "SWD erase finished."
Write-Host "Next:"
Write-Host "  1. Unplug SWD if you want; keep USB"
Write-Host "  2. Double-tap RST → NICENANO"
Write-Host "  3. Confirm INFO_UF2.TXT: SoftDevice: not found"
Write-Host "  4. .\flash-receiver.ps1 -Drive X:"
Write-Host "  5. Restore SoftDevice app later with -Restore if needed"

# Flash TSC Recoil Link onto the lab Nordic nRF52840 Dongle (PCA10059).
#
# 1. Plug the blue Nordic dongle into USB.
# 2. Press the sideways RESET (not the white SW1).
# 3. Red LED pulses — Open DFU. COM port is VID 1915:521F (often COM15).
# 4. .\flash-emitter.ps1
#    .\flash-emitter.ps1 -Port COM15   # optional; used if device discovery needs a hint
#
# Prefer: nrfutil device program (works with this Open DFU).
# Fallback: legacy nrf5sdk-tools dfu usb-serial.
#
# See ../LAB_HARDWARE.md and ../SETUP.md.

param(
    [string]$Port = "",
    [string]$Zip = "",
    [int]$Baud = 115200
)

$ErrorActionPreference = "Stop"

$here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $Zip) {
    $Zip = Join-Path $here "dist\recoil-dongle-dfu.zip"
}
if (-not (Test-Path $Zip)) {
    Write-Error "Missing $Zip — run .\build.ps1 first."
}

$nrf = Join-Path $env:USERPROFILE ".nrfutil\bin\nrfutil.exe"
if (-not (Test-Path $nrf)) {
    $cmd = Get-Command nrfutil -ErrorAction SilentlyContinue
    if ($cmd) { $nrf = $cmd.Source }
}

Write-Host "Package: $Zip"

# --- Preferred path: nrfutil device (detected Open DFU Bootloader) ---
if ($nrf -and (Test-Path $nrf)) {
    Write-Host "Trying: nrfutil device program (nordicDfu)…"
    & $nrf device program --firmware $Zip --traits nordicDfu
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "Flash finished. Dongle should re-enumerate as TSC Recoil Link (new COM port)."
        Write-Host "Ping needs a powered receiver; without one you will see TIMEOUT (USB still OK)."
        Write-Host "Next: flash the receiver, then: python -m modern_third_space.cli recoil ping --port COMx"
        exit 0
    }
    Write-Host "nrfutil device program failed (exit $LASTEXITCODE); trying legacy usb-serial…"
}

if (-not $Port) {
    Write-Error "Pass -Port COMx for legacy DFU (device must be in red-pulse Open DFU)."
}

$legacy = Get-ChildItem (Join-Path $env:USERPROFILE ".nrfutil\lib\nrfutil-nrf5sdk-tools") `
    -Filter "pc_nrfutil_legacy*.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $legacy) {
    Write-Error "Missing nrf5sdk-tools. Run: nrfutil install nrf5sdk-tools"
}

Write-Host "Flashing via legacy DFU → $Port"
& $legacy dfu usb-serial -pkg $Zip -p $Port -b $Baud
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Flash finished. Replug if needed. Expect product name TSC Recoil Link."

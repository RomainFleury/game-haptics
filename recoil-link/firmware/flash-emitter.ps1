# Flash Recoil Link TX onto the lab Nordic nRF52840 Dongle (PCA10059).
#
# 1. Plug the blue Nordic dongle into USB.
# 2. Press the sideways RESET button (not the white SW1).
# 3. Red LED should pulse/fade — Open DFU. Note the COM port (VID 1915:521F).
# 4. .\flash-emitter.ps1 -Port COM15
#
# See ../LAB_HARDWARE.md and ../SETUP.md.

param(
    [Parameter(Mandatory = $true)]
    [string]$Port,
    [string]$Zip = (Join-Path $PSScriptRoot "dist\recoil-dongle-dfu.zip"),
    [int]$Baud = 115200
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $Zip)) {
    Write-Error "Missing $Zip — run .\build.ps1 first."
}

Write-Host "Flashing Recoil Link TX (Open DFU) → $Port"
Write-Host "Package: $Zip"

$legacy = Get-ChildItem (Join-Path $env:USERPROFILE ".nrfutil\lib\nrfutil-nrf5sdk-tools") `
    -Filter "pc_nrfutil_legacy*.exe" -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $legacy) {
    Write-Error "Missing nrf5sdk-tools. Run: nrfutil install nrf5sdk-tools"
}

& $legacy dfu usb-serial -pkg $Zip -p $Port -b $Baud
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Flash finished. Unplug/replug the dongle (no RESET)."
Write-Host "It should enumerate as USB CDC 'Recoil Link TX'."
Write-Host "Then: python -m modern_third_space.cli recoil list"
Write-Host "      python -m modern_third_space.cli recoil ping --port COMx"

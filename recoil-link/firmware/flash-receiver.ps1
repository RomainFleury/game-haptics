# Flash Recoil Link RX onto a Nice!Nano-style board (UF2).
#
# 1. Plug USB-C. Short RST→GND twice quickly (no tactile button on lab board).
# 2. Wait for NICENANO (or similar) drive with INFO_UF2.TXT.
# 3. If INFO lists SoftDevice → default image. Else: -NoSoftDevice
# 4. .\flash-receiver.ps1 -Drive E:
#
# Keep the spare receiver unpowered.

param(
    [Parameter(Mandatory = $true)]
    [string]$Drive,
    [switch]$NoSoftDevice
)

$ErrorActionPreference = "Stop"
$root = if ($Drive -match '^[A-Za-z]:?$') {
    "$($Drive.TrimEnd(':').ToUpperInvariant()):\"
} else {
    $Drive
}

$info = Join-Path $root "INFO_UF2.TXT"
if (-not (Test-Path $info)) {
    Write-Error "No INFO_UF2.TXT on $root — board is not in UF2 bootloader."
}

$infoText = Get-Content $info -Raw
Write-Host "--- INFO_UF2.TXT ---"
Write-Host ($infoText -split "`n" | Select-Object -First 12 | Out-String)

$hasSd = $infoText -match '(?i)SoftDevice'
$uf2Name = if ($NoSoftDevice -or -not $hasSd) {
    if ($hasSd -and $NoSoftDevice) {
        Write-Warning "INFO lists SoftDevice but -NoSoftDevice was set."
    }
    "recoil-receiver-nosd.uf2"
} else {
    "recoil-receiver.uf2"
}

$src = Join-Path $PSScriptRoot "dist\$uf2Name"
if (-not (Test-Path $src)) {
    Write-Error "Missing $src — run .\build.ps1 first."
}

$dest = Join-Path $root $uf2Name
Write-Host "Copying $src → $dest"
try {
    Copy-Item $src $dest -Force
    Write-Host "Copy finished."
} catch {
    # UF2 devices often eject mid-copy; that is usually success.
    Write-Host "Copy ended with: $($_.Exception.Message)"
    Write-Host "(Eject during UF2 write is often normal.)"
}

Write-Host "Re-plug the receiver. LED should blink three times at boot."
Write-Host "Do not connect the solenoid until ping/pulse succeed with coil disconnected."

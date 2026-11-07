# Build Recoil Link firmware for this lab kit:
#   - Emitter: Nordic PCA10059 (nrf52840dongle) → hex + Open DFU zip
#   - Receiver: Nice!Nano-style → SoftDevice + nosd UF2s
#
# Usage (nRF Connect toolchain shell, or nrfutil toolchain-manager launch):
#   .\build.ps1 -NcsRoot C:\ncs\v2.9.0
#
# west on Windows cannot take an application on a different drive than the
# NCS workspace (C:). This script mirrors the firmware tree onto C: for the
# build, then copies artifacts back into this repo's build\ and dist\ folders.

param(
    [string]$NcsRoot = $(if ($env:NCS_ROOT) { $env:NCS_ROOT } else { "C:\ncs\v2.9.0" })
)

$ErrorActionPreference = "Stop"
$Firmware = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:ZEPHYR_BASE = Join-Path $NcsRoot "zephyr"
if (-not (Test-Path $env:ZEPHYR_BASE)) {
    Write-Error "Zephyr not found at $($env:ZEPHYR_BASE). Install nRF Connect SDK v2.9.0 and pass -NcsRoot."
}

$WorkRoot = Join-Path (Split-Path $NcsRoot -Parent) "recoil-link-firmware"
Write-Host "Mirroring firmware to $WorkRoot (west needs same drive as NCS)"
New-Item -ItemType Directory -Force -Path $WorkRoot | Out-Null
& robocopy $Firmware $WorkRoot /E /XD build dist .git vendor /NFL /NDL /NJH /NJS /nc /ns /np
if ($LASTEXITCODE -ge 8) {
    Write-Error "robocopy failed with code $LASTEXITCODE"
}

function Build-Image([string]$Board, [string]$App, [string]$OutName, [string[]]$ExtraArgs) {
    $out = Join-Path $WorkRoot "build\$OutName"
    Write-Host "Building $Board → $out"
    $args = @("build", "-p", "always", "-b", $Board, "-d", $out, (Join-Path $WorkRoot $App))
    if ($ExtraArgs -and $ExtraArgs.Count -gt 0) {
        $args += "--"
        $args += $ExtraArgs
    }
    & west @args
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Find-Artifact([string]$Src, [string]$App, [string]$Name) {
    $candidates = @(
        (Join-Path $WorkRoot "build\$Src\$App\zephyr\$Name"),
        (Join-Path $WorkRoot "build\$Src\zephyr\$Name")
    )
    return $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}

function New-DfuZip([string]$HexPath, [string]$ZipPath) {
    Write-Host "Packaging Open DFU zip: $ZipPath"
    # Call the legacy nrfutil binary directly. Wrapping via
    # `nrfutil nrf5sdk-tools …` can forward unsupported --log-level flags.
    # Install once: nrfutil install nrf5sdk-tools
    $legacy = Get-ChildItem (Join-Path $env:USERPROFILE ".nrfutil\lib\nrfutil-nrf5sdk-tools") `
        -Filter "pc_nrfutil_legacy*.exe" -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
    if (-not $legacy) {
        Write-Error "Missing nrf5sdk-tools. Run: nrfutil install nrf5sdk-tools"
    }
    Write-Host "Using $legacy"
    & $legacy pkg generate `
        --hw-version 52 `
        --sd-req 0x00 `
        --application $HexPath `
        --application-version 1 `
        $ZipPath
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $ZipPath)) {
        Write-Error "DFU zip packaging failed"
    }
}

Push-Location $NcsRoot
try {
    # Emitter: official PCA10059 board (Open Bootloader memory map)
    Build-Image "nrf52840dongle/nrf52840" "tx" "dongle" @()

    # Receiver UF2 targets (custom boards under BOARD_ROOT)
    Build-Image "recoil_receiver" "rx" "receiver" @("-DBOARD_ROOT=$WorkRoot")
    Build-Image "recoil_receiver_nosd" "rx" "receiver-nosd" @("-DBOARD_ROOT=$WorkRoot")

    $RepoBuild = Join-Path $Firmware "build"
    $Dist = Join-Path $Firmware "dist"
    New-Item -ItemType Directory -Force -Path (Join-Path $RepoBuild "dongle\zephyr") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $RepoBuild "receiver\zephyr") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $RepoBuild "receiver-nosd\zephyr") | Out-Null
    New-Item -ItemType Directory -Force -Path $Dist | Out-Null

    $dongleHex = Find-Artifact "dongle" "tx" "zephyr.hex"
    if (-not $dongleHex) {
        Write-Error "Missing dongle zephyr.hex"
    }
    Copy-Item $dongleHex (Join-Path $RepoBuild "dongle\zephyr\zephyr.hex") -Force
    Copy-Item $dongleHex (Join-Path $Dist "recoil-dongle.hex") -Force
    New-DfuZip $dongleHex (Join-Path $Dist "recoil-dongle-dfu.zip")
    Copy-Item (Join-Path $Dist "recoil-dongle-dfu.zip") (Join-Path $RepoBuild "dongle\zephyr\recoil-dongle-dfu.zip") -Force

    $rxPairs = @(
        @{ Src = "receiver"; App = "rx"; DistName = "recoil-receiver.uf2" },
        @{ Src = "receiver-nosd"; App = "rx"; DistName = "recoil-receiver-nosd.uf2" }
    )
    foreach ($p in $rxPairs) {
        $uf2 = Find-Artifact $p.Src $p.App "zephyr.uf2"
        if (-not $uf2) {
            Write-Error "Missing UF2 for $($p.Src)"
        }
        $destDir = Join-Path $RepoBuild "$($p.Src)\zephyr"
        New-Item -ItemType Directory -Force -Path $destDir | Out-Null
        Copy-Item $uf2 (Join-Path $destDir "zephyr.uf2") -Force
        Copy-Item $uf2 (Join-Path $Dist $p.DistName) -Force
    }

    Write-Host ""
    Write-Host "Artifacts ready:"
    Write-Host "  Emitter DFU:  $(Join-Path $Dist 'recoil-dongle-dfu.zip')"
    Write-Host "  Emitter hex:  $(Join-Path $Dist 'recoil-dongle.hex')"
    Write-Host "  Receiver UF2: $(Join-Path $Dist 'recoil-receiver.uf2')"
    Write-Host "  RX nosd UF2:  $(Join-Path $Dist 'recoil-receiver-nosd.uf2')"
    Write-Host ""
    Write-Host "Next: .\flash-emitter.ps1 -Port COMx"
    Write-Host "      .\flash-receiver.ps1 -Drive X:"
}
finally {
    Pop-Location
}

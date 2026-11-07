# Build and verify every game mod that must ship inside Electron resources/mods/.
# Used by windows/build-release.bat and web/scripts/build-release.mjs.
#
# Usage:
#   .\scripts\prepare-release-mods.ps1
#   .\scripts\prepare-release-mods.ps1 -SkipTitanfall2   # not recommended
#
# Exit 0 only when all required artifacts exist under mods/.

param(
    [switch]$SkipTitanfall2,
    [switch]$SkipMelon,
    [switch]$SkipL4d2Check
)

$ErrorActionPreference = "Stop"
# This file lives at <repo>/scripts/prepare-release-mods.ps1
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not (Test-Path (Join-Path $RepoRoot "web\package.json"))) {
    throw "Could not locate repo root from $PSScriptRoot"
}
Set-Location $RepoRoot

Write-Host "=== Prepare release mods ===" -ForegroundColor Cyan
Write-Host "Repo: $RepoRoot"

function Invoke-ModBuild([string]$RelScript) {
    $script = Join-Path $RepoRoot $RelScript
    if (-not (Test-Path $script)) {
        throw "Build script missing: $script"
    }
    Write-Host ""
    Write-Host ">>> $RelScript" -ForegroundColor Yellow
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script
    if ($LASTEXITCODE -ne 0) {
        throw "Build failed ($LASTEXITCODE): $RelScript"
    }
}

function Require-File([string]$RelPath) {
    $full = Join-Path $RepoRoot $RelPath
    if (-not (Test-Path $full)) {
        throw "Required artifact missing: $RelPath"
    }
    $item = Get-Item $full
    Write-Host ("  OK {0} ({1:N0} bytes)" -f $RelPath, $item.Length) -ForegroundColor Green
}

# --- Titanfall 2 (VS C++) ---
if (-not $SkipTitanfall2) {
    Invoke-ModBuild "titanfall2-mod\build.ps1"
    Require-File "mods\titanfall2\ThirdSpace_Titanfall2.dll"
    Require-File "mods\titanfall2\ThirdSpace_Titanfall2\mod.json"
} else {
    Write-Host "Skipping Titanfall 2 build (-SkipTitanfall2)" -ForegroundColor DarkYellow
    Require-File "mods\titanfall2\ThirdSpace_Titanfall2.dll"
    Require-File "mods\titanfall2\ThirdSpace_Titanfall2\mod.json"
}

# --- MelonLoader mods (.NET + MelonLoader in game install) ---
if (-not $SkipMelon) {
    $melonMods = @(
        @{ Script = "pistolwhip-mod\build.ps1"; Dll = "mods\pistolwhip\ThirdSpace_PistolWhip.dll" },
        @{ Script = "battlesister-mod\build.ps1"; Dll = "mods\battlesister\ThirdSpace_BattleSister.dll" },
        @{ Script = "gunmancontracts-mod\build.ps1"; Dll = "mods\gunmancontracts\ThirdSpace_GunmanContracts.dll" }
    )
    foreach ($m in $melonMods) {
        try {
            Invoke-ModBuild $m.Script
        } catch {
            Write-Host $_.Exception.Message -ForegroundColor Red
            Write-Host "MelonLoader mods need the game installed with MelonLoader 0.6+ (net6)," -ForegroundColor Yellow
            Write-Host "or pass -GameDir to the individual build.ps1. Release cannot ship without the DLL." -ForegroundColor Yellow
            throw
        }
        Require-File $m.Dll
    }
} else {
    Write-Host "Skipping Melon builds (-SkipMelon); verifying existing DLLs..." -ForegroundColor DarkYellow
    Require-File "mods\pistolwhip\ThirdSpace_PistolWhip.dll"
    Require-File "mods\battlesister\ThirdSpace_BattleSister.dll"
    Require-File "mods\gunmancontracts\ThirdSpace_GunmanContracts.dll"
}

# --- L4D2 VScripts (source of truth for electron-builder) ---
if (-not $SkipL4d2Check) {
    Write-Host ""
    Write-Host ">>> L4D2 VScript bundle check" -ForegroundColor Yellow
    $l4d2Dir = Join-Path $RepoRoot "misc-documentations\bhaptics-svg-24-nov\l4d2\third-space-vest-mod\scripts\vscripts"
    $requiredNuts = @(
        "coop.nut",
        "versus.nut",
        "survival.nut",
        "scavenge.nut",
        "thirdspacevest_haptics.nut"
    )
    foreach ($nut in $requiredNuts) {
        $p = Join-Path $l4d2Dir $nut
        if (-not (Test-Path $p)) {
            throw "L4D2 VScript missing: $p"
        }
        Write-Host ("  OK l4d2/{0}" -f $nut) -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "All required release mods are built and present." -ForegroundColor Green
exit 0

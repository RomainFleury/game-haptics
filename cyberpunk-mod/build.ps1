# Build TSC_Cyberpunk.dll (RED4ext plugin, x64 Release).
# Usage:
#   ./build.ps1
#   ./build.ps1 -Configuration Debug

param(
    [ValidateSet("Release", "Debug")]
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$modRoot = $PSScriptRoot
Set-Location $modRoot

Write-Host "=== TSC Cyberpunk 2077 plugin build ===" -ForegroundColor Cyan

function Find-CMake {
    $cmd = Get-Command cmake.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $found = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe" 2>$null
        if ($found) {
            $path = @($found) | Select-Object -First 1
            if ($path -and (Test-Path $path)) { return $path }
        }
    }

    $candidates = @(
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Professional\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Enterprise\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe",
        "${env:ProgramFiles}\CMake\bin\cmake.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    return $null
}

$cmake = Find-CMake
if (-not $cmake) {
    Write-Host "ERROR: cmake.exe not found." -ForegroundColor Red
    Write-Host "Install Visual Studio 2022 (Desktop development with C++) or CMake, then retry." -ForegroundColor Yellow
    exit 1
}
Write-Host "CMake: $cmake"

$sdk = Join-Path $modRoot "deps\RED4ext.SDK"
$sdkHeader = Join-Path $sdk "include\RED4ext\RED4ext.hpp"
if (-not (Test-Path $sdkHeader)) {
    Write-Host "RED4ext.SDK missing. Cloning into deps\RED4ext.SDK ..." -ForegroundColor Yellow
    if (Test-Path $sdk) {
        # Incomplete prior clone — remove and retry
        Remove-Item $sdk -Recurse -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Path (Join-Path $modRoot "deps") -Force | Out-Null
    git clone --depth 1 https://github.com/WopsS/RED4ext.SDK.git $sdk
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $sdkHeader)) {
        Write-Host "ERROR: Failed to clone RED4ext.SDK." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "RED4ext.SDK: $sdk"
}

$buildDir = Join-Path $modRoot "build"
New-Item -ItemType Directory -Path $buildDir -Force | Out-Null

& $cmake -S $modRoot -B $buildDir -G "Visual Studio 17 2022" -A x64 "-DRED4EXT_SDK_PATH=$sdk"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& $cmake --build $buildDir --config $Configuration
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$dllPath = Join-Path $buildDir "bin\x64\$Configuration\TSC_Cyberpunk.dll"
if (-not (Test-Path $dllPath)) {
    # CMake multi-config sometimes nests differently
    $alt = Get-ChildItem -Path $buildDir -Recurse -Filter "TSC_Cyberpunk.dll" -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($alt) { $dllPath = $alt.FullName }
}
if (-not (Test-Path $dllPath)) {
    Write-Host "ERROR: DLL not found after build" -ForegroundColor Red
    exit 1
}

$pkgPlugin = Join-Path $modRoot "package\red4ext\plugins\TSC_Cyberpunk"
New-Item -ItemType Directory -Path $pkgPlugin -Force | Out-Null
Copy-Item $dllPath (Join-Path $pkgPlugin "TSC_Cyberpunk.dll") -Force

$pkgScriptsRoot = Join-Path $modRoot "package\r6\scripts"
$pkgScripts = Join-Path $pkgScriptsRoot "TSC Haptics"
# Drop legacy folder name so the game reports "TSC Haptics", not "TSC"
$legacyPkgScripts = Join-Path $pkgScriptsRoot "TSC"
if (Test-Path $legacyPkgScripts) {
    Remove-Item $legacyPkgScripts -Recurse -Force
}
New-Item -ItemType Directory -Path $pkgScripts -Force | Out-Null
Copy-Item (Join-Path $modRoot "scripts\*") $pkgScripts -Force

$destDir = Join-Path $modRoot "..\mods\cyberpunk"
New-Item -ItemType Directory -Path $destDir -Force | Out-Null
Copy-Item $dllPath (Join-Path $destDir "TSC_Cyberpunk.dll") -Force
Copy-Item (Join-Path $modRoot "package\*") $destDir -Recurse -Force
$legacyModsScripts = Join-Path $destDir "r6\scripts\TSC"
if (Test-Path $legacyModsScripts) {
    Remove-Item $legacyModsScripts -Recurse -Force
}

Write-Host "Built: $dllPath" -ForegroundColor Green
Write-Host "Packaged: $pkgPlugin and $destDir" -ForegroundColor Green

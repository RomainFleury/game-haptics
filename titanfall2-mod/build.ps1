# Build ThirdSpace_Titanfall2.dll (Northstar plugin, x64 Release).
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

Write-Host "=== Third Space Vest Titanfall 2 plugin build ===" -ForegroundColor Cyan

function Find-MSBuild {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $found = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -find "MSBuild\**\Bin\MSBuild.exe" 2>$null
        if ($found) {
            $path = @($found) | Select-Object -First 1
            if ($path -and (Test-Path $path)) { return $path }
        }
    }

    $candidates = @(
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Professional\MSBuild\Current\Bin\MSBuild.exe",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Enterprise\MSBuild\Current\Bin\MSBuild.exe",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2019\BuildTools\MSBuild\Current\Bin\MSBuild.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }

    $cmd = Get-Command msbuild.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

$msbuild = Find-MSBuild
if (-not $msbuild) {
    Write-Host "ERROR: MSBuild not found." -ForegroundColor Red
    Write-Host "Install Visual Studio 2022 (Desktop development with C++) or" -ForegroundColor Yellow
    Write-Host "Build Tools: https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022" -ForegroundColor Yellow
    Write-Host "Then run:  .\titanfall2-mod\build.ps1" -ForegroundColor Yellow
    exit 1
}

$sln = Join-Path $modRoot "ThirdSpace_Titanfall2.sln"
if (-not (Test-Path $sln)) {
    Write-Host "ERROR: Solution not found at $sln" -ForegroundColor Red
    exit 1
}

Write-Host "MSBuild: $msbuild"
Write-Host "Building Release|x64..."
& $msbuild $sln /m /p:Configuration=$Configuration /p:Platform=x64 /v:minimal /nologo
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$dllPath = Join-Path $modRoot "bin\x64\$Configuration\ThirdSpace_Titanfall2.dll"
if (-not (Test-Path $dllPath)) {
    Write-Host "ERROR: DLL not found at $dllPath" -ForegroundColor Red
    exit 1
}

$destDir = Join-Path $modRoot "..\mods\titanfall2"
New-Item -ItemType Directory -Path $destDir -Force | Out-Null
Copy-Item $dllPath (Join-Path $destDir "ThirdSpace_Titanfall2.dll") -Force

# Northstar mod package (mod.json + vscripts) for Electron Install Mod / release bundle
$modSrc = Join-Path $modRoot "ThirdSpace_Titanfall2\mod\ThirdSpace_Titanfall2"
$modDest = Join-Path $destDir "ThirdSpace_Titanfall2"
if (-not (Test-Path (Join-Path $modSrc "mod.json"))) {
    Write-Host "ERROR: Northstar mod folder missing mod.json at $modSrc" -ForegroundColor Red
    exit 1
}
if (Test-Path $modDest) {
    Remove-Item $modDest -Recurse -Force
}
Copy-Item $modSrc $modDest -Recurse -Force

$readmeSrc = Join-Path $destDir "README.md"
if (-not (Test-Path $readmeSrc)) {
    @"
# Titanfall 2 Northstar plugin

Built by ``titanfall2-mod\build.ps1``. Electron **Install Mod** copies:

- ``ThirdSpace_Titanfall2.dll`` → profile ``plugins\``
- ``ThirdSpace_Titanfall2\`` → profile ``mods\``

Release builds must ship this folder under ``mods/titanfall2/`` (see ``BUILD-RELEASE.md``).
"@ | Set-Content -Encoding utf8 $readmeSrc
}

Write-Host "Built $dllPath" -ForegroundColor Green
Write-Host "Copied to mods\titanfall2\ThirdSpace_Titanfall2.dll" -ForegroundColor Green
Write-Host "Copied Northstar mod to mods\titanfall2\ThirdSpace_Titanfall2\" -ForegroundColor Green

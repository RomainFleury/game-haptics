# Build ThirdSpace_GunmanContracts.dll against MelonLoader 0.7 net6 (Il2Cpp).
# Usage:
#   ./build.ps1
#   ./build.ps1 -GameDir "F:\SteamLibrary\steamapps\common\Gunman Contracts"

param(
    [string]$GameDir = ""
)

$ErrorActionPreference = "Stop"
$modRoot = $PSScriptRoot
Set-Location $modRoot

Write-Host "=== Third Space Vest Gunman Contracts Mod Build ===" -ForegroundColor Cyan

if (-not $GameDir) {
    $candidates = @(
        "F:\SteamLibrary\steamapps\common\Gunman Contracts",
        "F:\SteamLibrary\steamapps\common\GunmanContracts",
        "C:\Program Files (x86)\Steam\steamapps\common\Gunman Contracts",
        "C:\Program Files (x86)\Steam\steamapps\common\GunmanContracts"
    )
    foreach ($c in $candidates) {
        if (-not (Test-Path $c)) { continue }
        $exes = @(
            (Join-Path $c "Gunman Contracts.exe"),
            (Join-Path $c "GunmanContracts.exe"),
            (Join-Path $c "GunmanContractsStandalone.exe")
        )
        foreach ($exe in $exes) {
            if (Test-Path $exe) { $GameDir = $c; break }
        }
        if ($GameDir) { break }
        if (Test-Path (Join-Path $c "MelonLoader\net6\MelonLoader.dll")) {
            $GameDir = $c
            break
        }
    }
}

$melonDll = $null
$melonDir = $null
if ($GameDir) {
    $candidate = Join-Path $GameDir "MelonLoader\net6\MelonLoader.dll"
    if (Test-Path $candidate) {
        $melonDll = $candidate
        $melonDir = $GameDir
    }
}

$pistolWhip = "F:\SteamLibrary\steamapps\common\Pistol Whip"
if (-not $melonDll -and (Test-Path (Join-Path $pistolWhip "MelonLoader\net6\MelonLoader.dll"))) {
    $melonDll = Join-Path $pistolWhip "MelonLoader\net6\MelonLoader.dll"
    Write-Host "Gunman Contracts MelonLoader/net6 not found; using Pistol Whip MelonLoader refs to compile." -ForegroundColor Yellow
}

if (-not $melonDll -and (Test-Path (Join-Path $modRoot "libs\MelonLoader.dll"))) {
    $melonDll = Join-Path $modRoot "libs\MelonLoader.dll"
}

if (-not $melonDll) {
    Write-Host "ERROR: MelonLoader.net6 not found. Install MelonLoader into Gunman Contracts, or pass -GameDir." -ForegroundColor Red
    exit 1
}

$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) {
    Write-Host "ERROR: .NET SDK not found. Install .NET 6 or 8 SDK, then retry." -ForegroundColor Red
    exit 1
}

$csproj = Join-Path $modRoot "ThirdSpace_GunmanContracts\ThirdSpace_GunmanContracts.csproj"
$buildArgs = @("build", $csproj, "-c", "Release", "--nologo")
if ($melonDir) {
    $buildArgs += "/p:GunmanContractsDir=$melonDir"
} elseif ($pistolWhip -and (Test-Path (Join-Path $pistolWhip "MelonLoader\net6\MelonLoader.dll"))) {
    $buildArgs += "/p:PistolWhipDir=$pistolWhip"
}

Write-Host "Building with $melonDll"
& dotnet @buildArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$dllPath = Join-Path $modRoot "ThirdSpace_GunmanContracts\bin\Release\ThirdSpace_GunmanContracts.dll"
if (-not (Test-Path $dllPath)) {
    Write-Host "ERROR: DLL not found at $dllPath" -ForegroundColor Red
    exit 1
}

$destDir = Join-Path $modRoot "..\mods\gunmancontracts"
New-Item -ItemType Directory -Path $destDir -Force | Out-Null
Copy-Item $dllPath (Join-Path $destDir "ThirdSpace_GunmanContracts.dll") -Force
Write-Host "Built $dllPath" -ForegroundColor Green
Write-Host "Copied to mods/gunmancontracts/ThirdSpace_GunmanContracts.dll" -ForegroundColor Green

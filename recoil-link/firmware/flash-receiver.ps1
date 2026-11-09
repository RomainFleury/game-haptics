# Flash Recoil Link RX onto a Nice!Nano-style board (UF2).
#
# **Read/update ../FLASH_ATTEMPT_LOG.md on every try.** Do not invent SoftDevice history.
#
# SoftDevice present  → flash recoil-receiver.uf2 @ 0x26000 (release SD at boot, then ESB)
# SoftDevice absent   → flash recoil-receiver-nosd.uf2 @ 0x1000
# SoftDevice-era apps: -Save / -Restore (CURRENT.UF2 under backups/)
#
# Adafruit: SoftDevice present → skips writes below 0x26000 (nosd is a silent no-op).
# SoftDevice absent → SoftDevice-region writes accepted (restore works); app @ 0x26000 will not boot.

param(
    [Parameter(Mandatory = $true)]
    [string]$Drive,
    # Snapshot CURRENT.UF2 + INFO from the bootloader volume (CircuitPython, etc.)
    [switch]$Save,
    # Re-install a previous -Save folder or a .uf2 file (SoftDevice + app dump)
    [string]$Restore = "",
    # Before flashing nosd, always snapshot CURRENT.UF2 if present (default on)
    [switch]$NoAutoSave,
    # USB workaround when SoftDevice cannot be wiped yet: flash recoil-receiver.uf2
    # (@ 0x26000). That image disables SoftDevice at boot then starts ESB.
    [switch]$SoftDeviceSlot
)

$ErrorActionPreference = "Stop"
$BackupRoot = Join-Path $PSScriptRoot "backups"
. (Join-Path $PSScriptRoot "RecoilImageCheck.ps1")

function Resolve-DriveRoot([string]$Drive) {
    if ($Drive -match '^[A-Za-z]:?$') {
        return "$($Drive.TrimEnd(':').ToUpperInvariant()):\"
    }
    return $Drive
}

function Read-SoftDeviceState([string]$InfoText) {
    $sdValue = $null
    if ($InfoText -match '(?im)^\s*SoftDevice\s*:\s*(.+?)\s*$') {
        $sdValue = $Matches[1].Trim()
    }
    $hasSd = $sdValue -and ($sdValue -notmatch '(?i)^(not found|none|n\/a|-)$')
    return @{ Value = $sdValue; Present = [bool]$hasSd }
}

function Save-ReceiverBackup([string]$Root, [string]$InfoText, [string]$Label) {
    $current = Join-Path $Root "CURRENT.UF2"
    if (-not (Test-Path $current)) {
        Write-Error "No CURRENT.UF2 on $Root — cannot save. Is this an Adafruit UF2 volume?"
    }
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $safeLabel = if ($Label) { ($Label -replace '[^\w\-]+', '-').Trim('-') } else { "rx" }
    if (-not $safeLabel) { $safeLabel = "rx" }
    $dest = Join-Path $BackupRoot "$safeLabel-$stamp"
    New-Item -ItemType Directory -Force -Path $dest | Out-Null

    Copy-Item $current (Join-Path $dest "CURRENT.UF2") -Force
    Copy-Item (Join-Path $Root "INFO_UF2.TXT") (Join-Path $dest "INFO_UF2.TXT") -Force
    $index = Join-Path $Root "INDEX.HTM"
    if (Test-Path $index) {
        Copy-Item $index (Join-Path $dest "INDEX.HTM") -Force
    }

    $sd = Read-SoftDeviceState $InfoText
    $size = (Get-Item (Join-Path $dest "CURRENT.UF2")).Length
    $readme = @"
Recoil Link receiver flash backup
Saved: $(Get-Date -Format o)
Source volume: $Root
SoftDevice: $(if ($sd.Present) { $sd.Value } else { "not found" })
CURRENT.UF2 bytes: $size

Restore (re-install this SoftDevice-era firmware):
  .\flash-receiver.ps1 -Drive X: -Restore "$dest"

Then re-plug. SoftDevice apps (e.g. CircuitPython) need SoftDevice present after restore.
"@
    Set-Content -Path (Join-Path $dest "README.txt") -Value $readme -Encoding UTF8
    Write-Host "Saved backup → $dest"
    Write-Host "  CURRENT.UF2 ($size bytes), SoftDevice: $(if ($sd.Present) { $sd.Value } else { 'not found' })"
    return $dest
}

function Restore-ReceiverBackup([string]$Root, [string]$RestorePath) {
    $uf2 = $null
    if (Test-Path $RestorePath -PathType Leaf) {
        $uf2 = $RestorePath
    } elseif (Test-Path (Join-Path $RestorePath "CURRENT.UF2")) {
        $uf2 = Join-Path $RestorePath "CURRENT.UF2"
    } else {
        Write-Error "Restore path must be a .uf2 file or a backup folder containing CURRENT.UF2: $RestorePath"
    }
    if (-not (Test-Path $uf2)) {
        Write-Error "Missing $uf2"
    }

    $name = Split-Path $uf2 -Leaf
    $dest = Join-Path $Root $name
    Write-Host "Restoring $uf2 → $dest"
    try {
        Copy-Item $uf2 $dest -Force
        Write-Host "Restore copy finished."
    } catch {
        Write-Host "Copy ended with: $($_.Exception.Message)"
        Write-Host "(Eject during UF2 write is often normal.)"
    }
    Write-Host "Re-plug the board. If this was a SoftDevice dump, INFO should list SoftDevice again after the next UF2 entry."
}

# --- main ---
$root = Resolve-DriveRoot $Drive
$info = Join-Path $root "INFO_UF2.TXT"
if (-not (Test-Path $info)) {
    Write-Error "No INFO_UF2.TXT on $root — board is not in UF2 bootloader."
}

$infoText = Get-Content $info -Raw
Write-Host "--- INFO_UF2.TXT ---"
Write-Host ($infoText -split "`n" | Select-Object -First 12 | Out-String)
$sd = Read-SoftDeviceState $infoText

$volumeLabel = $null
try {
    $letter = $root.Substring(0, 1)
    $volumeLabel = (Get-Volume -DriveLetter $letter -ErrorAction SilentlyContinue).FileSystemLabel
} catch { }

if ($Save -and $Restore) {
    Write-Error "Use either -Save or -Restore, not both."
}

# -Save alone = backup only. -Save with a flash intent (default path, or
# -SoftDeviceSlot) snapshots then continues to flash.
$saveOnly = $Save -and -not $SoftDeviceSlot -and -not $Restore
# Detect "flash after save": any non-save/restore switch means continue.
# SoftDeviceSlot is the explicit flash selector; bare Drive also flashes.

if ($Restore) {
    Restore-ReceiverBackup $root $Restore
    return
}

if ($Save) {
    [void](Save-ReceiverBackup $root $infoText $volumeLabel)
    if ($saveOnly) {
        return
    }
    Write-Host "Save done — continuing to flash."
}

# --- Flash Recoil ---
# SoftDevice present → SoftDevice-slot image @ 0x26000 (disables SD at boot, then ESB)
# SoftDevice absent  → nosd @ 0x1000
$useSdSlot = $SoftDeviceSlot -or $sd.Present
if ($SoftDeviceSlot -and -not $sd.Present) {
    Write-Error "SoftDevice: not found — use default nosd flash (omit -SoftDeviceSlot)."
}

if ($useSdSlot) {
    $uf2Name = "recoil-receiver.uf2"
    $expectedAddr = [uint32]0x26000
    Write-Host "SoftDevice present ($($sd.Value)) → SoftDevice-slot Recoil @ 0x26000 (release SD at boot, then ESB)"
} else {
    $uf2Name = "recoil-receiver-nosd.uf2"
    $expectedAddr = [uint32]0x1000
    Write-Host "SoftDevice not found → Recoil nosd @ 0x1000"
}

$src = Join-Path $PSScriptRoot "dist\$uf2Name"
if (-not (Test-Path $src)) {
    $hint = if ($useSdSlot) { "rx" } else { "rx-nosd" }
    Write-Error "Missing $src — run .\build.ps1 -Target $hint first."
}

$kind = if ($useSdSlot) { "sd" } else { "nosd" }
try {
    $vectors = Assert-RecoilUf2 -Path $src -Kind $kind
} catch {
    Write-Error $_.Exception.Message
}
if ($vectors.Load -ne $expectedAddr) {
    Write-Error ("UF2 start mismatch for {0}: got 0x{1:X}, expected 0x{2:X}. Rebuild." -f $uf2Name, $vectors.Load, $expectedAddr)
}

if (-not $NoAutoSave -and (Test-Path (Join-Path $root "CURRENT.UF2"))) {
    Write-Host "Auto-saving CURRENT.UF2 before flash..."
    [void](Save-ReceiverBackup $root $infoText $volumeLabel)
}

Write-Host ("UF2 OK: {0} (load 0x{1:X} Reset 0x{2:X8})" -f $src, $vectors.Load, $vectors.Reset)
$dest = Join-Path $root $uf2Name
Write-Host "Copying $src → $dest"
try {
    Copy-Item $src $dest -Force
    Write-Host "Copy finished."
} catch {
    Write-Host "Copy ended with: $($_.Exception.Message)"
    Write-Host "(Eject during UF2 write is often normal.)"
}

Write-Host ""
Write-Host "Re-plug / let the board reset."
Write-Host "Expect: short solid blue → 3 blinks → idle off."
Write-Host "Fail-safe: N blinks + ~2s dark (5 = SoftDevice release failed)."
Write-Host "Do not connect the solenoid until ping/pulse succeed with coil disconnected."
Write-Host "Restore CircuitPython later: .\flash-receiver.ps1 -Drive X: -Restore .\backups\<folder>"
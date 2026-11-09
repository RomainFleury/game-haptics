# Shared link check for Recoil Link images.
# UF2 load address and the reset vector inside the image must be the same window.
# A load address of 0x26000 with Reset=0x00002801 means the file was stored in
# the SoftDevice slot but linked at 0 — the CPU never reaches main.

function Get-Uf2Vectors([string]$Path) {
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 40 -or $bytes[0] -ne 0x55 -or $bytes[1] -ne 0x46 -or $bytes[2] -ne 0x32) {
        throw "Not a UF2 file: $Path"
    }
    return [pscustomobject]@{
        Load  = [BitConverter]::ToUInt32($bytes, 12)
        Sp    = [BitConverter]::ToUInt32($bytes, 32)
        Reset = [BitConverter]::ToUInt32($bytes, 36)
    }
}

function Assert-RecoilUf2 {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][ValidateSet("sd", "nosd")][string]$Kind
    )
    $v = Get-Uf2Vectors $Path
    $reset = $v.Reset -band 0xFFFFFFFE
    $appEnd = [uint32]0xF4000
    $ramEnd = [uint32]0x20040000
    $errors = New-Object System.Collections.Generic.List[string]
    if (($v.Reset -band 1) -eq 0) {
        $errors.Add("Reset 0x$($v.Reset.ToString('X8')) is not a Thumb vector")
    }
    if ($Kind -eq "sd") {
        if ($v.Load -ne [uint32]0x26000) {
            $errors.Add("load 0x$($v.Load.ToString('X')) — SoftDevice-slot image must load at 0x26000")
        }
        if ($reset -lt [uint32]0x26000 -or $reset -ge $appEnd) {
            $errors.Add("Reset 0x$($v.Reset.ToString('X8')) is outside 0x26000..0xF3FFF (linked at 0, stored at 0x26000)")
        }
        if ($v.Sp -lt [uint32]0x20004000 -or $v.Sp -gt $ramEnd) {
            $errors.Add("SP 0x$($v.Sp.ToString('X8')) is outside SoftDevice-safe RAM 0x20004000..0x20040000")
        }
    } else {
        if ($v.Load -ne [uint32]0x1000) {
            $errors.Add("load 0x$($v.Load.ToString('X')) — nosd image must load at 0x1000")
        }
        if ($reset -lt [uint32]0x1000 -or $reset -ge $appEnd) {
            $errors.Add("Reset 0x$($v.Reset.ToString('X8')) is outside 0x1000..0xF3FFF")
        }
        if ($v.Sp -lt [uint32]0x20000000 -or $v.Sp -gt $ramEnd) {
            $errors.Add("SP 0x$($v.Sp.ToString('X8')) is outside SRAM")
        }
    }
    $msg = "UF2 {0}: load=0x{1:X} SP=0x{2:X8} Reset=0x{3:X8}" -f (Split-Path $Path -Leaf), $v.Load, $v.Sp, $v.Reset
    if ($errors.Count -gt 0) {
        throw ($msg + [Environment]::NewLine + ($errors -join [Environment]::NewLine))
    }
    Write-Host $msg
    return $v
}

function Get-IntelHexRange([string]$Path) {
    $min = [uint64]::MaxValue
    $max = [uint64]0
    $upper = [uint64]0
    foreach ($line in [System.IO.File]::ReadLines($Path)) {
        if ($line.Length -lt 11 -or $line[0] -ne ':') { continue }
        $count = [Convert]::ToInt32($line.Substring(1, 2), 16)
        $addr = [Convert]::ToInt32($line.Substring(3, 4), 16)
        $type = [Convert]::ToInt32($line.Substring(7, 2), 16)
        if ($type -eq 4 -and $count -ge 2) {
            $upper = ([uint64][Convert]::ToUInt32($line.Substring(9, 4), 16)) -shl 16
        } elseif ($type -eq 2 -and $count -ge 2) {
            $upper = ([uint64][Convert]::ToUInt32($line.Substring(9, 4), 16)) -shl 4
        } elseif ($type -eq 0 -and $count -gt 0) {
            $start = $upper + [uint64]$addr
            $end = $start + [uint64]$count
            if ($start -lt $min) { $min = $start }
            if ($end -gt $max) { $max = $end }
        } elseif ($type -eq 1) {
            break
        }
    }
    if ($min -eq [uint64]::MaxValue) {
        throw "No data records in $Path"
    }
    return [pscustomobject]@{ Min = [uint32]$min; Max = [uint32]$max }
}

function Get-IntelHexBytes([string]$Path, [uint32]$Address, [int]$Count) {
    $buf = New-Object byte[] $Count
    $got = New-Object bool[] $Count
    $upper = [uint64]0
    foreach ($line in [System.IO.File]::ReadLines($Path)) {
        if ($line.Length -lt 11 -or $line[0] -ne ':') { continue }
        $nbytes = [Convert]::ToInt32($line.Substring(1, 2), 16)
        $addr = [Convert]::ToInt32($line.Substring(3, 4), 16)
        $type = [Convert]::ToInt32($line.Substring(7, 2), 16)
        if ($type -eq 4 -and $nbytes -ge 2) {
            $upper = ([uint64][Convert]::ToUInt32($line.Substring(9, 4), 16)) -shl 16
        } elseif ($type -eq 2 -and $nbytes -ge 2) {
            $upper = ([uint64][Convert]::ToUInt32($line.Substring(9, 4), 16)) -shl 4
        } elseif ($type -eq 0 -and $nbytes -gt 0) {
            $start = $upper + [uint64]$addr
            for ($i = 0; $i -lt $nbytes; $i++) {
                $abs = $start + [uint64]$i
                if ($abs -ge $Address -and $abs -lt ([uint64]$Address + [uint64]$Count)) {
                    $idx = [int]($abs - [uint64]$Address)
                    if ($idx -ge 0 -and $idx -lt $Count) {
                        $buf[$idx] = [Convert]::ToByte($line.Substring(9 + (2 * $i), 2), 16)
                        $got[$idx] = $true
                    }
                }
            }
        } elseif ($type -eq 1) {
            break
        }
    }
    for ($i = 0; $i -lt $Count; $i++) {
        if (-not $got[$i]) {
            throw ("HEX {0} is missing byte at 0x{1:X}" -f (Split-Path $Path -Leaf), ($Address + [uint32]$i))
        }
    }
    return $buf
}

function Assert-RecoilDongleHex([string]$Path) {
    $span = Get-IntelHexRange $Path
    $vec = Get-IntelHexBytes $Path $span.Min 8
    $sp = [BitConverter]::ToUInt32($vec, 0)
    $reset = [BitConverter]::ToUInt32($vec, 4)
    $resetAddr = $reset -band 0xFFFFFFFE
    $bootloader = [uint32]0xE0000
    $errors = New-Object System.Collections.Generic.List[string]
    if ($span.Min -ne [uint32]0x1000) {
        $errors.Add("first byte at 0x$($span.Min.ToString('X')) — PCA10059 app must start at 0x1000")
    }
    if (($reset -band 1) -eq 0 -or $resetAddr -lt [uint32]0x1000 -or $resetAddr -ge $bootloader) {
        $errors.Add("Reset 0x$($reset.ToString('X8')) is outside 0x1000..0xDFFFF")
    }
    if ($sp -lt [uint32]0x20000000 -or $sp -gt [uint32]0x20040000) {
        $errors.Add("SP 0x$($sp.ToString('X8')) is outside SRAM")
    }
    if ($span.Max -gt $bootloader) {
        $errors.Add("image ends at 0x$($span.Max.ToString('X')), which overlaps the Open Bootloader at 0xE0000")
    }
    $msg = "HEX {0}: start=0x{1:X} end=0x{2:X} SP=0x{3:X8} Reset=0x{4:X8}" -f (Split-Path $Path -Leaf), $span.Min, $span.Max, $sp, $reset
    if ($errors.Count -gt 0) {
        throw ($msg + [Environment]::NewLine + ($errors -join [Environment]::NewLine))
    }
    Write-Host $msg
}

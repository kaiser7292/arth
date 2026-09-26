# Checks the release APK and AAB before they are published.
#
#   powershell -ExecutionPolicy Bypass -File scripts\verify-release.ps1
#
# For each file: signing certificate SHA-256 (must match the Arth release key),
# version, size, and 16 KB page-size alignment of every native library
# (Play rejects uploads whose .so files are not 16 KB aligned).
# Exits 1 if any check fails.

$ErrorActionPreference = "Stop"

$ExpectedSha256 = "4DD590CD90CA6F32A93C0B6FC6A4D4DD57AA52729774016C049C34E62767FAEB"
$Root = Split-Path -Parent $PSScriptRoot
$Apk = Join-Path $Root "android\app\build\outputs\apk\release\app-arm64-v8a-release.apk"
$Aab = Join-Path $Root "android\app\build\outputs\bundle\release\app-release.aab"

$script:Failed = $false
function Pass($msg) { Write-Host "  [ok]   $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red; $script:Failed = $true }
function Info($msg) { Write-Host "         $msg" }

# ── Tools ─────────────────────────────────────────────────────────────────────

$sdkCandidates = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA "Android\Sdk")) | Where-Object { $_ }
$buildTools = $null
foreach ($sdk in $sdkCandidates) {
    $dir = Join-Path $sdk "build-tools"
    if (Test-Path $dir) {
        $found = Get-ChildItem $dir -Directory | Sort-Object { [version]($_.Name -replace '[^0-9.]', '') } -Descending |
            Where-Object { Test-Path (Join-Path $_.FullName "apksigner.bat") } | Select-Object -First 1
        if ($found) { $buildTools = $found.FullName; break }
    }
}
if (-not $buildTools) { Write-Host "Android build-tools (apksigner) not found." -ForegroundColor Red; exit 1 }
$apksigner = Join-Path $buildTools "apksigner.bat"
$aapt2 = Join-Path $buildTools "aapt2.exe"

$keytool = (Get-Command keytool -ErrorAction SilentlyContinue).Source
if (-not $keytool -and $env:JAVA_HOME) { $keytool = Join-Path $env:JAVA_HOME "bin\keytool.exe" }
if (-not $keytool -or -not (Test-Path $keytool)) {
    $keytool = Get-ChildItem "C:\Program Files\Java\*\bin\keytool.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $keytool) { Write-Host "keytool not found (install a JDK)." -ForegroundColor Red; exit 1 }

Add-Type -AssemblyName System.IO.Compression.FileSystem

# ── Helpers ───────────────────────────────────────────────────────────────────

function Normalize-Sha($s) { ($s -replace '[^0-9A-Fa-f]', '').ToUpper() }

function Check-Signer($sha, $label) {
    if (-not $sha) { Fail "$label is not signed"; return }
    if ((Normalize-Sha $sha) -eq $ExpectedSha256) { Pass "$label signed with the Arth release key" }
    else { Fail "$label signed with an UNEXPECTED key ($sha) - debug key or wrong keystore" }
}

# Returns the smallest PT_LOAD p_align in a 64-bit little-endian ELF, or $null.
function Get-MinLoadAlign([byte[]]$b) {
    if ($b.Length -lt 64 -or $b[0] -ne 0x7F -or $b[1] -ne 0x45 -or $b[4] -ne 2) { return $null }
    $phoff = [BitConverter]::ToUInt64($b, 0x20)
    $phentsize = [BitConverter]::ToUInt16($b, 0x36)
    $phnum = [BitConverter]::ToUInt16($b, 0x38)
    $min = $null
    for ($i = 0; $i -lt $phnum; $i++) {
        $off = [int]($phoff + $i * $phentsize)
        if ([BitConverter]::ToUInt32($b, $off) -eq 1) {
            $align = [BitConverter]::ToUInt64($b, $off + 48)
            if ($null -eq $min -or $align -lt $min) { $min = $align }
        }
    }
    return $min
}

function Check-NativeLibs($path, $label) {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($path)
    try {
        $libs = $zip.Entries | Where-Object { $_.FullName -like "*.so" }
        # ABI folders only: lib/<abi>/ in an APK, base/lib/<abi>/ in an AAB.
        # (llama.rn also ships Qualcomm DSP blobs under assets/, which aren't ARM code.)
        $abis = $libs | Where-Object { $_.FullName -match '(^|/)lib/([^/]+)/[^/]+\.so$' } |
            ForEach-Object { ($_.FullName -split '/')[-2] } | Sort-Object -Unique
        Info "Native ABIs: $($abis -join ', ')"
        if ($abis | Where-Object { $_ -ne "arm64-v8a" }) { Fail "$label contains ABIs other than arm64-v8a" }
        $bad = @()
        foreach ($e in $libs) {
            $s = $e.Open(); $ms = New-Object System.IO.MemoryStream
            try { $s.CopyTo($ms) } finally { $s.Dispose() }
            $align = Get-MinLoadAlign $ms.ToArray()
            if ($null -ne $align -and $align -lt 16384) { $bad += "$($e.Name) (0x$('{0:X}' -f $align))" }
        }
        if ($bad.Count -eq 0) { Pass "$($libs.Count) native libraries are 16 KB aligned" }
        else { Fail "Not 16 KB aligned: $($bad -join ', ')" }
    } finally { $zip.Dispose() }
}

# ── APK ───────────────────────────────────────────────────────────────────────

Write-Host "`nAPK  $Apk"
if (-not (Test-Path $Apk)) { Fail "APK not found - run .\gradlew assembleRelease bundleRelease" }
else {
    Info ("Size: {0:N1} MB, built {1}" -f ((Get-Item $Apk).Length / 1MB), (Get-Item $Apk).LastWriteTime)
    $badging = & $aapt2 dump badging $Apk 2>$null | Select-String "^package:" | Select-Object -First 1
    if ($badging -match "name='([^']+)' versionCode='(\d+)' versionName='([^']+)'") {
        Info "Package $($Matches[1]), version $($Matches[3]) (versionCode $($Matches[2]))"
    }
    $certs = & $apksigner verify --print-certs $Apk 2>&1
    if ($LASTEXITCODE -ne 0) { Fail "apksigner verify failed: $certs" }
    else {
        $line = $certs | Select-String "SHA-256 digest:" | Select-Object -First 1
        Check-Signer (($line -split "digest:")[-1]).Trim() "APK"
    }
    & (Join-Path $buildTools "zipalign.exe") -c -P 16 4 $Apk *> $null
    if ($LASTEXITCODE -eq 0) { Pass "APK zip entries are 16 KB aligned" } else { Fail "APK zip entries are not 16 KB aligned (zipalign -c -P 16)" }
    Check-NativeLibs $Apk "APK"
}

# ── AAB ───────────────────────────────────────────────────────────────────────

Write-Host "`nAAB  $Aab"
if (-not (Test-Path $Aab)) { Fail "AAB not found - run .\gradlew assembleRelease bundleRelease" }
else {
    Info ("Size: {0:N1} MB, built {1}" -f ((Get-Item $Aab).Length / 1MB), (Get-Item $Aab).LastWriteTime)
    if ((Test-Path $Apk) -and [math]::Abs(((Get-Item $Aab).LastWriteTime - (Get-Item $Apk).LastWriteTime).TotalMinutes) -gt 30) {
        Fail "APK and AAB were built more than 30 minutes apart - rebuild both together so they match"
    }
    $printcert = & $keytool -printcert -jarfile $Aab 2>&1
    $line = $printcert | Select-String "SHA256:" | Select-Object -First 1
    if ($line) { Check-Signer (($line -split "SHA256:")[-1]).Trim() "AAB" } else { Fail "AAB is not signed" }
    Check-NativeLibs $Aab "AAB"
}

Write-Host ""
if ($script:Failed) { Write-Host "Release check FAILED" -ForegroundColor Red; exit 1 }
Write-Host "Release check passed" -ForegroundColor Green

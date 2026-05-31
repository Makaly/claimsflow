<#
.SYNOPSIS
  Authenticode-sign a Windows .exe with signtool on a Windows runner.

.DESCRIPTION
  Signs in place when a base64 code-signing cert is supplied via env vars;
  otherwise logs a notice and exits 0 so unsigned builds still succeed.

  Env:
    WINDOWS_CERT_BASE64    base64 of the code-signing .pfx / .p12   (required to sign)
    WINDOWS_CERT_PASSWORD  the .pfx password                        (required to sign)
    TSA_URL                RFC-3161 timestamp authority (default: http://timestamp.sectigo.com)

  Produce WINDOWS_CERT_BASE64 from a .pfx:
    [Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx")) | Set-Content cert.b64
#>
param(
  [Parameter(Mandatory = $true)][string]$File
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $File)) { Write-Error "sign: target not found: $File"; exit 1 }

if (-not $env:WINDOWS_CERT_BASE64 -or -not $env:WINDOWS_CERT_PASSWORD) {
  Write-Host "ℹ  sign: WINDOWS_CERT_BASE64 / WINDOWS_CERT_PASSWORD not set — '$File' ships UNSIGNED."
  Write-Host "   Add them under repo → Settings → Secrets and variables → Actions."
  exit 0
}

# Locate the newest signtool.exe from the Windows SDK
$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) { Write-Error "sign: signtool.exe not found (Windows SDK missing)"; exit 1 }

$tsa  = if ($env:TSA_URL) { $env:TSA_URL } else { "http://timestamp.sectigo.com" }
$pfx  = Join-Path $env:RUNNER_TEMP "cert.pfx"
if (-not $env:RUNNER_TEMP) { $pfx = Join-Path ([IO.Path]::GetTempPath()) "cert.pfx" }

try {
  [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($env:WINDOWS_CERT_BASE64))
  Write-Host "→ Signing $File (SHA-256, timestamped via $tsa)…"
  & $signtool.FullName sign /f $pfx /p $env:WINDOWS_CERT_PASSWORD `
      /fd sha256 /tr $tsa /td sha256 /d "ClaimsFlow Scan Agent" $File
  if ($LASTEXITCODE -ne 0) { Write-Error "signtool failed ($LASTEXITCODE)"; exit 1 }
  & $signtool.FullName verify /pa $File
  if ($LASTEXITCODE -ne 0) { Write-Error "signature verification failed"; exit 1 }
  Write-Host "✓ Signed: $File"
}
finally {
  if (Test-Path $pfx) { Remove-Item $pfx -Force }
}

# ============================================================
#  ClaimsFlow Scan Agent — Windows installer (PowerShell)
#
#  One-liner (interactive):
#    irm https://github.com/Makaly/claimsflow/releases/download/scan-agent-latest/install.ps1 | iex
#
#  Non-interactive (skip prompts, install service silently):
#    iwr https://github.com/Makaly/claimsflow/releases/download/scan-agent-latest/install.ps1 -OutFile install.ps1
#    powershell -ExecutionPolicy Bypass -File install.ps1 -AutoStart -Silent
#
#  Parameters:
#    -AutoStart       Register and start the Windows service (default: prompted)
#    -NoAutoStart     Install binary only, no service
#    -Silent          Don't prompt; use defaults (AutoStart on)
#    -Version <tag>   Release tag (default: scan-agent-latest)
#    -InstallDir <p>  Install path (default: $env:ProgramFiles\ClaimsFlow Scan Agent)
#
#  Requires: Windows 10+ / PowerShell 5+ / admin rights to register the service.
# ============================================================

[CmdletBinding()]
param(
    [switch] $AutoStart,
    [switch] $NoAutoStart,
    [switch] $Silent,
    [string] $Version    = $(if ($env:CLAIMSFLOW_VERSION)  { $env:CLAIMSFLOW_VERSION  } else { 'scan-agent-latest' }),
    [string] $InstallDir = $(if ($env:CLAIMSFLOW_INSTALL_DIR) { $env:CLAIMSFLOW_INSTALL_DIR } else { Join-Path $env:ProgramFiles 'ClaimsFlow Scan Agent' })
)

$ErrorActionPreference = 'Stop'
$ProgressPreference     = 'SilentlyContinue'   # silence Invoke-WebRequest progress bar (faster)

# ── Constants ──────────────────────────────────────────────────────────────
$Repo        = 'Makaly/claimsflow'
$ServiceId   = 'ClaimsFlowScanAgent'
$ServiceName = 'ClaimsFlow Scan Agent'
$AgentPort   = 7420

$ReleaseBase = "https://github.com/$Repo/releases/download/$Version"
$AgentExeUrl = "$ReleaseBase/claimsflow-scan-agent.exe"
$WinSwUrl    = 'https://github.com/winsw/winsw/releases/download/v3.0.0-alpha.11/WinSW-x64.exe'

# ── Pretty output ──────────────────────────────────────────────────────────
function Write-Banner($msg) { Write-Host "`n$msg`n" -ForegroundColor Magenta }
function Write-Info  ($msg) { Write-Host "▸ $msg" -ForegroundColor Cyan }
function Write-Ok    ($msg) { Write-Host "✓ $msg" -ForegroundColor Green }
function Write-Warn  ($msg) { Write-Host "⚠ $msg" -ForegroundColor Yellow }
function Write-Err   ($msg) { Write-Host "✗ $msg" -ForegroundColor Red }

Write-Banner "ClaimsFlow Scan Agent — Windows installer`nhttps://github.com/$Repo"

# ── Admin check ────────────────────────────────────────────────────────────
$IsAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)

# ── Decide auto-start mode ─────────────────────────────────────────────────
# Detect "piped" mode — i.e. invoked via  irm ... | iex — by checking the
# host name and whether a controlling user session is interactive.
$Interactive = -not $Silent -and $Host.UI.RawUI -ne $null -and [Environment]::UserInteractive

if ($AutoStart -and $NoAutoStart) {
    throw 'Cannot pass both -AutoStart and -NoAutoStart.'
}
$DoAutoStart = $null
if     ($AutoStart)   { $DoAutoStart = $true  }
elseif ($NoAutoStart) { $DoAutoStart = $false }
elseif ($env:CLAIMSFLOW_AUTOSTART -eq '1') { $DoAutoStart = $true  }
elseif ($env:CLAIMSFLOW_AUTOSTART -eq '0') { $DoAutoStart = $false }
elseif ($Interactive) {
    $reply = Read-Host '? Auto-start the agent on boot as a Windows service (recommended)? [Y/n]'
    $DoAutoStart = ($reply -notmatch '^(n|no)$')
} else {
    $DoAutoStart = $true   # default for piped/silent mode — match Linux behavior
}

if ($DoAutoStart -and -not $IsAdmin) {
    Write-Err "Service registration requires Administrator privileges."
    Write-Host "  Re-run from an elevated PowerShell window, or pass -NoAutoStart to install the binary only.`n"
    Write-Host "  Quick re-launch as admin:"
    Write-Host "    Start-Process powershell -Verb runAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -Command `"irm $ReleaseBase/install.ps1 | iex`"'`n" -ForegroundColor DarkGray
    exit 1
}

# ── Stop existing service if upgrading ─────────────────────────────────────
$existing = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
if ($existing) {
    Write-Info "Existing service detected — stopping for upgrade"
    try { Stop-Service -Name $ServiceId -Force -ErrorAction SilentlyContinue } catch {}
    Start-Sleep -Seconds 2
    $winswOld = Join-Path $InstallDir 'winsw.exe'
    if (Test-Path $winswOld) {
        Write-Info "Uninstalling old service via WinSW"
        & $winswOld uninstall | Out-Null
        Start-Sleep -Seconds 1
    }
}

# ── Create install dir ─────────────────────────────────────────────────────
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}
$LogsDir = Join-Path $InstallDir 'logs'
if (-not (Test-Path $LogsDir)) {
    New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null
}

# ── Download agent exe ─────────────────────────────────────────────────────
function Save-File($url, $dest, $minBytes) {
    Write-Info "Downloading $url"
    try {
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -MaximumRedirection 5
    } catch {
        throw "Download failed: $url`n$($_.Exception.Message)"
    }
    $size = (Get-Item $dest).Length
    if ($size -lt $minBytes) {
        throw "Downloaded file is only $size bytes — probably a 404 page. URL: $url"
    }
}

$AgentExePath = Join-Path $InstallDir 'claimsflow-scan-agent.exe'
Save-File $AgentExeUrl $AgentExePath 1000000
Write-Ok "Installed agent: $AgentExePath"

# ── Service registration (optional) ────────────────────────────────────────
if ($DoAutoStart) {
    $WinSwPath  = Join-Path $InstallDir 'winsw.exe'
    $WinSwXml   = Join-Path $InstallDir 'winsw.xml'

    Save-File $WinSwUrl $WinSwPath 100000
    Write-Ok "Installed WinSW: $WinSwPath"

    # Write service descriptor (mirrors the one shipped by the NSIS installer)
    $xml = @"
<?xml version="1.0" encoding="UTF-8"?>
<service>
  <id>$ServiceId</id>
  <name>$ServiceName</name>
  <description>Bridges TWAIN / WIA / ISIS / SANE scanners to the ClaimsFlow web UI at http://127.0.0.1:$AgentPort</description>
  <executable>%BASE%\claimsflow-scan-agent.exe</executable>
  <startmode>Automatic</startmode>
  <delayedAutoStart>false</delayedAutoStart>
  <onfailure action="restart" delay="60 sec"/>
  <onfailure action="restart" delay="60 sec"/>
  <onfailure action="none"/>
  <resetFailureAfter>1 hour</resetFailureAfter>
  <env name="SCAN_AGENT_PORT" value="$AgentPort"/>
  <logpath>%BASE%\logs</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>4</keepFiles>
  </log>
</service>
"@
    [System.IO.File]::WriteAllText($WinSwXml, $xml, [System.Text.UTF8Encoding]::new($false))

    Write-Info "Registering Windows service '$ServiceId'"
    & $WinSwPath install $WinSwXml
    if ($LASTEXITCODE -ne 0) {
        throw "WinSW install failed (exit $LASTEXITCODE)"
    }
    & $WinSwPath start | Out-Null
    Start-Sleep -Seconds 2

    $svc = Get-Service -Name $ServiceId -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq 'Running') {
        Write-Ok "Service running — listening on http://127.0.0.1:$AgentPort"
    } else {
        Write-Warn "Service installed but not yet Running (status: $($svc.Status)). Check Event Viewer or $LogsDir."
    }

    # Registry — match what the NSIS installer writes, so Apps & Features
    # shows a unified entry no matter which installer was used.
    $regKey  = 'HKLM:\Software\ClaimsFlow\ScanAgent'
    $uninKey = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ClaimsFlowScanAgent'
    New-Item -Path $regKey  -Force | Out-Null
    New-Item -Path $uninKey -Force | Out-Null
    Set-ItemProperty $regKey  -Name 'InstallDir' -Value $InstallDir
    Set-ItemProperty $regKey  -Name 'Port'       -Value $AgentPort
    Set-ItemProperty $uninKey -Name 'DisplayName'     -Value $ServiceName
    Set-ItemProperty $uninKey -Name 'InstallLocation' -Value $InstallDir
    Set-ItemProperty $uninKey -Name 'Publisher'       -Value 'CIC Insurance Group PLC'
    Set-ItemProperty $uninKey -Name 'URLInfoAbout'    -Value 'https://claimsflow-frontend.onrender.com'
    Set-ItemProperty $uninKey -Name 'UninstallString' -Value ("powershell -NoProfile -ExecutionPolicy Bypass -File `"$InstallDir\uninstall.ps1`"")
    # Drop the uninstall script next to the binary for easy removal
    $uninstaller = @'
$svc = Get-Service -Name ClaimsFlowScanAgent -ErrorAction SilentlyContinue
if ($svc) {
    Stop-Service -Name ClaimsFlowScanAgent -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    & "$PSScriptRoot\winsw.exe" uninstall
}
Remove-Item -Recurse -Force "$PSScriptRoot"
Remove-Item -Recurse -Force HKLM:\Software\ClaimsFlow\ScanAgent -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ClaimsFlowScanAgent -ErrorAction SilentlyContinue
Write-Host "ClaimsFlow Scan Agent uninstalled." -ForegroundColor Green
'@
    [System.IO.File]::WriteAllText((Join-Path $InstallDir 'uninstall.ps1'), $uninstaller, [System.Text.UTF8Encoding]::new($false))
} else {
    Write-Warn 'Skipped service install. Start the agent manually:'
    Write-Host "    `"$AgentExePath`"`n" -ForegroundColor DarkGray
}

# ── Done ───────────────────────────────────────────────────────────────────
Write-Host ''
Write-Ok 'ClaimsFlow Scan Agent installed.'
Write-Host ''
Write-Host 'Next step: open ClaimsFlow in your browser and click Refresh on the Scan Document tab.'
Write-Host "The agent listens on http://127.0.0.1:$AgentPort (localhost only).`n"

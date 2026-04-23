[CmdletBinding()]
param(
  [int]$Port = 3000,
  [switch]$StartLocal
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)
$toolsDir = Join-Path $repoRoot "tools\cloudflared"
$cloudflaredExe = Join-Path $toolsDir "cloudflared.exe"
$cloudflaredUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
$startLocalScript = Join-Path $repoRoot "scripts\start-local.ps1"

function Ensure-Cloudflared {
  if (Test-Path $cloudflaredExe) {
    return
  }

  New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
  Write-Host "==> Download cloudflared"
  Invoke-WebRequest -Uri $cloudflaredUrl -OutFile $cloudflaredExe
}

function Test-LocalSite {
  param([int]$TargetPort)

  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$TargetPort" -TimeoutSec 2
    return $resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Wait-LocalSite {
  param(
    [int]$TargetPort,
    [int]$TimeoutSeconds = 180
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-LocalSite -TargetPort $TargetPort) {
      return $true
    }
    Start-Sleep -Seconds 2
  }

  return $false
}

Ensure-Cloudflared

if (-not (Test-LocalSite -TargetPort $Port)) {
  if (-not $StartLocal) {
    throw "Local site is not ready on http://127.0.0.1:$Port . Run scripts/start-local.ps1 first, or add -StartLocal."
  }

  if (-not (Test-Path $startLocalScript)) {
    throw "Missing script: $startLocalScript"
  }

  Write-Host "==> Start local app stack"
  Start-Process powershell.exe -WorkingDirectory $repoRoot -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "`"$startLocalScript`""
  ) | Out-Null

  Write-Host "==> Wait local site ready"
  if (-not (Wait-LocalSite -TargetPort $Port -TimeoutSeconds 240)) {
    throw "Local site did not become ready on port $Port in time."
  }
}

Write-Host ""
Write-Host "==> Local site ready: http://127.0.0.1:$Port"
Write-Host "==> Starting temporary HTTPS preview tunnel..."
Write-Host "    Keep this window open. Press Ctrl + C to stop."
Write-Host ""

& $cloudflaredExe tunnel --url "http://127.0.0.1:$Port" --no-autoupdate

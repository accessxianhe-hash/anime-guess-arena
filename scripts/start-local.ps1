[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir

function Get-EnvValue {
  param([string]$Name)

  $envFile = Join-Path $repoRoot ".env"
  foreach ($line in Get-Content $envFile) {
    if ($line -match "^\s*$Name\s*=\s*`"?(.*?)`"?\s*$") {
      return $matches[1]
    }
  }

  throw "Missing $Name in .env"
}

function Invoke-Step {
  param(
    [string]$Label,
    [string]$Path,
    [string[]]$Arguments
  )

  Write-Host "==> $Label"
  & $Path @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE."
  }
}

function Test-PgReady {
  param(
    [string]$PgHost,
    [string]$Port,
    [string]$User,
    [string]$PgIsReadyPath
  )

  & $PgIsReadyPath -h $PgHost -p $Port -U $User | Out-Null
  return $LASTEXITCODE -eq 0
}

$nodeDir = Join-Path $repoRoot "tools\node-v22.19.0-win-x64"
$pgBinDir = Join-Path $repoRoot "tools\postgresql-17.9-binaries\pgsql\bin"
$pgDataDir = Join-Path $repoRoot "data\postgresql\17\data"
$pgPassFile = Join-Path $repoRoot "data\postgresql\17\pgpass.txt"
$pgLogFile = Join-Path $repoRoot "data\postgresql\17\server.log"
$tmpDir = Join-Path $repoRoot "tmp"
$nodeExe = Join-Path $nodeDir "node.exe"
$npmCmd = Join-Path $nodeDir "npm.cmd"
$initdbExe = Join-Path $pgBinDir "initdb.exe"
$pgCtlExe = Join-Path $pgBinDir "pg_ctl.exe"
$pgIsReadyExe = Join-Path $pgBinDir "pg_isready.exe"
$psqlExe = Join-Path $pgBinDir "psql.exe"
$createdbExe = Join-Path $pgBinDir "createdb.exe"

$requiredPaths = @(
  $nodeExe,
  $npmCmd,
  $initdbExe,
  $pgCtlExe,
  $pgIsReadyExe,
  $psqlExe,
  $createdbExe
)

foreach ($path in $requiredPaths) {
  if (-not (Test-Path $path)) {
    throw "Missing required file: $path"
  }
}

New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $pgPassFile) | Out-Null

$env:Path = "$nodeDir;$pgBinDir;$env:Path"
$env:TEMP = $tmpDir
$env:TMP = $tmpDir

$databaseUrl = Get-EnvValue -Name "DATABASE_URL"
$adminEmail = Get-EnvValue -Name "ADMIN_SEED_EMAIL"

if (
  $databaseUrl -notmatch
  "^postgresql:\/\/(?<user>[^:]+):(?<password>[^@]+)@(?<host>[^:\/?#]+)(:(?<port>\d+))?\/(?<database>[^?\s]+)"
) {
  throw "Unsupported DATABASE_URL format: $databaseUrl"
}

$dbUser = $matches["user"]
$dbPassword = [System.Uri]::UnescapeDataString($matches["password"])
$dbHost = $matches["host"]
$dbPort = if ($matches["port"]) { $matches["port"] } else { "5432" }
$dbName = $matches["database"]

$env:PGPASSFILE = $pgPassFile
Set-Content -Path $pgPassFile -Value "${dbHost}:${dbPort}:*:${dbUser}:${dbPassword}"

$initdbPwFile = Join-Path $tmpDir "initdb-password.txt"
Set-Content -Path $initdbPwFile -Value $dbPassword

$devReady = $false
try {
  $resp = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3000" -TimeoutSec 2
  $devReady = $resp.StatusCode -eq 200
} catch {
  $devReady = $false
}

if (-not (Test-Path (Join-Path $pgDataDir "PG_VERSION"))) {
  New-Item -ItemType Directory -Force -Path $pgDataDir | Out-Null
  Invoke-Step -Label "Initialize PostgreSQL cluster" -Path $initdbExe -Arguments @(
    "-D", $pgDataDir,
    "-U", $dbUser,
    "-A", "scram-sha-256",
    "--pwfile=$initdbPwFile"
  )
}

if (-not (Test-PgReady -PgHost $dbHost -Port $dbPort -User $dbUser -PgIsReadyPath $pgIsReadyExe)) {
  Invoke-Step -Label "Start PostgreSQL" -Path $pgCtlExe -Arguments @(
    "-D", $pgDataDir,
    "-l", $pgLogFile,
    "start"
  )

  $ready = $false
  for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    if (Test-PgReady -PgHost $dbHost -Port $dbPort -User $dbUser -PgIsReadyPath $pgIsReadyExe) {
      $ready = $true
      break
    }
  }

  if (-not $ready) {
    throw "PostgreSQL did not become ready. Check $pgLogFile"
  }
}

$dbExists = (& $psqlExe -w -h $dbHost -p $dbPort -U $dbUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$dbName';").Trim()
if ($dbExists -ne "1") {
  Invoke-Step -Label "Create database $dbName" -Path $createdbExe -Arguments @(
    "-w",
    "-h", $dbHost,
    "-p", $dbPort,
    "-U", $dbUser,
    $dbName
  )
}

if (-not $devReady) {
  Invoke-Step -Label "Generate Prisma Client" -Path $npmCmd -Arguments @("run", "prisma:generate")
}

Invoke-Step -Label "Apply Prisma migrations" -Path $npmCmd -Arguments @("run", "prisma:migrate", "--", "--skip-generate")
Invoke-Step -Label "Seed demo data" -Path $npmCmd -Arguments @("run", "seed:dev")

Write-Host ""
Write-Host "Local stack is ready."
Write-Host "Admin login: $adminEmail"
Write-Host "Admin URL: http://localhost:3000/admin/login"

if ($devReady) {
  Write-Host "Next.js dev server is already running at http://localhost:3000"
  exit 0
}

Write-Host "==> Start Next.js dev server"
& $npmCmd run dev

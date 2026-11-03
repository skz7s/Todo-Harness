$ErrorActionPreference = "Stop"

$Repository = "https://github.com/skz7s/Todo-Harness.git"
$InstallDir = if ($env:TODO_HARNESS_INSTALL_DIR) {
  $env:TODO_HARNESS_INSTALL_DIR
} else {
  Join-Path $env:LOCALAPPDATA "TodoHarness\app"
}

function Get-NodeMajorVersion {
  $Node = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $Node) { return 0 }

  $Version = & $Node.Source -p 'Number(process.versions.node.split(".")[0])'
  if ($LASTEXITCODE -ne 0) { return 0 }

  $Major = 0
  if (-not [int]::TryParse(($Version | Out-String).Trim(), [ref]$Major)) { return 0 }
  return $Major
}

function Install-WingetPackage([string] $Id, [switch] $Force) {
  $Arguments = @(
    "install", "--id", $Id, "--exact", "--source", "winget",
    "--silent", "--accept-package-agreements", "--accept-source-agreements"
  )
  if ($Force) { $Arguments += "--force" }

  Write-Host "Installing $Id with winget..."
  & $script:Winget.Source @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "winget could not install $Id (exit code $LASTEXITCODE)."
  }
}

function Refresh-ProcessPath {
  $KnownPaths = @(
    (Join-Path $env:ProgramFiles "Git\cmd"),
    (Join-Path $env:ProgramFiles "nodejs"),
    (Join-Path $env:LOCALAPPDATA "Programs\Git\cmd"),
    (Join-Path $env:LOCALAPPDATA "Programs\nodejs")
  )
  $EnvironmentPaths = @(
    [Environment]::GetEnvironmentVariable("Path", "Machine"),
    [Environment]::GetEnvironmentVariable("Path", "User"),
    $env:Path
  )
  $env:Path = (@($KnownPaths | Where-Object { Test-Path $_ }) + $EnvironmentPaths) -join ";"
}

$NeedGit = -not (Get-Command git -ErrorAction SilentlyContinue)
$NeedNode = (Get-NodeMajorVersion) -lt 20 -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)

if ($NeedGit -or $NeedNode) {
  $script:Winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $script:Winget) {
    throw "Todo Harness can install Git and Node.js automatically, but winget is unavailable. Install App Installer (which provides winget) and run this command again."
  }

  if ($NeedGit) { Install-WingetPackage "Git.Git" }
  if ($NeedNode) { Install-WingetPackage "OpenJS.NodeJS.LTS" -Force }
  Refresh-ProcessPath
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "Git is still unavailable after installation. Open a new PowerShell window and run this command again."
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw "Node.js 20 or newer with npm is still unavailable after installation. Open a new PowerShell window and run this command again."
}

$NodeMajor = Get-NodeMajorVersion
if ($NodeMajor -lt 20) {
  throw "Node.js 20 or newer is required after installation. Found $(node.exe --version)."
}

$Parent = Split-Path -Parent $InstallDir
New-Item -ItemType Directory -Path $Parent -Force | Out-Null

if (Test-Path $InstallDir) {
  if (-not (Test-Path (Join-Path $InstallDir ".git"))) {
    throw "$InstallDir exists and is not a Todo Harness Git checkout."
  }
  $Changes = git -C $InstallDir status --porcelain
  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect the installation at $InstallDir."
  }
  if ($Changes) {
    throw "The installation has local changes. Preserve them, then update it manually."
  }
  git -C $InstallDir fetch --depth 1 origin main
  if ($LASTEXITCODE -ne 0) { throw "Could not fetch the latest Todo Harness version." }
  git -C $InstallDir merge --ff-only origin/main
  if ($LASTEXITCODE -ne 0) { throw "Could not fast-forward the Todo Harness installation." }
} else {
  git clone --depth 1 --branch main $Repository $InstallDir
  if ($LASTEXITCODE -ne 0) { throw "Could not clone Todo Harness." }
}

Set-Location $InstallDir
npm.cmd ci --omit=dev
if ($LASTEXITCODE -ne 0) { throw "Could not install Todo Harness dependencies." }
npm.cmd start

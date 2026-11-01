$ErrorActionPreference = "Stop"

$Repository = "https://github.com/skz7s/Todo-Harness.git"
$InstallDir = if ($env:TODO_HARNESS_INSTALL_DIR) {
  $env:TODO_HARNESS_INSTALL_DIR
} else {
  Join-Path $env:LOCALAPPDATA "TodoHarness\app"
}

foreach ($Command in @("git", "node", "npm")) {
  if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
    throw "Todo Harness requires Git and Node.js 20 or newer (including npm). Install the missing prerequisite and run this command again."
  }
}

$NodeMajor = [int] ((node.exe -p 'Number(process.versions.node.split(".")[0])').Trim())
if ($NodeMajor -lt 20) {
  throw "Node.js 20 or newer is required. Found $(node --version)."
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

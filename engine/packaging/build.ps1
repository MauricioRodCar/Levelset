<#
.SYNOPSIS
  Builds levelset-engine.exe (PyInstaller, one-folder) and stages it for the Tauri bundle.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File engine\packaging\build.ps1
  powershell -ExecutionPolicy Bypass -File engine\packaging\build.ps1 -Python "py -3.12" -SkipSmoke

.DESCRIPTION
  1. Creates/updates a build-only venv at engine\packaging\.venv (never the dev venv).
  2. pip installs the engine (non-editable) + PyInstaller.
  3. Runs levelset-engine.spec -> engine\packaging\dist\levelset-engine\
  4. Smoke test: --demo --port 0, ready line, /health, TSLA pipeline ticket (unless -SkipSmoke).
  5. Stages for Tauri (unless -NoStage):
       app\src-tauri\binaries\levelset-engine-<target-triple>.exe   (Tauri externalBin)
       app\src-tauri\engine-runtime\                                (bundle.resources)
#>
param(
  [string]$Python = "",
  [switch]$SkipSmoke,
  [switch]$NoStage,
  [switch]$Clean
)
$ErrorActionPreference = "Stop"

$Here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$Engine  = Split-Path -Parent $Here
$Repo    = Split-Path -Parent $Engine
$Venv    = Join-Path $Here ".venv"
$Dist    = Join-Path $Here "dist"
$Work    = Join-Path $Here "build"
$Tauri   = Join-Path $Repo "app\src-tauri"
$PyInstallerVersion = "6.22.3"

function Invoke-Checked([string]$exe, [string[]]$argv) {
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { throw "$exe $($argv -join ' ') failed with exit code $LASTEXITCODE" }
}

if ($Clean) {
  foreach ($p in @($Dist, $Work)) { if (Test-Path $p) { Remove-Item -Recurse -Force $p } }
}

# 1. build venv
$VenvPy = Join-Path $Venv "Scripts\python.exe"
if (-not (Test-Path $VenvPy)) {
  if ($Python) {
    $parts = $Python.Split(" ")
    $pyExe = $parts[0]; $pyArgs = @($parts | Select-Object -Skip 1)
  } elseif (Get-Command py -ErrorAction SilentlyContinue) {
    $pyExe = "py"; $pyArgs = @("-3")
  } else {
    $pyExe = "python"; $pyArgs = @()
  }
  Write-Host "Creating build venv with $pyExe $pyArgs"
  Invoke-Checked $pyExe ($pyArgs + @("-m", "venv", $Venv))
}
Invoke-Checked $VenvPy @("-m", "pip", "install", "--disable-pip-version-check", "-q", "--upgrade", "pip")
Invoke-Checked $VenvPy @("-m", "pip", "install", "--disable-pip-version-check", "-q", $Engine, "pyinstaller==$PyInstallerVersion")
& $VenvPy -c "import sys, PyInstaller; print('Python', sys.version.split()[0], '| PyInstaller', PyInstaller.__version__)"

# 2. PyInstaller
$sw = [Diagnostics.Stopwatch]::StartNew()
Invoke-Checked $VenvPy @("-m", "PyInstaller", "--noconfirm", "--log-level", "WARN",
  "--distpath", $Dist, "--workpath", $Work, (Join-Path $Here "levelset-engine.spec"))
$Out = Join-Path $Dist "levelset-engine"
$Exe = Join-Path $Out "levelset-engine.exe"
$size = (Get-ChildItem -Recurse $Out | Measure-Object -Sum Length).Sum / 1MB
Write-Host ("Built {0} in {1:N0} s ({2:N1} MB folder)" -f $Exe, $sw.Elapsed.TotalSeconds, $size)

# 3. smoke test
if (-not $SkipSmoke) {
  Invoke-Checked $VenvPy @((Join-Path $Here "smoke_test.py"), $Exe)
}

# 4. stage for Tauri
if (-not $NoStage) {
  $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
  $triple = "x86_64-pc-windows-msvc"
  if (Get-Command rustc -ErrorAction SilentlyContinue) {
    $hostLine = & rustc -vV | Select-String "^host:"
    if ($hostLine) { $triple = $hostLine.ToString().Split(" ")[1].Trim() }
  }
  $bin = Join-Path $Tauri "binaries"
  $rt  = Join-Path $Tauri "engine-runtime"
  New-Item -ItemType Directory -Force $bin | Out-Null
  if (Test-Path $rt) { Remove-Item -Recurse -Force $rt }
  Copy-Item $Exe (Join-Path $bin "levelset-engine-$triple.exe") -Force
  Copy-Item -Recurse (Join-Path $Out "engine-runtime") $rt
  Write-Host "Staged binaries\levelset-engine-$triple.exe and engine-runtime\ in $Tauri"
}

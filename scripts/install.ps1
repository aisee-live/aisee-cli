# AISee CLI installer — Windows (PowerShell 5+)
# Usage: .\scripts\install.ps1 [-InstallDir "C:\Program Files\aisee"]
param(
  [string]$InstallDir = "$env:LOCALAPPDATA\Programs\aisee"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Binary  = "dist\aisee-windows-x64.exe"
$Dest    = "$InstallDir\aisee.exe"

# ── Build if binary missing ────────────────────────────────────────────────────
if (-not (Test-Path $Binary)) {
  Write-Host "Binary not found at $Binary — building..."
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Error "Bun is required to build. Install from https://bun.sh"
    exit 1
  }
  bun install
  bun run build:windows-x64
}

# ── Install ────────────────────────────────────────────────────────────────────
if (-not (Test-Path $InstallDir)) {
  New-Item -ItemType Directory -Path $InstallDir | Out-Null
}

Copy-Item -Path $Binary -Destination $Dest -Force
Write-Host "Installed: $Dest"

# ── Add to PATH if not already present ────────────────────────────────────────
$UserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($UserPath -notlike "*$InstallDir*") {
  [Environment]::SetEnvironmentVariable(
    "PATH",
    "$UserPath;$InstallDir",
    "User"
  )
  Write-Host "Added $InstallDir to user PATH."
  Write-Host "Restart your terminal for the PATH change to take effect."
}

Write-Host ""
& $Dest --version

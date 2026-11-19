# Installs or upgrades wk on Windows: downloads the latest release binary and puts it on your PATH.
#   irm https://raw.githubusercontent.com/benfo/wk/main/install.ps1 | iex
# $env:WK_INSTALL_DIR overrides the folder; $env:WK_VERSION (e.g. v0.2.0) pins a release.
$ErrorActionPreference = 'Stop'

$repo = 'benfo/wk'
$dir = if ($env:WK_INSTALL_DIR) { $env:WK_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\wk' }
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
$asset = "wk-windows-$arch.exe"
$url = if ($env:WK_VERSION) {
  "https://github.com/$repo/releases/download/$($env:WK_VERSION)/$asset"
} else {
  "https://github.com/$repo/releases/latest/download/$asset"
}

New-Item -ItemType Directory -Force -Path $dir | Out-Null
$target = Join-Path $dir 'wk.exe'
$tmp = Join-Path $dir 'wk.download'
Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
# A running wk.exe can't be overwritten, but it can be renamed out of the way.
if (Test-Path $target) {
  $old = Join-Path $dir 'wk.old.exe'
  Remove-Item $old -Force -ErrorAction SilentlyContinue
  Rename-Item $target 'wk.old.exe'
}
Rename-Item $tmp 'wk.exe'

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not (($userPath -split ';') -contains $dir)) {
  [Environment]::SetEnvironmentVariable('Path', (($userPath.TrimEnd(';'), $dir) -join ';').TrimStart(';'), 'User')
  $env:Path = "$env:Path;$dir"
  Write-Host "Added $dir to your PATH. Open a new terminal for other windows to see it."
}
Write-Host "Installed wk to $target"
Write-Host 'Next, in a project: wk init --store repo   (rerun this installer to upgrade)'

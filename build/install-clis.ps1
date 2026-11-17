# Installs the required command-line AI tools after the app (build/installer.nsh, Server installs only):
# Node.js (runs the bundled Ruflo runtime, Codex and Copilot), Claude Code (Ruflo's execution host), Codex, Copilot.
# The install commands match SETUP_TOOLS in server.mjs; keep the two in sync.
# -Silent (silent Setup): no prompts; missing tools are listed in the app instead.
param([switch]$Silent)
$Host.UI.RawUI.WindowTitle = "Local Agent Router - installing required AI tools"

function Refresh-Path {
  $env:Path = @([Environment]::GetEnvironmentVariable("Path", "Machine"), [Environment]::GetEnvironmentVariable("Path", "User"),
    "$env:ProgramFiles\nodejs", "$env:APPDATA\npm", "$env:USERPROFILE\.local\bin") -join ";"
}

function Has($command) { [bool](Get-Command $command -ErrorAction SilentlyContinue) }

function Install-Node {
  if (Has "winget") {
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    Refresh-Path
    if (Has "npm") { return }
  }
  # No winget (Windows Sandbox, LTSC, older Windows), or it failed: the current LTS installer straight from nodejs.org.
  $ProgressPreference = "SilentlyContinue"
  $a = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
  # Windows PowerShell 5.1 pipes a JSON array as one object, so store it first; piping the variable enumerates it.
  $releases = Invoke-RestMethod https://nodejs.org/dist/index.json
  $v = ($releases | Where-Object { $_.lts -and $_.files -contains "win-$a-msi" } | Select-Object -First 1).version
  if (-not $v) { throw "Could not find a Node.js LTS installer on nodejs.org." }
  $msi = Join-Path $env:TEMP "node-$v-$a.msi"
  Write-Host "Downloading Node.js $v from nodejs.org..."
  Invoke-WebRequest "https://nodejs.org/dist/$v/node-$v-$a.msi" -OutFile $msi -UseBasicParsing
  $p = Start-Process msiexec.exe -ArgumentList "/i", "`"$msi`"", "/passive" -Wait -PassThru
  if ($p.ExitCode -notin 0, 3010) { throw "Node.js setup failed with exit code $($p.ExitCode)." }
}

function Install-Npm($package) {
  if (-not (Has "npm")) { throw "npm was not found. Node.js must install first." }
  npm install -g $package
  if ($LASTEXITCODE) { throw "npm install failed with exit code $LASTEXITCODE." }
}

# Order matters: Node.js before the npm tools. Each entry is skipped when its command already exists.
$steps = @(
  @{ name = "Node.js"; command = "npm"; install = { Install-Node } },
  @{ name = "Claude Code"; command = "claude"; install = { Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression } },
  @{ name = "Codex"; command = "codex"; install = { Install-Npm "@openai/codex" } },
  @{ name = "GitHub Copilot"; command = "copilot"; install = { Install-Npm "@github/copilot" } }
)

while ($true) {
  Refresh-Path
  $failed = @()
  foreach ($step in $steps) {
    Write-Host ""
    Write-Host "== $($step.name) ==" -ForegroundColor Cyan
    if (Has $step.command) { Write-Host "$($step.name) is already installed."; continue }
    try { & $step.install; Refresh-Path } catch { Write-Host $_ -ForegroundColor Red }
    if (-not (Has $step.command)) { $failed += $step.name }
  }
  Write-Host ""
  if (-not $failed.Count) {
    Write-Host "Done. Sign in to each tool from Settings -> AI tools." -ForegroundColor Green
    Start-Sleep -Seconds 3
    exit 0
  }
  Write-Host "Not installed: $($failed -join ', '). Local Agent Router needs all of them." -ForegroundColor Yellow
  if ($Silent) { exit 1 }
  $answer = Read-Host "Press Enter to try again, or type S to skip and install them later from Settings -> AI tools"
  if ($answer -match '^\s*s') { exit 1 }
}

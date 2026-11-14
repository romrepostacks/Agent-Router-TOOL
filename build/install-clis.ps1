# Installs the command-line AI tools ticked on the installer's "AI tools" page (build/installer.nsh).
# The install commands match SETUP_TOOLS in server.mjs; keep the two in sync.
# Usage: install-clis.ps1 -Tools claude,codex,copilot
param([string]$Tools = "")

$wanted = $Tools.Split(",", [StringSplitOptions]::RemoveEmptyEntries) | ForEach-Object { $_.Trim().ToLower() }
$Host.UI.RawUI.WindowTitle = "Local Agent Router - installing AI tools"
$failed = @()

function Refresh-Path {
  $env:Path = @([Environment]::GetEnvironmentVariable("Path", "Machine"), [Environment]::GetEnvironmentVariable("Path", "User"),
    "$env:ProgramFiles\nodejs", "$env:APPDATA\npm", "$env:USERPROFILE\.local\bin") -join ";"
}

function Has($command) { [bool](Get-Command $command -ErrorAction SilentlyContinue) }

function Step($name, [scriptblock]$action) {
  Write-Host ""
  Write-Host "== $name ==" -ForegroundColor Cyan
  try { & $action; Refresh-Path } catch { Write-Host $_ -ForegroundColor Red; $script:failed += $name }
}

Refresh-Path

if ($wanted -contains "claude") {
  if (Has "claude") { Write-Host "Claude Code is already installed." }
  else { Step "Claude Code" { Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression } }
}

$npmTools = @(@{ id = "codex"; name = "Codex"; package = "@openai/codex" }, @{ id = "copilot"; name = "GitHub Copilot"; package = "@github/copilot" }) |
  Where-Object { $wanted -contains $_.id -and -not (Has $_.id) }
if ($npmTools -and -not (Has "npm")) {
  Step "Node.js (needed for Codex and Copilot)" {
    if (-not (Has "winget")) { throw "winget is not available. Install Node.js from https://nodejs.org, then install the tools from Settings -> AI tools." }
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  }
}
foreach ($tool in $npmTools) {
  Step $tool.name {
    if (-not (Has "npm")) { throw "npm was not found." }
    npm install -g $tool.package
    if ($LASTEXITCODE) { throw "npm install failed with exit code $LASTEXITCODE." }
  }
}

Write-Host ""
if ($failed.Count) {
  Write-Host "Not installed: $($failed -join ', '). You can retry from Settings -> AI tools in Local Agent Router." -ForegroundColor Yellow
  Read-Host "Press Enter to finish setup"
} else {
  Write-Host "Done. Sign in to each tool from Settings -> AI tools." -ForegroundColor Green
  Start-Sleep -Seconds 3
}

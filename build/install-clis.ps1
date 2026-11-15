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
    if (Has "winget") { winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements; return }
    # No winget (Windows Sandbox, LTSC, older Windows): the current LTS installer straight from nodejs.org.
    $ProgressPreference = "SilentlyContinue"
    $a = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
    # Windows PowerShell 5.1 pipes a JSON array as one object, so store it first; piping the variable enumerates it.
    $releases = Invoke-RestMethod https://nodejs.org/dist/index.json
    $v = ($releases | Where-Object { $_.lts -and $_.files -contains "win-$a-msi" } | Select-Object -First 1).version
    if (-not $v) { throw "Could not find a Node.js LTS installer on nodejs.org." }
    $msi = Join-Path $env:TEMP "node-$v-$a.msi"
    Write-Host "winget is not available. Downloading Node.js $v from nodejs.org..."
    Invoke-WebRequest "https://nodejs.org/dist/$v/node-$v-$a.msi" -OutFile $msi -UseBasicParsing
    $p = Start-Process msiexec.exe -ArgumentList "/i", "`"$msi`"", "/passive" -Wait -PassThru
    if ($p.ExitCode -notin 0, 3010) { throw "Node.js setup failed with exit code $($p.ExitCode)." }
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

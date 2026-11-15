# Runs inside Windows Sandbox, started by test/cli-install.wsb. Never run this on your own PC.
# Starts the newest installer with all three AI tools preselected, then checks what got installed.
# Results are also saved to cli-install-results.txt on the sandbox desktop.
$desk = "C:\Users\WDAGUtilityAccount\Desktop"
Start-Transcript "$desk\cli-install-results.txt" -Append | Out-Null
$Host.UI.RawUI.WindowTitle = "Local Agent Router - AI tools sandbox test"

# Same PATH refresh as build/install-clis.ps1, so tools installed by Setup are found without a new window.
function Refresh-Path {
  $env:Path = @([Environment]::GetEnvironmentVariable("Path", "Machine"), [Environment]::GetEnvironmentVariable("Path", "User"),
    "$env:ProgramFiles\nodejs", "$env:APPDATA\npm", "$env:USERPROFILE\.local\bin") -join ";"
}

function Check {
  Refresh-Path
  Write-Host ""
  Write-Host "== Check $(Get-Date -Format T) ==" -ForegroundColor Cyan
  foreach ($cmd in "node", "npm", "claude", "codex", "copilot") {
    $found = Get-Command $cmd -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) {
      $version = (& $found.Source --version 2>&1 | Select-Object -First 1)
      Write-Host ("  PASS  {0,-8} {1}  ({2})" -f $cmd, $version, $found.Source) -ForegroundColor Green
    } else {
      Write-Host ("  MISS  {0,-8} not on PATH" -f $cmd) -ForegroundColor Yellow
    }
  }
  # Setup writes "<version> server|client" as DisplayVersion (build/installer.nsh customInstall).
  $app = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*", "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
    Where-Object DisplayName -like "Local Agent Router*" | Select-Object -First 1
  if ($app) { Write-Host "  App   $($app.DisplayName) $($app.DisplayVersion)" -ForegroundColor Green }
  else { Write-Host "  App   not installed" -ForegroundColor Yellow }
}

$setup = Get-ChildItem "$desk\installer\LocalAgentRouter-Setup-*.exe" |
  Where-Object Name -match 'Setup-(\d+\.\d+\.\d+)\.exe$' |
  Sort-Object { [version]($_.Name -replace '^.*Setup-(\d+\.\d+\.\d+)\.exe$', '$1') } | Select-Object -Last 1
if (-not $setup) { Write-Host "No installer in release\. Build one first (build-installer.cmd)." -ForegroundColor Red; return }

Write-Host "Installer: $($setup.Name)"
Write-Host "Winget present: $([bool](Get-Command winget -ErrorAction SilentlyContinue)) (Sandbox has none, so Node.js comes from the nodejs.org installer instead; accept its UAC prompt if one appears.)"
Check

Write-Host ""
Write-Host "Starting Setup with /TOOLS=claude,codex,copilot. Pick Server, keep the three tools ticked, finish Setup." -ForegroundColor Cyan
Start-Process $setup.FullName -ArgumentList "/TOOLS=claude,codex,copilot"
Read-Host "When Setup and its 'installing AI tools' window have closed, press Enter to check"
Check

Write-Host @"

Now in the app (manual):
  1. Settings -> AI tools -> Check again. Each tool above marked PASS should show installed.
     Any MISS: press Install there (retry path), then press Enter here to re-check.
  2. Sign in to each tool with a test account, Check again until each shows Ready.
  3. Run setup again: Projects folder -> Local model (optional) -> API keys (optional) -> Review.
     Pass: setup finishes, the projects folder exists, Review lists the signed-in providers.
  Client test: close the sandbox, open it again, run Setup by hand, pick Client: the AI tools page must not appear.
"@
while ($true) {
  if ((Read-Host "Enter = check again, q = quit") -eq "q") { break }
  Check
}
Stop-Transcript | Out-Null

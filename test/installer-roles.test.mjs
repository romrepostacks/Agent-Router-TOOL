// node --test test/*.test.mjs — the installer's Server/Client choice. makensis isn't available in tests, so these check
// the script and config text; build the installer and run it to check the wizard itself.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const nsh = await readFile(new URL("../build/installer.nsh", import.meta.url), "utf8");
const desktop = await readFile(new URL("../desktop.cjs", import.meta.url), "utf8");
const config = createRequire(import.meta.url)("../electron-builder.config.cjs");
const version = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;

test("the installer keeps finding earlier installs and updates them in place", () => {
  assert.equal(config.appId, "com.localagentrouter.desktop");
  assert.equal(config.nsis.oneClick, false);
  assert.equal(config.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(config.nsis.include, "build/installer.nsh");
  assert.match(nsh, /ReadRegStr \$RouterOldInstall HKCU "\$\{INSTALL_REGISTRY_KEY\}" InstallLocation/);
  assert.match(nsh, /Setup will update it\./);
  assert.match(nsh, /Update\.exe" --uninstall -s/);
});

test("Server or Client is asked first, before the folder page", () => {
  // electron-builder inserts customWelcomePage ahead of the install-mode and MUI_PAGE_DIRECTORY pages.
  assert.match(nsh, /!macro customWelcomePage\s+Page custom RouterRolePage RouterRoleLeave\s+Page custom RouterToolsPage RouterToolsLeave\s+!macroend/);
  assert.match(nsh, /NSD_CreateRadioButton[^\n]+&Server/);
  assert.match(nsh, /NSD_CreateRadioButton[^\n]+&Client/);
  assert.match(nsh, /\$\{GetOptions\} \$0 "\/ROLE=" \$1/);
  // An update keeps the earlier install's role: it is read before electron-builder removes the old files.
  assert.match(nsh, /FileOpen \$0 "\$RouterOldInstall\\resources\\install-role" r/);
  // Only the installer build gets the page; the uninstaller would fail on unreferenced functions.
  assert.ok(nsh.indexOf("!ifndef BUILD_UNINSTALLER") < nsh.indexOf("Var RouterRole"));
  assert.match(nsh.trimEnd(), /!endif$/);
  // electron-builder includes this file before MUI2.nsh: MUI macros fail the build ("macro named MUI_HEADER_TEXT not found").
  assert.doesNotMatch(nsh, /!insertmacro MUI_/);
});

test("the chosen role is saved for the app and shown in the version", () => {
  assert.match(nsh, /FileOpen \$0 "\$INSTDIR\\resources\\install-role" w\s+FileWrite \$0 \$RouterRole/);
  assert.match(nsh, /WriteRegStr SHCTX "\$\{UNINSTALL_REGISTRY_KEY\}" "DisplayVersion" "\$\{VERSION\} \$RouterRole"/);
  assert.match(desktop, /path\.join\(process\.resourcesPath, "install-role"\)/);
  assert.match(desktop, /role === "client" \? "client" : "server"/, "anything but client starts as server");
  assert.match(desktop, /"X-Router-Client"\] = `\$\{app\.getVersion\(\)\} client`/);
  assert.match(version, /^\d+\.\d+\.\d+$/);
});

test("a Server install can install the AI tools, only known names reach PowerShell", async () => {
  const page = nsh.slice(nsh.indexOf("Function RouterToolsPage"), nsh.indexOf("FunctionEnd", nsh.indexOf("Function RouterToolsPage")));
  assert.match(page, /\$\{If\} \$RouterRole == "client"\s+Abort/, "Clients skip the page");
  for (const name of ["Claude Code", "Codex", "GitHub Copilot"]) assert.match(page, new RegExp(`NSD_CreateCheckbox[^\\n]+${name}`));
  assert.match(nsh, /\$\{GetOptions\} \$0 "\/TOOLS=" \$1[\s\S]*Call RouterCleanTools/);
  assert.match(nsh, /\$\{If\} \$RouterRole == "server"\s+\$\{AndIf\} \$RouterTools != ""[\s\S]*install-clis\.ps1" -Tools "\$RouterTools"/);
  assert.deepEqual(config.extraResources, [{ from: "build/install-clis.ps1", to: "install-clis.ps1" }]);
  // The script's install commands match the Settings → AI tools ones (SETUP_TOOLS in server.mjs).
  const script = await readFile(new URL("../build/install-clis.ps1", import.meta.url), "utf8");
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  for (const pkg of ["@openai/codex", "@github/copilot", "OpenJS.NodeJS.LTS", "https://nodejs.org/dist/index.json", "'/passive'", "https://claude.ai/install.ps1"]) {
    assert.ok(script.replaceAll('"', "'").includes(pkg) && server.includes(pkg), pkg);
  }
  // Setup is 32-bit; the tools script must run in 64-bit PowerShell or Claude Code's installer refuses it.
  assert.match(nsh, /sysnative\\WindowsPowerShell\\v1\.0\\powershell\.exe[\s\S]*ExecWait '"\$1" [^']*install-clis\.ps1/);
});

test("the phone apps aren't packed into the Windows app", () => {
  assert.ok(config.files.some((pattern) => /^!\{[^}]*\bmobile\b/.test(pattern)));
});

test("uninstalling asks before deleting user data, and updates or silent uninstalls never delete it", () => {
  const un = nsh.slice(nsh.indexOf("!ifdef BUILD_UNINSTALLER"));
  assert.match(un, /!macro customUnInstall[\s\S]*\$\{ifNot\} \$\{isUpdated\}[\s\S]*IfSilent keepData[\s\S]*MB_DEFBUTTON2[\s\S]*IDNO keepData[\s\S]*RMDir \/r "\$R2\\LocalAgentRouterData"/);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  assert.match(nsh, /CreateShortCut "\$SMPROGRAMS\\Uninstall Local Agent Router\.lnk" "\$INSTDIR\\\$\{UNINSTALL_FILENAME\}"/);
});

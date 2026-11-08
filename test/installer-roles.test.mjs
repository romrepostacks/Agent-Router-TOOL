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
  assert.match(nsh, /!macro customWelcomePage\s+Page custom RouterRolePage RouterRoleLeave\s+!macroend/);
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

test("the phone apps aren't packed into the Windows app", () => {
  assert.ok(config.files.some((pattern) => /^!\{[^}]*\bmobile\b/.test(pattern)));
});

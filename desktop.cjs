const { app, BrowserWindow, Menu, dialog, nativeTheme, globalShortcut } = require("electron");
const { access, copyFile, cp, mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let router;
let window;
let registeredShortcut = "";

function focusPrompt() {
  if (!window) return;
  if (!window.isVisible()) window.show();
  if (window.isMinimized()) window.restore();
  window.focus();
  window.webContents.executeJavaScript('document.getElementById("prompt")?.focus()').catch(() => {});
}

function setRouterShortcut(accelerator) {
  const previous = registeredShortcut;
  if (previous) globalShortcut.unregister(previous);
  registeredShortcut = "";
  if (!accelerator) return true;
  const registered = globalShortcut.register(accelerator, focusPrompt);
  if (registered) registeredShortcut = accelerator;
  else if (previous && globalShortcut.register(previous, focusPrompt)) registeredShortcut = previous;
  return registered;
}

async function openApp() {
  const localData = process.env.LOCALAPPDATA || path.join(app.getPath("home"), "AppData", "Local");
  try {
    const preferences = JSON.parse(await readFile(path.join(localData, "LocalAgentRouterData", "settings.json"), "utf8"));
    nativeTheme.themeSource = ["system", "light", "dark"].includes(preferences.theme) ? preferences.theme : "system";
    setRouterShortcut(preferences.shortcut || "Control+Shift+Space");
  } catch {}
  globalThis.setRouterTheme = (theme) => { nativeTheme.themeSource = theme; };
  globalThis.setRouterShortcut = setRouterShortcut;
  const userData = app.getPath("userData");
  await mkdir(userData, { recursive: true });
  const skillsFile = path.join(userData, "skills.md");
  try {
    await copyFile(path.join(__dirname, "skills.md"), skillsFile, require("node:fs").constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const skillsDir = path.join(userData, "skills");
  try { await access(skillsDir); }
  catch { await cp(path.join(__dirname, "skills"), skillsDir, { recursive: true }); }
  process.env.AGENT_ROUTER_SKILLS_FILE = skillsFile;
  process.env.AGENT_ROUTER_SKILLS_DIR = skillsDir;

  const { startServer } = await import("./server.mjs");
  router = await startServer(0);
  const port = router.address().port;

  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 980,
    minHeight: 640,
    title: "Local Agent Router",
    icon: path.join(__dirname, "assets", "icon.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.loadURL(`http://127.0.0.1:${port}`);
  window.on("closed", () => { window = null; });
}

if (gotLock) {
  app.whenReady().then(openApp).catch((error) => {
    console.error("Local Agent Router could not start:", error);
    const detail = error?.stack || error?.message || String(error);
    writeFile(path.join(app.getPath("userData"), "startup-error.txt"), detail, "utf8").catch(() => {});
    dialog.showErrorBox("Local Agent Router could not start", detail);
    app.quit();
  });
  app.on("second-instance", () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on("activate", () => {
    if (window) window.focus();
    else openApp().catch((error) => { console.error(error); app.quit(); });
  });
  app.on("before-quit", () => router?.close());
  app.on("will-quit", () => globalShortcut.unregisterAll());
  app.on("window-all-closed", () => app.quit());
}

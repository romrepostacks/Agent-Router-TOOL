const { app, BrowserWindow, Menu, dialog, nativeTheme, globalShortcut, safeStorage, shell } = require("electron");
const { readFileSync } = require("node:fs");
const { mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let router;
let window;
let registeredShortcut = "";

// Written by the installer's Server or Client page. Development runs use AGENT_ROUTER_ROLE; the default is server.
function installRole() {
  let role = app.isPackaged ? "" : process.env.AGENT_ROUTER_ROLE || "";
  if (app.isPackaged) { try { role = readFileSync(path.join(process.resourcesPath, "install-role"), "utf8").trim(); } catch {} }
  return role === "client" ? "client" : "server";
}
const ROLE = installRole();
const localData = () => process.env.LOCALAPPDATA || path.join(app.getPath("home"), "AppData", "Local");

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

function createWindow() {
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
  // Setup guide links open in the normal browser, never inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  window.on("closed", () => { window = null; });
  return window;
}

async function openServer() {
  try {
    const preferences = JSON.parse(await readFile(path.join(localData(), "LocalAgentRouterData", "settings.json"), "utf8"));
    nativeTheme.themeSource = ["system", "light", "dark"].includes(preferences.theme) ? preferences.theme : "system";
    setRouterShortcut(preferences.shortcut || "Control+Shift+Space");
  } catch {}
  globalThis.setRouterTheme = (theme) => { nativeTheme.themeSource = theme; };
  globalThis.setRouterShortcut = setRouterShortcut;
  // Native folder picker for linked folders. The path comes from Windows' own dialog, never from page input.
  globalThis.routerPickFolder = async () => {
    const options = { title: "Link a folder (read-only)", properties: ["openDirectory"] };
    const result = await (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options));
    return result.canceled ? null : result.filePaths[0] || null;
  };
  if (safeStorage.isEncryptionAvailable()) {
    globalThis.routerEncrypt = (text) => safeStorage.encryptString(text).toString("base64");
    globalThis.routerDecrypt = (text) => safeStorage.decryptString(Buffer.from(text, "base64"));
  }
  await mkdir(app.getPath("userData"), { recursive: true });

  const { startServer } = await import("./server.mjs");
  router = await startServer(0, { role: ROLE });
  createWindow().loadURL(`http://127.0.0.1:${router.address().port}`);
}

// ---- Client: no local server and no provider work. The window shows the server's own page over Tailscale. ----
const CONNECT_URL = "http://router-connect.invalid/"; // the connect form submits here; the navigation is caught below
const clientFile = () => path.join(localData(), "LocalAgentRouterData", "client.json");
let target = null; // { origin, token } of the connected server

// The token is only ever sent over Tailscale: a 100.64.0.0/10 address or a MagicDNS (*.ts.net) name.
function serverOrigin(input) {
  let url;
  try { url = new URL(/^https?:\/\//i.test(input) ? input : `http://${input}`); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  const [a, b] = url.hostname.split(".").map(Number);
  const tailscale = (a === 100 && b >= 64 && b <= 127 && /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) || /\.ts\.net$/i.test(url.hostname);
  if (!tailscale && !(url.hostname === "127.0.0.1" && !app.isPackaged)) return null;
  if (!url.port && url.protocol === "http:") url.port = "8766";
  return url.origin;
}

function connectPage(message = "", origin = "") {
  const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Connect to a server</title><style>
body{font:15px "Segoe UI",system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:Canvas;color:CanvasText}
form{width:min(440px,90vw);display:grid;gap:12px}h1{font-size:22px;margin:0}p{margin:0;opacity:.8}
label{display:grid;gap:4px;font-weight:600}input{font:inherit;padding:8px 10px;border:1px solid GrayText;border-radius:6px}
button{font:inherit;padding:9px;border-radius:6px;border:0;background:AccentColor;color:AccentColorText;cursor:pointer}
.error{color:#c42b1c;opacity:1}</style></head><body><form action="${CONNECT_URL}" method="get">
<h1>Connect to your server PC</h1>
<p>Local Agent Router ${esc(app.getVersion())} client. Every task runs on the server; nothing runs on this PC.</p>
<p>On the server PC open Settings → Remote access, turn it on, and add this device. Enter the address and token it shows.</p>
${message ? `<p class="error" role="alert">${esc(message)}</p>` : ""}
<label>Server address<input name="server" required placeholder="100.101.102.103:8766" value="${esc(origin)}"></label>
<label>Device token<input name="token" type="password" required autocomplete="off"></label>
<button type="submit">Connect</button></form></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function checkServer(origin, token) {
  try {
    const response = await fetch(`${origin}/api/version`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (response.status === 401) return "The server didn't accept this device token. Add the device again on the server PC.";
    if (!response.ok) return `The server answered ${response.status}.`;
    return "";
  } catch {
    return `Can't reach ${origin}. Check that the server PC is on, remote access is turned on there, and Tailscale is connected on both PCs.`;
  }
}

async function showServer(origin, token) {
  const problem = await checkServer(origin, token);
  if (problem) return window.loadURL(connectPage(problem, origin));
  target = { origin, token };
  window.loadURL(`${origin}/`);
}

async function connect(params) {
  const origin = serverOrigin(String(params.get("server") || "").trim());
  const token = String(params.get("token") || "").trim();
  if (!origin) return window.loadURL(connectPage("Enter the server's Tailscale address, like 100.101.102.103:8766 or mypc.tailnet.ts.net."));
  if (!/^[\w-]{20,200}$/.test(token)) return window.loadURL(connectPage("That device token doesn't look right.", origin));
  if (!safeStorage.isEncryptionAvailable()) return window.loadURL(connectPage("Windows can't encrypt the token on this PC, so it can't be saved.", origin));
  const problem = await checkServer(origin, token);
  if (problem) return window.loadURL(connectPage(problem, origin));
  await mkdir(path.dirname(clientFile()), { recursive: true });
  await writeFile(clientFile(), JSON.stringify({ serverUrl: origin, token: safeStorage.encryptString(token).toString("base64") }, null, 2), "utf8");
  await showServer(origin, token);
}

async function openClient() {
  setRouterShortcut("Control+Shift+Space");
  createWindow();
  const contents = window.webContents;
  // The device token and this install's label go only to the connected server.
  contents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    if (target && details.url.startsWith(`${target.origin}/`)) {
      details.requestHeaders.Authorization = `Bearer ${target.token}`;
      details.requestHeaders["X-Router-Client"] = `${app.getVersion()} client`;
    }
    callback({ requestHeaders: details.requestHeaders });
  });
  contents.on("will-navigate", (event, url) => {
    if (target && url.startsWith(`${target.origin}/`)) return;
    event.preventDefault();
    if (url.startsWith(CONNECT_URL)) connect(new URL(url).searchParams).catch((error) => window?.loadURL(connectPage(error.message)));
  });
  contents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && target && url.startsWith(target.origin)) window.loadURL(connectPage("Lost the connection to the server.", target.origin));
  });
  // Ctrl+Shift+O: connect to a different server.
  contents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.control && input.shift && input.key.toLowerCase() === "o") { event.preventDefault(); window.loadURL(connectPage("", target?.origin || "")); }
  });
  let saved = null;
  try {
    const data = JSON.parse(await readFile(clientFile(), "utf8"));
    saved = { origin: serverOrigin(data.serverUrl), token: safeStorage.decryptString(Buffer.from(data.token, "base64")) };
  } catch {}
  if (saved?.origin) await showServer(saved.origin, saved.token);
  else window.loadURL(connectPage());
}

const openApp = () => (ROLE === "client" ? openClient() : openServer());

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

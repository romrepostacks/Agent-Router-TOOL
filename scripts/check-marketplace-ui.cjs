// Visible Electron walkthrough with synthetic data. Never opens the user's Router data or provider accounts.
// Run: node_modules/electron/dist/electron.exe scripts/check-marketplace-ui.cjs
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.agent-router', 'marketplace-ui');
app.setPath('userData', path.join(output, 'profile'));
let servers = [], installed = [];
const settings = { configured: true, setupComplete: true, projectsRoot: root, preapprovedSkillIds: [], skillsLimit: -1 };
const sources = [{ repo: 'example/skills', label: 'Fixture skills', from: 'UI fixture', builtIn: true }];
const registry = [{ id: 'official', label: 'Fixture registry', from: 'UI fixture' }];
const skill = { name: 'fixture-skill', group: 'Example', url: 'https://github.com/example/skills/blob/HEAD/SKILL.md' };
const row = { id: 'example/memory', title: 'Fixture memory', description: 'Synthetic MCP server; never started.', version: '1', needs: [], install: { name: 'memory', type: 'http', url: 'https://example.com/mcp' } };
const api = async (req, res, url) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  let value = {};
  switch (url.pathname) {
    case '/api/version': value = { version: 'fixture', role: 'server' }; break;
    case '/api/projects': case '/api/runs': case '/api/sessions': value = []; break;
    case '/api/settings': value = settings; break;
    case '/api/skills': value = { skills: installed, categories: ['General'] }; break;
    case '/api/status': value = { colibri: { online: false, models: [] }, commands: {}, apis: {} }; break;
    case '/api/marketplace': value = { skillSources: sources, mcpRegistries: registry }; break;
    case '/api/marketplace/skills': value = { skills: [skill] }; break;
    case '/api/marketplace/mcp': value = { servers: [row], nextCursor: '' }; break;
    case '/api/mcp': if (req.method === 'POST') servers = body.servers; value = { servers }; break;
    case '/api/skills/scan': value = { scanId: 'fixture', name: skill.name, purpose: 'Synthetic review fixture', instructions: '# Fixture skill', warnings: [], reviewers: [] }; break;
    case '/api/skills/install': installed = [{ id: 'fixture', name: skill.name, category: 'General', description: 'Fixture', instructions: '# Fixture' }]; value = { skill: installed[0], skills: installed, categories: ['General'], preapprovedSkillIds: [] }; break;
    case '/api/notifications': value = { events: [], boot: 'fixture' }; break;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value));
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const mobile = url.pathname.startsWith('/phone/');
    const relative = mobile ? url.pathname.slice(7) : url.pathname.slice(1);
    const base = path.join(root, mobile ? 'mobile/www' : 'public');
    const file = path.resolve(base, relative || 'index.html');
    if (!file.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
    const data = await fs.readFile(file);
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let window;
async function evaluate(code) {
  try { return await window.webContents.executeJavaScript(code, true); }
  catch (error) { throw new Error(`Renderer step failed: ${code}\n${error.message}`); }
}
async function waitFor(code) { for (let i = 0; i < 80; i++) { if (await evaluate(code)) return; await delay(100); } throw new Error(`Timed out: ${code}`); }
async function capture(name) { await fs.writeFile(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG()); }
app.whenReady().then(async () => {
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: false, running: true }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  window = new BrowserWindow({ width: 1280, height: 900, show: true, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  const errors = [];
  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) { errors.push(message); fs.appendFile(path.join(output, 'console.txt'), String(message) + '\n'); }
  });
  await window.loadURL(origin);
  await evaluate(`openSettings().then(() => selectSettingsTab('marketplace'))`);
  await waitFor(`document.querySelector('#market-skill-list').textContent.includes('fixture-skill')`);
  await capture('desktop-skills');
  await evaluate(`document.querySelector('#market-skill-filter').value='missing'; renderMarketSkills()`);
  assert.equal(await evaluate(`document.querySelector('#market-skill-list').textContent`), 'No skills match this filter.');
  await evaluate(`document.querySelector('#market-skill-filter').value=''; renderMarketSkills(); document.querySelector('#market-skill-list button').click()`);
  await waitFor(`!document.querySelector('#skill-scan-result').hidden`);
  await capture('desktop-review');
  await evaluate(`document.querySelector('#install-skill').click()`);
  await waitFor(`state.skills.some(s => s.name === 'fixture-skill')`);
  await evaluate(`selectSettingsTab('marketplace'); selectMarketTab('mcp')`);
  await waitFor(`document.querySelector('#market-mcp-list').textContent.includes('Fixture memory')`);
  await evaluate(`document.querySelector('#market-mcp-list button').click()`);
  await waitFor(`document.querySelector('#market-mcp-list').textContent.includes('Added')`);
  assert.equal(servers.length, 1);
  await capture('desktop-mcp');
  for (const [device, width, height] of [['iphone', 440, 956], ['note20', 412, 915]]) {
    installed = [];
    window.setContentSize(width, height);
    await window.loadURL(`${origin}/phone/index.html?device=${device}`);
    await waitFor(`conn.ok`);
    await evaluate(`document.querySelector('#open-skill-market').click()`);
    await waitFor(`document.querySelector('#sheet-body').textContent.includes('fixture-skill')`);
    await capture(`${device}-skills`);
    await evaluate(`document.querySelector('#sheet-body .row').click()`);
    await waitFor(`document.querySelector('#sheet-body').textContent.includes('Synthetic review fixture')`);
    await capture(`${device}-review`);
    await evaluate(`document.querySelector('#sheet-body .accent').click()`);
    await waitFor(`state.skills.some(s => s.name === 'fixture-skill')`);
    await waitFor(`state.sheet === null`);
    await evaluate(`document.querySelector('#open-mcp-market').click()`);
    await waitFor(`document.querySelector('#sheet-body').textContent.includes('Fixture memory')`);
    assert.equal(await evaluate(`document.documentElement.scrollWidth > innerWidth`), false);
    await capture(`${device}-mcp`);
    await evaluate(`closeSheet()`);
    await waitFor(`state.sheet === null`);
    const stability = await evaluate(`(() => {
      state.project = {id:'fixture', name:'Fixture'};
      state.session = {id:'fixture', messages:[]};
      push('chat');
      const list = document.querySelector('#messages');
      list.replaceChildren(...Array.from({length: 200}, (_, i) => bubble({role:'user', content:'Long session fixture ' + i}, i)));
      const message = {role:'assistant', content:'Streaming fixture', status:'Working', temporary:true};
      list.append(bubble(message, 200));
      const first = list.firstElementChild, last = list.lastElementChild;
      const prompt = document.querySelector('#prompt'); prompt.focus(); prompt.value = 'Draft stays intact';
      for (let i=0; i<250; i++) patchStreamingBubble(message);
      return {stable: first === list.firstElementChild && last === list.lastElementChild, draft: prompt.value, focused: document.activeElement === prompt};
    })()`);
    assert.deepEqual(stability, { stable: true, draft: 'Draft stays intact', focused: true });
  }
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, mode: 'visible Electron, synthetic API', nativeDeviceTest: false, errors }, null, 2));
  await fs.rm(path.join(output, 'failure.txt'), { force: true });
  console.log('Visible marketplace walkthrough passed. Screenshots: .agent-router/marketplace-ui/');
}).catch(async error => { console.error(error); await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'failure.txt'), error.stack); process.exitCode = 1; }).finally(() => { window?.destroy(); server.close(); app.quit(); });

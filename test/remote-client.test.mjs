// node --test test/*.test.mjs — remote access for Client installs and phones: device tokens, local-only routes,
// the stable run / notification responses, and revocation.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Fake local model that answers at once.
const model = http.createServer((req, res) => {
  if (req.url.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "fake" }] }));
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "remote answer" } }] })}\n\ndata: [DONE]\n\n`);
});
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
const free = await new Promise((resolve) => { const probe = http.createServer().listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });

const root = await mkdtemp(path.join(os.tmpdir(), "router-remote-"));
const projects = path.join(root, "Projects");
await mkdir(path.join(projects, "alpha"), { recursive: true });
Object.assign(process.env, { USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local"), AGENT_ROUTER_PROJECTS_ROOT: projects, AGENT_ROUTER_REMOTE_HOST: "127.0.0.1", COLIBRI_BASE_URL: `http://127.0.0.1:${model.address().port}/v1` });
const { startServer, tailscaleAddress } = await import("../server.mjs");
const server = await startServer(0);
const local = `http://127.0.0.1:${server.address().port}`;
const remoteBase = `http://127.0.0.1:${free}`;
const post = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const APP = JSON.parse(await (await import("node:fs/promises")).readFile(new URL("../package.json", import.meta.url), "utf8")).version;
const asDevice = (token, init = {}) => ({ ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, "X-Router-Client": "0.17.0 client" } });

test("a Client install can't start the router", async () => {
  await assert.rejects(startServer(0, { role: "client" }), /connects to a Server/);
});

test("only Tailscale addresses are picked for remote access", () => {
  assert.equal(tailscaleAddress({ lan: [{ family: "IPv4", address: "192.168.1.5" }], ts: [{ family: "IPv4", address: "100.101.102.103" }] }), "100.101.102.103");
  assert.equal(tailscaleAddress({ cgnatOutside: [{ family: "IPv4", address: "100.128.0.1" }], v6: [{ family: "IPv6", address: "fd7a:115c:a1e0::1" }] }), "");
});

test("paired devices reach the server over the remote listener; others don't", async () => {
  const off = await (await fetch(local + "/api/remote")).json();
  assert.equal(off.enabled, false);
  assert.equal(off.listening, false);
  const bad = await fetch(local + "/api/remote", post({ enabled: true, port: 80 }));
  assert.equal(bad.status, 400);

  const on = await (await fetch(local + "/api/remote", post({ enabled: true, port: free }))).json();
  assert.equal(on.listening, true, on.error);
  assert.equal(on.url, remoteBase);

  const added = await fetch(local + "/api/remote/devices", post({ name: "Kyle's phone" }));
  assert.equal(added.status, 201);
  const { device, token, url } = await added.json();
  assert.equal(url, remoteBase);
  assert.equal(device.tokenHash, undefined);
  assert.match(token, /^[\w-]{43}$/);
  const saved = await readFile(path.join(root, "local", "LocalAgentRouterData", "settings.json"), "utf8");
  assert.ok(!saved.includes(token), "the token itself is never saved");

  // No token, a wrong token, or a token on the local listener's host check: refused.
  assert.equal((await fetch(remoteBase + "/api/version")).status, 401);
  assert.equal((await fetch(remoteBase + "/", asDevice("x".repeat(43)))).status, 401);
  const foreignHost = await new Promise((resolve) => http.get(local + "/api/version", { headers: { Host: "evil.example", Authorization: `Bearer ${token}` } }, (res) => { res.resume(); resolve(res.statusCode); }));
  assert.equal(foreignHost, 403, "the local listener still only answers this PC, token or not");

  const version = await (await fetch(remoteBase + "/api/version", asDevice(token))).json();
  assert.deepEqual(version, { version: APP, role: "server", label: `${APP} server`, remote: true, device: { id: device.id, name: "Kyle's phone" }, client: "0.17.0 client" });
  const localVersion = await (await fetch(local + "/api/version")).json();
  assert.deepEqual(localVersion, { version: APP, role: "server", label: `${APP} server`, remote: false });
  assert.equal((await fetch(remoteBase + "/", asDevice(token))).status, 200, "the page itself loads for a Client window");

  // Things that act on the server PC itself stay local.
  for (const [route, init] of [["/api/remote", {}], ["/api/remote/devices", post({ name: "x" })], ["/api/setup/keys", post({})], ["/api/setup/terminal", post({ tool: "claude" })], ["/api/sessions/teleport", post({ projectId: "alpha" })], ["/api/projects/linked/pick", post({ projectId: "alpha" })]]) {
    assert.equal((await fetch(remoteBase + route, asDevice(token, init))).status, 403, route);
  }

  // A run started remotely streams, saves, and leaves a notification; the run snapshot is plain JSON.
  const before = await (await fetch(remoteBase + "/api/notifications", asDevice(token))).json();
  const session = await (await fetch(remoteBase + "/api/sessions", asDevice(token, post({ projectId: "alpha" })))).json();
  const stream = await fetch(remoteBase + "/api/chat/stream", asDevice(token, post({ message: "remote task", projectId: "alpha", sessionId: session.id, mode: "quick" })));
  assert.match(await stream.text(), /event: done/);
  assert.equal((await fetch(remoteBase + `/api/runs/${session.id}`, asDevice(token))).status, 404, "a finished run is in the session, not in runs");
  const saved2 = await (await fetch(remoteBase + `/api/sessions/${session.id}`, asDevice(token))).json();
  assert.equal(saved2.messages.at(-1).content, "remote answer");
  const after = await (await fetch(remoteBase + `/api/notifications?after=${before.latest}`, asDevice(token))).json();
  assert.equal(after.boot, before.boot);
  assert.deepEqual(after.items.map(({ type, sessionId, projectId, title }) => ({ type, sessionId, projectId, title })), [{ type: "done", sessionId: session.id, projectId: "alpha", title: "remote task" }]);

  const listed = await (await fetch(local + "/api/remote")).json();
  assert.ok(listed.devices.find((item) => item.id === device.id).lastSeenAt);

  // Removing the device stops its token at once.
  assert.equal((await fetch(local + `/api/remote/devices/${device.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await fetch(remoteBase + "/api/version", asDevice(token))).status, 401);

  // Turning remote access off closes the listener.
  const closed = await (await fetch(local + "/api/remote", post({ enabled: false }))).json();
  assert.equal(closed.listening, false);
  await assert.rejects(fetch(remoteBase + "/api/version", asDevice(token)));
});

test.after(() => { server.close(); model.close(); });

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
const source = await readFile(new URL('../mobile/www/app.js', import.meta.url), 'utf8');
test('mobile Enter sends, Shift+Enter and composition preserve text', () => {
  let handler, submits = 0;
  const start = source.lastIndexOf('$("prompt").addEventListener("keydown"');
  const end = source.indexOf('\nasync function sendFollowup', start);
  vm.runInNewContext(source.slice(start,end), { $: (id) => id === 'prompt' ? { addEventListener: (_name, callback) => { handler = callback; } } : { requestSubmit: () => submits++ } });
  let prevented = 0;
  const event = { key: 'Enter', shiftKey: false, isComposing: false, preventDefault: () => prevented++ };
  handler(event); handler({ ...event, shiftKey: true }); handler({ ...event, isComposing: true });
  assert.equal(submits,1); assert.equal(prevented,1);
});
test('connection code fills both fields and rejects non-Tailscale hosts', () => {
  const nodes = Object.fromEntries(['connection-code','server-url','server-token','connect-status'].map((id) => [id,{ value:'',textContent:'' }]));
  let handler;
  nodes['connection-code'].addEventListener = (_name,callback) => { handler=callback; };
  const start = source.lastIndexOf('$("connection-code").addEventListener');
  vm.runInNewContext(source.slice(start), { $: (id)=>nodes[id], serverUrlProblem: (value) => typeof value !== 'string' || !value.startsWith('http://100.') });
  handler({ target:{ value:JSON.stringify({server:'http://100.101.102.103:8766',token:'test-key'}) }});
  assert.equal(nodes['server-url'].value,'http://100.101.102.103:8766'); assert.equal(nodes['server-token'].value,'test-key');
  handler({ target:{ value:JSON.stringify({server:'https://example.com',token:'bad'}) }});
  assert.equal(nodes['server-token'].value,'test-key'); assert.match(nodes['connect-status'].textContent,/Paste/);
});
test('public/app.js: Enter steers, Queue button queues, empty submission never stops', async () => {
  const code = await readFile(new URL('../public/app.js', import.meta.url),'utf8');
  let delivery, cancelled = 0;
  const prompt = { value:'follow-up' };
  const context = { $: () => prompt, state:{project:{id:'alpha'}}, viewedRun:()=>({active:true,sessionId:'test-session'}), sendFollowup:(value)=>{delivery=value}, request:async()=>{cancelled++} };
  const start=code.indexOf('async function sendMessage(event)');
  vm.createContext(context); vm.runInContext(code.slice(start,code.indexOf('\nasync function retryLastRequest',start)),context);
  await context.sendMessage({preventDefault(){},submitter:null});assert.equal(delivery,'steer');
  await context.sendMessage({preventDefault(){},submitter:{id:'queue'}});assert.equal(delivery,'queue');
  await context.sendMessage({preventDefault(){},submitter:{id:'steer'}});assert.equal(delivery,'steer');
  delivery=undefined; prompt.value='';await context.sendMessage({preventDefault(){},submitter:null});
  assert.equal(delivery,undefined);assert.equal(cancelled,0);
});
test('mobile/www/app.js: Enter steers, Queue button queues, empty submission never stops (same as desktop)', async () => {
  let submit, delivery, cancelled = 0;
  const prompt = { value:'follow-up' };
  const context = { $: (id)=>id==='composer'?{addEventListener:(_name,callback)=>{submit=callback}}:prompt, state:{project:{id:'alpha'}}, viewedRun:()=>({active:true,sessionId:'test-session'}), sendFollowup:(value)=>{delivery=value}, request:async()=>{cancelled++}, toastError:()=>{} };
  const start=source.indexOf('$("composer").addEventListener("submit"');
  vm.runInNewContext(source.slice(start,source.indexOf('\nasync function submitRequest',start)),context);
  await submit({preventDefault(){},submitter:null});assert.equal(delivery,'steer');
  await submit({preventDefault(){},submitter:{id:'queue'}});assert.equal(delivery,'queue');
  await submit({preventDefault(){},submitter:{id:'steer'}});assert.equal(delivery,'steer');
  delivery=undefined; prompt.value='';await submit({preventDefault(){},submitter:null});
  assert.equal(delivery,undefined);assert.equal(cancelled,0);
});
test('native polling ignores another queued request in the same session', async () => {
  const start=source.indexOf('async function pollRun('), end=source.indexOf('\nlet liveFrame', start);
  const snapshots=[{requestId:'older',final:{event:'done',value:{content:'wrong response'}}},{requestId:'mine',final:{event:'done',value:{content:'correct response'}}}];
  const context={ stream:async()=>({ok:true,status:200,json:async()=>snapshots.shift()}), readStream:async()=>{}, setTimeout:(callback)=>callback() };
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  const result=await context.pollRun(new Promise(()=>{}),()=>{},'same-session','mine');
  assert.equal(result.content,'correct response');assert.equal(snapshots.length,0);
});

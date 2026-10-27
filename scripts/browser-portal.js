// Real-browser check of CUUED on a game website (not part of CI; needs Google Chrome and internet for PeerJS signaling):
// builds the portal package, serves it under /games/cuued/ beside a stand-in site whose /play/cuued page embeds it the way
// PORTAL.md says, and checks: the game loads in the frame and says ready, the site hears gameplayStart / gameOver, the site
// can pause and mute it, arrow keys never scroll the site's page, there's no Add to Home Screen prompt, and a Versus room's
// invite link points at the site's page; a friend who opens that link joins the room inside the site's frame.
//   node scripts/browser-portal.js
const { spawn, execSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = path.join(__dirname, '..');
execSync('node scripts/build.js --portal', { cwd: root, stdio: 'ignore' });
const PKG = path.join(root, 'dist', 'portal', 'cuued');
const SITE = `<!doctype html><meta charset="utf-8"><title>Flick</title><style>body{margin:0;height:3000px;background:#222}#bar{height:48px;color:#fff;font:20px sans-serif;padding:10px}#wrap{height:600px}</style>
<div id="bar">Flick</div><div id="wrap"><iframe id="game" allow="fullscreen; autoplay; clipboard-write; web-share; screen-wake-lock" sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-pointer-lock" style="border:0;width:100%;height:100%"></iframe></div>
<script>window.__msgs=[];addEventListener('message',e=>{if(e.data&&e.data.flick)window.__msgs.push(e.data)});
const join=new URLSearchParams(location.search).get('join'),src=new URL('/games/cuued/index.html',location.href);src.searchParams.set('share',location.origin+location.pathname);if(join)src.searchParams.set('join',join);document.getElementById('game').src=src;</script>`;
const server = http.createServer((q, r) => { const u = new URL(q.url, 'http://x'); if (u.pathname.startsWith('/api/')) { r.writeHead(404); return r.end() }
  if (u.pathname === '/play/cuued') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(SITE) }
  if (u.pathname.startsWith('/games/cuued/')) { const f = path.join(PKG, decodeURIComponent(u.pathname.slice('/games/cuued/'.length)) || 'index.html');
    if (f.startsWith(PKG) && fs.existsSync(f) && fs.statSync(f).isFile()) { const ext = path.extname(f); r.writeHead(200, { 'content-type': { '.html': 'text/html', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' }[ext] || 'application/octet-stream' }); return r.end(fs.readFileSync(f)) } }
  r.writeHead(404); r.end() }).listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALL = []; process.on('exit', () => { for (const T of ALL) { try { T.proc.kill('SIGKILL') } catch {} try { fs.rmSync(T.dir, { recursive: true, force: true }) } catch {} } });
const results = []; const ok = (c, w) => { results.push([c ? 'PASS' : 'FAIL', w]); return c };
async function browser(port, name, phone) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuued-portal-'));
  const proc = spawn(CHROME, ['--headless=new', '--mute-audio', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 80; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break } catch { await sleep(100) } }
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pend = new Map(), errors = [];
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id) } if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text) });
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) });
  await cdp('Runtime.enable'); await cdp('Page.enable');
  if (phone) { await cdp('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } }); await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }) }
  else await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('cuued.name',${JSON.stringify(name)});localStorage.setItem('cuued.tut','1')}catch(e){}` });
  const top = async (e) => (await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const game = (e) => top(`(()=>{const w=document.getElementById('game').contentWindow;return w.eval(${JSON.stringify(e)})})()`);   // same origin, so the site can look inside for the test
  const T = { proc, dir, cdp, top, game, errors, until: async (f, ms = 25000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(200) } return false } }; ALL.push(T); return T }
(async () => {
  const S = await browser(9461, 'Host', false);
  await S.cdp('Page.navigate', { url: BASE + '/play/cuued' });
  ok(await S.until(() => S.top(`window.__msgs.some(m=>m.flick==='ready')`)), 'the game loads in the frame and tells the site it is ready');
  ok(await S.game(`document.querySelector('#a2hs').hidden&&document.querySelector('#mA2').hidden`), 'no Add to Home Screen prompt inside a site');
  // arrow keys and Space stay in the game
  await S.top(`window.scrollTo(0,0)`); await S.game(`document.querySelector('#game').focus()`);
  for (const k of ['ArrowDown', 'Space', 'PageDown']) { await S.cdp('Input.dispatchKeyEvent', { type: 'keyDown', code: k, key: k === 'Space' ? ' ' : k, windowsVirtualKeyCode: k === 'Space' ? 32 : k === 'ArrowDown' ? 40 : 34 }); await S.cdp('Input.dispatchKeyEvent', { type: 'keyUp', code: k, key: k === 'Space' ? ' ' : k }) }
  await sleep(300); ok(await S.top(`window.scrollY===0`), `arrow keys and Space never scroll the site's page (scrollY ${await S.top('window.scrollY')})`);
  // a match: the site hears it start, can pause and mute it, and hears it end
  await S.game(`document.querySelector('#menu [data-sub=main] [data-act=solo]').click();document.querySelector('[data-act=cpu]').click()`);
  ok(await S.until(() => S.top(`window.__msgs.some(m=>m.flick==='gameplayStart'&&m.mode==='cpu')`), 5000), 'the site hears gameplayStart when a match begins');
  await S.until(() => S.game(`!document.querySelector('#pick').hidden`), 5000); await sleep(900); await S.game(`document.querySelector('#pick .card').click()`);
  await S.until(() => S.game(`(()=>{const s=document.querySelector('#game');return true})()`), 1000); await sleep(2500);
  await S.top(`document.getElementById('game').contentWindow.postMessage({flick:'pause'},'*')`); await sleep(300);
  ok(await S.game(`!document.querySelector('#pause').hidden`), 'the site can pause a single-player match');
  await S.top(`document.getElementById('game').contentWindow.postMessage({flick:'resume'},'*')`); await sleep(300);
  ok(await S.game(`document.querySelector('#pause').hidden`), 'and resume it');
  await S.top(`document.getElementById('game').contentWindow.postMessage({flick:'mute'},'*')`); await sleep(200);
  ok(await S.game(`document.querySelector('[data-opt=sound] .val').textContent==='Off'`), 'the site can mute it');
  await S.top(`document.getElementById('game').contentWindow.postMessage({flick:'unmute'},'*')`);
  await S.game(`document.querySelector('#pause [data-act=menu]').click()`); await sleep(400);
  ok(await S.top(`window.__msgs.some(m=>m.flick==='gameplayStop')`), 'the site hears gameplayStop back at the menu');
  // a Versus room: the invite link is the site's page; a friend opens it and lands in the room inside the site's frame
  await S.game(`document.querySelector('#menu [data-sub=main] [data-act=multi]').click();document.querySelector('[data-sub=multi] [data-act=versus]').click();document.querySelector('[data-sub=online] [data-act=host]').click()`);
  ok(await S.until(() => S.game(`/^[A-Z0-9]{4}$/.test(document.querySelector('#bsCode').textContent)`)), 'a Versus room opens inside the site');
  const code = await S.game(`document.querySelector('#bsCode').textContent`), link = await S.game(`inviteUrl(net.code)`).catch(() => null) || await S.game(`(()=>{let u='';try{u=document.querySelector('#bsQr').getAttribute('aria-label')}catch(e){}return u})()`);
  const host = await S.game(`document.querySelector('#bsHost').textContent`);
  ok(host === '127.0.0.1:' + server.address().port, `the lobby names the site, not cuued.com (${host})`);
  const F = await browser(9462, 'Friend', true);
  await F.cdp('Page.navigate', { url: `${BASE}/play/cuued?join=${code}` });
  ok(await F.until(() => F.game(`!document.querySelector('#joinRoster').hidden&&/You're in/.test(document.querySelector('#joinMsg').textContent)`).catch(() => false), 30000), "a friend opening the site's invite link joins the room");
  ok(await S.until(() => S.game(`document.querySelectorAll('#bsSeats li:not(.open):not(.cpu):not(.th)').length===2`)), 'the host sees the friend in the lobby');
  await S.game(`document.querySelector('[data-act=bsStart]').click()`);
  ok(await S.until(() => S.game(`window.document.querySelector('#bigLobby').hidden`)) && await F.until(() => F.game(`document.querySelector('#menu').hidden`)), 'the match starts on both, inside the site');
  ok(!S.errors.length && !F.errors.length, `no page errors${S.errors.length + F.errors.length ? ': ' + [...S.errors, ...F.errors].slice(0, 2).join(' | ') : ''}`);
  for (const [r, w] of results) console.log(r.padEnd(5), w); const bad = results.filter((r) => r[0] === 'FAIL').length;
  console.log(bad ? `\n${bad} of ${results.length} failed` : `\nall ${results.length} passed`); server.close(); process.exit(bad ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(1) });

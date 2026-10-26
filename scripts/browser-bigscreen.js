// Real-browser Big Screen (not part of CI; needs Google Chrome and internet for PeerJS signaling and the QR library): serves
// the local build and opens a laptop-sized screen and two phone-sized touch screens in headless Chrome. The screen opens
// Big Screen and shows its QR code; the phones open the join link (what scanning the QR code does), become controllers,
// pick their cards by tapping, then play with real touches: a drag on the left half runs, a drag-and-release on the right
// half fires, a quick tap auto-fires, Jump and Block. Reports page errors, frame rates and whether the touches moved and
// fired each phone's fighter on the screen; saves screenshots of every step.
//   node scripts/browser-bigscreen.js [outDir]
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'cuued-bigscreen-shots-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/\}\)\(\);\s*<\/script>/, ';window.__G={game,net,ctl,get players(){return players},get bullets(){return bullets},get spick(){return spick}};})();</script>');
const server = http.createServer((q, r) => { if (q.url.startsWith('/api/turn')) { r.writeHead(404); return r.end() }
  if (q.url.startsWith('/cards/') || q.url.endsWith('.webp')) { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (fs.existsSync(f)) { r.writeHead(200, { 'content-type': 'image/webp' }); return r.end(fs.readFileSync(f)) } r.writeHead(404); return r.end() }
  r.writeHead(200, { 'content-type': 'text/html' }); r.end(html) }).listen(0);
const URL0 = `http://127.0.0.1:${server.address().port}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALL = []; process.on('exit', () => { for (const T of ALL) { try { T.proc.kill('SIGKILL') } catch {} } });
const results = []; const ok = (c, w) => { results.push([c ? 'PASS' : 'FAIL', w]); return c };
async function browser(port, name, phone) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuued-bs-'));
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {} });
  const proc = spawn(CHROME, ['--headless=new', '--mute-audio', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--window-size=1440,900', '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 80; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break } catch { await sleep(100) } }
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pend = new Map(), errors = [];
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id) }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map((a) => a.value ?? a.description).join(' ')) });
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) });
  const ev = async (e) => { const r = (await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result; if (r?.exceptionDetails) errors.push('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r?.result?.value };
  await cdp('Runtime.enable'); await cdp('Page.enable');
  if (phone) { await cdp('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }) }
  else await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('cuued.name',${JSON.stringify(name)})}catch(e){}` });
  const shot = async (f) => { const r = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, f), Buffer.from(r.result.data, 'base64')) };
  const touch = (type, pts) => cdp('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, i]) => ({ x, y, id: i || 0 })) });
  const box = (sel) => ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect();return r&&r.width?[r.x+r.width/2,r.y+r.height/2]:null})()`);
  return { proc, dir, cdp, ev, errors, shot, touch, box, until: async (e, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(e)) return true; await sleep(150) } return false } };
}
const FPS = `(()=>{if(window.__fr)return;const f=window.__fr=[];let l=performance.now();const g=t=>{f.push(t-l);l=t;requestAnimationFrame(g)};requestAnimationFrame(g)})()`;
const fpsOf = async (T) => T.ev(`(()=>{const f=window.__fr.slice(30);if(!f.length)return 0;const a=f.reduce((x,y)=>x+y,0)/f.length;return Math.round(1000/a)})()`);
(async () => {
  const S = await browser(9361, 'Laptop', false); ALL.push(S);
  await S.cdp('Page.navigate', { url: URL0 }); await sleep(2500);
  await S.ev(`document.querySelector('[data-act="multi"]').click()`); await sleep(200);
  ok(await S.ev(`!!document.querySelector('[data-act="bigscreenMenu"]')`), 'Multiplayer lists Big Screen');
  await S.ev(`document.querySelector('[data-act="bigscreenMenu"]').click()`); await sleep(200);
  ok(await S.ev(`!document.querySelector('[data-sub="bigscreen"]').hidden&&!!document.querySelector('[data-sub="bigscreen"] [data-act="bigscreen"]')&&!!document.querySelector('[data-sub="bigscreen"] [data-act="join"]')`), 'Big Screen offers Host or Join');
  await S.shot('0-screen-bigscreen-menu.png');
  await S.ev(`document.querySelector('[data-sub="bigscreen"] [data-act="bigscreen"]').click()`);
  if (!ok(await S.until(`/^[A-Z0-9]{4}$/.test(document.querySelector('#bsCode').textContent)`, 25000), 'the screen opens a Big Screen room with a code')) return finish();
  const code = await S.ev(`document.querySelector('#bsCode').textContent`);
  ok(await S.until(`document.querySelector('.bs-qr').classList.contains('on')`, 15000), 'the QR code draws');
  await S.ev(FPS); await S.shot('1-screen-lobby.png');
  // two phones open the join link, as scanning the QR code does
  const P = [await browser(9362, 'Ana', true), await browser(9363, 'Ben', true)]; ALL.push(...P);
  await P[0].cdp('Page.navigate', { url: URL0 + '#' + code });   // phone 1 scans the QR code (opens the link)
  await P[1].cdp('Page.navigate', { url: URL0 }); await sleep(2500);   // phone 2 goes Multiplayer > Big Screen > Join with a code
  for (const sel of ['[data-act="multi"]', '[data-act="bigscreenMenu"]', '[data-sub="bigscreen"] [data-act="join"]']) { const b = await P[1].box(sel); if (b) { await P[1].touch('touchStart', [b]); await P[1].touch('touchEnd', []); } await sleep(300) }
  await P[1].ev(`(()=>{const i=document.querySelector('#joinCode');i.value=${JSON.stringify(code)};document.querySelector('#joinForm').requestSubmit()})()`);
  await sleep(1500);
  for (const [i, T] of P.entries()) ok(await T.until(`window.__G.ctl.on&&window.__G.ctl.view==='lobby'&&/Player/.test(document.querySelector('#padLobbyT').textContent)`, 30000), `phone ${i + 1} becomes a controller in the lobby`);
  ok(await S.until(`document.querySelectorAll('#bsSeats li:not(.open):not(.cpu):not(.th)').length===2`, 8000), 'the screen seats both phones');
  ok(await S.ev(`document.querySelector('[data-act=bsStart]').disabled===false`), 'Start is ready with two phones and no CPUs');
  await P[0].shot('2-phone-lobby.png'); await S.shot('3-screen-lobby-full.png');
  // one CPU added by the host, then Start
  await S.ev(`(()=>{const b=document.querySelector('[data-opt="bsBots"]');b.click()})()`); await sleep(300);
  ok(await S.ev(`document.querySelectorAll('#bsSeats li.cpu').length===1`), 'adding a CPU player shows it in a seat');
  await S.ev(`document.querySelector('[data-act=bsStart]').click()`);
  ok(await S.until(`window.__G.game.screen&&window.__G.players.length===3&&!document.querySelector('#bsPick').hidden`, 10000), 'Start: three fighters (two phones and a CPU), the draft on the screen');
  for (const T of P) await T.until(`window.__G.ctl.hand&&!document.querySelector('#padPick').hidden`, 10000);
  await sleep(600); await P[0].shot('4-phone-pick.png'); await S.shot('5-screen-draft.png');
  // each phone taps a card
  for (const [i, T] of P.entries()) { const b = await T.box(`#padCards .pcard:nth-child(${i + 1})`); if (b) { await T.touch('touchStart', [b]); await sleep(40); await T.touch('touchEnd', []); } }
  ok(await S.until(`(()=>{const s=window.__G.spick;return !s||Object.keys(s.chosen).length===3})()`, 8000), 'both phones pick by tapping (the CPU too)');
  await sleep(1500); await S.shot('6-screen-reveal.png');
  ok(await S.until(`window.__G.game.state==='play'`, 15000), 'the match starts after the reveal');
  for (const T of P) await T.ev(FPS);
  await sleep(500); await S.shot('7-screen-play.png'); await P[0].shot('8-phone-controls.png');
  // touches: phone 1 runs right with its left thumb, then fires with a drag-release, then a quick tap
  const me = await P[0].ev(`window.__G.ctl.me`), b0 = 0;
  let x0 = 0, x1 = 0, dir = 1;
  for (let tries = 0; tries < 4 && Math.abs(x1 - x0) <= 60; tries++) {   // wait for this fighter to be up and the point live (the CPU may have knocked it out)
    await S.until(`window.__G.game.state==='play'&&window.__G.players[${me}].alive`, 15000); await sleep(200);
    x0 = await S.ev(`window.__G.players[${me}].x`); dir = x0 < 960 ? 1 : -1;
    await P[0].touch('touchStart', [[180, 260, 1]]); for (let k = 1; k <= 6; k++) { await P[0].touch('touchMove', [[180 + dir * k * 12, 260, 1]]); await sleep(30) }
    await sleep(700); x1 = await S.ev(`window.__G.players[${me}].x`); await P[0].touch('touchEnd', []) }
  ok(Math.abs(x1 - x0) > 60, `a drag on the left half runs that phone's fighter on the screen (${Math.round(x0)} → ${Math.round(x1)})`);
  let fired = 0; const seen = new Set(); const watch = setInterval(async () => { const ids = await S.ev(`window.__G.bullets.filter(b=>b.owner.id===${me}).map(b=>b.id)`); for (const i of ids || []) if (!seen.has(i)) { seen.add(i); fired++ } }, 40);
  let guide = false;
  for (let tries = 0; tries < 4 && !fired; tries++) {   // the CPU may knock this fighter out mid-check: then wait for the next point and try again
    await S.until(`window.__G.game.state==='play'&&window.__G.players[${me}].alive`, 15000); await sleep(300);
    await P[0].touch('touchStart', [[640, 250, 2]]); for (let k = 1; k <= 5; k++) { await P[0].touch('touchMove', [[640 + dir * k * 8, 250 - k * 14, 2]]); await sleep(30) }
    await sleep(200); guide = guide || await S.ev(`window.__G.players[${me}].padAiming`); if (!tries) await S.shot('9-screen-aimguide.png');
    await P[0].touch('touchEnd', []); await sleep(500);
    await P[0].touch('touchStart', [[640, 250, 3]]); await sleep(60); await P[0].touch('touchEnd', []); await sleep(600) }
  clearInterval(watch);
  const diag = await S.ev(`(()=>{const p=window.__G.players[${me}];return {state:window.__G.game.state,alive:p.alive,ammo:p.ammo,sc:p.padSc,ac:p.padAc,tap:p.padTap,frozen:p.frozenT>0}})()`), pdiag = await P[0].ev(`({sc:window.__G.ctl.sc,ac:window.__G.ctl.ac,view:window.__G.ctl.view,hand:!!window.__G.ctl.hand})`);
  ok(guide, 'dragging the aim stick shows that fighter\'s aim guide on the screen');
  ok(fired >= 1, `a drag-and-release and a tap fire that fighter's gun on the screen (${fired} bullets; screen ${JSON.stringify(diag)} phone ${JSON.stringify(pdiag)})`);
  const jb = await P[0].box('#pJump'); if (jb) { await P[0].touch('touchStart', [jb]); await sleep(80); await P[0].touch('touchEnd', []) }
  // phone 2 plays on its own for a while (in-page: steering by eye is out of reach here, so it just runs and fires)
  await P[1].ev(`(()=>{let k=0;window.__bot=setInterval(()=>{const c=window.__G.ctl;k++;c.mx=(k>>4)%2?1:-1;if(k%9===0)c.jc++;if(k%7===0){c.a=Math.random()*6.28;c.sc++}if(k%11===0)c.ac++},50)})()`);
  await sleep(9000);
  const st = await P[0].ev(`window.__G.ctl.st`);
  ok(st && st.mh > 0 && Array.isArray(st.w) && st.w.length === 3, 'each phone gets its health and the score');
  await P[0].shot('10-phone-status.png'); await S.shot('11-screen-later.png');
  const fs1 = await fpsOf(S), fp = await Promise.all(P.map(fpsOf));
  ok(fs1 >= 50, `the screen runs smoothly (${fs1} fps)`);
  ok(fp.every((f) => f >= 50), `the phones run smoothly (${fp} fps)`);
  ok(await S.ev(`window.__G.net.peers.every(p=>p.rtt<100)`), `low ping to both phones (${await S.ev(`window.__G.net.peers.map(p=>Math.round(p.rtt))`)} ms)`);
  // portrait: the controls ask to turn sideways
  await P[0].cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } }); await sleep(400);
  ok(await P[0].ev(`getComputedStyle(document.querySelector('.pad-rot')).display!=='none'`), 'held upright, the controller asks to be turned sideways');
  await P[0].shot('12-phone-portrait.png');
  await P[0].cdp('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  // the screen pauses: the phones say so
  await S.ev(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape',key:'Escape'}))`); await sleep(600);
  ok(await P[0].until(`/Paused/.test(document.querySelector('#padMsg').textContent)`, 3000), 'pausing on the screen shows Paused on the phones');
  await S.shot('13-screen-pause.png');
  for (const T of [S, ...P]) ok(!T.errors.length, `no page errors (${T === S ? 'screen' : 'phone'}${T.errors.length ? ': ' + T.errors.slice(0, 2).join(' | ') : ''})`);
  finish();
})().catch((e) => { console.error(e); finish() });
function finish() { for (const [r, w] of results) console.log(r.padEnd(5), w); const bad = results.filter((r) => r[0] === 'FAIL').length;
  console.log(bad ? `\n${bad} of ${results.length} failed` : `\nall ${results.length} passed`); console.log('screenshots:', OUT);
  for (const T of ALL) { try { T.proc.kill('SIGKILL') } catch {} } server.close(); process.exit(bad ? 1 : 0) }

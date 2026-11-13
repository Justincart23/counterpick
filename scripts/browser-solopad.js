// Real-browser Single player > Phone as controller (not part of CI; needs Google Chrome and internet for PeerJS signaling):
// a laptop-sized screen opens it from the Single player menu, one phone opens the join link (what scanning the QR code
// does) and the match starts by itself against a CPU. The phone picks its card, the match ends, and the phone's Play again
// starts the rematch. Leaving puts the CPU-players setting back. Saves screenshots of every step.
//   node scripts/browser-solopad.js [outDir]
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'cuued-solopad-shots-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/\}\)\(\);\s*<\/script>/, ';window.__G={game,net,ctl,settings,endMatch,toMenu,get players(){return players},get spick(){return spick}};})();</script>');
const server = http.createServer((q, r) => { if (q.url.startsWith('/api/turn')) { r.writeHead(404); return r.end() }
  if (q.url.startsWith('/cards/') || q.url.endsWith('.webp')) { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (fs.existsSync(f)) { r.writeHead(200, { 'content-type': 'image/webp' }); return r.end(fs.readFileSync(f)) } r.writeHead(404); return r.end() }
  r.writeHead(200, { 'content-type': 'text/html' }); r.end(html) }).listen(0);
const URL0 = `http://127.0.0.1:${server.address().port}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALL = []; process.on('exit', () => { for (const T of ALL) { try { T.proc.kill('SIGKILL') } catch {} } });
const results = []; const ok = (c, w) => { results.push([c ? 'PASS' : 'FAIL', w]); return c };
async function browser(port, name, phone) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuued-sp-'));
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

(async () => {
  const S = await browser(9371, 'Laptop', false); ALL.push(S);
  await S.cdp('Page.navigate', { url: URL0 }); await sleep(2500);
  await S.ev(`document.querySelector('[data-act="solo"]').click()`); await sleep(1500);
  ok(await S.ev(`!!document.querySelector('[data-sub="soloHow"] [data-act="soloPad"]')`), 'Single player lists Phone as controller');
  await S.shot('0-solo-menu.png');
  { const M = await browser(9373, 'Ana', true); ALL.push(M); await M.cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
    await M.cdp('Page.navigate', { url: URL0 }); await sleep(2500); await M.ev(`document.querySelector('[data-act="solo"]').click()`); await sleep(1500); await M.shot('0b-solo-menu-phone.png'); M.proc.kill('SIGKILL') }
  await S.ev(`document.querySelector('[data-sub="soloHow"] [data-act="soloPad"]').click()`);
  if (!ok(await S.until(`/^[A-Z0-9]{4}$/.test(document.querySelector('#bsCode').textContent)`, 25000), 'it opens a room with a code')) return finish();
  const code = await S.ev(`document.querySelector('#bsCode').textContent`);
  ok(await S.ev(`document.querySelector('#bigLobby .screen-title').textContent==='Phone controller'`), 'the lobby is titled for one player with a phone controller');
  ok(await S.ev(`document.querySelectorAll('#bsSeats li.cpu').length===1&&window.__G.settings.bsBots===1`), 'a CPU opponent is already seated');
  ok(await S.ev(`/your phone becomes the controller/.test(document.querySelector('#bsMsg').textContent)`), 'the lobby says to scan with your phone');
  await sleep(800); await S.shot('1-solo-lobby.png');
  const P = await browser(9372, 'Ana', true); ALL.push(P);
  await P.cdp('Page.navigate', { url: URL0 + '#' + code }); await sleep(2500);
  ok(await P.until(`window.__G.ctl.on&&window.__G.ctl.view==='lobby'`, 30000), 'the phone becomes the controller');
  ok(await S.until(`/Controller connected/.test(document.querySelector('#bsMsg').textContent)`, 5000), 'the screen says the controller is connected');
  await S.shot('2-solo-connected.png');
  ok(await S.until(`window.__G.game.screen&&window.__G.players.length===2`, 8000), 'the match starts by itself: the phone against one CPU');
  ok(await P.until(`window.__G.ctl.solo===true`, 5000), 'the phone knows it is a solo game');
  if (await P.until(`window.__G.ctl.hand&&!document.querySelector('#padPick').hidden`, 10000)) { await sleep(500); const b = await P.box('#padCards .pcard'); if (b) { await P.touch('touchStart', [b]); await sleep(40); await P.touch('touchEnd', []) } }
  ok(await S.until(`window.__G.game.state==='play'`, 15000), 'after the card pick the match plays');
  await sleep(1200); await S.shot('3-solo-play.png'); await P.shot('4-phone-play.png');
  const me = await P.ev(`window.__G.ctl.me`), myTeam = await S.ev(`window.__G.players[${me}].team`);
  await S.ev(`window.__G.endMatch(${myTeam})`);
  ok(await P.until(`!document.querySelector('#padOver').hidden&&!document.querySelector('#padAgain').hidden`, 5000), 'match over: the phone shows Play again');
  ok(await P.ev(`document.querySelector('#padOverT').textContent==='You win!'`), `a one-on-one win says You win! (${await P.ev(`document.querySelector('#padOverT').textContent`)})`);
  await sleep(400); await P.shot('5-phone-over.png'); await S.shot('6-screen-over.png');
  const b = await P.box('#padAgain'); await P.touch('touchStart', [b]); await sleep(40); await P.touch('touchEnd', []);
  ok(await S.until(`window.__G.game.state!=='over'&&window.__G.players.length===2`, 8000), "the phone's Play again starts the rematch on the screen");
  ok(await P.until(`document.querySelector('#padOver').hidden`, 8000), 'the phone leaves the match-over sheet');
  await S.ev(`window.__G.toMenu()`); await sleep(500);
  ok(await S.ev(`window.__G.settings.bsBots===0&&!window.__G.net.solo`), 'leaving puts the CPU-players setting back (it was None)');
  await S.ev(`document.querySelector('[data-act="bsQuick"]').click()`); await sleep(1500);
  ok(await S.ev(`/Versus · Big Screen|Co-op Survival · Big Screen/.test(document.querySelector('#bigLobby .screen-title').textContent)&&document.querySelectorAll('#bsSeats li.cpu').length===0`), 'the normal Big Screen afterwards is unchanged (no CPU, its own title)');
  for (const T of [S, P]) ok(!T.errors.length, `no page errors (${T === S ? 'screen' : 'phone'}${T.errors.length ? ': ' + T.errors.slice(0, 2).join(' | ') : ''})`);
  finish();
})().catch((e) => { console.error(e); finish() });
function finish() { for (const [r, w] of results) console.log(r.padEnd(5), w); const bad = results.filter((r) => r[0] === 'FAIL').length;
  console.log(bad ? `\n${bad} of ${results.length} failed` : `\nall ${results.length} passed`); console.log('screenshots:', OUT);
  for (const T of ALL) { try { T.proc.kill('SIGKILL') } catch {} } server.close(); process.exit(bad ? 1 : 0) }

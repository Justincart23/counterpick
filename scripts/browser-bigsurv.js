// Real-browser Big Screen Co-op Survival (not part of CI; needs Google Chrome and internet for PeerJS signaling and the QR library): serves
// the local build and opens a laptop-sized screen and two phone-sized touch screens in headless Chrome. The screen goes
// Multiplayer > Co-op Survival > One big screen; the phones open the join link, choose their characters and free cards by
// tapping, a round is cleared, both phones shop (buy by tapping a card) and press Ready, and round 2 starts. Reports page
// errors and saves screenshots of every step (the screen's board while the phones choose and shop, the phones' screens).
//   node scripts/browser-bigsurv.js [outDir]
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'cuued-bigsurv-shots-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/\}\)\(\);\s*<\/script>/, ';window.__G={game,net,ctl,die,heroes,enemies,get players(){return players},get bullets(){return bullets},get spick(){return spick}};})();</script>');
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
(async () => {
  const S = await browser(9371, 'Laptop', false); ALL.push(S);
  await S.cdp('Page.navigate', { url: URL0 }); await sleep(2500);
  for (const sel of ['[data-sub="main"] [data-act="multi"]', '[data-sub="multi"] [data-act="coop"]']) { await S.ev(`document.querySelector('${sel}').click()`); await sleep(250) }
  ok(await S.ev(`!document.querySelector('#mpBig').hidden`), 'Co-op Survival offers One big screen');
  await S.ev(`document.querySelector('[data-sub="online"] [data-act="bigscreen"]').click()`);
  if (!ok(await S.until(`/^[A-Z0-9]{4}$/.test(document.querySelector('#bsCode').textContent)`, 25000), 'the screen opens a room with a code')) return finish();
  ok(await S.ev(`document.querySelector('#bigLobby').classList.contains('surv')&&!document.querySelector('#bsSurvNote').hidden&&/Co-op Survival/.test(document.querySelector('[data-opt=bsMode] .val').textContent)`), 'the lobby is set to Co-op Survival');
  const code = await S.ev(`document.querySelector('#bsCode').textContent`);
  const P = [await browser(9372, 'Ana', true), await browser(9373, 'Ben', true)]; ALL.push(...P);
  for (const T of P) await T.cdp('Page.navigate', { url: URL0 + '#' + code }); await sleep(2500);
  for (const [i, T] of P.entries()) ok(await T.until(`window.__G.ctl.on&&window.__G.ctl.view==='lobby'`, 30000), `phone ${i + 1} joins the lobby`);
  ok(await S.until(`!document.querySelector('[data-act=bsStart]').disabled`, 8000), 'Start is ready (no CPUs needed)'); await S.shot('1-screen-lobby.png'); await P[0].shot('2-phone-lobby.png');
  await S.ev(`document.querySelector('[data-act=bsStart]').click()`);
  ok(await S.until(`window.__G.game.bsSurv&&window.__G.heroes().length===2`, 8000), 'Start: a run with a hero per phone');
  for (const [i, T] of P.entries()) ok(await T.until(`window.__G.ctl.hand&&window.__G.ctl.hand.every(c=>c.char)`, 10000), `phone ${i + 1} chooses a character`);
  await sleep(800); await S.shot('3-screen-gearup.png'); await P[0].shot('4-phone-character.png');
  for (const T of P) { const b = await T.box('#padCards .pcard'); await T.touch('touchStart', [b]); await sleep(40); await T.touch('touchEnd', []) }
  for (const [i, T] of P.entries()) ok(await T.until(`window.__G.ctl.hand&&window.__G.ctl.hand.length===5&&!window.__G.ctl.hand.every(c=>c.char)`, 10000), `phone ${i + 1} gets its free pick`);
  await sleep(600); await S.shot('5-screen-waiting.png');
  for (const T of P) { const b = await T.box('#padCards .pcard'); await T.touch('touchStart', [b]); await sleep(40); await T.touch('touchEnd', []) }
  ok(await S.until(`window.__G.game.round===1&&document.querySelector('#bsPick').hidden`, 10000), 'round 1 starts and the board closes');
  await sleep(2500); await S.shot('6-screen-round1.png'); await P[0].shot('7-phone-controls.png');
  for (const T of P) ok(await T.until(`window.__G.ctl.st&&window.__G.ctl.st.sv===1&&window.__G.ctl.st.rd===1`, 5000), 'the phone shows the run (round, lives, scrap)');
  await S.ev(`(()=>{for(const p of window.__G.heroes())p.s.maxHp=p.hp=1e6;for(const e of window.__G.enemies())if(e.alive)window.__G.die(e)})()`);
  ok(await S.until(`window.__G.game.state==='shop'`, 10000), 'the round clears into the shop');
  for (const [i, T] of P.entries()) ok(await T.until(`window.__G.ctl.shop&&!document.querySelector('#padShop').hidden`, 8000), `phone ${i + 1} opens its shop`);
  await sleep(900); await P[0].shot('8-phone-shop.png'); await S.shot('9-screen-shop-board.png');
  const before = await S.ev(`window.__G.heroes()[0].cards.length+window.__G.heroes()[0].ups.length`);
  await S.ev(`window.__G.heroes()[0].scrap=99`); { const b = await P[0].box('#pshCards .pcard .pc-price'); await P[0].touch('touchStart', [b]); await sleep(40); await P[0].touch('touchEnd', []) }
  ok(await S.until(`window.__G.heroes()[0].cards.length+window.__G.heroes()[0].ups.length===${before}+1`, 5000), 'tapping a card on the phone buys it');
  for (const T of P) { const b = await T.box('#pshNext'); await T.touch('touchStart', [b]); await sleep(40); await T.touch('touchEnd', []) }
  ok(await S.until(`window.__G.game.round===2&&window.__G.game.state!=='shop'`, 10000), 'Ready on both phones starts round 2');
  for (const T of P) ok(await T.until(`!window.__G.ctl.shop&&document.querySelector('#padShop').hidden`, 5000), 'the phone closes its shop');
  await sleep(1500); await S.shot('10-screen-round2.png');
  ok(!S.errors.length, `no page errors (screen)${S.errors.length ? ': ' + S.errors.slice(0, 2).join(' | ') : ''}`);
  for (const T of P) ok(!T.errors.length, `no page errors (phone)${T.errors.length ? ': ' + T.errors.slice(0, 2).join(' | ') : ''}`);
  finish();
})().catch((e) => { console.error(e); finish() });

function finish() { for (const [r, w] of results) console.log(r.padEnd(5), w); const bad = results.filter((r) => r[0] === 'FAIL').length;
  console.log(bad ? `\n${bad} of ${results.length} failed` : `\nall ${results.length} passed`); console.log('screenshots:', OUT);
  for (const T of ALL) { try { T.proc.kill('SIGKILL') } catch {} } server.close(); process.exit(bad ? 1 : 0) }

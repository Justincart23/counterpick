// Phone check (not part of CI; needs Google Chrome): emulates a phone held sideways with real touch events and plays a bit
// of Practice vs CPU with the on-screen controls; also checks the touch controls stay hidden on a desktop.
//   node scripts/browser-mobile.js [outDir]
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'cuued-mobile-'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuued-mob-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {} });   // the Chrome profile is ~100 MB: never leave it behind
let html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace('<head>', '<head><script>try{localStorage.setItem("cuued.name","Phone");localStorage.setItem("counterpick.settings",JSON.stringify({drops:false,v:2}))}catch(e){}</script>');
html = html.replace(/\}\)\(\);\s*<\/script>/, ';window.__G={game,keys,mouse,recompute,settings,get players(){return players},get bullets(){return bullets}};})();</script>');
fs.writeFileSync(path.join(dir, 'm.html'), html);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const ok = (c, w) => { results.push([c ? 'PASS' : 'FAIL', w]); return c };
(async () => {
  const chrome = spawn(CHROME, ['--headless=new', '--mute-audio', '--remote-debugging-port=9345', `--user-data-dir=${dir}/p`, 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 80; i++) { try { tabs = await (await fetch('http://127.0.0.1:9345/json')).json(); break } catch { await sleep(100) } }
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pend = new Map(), errors = [];
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id) } if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text) });
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) });
  const ev = async (e) => (await cdp('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
  const shot = async (f) => { const r = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, f), Buffer.from(r.result.data, 'base64')) };
  const touch = (type, pts) => cdp('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
  const until = async (e, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(e)) return true; await sleep(100) } return false };
  await cdp('Runtime.enable');
  // desktop first: no touch controls anywhere
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: 'file://' + path.join(dir, 'm.html') }); await sleep(1800);
  ok(await ev(`!document.body.classList.contains('touch')&&getComputedStyle(document.querySelector('.mobile-row')).display==='none'`), 'desktop: phone-only buttons and controls stay hidden');
  // phone, sideways
  const W = 844, H = 390;
  await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  await cdp('Page.navigate', { url: 'file://' + path.join(dir, 'm.html') }); await sleep(1800);
  ok(await ev(`document.body.classList.contains('touch')`), 'phone: touch mode is on');
  ok(await ev(`getComputedStyle(document.querySelector('.mobile-row')).display!=='none'`), 'phone: the menu shows the phone row (Full screen / Add to Home Screen)');
  await shot('phone-menu.png');
  // settings: tiles that never overlap, and the ‹ › arrows step a value
  await ev(`document.querySelector('#menu [data-sub="main"] [data-act="settings"]').click()`); await sleep(1300);   // after the tiles' drop-in
  const so = await ev(`(()=>{const els=[...document.querySelectorAll('#menu [data-sub="settings"] .mlist button')].filter(e=>e.offsetParent).map(e=>e.getBoundingClientRect());let o=0;
    for(let i=0;i<els.length;i++)for(let j=i+1;j<els.length;j++){const a=els[i],b=els[j];if(a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1)o++}
    return{n:els.length,o,small:els.filter(r=>r.height<36).length,off:els.filter(r=>r.bottom>innerHeight+1||r.right>innerWidth+1).length}})()`);
  ok(so.n >= 9 && !so.o && !so.small && !so.off, `phone: settings are tappable tiles, none overlapping or off screen (${JSON.stringify(so)})`);
  const lenTap = async (d) => { const p = await ev(`(()=>{const r=document.querySelector('#menu [data-sub="settings"] [data-opt="len"] [data-dir="${d}"]').getBoundingClientRect();return[r.x+r.width/2,r.y+r.height/2]})()`);
    await touch('touchStart', [[p[0], p[1], 9]]); await sleep(40); await touch('touchEnd', []); await sleep(200); return ev(`window.__G.settings.len`) };
  const l0 = await ev(`window.__G.settings.len`), l1 = await lenTap(-1), l2 = await lenTap(1);
  ok(l1 !== l0 && l2 === l0, `phone: a setting's ‹ › arrows step it back and forward (${l0} → ${l1} → ${l2})`); await shot('phone-settings.png');
  await ev(`document.querySelector('#menu [data-sub="settings"] [data-act="back"]').click()`); await sleep(300);
  await ev(`document.querySelector('[data-act="cpu"]').click()`); await until(`!document.querySelector('#pick').hidden`); await sleep(900);
  await ev(`document.querySelector('#pick .card').click()`);
  ok(await until(`window.__G.game.state==='play'`, 8000), 'phone: a practice match starts by tapping');
  ok(await ev(`getComputedStyle(document.querySelector('#touchUI')).display==='block'`), 'phone: the touch controls show during play');
  const bs = await ev(`['tJump','tBlock'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return[Math.round(r.width),Math.round(r.height),Math.round(r.right),Math.round(r.bottom)]})`);
  ok(bs.every(([w, h, r, b]) => w >= 56 && h >= 90 && r <= 845 && b <= 391) && bs[0][3] <= bs[1][3] - 90, `phone: Jump and Block are big panels down the right edge (${JSON.stringify(bs)})`);
  // a calm test: the CPU stands still and our fighter carries no cards (bursts would look like extra shots)
  await ev(`(()=>{const G=window.__G,[P,E]=G.players;E.ctrl='idle';E.input.fire=false;E.input.move=0;P.cards=[];G.recompute(P);E.s.maxHp=E.hp=1e9;P.s.maxHp=P.hp=1e9})()`);   // neither can die (our shots, pits and edges never end the point mid-test)
  const me = `window.__G.players[0]`; const x0 = await ev(`${me}.x`);
  // left stick: drag right and hold
  await touch('touchStart', [[150, 280, 1]]); for (let k = 1; k <= 6; k++) { await touch('touchMove', [[150 + k * 12, 280, 1]]); await sleep(30) } await sleep(500);
  const x1 = await ev(`${me}.x`); ok(x1 - x0 > 120, `phone: the left stick runs (moved ${Math.round(x1 - x0)}px)`);
  await touch('touchEnd', []); await sleep(150);
  // right stick, Brawl Stars style (a new shot = a bullet of ours with a higher id than any before)
  const lastId = () => ev(`Math.max(0,...window.__G.bullets.filter(b=>b.owner===${me}).map(b=>b.id),window.__lastId||0)`);
  const remember = async () => { await ev(`window.__since0=${me}.sinceShot`); return 0 };
  // fired since remember() = the gun's time-since-last-shot reset (a bullet can hit a wall and vanish before we look)
  const firedSince = async () => (await ev(`${me}.sinceShot<window.__since0`));
  const waitReady = () => until(`window.__G.game.state==='play'&&${me}.alive&&${me}.fireT<=0&&${me}.ammo>0&&!(${me}.burstLeft>0)`, 8000);
  // 1) a quick tap fires one shot, auto-aimed at the CPU
  await waitReady(); let id0 = await remember();
  await touch('touchStart', [[700, 250, 2]]); await sleep(60); await touch('touchEnd', []);
  let tapShot = false; for (let i = 0; i < 10 && !tapShot; i++) { await sleep(50); tapShot = await firedSince(id0) }
  const towards = await ev(`(()=>{const p=${me},e=window.__G.players[1],a=p.aim;return Math.sign(Math.cos(a))===Math.sign(e.x-p.x)})()`);
  ok(tapShot && towards, `phone: a quick tap auto-aims at the CPU and fires (shot ${tapShot}, toward the CPU ${towards})`);
  // 2) dragging aims but holding doesn't fire; 3) letting go fires where it points
  await waitReady(); id0 = await remember();
  await touch('touchStart', [[700, 250, 2]]); for (let k = 1; k <= 6; k++) { await touch('touchMove', [[700 - k * 9, 250 - k * 7, 2]]); await sleep(40) } await sleep(400);
  const held = !(await firedSince(id0)), aimUpLeft = await ev(`(()=>{const a=${me}.aim;return Math.cos(a)<0&&Math.sin(a)<0})()`);
  ok(held && aimUpLeft, `phone: dragging the aim stick aims (up-left ${aimUpLeft}) without firing while held (${held})`);
  await shot('phone-play.png');
  await touch('touchEnd', []); let relShot = false; for (let i = 0; i < 10 && !relShot; i++) { await sleep(50); relShot = await firedSince(id0) }
  ok(relShot, 'phone: letting go of the aim stick fires');
  // 4) drag out, come back to the middle, let go: cancelled
  await waitReady(); id0 = await remember();
  await touch('touchStart', [[700, 250, 2]]); await touch('touchMove', [[760, 250, 2]]); await sleep(300); await touch('touchMove', [[702, 251, 2]]); await sleep(100); await touch('touchEnd', []); await sleep(400);
  ok(!(await firedSince(id0)), 'phone: dragging back to the middle before letting go cancels the shot');
  // jump and block buttons
  const jb = await ev(`(()=>{const r=document.querySelector('#tJump').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
  await sleep(600); const yv = []; await touch('touchStart', [[jb[0], jb[1], 3]]); for (let i = 0; i < 6; i++) { await sleep(40); yv.push(await ev(`${me}.vy`)) } await touch('touchEnd', []);
  ok(yv.some((v) => v < -300), `phone: the Jump button jumps (vy ${Math.round(Math.min(...yv))})`);
  await sleep(4500);   // let the block cool down if it was used
  const bb = await ev(`(()=>{const r=document.querySelector('#tBlock').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
  await until(`window.__G.game.state==='play'&&${me}.alive&&${me}.blockCd<=0`, 8000);   // the CPU may have ended the point meanwhile
  await touch('touchStart', [[bb[0], bb[1], 4]]); const blocked = await until(`${me}.blockT>0||${me}.blockCd>0`, 1000); await touch('touchEnd', []);
  ok(blocked, 'phone: the Block button blocks');
  // upright: rotate prompt
  await cdp('Emulation.setDeviceMetricsOverride', { width: H, height: W, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } }); await sleep(400);
  ok(await ev(`getComputedStyle(document.querySelector('#rotate')).display==='flex'`), 'phone held upright mid-match: asks you to turn it sideways'); await shot('phone-portrait.png');
  // the other screens fit a phone too: back to landscape, then the draft, the shop and the pause menu
  await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } }); await sleep(300);
  await ev(`(()=>{const b=document.querySelector('#bPause');b&&b.click()})()`); await sleep(400); await shot('phone-pause.png');
  ok(await ev(`!document.querySelector('#pause').hidden`), 'phone: the Pause button opens the pause menu');
  await ev(`document.querySelector('#pause [data-act="menu"]').click()`); await sleep(800);
  await ev(`document.querySelector('.mlist [data-act="shop"]').click()`); await sleep(400); await shot('phone-shop.png');
  await ev(`document.querySelector('[data-shopact="close"]').click()`); await ev(`document.querySelector('[data-act="cpu"]').click()`); await until(`!document.querySelector('#pick').hidden`); await sleep(900); await shot('phone-draft.png');
  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  for (const [r, w] of results) console.log(`${r}  ${w}`); console.log('screenshots in ' + OUT);
  const failed = results.filter(([r]) => r === 'FAIL').length; console.log(failed ? `\n${failed} of ${results.length} failed` : `\nall ${results.length} passed`);
  chrome.kill(); await sleep(300); try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }) } catch {} process.exit(failed ? 1 : 0);
})();

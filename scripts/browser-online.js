// Real-browser online match (not part of CI; needs Google Chrome and internet for PeerJS signaling): serves the local build,
// opens a host and a guest in separate headless Chrome windows, connects them with a room code, hands both fighters the
// block/movement cards, and lets in-page bots play for a while (move, jump, duck, block, shoot). Reports page errors, frame
// rates and snapshot gaps on both screens, whether host and guest agree, and saves screenshots from both views.
//   node scripts/browser-online.js [seconds=60] [outDir]
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const SECS = +(process.argv[2] || 60), OUT = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'cuued-online-shots-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/\}\)\(\);\s*<\/script>/, ';window.__G={game,net,keys,edges,mouse,CARDS,recompute,get players(){return players},get bullets(){return bullets},get shields(){return shields}};})();</script>');
const server = http.createServer((q, r) => { if (q.url.startsWith('/api/turn')) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': 'text/html' }); r.end(html) }).listen(0);
const URL0 = `http://127.0.0.1:${server.address().port}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const ok = (c, w) => { results.push([c ? 'PASS' : 'FAIL', w]); return c };

async function browser(port, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuued-ol-'));
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {} });   // each browser's ~100 MB profile
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--window-size=1600,900', '--autoplay-policy=no-user-gesture-required',
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
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('cuued.name',${JSON.stringify(name)})}catch(e){}` });
  await cdp('Page.navigate', { url: URL0 }); await sleep(2500);
  const shot = async (f) => { const r = await cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, f), Buffer.from(r.result.data, 'base64')) };
  return { proc, dir, cdp, ev, errors, shot, until: async (e, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(e)) return true; await sleep(150) } return false } };
}
// in-page bot + frame/snapshot recorders
const BOT = (me) => `(()=>{const G=window.__G;if(window.__bot)return;const st=window.__st={frames:[],snapGaps:[],last:performance.now(),lastSnap:null};
  const f=t=>{if(t-st.last>50)(st.long=st.long||[]).push(Math.round(t-st.last)+'ms '+G.game.state+' '+(G.game.map&&G.game.map.name)+' b'+G.bullets.length+' pick'+!document.querySelector('#pick').hidden);st.frames.push(t-st.last);st.last=t;const n=G.net.snap;if(n&&n!==st.lastSnap){if(st.snapT)st.snapGaps.push(t-st.snapT);st.snapT=t;st.lastSnap=n}requestAnimationFrame(f)};requestAnimationFrame(f);
  let k=0;window.__bot=setInterval(()=>{k++;const p=G.players[${me}],o=G.players[1-${me}];if(!p||!o)return;const K=G.keys,E=G.edges;
    for(const c of['KeyA','KeyD','KeyW','KeyS'])K.delete(c);
    const toward=o.x>p.x?'KeyD':'KeyA',away=toward==='KeyD'?'KeyA':'KeyD';K.add(Math.abs(o.x-p.x)>350?toward:(k>>3)%2?toward:away);
    if(k%9===0){E.add('KeyW');K.add('KeyW')}if(k%20>=15)K.add('KeyS');
    G.mouse.x=o.x+(Math.random()-.5)*60;G.mouse.y=o.y-40-(Math.random()*80);G.mouse.down=k%6<4;if(k%14===0)G.mouse.rEdge=true},50)})()`;

(async () => {
  const H = await browser(9341, 'Host'), V = await browser(9342, 'Visitor');
  await H.ev(`document.querySelector('[data-act="online"]').click()`); await sleep(200); await H.ev(`document.querySelector('[data-act="host"]').click()`);
  const gotCode = await H.until(`/^[A-Z0-9]{4}$/.test(document.querySelector('#hostCode').textContent)`, 25000);
  if (!ok(gotCode, 'host opens a room')) { finish(); return }
  const code = await H.ev(`document.querySelector('#hostCode').textContent`);
  await V.ev(`document.querySelector('[data-act="online"]').click()`); await sleep(200); await V.ev(`document.querySelector('[data-act="join"]').click()`); await sleep(200);
  await V.ev(`(()=>{const i=document.querySelector('#joinCode');i.value=${JSON.stringify(code)};document.querySelector('#joinForm').requestSubmit()})()`);
  ok(await H.until(`window.__G.net.connected&&document.querySelector('#menu').hidden`, 30000) && await V.until(`window.__G.net.connected&&document.querySelector('#menu').hidden`, 30000), 'visitor joins and both leave the menu');
  // drafts: whoever is shown a hand picks the first card
  const autopick = `(()=>{const c=document.querySelector('#pick:not([hidden]) .card:not(.away)');if(c&&!document.querySelector('#pick .card.chosen'))c.click()})()`;
  const deck = `(()=>{const G=window.__G;const want=['Echo Guard','Shield Charge','Long Haul','Mirror Guard','Bulwark','Cluster Guard','Fat Rounds','Fat Rounds','Ricochet'].map(n=>G.CARDS.find(c=>c.n===n));
    for(const p of G.players){if(!p.cards.includes(want[0])){p.cards=[...want,...p.cards];G.recompute(p)}}})()`;
  await H.ev(BOT(0)); await V.ev(BOT(1));
  const t0 = Date.now(); let agree = 0, samples = 0, shots = 0;
  while (Date.now() - t0 < SECS * 1000) {
    await H.ev(autopick); await V.ev(autopick); await H.ev(deck);
    const [hs, vs] = await Promise.all([H.ev(`(()=>{const G=window.__G;return{st:G.game.state,m:G.game.mapIdx,p:G.players.map(p=>[p.alive,Math.round(p.hp)]),sh:G.shields.length}})()`), V.ev(`(()=>{const G=window.__G;return{st:G.game.state,m:G.game.mapIdx,p:G.players.map(p=>[p.alive,Math.round(p.hp)]),sh:G.shields.length}})()`)]);
    if (hs && vs && hs.st === 'play' && vs.st === 'play' && hs.m === vs.m) { samples++; if (hs.p.every((a, k) => a[0] === vs.p[k][0] && Math.abs(a[1] - vs.p[k][1]) <= 60) && Math.abs(hs.sh - vs.sh) <= 1) agree++ }
    if (hs && hs.st === 'play' && !process.env.NO_SHOTS && shots < 4 && (Date.now() - t0) > (shots + 1) * SECS * 200) { shots++; await Promise.all([H.shot(`host-${shots}.png`), V.shot(`visitor-${shots}.png`)]) }
    await sleep(400) }
  const stats = async (T) => T.ev(`(()=>{const s=window.__st,f=s.frames.slice(30).sort((a,b)=>a-b),g=s.snapGaps.slice(5).sort((a,b)=>a-b),q=(a,k)=>a.length?+a[Math.min(a.length-1,Math.floor(a.length*k))].toFixed(1):null;
    return{fps:Math.round(f.length/(f.reduce((a,b)=>a+b,0)/1000)),frameP99:q(f,.99),framesOver50:f.filter(x=>x>50).length,snapGapP50:q(g,.5),snapGapP99:q(g,.99),snapGapsOver250:g.filter(x=>x>250).length,
      long:(s.long||[]).slice(0,10),rtt:Math.round(window.__G.net.rtt||0),relayed:!!window.__G.net.relayed,connected:window.__G.net.connected,state:window.__G.game.state}})()`);
  const hS = await stats(H), vS = await stats(V);
  console.log('host   ', JSON.stringify(hS)); console.log('visitor', JSON.stringify(vS));
  ok(hS.connected && vS.connected, 'still connected at the end');
  { const fh = await H.ev(`(()=>{const f=window.__G.net.fast;return f?f.readyState:'none'})()`), fv = await V.ev(`(()=>{const f=window.__G.net.fast;return f?f.readyState:'none'})()`);
    ok(fh === 'open' && fv === 'open', `the fast (lossy, unordered) channel carries snapshots and inputs on both sides (host ${fh}, visitor ${fv})`) }
  ok(hS.fps >= 55 && vS.fps >= 55, `both screens hold ~60 fps (host ${hS.fps}, visitor ${vS.fps})`);
  ok(hS.framesOver50 <= 3 && vS.framesOver50 <= 3, `no hitches (frames over 50 ms: host ${hS.framesOver50}, visitor ${vS.framesOver50})`);
  ok(vS.snapGapsOver250 <= 2, `snapshots arrive steadily on the visitor (median gap ${vS.snapGapP50} ms, ${vS.snapGapsOver250} gaps over 250 ms)`);
  ok(samples > 10 && agree / samples >= 0.9, `host and visitor agree on health, who's alive and shield walls (${agree} of ${samples} samples)`);
  ok(H.errors.length === 0, `no page errors on the host${H.errors.length ? ': ' + [...new Set(H.errors)].slice(0, 3).join(' | ') : ''}`);
  ok(V.errors.length === 0, `no page errors on the visitor${V.errors.length ? ': ' + [...new Set(V.errors)].slice(0, 3).join(' | ') : ''}`);
  finish();
  function finish() { for (const [r, w] of results) console.log(`${r}  ${w}`); console.log('screenshots in ' + OUT);
    const failed = results.filter(([r]) => r === 'FAIL').length; console.log(failed ? `\n${failed} of ${results.length} failed` : `\nall ${results.length} passed`);
    for (const T of [H, V]) { try { T.proc.kill() } catch {} } server.close(); setTimeout(() => process.exit(failed ? 1 : 0), 500) }
})();

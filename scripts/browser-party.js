// Real-browser 2v2 party (not part of CI; needs Google Chrome and internet for PeerJS signaling): serves the local build,
// opens a host and three friends in four headless Chrome windows, fills a party room, has a friend switch team, starts,
// and lets in-page bots on every screen play for a while (each goes for the nearest rival, hops, shoots; drafts pick a
// card of their own). Reports page errors, frame rates and snapshot gaps on all four screens, and whether every screen
// agrees with the host on who is alive and their health; saves screenshots.
//   node scripts/browser-party.js [seconds=60] [outDir]
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const SECS = +(process.argv[2] || 60), OUT = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'cuued-party-shots-'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/\}\)\(\);\s*<\/script>/, ';window.__G={game,net,keys,edges,mouse,CARDS,recompute,get players(){return players},get bullets(){return bullets}};})();</script>');
const server = http.createServer((q, r) => { if (q.url.startsWith('/api/turn')) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': 'text/html' }); r.end(html) }).listen(0);
const URL0 = `http://127.0.0.1:${server.address().port}/`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALL = []; process.on('exit', () => { for (const T of ALL) { try { T.proc.kill() } catch {} } });
const results = []; const ok = (c, w) => { results.push([c ? 'PASS' : 'FAIL', w]); return c };
async function browser(port, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuued-ol-'));
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {} });   // each browser's ~100 MB profile
  const proc = spawn(CHROME, ['--headless=new', '--mute-audio', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--window-size=1600,900', '--autoplay-policy=no-user-gesture-required',
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

// in-page bot: find this screen's own fighter, go for the nearest rival, hop, shoot; plus frame and snapshot recorders
const BOT = `(()=>{const G=window.__G;if(window.__bot)return;const st=window.__st={frames:[],snapGaps:[],last:performance.now(),lastSnap:null};
  const f=t=>{st.frames.push(t-st.last);st.last=t;const s=G.net.snap;if(s&&s!==st.lastSnap){if(st.snapAt)st.snapGaps.push(t-st.snapAt);st.snapAt=t;st.lastSnap=s}requestAnimationFrame(f)};requestAnimationFrame(f);
  let k=0;window.__bot=setInterval(()=>{k++;const P=G.players,me=G.net.role==='guest'?P[G.net.me]:P.find(p=>p.ctrl==='mouse');if(!me||!me.alive)return;
    const foes=P.filter(q=>q.team!==me.team&&q.alive);if(!foes.length)return;const o=foes.reduce((a,b)=>Math.hypot(a.x-me.x,a.y-me.y)<Math.hypot(b.x-me.x,b.y-me.y)?a:b),K=G.keys,E=G.edges;
    for(const c of['KeyA','KeyD','KeyW'])K.delete(c);const toward=o.x>me.x?'KeyD':'KeyA',away=toward==='KeyD'?'KeyA':'KeyD';K.add(Math.abs(o.x-me.x)>320?toward:(k>>3)%2?toward:away);
    if(k%9===0){E.add('KeyW');K.add('KeyW')}G.mouse.x=o.x+(Math.random()-.5)*50;G.mouse.y=o.y-30-Math.random()*60;G.mouse.down=k%6<4;if(k%17===0)G.mouse.rEdge=true},50)})()`;
const autopick = `(()=>{const mine=[...document.querySelectorAll('#pick:not([hidden]) .card:not(.theirs)')];if(mine.length&&!mine.some(c=>c.classList.contains('chosen')))mine[0].click()})()`;
(async () => {
  const H = await browser(9351, 'Hosty'), G = [await browser(9352, 'Ana'), await browser(9353, 'Ben'), await browser(9354, 'Cy')], all = [H, ...G]; ALL.push(...all);
  await H.ev(`document.querySelector('[data-act="multi"]').click()`); await sleep(150);
  await H.ev(`document.querySelector('[data-act="partyOnline"]').click()`); await sleep(200); await H.ev(`document.querySelector('[data-act="host"]').click()`);
  if (!ok(await H.until(`/^[A-Z0-9]{4}$/.test(document.querySelector('#hostCode').textContent)`, 25000), 'host opens a party room')) return finish();
  const code = await H.ev(`document.querySelector('#hostCode').textContent`);
  const join = async (V) => { await V.ev(`document.querySelector('[data-act="multi"]').click()`); await sleep(150); await V.ev(`document.querySelector('[data-act="partyOnline"]').click()`); await sleep(150);
    await V.ev(`document.querySelector('[data-act="join"]').click()`); await sleep(150);
    await V.ev(`(()=>{const i=document.querySelector('#joinCode');i.value=${JSON.stringify(code)};document.querySelector('#joinForm').requestSubmit()})()`);
    await V.until(`!document.querySelector('#joinRoster').hidden`, 30000) };
  await join(G[0]); await join(G[1]);
  // Ben (Orange, with the host) switches to Team Blue, which has room (Ana is there alone); Cy then lands on Orange
  await G[1].ev(`document.querySelector('#joinTeam [data-team="1"]').click()`);
  ok(await H.until(`window.__G.net.peers.find(p=>p.name==='Ben').team===1`, 8000), 'a friend switches team from their own screen');
  await join(G[2]);
  ok(await H.until(`document.querySelectorAll('#partyRoster li:not(.th):not(.open)').length===4`, 20000), 'three friends fill the lobby');
  ok(await H.until(`window.__G.net.peers.find(p=>p.name==='Cy').team===0`, 5000) && await G[2].until(`document.querySelector('#joinTeam [data-team="0"]').classList.contains('primary')`, 5000), 'the next friend lands on the team with room, and sees it lit');
  await H.shot('lobby.png');
  await H.ev(`document.querySelector('[data-act="partyStart"]').click()`);
  ok(await H.until(`document.querySelector('#menu').hidden&&window.__G.players.length===4`, 15000) && (await Promise.all(G.map((V) => V.until(`document.querySelector('#menu').hidden&&window.__G.players.length===4`, 15000)))).every(Boolean), 'Start takes all four screens into the match');
  for (const A of all) await A.ev(BOT);
  const t0 = Date.now(); let agree = 0, samples = 0, shots = 0;
  while (Date.now() - t0 < SECS * 1000) {
    await Promise.all(all.map((A) => A.ev(autopick)));
    const ss = await Promise.all(all.map((A) => A.ev(`(()=>{const G=window.__G;return{st:G.game.state,m:G.game.mapIdx,p:G.players.map(p=>[p.alive,Math.round(p.hp)])}})()`)));
    if (ss.every((s) => s && s.st === 'play' && s.m === ss[0].m)) for (const s of ss.slice(1)) { samples++; if (s.p.every((a, k) => a[0] === ss[0].p[k][0] && Math.abs(a[1] - ss[0].p[k][1]) <= 60)) agree++ }
    if (ss[0] && ss[0].st === 'play' && shots < 3 && (Date.now() - t0) > (shots + 1) * SECS * 250) { shots++; await Promise.all(all.map((A, i) => A.shot(`screen${i}-${shots}.png`))) }
    await sleep(400) }
  const stats = (T) => T.ev(`(()=>{const s=window.__st,f=s.frames.slice(30).sort((a,b)=>a-b),g=s.snapGaps.slice(5).sort((a,b)=>a-b),q=(a,k)=>a.length?+a[Math.min(a.length-1,Math.floor(a.length*k))].toFixed(1):null;
    return{fps:Math.round(f.length/(f.reduce((a,b)=>a+b,0)/1000)),frameP99:q(f,.99),framesOver50:f.filter(x=>x>50).length,snapGapP50:q(g,.5),snapGapP99:q(g,.99),snapGapsOver250:g.filter(x=>x>250).length,
      rtt:Math.round(window.__G.net.rtt||0),relayed:!!window.__G.net.relayed,connected:window.__G.net.connected,state:window.__G.game.state,wins:window.__G.game.wins}})()`);
  const S = []; for (const A of all) S.push(await stats(A));
  S.forEach((s, i) => console.log(i ? 'friend' + i : 'host   ', JSON.stringify(s)));
  ok(S.every((s) => s.connected), 'all four still connected at the end');
  ok(S.every((s) => s.fps >= 50 && s.framesOver50 <= 3), 'every screen holds about 60 fps');
  ok(S.slice(1).every((s) => s.snapGapP99 != null && s.snapGapP99 <= 70 && s.snapGapsOver250 === 0), 'every friend gets steady snapshots');
  ok(samples > 20 && agree / samples > .95, `every screen agrees with the host on who is alive and their health (${agree}/${samples})`);
  ok(all.every((A) => !A.errors.length), 'no page errors' + all.map((A) => A.errors.slice(0, 2).join(' | ')).filter(Boolean).join(' ; '));
  finish();
})();
function finish() { for (const [r, w] of results) console.log(r.padEnd(5), w); const bad = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\nscreenshots in ${OUT}\n`); console.log(bad ? `${bad} of ${results.length} failed` : `all ${results.length} passed`); for (const T of ALL) { try { T.proc.kill() } catch {} } server.close(); setTimeout(() => process.exit(bad ? 1 : 0), 500) }

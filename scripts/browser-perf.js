// Real-browser check (not part of CI; needs Google Chrome): opens the built game in headless Chrome over the DevTools
// protocol, plays three scenarios, and reports frame times plus any page errors.
//   menu      the title screen with its background CPU match
//   match     Practice vs CPU with no cards
//   worst     both fighters holding a bullet-spam deck (hundreds of bullets on screen)
// Each runs at 1x and 2x pixel density (2x is a Retina / high-DPI screen, four times the pixels).
//   node scripts/browser-perf.js [secondsPerScenario=6]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SECS = +(process.argv[2] || 6);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = path.join(__dirname, '..');

// a copy of the page that exposes a few internals, so a scenario can hand out cards
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuued-perf-'));
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/\}\)\(\);\s*<\/script>/, ';window.__G={game,CARDS,recompute,startMatch,loadMap,buildBg,MAPS,get players(){return players},get bullets(){return bullets}};})();</script>');
html = html.replace('<head>', '<head><script>try{localStorage.setItem("cuued.name","Perf")}catch(e){}</script>');
fs.writeFileSync(path.join(dir, 'index.html'), html);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${dir}/profile`, '--window-size=1920,1080',
    '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 50; i++) { try { tabs = await (await fetch('http://127.0.0.1:9333/json')).json(); break } catch { await sleep(100) } }
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(), errors = [];
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errors.push(d.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) });
  const ev = async (expr) => { const r = (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result; if (r?.exceptionDetails) errors.push('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r?.result?.value };
  await cdp('Runtime.enable'); await cdp('Page.enable');

  const measure = `new Promise(res=>{const d=[];let last=performance.now();const end=last+${SECS * 1000};
    let mb=0,ls=[],ps=window.__G.game.state;const f=t=>{mb=Math.max(mb,window.__G.bullets.length);if(t-last>40)ls.push(Math.round(t-last)+'ms@'+ps+'>'+window.__G.game.state);ps=window.__G.game.state;d.push(t-last);last=t;if(t<end){requestAnimationFrame(f);return}d.shift();d.sort((a,b)=>a-b);
      const q=k=>+d[Math.min(d.length-1,Math.floor(d.length*k))].toFixed(1);
      res({frames:d.length,fps:+(d.length/${SECS}).toFixed(0),p50:q(.5),p95:q(.95),p99:q(.99),worst:+d[d.length-1].toFixed(1),over33:d.filter(x=>x>33.4).length,maxBullets:mb,state:window.__G.game.state+'/'+window.__G.game.mode,long:ls.slice(0,4).join(' ')})};
    requestAnimationFrame(f)})`;
  const deck = `(()=>{const C=window.__G.CARDS,pick=n=>C.find(c=>c.n===n),d=[];for(const[n,k]of[['Scattergun',4],['Triple Tap',3],['Splinter Rounds',4],['Ricochet',3],['Hair Trigger',3],['Deep Magazine',3],['Counterfire',3],['Cluster Guard',3]])for(let i=0;i<k;i++)d.push(pick(n));
    for(const p of window.__G.players){p.cards=d.slice();window.__G.recompute(p)}})()`;
  const rows = [];
  for (const dpr of [1, 2]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: dpr, mobile: false });
    await cdp('Page.navigate', { url: 'file://' + path.join(dir, 'index.html') }); await sleep(1500);
    rows.push({ scenario: 'menu', dpr, ...(await ev(measure)) });
    await ev(`(()=>{const G=window.__G;for(const el of document.querySelectorAll('.overlay'))el.hidden=true;G.startMatch('demo')})()`);   // a CPU-vs-CPU match (it drafts by itself) with the menu hidden
    await sleep(1500); rows.push({ scenario: 'match', dpr, ...(await ev(measure)) });
    await ev(deck); await sleep(800); await ev(`setInterval(()=>{${deck}},1500)`);
    rows.push({ scenario: 'worst', dpr, ...(await ev(measure)) });
  }
  console.table(rows);
  console.log(errors.length ? `page errors (${errors.length}):\n  ` + [...new Set(errors)].slice(0, 8).join('\n  ') : 'no page errors');
  ws.close(); chrome.kill(); await sleep(500); try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }) } catch {}
  process.exit(errors.length ? 1 : 0);
})();

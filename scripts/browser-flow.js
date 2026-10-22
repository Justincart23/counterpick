// Real-browser walkthrough (not part of CI; needs Google Chrome and, for the online part, internet).
// Drives headless Chrome the way a player would and checks each screen:
//   local build: name screen -> menu -> Practice vs CPU -> opening draft -> pause/resume -> lose a round -> draft a card by clicking it
//                -> settings -> how to play -> full-screen button, with no page errors
//   live site:   two tabs host and join a real online match through PeerJS (and the TURN relay if needed)
//   node scripts/browser-flow.js [--offline]  (skip the live online part)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LIVE = process.env.LIVE_URL || 'https://www.cuued.com/';
const root = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuued-flow-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {} });   // the Chrome profile is ~100 MB: never leave it behind
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/\}\)\(\);\s*<\/script>/, ';window.__G={game,die,sandbox,get players(){return players}};})();</script>');
fs.writeFileSync(path.join(dir, 'index.html'), html);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const ok = (cond, what) => { results.push([cond ? 'PASS' : 'FAIL', what]); return cond };

async function tab(port, url) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(), errors = [];
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  });
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) });
  await cdp('Runtime.enable');
  const ev = async (expr) => { const r = (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result; if (r?.exceptionDetails) errors.push('eval: ' + r.exceptionDetails.text); return r?.result?.value };
  const key = async (code, k = code) => { const vk = k === 'Escape' ? 27 : k === 'Enter' ? 13 : 0; await cdp('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k, windowsVirtualKeyCode: vk, ...(k === 'Enter' ? { text: '\r' } : {}) }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k, windowsVirtualKeyCode: vk }) };
  const until = async (expr, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await ev(expr)) return true; await sleep(100) } return false };
  return { ws, cdp, ev, key, until, errors };
}

(async () => {
  const chrome = spawn(CHROME, ['--headless=new', '--mute-audio', '--remote-debugging-port=9335', `--user-data-dir=${dir}/profile`, '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
  process.on('exit', () => { try { chrome.kill('SIGKILL') } catch (e) {} });   // never leave a headless Chrome holding the port (the next run would attach to it)
  for (let i = 0; i < 50; i++) { try { await fetch('http://127.0.0.1:9335/json/version'); break } catch { await sleep(100) } }
  const shown = (sel) => `(()=>{const e=document.querySelector('${sel}');return !!e&&!e.hidden&&getComputedStyle(e).display!=='none'})()`;

  // ---- local build, fresh visitor ----
  const A = await tab(9335, 'file://' + path.join(dir, 'index.html'));
  await sleep(1200);
  ok(await A.until(shown('#nameScreen'), 6000), 'a first visit asks for a name');   // boot waits up to 1.5 s for fonts
  await A.ev(`document.querySelector('#nameInput').focus()`); await A.cdp('Input.insertText', { text: 'Tester' }); await A.key('Enter');
  ok(await A.until(`document.querySelector('#nameScreen').hidden`) && await A.until(`document.querySelector('[data-myname]').textContent==='Tester'`), 'the name is saved and shown on the menu');
  ok(await A.ev(`[...document.querySelectorAll('[data-sub="main"] .mlist button')].map(b=>b.textContent).join('|')`) === 'Single player|Multiplayer|Shop|How to play|Settings', 'the menu lists Single player, Multiplayer, Shop, How to play, Settings');
  await A.ev(`document.querySelector('[data-act="cpu"]').click()`);
  ok(await A.until(`window.__G.game.mode==='cpu'&&window.__G.game.state==='pick'`) && await A.until(shown('#pick'), 3000), 'Practice vs CPU starts with the opening draft');
  await sleep(900); await A.ev(`document.querySelector('#pick .card').click()`);
  ok(await A.until(`window.__G.players[0].cards.length===1`, 4000), 'clicking an opening card adds it to your deck');
  ok(await A.until(`window.__G.game.state==='play'`), 'the countdown finishes and play begins');
  await A.key('Escape', 'Escape'); ok(await A.until(shown('#pause'), 2000), 'Esc pauses');
  await A.key('Escape', 'Escape'); ok(await A.until(`document.querySelector('#pause').hidden`, 2000), 'Esc again resumes');
  // lose points until the human drafts
  ok(await A.until(`(()=>{const G=window.__G;if(G.game.state==='pick')return true;if(G.game.state==='play'&&G.players[0].alive)G.die(G.players[0]);return false})()`, 30000), 'losing a round opens the card draft');
  ok(await A.until(shown('#pick'), 4000) && await A.ev(`document.querySelectorAll('#pick .card').length`) === 5, 'the draft shows five cards');
  await sleep(900);   // cards fan in before they can be picked
  await A.ev(`document.querySelector('#pick .card').click()`);
  ok(await A.until(`window.__G.players[0].cards.length===2`, 4000), 'clicking a card adds it to your deck');
  ok(await A.until(`['ready','play'].includes(window.__G.game.state)`, 6000), 'play resumes after the draft');
  await A.key('Escape', 'Escape'); await A.until(shown('#pause'), 2000);
  await A.ev(`document.querySelector('#pause [data-act="menu"]').click()`);
  ok(await A.until(shown('#menu'), 3000), 'Quit to menu returns to the title screen');
  // sandbox: the card panel opens, cards go to you or the CPU, and play starts with them and no draft
  await A.ev(`document.querySelector('[data-act="sandbox"]').click()`);
  ok(await A.until(shown('#sandbox'), 3000) && await A.ev(`document.querySelectorAll('#sbGrid .sb-card').length`) >= 40, 'Sandbox opens a panel with every card');
  await A.ev(`(()=>{const g=[...document.querySelectorAll('#sbGrid .sb-card')],f=n=>g.find(b=>b.querySelector('.nm').textContent===n);f('Ricochet').click();f('Ricochet').click();f('Blast Cap').click()})()`);
  await A.ev(`document.querySelector('[data-sbtab="1"]').click()`);
  await A.ev(`[...document.querySelectorAll('#sbGrid .sb-card')].find(b=>b.querySelector('.nm').textContent==='Thick Skin').click()`);
  ok(await A.ev(`document.querySelector('#sbDeck').textContent.includes('Thick Skin')`), "the CPU's tab shows the CPU's cards");
  await A.ev(`document.querySelector('#sbGo').click()`);
  ok(await A.until(`document.querySelector('#sandbox').hidden&&window.__G.players[0].s.bounces===4&&window.__G.players[1].cards.length===1`, 3000), 'Play applies both loadouts');
  ok(await A.until(`window.__G.game.state==='play'`, 4000), 'sandbox play starts without a draft');
  await A.key('Tab', 'Tab'); ok(await A.until(shown('#sandbox'), 2000) && await A.ev('window.__G.game.paused'), 'Tab reopens the card panel and pauses');
  await A.key('Escape', 'Escape'); ok(await A.until(`document.querySelector('#sandbox').hidden&&!window.__G.game.paused`, 2000), 'Esc closes it and play resumes');
  await A.key('Escape', 'Escape'); await A.until(shown('#pause'), 2000);
  await A.ev(`document.querySelector('#pause [data-act="menu"]').click()`); await A.until(shown('#menu'), 3000);
  await A.ev(`document.querySelector('.mlist [data-act="shop"]').click()`);
  ok(await A.until(shown('#shop'), 2000) && await A.ev(`document.querySelectorAll('#shopGrid .shop-item').length`) >= 5, 'the Shop opens with items');
  await A.key('Escape', 'Escape'); ok(await A.until(`document.querySelector('#shop').hidden`, 2000), 'Esc closes the Shop');
  await A.ev(`document.querySelector('[data-act="settings"]').click()`);
  ok(await A.until(shown('[data-sub="settings"]'), 2000), 'Settings opens');
  await A.key('Escape', 'Escape');
  await A.ev(`document.querySelector('[data-act="help"]').click()`);
  ok(await A.until(shown('[data-sub="help"]'), 2000), 'How to play opens');
  await A.key('Escape', 'Escape');
  ok(await A.ev(`!!document.querySelector('#bFull')&&!document.querySelector('#bFull').hidden`), 'the Full screen button is there');
  ok(A.errors.length === 0, `no page errors on the local build${A.errors.length ? ': ' + A.errors.slice(0, 3).join(' | ') : ''}`);

  // ---- live site: a real online match between two tabs ----
  if (!process.argv.includes('--offline')) {
    const H = await tab(9335, LIVE), G = await tab(9335, LIVE);
    await sleep(2500);
    for (const T of [H, G]) { if (await T.ev(shown('#nameScreen'))) { await T.ev(`document.querySelector('#nameInput').focus()`); await T.cdp('Input.insertText', { text: T === H ? 'Host' : 'Guest' }); await T.key('Enter') } }
    await H.ev(`document.querySelector('[data-act="online"]').click()`); await sleep(200);
    await H.ev(`document.querySelector('[data-act="host"]').click()`);
    const gotCode = await H.until(`/^[A-Z0-9]{4}$/.test(document.querySelector('#hostCode').textContent)`, 20000);
    ok(gotCode, 'the live site opens an online room with a 4-letter code');
    if (gotCode) {
      const code = await H.ev(`document.querySelector('#hostCode').textContent`);
      await G.ev(`document.querySelector('[data-act="online"]').click()`); await sleep(200);
      await G.ev(`document.querySelector('[data-act="join"]').click()`); await sleep(200);
      await G.ev(`document.querySelector('#joinCode').focus()`); await G.cdp('Input.insertText', { text: code }); await G.key('Enter');
      const started = await H.until(`document.querySelector('#menu').hidden`, 30000) && await G.until(`document.querySelector('#menu').hidden`, 30000);
      ok(started, `a second tab joins with the code and both start the match${started ? '' : ' (guest says: ' + await G.ev(`document.querySelector('#joinMsg').textContent`) + ')'}`);
      if (started) { await sleep(4000); ok(!(await H.ev(shown('#menu'))) && !(await G.ev(shown('#menu'))), 'the online match keeps running for a few seconds') }
    }
    ok(H.errors.length + G.errors.length === 0, `no page errors online${H.errors.length + G.errors.length ? ': ' + [...H.errors, ...G.errors].slice(0, 3).join(' | ') : ''}`);
  }

  for (const [r, w] of results) console.log(`${r}  ${w}`);
  const failed = results.filter(([r]) => r === 'FAIL').length;
  console.log(failed ? `\n${failed} of ${results.length} failed` : `\nall ${results.length} passed`);
  chrome.kill(); await sleep(500); try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }) } catch {}
  process.exit(failed ? 1 : 0);
})();

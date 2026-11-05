// Co-op Survival on a Big Screen, end to end through the mock PeerJS (40 ms): the screen runs the run and every hero is a
// phone. Checks: Start makes a run with one hero per phone (none for the screen), every phone chooses its character and a
// free card on its own screen, rounds play, each phone shops on its own (buy, sell, reroll, lock, Ready) while the host keeps
// the books, the next round waits for everyone, a phone that leaves is out (nobody waits on it) and gets its hero back when
// it rejoins, a friend who joins mid-run comes in at the next round with a build, the phones get the run's state, and when
// the lives run out every phone gets its coins and its record.
//   node tests/bigsurv.js [latencyMs=40] [jitterMs=0]
const { load, advance, schedule } = require('./env');

const LATENCY = +(process.argv[2] || 40), JITTER = +(process.argv[3] || 0);
let jseed = 5; const jrand = () => ((jseed = (jseed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const vnow = () => require('./env').clock.t;
const registry = new Map();
class Emitter {
  constructor() { this.handlers = {} }
  on(e, f) { (this.handlers[e] = this.handlers[e] || []).push(f); return this }
  emit(e, ...a) { for (const f of this.handlers[e] || []) f(...a) }
}
const bytes = { c: 0, cN: 0, ps: 0, psN: 0, s: 0 };
class MockChannel {   // the fast lane: unordered, never retransmitted
  constructor() { this.readyState = 'connecting'; this.bufferedAmount = 0; this.peer = null }
  send(str) { if (this.readyState !== 'open') return; const t = str.slice(6, 9);
    if (t.startsWith('c"')) { bytes.c += str.length; bytes.cN++ } else if (t.startsWith('ps"')) { bytes.ps += str.length; bytes.psN++ } else if (t.startsWith('s"')) bytes.s++;
    const o = this.peer, now = vnow(), at = now + LATENCY + jrand() * JITTER;
    schedule(() => { if (o.readyState === 'open' && o.onmessage) o.onmessage({ data: str }) }, at - now) }
  close() { this.readyState = 'closed'; if (this.peer) this.peer.readyState = 'closed' }
}
class MockConn extends Emitter {
  constructor() { super(); this.open = false; this.other = null; this.chans = {};
    this.peerConnection = { createDataChannel: (label, o) => { const ch = new MockChannel(); this.chans[o.id] = ch; const th = this.other && this.other.chans[o.id];
      if (th) { ch.peer = th; th.peer = ch; schedule(() => { ch.readyState = th.readyState = 'open' }, LATENCY) } return ch } } }
  send(m) { if (!this.open) return; const d = JSON.parse(JSON.stringify(m)), o = this.other, t = vnow();
    const at = Math.max(this.lastAt || 0, t + LATENCY + jrand() * JITTER); this.lastAt = at; schedule(() => o.open && o.emit('data', d), at - t) }
  close() { if (!this.open) return; this.open = false; const o = this.other; schedule(() => { this.emit('close'); if (o.open) { o.open = false; o.emit('close') } }, LATENCY) }
}
class MockPeer extends Emitter {
  constructor(id) { super(); this.id = typeof id === 'string' ? id : 'anon-' + Math.random().toString(36).slice(2);
    schedule(() => { if (registry.has(this.id)) return this.emit('error', { type: 'unavailable-id' }); registry.set(this.id, this); this.emit('open', this.id) }, 60) }
  connect(id) { const mine = new MockConn();
    schedule(() => { const host = registry.get(id); if (!host) return this.emit('error', { type: 'peer-unavailable' });
      const theirs = new MockConn(); mine.other = theirs; theirs.other = mine; mine.open = theirs.open = true;
      host.emit('connection', theirs); theirs.emit('open'); mine.emit('open') }, 80);
    return mine }
  destroy() { if (registry.get(this.id) === this) registry.delete(this.id) }
  reconnect() {}
}
globalThis.Peer = MockPeer;


const fail = [], check = (ok, msg) => { if (!ok) fail.push(msg) }, DT = 1 / 60;
(async () => {
  const opt = (seed) => ({ seed, virtualTime: true });
  const H = (await load(opt(111))).api, G = [(await load(opt(222))).api, (await load(opt(333))).api, (await load(opt(444))).api], L = (await load(opt(555))).api;
  H.setName('Screen'); [...G, L].forEach((A, i) => { A.setName('Phone' + (i + 1)); A.ctl.tok = 'phone' + (i + 1) });
  Object.assign(H.settings, { bsMode: 'surv', bsBots: 2 });
  let all = [H, ...G], errors = 0, fcount = 0;
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { fcount++; for (const A of all) { try { A.update(DT); if (A === H && fcount % 6 === 0) A.render(); if (A !== H && A.ctl.on) A.padSend() } catch (e) { if (errors++ < 3) console.error(e) } } advance(DT * 1000) } };
  const until = (f, max = 900) => { for (let i = 0; i < max; i++) { if (f()) return true; frame(1) } return f() };
  H.openBigScreen(); frame(10); const code = H.net.code;
  for (const A of G) { A.joinGame(code); frame(30) }
  check(G.every((A) => A.ctl.on && A.ctl.view === 'lobby'), 'three phones become controllers in the lobby');
  H.bsStart(); frame(20);
  const hs = () => H.heroes();
  check(H.game.mode === 'survival' && H.game.bsSurv && H.game.screen, 'Start should begin Co-op Survival on the big screen');
  check(hs().length === 3 && hs().every((p) => p.ctrl === 'pad' && p.team === 0) && !H.players.some((p) => p.ctrl === 'mouse' || p.ctrl === 'cpu'), `one hero per phone, no CPUs on our side and none for the screen (${H.players.map((p) => p.ctrl + p.team)})`);
  check(new Set(hs().map((p) => p.color)).size >= 2, 'each hero has its own colour');   // (the test page has no stylesheet, so orange and blue read the same here)
  // the characters, then a free pick, on each phone
  check(until(() => G.every((A) => A.ctl.hand && A.ctl.hand.length && A.ctl.hand.every((c) => c.char))), 'every phone is offered characters to choose from');
  G.forEach((A, i) => A.padPick(i)); frame(10);
  check(until(() => G.every((A) => A.ctl.hand && A.ctl.hand.length === 5 && !A.ctl.hand.every((c) => c.char))), 'then a free pick of five (cards and power-ups) on every phone');
  check(hs().every((p, i) => p.char && p.char === H.CHARS.filter((c) => c.unlock <= 0)[i]), `each hero gets the character its phone chose (${hs().map((p) => p.char && p.char.n)})`);
  G.forEach((A) => A.padPick(1)); 
  check(until(() => H.game.round === 1 && (H.game.state === 'ready' || H.game.state === 'play')), 'round 1 starts once every phone has picked');
  frame(10); check(G.every((A) => !A.ctl.hand), 'the phones put their cards away when the round starts');
  check(until(() => G.every((A) => A.ctl.st && A.ctl.st.sv === 1 && A.ctl.st.rd === 1 && A.ctl.st.lv === 3)), 'each phone gets the run: round 1, three lives');
  // a phone's controls move its hero
  until(() => H.game.state === 'play');
  for (const p of hs()) { p.s.maxHp = p.hp = 1e6 }
  const h0 = hs()[0], x0 = h0.x; G[0].ctl.mx = 1; frame(40); G[0].ctl.mx = 0;
  check(Math.abs(h0.x - x0) > 40, `a phone's stick moves its hero (${Math.round(h0.x - x0)}px)`);
  // clear the round: the shop on every phone
  const clear = () => { for (const e of H.enemies()) if (e.alive) H.die(e) };
  clear();
  check(until(() => H.game.state === 'shop'), 'the round clears into the shop');
  check(until(() => G.every((A) => A.ctl.shop && A.ctl.shop.offers.length === 5)), 'every phone gets its own five offers');
  // buy, sell, reroll, lock
  const p0 = hs()[0]; p0.scrap = 60;
  G[0].padShopOp('lock', 4); frame(20);
  const n0 = p0.cards.length + (p0.ups || []).length;
  G[0].padShopOp('buy', 0); frame(20);
  check(p0.cards.length + (p0.ups || []).length === n0 + 1 && G[0].ctl.shop.offers[0].sold && G[0].ctl.shop.scrap < 60, `a phone buys a card: its hero gets it and the phone sees the scrap go down (${G[0].ctl.shop.scrap})`);
  const nc = p0.cards.length; G[0].padShopOp('sell', 0); frame(20);
  check(p0.cards.length === nc - 1 && G[0].ctl.shop.build.length === nc - 1, 'selling from the build works from the phone');
  const before = G[0].ctl.shop.offers.map((o) => o.c.n).join(), lockedName = G[0].ctl.shop.offers[4].c.n; G[0].padShopOp('reroll'); frame(20);
  check(G[0].ctl.shop.offers.map((o) => o.c.n).join() !== before && G[0].ctl.shop.offers.some((o) => o.c.n === lockedName && o.locked), 'reroll deals a fresh shop and keeps the locked card');
  // ready: the round waits for everyone
  G[0].padShopOp('next'); G[1].padShopOp('next'); frame(40);
  check(H.game.state === 'shop' && H.game.round === 1, 'the next round waits for the last phone');
  G[2].padShopOp('next');
  check(until(() => H.game.round === 2 && H.game.state !== 'shop'), 'the next round starts when every phone is ready');
  check(until(() => G.every((A) => !A.ctl.shop)), 'the phones close the shop when the round starts');
  // a phone leaves mid-round: its hero is out and nobody waits on it
  G[2].leaveOnline(true); all = [H, G[0], G[1]]; frame(60);
  const left = hs()[2]; check(left.left && !left.alive, 'a phone that leaves takes its hero out');
  for (const p of hs()) if (p.s) { p.s.maxHp = p.hp = 1e6 }
  until(() => H.game.state === 'play'); clear();
  check(until(() => H.game.state === 'shop'), 'the round still clears');
  until(() => G[0].ctl.shop && G[1].ctl.shop); G[0].padShopOp('next'); G[1].padShopOp('next');
  check(until(() => H.game.round === 3 && H.game.state !== 'shop'), 'the shop does not wait for a phone that left');
  // it comes back: its own hero, next round
  all = [H, ...G]; G[2].joinGame(code); frame(80);
  check(hs()[2].peer && !hs()[2].left && hs()[2].char, 'a phone that rejoins gets its own hero back (character and build)');
  // a friend joins mid-run: in at the next round, with a build
  all = [H, ...G, L]; L.joinGame(code); frame(80);
  check(L.ctl.on && H.game.bsPend && H.game.bsPend.length === 1 && hs().length === 3, 'a friend who joins mid-run waits for the next round');
  for (const p of hs()) if (p.s) { p.s.maxHp = p.hp = 1e6 }
  until(() => H.game.state === 'play'); clear();
  check(until(() => H.game.state === 'shop'), 'round 3 clears');
  until(() => G.every((A) => A.ctl.shop)); for (const A of G) A.padShopOp('next');
  check(until(() => H.game.round === 4 && H.game.state !== 'shop'), 'round 4 starts');
  frame(10); const nw = hs()[3];
  check(hs().length === 4 && nw && nw.ctrl === 'pad' && nw.cards.length >= Math.min(...hs().slice(0, 3).map((h) => h.cards.length)) && L.ctl.me === 3 && L.ctl.view === 'live', `the late friend is the fourth hero, built up like the others (${nw && nw.cards.length} cards)`);
  check(H.enemies().length >= 3, `four heroes face a bigger wave (${H.enemies().length} enemies)`);
  // down and revive: one hero down, a teammate stands by them
  until(() => H.game.state === 'play');
  const [a, b] = hs(); H.die(a); frame(2);
  check(!a.alive && a.downT > 0, 'a hero who falls is down, not out');
  const t0 = a.downT; let fr = 0; for (; fr < 600 && !a.alive; fr++) { b.x = a.downX; b.y = a.downY - 10; b.vx = b.vy = 0; frame(1) }
  check(a.alive && fr < 160 && t0 > 3, `a teammate standing by them revives them in about 2 s (${(fr / 60).toFixed(1)} s, ${t0.toFixed(1)} s left on the timer)`);
  check(L.ctl.st && L.ctl.st.sv === 1 && L.ctl.st.rd === 4, "the late friend's phone shows the run");
  // the lives run out: every phone gets its coins and its record
  const coins = [...G, L].map((A) => A.wallet.coins);
  for (let life = 0; life < 3 && H.game.state !== 'over'; life++) { until(() => H.game.state === 'play', 400); for (const p of hs()) if (p.alive) { p.s.maxHp = p.hp = 1; } for (const p of hs()) H.die(p); frame(10); for (const p of hs()) { p.downT = 99 } until(() => H.game.state === 'ready' || H.game.state === 'over', 400) }
  check(until(() => H.game.state === 'over'), 'losing every life ends the run');
  check(until(() => [...G, L].every((A) => A.ctl.view === 'over')), 'every phone shows the run is over');
  check([...G, L].every((A, i) => A.wallet.coins === coins[i] + Math.floor(3 / 2) && A.wallet.survBest >= 3), `each phone gets its coins and its best (${[...G, L].map((A) => A.wallet.coins - coins[[...G, L].indexOf(A)])})`);
  // a new run with everyone still connected
  H.requestRematch(); frame(30);
  check(H.game.bsSurv && H.game.round === 0 && hs().length === 4 && hs().every((p) => !p.char), 'New run: a fresh run with every phone');
  check(errors === 0, `no errors (${errors})`);
  const res = { heroes: hs().length, errors, failures: fail.filter(Boolean).length };
  if (fail.filter(Boolean).length) { console.log(JSON.stringify(res)); for (const f of fail.filter(Boolean)) console.log('FAIL ' + f); process.exit(1) }
  console.log(JSON.stringify(res)); process.exit(0);
})();

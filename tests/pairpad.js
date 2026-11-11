// A phone paired to a computer (not a Big Screen): it drives that computer's own fighter, offline against the CPU and online
// in a duel against a friend on their own computer. The phone gets the live controls, card picks and the match end.
//   node tests/pairpad.js
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
  const H = (await load(opt(121))).api, G = (await load(opt(222))).api, P = (await load(opt(323))).api;
  H.setName('Boulder'); G.setName('Justin'); P.setName('JPhone'); P.ctl.tok = 'jphone';
  const all = [H, G, P]; let errors = 0, fcount = 0;
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { fcount++; for (const A of all) { try { A.update(DT); if (A !== P && fcount % 6 === 0) A.render(); if (A === P) A.padSend(); if (A !== P) A.cpadTick(DT) } catch (e) { if (errors++ < 3) console.error(e) } } advance(DT * 1000) } };
  G.cpadStart(); frame(20);
  check(/^[A-Z0-9]{4}$/.test(G.cpad.code) && G.cpad.open, `the computer opens a pairing code (${G.cpad.code})`);
  P.joinGame(G.cpad.code); frame(40);
  check(P.ctl.on && P.ctl.cp, 'the phone becomes a paired controller');
  check(G.cpad.link && G.cpad.link.name === 'JPhone', 'the computer knows the phone');
  // offline: practice vs CPU on the computer, driven by the phone
  G.startMatch('cpu'); frame(20);
  const me = () => G.players.find((p) => p.ctrl === 'mouse');
  for (let i = 0; i < 400 && G.game.state === 'pick'; i++) { if (P.ctl.hand && P.ctl.picked < 0) P.netSend({ t: 'ppick', i: 0 }); frame(5) }
  check(G.game.state !== 'pick', `the opening card is picked from the phone (${G.game.state})`);
  for (let i = 0; i < 300 && G.game.state !== 'play'; i++) frame(1);
  check(P.ctl.view === 'live', `the phone shows the live controls (${P.ctl.view})`);
  const x0 = me().x; P.ctl.mx = 1; frame(40); P.ctl.mx = 0;
  check(me().x > x0 + 40, `the phone moves the fighter on the computer (${Math.round(x0)} → ${Math.round(me().x)})`);
  // online: a duel against a friend on their own computer; the phone still drives Justin's fighter
  G.startMatch('demo'); frame(10);
  H.hostGame(); frame(20);
  G.joinGame(H.net.code); frame(60);
  check(H.game.mode === 'online-host' && G.game.mode === 'online-guest', `the online duel starts (${H.game.mode} / ${G.game.mode})`);
  for (let i = 0; i < 600 && !(H.game.state === 'play' && G.game.state === 'play'); i++) { if (P.ctl.hand && P.ctl.picked < 0) P.netSend({ t: 'ppick', i: 0 }); if (H.game.state === 'pick' && H.pickFor && H.pickFor.ctrl === 'mouse') H.pickNow && H.pickNow(0); frame(2) }
  check(H.game.state === 'play', `both pick and play (${H.game.state} / ${G.game.state})`);
  frame(30);
  const gh = () => H.players.find((p) => p.ctrl === 'net'), hx0 = gh().x;
  P.ctl.mx = gh().x < 960 ? 1 : -1; const dir = P.ctl.mx; frame(30); frame(30); P.ctl.mx = 0;
  check((gh().x - hx0) * dir > 40, `on the host, the guest's fighter moves from the guest's phone (${Math.round(hx0)} → ${Math.round(gh().x)})`);
  check(errors === 0, `no errors (${errors})`);
  console.log(JSON.stringify({ failures: fail.length, fail }));
  process.exit(fail.length ? 1 : 0);
})();

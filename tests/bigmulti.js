// Big Screen with friends: the first phone to join runs the room from the sofa. It changes the game (mode, CPUs...) and
// presses Start; a second phone can't. After the match it can start the rematch or go back to the lobby.
//   node tests/bigmulti.js
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
  const H = (await load(opt(111))).api, G = [(await load(opt(212))).api, (await load(opt(313))).api];
  H.setName('Screen'); G.forEach((A, i) => { A.setName('Phone' + (i + 1)); A.ctl.tok = 'phone' + (i + 1) });
  Object.assign(H.settings, { bsMode: 'ffa', bsLen: 3, bsCards: 'losers', bsBots: 0, bsCpu: 'normal', bsMap: 'all', bsHp: 1, bsTwist: false });
  const all = [H, ...G]; let errors = 0, fcount = 0;
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { fcount++; for (const A of all) { try { A.update(DT); if (A === H && fcount % 6 === 0) A.render(); if (A !== H) A.padSend() } catch (e) { if (errors++ < 3) console.error(e) } } advance(DT * 1000) } };
  H.openBigScreen(); frame(10);
  check(!H.net.solo && H.net.lobbyOpen, 'Big Screen should open a lobby');
  G[0].joinGame(H.net.code); frame(40);
  check(G[0].ctl.lead === true, 'the first phone in should be the lead');
  G[0].netSend({ t: 'pgo' }); frame(30);
  check(H.net.lobbyOpen, 'alone with no CPUs, Start does nothing');
  G[0].netSend({ t: 'popt', k: 'bsBots', d: 1 }); frame(30);
  check(H.settings.bsBots === 1, `the lead phone adds a CPU (${H.settings.bsBots})`);
  G[0].netSend({ t: 'popt', k: 'bsHp', d: 1 }); frame(20);
  check(H.settings.bsHp === 1, 'the phone can only change the listed settings');
  G[1].joinGame(H.net.code); frame(40);
  check(G[1].ctl.on && G[1].ctl.lead === false, 'the second phone is not the lead');
  G[1].netSend({ t: 'popt', k: 'bsBots', d: 1 }); G[1].netSend({ t: 'pgo' }); frame(30);
  check(H.net.lobbyOpen && H.settings.bsBots === 1, 'the second phone cannot change the game or start it');
  G[0].netSend({ t: 'pgo' }); frame(30);
  check(!H.net.lobbyOpen && H.game.mode === 'online-host', `the lead's Start begins the match (mode ${H.game.mode})`);
  check(H.players.length === 3, `two phones and a CPU (${H.players.length})`);
  check(G[0].ctl.view === 'live' && G[1].ctl.view === 'live', 'both phones switch to the controls');
  check(G[0].ctl.lead === true, 'the lead stays the lead in the match');
  H.game.state = 'over'; G[0].netSend({ t: 'plob' }); frame(30);
  check(H.net.lobbyOpen, 'after a match the lead phone takes everyone back to the lobby');
  check(G[0].ctl.view === 'lobby', 'the lead phone shows the lobby again');
  check(errors === 0, `no errors (${errors})`);
  console.log(JSON.stringify({ failures: fail.length, fail }));
  process.exit(fail.length ? 1 : 0);
})();

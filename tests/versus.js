
// Versus on everyone's own screens, end to end through the mock PeerJS: the lobby (host first, friends as they join, the
// rules), a 4-player free-for-all to the end (everyone drafts on their own screen, four colours, scored per fighter), a
// 2-player duel, Teams 2v2 with CPUs in the empty seats, and playing alone against a CPU.
//   node tests/versus.js [latencyMs=40] [jitterMs=0]
const { load, advance, schedule } = require('./env');

const LATENCY = +(process.argv[2] || process.env.NET_LATENCY || 40); // ms each way
const JITTER = +(process.argv[3] || process.env.NET_JITTER || 0);
// 'features': both fighters carry the block/movement cards and the bots duck, block constantly (parries, edge launches) and hug walls
const FEATURES = process.argv[4] === 'features';    // extra random ms per message (delivery stays in order, like a WebRTC data channel)
// NET_LOSS=2 loses 2% of packets. On the reliable channel (PeerJS's, ordered) a lost packet is resent after a retransmit
// timeout and holds up everything behind it, as SCTP does; on the game's fast channel it is simply gone.
// NET_FAST=0 leaves out the fast channel (the game then sends everything reliably, as before it existed).
const LOSS = +(process.env.NET_LOSS || 0) / 100, FAST = process.env.NET_FAST !== '0', RETX = Math.max(200, 2 * LATENCY + 80);
let jseed = 99; const jrand = () => ((jseed = (jseed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const vnow = () => require('./env').clock.t;
const registry = new Map();
class Emitter {
  constructor() { this.handlers = {} }
  on(e, f) { (this.handlers[e] = this.handlers[e] || []).push(f); return this }
  emit(e, ...a) { for (const f of this.handlers[e] || []) f(...a) }
}
let lseed = 7; const lrand = () => ((lseed = (lseed * 1103515245 + 12345) >>> 0) / 2 ** 32);   // its own stream: loss never shifts the jitter
class MockChannel {   // a negotiated, unordered, never-retransmitted RTCDataChannel
  constructor() { this.readyState = 'connecting'; this.bufferedAmount = 0; this.peer = null }
  send(str) { if (this.readyState !== 'open') return; if (str.startsWith('{"t":"s"')) { globalThis.__snapB = (globalThis.__snapB || 0) + str.length; globalThis.__snapN = (globalThis.__snapN || 0) + 1 } if (LOSS && lrand() < LOSS) return; const o = this.peer;
    const t = vnow(); let at = t + LATENCY + jrand() * JITTER; if (process.env.NET_FAST_ORDER) { at = Math.max(this.lastAt || 0, at); this.lastAt = at }
    schedule(() => { if (o.readyState === 'open' && o.onmessage) o.onmessage({ data: str }) }, at - t) }
  close() { this.readyState = 'closed'; if (this.peer) this.peer.readyState = 'closed' }
}
class MockConn extends Emitter {
  constructor() { super(); this.open = false; this.other = null; this.chans = {};
    if (FAST) this.peerConnection = { createDataChannel: (label, o) => { const ch = new MockChannel(); this.chans[o.id] = ch; const th = this.other && this.other.chans[o.id];
      if (th) { ch.peer = th; th.peer = ch; schedule(() => { ch.readyState = th.readyState = 'open' }, LATENCY) } return ch } } }
  send(m) { if (!this.open) return; const d = JSON.parse(JSON.stringify(m)), o = this.other, t = vnow();
    let at = Math.max(this.lastAt || 0, t + LATENCY + jrand() * JITTER); if (LOSS && lrand() < LOSS) at += RETX;   // lost: resent later, and in order, so it blocks the rest
    this.lastAt = at; schedule(() => o.open && o.emit('data', d), at - t) }
  close() { if (!this.open) return; this.open = false; const o = this.other; schedule(() => { this.emit('close'); if (o.open) { o.open = false; o.emit('close') } }, LATENCY) }
}
class MockPeer extends Emitter {
  constructor(id) {
    super();
    this.id = typeof id === 'string' ? id : 'anon-' + Math.random().toString(36).slice(2);
    schedule(() => { if (registry.has(this.id)) return this.emit('error', { type: 'unavailable-id' }); registry.set(this.id, this); this.emit('open', this.id) }, 60);
  }
  connect(id) {
    const mine = new MockConn();
    schedule(() => {
      const host = registry.get(id);
      if (!host) return this.emit('error', { type: 'peer-unavailable' });
      if (globalThis.__blockNextLink) { // the two networks can't link: both sides see ICE fail and the link never opens
        globalThis.__blockNextLink = false; const theirs = new MockConn(); mine.other = theirs; theirs.other = mine;
        host.emit('connection', theirs);
        schedule(() => { theirs.emit('iceStateChanged', 'failed'); mine.emit('iceStateChanged', 'failed') }, 300);
        return;
      }
      const theirs = new MockConn(); mine.other = theirs; theirs.other = mine; mine.open = theirs.open = true;
      host.emit('connection', theirs); theirs.emit('open'); mine.emit('open');
    }, 80);
    return mine;
  }
  destroy() { if (registry.get(this.id) === this) registry.delete(this.id) }
  reconnect() {}
}
globalThis.Peer = MockPeer;


// A mock MQTT broker reached through a mock WebSocket. It parses the real binary packets the game's MiniMqtt client
// sends (CONNECT, SUBSCRIBE, PUBLISH, PINGREQ, DISCONNECT), so the relay code is exercised byte for byte.
const brokers = new Map(); // url -> { up, subs: Map<topic, Set<ws>> }
const brokerFor = (url) => { if (!brokers.has(url)) brokers.set(url, { up: true, subs: new Map(), published: 0 }); return brokers.get(url) };
function splitPackets(b) {
  const out = []; let o = 0;
  while (o < b.length) { let mul = 1, len = 0, i = o + 1, d; do { d = b[i++]; len += (d & 127) * mul; mul *= 128 } while (d & 128); out.push({ head: b[o], body: b.subarray(i, i + len), raw: b.subarray(o, i + len) }); o = i + len }
  return out;
}
class MockWebSocket {
  constructor(url) {
    this.url = url; this.readyState = 0; const br = brokerFor(url);
    schedule(() => { if (!br.up) { this.readyState = 3; this.onerror && this.onerror({}); this.onclose && this.onclose({}); return } this.readyState = 1; this.onopen && this.onopen({}) }, 120);
  }
  deliver(bytes) { const copy = bytes.slice().buffer; schedule(() => { if (this.readyState === 1 && this.onmessage) this.onmessage({ data: copy }) }, LATENCY / 2) }
  send(data) {
    if (this.readyState !== 1) return; const br = brokerFor(this.url), bytes = new Uint8Array(data);
    schedule(() => { for (const p of splitPackets(bytes)) {
      const type = p.head >> 4;
      if (type === 1) this.deliver(new Uint8Array([0x20, 2, 0, 0]));
      else if (type === 8) { const tl = (p.body[2] << 8) | p.body[3], topic = new TextDecoder().decode(p.body.subarray(4, 4 + tl));
        if (!br.subs.has(topic)) br.subs.set(topic, new Set()); br.subs.get(topic).add(this); this.deliver(new Uint8Array([0x90, 3, p.body[0], p.body[1], 0])) }
      else if (type === 3) { const tl = (p.body[0] << 8) | p.body[1], topic = new TextDecoder().decode(p.body.subarray(2, 2 + tl)); br.published++;
        for (const ws of br.subs.get(topic) || []) ws.deliver(p.raw) }
      else if (type === 12) this.deliver(new Uint8Array([0xD0, 0]));
      else if (type === 14) this.close();
    } }, LATENCY / 2);
  }
  close() { if (this.readyState === 3) return; this.readyState = 3; for (const set of brokerFor(this.url).subs.values()) set.delete(this); schedule(() => this.onclose && this.onclose({}), 1) }
}

const fail = [], check = (ok, msg) => { if (!ok) fail.push(msg) }, DT = 1 / 60;
(async () => {
  const opt = (seed) => ({ seed, virtualTime: true });
  const H = (await load(opt(11))).api, G = [(await load(opt(22))).api, (await load(opt(33))).api, (await load(opt(44))).api];
  H.setName('Host'); G.forEach((A, i) => A.setName('Friend' + (i + 1)));
  let all = [H, ...G], errors = 0, fcount = 0;
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { fcount++; for (const A of all) { try { A.update(DT); if (fcount % 6 === 0) A.render() } catch (e) { if (errors++ < 3) console.error(e) } } advance(DT * 1000) } };
  const myP = (A) => A === H ? A.players[A.net.hostId] : A.players[A.net.me];
  const drive = (A, f) => { for (const k of ['KeyA', 'KeyD', 'KeyW']) A.keys.delete(k); const me = myP(A);
    if (!me || !me.alive || !Number.isFinite(me.x)) { A.mouse.down = false; return }
    const foes = A.players.filter((q) => q.team !== me.team && q.alive && Number.isFinite(q.x)); if (!foes.length) { A.mouse.down = false; return }
    const o = foes.reduce((a, b) => Math.hypot(a.x - me.x, a.y - me.y) < Math.hypot(b.x - me.x, b.y - me.y) ? a : b), ang = A.aimSolution(me, o);
    A.mouse.x = me.x + Math.cos(ang) * 220; A.mouse.y = me.y + Math.sin(ang) * 220; A.mouse.down = (f + me.id * 7) % 50 < 30;
    A.keys.add(Math.abs(o.x - me.x) > 260 ? (o.x > me.x ? 'KeyD' : 'KeyA') : Math.floor(f / 45) % 2 ? 'KeyD' : 'KeyA');
    if ((f + me.id * 11) % 55 === 0) A.edges.add('KeyW'); if ((f + me.id * 11) % 55 < 30) A.keys.add('KeyW') };
  const picks = new Map(); let stalls = 0;
  const pickMine = (A) => { const me = myP(A); if (!me || !A.pickFor || A.pickFor.id !== me.id) return; if (A.pickMode === 'team') { const T = A.tpick, g = T && T.ids.indexOf(me.id); if (T && g >= 0 && T.chosen[g] < 0 && T.sent !== g) { A.pickNow(g * 3); picks.set(A, (picks.get(A) || 0) + 1) } return }
    if ((A.pickMode === 'local' || A.pickMode === 'remote') && A.hand.length && !A.__picked) { A.__picked = A.pickFor; A.pickNow(0); picks.set(A, (picks.get(A) || 0) + 1) } };
  const play = (maxMin) => { let f = 0; while (f < 60 * 60 * maxMin) { f++; for (const A of all) { if (A.__picked && A.pickFor !== A.__picked) A.__picked = null; pickMine(A) } if (H.game.state === 'play') all.forEach((A) => drive(A, f)); frame(1); if (H.game.state === 'play' && H.game.pointT > 120) { const al = H.players.filter((p) => p.alive); if (al.length > 1) { stalls++; H.die(al.reduce((a, b) => a.hp < b.hp ? a : b)) } }   // test bots wedged against a wall in overtime: settle the point
    if (H.game.state === 'over') { frame(40); return f } } return f };
  // --- the lobby
  Object.assign(H.settings, { bsMode: 'ffa', bsLen: 2, bsCards: 'losers', bsBots: 0, bsHp: 1 });
  H.openVersus(); frame(20); const code = H.net.code;
  check(H.net.room && H.net.party && !H.net.screen && H.net.lobbyOpen, 'Versus opens a lobby on own screens');
  for (const A of G) { A.joinGame(code); frame(40) }
  check(G.every((A) => A.net.party && A.net.connected !== false), 'three friends join the lobby');
  check(H.net.peers.filter((p) => p.open && p.name).length === 3, 'the host sees three friends');
  // --- a 4-player free-for-all
  H.partyStart(); frame(60);
  check(H.game.mode === 'online-host' && G.every((A) => A.game.mode === 'online-guest'), 'Start takes everyone into the match');
  check(H.game.ffa && G.every((A) => A.game.ffa), 'every screen plays a free-for-all');
  check(H.players.length === 4 && new Set(H.players.map((p) => p.team)).size === 4 && G.every((A) => A.players.every((p, k) => p.team === H.players[k].team)), 'four fighters, each on their own side, the same on every screen');
  check(new Set(G.map((A) => A.net.me)).size === 3 && H.net.hostId === 0, `each friend drives their own fighter (${G.map((A) => A.net.me)})`);
  check(H.game.wins.length === 4 && H.game.target === 2 && G.every((A) => A.game.target === 2), 'scored per fighter, to the host\'s rounds');
  const f1 = play(14);
  check(H.game.state === 'over' && G.every((A) => A.game.state === 'over'), `the free-for-all plays to the end on every screen (wins ${H.game.wins}, ${(f1 / 3600).toFixed(1)} min)`);
  check([H, ...G].every((A) => (picks.get(A) || 0) > 0), `every screen drafts its own cards (${[H, ...G].map((A) => picks.get(A) || 0)})`);
  check(Math.max(...H.game.wins) === 2, 'a fighter reaches the rounds to win');
  // --- a duel: one friend, nobody else
  for (const A of G) A.leaveOnline(true); H.leaveOnline(true); all = [H, G[0]]; frame(30);
  Object.assign(H.settings, { bsMode: 'ffa', bsBots: 0, bsLen: 2 }); H.openVersus(); frame(20); G[0].joinGame(H.net.code); frame(40);
  H.partyStart(); frame(60);
  check(H.players.length === 2 && H.game.ffa && G[0].players.length === 2, 'two players and no CPUs make a duel');
  const f2 = play(10); check(H.game.state === 'over' && G[0].game.state === 'over', `the duel plays to the end (${(f2 / 3600).toFixed(1)} min)`);
  // --- Teams 2v2: two friends, CPUs in the empty seats
  G[0].leaveOnline(true); H.leaveOnline(true); all = [H, G[0]]; frame(30);
  Object.assign(H.settings, { bsMode: 'teams', bsLen: 2 }); H.openVersus(); frame(20); G[0].joinGame(H.net.code); frame(40);
  H.partyStart(); frame(60);
  check(!H.game.ffa && !G[0].game.ffa && H.players.length === 4 && H.players.filter((p) => p.ctrl === 'cpu').length === 2 && H.game.wins.length === 2, 'Teams: 2v2, CPUs fill the empty seats');
  const f3 = play(12); check(H.game.state === 'over' && G[0].game.state === 'over', `the 2v2 plays to the end (${(f3 / 3600).toFixed(1)} min)`);
  // --- alone, against a CPU
  G[0].leaveOnline(true); H.leaveOnline(true); all = [H]; frame(30);
  Object.assign(H.settings, { bsMode: 'ffa', bsBots: 1, bsLen: 1 }); H.openVersus(); frame(20); H.partyStart(); frame(60);
  check(H.game.mode === 'online-host' && H.players.length === 2 && H.players[1].ctrl === 'cpu', 'alone with a CPU player: the match starts');
  const f4 = play(6); check(H.game.state === 'over', 'and plays to the end');
  check(!errors, `no errors (${errors})`);
  console.log(JSON.stringify({ ffaMin: +(f1 / 3600).toFixed(1), duelMin: +(f2 / 3600).toFixed(1), stalledPoints: stalls, teamsMin: +(f3 / 3600).toFixed(1), errors, failures: fail.length }));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();

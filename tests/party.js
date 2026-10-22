// Party (2v2) online, end to end: a host and three friends, four copies of the game linked through the mock PeerJS with
// 40 ms latency. Checks: the lobby fills, friends land on the team with fewer players and can pick a team (never more
// than two to a team), Start sends everyone into the same match with their own fighter, team drafts (the losing pair
// pick at once) work from every screen, bots on all four screens play a whole match to the end, every screen's view of
// every fighter tracks the host's, a friend who leaves mid-match sits out while the rest play on, and a rematch.
//   node tests/party.js [latencyMs=40] [jitterMs=0]
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
  const opt = (seed) => ({ seed, virtualTime: true, WebSocket: MockWebSocket });
  const H = (await load(opt(11))).api, G = [(await load(opt(22))).api, (await load(opt(33))).api, (await load(opt(44))).api];
  H.setName('Hosty'); G.forEach((A, i) => A.setName('Friend' + (i + 1))); H.settings.len = 3;
  const all = [H, ...G]; let errors = 0, fcount = 0;
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { fcount++; for (const A of all) { try { A.update(DT); if (fcount % 6 === 0) A.render() } catch (e) { if (errors++ < 3) console.error(e) } } advance(DT * 1000) } };
  // --- the lobby
  H.net.wantParty = true; H.hostGame(); frame(10); const code = H.net.code;
  check(H.net.party && H.net.lobbyOpen, 'hosting a party should open a lobby');
  G[0].joinGame(code); frame(30); G[1].joinGame(code); frame(30);
  const teamOf = (A) => (A.net.peers.filter((p) => p.open && p.name)).map((p) => [p.name, p.team]);
  check(H.game.mode !== 'online-host', 'a party should wait in the lobby until the host starts');
  check(JSON.stringify(teamOf(H)) === '[["Friend1",1],["Friend2",0]]', `friends should land on the team with fewer players (${JSON.stringify(teamOf(H))})`);
  // Friend2 moves to Blue (now Friend1, Friend2 vs the host alone); Friend3 then lands on Orange; a full team turns people away
  G[1].net && G[1].net.conn && G[1].net.conn.send({ t: 'team', k: 1 }); frame(10);
  check(H.net.peers.find((p) => p.name === 'Friend2').team === 1, 'a friend should be able to switch team');
  G[2].joinGame(code); frame(30);
  check(H.net.peers.find((p) => p.name === 'Friend3').team === 0, 'the next friend should land on the team with room');
  G[2].net.conn.send({ t: 'team', k: 1 }); frame(10);
  check(H.net.peers.find((p) => p.name === 'Friend3').team === 0, 'a full team (two players) should turn a switch away');
  // a fifth player is turned away
  const F = (await load(opt(55))).api; F.setName('Late'); all.push(F); F.joinGame(code); frame(60);
  check(F.net.role === null, 'a fifth player should be told the party is full'); all.pop();
  // --- start: everyone gets their own fighter, on matching teams
  H.partyStart(); frame(40);
  check(H.game.mode === 'online-host' && G.every((A) => A.game.mode === 'online-guest'), 'Start should take everyone into the match');
  check(H.players.length === 4 && G.every((A) => A.players.length === 4), 'every screen should have four fighters');
  const mine = G.map((A) => A.net.me);
  check(new Set(mine).size === 3 && !mine.includes(H.net.hostId), `each screen should have its own fighter (${mine} host ${H.net.hostId})`);
  check(G.every((A) => A.players.every((p, k) => p.team === H.players[k].team && p.name.split(' ')[0] === H.players[k].name.split(' ')[0])), 'every screen should agree on names and teams');
  check(H.players[H.net.hostId].team === 0 && G.every((A, i) => A.players[A.net.me].team === [1, 1, 0][i]), 'teams should be as the lobby chose');
  // --- play: bots on every screen go for the nearest rival, hop, and shoot; drafts pick their own first card
  const myP = (A) => A === H ? A.players[A.net.hostId] : A.players[A.net.me];
  const drive = (A, f) => { for (const k of ['KeyA', 'KeyD', 'KeyW']) A.keys.delete(k); const me = myP(A);
    if (!me || !me.alive || !Number.isFinite(me.x)) { A.mouse.down = false; return }
    const foes = A.players.filter((q) => q.team !== me.team && q.alive && Number.isFinite(q.x)); if (!foes.length) { A.mouse.down = false; return }
    const o = foes.reduce((a, b) => Math.hypot(a.x - me.x, a.y - me.y) < Math.hypot(b.x - me.x, b.y - me.y) ? a : b), ang = A.aimSolution(me, o);
    A.mouse.x = me.x + Math.cos(ang) * 220; A.mouse.y = me.y + Math.sin(ang) * 220; A.mouse.down = (f + me.id * 7) % 50 < 30;
    A.keys.add(Math.abs(o.x - me.x) > 260 ? (o.x > me.x ? 'KeyD' : 'KeyA') : Math.floor(f / 45) % 2 ? 'KeyD' : 'KeyA');
    if ((f + me.id * 11) % 55 === 0 || (f + me.id * 11) % 55 === 18) A.edges.add('KeyW'); if ((f + me.id * 11) % 55 < 30) A.keys.add('KeyW') };
  const pickMine = (A) => { const T = A.tpick, me = myP(A); if (A.pickMode !== 'team' || !T || !me) return 0; const g = T.ids.indexOf(me.id); if (g < 0 || T.chosen[g] >= 0 || T.sent === g) return 0; A.pickNow(g * 3); return 1 };
  let frames = 0, drafts = [0, 0, 0, 0], err = [0, 0, 0], errN = [0, 0, 0], moved = [0, 0, 0], last = [null, null, null], over = false, left = false;
  const hist = [[], [], [], []], jud = [[0, 0], [0, 0], [0, 0]], vel = new Map();   // the host's recent path of each fighter; judder per screen
  while (frames < 60 * 60 * 12) { frames++;
    all.forEach((A, i) => { drafts[i] += pickMine(A) });
    if (H.game.state === 'play') all.forEach((A) => drive(A, frames));
    // a friend leaves mid-match once a few rounds are in: the rest play on, their fighter sits out
    if (!left && H.game.wins.reduce((a, b) => a + b, 0) >= 2 && H.game.state === 'play') { left = true; G[2].leaveOnline(true) }
    frame(1);
    // every guest draws every other fighter ON the path the host simulated (a moment behind, as online play must), and
    // smoothly: no frame where the drawn speed suddenly jumps (judder)
    H.players.forEach((h, k) => { hist[k].push([frames, h.x, h.y, H.game.mapIdx]); if (hist[k].length > 30) hist[k].shift() });
    if (H.game.state === 'play') G.forEach((A, i) => { if (A === G[2] && left) return; if (A.game.state !== 'play' || A.game.mapIdx !== H.game.mapIdx) return;
      for (const p of A.players) { if (p.id === A.net.me) continue; const h = H.players[p.id]; if (!p.alive || !h.alive || !Number.isFinite(p.x) || p.hurtT > -.25) { vel.delete(i + ':' + p.id); continue }
        let best = 1e9; for (const e of hist[p.id]) if (e[3] === H.game.mapIdx) best = Math.min(best, Math.hypot(p.x - e[1], p.y - e[2])); if (best < 1e9) { err[i] += best; errN[i]++ }
        const key = i + ':' + p.id, o = vel.get(key); if (o) { const v = (p.x - o.x) / DT; if (o.v != null) { jud[i][1]++; if (Math.abs(v - o.v) > 300 && Math.abs(v - o.v) * DT > 3) jud[i][0]++ } vel.set(key, { x: p.x, v }) } else vel.set(key, { x: p.x, v: null }) }
      const me = A.players[A.net.me]; if (me && me.alive && last[i]) moved[i] += Math.abs(me.x - last[i]); last[i] = me && me.alive ? me.x : null });
    if (H.game.state === 'over') { frame(40); over = true; break } }
  const sync = err.map((e, i) => +(e / Math.max(1, errN[i])).toFixed(1));
  check(over, `the match should finish (wins ${H.game.wins}, ${(frames / 3600).toFixed(1)} min)`);
  check(G.slice(0, 2).every((A) => A.game.state === 'over'), 'the friends still in should see the end screen');
  check(left && H.players.some((p) => p.left) && H.net.peers.length === 2, 'the friend who left should sit out while the rest play on');
  check(drafts.slice(0, 3).every((d) => d > 0), `every screen should draft its own cards (${drafts})`);
  check(moved.slice(0, 2).every((m) => m > 2000), `each friend's fighter should move (${moved.map(Math.round)})`);
  const judder = jud.map(([n, d]) => +(100 * n / Math.max(1, d)).toFixed(2));
  check(sync.slice(0, 2).every((e) => e < 25), `every screen should draw the others on the host's path (mean off-path ${sync} px)`);
  check(judder.slice(0, 2).every((j) => j < 2.5), `every screen should draw the others smoothly (judder ${judder}%)`);
  check(!errors, `no errors (${errors})`);
  // --- a rematch: the two friends still in play again; the empty seat is a CPU now
  H.requestRematch(); frame(60);
  check(H.game.mode === 'online-host' && G.slice(0, 2).every((A) => A.game.mode === 'online-guest' && A.game.state !== 'over'), 'a rematch should start again for everyone still in');
  check(H.players.filter((p) => p.ctrl === 'cpu').length === 1, 'the seat of the friend who left should be a CPU in the rematch');
  console.log(JSON.stringify({ minutes: +(frames / 3600).toFixed(1), wins: H.game.wins, drafts, offPathPx: sync, judderPct: jud.map(([n, d]) => +(100 * n / Math.max(1, d)).toFixed(2)), snapBytes: Math.round((globalThis.__snapB || 0) / Math.max(1, globalThis.__snapN || 1)), errors, failures: fail.length }));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();

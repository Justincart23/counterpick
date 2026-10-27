// Co-op Survival online, end to end: a host and a guest (two copies of the game over the mock network from net.js) team
// up. Checks: the room is co-op on both screens; each hero picks a character and a card on their own screen; the guest
// sees every enemy the host simulates, where the host has them; the guest's inputs move and fire its hero; each hero
// shops on their own (the guest buys a card); a downed partner comes back (revive or timer); both down costs a life;
// the run ends on both screens.
//   node tests/coop.js [latencyMs=40] [jitterMs=0]
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

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg) };
const DT = 1 / 60;

(async () => {
  const H = (await load({ seed: 12, virtualTime: true, WebSocket: MockWebSocket })).api;
  const G = (await load({ seed: 23, virtualTime: true, WebSocket: MockWebSocket })).api;
  H.setName('Hosty'); G.setName('Guesty');
  let errors = 0;
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { for (const A of [H, G]) { try { A.update(DT); if (i % 6 === 0) A.render() } catch (e) { if (errors++ < 3) console.error(e) } } advance(DT * 1000) } };

  H.net.wantCoop = true; H.hostGame(); frame(10);
  G.joinGame(H.net.code); frame(40);
  check(H.game.coop && H.game.mode === 'survival', `the host should start Co-op Survival (mode ${H.game.mode})`);
  check(G.game.coop && G.game.mode === 'online-guest', 'the guest should join it as co-op');

  // bots: the host's own hero is a CPU; the guest plays through its keyboard and mouse
  H.players[0].ctrl = 'cpu'; H.players[0].skill = 'hard';
  let guestPicks = 0, hostPicks = 0, guestShops = 0, sentNext = false, maxRound = 0, rosterOk = 0, rosterBad = 0, syncN = 0, syncErr = 0, moved = 0, lastX = null, maxWave = 0;
  const bot = () => {
    if (H.game.state === 'pick' && H.pickFor && H.pickMode === 'local' && !H.pickLock) { H.choose(H.hand[0], 0); hostPicks++ }
    if (G.pickFor && G.pickMode === 'remote' && !G.pickLock) { G.netChoose(guestPicks % G.hand.length); guestPicks++ }
    const hh = H.players[0]; if (hh.shopDone) { for (let i = 0; i < 5; i++) H.survBuy(i, hh); H.survNext() }
    const gm = G.players[1];
    if (gm && gm.shopDone && !sentNext) { guestShops++; for (let i = 0; i < 5; i++) G.survBuy(i); sentNext = true; schedule(() => G.survNext(), 300) }
    if (!(gm && gm.shopDone)) sentNext = false;
    G.keys.delete('KeyA'); G.keys.delete('KeyD'); G.mouse.down = false; G.mouse.sx = null;
    if (G.game.state === 'play' && gm && gm.alive) { let e = null, bd = 1e9; for (const q of G.players) if (q.team === 1 && q.alive && Number.isFinite(q.x)) { const d = Math.hypot(q.x - gm.x, q.y - gm.y); if (d < bd) { bd = d; e = q } }
      if (e) { G.mouse.x = e.x; G.mouse.y = e.y - 20; G.mouse.down = true; if (Math.abs(e.x - gm.x) > 380) G.keys.add(e.x > gm.x ? 'KeyD' : 'KeyA'); if (Math.random() < .02) G.edges.add('KeyW') } } };
  for (let f = 0; f < 60 * 60 * 6 && H.game.state !== 'over' && maxRound < 8; f++) {
    bot(); frame(1);
    maxRound = Math.max(maxRound, H.game.round || 0);
    if (H.game.state === 'play' && G.game.state === 'play') {
      maxWave = Math.max(maxWave, H.players.filter((p) => p.team === 1).length);
      if (G.players.length === H.players.length && G.players.every((p, k) => p.team === H.players[k].team && p.name === H.players[k].name)) rosterOk++; else rosterBad++;
      // the guest draws other fighters a little in the past (its interpolation delay): compare with where the host had them then
      const now = require('./env').clock.t;
      for (let k = 2; k < H.players.length; k++) { const a = H.players[k]; const hs = a._h || (a._h = []); hs.push([H.game.stepAt ?? now, a.x, a.y, a.hurtT > -.3]); if (hs.length > 120) hs.shift() }
      if (G.net.clk != null) { const rt = now - (G.net.clkS ?? G.net.clk) - (G.net.interpMs || 55);
        for (let k = 2; k < H.players.length; k++) { const a = H.players[k], b = G.players[k]; if (!a || !b || !a.alive || !b.alive || !Number.isFinite(b.x)) continue;
          let best = null; for (const e of a._h) if (!best || Math.abs(e[0] - rt) < Math.abs(best[0] - rt)) best = e;
          if (best && Math.abs(best[0] - rt) < 20 && !best[3]) { const d = Math.hypot(best[1] - b.x, best[2] - b.y); syncN++; syncErr += d; (globalThis.__ds = globalThis.__ds || []).push(d) } } }
      const gh = H.players[1]; if (gh.alive) { if (lastX != null) moved += Math.abs(gh.x - lastX); lastX = gh.x } else lastX = null }
  }
  check(H.players[0].char && H.players[1].char, 'both heroes should have chosen a character');
  check(guestPicks >= 2, `the guest should pick on its own screen (${guestPicks} picks)`);
  check(maxRound >= 4, `the team should get through a few rounds (reached ${maxRound})`);
  check(rosterOk > 0 && rosterBad < rosterOk * .02, `the guest should see the same fighters as the host (${rosterBad} bad of ${rosterOk + rosterBad} frames)`);
  check(maxWave >= 2, `waves should bring several enemies (largest ${maxWave})`);
  check(syncN > 0 && syncErr / syncN < 20, `enemies should be where the host has them on the guest's screen (mean ${(syncErr / Math.max(1, syncN)).toFixed(1)} px off; the guest draws them a little in the past)`);
  check(moved > 2000, `the guest's inputs should move its hero on the host (${Math.round(moved)} px)`);
  check((H.players[1].lvl || 1) > 1 || (H.players[1].xp || 0) > 5, 'the guest\'s shots should earn it XP on the host');
  check(guestShops >= 1 && H.players[1].cards.length >= 2, `the guest should shop for itself (${guestShops} shops, ${H.players[1].cards.length} cards)`);
  check(H.players[1].scrap !== H.players[0].scrap || guestShops >= 1, 'each hero should have their own scrap');

  // a downed partner: a revive window on both screens; a teammate in the circle brings them back, otherwise they sit out the round
  for (let f = 0; f < 60 * 30 && H.game.state !== 'play'; f++) { bot(); frame(1) }
  if (H.game.state === 'play') { const g = H.players[1]; H.players[0].ctrl = 'idle'; H.players[0].hp = H.players[0].s.maxHp = 1e6; for (const e of H.players) if (e.team === 1) e.hp = e.s.maxHp = 1e6; H.die(g); frame(30);
    check(!g.alive && g.downT > 7, `a downed guest should get a respawn timer (${g.downT})`);
    check(G.players[1].downT > 6, 'the guest should see its own respawn timer');
    // standing next to them revives them
    { const h0 = H.players[0]; let t = 0; for (; t < 60 * 6 && !g.alive; t++) { h0.x = g.downX; h0.y = g.downY; h0.vx = h0.vy = 0; h0.hp = 1e6; frame(1) }
      check(g.alive && t < 60 * 5, `standing beside a downed partner should revive them in about 2 s of fighting (${(t / 60).toFixed(1)} s; hits on the reviver pause the game briefly)`) }
    // nobody comes before the timer runs out: out until the round ends
    if (H.game.state === 'play') { H.die(g); const h0 = H.players[0]; h0.x = g.downX + 600; let f = 0; for (; f < 60 * 14; f++) { h0.hp = 1e6; if (Math.hypot(h0.x - g.downX, h0.y - g.downY) < 200) h0.x = g.downX + 600; frame(1) }
      check(!g.alive && !(g.downT > 0), `a partner nobody revives in time should stay out for the round (alive ${g.alive}, timer ${g.downT})`) }
    // both down: a life goes
    const lives = H.game.lives; H.players[0].s.maxHp = 100; H.players[0].ctrl = 'cpu'; if (process.env.DBG) console.log('before', H.game.state, lives, H.players.map(p => p.alive)); if (H.game.state === 'play') { H.die(H.players[1]); H.die(H.players[0]); frame(300) }
    if (process.env.DBG) console.log('after', H.game.state, H.game.lives, H.players.map(p => p.alive)); check(H.game.lives === lives - 1 || H.game.state === 'over', 'both heroes down should cost a life') }
  // the run ends on both screens
  H.game.lives = 1; for (let f = 0; f < 60 * 20 && H.game.state !== 'play'; f++) { bot(); frame(1) }
  if (H.game.state === 'play') { H.die(H.players[1]); H.die(H.players[0]) } frame(200);
  check(H.game.state === 'over', `the run should end on the host (${H.game.state})`);
  check(G.game.state === 'over', `the run should end on the guest (${G.game.state})`);
  check(!errors, `no errors (${errors})`);
  console.log(JSON.stringify({ reached: maxRound, hostPicks, guestPicks, guestShops, biggestWave: maxWave, enemyOffPx: +(syncErr / Math.max(1, syncN)).toFixed(1), guestMovedPx: Math.round(moved), guestCards: H.players[1].cards.length, snapBytes: Math.round((globalThis.__snapB || 0) / Math.max(1, globalThis.__snapN || 1)), failures: fail.length }));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();

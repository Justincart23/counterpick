// Online play, end to end: loads two copies of the game (host and guest) and connects them through a mock PeerJS
// with 40 ms message latency on a shared virtual clock. Bots drive each side's real keyboard and mouse inputs.
// Checks: hosting and joining by code, names crossing over, drafting on both screens (the guest picks its own cards),
// the guest's inputs moving its fighter on the host, the guest's view tracking the host's simulation,
// a full match to the end screen on both sides, rematch, a wrong code, a full room, and a clean disconnect.
//   node tests/net.js [latencyMs=40] [jitterMs=0] [features]   (e.g. 90 45 is a typical cross-country link)
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
  const H = (await load({ seed: 11, virtualTime: true, WebSocket: MockWebSocket })).api;
  const G = (await load({ seed: 22, virtualTime: true, WebSocket: MockWebSocket })).api;
  H.setName('Hosty'); G.setName('Guesty'); H.settings.len = 3;
  if (process.env.NO_DROPS) H.settings.drops = false;

  let errors = 0;
  const actors = [H, G];   // every loaded copy gets a frame, like separate browser tabs
  // like a browser, let pending promise callbacks run between frames (the relay client is promise-based)
  const frameA = async (n = 1) => { for (let i = 0; i < n; i++) { frame(); await new Promise((r) => setImmediate(r)) } };
  let fcount = 0; const ex = { seen: new WeakSet(), spawn: [], gapH: [], gapG: [] };
  // NET_REAL=1: each screen runs at its own refresh rate with frame-time jitter and occasional hitches, like real
  // devices (NET_HFPS / NET_GFPS, default 60; NET_FJIT ms of jitter per frame; NET_HITCH='ms@seconds' a stall every so
  // often), and the drawn positions are scored for judder on both screens. Otherwise both screens step in lockstep.
  const REAL = !!process.env.NET_REAL, FPS = [+(process.env.NET_HFPS || 60), +(process.env.NET_GFPS || 60)], FJIT = +(process.env.NET_FJIT || 0);
  const [HITCH_MS, HITCH_EVERY] = (process.env.NET_HITCH || '0@0').split('@').map(Number);
  let jseed2 = 5; const jr2 = () => ((jseed2 = (jseed2 * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const sched = new Map(), judder = { hostSelf: [0, 0], hostSeesGuest: [0, 0], guestSelf: [0, 0], guestSeesHost: [0, 0], hostPlatforms: [0, 0], guestPlatforms: [0, 0] };
  const track = (key, A, p, x, dt) => { const k = key + p.id, st = track[k] || (track[k] = {});
    const ok = A.game.state === 'play' && p.alive && Number.isFinite(x) && dt > 0 && st.map === A.game.mapIdx && !(p.hurtT > -.25) && !(p.kT > -.25) && !(p.chargeT > -.25) && !(key === 'guestSeesHost' && require('./env').clock.t - ev.knock0 < 450);
    const v = ok && st.x != null ? (x - st.x) / dt : null;
    // a judder: the drawn speed jumps by over 300 px/s AND the body lands more than 3 px off its course that frame
    if (v != null && st.v != null) { judder[key][1]++; if (Math.abs(v - st.v) > 300 && Math.abs(v - st.v) * dt > 3) judder[key][0]++ }
    st.v = v; st.x = x; st.map = A.game.mapIdx };
  const plat = (key, A, dt) => { const a = A.game.alpha || 0; for (const w of A.solids) if (w.swing && w.lx != null) {
      const x = w.lx + (w.x - w.lx) * a, st = w['_j' + key] || (w['_j' + key] = {});
      const v = st.map === A.game.mapIdx && A.game.state === 'play' && st.x != null ? (x - st.x) / dt : null;
      if (v != null && st.v != null) { judder[key][1]++; if (Math.abs(v - st.v) > 300 && Math.abs(v - st.v) * dt > 3) judder[key][0]++ }
      st.v = v; st.x = x; st.map = A.game.mapIdx } };
  const ev = { knock0: -1e9, knock1: -1e9, bn: 0, blinkAt: -1e9, bj: 0, bn2: 0, prevB: new WeakMap() };
  const drawn = (A, dt) => { if (H.game.mode !== 'online-host' || G.game.mode !== 'online-guest') return;   // only while the two are in a match together
    plat(A === H ? 'hostPlatforms' : 'guestPlatforms', A, dt); const now = require('./env').clock.t;
    let smOk = true; try { sm } catch (e) { smOk = false }   // set up once the match starts
    if (smOk && A === H && H.players[0]) { const h = H.players[0]; sm.hist.push([H.game.stepAt ?? now, h.x, h.y, H.game.mapIdx]); if (sm.hist.length > 900) sm.hist.shift() }
    for (const k of [0, 1]) { const q = H.players[k]; if (q && (q.hurtT > 0 || q.kT > 0 || q.chargeT > 0 || q.frozenT > 0)) ev['knock' + k] = now }
    if (A === G) { const me = G.players[1], o = G.players[0];
      if (smOk && o && o.alive && G.game.state === 'play' && H.game.state === 'play' && G.net.clk != null && now - ev.knock0 > 450) { const rt = now - (G.net.clkS ?? G.net.clk) - (G.net.interpMs || 55); let best = null;
        for (const e of sm.hist) if (e[3] === G.game.mapIdx && (!best || Math.abs(e[0] - rt) < Math.abs(best[0] - rt))) best = e;
        if (best && Math.abs(best[0] - rt) < 20) { const d = Math.hypot(o.x - best[1], o.y - best[2]); if (process.env.PATHDBG && d > 40) console.log('PATH', Math.round(d), 'o', Math.round(o.x), Math.round(o.y), 'true', Math.round(best[1]), Math.round(best[2]), 'buf', (o.buf || []).length, 'rt-newest', o.buf && o.buf.length ? Math.round(rt - o.buf[o.buf.length - 1][0]) : null, 'st', G.game.state, H.game.state, 'stale', G.net.staleN || 0, 'snapHt', G.net.snap && G.net.snap.ht, 'hostStepAt', Math.round(H.game.stepAt), 'snaps', G.net.snapN, 'bufIsArr', Array.isArray(o.buf)); sm.path++; sm.pathSum += d; if (d > 12) sm.pathOff++ } }
      if (me && (me.blinkN || 0) !== ev.bn) { ev.bn = me.blinkN || 0; ev.blinkAt = now }
      for (const b of G.bullets) { if (b.stuck) continue; const pv = ev.prevB.get(b);
        if (pv && dt > 0) { const vx = (b.x - pv.x) / dt, vy = (b.y - pv.y) / dt;
          if (pv.vx != null) { const dot = vx * pv.vx + vy * pv.vy, m = Math.hypot(vx, vy) * Math.hypot(pv.vx, pv.vy);
            if (m > 0 && dot > 0.5 * m) { ev.bn2++; if (Math.hypot(vx - pv.vx, vy - pv.vy) - 1650 * (b.g || 1) * dt * 1.5 > 300) ev.bj++ } }
          ev.prevB.set(b, { x: b.x, y: b.y, vx, vy }) } else ev.prevB.set(b, { x: b.x, y: b.y }) }
      if (me && me.alive && G.game.state === 'play' && Number.isFinite(me.x)) { const x = (me.lx != null ? me.lx + (me.x - me.lx) * (G.game.alpha || 0) : me.x) + G.net.offX, y = (me.ly != null ? me.ly + (me.y - me.ly) * (G.game.alpha || 0) : me.y) + G.net.offY;
        // unexplained by how it was moving (average of this frame's start and end velocity); a hitch frame itself is excluded
        const ex = (me.vx + (ev.lvx ?? me.vx)) / 2 * dt, ey = (me.vy + (ev.lvy ?? me.vy)) / 2 * dt;
        if (smOk && dt < .05 && ev.lx != null && ev.lmap === G.game.mapIdx && now - ev.knock1 > 400 && now - ev.blinkAt > 200 && Math.hypot(x - ev.lx - ex, y - ev.ly - ey) > 60) { visJumps++; if (process.env.JDBG) console.log('JUMP', Math.round(Math.hypot(x - ev.lx - me.vx * dt, y - ev.ly - me.vy * dt)), 'dt', Math.round(dt * 1000), 'hostLag', H.net.lagSteps, 'Q', (H.net.inQ || []).length, 'offX', Math.round(G.net.offX), 'offY', Math.round(G.net.offY), 'ackGap', G.net.inSeq - (H.players[1].ackSeq || 0), 'grounded', me.grounded, 'vy', Math.round(me.vy)) }
        ev.lx = x; ev.ly = y; ev.lvx = me.vx; ev.lvy = me.vy; ev.lmap = G.game.mapIdx } else ev.lx = null } if (A === H) { const a = H.game.alpha || 0; for (const p of H.players) if (p.lx != null) track(p.id === 0 ? 'hostSelf' : 'hostSeesGuest', H, p, p.lx + (p.x - p.lx) * a, dt) }
    else if (A === G) { const me = G.players[1], o = G.players[0]; if (me) track('guestSelf', G, me, (me.lx != null ? me.lx + (me.x - me.lx) * (G.game.alpha || 0) : me.x) + G.net.offX, dt); if (o) track('guestSeesHost', G, o, o.x, dt) } };
  // exactness between the two screens, sampled right after the visitor's frame (what it draws)
  const sampleExact = () => { try { ex } catch (e) { return }
    if (H.game.state === 'play' && G.game.state === 'play' && G.game.mapIdx === H.game.mapIdx) { const o = G.players[0], hf = H.players[0], gf = H.players[1], me = G.players[1];
      for (const b of G.bullets) if (!b.ghost && !b.hide && b.gun && b.own === 0 && !ex.seen.has(b)) { ex.seen.add(b); if (process.env.SPDBG && o.alive && ex.spawn.length < 25) console.log('SPAWN', Math.round(Math.hypot(b.x - (o.x + Math.cos(o.aim) * (o.r + 30)), b.y - (o.y + Math.sin(o.aim) * (o.r + 30)))), 'ag', b.ag, 'spd', Math.round(Math.hypot(b.vx, b.vy)), 'dirVsAim', (Math.atan2(b.vy, b.vx) - o.aim).toFixed(2), 'b', Math.round(b.x), Math.round(b.y), 'o', Math.round(o.x), Math.round(o.y), 'hostF', Math.round(hf.x), Math.round(hf.y), 'seenAgo', Math.round(performance.now() - (b.seen || 0)), 'own', b.own, 'sx', Math.round(b.sx), Math.round(b.sy), 'rx', b.rx && Math.round(b.rx), 'trail', b.trail.length, 'lead', b.lead, 'tag', b.tag); if (o.alive && hf.alive) ex.spawn.push(Math.hypot(b.x - (o.x + Math.cos(o.aim) * (o.r + 30)), b.y - (o.y + Math.sin(o.aim) * (o.r + 30)))) }
      if (o.alive && hf.alive && Number.isFinite(o.x)) ex.gapH.push(Math.hypot(o.x - hf.x, o.y - hf.y));
      if (me.alive && gf.alive && Number.isFinite(me.x)) ex.gapG.push(Math.hypot(me.x + G.net.offX - gf.x, me.y + G.net.offY - gf.y)) }
  };
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { fcount++;
    if (!REAL) { for (const A of actors) { try { A.update(DT); if (A === G) sampleExact(); if (fcount % 6 === 0) A.render() } catch (e) { if (errors++ < 3) console.error(e) } } advance(DT * 1000); continue }
    const end = require('./env').clock.t + DT * 1000;
    while (require('./env').clock.t < end) { const now = require('./env').clock.t;
      for (const A of actors) { const k = actors.indexOf(A), fps = FPS[k] || 60; let s = sched.get(A); if (!s) { s = { next: now, last: now }; sched.set(A, s) }
        if (now >= s.next) { const dt = Math.max(.001, (now - s.last) / 1000); s.last = now;
          let per = 1000 / fps * (1 + (jr2() * 2 - 1) * FJIT / (1000 / fps)); if (HITCH_EVERY && jr2() < (1000 / fps) / (HITCH_EVERY * 1000)) per += HITCH_MS;
          s.next = now + Math.max(1, per);
          try { A.update(Math.min(dt, .25)); if (A === H || A === G) drawn(A, dt); if (A === G) sampleExact() } catch (e) { if (errors++ < 3) console.error(e) } } }
      advance(1) } } };

  // --- a wrong code fails cleanly
  const X = (await load({ seed: 33, virtualTime: true })).api; X.setName('Lost');
  X.joinGame('ZZZZ'); frame(30);
  check(X.net.role === null, 'joining a code nobody hosts should leave the guest disconnected');

  // --- host, then join with the code
  H.hostGame(); frame(10);
  const code = H.net.code;
  check(/^[A-Z2-9]{4}$/.test(code), `host should get a 4-character room code (got "${code}")`);

  // --- a join whose network path is blocked fails fast, and the host keeps waiting for someone else
  globalThis.__blockNextLink = true; X.joinGame(code); frame(40);
  check(X.net.role === null, 'with no relay reachable, a blocked link should end the join attempt quickly, not hang');
  check(H.net.role === 'host' && H.net.conn === null && H.game.mode !== 'online-host', 'after a blocked attempt the host should still be waiting in its room');
  G.joinGame(code.toLowerCase()); frame(30);
  check(H.game.mode === 'online-host' && G.game.mode === 'online-guest', `both sides should enter the match (host=${H.game.mode}, guest=${G.game.mode})`);
  check(H.players[1].name === 'Guesty' && G.players[0].name === 'Hosty', 'names should cross over');

  // --- a third player is turned away
  const F = (await load({ seed: 44, virtualTime: true })).api; F.setName('Late');
  F.joinGame(code); for (let i = 0; i < 120 && F.net.role !== null; i++) frame(1);   // up to 2 s: with packet loss the reply may be resent
  check(F.net.role === null, 'a third player should be told the room is full');
  check(H.net.connected && H.game.mode === 'online-host', 'the full-room attempt must not disturb the match');

  // --- play the match with bots on both sides
  let guestDrafts = 0, hostDrafts = 0, guestMoved = 0, syncErr = 0, syncN = 0, frames = 0, sawGuestBullet = false;
  const lastX = { v: null };
  // bots: walk toward the rival, hop, and alternate flat shots with high lobs (lobs clear the tall pillars on some arenas)
  const aimArc = (A, me, opp, high) => {
    const v = me.s.bulletSpeed, g = A.bulletG(me.s), dx = opp.x - me.x, dy = me.y - opp.y, v2 = v * v;
    const disc = v2 * v2 - g * (g * dx * dx + 2 * dy * v2);
    if (disc < 0 || !high) return A.aimSolution(me, opp);
    const th = Math.atan2(v2 + Math.sqrt(disc), g * Math.abs(dx));
    return Math.atan2(-Math.sin(th), Math.cos(th) * (dx >= 0 ? 1 : -1));
  };
  const drive = (A, me, opp, f) => {
    for (const k of ['KeyA', 'KeyD', 'KeyW']) A.keys.delete(k);
    if (!me || !opp || !me.alive || !opp.alive || !Number.isFinite(me.x)) { A.mouse.down = false; return }
    const ang = aimArc(A, me, opp, Math.floor(f / 60) % 2 === 1);
    A.mouse.x = me.x + Math.cos(ang) * 220; A.mouse.y = me.y + Math.sin(ang) * 220; A.mouse.down = f % 50 < 30;
    const dist = Math.abs(opp.x - me.x), toward = opp.x > me.x ? 'KeyD' : 'KeyA', away = toward === 'KeyD' ? 'KeyA' : 'KeyD';
    A.keys.add(dist > 300 ? toward : Math.floor(f / 45) % 2 ? toward : away);
    if (f % 55 === 0 || f % 55 === 18) A.edges.add('KeyW');   // jump, then double-jump near the top (clears tall walls)
    if (f % 55 < 16 || (f % 55 >= 18 && f % 55 < 34)) A.keys.add('KeyW');   // hold for full height (a tap gives a short hop)
    if (f % 233 === 0) A.mouse.rEdge = true;
    if (FEATURES) {
      if (f % 70 === 5) A.mouse.rEdge = true;                                   // block a lot: parries, edge launches, echo/charge
      if (f % 160 >= 120 && f % 160 < 150) { A.keys.add('KeyS'); A.keys.delete('KeyW') } else A.keys.delete('KeyS');   // duck, fast-fall
      if (f % 300 >= 200 && f % 300 < 230) { for (const k of ['KeyA', 'KeyD']) A.keys.delete(k); A.keys.add(me.x < 800 ? 'KeyA' : 'KeyD') }   // run at walls / edges
    }
  };
  const FEATURE_DECK = ['Echo Guard', 'Shield Charge', 'Long Haul', 'Mirror Guard', 'Bulwark', 'Cluster Guard', 'Blink Guard', 'Gravity Well'];
  const giveDecks = () => { for (const p of H.players) { const want = FEATURE_DECK.map((n) => H.CARDS.find((c) => c.n === n)); if (p.cards.length < want.length || !want.every((c) => p.cards.includes(c))) { p.cards = [...want, ...p.cards.filter((c) => !want.includes(c))]; H.recompute(p) } } };
  const sg = { dropRun: 0, hj: [], last: null, gaps: [], n: 0, stutter: 0, o1: null, o2: null, h1: null, h2: null };
  const hostTrail = [];   // the host fighter's recent positions, to compare against the guest's (network-delayed) view
  // prediction probes: the guest's own fighter should react on its own screen before the host even hears about it,
  // and corrections from the host should never make it visibly jump
  let swingClip = 0, embedded = 0, tunnels = 0, lastMe = null; const solidAt = (A, x, y) => A.solids.some((r) => !r.bound && !r.oneway && x > r.x + 2 && x < r.x + r.w - 2 && y > r.y + 2 && y < r.y + r.h - 2);
  const sm = { sw: 0, swShake: 0, hist: [], path: 0, pathSum: 0, pathOff: 0 }; const cons = { n: 0, alive: 0, hp: 0, hpRun: 0, shields: 0, parries: 0, charges: 0, ducks: 0 }; const bm = { wasDown: false, clickAt: null, lat: [], seen: new WeakSet(), seenBefore: new WeakSet(), n: 0, jerk: 0 }; let hitAt = -999, lastHp = null, probeKey = 'KeyD', mapMismatch = 0, probe = 0, probeT = 0, gx0 = 0, hx0 = 0, responsive = null, hostStill = null, visJumps = 0, lastVis = null, lastMap = -1;
  while (H.game.state !== 'over' && frames < 60 * 60 * 12) {
    frames++;
    if (H.pickFor && H.pickMode === 'local' && !H.pickLock) { H.choose(H.hand[0], 0); hostDrafts++ }
    if (G.pickFor && G.pickMode === 'remote' && !G.pickLock) { G.netChoose(1); guestDrafts++ }
    if (FEATURES && H.game.state === 'ready') giveDecks();
    if (FEATURES && G.net.snap && H.game.state === 'play' && G.game.state === 'play' && G.game.mapIdx === H.game.mapIdx) {
      // host and guest agree on what matters: who is alive, health (within one snapshot of change), shield walls
      cons.n++; if (G.players.some((p, k) => p.alive !== H.players[k].alive)) cons.alive++;
      // health reaches the guest one snapshot trip after a hit: only a difference that lasts longer than that is a disagreement
      if (G.players.some((p, k) => Math.abs(p.hp - H.players[k].hp) > 60)) { if (++cons.hpRun > 12) cons.hp++ } else cons.hpRun = 0;
      if ((H.shields || []).length !== undefined) { const hs = H.game && H.players.length ? H.shieldsLen() : 0; if (Math.abs(G.shieldsLen() - hs) > 1) cons.shields++ }
      cons.parries = H.game.parries || 0; if (H.players.some((p) => p.chargeT > 0)) cons.charges++; if (H.players.some((p) => p.duck)) cons.ducks++ }
    drive(H, H.players[0], H.players[1], frames);
    const me = G.players[1];
    const still = (f) => f.grounded && !(f.ground && f.ground.swing) && Math.abs(f.vx) < 5;   // on fixed ground: moving platforms carry you
    if (probe === 0 && frames > 300 && H.game.state === 'play' && me.alive && me.grounded) { probe = 1; probeT = 0 }
    if (probe === 1 || probe === 2) { for (const k of ['KeyA', 'KeyD', 'KeyW', 'KeyS']) G.keys.delete(k); G.mouse.down = false } else drive(G, G.players[1], G.players[0], frames + 31);
    if (probe === 1 && ++probeT >= 20 && !still(H.players[1])) probeT = 0;   // wait until the host's copy is standing still
    if (probe === 1 && G.game.state !== 'play') probeT = 0;   // a new point's countdown started: wait for live play
    if (probe === 1 && (!me.grounded || Math.abs(me.vx) > 5)) probeT = 0;   // the guest's own copy runs a little ahead: it must be standing still too, the whole wait
    if (probe === 1 && probeT >= 20) { probe = 2; probeT = 0; gx0 = me.x; hx0 = H.players[1].x; probeKey = G.solids.some((r) => !r.oneway && !r.bound && me.x + 60 > r.x && me.x < r.x + r.w && me.y > r.y - me.r && me.y < r.y + r.h + me.r) || me.x > 1400 ? 'KeyA' : 'KeyD'; G.keys.add(probeKey) }
    else if (probe === 2 && (H.players[1].hurtT > 0 || H.players[1].kT > 0)) { probe = 0; G.keys.delete(probeKey) }   // a shot knocked it: try again later
    else if (probe === 2) { G.keys.add(probeKey); if (++probeT >= 3) { responsive = Math.abs(me.x - gx0); hostStill = Math.abs(H.players[1].x - hx0); probe = 3; G.keys.delete(probeKey) } }
    frame();
    if (H.game.state === 'play' && G.game.state === 'play' && G.game.map && G.game.map.name !== H.game.map.name) mapMismatch++;
    const vis = me.alive && Number.isFinite(me.x) ? [me.x + G.net.offX, me.y + G.net.offY] : null;
    // a hit's or a blast's knockback is decided on the host, so the guest can't predict it: the moment after a hit isn't a prediction error
    if (H.players[1].hurtT > 0 || H.players[1].kT > 0 || (lastHp != null && me.hp < lastHp)) hitAt = frames; lastHp = me.hp;
    if (process.env.BLINKDBG) { const hb = H.players[1].blinkN || 0; if (hb !== (sg.hbn || 0)) { sg.hbn = hb; console.log('HOST  blink', hb, Math.round(H.players[1].x), Math.round(H.players[1].y), 'guestNow', Math.round(me.x), Math.round(me.y), 'aim', H.players[1].aim.toFixed(2), 'ack', H.players[1].ackSeq, 'gseq', G.net.inSeq, 'st', H.game.state, 'cd', H.players[1].blockCd.toFixed(2), 'stock', H.players[1].blockStock) }
      if ((me.blinkN || 0) !== (sg.bn || 0)) console.log('GUEST blink', me.blinkN, Math.round(me.x), Math.round(me.y), 'aim', me.aim.toFixed(2), 'hostNow', Math.round(H.players[1].x), Math.round(H.players[1].y), 'gseq', G.net.inSeq, 'gst', G.game.state, 'cd', (me.blockCd || 0).toFixed(2), 'stock', me.blockStock) }
    const blinked = (me.blinkN || 0) !== (sg.bn || 0); sg.bn = me.blinkN || 0; if (blinked) { sg.blinks = (sg.blinks || 0) + 1; sg.lastBlinkF = frames }   // Blink Guard: a teleport is meant to jump
    if (!REAL && vis && lastVis && !blinked && G.game.mapIdx === lastMap && G.game.state === 'play' && frames - hitAt > 24 && Math.hypot(vis[0] - lastVis[0], vis[1] - lastVis[1]) > 60) { visJumps++; if (process.env.BLINKDBG) console.log('JUMP', Math.round(Math.hypot(vis[0] - lastVis[0], vis[1] - lastVis[1])), 'fsb', frames - (sg.lastBlinkF || -999), 'gseq', G.net.inSeq, 'snapAck', G.net.snap && G.net.snap.p[1][18], 'snapBlinkN', G.net.snap && G.net.snap.p[1][23], 'guestBlinkN', me.blinkN, 'hostBlinkN', H.players[1].blinkN, 'hostAck', H.players[1].ackSeq, 'lag', H.net.lagSteps) }
    // smoothness on the guest's screen: hanging blocks / moving platforms must glide (no frame-to-frame shake), and the
    // host's fighter must follow its true path (drawn INTERP ms in the past, so compare with where it really was then)
    if (G.game.state === 'play' && G.game.mapIdx === lastMap) for (const w of G.solids.filter((r) => r.swing)) {
      const a = G.game.alpha || 0, wx = w.lx != null ? w.lx + (w.x - w.lx) * a : w.x, wy = w.ly != null ? w.ly + (w.y - w.ly) * a : w.y;   // where it's drawn
      if (w._p1) { sm.sw++; if (Math.hypot(wx - 2 * w._p1[0] + w._p2[0], wy - 2 * w._p1[1] + w._p2[1]) > 3) sm.swShake++ } w._p2 = w._p1 || [wx, wy]; w._p1 = [wx, wy] }
    { const h = H.players[0], now = vnow(); if (!REAL) { sm.hist.push([H.game.stepAt ?? now, h.x, h.y, H.game.mapIdx]); if (sm.hist.length > 400) sm.hist.shift() }
      const o = G.players[0];
      const hb0 = H.players[0].blinkN || 0; if (hb0 !== sm.hb0) { sm.hb0 = hb0; sm.hbF = frames }
      if (!REAL && G.game.state === 'play' && o.alive && G.net.clk != null && frames - (sm.hbF ?? -999) > 20) { const rt = now - DT * 1000 - (G.net.clkS ?? G.net.clk) - (G.net.interpMs || 55);   /* the guest drew one frame ago: the clock has since advanced */ let best = null;   // the guest's own interpolation delay let best = null;
        for (const e of sm.hist) if (e[3] === G.game.mapIdx && (!best || Math.abs(e[0] - rt) < Math.abs(best[0] - rt))) best = e;
        if (best && Math.abs(best[0] - rt) < 20) { const d = Math.hypot(o.x - best[1], o.y - best[2]); sm.path++; sm.pathSum += d; if (d > 12) sm.pathOff++ } } }
    // bullets on the guest's screen: how soon its own shot appears after a click, and whether bullets fly smoothly
    if (G.game.state === 'play') { const mine = G.bullets.filter((b) => b.color === G.players[1].color);
      if (G.mouse.down && !bm.wasDown) bm.clickAt = frames; bm.wasDown = G.mouse.down;
      for (const b of mine) if (!bm.seen.has(b)) { bm.seen.add(b); if (bm.clickAt != null && !b.trail.length) { /* brand new */ } }
      if (bm.clickAt != null && mine.some((b) => !bm.seenBefore.has(b))) { bm.lat.push(frames - bm.clickAt); if (process.env.SHOTDBG && bm.lat.length < 15) console.log('SHOT lat', frames - bm.clickAt, 'ghost', mine.filter((b) => !bm.seenBefore.has(b)).map((b) => b.ghost ? 'g' : 'h').join(''), 'gFireT', (G.players[1].gFireT || 0).toFixed(2), 'gAmmo', G.players[1].gAmmo); bm.clickAt = null }
      for (const b of mine) bm.seenBefore.add(b);
      for (const b of G.bullets) { const t = b.trail, n = t.length; if (b.stuck || n < 6) continue;
        const jx = t[n - 2] - 2 * t[n - 4] + t[n - 6], jy = t[n - 1] - 2 * t[n - 3] + t[n - 5]; bm.n++; if (Math.hypot(jx, jy) > 4) bm.jerk++ } }
    if (G.net.snapAt !== sg.last) { if (sg.last != null && G.game.state === 'play') sg.gaps.push(G.net.snapAt - sg.last); sg.last = G.net.snapAt }
    { const o = G.players[0], h = H.players[0];
      if (G.game.state === 'play' && o.alive && Number.isFinite(o.x) && G.game.mapIdx === lastMap && sg.o1 && sg.o2) { sg.n++;
        const jo = Math.hypot(o.x - 2 * sg.o1[0] + sg.o2[0], o.y - 2 * sg.o1[1] + sg.o2[1]), jh = Math.hypot(h.x - 2 * sg.h1[0] + sg.h2[0], h.y - 2 * sg.h1[1] + sg.h2[1]);
        sg.hj.push(jh); if (sg.hj.length > 20) sg.hj.shift();   // the guest shows the host ~55-170 ms late: a real kink (a landing, a bounce) anywhere in that window isn't stutter
        if (jo > 6 && Math.max(...sg.hj) < 3) sg.stutter++ }
      sg.o2 = sg.o1; sg.o1 = [o.x, o.y]; sg.h2 = sg.h1; sg.h1 = [h.x, h.y] }
    // power-up capsules: the visitor shows what the host has (a difference may last one snapshot trip)
    if (H.game.state === 'play' && G.game.state === 'play') { if (H.drops.length) sg.sawDrop = true; if (H.drops.length !== G.drops.length) { if (++sg.dropRun > 20) sg.dropOff = (sg.dropOff || 0) + 1 } else sg.dropRun = 0 }
    lastVis = vis; lastMap = G.game.mapIdx;
    if (G.game.state === 'play' && me.alive && Number.isFinite(me.x)) {   // the guest's own fighter must never sit in or pass through a wall
      if (solidAt(G, me.x, me.y)) { const onSwing = G.solids.some((r) => r.swing && me.x > r.x + 2 && me.x < r.x + r.w - 2 && me.y > r.y + 2 && me.y < r.y + r.h - 2); if (onSwing) swingClip++; else embedded++; if (process.env.CLIPDBG) { const r = G.solids.find((r) => !r.bound && !r.oneway && me.x > r.x + 2 && me.x < r.x + r.w - 2 && me.y > r.y + 2 && me.y < r.y + r.h - 2); console.log('CLIP', G.game.map.name, 'me', Math.round(me.x), Math.round(me.y), 'r', me.r.toFixed(1), 'v', Math.round(me.vx), Math.round(me.vy), 'wall', r && [r.x, r.y, r.w, r.h, r.swing ? 'swing' : r.mover ? 'mover' : 'static'], 'host', Math.round(H.players[1].x), Math.round(H.players[1].y), 'blinkN', me.blinkN, 'charge', (me.chargeT || 0).toFixed(2), 'off', Math.round(G.net.offX), Math.round(G.net.offY), 'cards', me.cards.map((c) => c.n).join('/')) } }
      else if (lastMe && !blinked && lastMe[2] === G.game.mapIdx && lastMe[3] === G.net.snapN) { const n = Math.ceil(Math.hypot(me.x - lastMe[0], me.y - lastMe[1]) / 3); for (let i = 1; i < n; i++) if (solidAt(G, lastMe[0] + (me.x - lastMe[0]) * i / n, lastMe[1] + (me.y - lastMe[1]) * i / n)) { tunnels++; if (process.env.CLIPDBG) console.log('TUNNEL', G.game.map.name, 'from', Math.round(lastMe[0]), Math.round(lastMe[1]), 'to', Math.round(me.x), Math.round(me.y), 'v', Math.round(me.vx), Math.round(me.vy), 'blinkN', me.blinkN, 'wells', G.wells ? G.wells.length : '?', 'off', Math.round(G.net.offX), Math.round(G.net.offY), 'hurt', me.hurtT, 'host', Math.round(H.players[1].x), Math.round(H.players[1].y)); break } }
      lastMe = [me.x, me.y, G.game.mapIdx, G.net.snapN] } else lastMe = null;
    const hp = H.players[1];
    if (H.game.state === 'play' && hp.alive) { if (lastX.v != null) guestMoved += Math.abs(hp.x - lastX.v); lastX.v = hp.x } else lastX.v = null;
    hostTrail.push([H.players[0].x, H.players[0].y]); if (hostTrail.length > 12) hostTrail.shift();
    if (H.game.state === 'play' && G.game.state === 'play' && H.players[0].alive && G.players[0].alive && Number.isFinite(G.players[0].x) && hostTrail.length === 12) {
      // the guest is meant to trail by about one network trip; score it against the closest of the host's last 12 frames
      syncErr += Math.min(...hostTrail.map(([x, y]) => Math.hypot(G.players[0].x - x, G.players[0].y - y))); syncN++;
    }
    if (H.bullets.some((b) => b.owner === H.players[1])) sawGuestBullet = true;
    if (process.env.DEBUG && frames % 300 === 0) console.log(`t=${frames / 60}s host:${H.game.state} map=${H.game.map && H.game.map.name} P0(${H.players[0].x | 0},${H.players[0].y | 0}) hp${H.players[0].hp | 0} P1(${H.players[1].x | 0},${H.players[1].y | 0}) hp${H.players[1].hp | 0} vx${H.players[1].vx | 0} bullets=${H.bullets.length} | guest:${G.game.state} G0(${G.players[0].x | 0},${G.players[0].y | 0}) G1(${G.players[1].x | 0},${G.players[1].y | 0}) in=${JSON.stringify(H.net.remote)}`);
  }
  const meanSync = syncN ? syncErr / syncN : Infinity, finalScore = H.game.wins.slice();
  check(H.game.state === 'over', `the match should finish (host state ${H.game.state} after ${(frames / 60).toFixed(0)}s)`);
  frame(20);
  check(G.game.state === 'over', `the guest should see the end screen (guest state ${G.game.state})`);
  check(hostDrafts >= 1 && guestDrafts >= 1, `both players should draft (host ${hostDrafts}, guest ${guestDrafts})`);
  check(H.players[1].cards.length === guestDrafts + (FEATURES ? FEATURE_DECK.length : 0), `the guest's picks should land on the host (${H.players[1].cards.length} vs ${guestDrafts})`);
  check(G.players[1].cards.length === H.players[1].cards.length && G.players[0].cards.length === H.players[0].cards.length, 'both screens should show the same decks');
  check(guestMoved > 800, `the guest's inputs should move its fighter on the host (moved ${guestMoved.toFixed(0)}px)`);
  check(sawGuestBullet, "the guest's shots should be fired on the host");
  check(meanSync < 20 + LATENCY / 5, `the guest's view should track the host's simulation within one network trip (mean error ${meanSync.toFixed(1)}px)`);
  check(responsive != null && responsive > 3, `the guest's fighter should move on its own screen within 2 frames of a key press (moved ${responsive && responsive.toFixed(1)}px)`);
  check(hostStill != null && hostStill < 1, `...before the host has even received that input (host moved ${hostStill && hostStill.toFixed(1)}px), proving the response is local`);
  check(mapMismatch < 10, `the guest should always be on the host's arena (${mapMismatch} frames on a different one)`);
  check(swingClip <= 3, `the guest's own fighter should (almost) never overlap a hanging block (${swingClip} frames)`);   /* each screen swings its own copy of a block, steered together */
  check(embedded === 0 && tunnels <= (swingClip ? 1 : 0), `the guest's own fighter should never clip into or through walls (${embedded} frames inside, ${tunnels} pass-throughs)`);
  check(visJumps <= 1 + frames / 60 / (JITTER ? 3 : 40), `prediction corrections should never make the guest's own fighter jump on screen (${visJumps} jumps over 60px)`);
  check(G.game.wins.join() === H.game.wins.join(), `final score should match (${H.game.wins} vs ${G.game.wins})`);

  // --- rematch requested by the guest
  G.requestRematch(); frame(40);
  check(H.game.state !== 'over' && H.game.mode === 'online-host', 'the host should start a rematch when the guest asks');
  check(G.game.state !== 'over', 'the guest should leave the end screen on rematch');

  // --- the guest leaves
  G.leaveOnline(false); frame(40);
  check(H.net.role === null && H.game.mode === 'demo', `the host should return to the menu when the guest leaves (role=${H.net.role}, mode=${H.game.mode})`);
  // --- relay fallback: the direct link is blocked AND the first relay broker is down; the guest falls through to the second
  brokerFor(H.RELAY_BROKERS[0]).up = false;
  globalThis.WebSocket = MockWebSocket;   // copies share one global; an earlier copy was loaded without sockets
  H.hostGame(); await frameA(20);
  const rcode = H.net.code;
  const R = (await load({ seed: 55, virtualTime: true, WebSocket: MockWebSocket })).api; R.setName('Relayed'); actors.push(R);
  globalThis.__blockNextLink = true; R.joinGame(rcode); await frameA(60 * 12);
  check(H.game.mode === 'online-host' && R.game.mode === 'online-guest', `a blocked direct link should fall back to a relay and start the match (host=${H.game.mode}, guest=${R.game.mode})`);
  check(H.net.relayed && R.net.relayed, 'both sides should know the match is relayed');
  let relayMoved = 0, relaySync = 0, relayN = 0, lastRX = null; const trail2 = [];
  for (let f = 0; f < 60 * 40; f++) {
    if (H.pickFor && H.pickMode === 'local' && !H.pickLock) H.choose(H.hand[0], 0);
    if (R.pickFor && R.pickMode === 'remote' && !R.pickLock) R.netChoose(0);
    drive(H, H.players[0], H.players[1], f); drive(R, R.players[1], R.players[0], f + 17); await frameA();
    const hp = H.players[1];
    if (H.game.state === 'play' && hp.alive) { if (lastRX != null) relayMoved += Math.abs(hp.x - lastRX); lastRX = hp.x } else lastRX = null;
    trail2.push([H.players[0].x, H.players[0].y]); if (trail2.length > 16) trail2.shift();
    if (H.game.state === 'play' && R.game.state === 'play' && H.players[0].alive && R.players[0].alive && Number.isFinite(R.players[0].x) && trail2.length === 16) {
      relaySync += Math.min(...trail2.map(([x, y]) => Math.hypot(R.players[0].x - x, R.players[0].y - y))); relayN++;
    }
  }
  const relayMean = relayN ? relaySync / relayN : Infinity;
  check(brokerFor(H.RELAY_BROKERS[1]).published > 500, 'match traffic should flow through the second broker');
  check(relayMoved > 500, `relayed inputs should move the guest's fighter on the host (moved ${relayMoved.toFixed(0)}px)`);
  check(relayMean < 25, `the relayed guest's view should track the host (mean error ${relayMean.toFixed(1)}px)`);
  R.leaveOnline(false); await frameA(60);
  check(H.net.role === null && H.game.mode === 'demo', 'the host should return to the menu when the relayed guest leaves');
  brokerFor(H.RELAY_BROKERS[0]).up = true;

  check(!sg.sawDrop, 'a duel has no power-up drops (they belong to Survival)');
  check(errors === 0, `no exceptions (${errors})`);
  if (FEATURES) {
    check(cons.n > 600 && cons.alive / cons.n < 0.02, `host and guest should agree who is alive (${cons.alive} of ${cons.n} frames differ)`);
    check(cons.hp / cons.n < 0.02, `host and guest should agree on health (${cons.hp} of ${cons.n} frames off by >60)`);
    check(cons.shields / cons.n < 0.02, `host and guest should show the same Bulwark walls (${cons.shields} of ${cons.n} frames differ)`);
    check(cons.charges > 0 && cons.ducks > 0, `the features run should exercise dashes and ducks (charges ${cons.charges}, ducks ${cons.ducks})`);
  }

  check(REAL || sm.sw < 200 || sm.swShake / sm.sw < (FEATURES ? 0.02 : 0.01) /* the features deck knocks hanging blocks about with blasts and dashes */, `moving platforms should glide on the guest's screen (${sm.swShake} of ${sm.sw} frames shook more than 3px)`);
  check(sm.path > 300 && sm.pathOff / sm.path < 0.03 && sm.pathSum / sm.path < 6, `the host's fighter should follow its true path on the guest's screen (mean ${(sm.pathSum / sm.path).toFixed(1)}px off, ${sm.pathOff} of ${sm.path} frames over 12px)`);
  check(REAL ? !(ev.bn2 > 500 && ev.bj / ev.bn2 > 0.03) : bm.n < 500 || bm.jerk / bm.n < 0.05, `bullets should fly smoothly on the guest's screen (${(100 * bm.jerk / bm.n).toFixed(1)}% of bullet-frames jerked >4px)`);
  { const ok = G.net.gMerged || 0, lost = G.net.gLost || 0; check(ok + lost < 10 || lost / (ok + lost) < 0.25, `the guest's instant shots should be confirmed by the host (${ok} confirmed, ${lost} never fired there)`) }
  const result = { matchSeconds: Math.round(frames / 60), score: finalScore, guestResponsePx: responsive && +responsive.toFixed(1), guestVisibleJumps: visJumps, ownShotFrames: bm.lat.length ? bm.lat.slice().sort((a, b) => a - b)[bm.lat.length >> 1] : null, bulletJerkPct: bm.n ? +(100 * bm.jerk / bm.n).toFixed(2) : null, ghostShotsConfirmed: G.net.gMerged || 0, ghostShotsPhantom: G.net.gLost || 0, ...(FEATURES ? { parries: cons.parries, dashFrames: cons.charges, duckFrames: cons.ducks, consistencyFrames: cons.n } : {}), platformShakeFrames: sm.swShake, otherFighterOffPathPx: +(sm.pathSum / sm.path).toFixed(1), guestClipFrames: embedded, guestPassThroughs: tunnels, relayMeanSyncPx: +relayMean.toFixed(1), hostDrafts, guestDrafts, guestMovedPx: Math.round(guestMoved), meanSyncErrorPx: +meanSync.toFixed(1), errors, failures: fail.length };
  // the harshest setup (30 fps, 90 ms + 45 jitter, a 150 ms freeze every 5 s): the guest's own fighter is held to 3.5%,
  // because there it drifts between about 2.3% and 3.1% with how each match happens to play out; everything else to 2.5%
  const harsh = FPS[1] <= 30 && HITCH_MS >= 150 && JITTER >= 45;
  if (REAL) for (const [k, [n, d]] of Object.entries(judder)) check(d < 300 || n / d < (harsh && k === 'guestSelf' ? 0.035 : 0.025), `${k}: drawn movement should be smooth (${n} of ${d} frames juddered)`);
  { const med = (a) => { const v = a.slice().sort((x, y) => x - y); return v.length ? Math.round(v[v.length >> 1]) : null }, p90 = (a) => { const v = a.slice().sort((x, y) => x - y); return v.length ? Math.round(v[Math.floor(v.length * .9)]) : null };
    if (ex.spawn.length > 20) check(med(ex.spawn) < 40, `the host's shots should leave its gun on the visitor's screen (median ${med(ex.spawn)} px from the muzzle)`);
    result.exact = { hostShotFromGunPx: [med(ex.spawn), p90(ex.spawn)], hostFighterGapPx: [med(ex.gapH), p90(ex.gapH)], guestFighterGapPx: [med(ex.gapG), p90(ex.gapG)] } }
  if (REAL) result.bulletJudderPct = ev.bn2 ? +(100 * ev.bj / ev.bn2).toFixed(2) : null;
  if (REAL) result.judderPct = Object.fromEntries(Object.entries(judder).map(([k, [n, d]]) => [k, d ? +(100 * n / d).toFixed(2) : null]));
  { const g = sg.gaps.slice().sort((a, b) => a - b); Object.assign(result, { hitsByHost: (H.game.hitsBy || [0, 0])[0], hitsByGuest: (H.game.hitsBy || [0, 0])[1], snapBytes: Math.round((globalThis.__snapB || 0) / (globalThis.__snapN || 1)), guestBlinks: sg.blinks || 0, snapGapP99Ms: g.length ? Math.round(g[Math.floor(g.length * .99)]) : null, snapGapMaxMs: g.length ? Math.round(g[g.length - 1]) : null, otherStutterPct: sg.n ? +(100 * sg.stutter / sg.n).toFixed(2) : null, lossPct: LOSS * 100, fast: FAST }) }
  if (LOSS && FAST) { const g = sg.gaps.slice().sort((a, b) => a - b); check(!g.length || g[g.length - 1] < 160, `a lost packet must not stall the guest's view (longest gap between snapshots ${Math.round(g[g.length - 1])} ms)`) }
  check(sg.n < 500 || sg.stutter / sg.n < 0.03, `the host's fighter should move smoothly on the guest's screen (${sg.stutter} of ${sg.n} frames stuttered)`);
  console.log(JSON.stringify(result));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();

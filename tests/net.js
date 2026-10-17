// Online play, end to end: loads two copies of the game (host and guest) and connects them through a mock PeerJS
// with 40 ms message latency on a shared virtual clock. Bots drive each side's real keyboard and mouse inputs.
// Checks: hosting and joining by code, names crossing over, drafting on both screens (the guest picks its own cards),
// the guest's inputs moving its fighter on the host, the guest's view tracking the host's simulation,
// a full match to the end screen on both sides, rematch, a wrong code, a full room, and a clean disconnect.
//   node tests/net.js
const { load, advance, schedule } = require('./env');

const LATENCY = 40; // ms each way
const registry = new Map();
class Emitter {
  constructor() { this.handlers = {} }
  on(e, f) { (this.handlers[e] = this.handlers[e] || []).push(f); return this }
  emit(e, ...a) { for (const f of this.handlers[e] || []) f(...a) }
}
class MockConn extends Emitter {
  constructor() { super(); this.open = false; this.other = null }
  send(m) { if (!this.open) return; const d = JSON.parse(JSON.stringify(m)), o = this.other; schedule(() => o.open && o.emit('data', d), LATENCY) }
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
      const theirs = new MockConn(); mine.other = theirs; theirs.other = mine; mine.open = theirs.open = true;
      host.emit('connection', theirs); theirs.emit('open'); mine.emit('open');
    }, 80);
    return mine;
  }
  destroy() { if (registry.get(this.id) === this) registry.delete(this.id) }
  reconnect() {}
}
globalThis.Peer = MockPeer;

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg) };
const DT = 1 / 60;

(async () => {
  const H = (await load({ seed: 11, virtualTime: true })).api;
  const G = (await load({ seed: 22, virtualTime: true })).api;
  H.setName('Hosty'); G.setName('Guesty'); H.settings.len = 3;

  let errors = 0;
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { for (const A of [H, G]) { try { A.update(DT) } catch (e) { if (errors++ < 3) console.error(e) } } advance(DT * 1000) } };

  // --- a wrong code fails cleanly
  const X = (await load({ seed: 33, virtualTime: true })).api; X.setName('Lost');
  X.joinGame('ZZZZ'); frame(30);
  check(X.net.role === null, 'joining a code nobody hosts should leave the guest disconnected');

  // --- host, then join with the code
  H.hostGame(); frame(10);
  const code = H.net.code;
  check(/^[A-Z2-9]{4}$/.test(code), `host should get a 4-character room code (got "${code}")`);
  G.joinGame(code.toLowerCase()); frame(30);
  check(H.game.mode === 'online-host' && G.game.mode === 'online-guest', `both sides should enter the match (host=${H.game.mode}, guest=${G.game.mode})`);
  check(H.players[1].name === 'Guesty' && G.players[0].name === 'Hosty', 'names should cross over');

  // --- a third player is turned away
  const F = (await load({ seed: 44, virtualTime: true })).api; F.setName('Late');
  F.joinGame(code); frame(30);
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
    if (f % 55 === 0) A.edges.add('KeyW');
    if (f % 55 < 16) A.keys.add('KeyW');   // hold for a full-height jump (a tap gives a short hop)
    if (f % 233 === 0) A.mouse.rEdge = true;
  };
  const hostTrail = [];   // the host fighter's recent positions, to compare against the guest's (network-delayed) view
  while (H.game.state !== 'over' && frames < 60 * 60 * 12) {
    frames++;
    if (H.pickFor && H.pickMode === 'local' && !H.pickLock) { H.choose(H.hand[0], 0); hostDrafts++ }
    if (G.pickFor && G.pickMode === 'remote' && !G.pickLock) { G.netChoose(1); guestDrafts++ }
    drive(H, H.players[0], H.players[1], frames);
    drive(G, G.players[1], G.players[0], frames + 31);
    frame();
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
  check(H.players[1].cards.length === guestDrafts, `the guest's picks should land on the host (${H.players[1].cards.length} vs ${guestDrafts})`);
  check(G.players[1].cards.length === H.players[1].cards.length && G.players[0].cards.length === H.players[0].cards.length, 'both screens should show the same decks');
  check(guestMoved > 800, `the guest's inputs should move its fighter on the host (moved ${guestMoved.toFixed(0)}px)`);
  check(sawGuestBullet, "the guest's shots should be fired on the host");
  check(meanSync < 20, `the guest's view should track the host's simulation within one network trip (mean error ${meanSync.toFixed(1)}px)`);
  check(G.game.wins.join() === H.game.wins.join(), `final score should match (${H.game.wins} vs ${G.game.wins})`);

  // --- rematch requested by the guest
  G.requestRematch(); frame(40);
  check(H.game.state !== 'over' && H.game.mode === 'online-host', 'the host should start a rematch when the guest asks');
  check(G.game.state !== 'over', 'the guest should leave the end screen on rematch');

  // --- the guest leaves
  G.leaveOnline(false); frame(40);
  check(H.net.role === null && H.game.mode === 'demo', `the host should return to the menu when the guest leaves (role=${H.net.role}, mode=${H.game.mode})`);
  check(errors === 0, `no exceptions (${errors})`);

  const result = { matchSeconds: Math.round(frames / 60), score: finalScore, hostDrafts, guestDrafts, guestMovedPx: Math.round(guestMoved), meanSyncErrorPx: +meanSync.toFixed(1), errors, failures: fail.length };
  console.log(JSON.stringify(result));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();

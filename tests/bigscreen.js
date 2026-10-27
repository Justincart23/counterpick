// Big Screen, end to end: one computer is the screen (no fighter of its own) and phones are the controllers, all linked
// through the mock PeerJS with 40 ms latency. Checks: phones that join become controllers (they draw no game), the lobby
// seats them, Start makes a free-for-all with a CPU in the empty seat, every phone drafts its own cards at once (the screen
// shows the picks), a phone's sticks, shots, taps, jumps and blocks move its fighter on the screen within a few frames,
// each phone gets its health and the score, "Find me" lights its fighter, a phone that leaves sits out and gets its own
// seat back when it rejoins, a late friend takes over the CPU's seat, a whole match plays to the end, the phones see the
// result, back to the lobby, and Teams 2v2 with phones choosing their team.
//   node tests/bigscreen.js [latencyMs=40] [jitterMs=0]
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
  const H = (await load(opt(101))).api, G = [(await load(opt(202))).api, (await load(opt(303))).api, (await load(opt(404))).api];
  H.setName('Screen'); G.forEach((A, i) => { A.setName('Phone' + (i + 1)); A.ctl.tok = 'phone' + (i + 1) });
  Object.assign(H.settings, { bsMode: 'ffa', bsLen: 3, bsCards: 'losers', bsBots: 1, bsCpu: 'normal', bsMap: 'all', bsHp: 1, bsTwist: true });
  const all = [H, ...G]; let errors = 0, fcount = 0;
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { fcount++; for (const A of all) { try { A.update(DT); if (A === H && fcount % 6 === 0) A.render(); if (A !== H) A.padSend() } catch (e) { if (errors++ < 3) console.error(e) } } advance(DT * 1000) } };
  // --- the lobby: phones join and become controllers
  H.openBigScreen(); frame(10); const code = H.net.code;
  check(H.net.screen && H.net.lobbyOpen && H.net.role === 'host', 'Big Screen should open a lobby');
  for (const A of G) { A.joinGame(code); frame(30) }
  check(G.every((A) => A.ctl.on && A.net.pad && A.ctl.view === 'lobby'), 'every phone that joins should become a controller in the lobby');
  check(H.net.peers.filter((p) => p.pad && p.name).length === 3, 'the screen should seat three phones');
  check(H.game.mode !== 'online-host', 'nothing starts until the screen presses Start');
  // --- start: a free-for-all, a CPU in the empty seat, no fighter for the screen
  H.bsStart(); frame(20);
  check(H.game.mode === 'online-host' && H.game.screen && H.game.ffa, 'Start should begin a Big Screen free-for-all');
  check(H.players.length === 4 && !H.players.some((p) => p.ctrl === 'mouse'), `four fighters and none for the screen itself (${H.players.map((p) => p.ctrl)})`);
  check(H.players.filter((p) => p.ctrl === 'pad').length === 3 && H.players.filter((p) => p.ctrl === 'cpu').length === 1, 'three phones and one CPU');
  check(new Set(H.players.map((p) => p.team)).size === 4, 'a free-for-all: every fighter on their own side');
  check(H.players[2].color === '#3fd170' && H.players[3].color === '#ff5fae', 'four colours: orange, blue, green, pink');   // (the test page has no stylesheet, so orange and blue read the same here)
  const mine = G.map((A) => A.ctl.me);
  check(new Set(mine).size === 3 && mine.every((m) => H.players[m] && H.players[m].ctrl === 'pad' && H.players[m].name === 'Phone' + (mine.indexOf(m) + 1)), `each phone should drive its own fighter (${mine})`);
  check(G.every((A) => A.ctl.view === 'live' && A.game.mode !== 'online-guest'), 'phones should show the controls and never run the game');
  // --- the opening draft: everyone picks on their phone at once
  frame(30);
  check(G.every((A) => A.ctl.hand && A.ctl.hand.length === 5), `every phone should get five cards to pick from (${G.map((A) => A.ctl.hand && A.ctl.hand.length)})`);
  check(H.spick && H.spick.ids.length === 4, 'the screen should show all four pickers');
  G.forEach((A, i) => A.padPick(i % 3)); frame(30);
  check(G.every((A) => A.ctl.picked >= 0), 'each phone should show its pick locked in');
  frame(60 * 6 + 4 * Math.ceil((LATENCY + JITTER) / (1000 / 60)));
  check(!H.spick && H.players.every((p) => p.cards.length === 1), `after the reveal everyone should hold their card (${H.players.map((p) => p.cards.length)})`);
  check(G.every((A, i) => H.players[A.ctl.me].cards[0] && A.ctl.hand === null), 'the phones should go back to the controls');
  // --- a phone's input reaches its fighter within a few frames
  while (H.game.state !== 'play') frame(1);
  const lat = [];
  for (const A of G) { const p = H.players[A.ctl.me], before = p.padJc ?? 0; A.ctl.jc++; A.padSend(true); let n = 0; while (n < 30 && (p.padJc ?? 0) <= before) { frame(1); n++ } lat.push(n) }
  const frameMs = 1000 / 60, allowed = Math.ceil((LATENCY + JITTER) / frameMs) + 2;   // one way, plus jitter, plus the frame it's sent in and the step that reads it
  check(lat.every((n) => n <= allowed), `a press should reach the screen within ${allowed} frames at ${LATENCY}±${JITTER} ms (${lat})`);
  { const p = H.players[G[0].ctl.me]; G[0].ctl.fc++; G[0].padSend(true); frame(allowed + 1); check(p.findT > 0, '"Find me" should light up that phone\'s fighter') }
  check(G.every((A) => A.ctl.st && A.ctl.st.mh > 0 && Array.isArray(A.ctl.st.w) && A.ctl.st.w.length === 4), 'every phone should get its health and the score');
  // --- play: each phone plays like a person would (the test peeks at the screen's state to steer, as the person's eyes do)
  const drive = (A, f) => { const c = A.ctl, me = H.players[c.me]; c.mx = 0; c.up = false; c.down = false;
    if (c.hand && c.picked < 0) { if ((f + c.me * 13) % 90 === 0) A.padPick((f >> 3) % 3); return }
    if (!me || !me.alive || H.game.state !== 'play') return;
    const foes = H.players.filter((q) => q.team !== me.team && q.alive && Number.isFinite(q.x)); if (!foes.length) return;
    const near = (a, b) => Math.hypot(a.x - me.x, a.y - me.y) < Math.hypot(b.x - me.x, b.y - me.y) ? a : b;
    const shots = foes.filter((q) => H.clearShot(me, H.aimSolution(me, q), q)), o = (shots.length ? shots : foes).reduce(near), clear = shots.length > 0, ang = H.aimSolution(me, o);
    c.blind = clear ? 0 : (c.blind || 0) + 1;
    if (c.blind > 90) { if (c.blind % 150 === 91) c.dir = (f >> 4) % 2 ? 1 : -1; c.mx = c.dir; if (c.blind % 30 === 0) c.jc++; c.up = c.blind % 30 < 16; c.down = c.blind % 150 > 120 }   // no shot for a while: roam (as a person would) until someone's in sight
    else { c.mx = Math.hypot(o.x - me.x, o.y - me.y) < 90 ? -(Math.sign(o.x - me.x) || 1) : !clear ? Math.sign(o.x - me.x) || 1 : Math.abs(o.x - me.x) > 420 ? Math.sign(o.x - me.x) : Math.floor(f / 50) % 2 ? 1 : -1;   // on top of someone: step back first
      if ((f + c.me * 11) % 50 === 0) c.jc++; c.up = !clear && o.y < me.y - 60 && (f + c.me * 11) % 26 < 14 }
    if (clear && (f + c.me * 7) % 21 === 0) { c.a = ang; c.sc++ }   // drag-aim and let go
    if (clear && (f + c.me * 5) % 47 === 0) c.ac++;   // a quick tap: auto-fire
    if ((f + c.me * 3) % 140 === 0) c.bc++ };
  const seen = new Set(); let frames = 0, left = false, back = false, late = null, Fp = null, shotsFired = 0, over = false;
  const leaverSeat = G[2].ctl.me, phones = () => [...G, Fp].filter(Boolean);
  while (frames < 60 * 60 * 14) { frames++;
    for (const A of G) if (A.ctl.on) drive(A, frames);
    if (Fp && Fp.ctl.on) drive(Fp, frames);
    const tot = H.game.wins.reduce((a, b) => a + b, 0);
    if (!left && tot >= 1 && H.game.state === 'play') { left = true; G[2].leaveOnline(true) }
    if (left && !back && frames % 600 === 0 && H.players[leaverSeat].left) { back = true; G[2].joinGame(code) }
    if (back && !late && G[2].ctl.view === 'live' && H.game.state === 'play') { late = await load(opt(505)); Fp = late.api; Fp.setName('Latecomer'); Fp.ctl.tok = 'late1'; all.push(Fp); Fp.joinGame(code) }
    frame(1);
    for (const b of H.bullets) if (b.owner && b.owner.ctrl === 'pad' && !seen.has(b.id)) { seen.add(b.id); shotsFired++ }
    if (H.game.state === 'over') { frame(40); over = true; break } }
  check(left && back, `a phone should leave and rejoin during the match (left ${left} back ${back} wins ${H.game.wins} seat ${leaverSeat} ${H.players.map((p) => p.name + ':' + p.ctrl + (p.left ? ':left' : ''))} phone3 ${G[2].ctl.view} ${G[2].net.role})`);
  check(H.players[leaverSeat].ctrl === 'pad' && H.players[leaverSeat].peer && H.players[leaverSeat].name === 'Phone3' && G[2].ctl.me === leaverSeat, 'the phone that rejoined should get its own seat back');
  check(Fp && Fp.ctl.on && H.players.some((p) => p.name === 'Latecomer' && p.ctrl === 'pad') && !H.players.some((p) => p.ctrl === 'cpu'), `a late friend should take over the CPU's seat (${H.players.map((p) => p.name + ':' + p.ctrl)})`);
  check(shotsFired / Math.max(.5, frames / 3600) > 40, `the phones' shots should fire on the screen (${shotsFired} in ${(frames / 3600).toFixed(1)} min; a match's length varies)`);
  check(over, `the match should finish (wins ${H.game.wins}, ${(frames / 3600).toFixed(1)} min)`);
  check(phones().every((A) => A.ctl.view === 'over'), `every phone should show the result (${G.map((A) => A.ctl.view)} ${Fp && Fp.ctl.view})`);
  const wp = phones().find((A) => A.ctl.me === H.game.overW);
  check(!wp || wp.wallet.wins >= 1, 'the winning phone should earn its coins');
  check(bytes.s === 0, `phones should get no game snapshots (${bytes.s})`);
  // --- back to the lobby; Teams 2v2, phones choosing their team
  H.bsToLobby(); frame(30);
  check(H.net.lobbyOpen && phones().every((A) => A.ctl.view === 'lobby'), 'back to the lobby: every phone shows the lobby');
  H.settings.bsMode = 'teams'; H.bsToLobby(); frame(30);
  const teamOf = (name) => H.net.peers.find((p) => p.name === name).team;
  const t0 = teamOf('Phone1'); G[0].net.conn.send({ t: 'team', k: 1 - t0 }); frame(20);
  check(teamOf('Phone1') === 1 - t0 || H.net.peers.filter((p) => p.team === 1 - t0).length === 2, 'a phone should be able to switch team');
  check([0, 1].every((t) => H.net.peers.filter((p) => p.pad && p.team === t).length === 2), `two phones a team (${H.net.peers.map((p) => p.name + ':' + p.team)})`);
  H.bsStart(); frame(30);
  check(H.game.screen && !H.game.ffa && H.players.length === 4 && H.players.every((p) => p.ctrl === 'pad'), 'Teams 2v2 with four phones');
  check(JSON.stringify(H.players.map((p) => p.team)) === '[0,1,0,1]' && H.game.wins.length === 2, 'two teams, scored by team');
  check(phones().every((A) => H.players[A.ctl.me] && H.players[A.ctl.me].team === A.ctl.team), 'each phone should know its team');
  for (let f = 0; f < 60 * 40; f++) { for (const A of phones()) { if (A.ctl.hand && A.ctl.picked < 0 && f % 40 === 7) A.padPick(1); drive(A, f) } frame(1) }
  check(H.game.wins.reduce((a, b) => a + b, 0) + H.game.points.reduce((a, b) => a + b, 0) > 0, 'teams play scores points');
  // --- no CPUs unless the host adds them: three phones; a fourth joins mid-match and gets a fighter of their own
  Fp.leaveOnline(true); frame(30); Object.assign(H.settings, { bsMode: 'ffa', bsBots: 0 }); H.bsToLobby(); frame(30);
  H.bsStart(); frame(30);
  check(H.players.length === 3 && H.players.every((p) => p.ctrl === 'pad'), `no CPUs unless the host adds them (${H.players.map((p) => p.ctrl)})`);
  const play = (n) => { for (let f = 0; f < n; f++) { for (const A of phones()) { if (!A.ctl.on) continue; if (A.ctl.hand && A.ctl.picked < 0 && f % 40 === 7) A.padPick(0); drive(A, f) } frame(1) } };
  play(60 * 10); Fp.joinGame(code); play(60 * 3);
  check(H.players.length === 4 && H.players[3].name === 'Latecomer' && H.players[3].ctrl === 'pad' && Fp.ctl.me === 3 && H.game.wins.length === 4, `a friend joining mid-match gets a new fighter (${H.players.map((p) => p.name + ':' + p.ctrl)} me ${Fp.ctl.me})`);
  check(H.players[3].cards.length >= Math.min(...H.players.slice(0, 3).map((p) => p.cards.length)), 'the newcomer catches up on cards');
  let spawned = false; for (let f = 0; f < 60 * 100 && !spawned; f++) { play(1); spawned = H.players[3].alive && Number.isFinite(H.players[3].x) && H.players[3].x > 0;
    if (f % (60 * 20) === 60 * 20 - 1 && H.game.state === 'play') { const up = H.players.filter((p) => p.alive); if (up.length > 1) H.die(up[0]) } }   // two test bots stuck in a standoff: end the point for them
  check(spawned, 'the newcomer plays from the next point');
  H.settings.bsBots = 0; H.bsToLobby(); frame(10); for (const A of [G[0], G[1], Fp]) A.leaveOnline(true); frame(30); H.bsStart(); frame(10);
  check(H.net.lobbyOpen && H.game.mode !== 'online-host', 'one phone and no CPUs: Start waits for a friend or a CPU');
  check(!errors, `no errors (${errors})`);
  console.log(JSON.stringify({ minutes: +(frames / 3600).toFixed(1), wins: H.game.wins, pressFrames: lat, shotsFired, inputBytes: Math.round(bytes.c / Math.max(1, bytes.cN)), statusBytes: Math.round(bytes.ps / Math.max(1, bytes.psN)), errors, failures: fail.length }));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();

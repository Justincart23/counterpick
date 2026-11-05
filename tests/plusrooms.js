// Big Screen room size and Flick Plus: a free host's room seats 2 phones, a Plus host's 4, and only the host (the screen)
// needs Plus. Checks: off Flick a room seats 2 and a 3rd phone gets the friendly "room is full" word (no Plus offer, since
// Plus can't be known there); on Flick the same, plus one `plusOffer {perk:'bigRooms'}` for the site; with Plus the phones
// (none of them members) fill all 4 seats and hear "Hosted with Flick Plus"; Plus switching off in the lobby, and again
// mid-match, kicks nobody (a phone that drops comes back to its own seat), while a new phone over the free limit is turned
// away kindly; Co-op Survival follows the same limit.
//   node tests/plusrooms.js [latencyMs=40]
const { load, advance, schedule } = require('./env');

const LATENCY = +(process.argv[2] || 40);
const vnow = () => require('./env').clock.t;
const registry = new Map();
const sentFull = [], lobbies = [];
class Emitter {
  constructor() { this.handlers = {} }
  on(e, f) { (this.handlers[e] = this.handlers[e] || []).push(f); return this }
  emit(e, ...a) { for (const f of this.handlers[e] || []) f(...a) }
}
class MockChannel {
  constructor() { this.readyState = 'connecting'; this.bufferedAmount = 0; this.peer = null }
  send(str) { if (this.readyState !== 'open') return; const o = this.peer; schedule(() => { if (o.readyState === 'open' && o.onmessage) o.onmessage({ data: str }) }, LATENCY) }
  close() { this.readyState = 'closed'; if (this.peer) this.peer.readyState = 'closed' }
}
class MockConn extends Emitter {
  constructor() { super(); this.open = false; this.other = null; this.chans = {};
    this.peerConnection = { createDataChannel: (label, o) => { const ch = new MockChannel(); this.chans[o.id] = ch; const th = this.other && this.other.chans[o.id];
      if (th) { ch.peer = th; th.peer = ch; schedule(() => { ch.readyState = th.readyState = 'open' }, LATENCY) } return ch } } }
  send(m) { if (!this.open) return; const d = JSON.parse(JSON.stringify(m)), o = this.other; if (d && d.t === 'full') sentFull.push(d); if (d && d.t === 'plobby') lobbies.push(d);
    const t = vnow(), at = Math.max(this.lastAt || 0, t + LATENCY); this.lastAt = at; schedule(() => o.open && o.emit('data', d), at - t) }
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
const posted = [];
globalThis.parent = { postMessage: (m) => posted.push(m) };   // the site around the game (only told anything once the screen counts as embedded)

const fail = [], check = (ok, msg) => { if (!ok) fail.push(msg) }, DT = 1 / 60;
(async () => {
  const opt = (seed) => ({ seed, virtualTime: true });
  const H = (await load(opt(11))).api, G = [];
  for (let i = 0; i < 5; i++) G.push((await load(opt(21 + i))).api);
  H.setName('Screen'); G.forEach((A, i) => { A.setName('Phone' + (i + 1)); A.ctl.tok = 'phone' + (i + 1) });
  Object.assign(H.settings, { bsMode: 'ffa', bsLen: 3, bsCards: 'losers', bsBots: 0, bsCpu: 'normal', bsMap: 'all', bsHp: 1, bsTwist: false });
  const all = [H, ...G]; let errors = 0;
  const frame = (n = 1) => { for (let i = 0; i < n; i++) { for (const A of all) { try { A.update(DT); if (A !== H && A.ctl.on) A.padSend() } catch (e) { if (errors++ < 3) console.error(e) } } advance(DT * 1000) } };
  const seated = () => H.net.peers.filter((p) => p.pad && p.name && p.open).length;
  const offers = () => posted.filter((m) => m.flick === 'plusOffer' && m.perk === 'bigRooms').length;

  // --- off Flick (plain cuued.com): Plus can't be known, rooms seat 2
  H.openBigScreen(); frame(10); const code = H.net.code;
  G[0].joinGame(code); frame(30); G[1].joinGame(code); frame(30);
  check(seated() === 2, `two phones seat in a free room (${seated()})`);
  G[2].joinGame(code); frame(40);
  check(seated() === 2, `a third phone doesn't take a seat in a free room (${seated()})`);
  check(sentFull.length === 1 && sentFull[0].cap === 2 && sentFull[0].screen === 1, `the third phone hears the room is full at 2 (${JSON.stringify(sentFull)})`);
  check(!G[2].ctl.on && !G[2].net.role, 'the third phone goes back to its menu, not stuck as a controller');
  check(offers() === 0, 'off Flick nothing asks a site for a Plus offer');
  check(lobbies.length && lobbies.every((m) => !m.hp), 'a free room says nothing about Plus to the phones');

  // --- on Flick, signed out or without Plus: still 2, and Flick is asked to show the offer once
  H.portal.on = true; H.setPlus(false, true); frame(5);
  check(H.portal.flick && H.portal.trial && !H.portal.plus, 'Flick says: no Plus yet, a free trial is there');
  G[2].joinGame(code); frame(40); G[3].joinGame(code); frame(40);
  check(seated() === 2 && sentFull.length === 3 && sentFull.every((m) => m.cap === 2), `phones 3 and 4 are turned away kindly (${seated()} seated, ${sentFull.length} full)`);
  check(offers() === 1, `the site is asked to show Plus once per room, not on every phone (${offers()})`);

  // --- the host gets Plus: 4 seats, guests still free
  H.setPlus(true); frame(5); sentFull.length = 0; lobbies.length = 0;
  G[2].joinGame(code); frame(40); G[3].joinGame(code); frame(40);
  check(seated() === 4 && !sentFull.length, `with Plus on the screen, 4 phones seat (${seated()})`);
  check(G.slice(0, 4).every((A) => A.ctl.on && A.ctl.view === 'lobby' && !A.portal.plus), 'every phone is a controller and none needed Plus');
  check(lobbies.length >= 4 && lobbies.every((m) => m.hp === 1), 'the phones are told the room is hosted with Flick Plus');
  G[4].joinGame(code); frame(40);
  check(seated() === 4 && sentFull.length === 1 && !sentFull[0].cap, 'a fifth phone gets the ordinary "full at 4"');

  // --- Plus switches off in the lobby: nobody is kicked, and Start seats all four
  sentFull.length = 0; H.setPlus(false); frame(60);
  check(seated() === 4 && !sentFull.length && G.slice(0, 4).every((A) => A.ctl.on), `Plus going off in the lobby kicks nobody (${seated()})`);
  H.bsStart(); frame(30);
  check(H.game.mode === 'online-host' && H.players.filter((p) => p.ctrl === 'pad').length === 4, `all four play (${H.players.map((p) => p.ctrl)})`);

  // --- mid-match: Plus back on then off again, a phone drops and comes back, a newcomer can't push past the free limit
  H.setPlus(true); frame(30); H.setPlus(false); frame(120);
  check(H.players.filter((p) => p.ctrl === 'pad' && p.peer).length === 4 && !sentFull.length, 'Plus going off mid-match kicks nobody');
  const me1 = G[1].ctl.me; G[1].leaveOnline(true); frame(60);
  check(H.players[me1].left, 'a phone that drops sits out');
  G[1].joinGame(code); frame(60);
  check(!H.players[me1].left && H.players[me1].peer && G[1].ctl.me === me1 && !sentFull.length, 'and gets its own seat back, Plus or not');
  G[3].leaveOnline(true); frame(60); G[4].joinGame(code); frame(60);   // a seat opens up, but three phones still play: over the free limit
  check(sentFull.length === 1 && sentFull[0].cap === 2 && sentFull[0].started === 1 && !G[4].ctl.on, `a new phone mid-match is over the free limit: turned away kindly (${JSON.stringify(sentFull)} on ${G[4].ctl.on} players ${H.players.map((p) => p.name + ':' + p.ctrl + (p.left ? 'L' : ''))})`);

  // --- Co-op Survival follows the same rule
  G[2].leaveOnline(true); frame(60);
  H.settings.bsMode = 'surv'; H.bsToLobby(); frame(30); sentFull.length = 0;
  check(seated() === 2, `back in the lobby with two phones (${seated()})`);
  G[2].joinGame(code); frame(40);
  check(seated() === 2 && sentFull.length === 1 && sentFull[0].cap === 2, 'Co-op Survival on a free screen seats 2');
  H.setPlus(true); frame(5); G[2].joinGame(code); frame(40); G[3].joinGame(code); frame(40);
  check(seated() === 4, `Co-op Survival with Plus seats 4 (${seated()})`);
  H.bsStart(); frame(30); H.setPlus(false); frame(60);
  check(H.game.bsSurv && H.players.filter((p) => p.team === 0 && p.peer).length === 4, `a 4-hero run keeps all four when Plus goes off (${H.players.filter((p) => p.team === 0 && p.peer).length})`);

  check(!errors, `no errors (${errors})`);
  console.log(JSON.stringify({ errors, failures: fail.length }));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();

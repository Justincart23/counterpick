// A Big Screen phone's controls on the host: holding the aim side charges a Sun Lance and letting go fires it (one beam, no
// extra queued shot), a quick tap fires a light one; a thumb resting in the aim stick's middle keeps its aim instead of
// snapping to the nearest rival; with the thumb up the gun turns toward the rival rather than jumping; a silent phone
// leaves the aim where it was.
//   node tests/padlance.js
const { load, advance, flushTimers } = require('./env');

(async () => {
  const { api: A } = await load({ seed: 3, virtualTime: true });
  const fail = [], out = {};
  const L = A.CARDS.find((c) => c.n === 'Sun Lance');
  let seq = 0;
  const frame = (P, pad, n = 1) => { for (let i = 0; i < n; i++) { if (pad) { P.peer.padIn = { s: ++seq, m: 0, jh: 0, d: 0, jc: 0, bc: 0, fc: 0, sc: 0, ac: 0, xc: 0, a: 0, ag: 0, fh: 0, ...pad }; P.peer.lastInAt = performance.now() } advance(1000 / 60); A.update(1 / 60); flushTimers() } };
  const setup = (deck) => {
    A.startMatch('cpu'); flushTimers(); A.loadMap(0); A.game.state = 'play'; A.game.dropT = 0;
    const [P, E] = A.players; P.cards = deck; E.cards = []; for (const p of A.players) A.recompute(p); E.ctrl = 'idle';
    A.resetPlayer(P, [400, 700]); A.resetPlayer(E, [1100, 700]);
    Object.assign(P, { ctrl: 'pad', peer: { padIn: null, lastInAt: 0 }, padJc: null, padBc: null, padSc: null, padAc: null, padFc: null, padXc: null, padTap: 0 });
    A.game.screen = true; frame(P, {}, 30); A.bullets.length = 0; return [P, E] };
  const beamsBy = (P) => A.bullets.filter((b) => b.owner === P && b.lance);

  // hold the thumb down (no drag: it charges at the rival), then let go with an aimed release
  { const [P, E] = setup([L]); const hp = E.hp; let made = 0; const seen = new Set();
    const watch = () => { for (const b of beamsBy(P)) if (!seen.has(b)) { seen.add(b); made++ } };
    for (let i = 0; i < 50; i++) { frame(P, { fh: 1 }); watch() }
    out.heldWind = A.lanceWind(P); if (!(out.heldWind >= .9)) fail.push(`a thumb held for 50 frames shows ${out.heldWind} wound up`);
    if (made) fail.push('the beam left while the thumb was still down');
    frame(P, { fh: 0, sc: 1 }); watch(); for (let i = 0; i < 150; i++) { frame(P, { fh: 0, sc: 1 }); watch() }
    out.heldBeams = made; out.heldHit = Math.round(hp - E.hp);
    if (made !== 1) fail.push(`letting go of a charged thumb made ${made} beams (want exactly 1, no extra queued shot)`);
    if (hp - E.hp < 100) fail.push(`the charged thumb shot did only ${hp - E.hp | 0}`) }

  // a quick tap fires one light beam
  { const [P, E] = setup([L]); const hp = E.hp; let made = 0, first = -1; const seen = new Set();
    for (let i = 0; i < 90; i++) { frame(P, { ac: 1 }); for (const b of beamsBy(P)) if (!seen.has(b)) { seen.add(b); made++; if (first < 0) first = i } }
    out.tapBeams = made; out.tapFrame = first; out.tapHit = Math.round(hp - E.hp);
    if (made !== 1) fail.push(`a tap made ${made} beams`);
    if (hp - E.hp <= 0 || hp - E.hp > 90) fail.push(`a tap's beam did ${hp - E.hp | 0} (want a light hit)`) }

  // a phone's thumb moved back into the stick's middle keeps the aim it had; lifted, the gun turns toward the rival, not snaps
  { const [P, E] = setup([]); const up = -1.2;
    frame(P, { fh: 1, ag: 1, a: up }, 5); if (Math.abs(P.aim - up) > 1e-6) fail.push(`dragging aimed at ${P.aim}, not ${up}`);
    frame(P, { fh: 1, ag: 0, a: up + .9 }, 10); out.restAim = +P.aim.toFixed(3);
    if (Math.abs(P.aim - up) > 1e-6) fail.push(`a thumb resting in the stick's middle let the aim jump to ${P.aim.toFixed(2)}`);
    const before = P.aim; frame(P, { fh: 0, ag: 0 }, 1); const turn = Math.abs(P.aim - before); out.firstTurn = +turn.toFixed(3);
    if (turn > .2) fail.push(`with the thumb lifted the aim snapped ${turn.toFixed(2)} rad in one frame`);
    frame(P, { fh: 0 }, 60); const want = Math.atan2(E.y - P.y, E.x - P.x);
    if (Math.abs(Math.atan2(Math.sin(P.aim - want), Math.cos(P.aim - want))) > .35) fail.push(`a second later the gun still isn't following the rival (${P.aim.toFixed(2)} vs ${want.toFixed(2)})`)
    // the phone goes quiet: the aim stays put and the fighter stands still
    frame(P, { fh: 1, ag: 1, a: 2.5, m: 1 }, 5); const a0 = P.aim; P.peer.lastInAt = performance.now();
    for (let i = 0; i < 40; i++) { advance(1000 / 60); A.update(1 / 60); flushTimers() }
    if (Math.abs(P.aim - a0) > 1e-6) fail.push(`with the phone silent the aim moved from ${a0} to ${P.aim}`);
    if (P.input.move !== 0) fail.push('with the phone silent the fighter kept running') }

  // taps aim themselves: the gun starts pointing away, the rival stands up and to the side; the beam must leave toward the rival
  const angTo = (P, E) => Math.atan2(E.y - P.y, E.x - P.x), off = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const firstBeam = (P, run, n = 60) => { for (let i = 0; i < n; i++) { run(i); const b = beamsBy(P)[0]; if (b) return Math.atan2(b.vy, b.vx) } return null };
  const place = (P, E) => { A.resetPlayer(E, [1000, 520]); E.ctrl = 'idle'; E.vx = E.vy = 0; P.aim = P.input.aim = Math.PI };
  // Big Screen phone: a tap the screen saw as a press then a release, one it only saw as a release, and a drag held then let go
  for (const [name, seq] of [['tap (press, then release)', (i) => i === 0 ? { fh: 1 } : { fh: 0, ac: 1 }], ['tap (one packet)', () => ({ ac: 1 })]]) {
    const [P, E] = setup([L]); place(P, E); frame(P, { fh: 0 }, 1); P.aim = Math.PI;
    const a = firstBeam(P, (i) => { frame(P, seq(i)); E.vx = E.vy = 0 }); const want = angTo(P, E);
    out['pad ' + name] = a == null ? null : +off(a, want).toFixed(3);
    if (a == null || off(a, want) > .2) fail.push(`phone controller ${name}: the beam left at ${a && a.toFixed(2)}, the rival is at ${want.toFixed(2)}`) }
  { const [P, E] = setup([L]); place(P, E); const want = -0.3;
    const a = firstBeam(P, (i) => frame(P, i < 30 ? { fh: 1, ag: 1, a: want } : { fh: 0, sc: 1, a: want }), 80); out.padDragHold = a == null ? null : +a.toFixed(3);
    if (a == null || off(a, want) > .05) fail.push(`phone controller drag-hold-release: the beam left at ${a && a.toFixed(2)}, dragged to ${want}`) }
  // phone touch controls: a tap on the aim stick (the touch begins, a step runs, it lifts), and one too quick for any step between
  for (const [name, steps] of [['tap', 1], ['instant tap', 0]]) {
    const [P, E] = setup([L]); Object.assign(P, { ctrl: 'mouse', peer: null }); place(P, E); A.touch.on = true; A.touch.aimA = Math.PI; A.mouse.x = P.x - 300; A.mouse.y = P.y;
    const tap = { id: 1, ox: 0, oy: 0, dx: 0, dy: 0, t0: performance.now(), maxD: 0 }; A.touch.aim = tap;
    for (let i = 0; i < steps; i++) { A.touchFrame(); advance(1000 / 60); A.update(1 / 60); flushTimers() }
    A.touch.aim = null; A.touchRelease(tap);
    const a = firstBeam(P, () => { A.touchFrame(); advance(1000 / 60); A.update(1 / 60); flushTimers(); E.vx = E.vy = 0 }); const want = angTo(P, E);
    out['touch ' + name] = a == null ? null : +off(a, want).toFixed(3);
    if (a == null || off(a, want) > .2) fail.push(`touch ${name}: the beam left at ${a && a.toFixed(2)}, the rival is at ${want.toFixed(2)}`);
    A.touch.on = false }

  console.log(JSON.stringify({ ...out, failures: fail }));
  if (fail.length) { for (const f of fail) console.error('  ' + f); process.exit(1) }
})();

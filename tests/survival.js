// Survival: a CPU stand-in plays whole runs: picks a character and a first card, fights round after round (waves and
// bosses), takes its level-ups, buys what it can in the shop, until its 3 lives are gone. Checks: a character is chosen;
// waves grow to several enemies; level-ups happen; the shop opens after every cleared round and scrap is paid and spent;
// waves get tougher; a boss comes on round 5; every one of the six bosses uses its special with its full warning first;
// capsules drop in Survival and never in a normal CPU match; the best round is saved. Reports how far runs get.
//   node tests/survival.js [runs=6]
const { load, flushTimers } = require('./env');
const RUNS = +(process.argv[2] || 6);
(async () => {
  const { api: A } = await load({ seed: 41 });
  const fail = [], check = (ok, m) => { if (!ok) fail.push(m) };
  const reached = []; let arenaOff = 0, chars = 0, maxLvl = 1, maxWave = 0, shops = 0, spent = 0, bossRounds = 0, specials = 0, shortTells = 0, sawDrop = false, errors = 0, hpGrows = true;
  for (let r = 0; r < RUNS; r++) {
    A.startSurvival(); flushTimers(); A.players[0].ctrl = 'cpu'; A.players[0].skill = 'hard';   // a decent player
    let lastK = {}, round = 0;
    for (let f = 0; f < 60 * 60 * 25 && A.game.state !== 'over'; f++) {
      if (A.game.state === 'pick' && A.pickFor && !A.pickLock) A.choose(A.hand[0], null);
      if (A.game.state === 'shop') { shops++; const s0 = A.players[0].scrap; for (let i = 0; i < 5; i++) A.survBuy(i); spent += s0 - A.players[0].scrap; A.survNext(); }
      try { A.update(1 / 60) } catch (e) { if (errors++ < 2) console.error(e) }
      flushTimers();
      if (A.game.round !== round) { round = A.game.round; const e = A.players[1];
        const es = A.players.filter((p) => p.team === 1); maxWave = Math.max(maxWave, es.length);
        if (!es.some((q) => q.boss)) { const k = es.reduce((t, q) => t + q.cards.length + q.hpMul * 10, 0), kind = A.game.rkind;   // compare with the same kind of round (wave, swarm, twist, elite) a lap earlier
          if (lastK[kind] != null && k < lastK[kind] - 1) hpGrows = false; lastK[kind] = k } else bossRounds++;
        if (round === 5) check(A.players.some((p) => p.boss), 'round 5 should be a boss'); }
      if (A.drops.length) sawDrop = true;
      if (A.game.state === 'play' && A.game.dropOff !== 0) arenaOff++;   // the arena must be in place whenever the fight is on (after a lost life too)
      const b = A.players[1]; if (b.boss && b.bs) { b.bs._seen = true }
      if (b.boss && b.bs && b.bs.n && !b.bs._counted && A.game.state === 'over') {}
    }
    const me = A.players[0]; if (me.char) chars++; maxLvl = Math.max(maxLvl, me.lvl || 1);
    check(A.game.state === 'over', `run ${r + 1} should end`); reached.push(A.game.cleared || 0);
  }
  check(shops >= reached.reduce((a, b) => a + b, 0) - RUNS && shops > 0, `the shop should open after each cleared round (${shops} shops)`);
  check(spent > 0, 'scrap should be spent in the shop');
  check(!arenaOff, `the arena should be in place during play (${arenaOff} frames it was not)`);
  check(hpGrows, 'ordinary enemies should get tougher each round');
  check(sawDrop, 'power-up capsules should drop in Survival');
  check(chars === RUNS, 'every run should start with a character');
  check(maxLvl > 1, 'the hero should level up');
  check(maxWave >= 2, `waves should grow to several enemies (largest ${maxWave})`);
  // every boss, forced: its special happens, and only after its full warning
  const TELL = { snipe: 0.84, charge: 0.74, barrage: 0.99, phase: 0.69, fortress: 0.59 };
  for (let i = 0; i <= A.BOSSES.length; i++) {
    A.startSurvival(); flushTimers(); A.players[0].ctrl = 'cpu'; A.players[0].skill = 'hard';
    while (A.game.state === 'pick') { A.choose(A.hand[0], null); flushTimers() }
    A.game.bossOrder = [i % 5, 0, 1, 2, 3, 4]; A.survRound(i === A.BOSSES.length ? 25 : 5);
    const b = A.players.find((p) => p.boss); A.players[0].hp = A.players[0].s.maxHp = 1e6;
    for (let f = 0; f < 60 * 50 && b.alive; f++) { A.players[0].hp = 1e6; try { A.update(1 / 60) } catch (e) { if (errors++ < 2) console.error(e) } flushTimers(); if (A.game.state !== 'play' && A.game.state !== 'ready' && A.game.state !== 'pointEnd') break }
    const sp = b.boss.special === 'crown' ? 'snipe' : b.boss.special;
    check(b.bs.n > 0, `${b.boss.n} should use its special attack`);
    check(!(b.bs.minTell < (b.boss.special === 'crown' ? 0.59 : TELL[sp])), `${b.boss.n} should warn before its special (${b.bs.minTell && b.bs.minTell.toFixed(2)} s)`);
  }
  check(!errors, `no errors (${errors})`);
  check(A.wallet.survBest === Math.max(...reached), `the best round should be saved (${A.wallet.survBest} vs ${Math.max(...reached)})`);
  // normal CPU matches stay pure: nothing drops
  { A.startMatch('cpu'); flushTimers(); while (A.game.state === 'pick') { A.choose(A.hand[0], null); flushTimers() } A.game.state = 'play';
    let any = false; for (let i = 0; i < 60 * 40; i++) { A.update(1 / 60); flushTimers(); if (A.drops.length) any = true } check(!any, 'nothing should drop in a normal CPU match') }
  reached.sort((a, b) => a - b);
  console.log(JSON.stringify({ runs: RUNS, roundsReached: reached, median: reached[reached.length >> 1], bossRounds, maxLevel: maxLvl, biggestWave: maxWave, failures: fail.length }));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();

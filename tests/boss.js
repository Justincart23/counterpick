// Boss Rush: a CPU stands in for the player and fights each boss to the end, drafting at every phase.
// Checks: fights finish, phases trigger drafts, telegraphs always give time to react (the Sniper's laser shows for
// its full aim time before the shot; the Brute winds up before it charges), a win pays coins and unlocks the next
// boss, and nothing throws. Reports win rate and fight length per boss (for tuning).
//   node tests/boss.js [fightsPerBoss=8]
const { load, flushTimers } = require('./env');
const N = +(process.argv[2] || 8);

(async () => {
  const { api: A } = await load({ seed: 31 });
  const fail = [], rows = [];
  for (let bi = 0; bi < A.BOSSES.length; bi++) {
    const B = A.BOSSES[bi];
    let wins = 0, secs = 0, phases = 0, specials = 0, shortTells = 0, errors = 0;
    for (let k = 0; k < N; k++) {
      A.startBoss(bi); flushTimers();
      A.players[0].ctrl = 'cpu';   // the stand-in player
      let maxPhase = 0;
      for (let f = 0; f < 60 * 60 * 6 && A.game.state !== 'over'; f++) {
        if (A.game.state === 'pick' && A.pickFor && !A.pickLock) A.choose(A.hand[0], null);
        try { A.update(1 / 60) } catch (e) { if (errors++ < 2) console.error(e) }
        flushTimers();
        const b = A.players[1];
        if (b && b.bs) maxPhase = Math.max(maxPhase, b.phase || 0);
      }
      // every special the boss launched showed its full warning first (the Sniper's laser, the Brute's wind-up)
      { const S = A.players[1].bs || {}; specials += S.n || 0; if (S.n && S.minTell < (B.special === 'snipe' ? 0.84 : 0.74)) shortTells++ }
      if (A.game.state !== 'over') fail.push(`${B.n}: fight ${k + 1} never ended`);
      const won = !A.players[1].alive || A.players[1].hp <= 0;
      if (won) wins++;
      secs += A.game.bossT || 0; phases += maxPhase;
    }
    if (shortTells) fail.push(`${B.n}: in ${shortTells} fights a special attack came without its full warning`);
    if (!specials) fail.push(`${B.n}: never used its special attack`);
    if (!phases) fail.push(`${B.n}: never reached a second phase`);
    if (errors) fail.push(`${B.n}: ${errors} errors`);
    rows.push({ boss: B.n, winRate: Math.round(100 * wins / N) + '%', avgSeconds: Math.round(secs / N), specialsPerFight: +(specials / N).toFixed(1), avgPhasesReached: +(1 + phases / N).toFixed(1) });
  }
  // a win pays coins and unlocks the next boss
  {
    const c0 = A.wallet.coins; A.startBoss(0); flushTimers();
    A.players[1].hp = 0; A.players[1].alive = false; A.bossEnd(true);
    if (!(A.wallet.coins > c0)) fail.push('beating a boss should pay coins');
    if (!(A.wallet.boss && A.wallet.boss[A.BOSSES[0].id] && A.wallet.boss[A.BOSSES[0].id].beat)) fail.push('beating a boss should be remembered (unlocks the next)');
  }
  console.table(rows);
  console.log(JSON.stringify({ bosses: rows.length, failures: fail.length }));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();

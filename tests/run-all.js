// Runs every test as its own process (each loads a fresh copy of the game) and exits 1 if any fail.
//   node tests/run-all.js
const { spawnSync } = require('child_process');
const path = require('path');

const run = (file, ...args) => ({ name: [file, ...args].join(' '), args: [path.join(__dirname, file), ...args.map(String)] });
const withEnv = (t, env, tag) => ({ ...t, env, name: `${t.name} ${tag}` });
const suite = [
  run('card-art.js'),
  run('movement.js'),
  run('points.js'),
  run('combos.js'),
  run('stacking.js'),
  run('cpu-reach.js'),
  run('edge-save.js'),
  run('coins.js'),
  run('audio.js'),
  run('ceiling.js'),
  run('net.js'),
  run('net.js', 90, 45),   // a laggy, jittery cross-country link
  run('net.js', 40, 0, 'features'),   // every block/movement card and trick, both screens drawing
  run('net.js', 90, 45, 'features'),
  // 2% packet loss (home Wi-Fi): snapshots and inputs must never stall behind a lost packet
  withEnv(run('net.js'), { NET_LOSS: 2 }, 'loss2%'),
  withEnv(run('net.js', 90, 45), { NET_LOSS: 2 }, 'loss2%'),
  // real devices: 144 Hz screens with frame jitter; a 30 fps visitor with jitter and a 150 ms stall every few seconds
  withEnv(run('net.js'), { NET_REAL: 1, NET_HFPS: 144, NET_GFPS: 144, NET_FJIT: 1 }, '144Hz'),
  withEnv(run('net.js', 90, 45), { NET_REAL: 1, NET_GFPS: 30, NET_FJIT: 3, NET_HITCH: '150@5' }, '30fps+hitches'),
  run('turn.js'),
  run('survival.js', 6),   // Survival: a CPU stand-in plays whole runs
  run('coop.js'),   // Co-op Survival online: host and guest through a whole run
  run('coop.js', 90, 45),
  run('pads.js'),   // bounce pads never throw a fighter into the top edge
  run('rides.js'),   // crates push, fall and come back; rope drops fall, hurt and reset
  run('drops.js'),   // Boss Rush: a CPU stand-in fights each boss to the end
  // 4 seeds x 5 game-minutes of CPU vs CPU
  ...[1, 5150, 9001, 2026].map((seed) => run('audit.js', 300, seed)),
];

let failed = 0;
for (const t of suite) {
  const started = Date.now();
  const r = spawnSync(process.execPath, t.args, { encoding: 'utf8', env: { ...process.env, ...(t.env || {}) } });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${t.name.padEnd(28)} ${((Date.now() - started) / 1000).toFixed(1)}s  ${(r.stdout || '').trim()}`);
  if (!ok) console.log((r.stderr || '').trim().split('\n').slice(0, 8).map((l) => '      ' + l).join('\n'));
}
console.log(failed ? `\n${failed} of ${suite.length} failed` : `\nall ${suite.length} passed`);
process.exit(failed ? 1 : 0);

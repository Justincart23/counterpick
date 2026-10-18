// Runs every test as its own process (each loads a fresh copy of the game) and exits 1 if any fail.
//   node tests/run-all.js
const { spawnSync } = require('child_process');
const path = require('path');

const run = (file, ...args) => ({ name: [file, ...args].join(' '), args: [path.join(__dirname, file), ...args.map(String)] });
const suite = [
  run('card-art.js'),
  run('movement.js'),
  run('points.js'),
  run('combos.js'),
  run('stacking.js'),
  run('cpu-reach.js'),
  run('audio.js'),
  run('ceiling.js'),
  run('net.js'),
  run('net.js', 90, 45),   // a laggy, jittery cross-country link
  run('net.js', 40, 0, 'features'),   // every block/movement card and trick, both screens drawing
  run('net.js', 90, 45, 'features'),
  run('turn.js'),
  // 4 seeds x 5 game-minutes of CPU vs CPU
  ...[1, 5150, 9001, 2026].map((seed) => run('audit.js', 300, seed)),
];

let failed = 0;
for (const t of suite) {
  const started = Date.now();
  const r = spawnSync(process.execPath, t.args, { encoding: 'utf8' });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${t.name.padEnd(22)} ${((Date.now() - started) / 1000).toFixed(1)}s  ${(r.stdout || '').trim()}`);
  if (!ok) console.log((r.stderr || '').trim().split('\n').slice(0, 8).map((l) => '      ' + l).join('\n'));
}
console.log(failed ? `\n${failed} of ${suite.length} failed` : `\nall ${suite.length} passed`);
process.exit(failed ? 1 : 0);

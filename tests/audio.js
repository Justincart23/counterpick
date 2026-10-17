// Plays every sound effect into a mock Web Audio graph and checks each one schedules sound
// with valid parameters (exponential ramps to positive values, finite frequencies and gains).
//   node tests/audio.js
const fs = require('fs');
const { load, SOURCE } = require('./env');

const problems = [];
let started = 0;
class Param {
  setValueAtTime(v) { if (!Number.isFinite(v)) problems.push(`setValueAtTime(${v})`); return this }
  exponentialRampToValueAtTime(v, t) { if (!(v > 0) || !Number.isFinite(t)) problems.push(`exponentialRamp(${v}, ${t})`); return this }
  set value(v) { if (!Number.isFinite(v)) problems.push(`value=${v}`) }
  get value() { return 1 }
}
class Node {
  constructor() { for (const k of ['frequency', 'gain', 'Q', 'threshold', 'ratio', 'attack', 'release']) this[k] = new Param() }
  connect(n) { return n }
  start() { started++ }
  stop() {}
}
class MockAudioContext {
  static now = 0; // shared clock the test advances between effects
  constructor() { this.sampleRate = 44100; this.destination = new Node() }
  get currentTime() { return MockAudioContext.now }
  createOscillator() { return new Node() } createGain() { return new Node() } createBiquadFilter() { return new Node() }
  createDynamicsCompressor() { return new Node() } createWaveShaper() { return new Node() } createBufferSource() { return new Node() }
  createBuffer(c, n) { return { getChannelData: () => new Float32Array(n) } }
}

(async () => {
  const { api: A } = await load();
  globalThis.AudioContext = MockAudioContext;
  A.initAudio();
  A.game.bg = false;
  const keys = [...new Set([...fs.readFileSync(SOURCE, 'utf8').matchAll(/case'([a-z]+)':/g)].map((m) => m[1]))];
  const silent = [];
  for (const k of keys) {
    const before = started;
    MockAudioContext.now += 0.2; // step past the game's per-window voice cap before each effect
    A.sfx(k);
    if (started === before) silent.push(k);
  }
  console.log(JSON.stringify({ effects: keys.length, silent, invalidParams: problems.length }));
  if (problems.length) console.error(problems.slice(0, 10).join('\n'));
  process.exit(silent.length || problems.length ? 1 : 0);
})();

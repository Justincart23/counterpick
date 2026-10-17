// Live check of the relay fallback against the real public MQTT brokers (needs internet; not part of CI).
// For each broker: two clients connect, one subscribes, the other publishes 10 game-sized messages; reports delivery and delay.
//   node scripts/relay-smoke.js
const { load } = require('../tests/env');

(async () => {
  const { api } = await load({ realTime: true });
  const payload = JSON.stringify({ t: 's', pad: 'x'.repeat(2500) }); // about the size of a snapshot
  const results = [];
  for (const url of api.RELAY_BROKERS) {
    const a = new api.MiniMqtt(url), b = new api.MiniMqtt(url);
    const started = Date.now();
    try {
      await Promise.all([a.connect(8000), b.connect(8000)]);
      const topic = `cuued/v1/SMOKE/${Math.random().toString(36).slice(2, 10)}`;
      const got = [];
      a.subscribe(topic, (text) => { const m = JSON.parse(text); got.push(Date.now() - m.at) });
      await new Promise((r) => setTimeout(r, 700)); // let the subscription settle
      for (let i = 0; i < 10; i++) { b.publish(topic, JSON.stringify({ at: Date.now(), body: payload })); await new Promise((r) => setTimeout(r, 50)) }
      await new Promise((r) => setTimeout(r, 2500));
      got.sort((x, y) => x - y);
      results.push({ broker: url, connectMs: Date.now() - started, delivered: `${got.length}/10`, medianOneWayMs: got.length ? got[Math.floor(got.length / 2)] : null });
    } catch (e) {
      results.push({ broker: url, error: e.message });
    } finally { a.close(); b.close() }
  }
  console.table(results);
  process.exit(results.some((r) => r.delivered === '10/10') ? 0 : 1);
})();

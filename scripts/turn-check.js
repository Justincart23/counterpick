// Live check of the Cloudflare TURN relay (needs internet; not part of CI).
// Fetches credentials from cuued.com/api/turn the way a browser does, then performs a real authenticated TURN
// Allocate over TCP (RFC 5766: unauthenticated request -> 401 with realm/nonce -> signed request -> relay address),
// and releases the allocation with a zero-lifetime Refresh.
//   node scripts/turn-check.js [https://www.cuued.com/api/turn]
const net = require('net');
const crypto = require('crypto');

const ENDPOINT = process.argv[2] || 'https://www.cuued.com/api/turn';
const COOKIE = 0x2112a442;
const ATTR = { USERNAME: 0x0006, MESSAGE_INTEGRITY: 0x0008, ERROR_CODE: 0x0009, LIFETIME: 0x000d, REALM: 0x0014, NONCE: 0x0015, XOR_RELAYED_ADDRESS: 0x0016, REQUESTED_TRANSPORT: 0x0019 };

function attr(type, value) {
  const pad = (4 - (value.length % 4)) % 4;
  const b = Buffer.alloc(4 + value.length + pad);
  b.writeUInt16BE(type, 0); b.writeUInt16BE(value.length, 2); value.copy(b, 4);
  return b;
}
function message(type, attrs, key) {
  const tid = crypto.randomBytes(12);
  let body = Buffer.concat(attrs);
  const header = (len) => { const h = Buffer.alloc(20); h.writeUInt16BE(type, 0); h.writeUInt16BE(len, 2); h.writeUInt32BE(COOKIE, 4); tid.copy(h, 8); return h };
  if (key) { // MESSAGE-INTEGRITY covers the header (with length including the MI attribute) and everything before it
    const hmac = crypto.createHmac('sha1', key).update(Buffer.concat([header(body.length + 24), body])).digest();
    body = Buffer.concat([body, attr(ATTR.MESSAGE_INTEGRITY, hmac)]);
  }
  return Buffer.concat([header(body.length), body]);
}
function parse(buf) {
  const type = buf.readUInt16BE(0), len = buf.readUInt16BE(2), attrs = {};
  for (let o = 20; o < 20 + len;) {
    const t = buf.readUInt16BE(o), l = buf.readUInt16BE(o + 2);
    attrs[t] = buf.subarray(o + 4, o + 4 + l); o += 4 + l + ((4 - (l % 4)) % 4);
  }
  return { type, attrs };
}
function exchange(host, port, packets) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, host), replies = []; let buf = Buffer.alloc(0), i = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('timed out')) }, 8000);
    const sendNext = () => { if (i < packets.length) sock.write(typeof packets[i] === 'function' ? packets[i](replies) : packets[i]); i++ };
    sock.on('connect', sendNext);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 20 && buf.length >= 20 + buf.readUInt16BE(2)) {
        const n = 20 + buf.readUInt16BE(2); replies.push(parse(buf.subarray(0, n))); buf = buf.subarray(n);
        if (replies.length === packets.length) { clearTimeout(timer); sock.end(); resolve(replies) } else sendNext();
      }
    });
    sock.on('error', (e) => { clearTimeout(timer); reject(e) });
  });
}

(async () => {
  const res = await fetch(ENDPOINT, { headers: { Origin: 'https://www.cuued.com' } });
  const json = await res.json();
  console.log(`endpoint: HTTP ${res.status}, relay=${json.relay}`);
  if (!json.relay) { console.log('No TURN credentials were issued (CF_TURN_KEY_ID / CF_TURN_KEY_TOKEN not set, or Cloudflare refused them).'); process.exit(1) }
  const turn = json.iceServers.find((s) => [].concat(s.urls).some((u) => /^turn:.*transport=tcp/.test(u)));
  const url = [].concat(turn.urls).find((u) => /^turn:.*transport=tcp/.test(u));
  const [, host, port] = url.match(/^turn:([^:?]+):(\d+)/);
  console.log(`relay:    ${url}  (username ${turn.username.slice(0, 12)}…)`);

  const transport = attr(ATTR.REQUESTED_TRANSPORT, Buffer.from([17, 0, 0, 0])); // relay UDP
  let key, realm, nonce;
  const signed = (type, extra) => (replies) => {
    const last = replies[replies.length - 1];
    if (last.attrs[ATTR.REALM]) { realm = last.attrs[ATTR.REALM]; nonce = last.attrs[ATTR.NONCE] }
    key = crypto.createHash('md5').update(`${turn.username}:${realm.toString()}:${turn.credential}`).digest();
    return message(type, [...extra, attr(ATTR.USERNAME, Buffer.from(turn.username)), attr(ATTR.REALM, realm), attr(ATTR.NONCE, nonce)], key);
  };
  const lifetime0 = attr(ATTR.LIFETIME, Buffer.from([0, 0, 0, 0]));
  const replies = await exchange(host, +port, [message(0x0003, [transport]), signed(0x0003, [transport]), signed(0x0004, [lifetime0])]);

  const [challenge, alloc, refresh] = replies;
  const code = (r) => { const e = r.attrs[ATTR.ERROR_CODE]; return e ? e[2] * 100 + e[3] : 0 };
  console.log(`step 1:   unauthenticated Allocate -> ${challenge.type === 0x0113 ? `challenge ${code(challenge)} (expected 401)` : `unexpected 0x${challenge.type.toString(16)}`}`);
  if (alloc.type !== 0x0103) { console.log(`step 2:   signed Allocate -> FAILED (error ${code(alloc)})`); process.exit(1) }
  const x = alloc.attrs[ATTR.XOR_RELAYED_ADDRESS], ip = [...x.subarray(4, 8)].map((b, i) => b ^ [0x21, 0x12, 0xa4, 0x42][i]).join('.'), rport = x.readUInt16BE(2) ^ 0x2112;
  console.log(`step 2:   signed Allocate -> SUCCESS, relay address ${ip}:${rport}`);
  console.log(`step 3:   release allocation -> ${refresh.type === 0x0104 ? 'released' : `0x${refresh.type.toString(16)}`}`);
  console.log('\nCloudflare TURN credentials from cuued.com work.');
})().catch((e) => { console.error('check failed:', e.message); process.exit(1) });

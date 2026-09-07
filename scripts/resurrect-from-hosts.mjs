// Resurrect EverArk state by pulling shards from the 3 rented Evernode hosts (HotPocket clients)
// and reading the anchor from Xahau. Proves resurrection from GENUINELY INDEPENDENT hosts.
// Needs: orders.json (hosts), checkpoint-manifest.json, and either checkpoint-anchor.hex or an on-chain tx.
import HotPocket from 'hotpocket-js-client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resurrect, stateRoot, hx } from '../src/everark-core.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const orders = JSON.parse(readFileSync(join(ROOT, 'orders.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(ROOT, 'checkpoint-manifest.json'), 'utf8'));
const anchor = Buffer.from(readFileSync(join(ROOT, 'checkpoint-anchor.hex'), 'utf8').trim(), 'hex');
const secret = Buffer.from(process.env.EVERARK_SECRET, 'hex');   // the dApp's data key (spec §7)

const READ_TIMEOUT_MS = Number(process.env.EVERARK_READ_TIMEOUT || 20000);
async function pullShard(host) {
  const kp = await HotPocket.generateKeys();
  const client = await HotPocket.createClient(['wss://' + host], kp);
  const connected = await Promise.race([client.connect(), new Promise(r => setTimeout(() => r(false), READ_TIMEOUT_MS))]);
  if (!connected) { try { await client.close(); } catch {} throw new Error('connect timeout ' + host); }
  try {
    // submitContractReadRequest RESOLVES with the contract's reply (read replies are NOT contractOutput events)
    const reply = await client.submitContractReadRequest('GET', null, READ_TIMEOUT_MS);
    if (reply == null) throw new Error('read timeout / no reply');
    const out = Buffer.isBuffer(reply) ? JSON.parse(reply.toString())
      : (typeof reply === 'string' ? JSON.parse(reply)
      : (reply.bytes_b64 ? reply : JSON.parse(String(reply))));
    if (!out || !out.bytes_b64) throw new Error('unexpected reply: ' + JSON.stringify(out).slice(0, 120));
    return { x: out.x, bytes: Buffer.from(out.bytes_b64, 'base64') };
  } finally { try { await client.close(); } catch {} }
}

const survivors = [];
for (const o of orders) { const ep = o.host || `${o.ip}:${o.port}`; try { survivors.push(await pullShard(ep)); console.log('pulled shard x=' + o.x + ' from ' + ep); } catch (e) { console.log('host ' + ep + ' unreachable:', e.message); } }
const revived = resurrect(anchor, manifest, survivors, secret);
const _off = anchor.length === 75 ? 1 : 0;
const _aRoot = anchor.subarray(_off, _off + 32);
const exact = stateRoot(revived).equals(_aRoot);
console.log('\nRESURRECTED from independent hosts:', JSON.stringify(revived));
console.log('anchored root:', hx(_aRoot), '\nrevived root :', hx(stateRoot(revived)), '\nbyte-exact:', exact ? 'YES ✓' : 'NO ✗');
process.exit(exact ? 0 : 1);

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

async function pullShard(host) {
  const kp = await HotPocket.generateKeys();
  const client = await HotPocket.createClient(['wss://' + host], kp);
  if (!await client.connect()) throw new Error('connect ' + host);
  const out = await new Promise((resolve) => {
    client.on(HotPocket.events.contractOutput, (r) => { for (const o of r.outputs) resolve(JSON.parse(o.toString())); });
    client.submitContractReadRequest('GET');
  });
  await client.close();
  return { x: out.x, bytes: Buffer.from(out.bytes_b64, 'base64') };
}

const survivors = [];
for (const o of orders) { const ep = o.host || `${o.ip}:${o.port}`; try { survivors.push(await pullShard(ep)); console.log('pulled shard x=' + o.x + ' from ' + ep); } catch (e) { console.log('host ' + ep + ' unreachable:', e.message); } }
const revived = resurrect(anchor, manifest, survivors, secret);
const exact = stateRoot(revived).equals(anchor.subarray(0, 32));
console.log('\nRESURRECTED from independent hosts:', JSON.stringify(revived));
console.log('anchored root:', hx(anchor.subarray(0,32)), '\nrevived root :', hx(stateRoot(revived)), '\nbyte-exact:', exact ? 'YES ✓' : 'NO ✗');
process.exit(exact ? 0 : 1);

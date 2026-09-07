// EverArk shard deploy: checkpoint a dApp, anchor on-chain, then deploy shard_i to rented host_i.
// Requires the 3 rented hosts (from everhostx /buy) in orders.json:
//   [{ "ip":"1.2.3.4", "port":26230, "instancePubKey":"ed...", "userPrivKey":"...", "x":1 }, ...]  (x = which shard)
// Payment for the leases is done by Dane in Xaman (RLUSD on XRPL mainnet) — see RENTING.md.
// This script: builds shard.json per host, bundles the shardstore contract, and deploys via evdevkit.
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { checkpoint, hx } from '../src/everark-core.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const orders = JSON.parse(readFileSync(join(ROOT, 'orders.json'), 'utf8'));   // the 3 rented hosts
if (orders.length < 3) throw new Error('need >= 3 rented hosts in orders.json');

// 1. checkpoint (in production the dApp state + secret are the real ones; here a demo state)
const dapp = JSON.parse(process.env.EVERARK_STATE || '{"name":"vivarium","epoch":8,"motto":"a contract that cannot die"}');
const secret = process.env.EVERARK_SECRET ? Buffer.from(process.env.EVERARK_SECRET, 'hex') : randomBytes(32);
const K = Number(process.env.EVERARK_K || 3), N = orders.length;
const { anchor, manifest, shards } = checkpoint(dapp, secret, K, N, dapp.epoch);
writeFileSync(join(ROOT, 'checkpoint-anchor.hex'), anchor.toString('hex'));
writeFileSync(join(ROOT, 'checkpoint-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`checkpoint: anchor ${anchor.length}B root ${hx(anchor.subarray(0,32)).slice(0,16)}…, ${N} shards, any ${K} recover`);
console.log('ANCHOR THIS ON-CHAIN (Xaman AccountSet memo, or scripts/live-resurrect anchor step):', anchor.toString('hex').toUpperCase());

// 2. per host: write its shard.json, bundle, deploy
for (const o of orders) {
  const s = shards.find(sh => sh.x === o.x); if (!s) throw new Error('no shard for x=' + o.x);
  const dir = mkdtempSync(join(tmpdir(), 'ea-host-'));
  cpSync(join(ROOT, 'host-contract'), dir, { recursive: true });
  writeFileSync(join(dir, 'shard.json'), JSON.stringify({ x: s.x, bytes_b64: s.bytes.toString('base64'),
    digest: hx(createHash('sha256').update(Buffer.concat([Buffer.from([s.x]), s.bytes])).digest()) }));
  console.log(`\nhost ${o.ip}:${o.port} <- shard x=${o.x} (${s.bytes.length}B)`);
  // Real evdevkit CLI: bundle(contract-dir, instance-pubkey, bin) -> deploy(bundle, ip, port) with EV_USER_PRIVATE_KEY.
  try {
    // bin_path MUST be the node executable (/usr/bin/node); the script is a contract-arg. Passing the .js as
    // the contract-bin makes HotPocket try to exec the script directly -> BinaryNotFound / contract never runs.
    const bundleOut = execFileSync('evdevkit', ['bundle', dir, o.instancePubKey, '/usr/bin/node', '-a', 'shardstore.js'], { encoding: 'utf8' });
    const clean = bundleOut.replace(/\x1b\[[0-9;]*m/g, '');
    const bundlePath = (clean.match(/location:\s*(\S+\.zip)/) || clean.match(/(\/\S+\.(?:zip|tar\S*|bundle))/) || [])[1];
    if (!bundlePath) throw new Error('could not find bundle path in: ' + clean.trim().split('\n').slice(-1)[0]);
    const out = execFileSync('evdevkit', ['deploy', bundlePath, o.ip, String(o.port)], { encoding: 'utf8', env: { ...process.env, EV_USER_PRIVATE_KEY: o.userPrivKey } });
    const line = out.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').filter(Boolean).slice(-2).join(' | ');
    console.log('  deployed:', line);
  } catch (e) { console.log('  DEPLOY FAILED:', (e.stdout || e.message || '').replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').slice(-2).join(' | ')); }
}
console.log('\nNext: anchor the printed hex on-chain, then scripts/resurrect-from-hosts.mjs reads shards from the 3 hosts + anchor from chain.');

// EverArk showpiece: checkpoint a dApp, DELETE everything, resurrect it byte-exact from
// k shards + the on-chain anchor. Shards are written as files to simulate independent hosts.
// (Live version: shards live on independent Evernode hosts; anchor is a Xahau Hook State write.)
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { checkpoint, resurrect, stateRoot, hx } from '../src/everark-core.mjs';

const DIR = '/tmp/everark-demo';
rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR + '/hosts', { recursive: true });
const rootOf = (a) => a.length === 75 ? a.subarray(1, 33) : a.subarray(0, 32);  // v1 has a leading version byte

// 1. a living dApp with real state
const dapp = { name: 'vivarium', epoch: 42, organisms: [{ id: 'a', hp: 20 }, { id: 'b', hp: 7 }], ledger: 106790078, motto: 'a contract that cannot die' };
const secret = randomBytes(32);                              // (live: threshold-split across hosts)
const K = 3, N = 6;
console.log('LIVE dApp state:', JSON.stringify(dapp));

// 2. checkpoint -> anchor (goes on Xahau) + shards (go to independent hosts)
const { anchor, manifest, shards } = checkpoint(dapp, secret, K, N, dapp.epoch);
writeFileSync(DIR + '/anchor.bin', anchor);                 // simulates the 74/75-byte Xahau Hook State write
writeFileSync(DIR + '/manifest.json', JSON.stringify(manifest));
for (const s of shards) writeFileSync(`${DIR}/hosts/host-${s.x}.shard`, s.bytes);
console.log(`\nCHECKPOINT epoch ${dapp.epoch}: anchor ${anchor.length}B (root ${hx(rootOf(anchor)).slice(0,16)}…), ${N} shards to ${N} hosts, any ${K} recover`);

// 3. TOTAL DEATH — the live state is gone, and we destroy all but k hosts
const liveGone = null;                                      // every instance died
const kill = [1, 2, 5];                                     // destroy 3 of 6 hosts (n-k = 3 losses tolerated)
for (const x of kill) rmSync(`${DIR}/hosts/host-${x}.shard`);
console.log(`\nTOTAL DEATH: all instances gone; hosts ${kill.join(', ')} destroyed. Surviving hosts: ${readdirSync(DIR+'/hosts').join(', ')}`);
console.log('live state now:', liveGone);

// 4. RESURRECT from Xahau anchor + whatever shards survive
const survivors = readdirSync(DIR + '/hosts').map(f => ({ x: Number(f.match(/host-(\d+)/)[1]), bytes: readFileSync(`${DIR}/hosts/${f}`) }));
const anchorOnChain = readFileSync(DIR + '/anchor.bin');
const manifestBack = JSON.parse(readFileSync(DIR + '/manifest.json', 'utf8'));
const revived = resurrect(anchorOnChain, manifestBack, survivors, secret);

// 5. prove byte-exact
const exact = stateRoot(revived).equals(stateRoot(dapp));  // compare canonical roots, not key order
console.log('\nRESURRECTED state:', JSON.stringify(revived));
console.log('\n--- evidence ---');
console.log('anchored state root :', hx(rootOf(anchorOnChain)));
console.log('revived state root  :', hx(stateRoot(revived)));
console.log('byte-exact match    :', exact ? 'YES ✓  the contract came back from the dead' : 'NO ✗');
process.exit(exact ? 0 : 1);

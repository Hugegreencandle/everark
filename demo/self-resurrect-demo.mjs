// EverArk #9 showpiece: a contract that checkpoints ITSELF on a schedule and comes back from the dead
// ON ITS OWN after the host is wiped. No operator restores it — boot() resurrects it from custody.
//
// hostDisk = the instance's local storage (dies on redeploy). custody = the durable side (anchor sink +
// independent shard holders) that survives. Here both are filesystem dirs so the demo runs locally; the
// live version puts custody on-chain (SetRemarks anchor) + independent Evernode hosts.
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { boot, tick } from '../src/selfark.mjs';

const ROOT = '/tmp/everark-selfark';
const HOST = join(ROOT, 'host');       // wiped on "redeploy"
const CUST = join(ROOT, 'custody');    // survives (models chain + independent shard hosts)
rmSync(ROOT, { recursive: true, force: true });
mkdirSync(join(CUST, 'shards'), { recursive: true });
mkdirSync(HOST, { recursive: true });

// --- storage adapters ------------------------------------------------------
const hostDisk = (dir) => ({
  readState() { const f = join(dir, 'state.json'); if (!existsSync(f)) return null;
    const o = JSON.parse(readFileSync(f, 'utf8')); return { state: o.state, epoch: o.epoch }; },
  writeState(state, epoch) { writeFileSync(join(dir, 'state.json'), JSON.stringify({ state, epoch })); },
  clear() { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); },
});
const custody = {
  putAnchor(anchor, manifest) { writeFileSync(join(CUST, 'anchor.bin'), anchor);
    writeFileSync(join(CUST, 'manifest.json'), JSON.stringify(manifest)); },
  getAnchor() { const a = join(CUST, 'anchor.bin'); if (!existsSync(a)) return null;
    return { anchor: readFileSync(a), manifest: JSON.parse(readFileSync(join(CUST, 'manifest.json'), 'utf8')) }; },
  putShard(x, bytes) { writeFileSync(join(CUST, 'shards', `${x}.shard`), bytes); },
  getShard(x) { const f = join(CUST, 'shards', `${x}.shard`); return existsSync(f) ? readFileSync(f) : null; },
  listShards() { return readdirSync(join(CUST, 'shards')).map((f) => Number(f.replace('.shard', ''))); },
};

// The data key (spec #9 Q2): operator-supplied. NOT owned/derived by the contract — see spec.
const secret = process.env.EVERARK_SECRET ? Buffer.from(process.env.EVERARK_SECRET, 'hex') : randomBytes(32);

// how the contract's own state evolves each round (a stand-in for real app logic)
const advance = (state, epoch) => ({
  epoch: epoch + 1,
  state: { ...state, epoch: epoch + 1, hits: (state.hits || 0) + 1,
    log: [...(state.log || []), `round ${epoch + 1}`].slice(-4) },
});

// --- run -------------------------------------------------------------------
const hd = hostDisk(HOST);
// genesis: first boot has no custody yet, so seed initial state directly
const genesis = { name: 'selfark', epoch: 0, hits: 0, log: [], motto: 'a contract that checkpoints itself' };
hd.writeState(genesis, 0);
console.log('GENESIS state:', JSON.stringify(genesis));

console.log('\n--- running, self-checkpointing every 5 rounds ---');
let last;
for (let i = 0; i < 12; i++) {
  const r = tick(hd, custody, secret, advance, { every: 5, k: 3, n: 6 });
  last = r;
  if (r.checkpointed) console.log(`round ${r.epoch}: SELF-CHECKPOINT -> custody (root ${r.root.slice(0, 16)}…, 6 shards, any 3 recover)`);
}
const before = hd.readState();
console.log('\nstate before death:', JSON.stringify(before.state));

// TOTAL DEATH: wipe the host entirely, and destroy 3 of 6 shard holders (n-k tolerated).
hd.clear();
for (const x of [1, 2, 5]) rmSync(join(CUST, 'shards', `${x}.shard`), { force: true });
console.log('\nTOTAL DEATH: host wiped; shard holders 1,2,5 destroyed. Surviving shards:',
  custody.listShards().sort().join(', '), '| local state:', hostDisk(HOST).readState());

// REDEPLOY to a fresh host: boot() finds no local state and resurrects the contract from custody ITSELF.
console.log('\n--- redeploy to a fresh host: boot() ---');
const booted = boot(hostDisk(HOST), custody, secret);
console.log('boot source:', booted.source, '(resurrected = it rebuilt itself, no operator restore)');
console.log('resurrected state:', JSON.stringify(booted.state));

// evidence: the resurrected state equals the last self-checkpoint (epoch 10), byte-exact.
import { stateRoot, hx } from '../src/everark-core.mjs';
const anchoredRoot = hx((custody.getAnchor().anchor).subarray(1, 33));
const revivedRoot = hx(stateRoot(booted.state));
const exact = anchoredRoot === revivedRoot;
console.log('\n--- evidence ---');
console.log('anchored root (epoch ' + booted.epoch + '):', anchoredRoot);
console.log('revived root                 :', revivedRoot);
console.log('byte-exact match             :', exact ? 'YES ✓  the contract resurrected itself' : 'NO ✗');
process.exit(exact ? 0 : 1);

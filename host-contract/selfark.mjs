// EverArk #9 — self-checkpointing HotPocket contract (deploy skeleton).
// Wraps src/selfark.mjs into a HotPocket contract: it resurrects itself on a fresh boot and
// self-checkpoints on a round cadence. Deploy with bin_path /usr/bin/node -a selfark.mjs.
//
// SCOPE / HONESTY — this is the contract SHAPE with the engine wired in. Two pieces need the live
// cluster and are marked TODO; do not read this as a finished ownerless deployment:
//   TODO(Q1) custody must live OFF this host or it dies with it. The stub below writes shards to the
//            contract's own local dir (fine for a single-host smoke test, USELESS for real durability).
//            Production: push shard_i to independent Evernode hosts (see scripts/deploy-shards.mjs) and
//            write the anchor on-chain (scripts/anchor-remark.mjs) via an external anchorer / emitted txn.
//   TODO(Q2) the data key is read from the environment (operator-supplied). A truly ownerless contract
//            cannot hold its key in plaintext on the host; key custody is unsolved (see spec, wojake steer).
import HotPocket from 'hotpocket-nodejs-contract';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { boot, tick } from '../src/selfark.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_DIR = join(HERE, 'state');            // host-local persistent storage (dies with the host)
const CUST_DIR = join(HERE, 'custody');           // TODO(Q1): must be OFF-host in production
mkdirSync(join(CUST_DIR, 'shards'), { recursive: true });
mkdirSync(STATE_DIR, { recursive: true });

const hostDisk = {
  readState() { const f = join(STATE_DIR, 'state.json'); if (!existsSync(f)) return null;
    const o = JSON.parse(readFileSync(f, 'utf8')); return { state: o.state, epoch: o.epoch }; },
  writeState(state, epoch) { writeFileSync(join(STATE_DIR, 'state.json'), JSON.stringify({ state, epoch })); },
  clear() { rmSync(STATE_DIR, { recursive: true, force: true }); mkdirSync(STATE_DIR, { recursive: true }); },
};
const custody = {                                  // TODO(Q1): replace with on-chain anchor + independent hosts
  putAnchor(a, m) { writeFileSync(join(CUST_DIR, 'anchor.bin'), a); writeFileSync(join(CUST_DIR, 'manifest.json'), JSON.stringify(m)); },
  getAnchor() { const a = join(CUST_DIR, 'anchor.bin'); if (!existsSync(a)) return null;
    return { anchor: readFileSync(a), manifest: JSON.parse(readFileSync(join(CUST_DIR, 'manifest.json'), 'utf8')) }; },
  putShard(x, b) { writeFileSync(join(CUST_DIR, 'shards', `${x}.shard`), b); },
  getShard(x) { const f = join(CUST_DIR, 'shards', `${x}.shard`); return existsSync(f) ? readFileSync(f) : null; },
  listShards() { return readdirSync(join(CUST_DIR, 'shards')).map((f) => Number(f.replace('.shard', ''))); },
};
const secret = process.env.EVERARK_SECRET ? Buffer.from(process.env.EVERARK_SECRET, 'hex') : randomBytes(32);
const advance = (state, epoch) => ({ epoch: epoch + 1, state: { ...state, epoch: epoch + 1, rounds: (state.rounds || 0) + 1 } });

let bootstrapped = false;
async function contract(ctx) {
  // First round after a (re)deploy: resume from disk, or resurrect self from custody. If custody is
  // also empty (true genesis), seed initial state.
  if (!bootstrapped) {
    try {
      const b = boot(hostDisk, custody, secret);
      ctx.log?.(`selfark boot: ${b.source} @ epoch ${b.epoch}`);
    } catch {
      hostDisk.writeState({ name: 'selfark', epoch: 0, rounds: 0, motto: 'a contract that checkpoints itself' }, 0);
      ctx.log?.('selfark boot: genesis');
    }
    bootstrapped = true;
  }
  // Advance one step and self-checkpoint on the cadence.
  const r = tick(hostDisk, custody, secret, advance, { every: 5, k: 3, n: 6 });
  if (r.checkpointed) ctx.log?.(`selfark self-checkpoint @ epoch ${r.epoch} root ${r.root.slice(0, 16)}…`);

  // Serve current state on a read request (so a client can watch it resurrect).
  for (const user of ctx.users.list()) {
    for (const input of user.inputs) {
      await ctx.users.read(input);
      await user.send(JSON.stringify(hostDisk.readState()));
    }
  }
}
const hpc = new HotPocket.Contract();
hpc.init(contract);

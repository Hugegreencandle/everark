// EverArk #9 — self-checkpointing engine.
// A contract that checkpoints its OWN state on a schedule and resurrects ITSELF on a fresh boot.
// Framework-agnostic so it can be unit-tested and wrapped by HotPocket (see host-contract/selfark.js).
//
// Two storage surfaces, deliberately separate:
//   - hostDisk  : the instance's local persistent storage. DIES when the host dies / on redeploy.
//   - custody   : the durable side — the anchor sink (on-chain) + shard holders (independent hosts).
//                 SURVIVES host loss (that's the whole point). Any k of n shards + the anchor rebuild it.
//
// Key custody (spec #9 Q2) is UNSOLVED for a truly ownerless contract: the data `secret` here is supplied
// by the operator, not derived by the contract. See the spec; wojake (DKM author) warns key custody must
// not be treated lightly and DKM itself should not be used as-is. This engine takes the secret as a
// parameter and does not invent a key scheme.
import { checkpoint, resurrect, stateRoot, hx } from './everark-core.mjs';

const rootOf = (a) => (a.length === 75 ? a.subarray(1, 33) : a.subarray(0, 32));

// hostDisk: { readState(): {state,epoch}|null, writeState(state,epoch): void, clear(): void }
// custody:  { putAnchor(anchorBuf, manifest): void, getAnchor(): {anchor,manifest}|null,
//             putShard(x, bytesBuf): void, getShard(x): Buffer|null, listShards(): number[] }

// Checkpoint the contract's own state into custody (anchor on-chain + shards to holders).
export function checkpointSelf(state, custody, secret, { k = 3, n = 6, epoch } = {}) {
  // version 2 = deterministic AEAD, so every node in the replicated cluster produces the identical anchor.
  const { anchor, manifest, shards } = checkpoint(state, secret, k, n, epoch, { version: 2 });
  custody.putAnchor(anchor, manifest);
  for (const s of shards) custody.putShard(s.x, s.bytes);
  return { anchor, manifest, root: hx(rootOf(anchor)) };
}

// Rebuild the contract's state from custody. Fail-closed: throws if the anchor is missing, too few shards
// survive, or the rebuilt root does not equal the anchored root.
export function resurrectSelf(custody, secret) {
  const a = custody.getAnchor();
  if (!a) throw new Error('no anchor in custody — cannot resurrect');
  const { anchor, manifest } = a;
  const available = custody.listShards().map((x) => ({ x, bytes: custody.getShard(x) })).filter((s) => s.bytes);
  const revived = resurrect(anchor, manifest, available, secret);   // resurrect() itself enforces k-of-n
  const aRoot = rootOf(anchor);
  if (!stateRoot(revived).equals(aRoot)) {
    throw new Error(`resurrect root mismatch: ${hx(stateRoot(revived))} != anchored ${hx(aRoot)}`);
  }
  return { state: revived, epoch: manifest.epoch, root: hx(aRoot) };
}

// Boot: resume from local disk if present; otherwise resurrect self from custody and adopt it.
// Returns { state, epoch, source: 'disk' | 'resurrected' }.
export function boot(hostDisk, custody, secret) {
  const local = hostDisk.readState();
  if (local) return { state: local.state, epoch: local.epoch, source: 'disk' };
  const { state, epoch } = resurrectSelf(custody, secret);
  hostDisk.writeState(state, epoch);
  return { state, epoch, source: 'resurrected' };
}

// One scheduler step. `advance(state, epoch)` mutates and returns the next {state, epoch}. When
// (epoch % every === 0) the new state is self-checkpointed into custody. Returns { state, epoch,
// checkpointed, root? }.
export function tick(hostDisk, custody, secret, advance, { every = 5, k = 3, n = 6 } = {}) {
  const cur = hostDisk.readState();
  if (!cur) throw new Error('tick before boot — no local state');
  const next = advance(cur.state, cur.epoch);
  hostDisk.writeState(next.state, next.epoch);
  let checkpointed = false, root;
  if (next.epoch % every === 0) {
    ({ root } = checkpointSelf(next.state, custody, secret, { k, n, epoch: next.epoch }));
    checkpointed = true;
  }
  return { state: next.state, epoch: next.epoch, checkpointed, root };
}

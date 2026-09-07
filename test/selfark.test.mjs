// Tests for the #9 self-checkpointing engine (src/selfark.mjs). In-memory hostDisk + custody.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { boot, tick, checkpointSelf, resurrectSelf } from '../src/selfark.mjs';
import { stateRoot } from '../src/everark-core.mjs';

const memDisk = () => { let s = null; return {
  readState() { return s ? { state: structuredClone(s.state), epoch: s.epoch } : null; },
  writeState(state, epoch) { s = { state: structuredClone(state), epoch }; },
  clear() { s = null; },
}; };
const memCustody = () => { let anchor = null, manifest = null; const shards = new Map(); return {
  putAnchor(a, m) { anchor = Buffer.from(a); manifest = m; },
  getAnchor() { return anchor ? { anchor, manifest } : null; },
  putShard(x, b) { shards.set(x, Buffer.from(b)); },
  getShard(x) { return shards.get(x) || null; },
  listShards() { return [...shards.keys()]; },
  _killShards(xs) { for (const x of xs) shards.delete(x); },
}; };

const SECRET = randomBytes(32);
const S = () => ({ name: 'selfark', epoch: 7, hits: 3, log: ['a', 'b'] });

test('boot resumes from local disk without touching custody', () => {
  const hd = memDisk(); hd.writeState(S(), 7);
  const cust = memCustody();
  const b = boot(hd, cust, SECRET);
  assert.equal(b.source, 'disk');
  assert.equal(b.epoch, 7);
  assert.deepEqual(b.state, S());
});

test('checkpointSelf + resurrectSelf roundtrip byte-exact', () => {
  const cust = memCustody();
  checkpointSelf(S(), cust, SECRET, { k: 3, n: 6, epoch: 7 });
  const r = resurrectSelf(cust, SECRET);
  assert.ok(stateRoot(r.state).equals(stateRoot(S())));
  assert.equal(r.epoch, 7);
});

test('fresh host boots by resurrecting itself from custody', () => {
  const cust = memCustody();
  checkpointSelf(S(), cust, SECRET, { k: 3, n: 6, epoch: 7 });
  const hd = memDisk();                 // empty -> fresh host
  const b = boot(hd, cust, SECRET);
  assert.equal(b.source, 'resurrected');
  assert.ok(stateRoot(b.state).equals(stateRoot(S())));
  assert.ok(hd.readState(), 'boot writes resurrected state to disk');
});

test('resurrect survives losing n-k shards (any k of n)', () => {
  const cust = memCustody();
  checkpointSelf(S(), cust, SECRET, { k: 3, n: 6, epoch: 7 });
  cust._killShards([1, 2, 5]);          // 3 gone, 3 remain == k
  const r = resurrectSelf(cust, SECRET);
  assert.ok(stateRoot(r.state).equals(stateRoot(S())));
});

test('fail-closed: fewer than k shards -> throws, never a wrong state', () => {
  const cust = memCustody();
  checkpointSelf(S(), cust, SECRET, { k: 3, n: 6, epoch: 7 });
  cust._killShards([1, 2, 5, 6]);       // only 2 remain < k=3
  assert.throws(() => resurrectSelf(cust, SECRET));
});

test('fail-closed: wrong secret -> throws, never a wrong state', () => {
  const cust = memCustody();
  checkpointSelf(S(), cust, SECRET, { k: 3, n: 6, epoch: 7 });
  assert.throws(() => resurrectSelf(cust, randomBytes(32)));
});

test('fail-closed: no anchor -> throws', () => {
  assert.throws(() => resurrectSelf(memCustody(), SECRET));
});

test('tick self-checkpoints only on the cadence', () => {
  const hd = memDisk(); hd.writeState({ epoch: 0, hits: 0 }, 0);
  const cust = memCustody();
  const advance = (state, epoch) => ({ epoch: epoch + 1, state: { ...state, epoch: epoch + 1, hits: state.hits + 1 } });
  const checkpointedAt = [];
  for (let i = 0; i < 10; i++) { const r = tick(hd, cust, SECRET, advance, { every: 5 }); if (r.checkpointed) checkpointedAt.push(r.epoch); }
  assert.deepEqual(checkpointedAt, [5, 10]);
});

test('resurrect yields the last checkpoint, not post-checkpoint state (loss window)', () => {
  const hd = memDisk(); hd.writeState({ epoch: 0, hits: 0 }, 0);
  const cust = memCustody();
  const advance = (state, epoch) => ({ epoch: epoch + 1, state: { ...state, epoch: epoch + 1, hits: state.hits + 1 } });
  for (let i = 0; i < 7; i++) tick(hd, cust, SECRET, advance, { every: 5 });   // ran to epoch 7, last cp at 5
  hd.clear();
  const b = boot(hd, cust, SECRET);
  assert.equal(b.epoch, 5);              // recovers to epoch 5, the 2 rounds since are lost — documented
});

// ADVERSARIAL: inject a valid shard from a DIFFERENT checkpoint into custody. The manifest+anchor
// binding must reject it (fail-closed), never rebuild a Frankenstein state.
test('hostile: a shard from another checkpoint is rejected, not blended', () => {
  const cust = memCustody();
  checkpointSelf(S(), cust, SECRET, { k: 3, n: 6, epoch: 7 });         // the real checkpoint
  // build a second, different checkpoint with the same k/n and steal one of its shards
  const other = memCustody();
  checkpointSelf({ name: 'evil', epoch: 999, hits: 42 }, other, SECRET, { k: 3, n: 6, epoch: 999 });
  cust.putShard(3, other.getShard(3));                                  // overwrite shard 3 with a foreign one
  // resurrect must either throw or still produce the ORIGINAL state — never the evil one.
  let out = null; try { out = resurrectSelf(cust, SECRET); } catch { out = 'threw'; }
  if (out !== 'threw') assert.ok(stateRoot(out.state).equals(stateRoot(S())), 'must not adopt foreign state');
});

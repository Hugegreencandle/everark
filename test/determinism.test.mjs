// Q5 — deterministic checkpoint (anchor v2, AES-256-GCM-SIV). A replicated cluster must produce a
// byte-identical anchor, or it can't agree what to write on-chain. These tests pin that property and
// confirm v0/v1 (random-nonce GCM) are untouched and v2 stays fail-closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { checkpoint, resurrect, stateRoot } from '../src/everark-core.mjs';

const KEY = createHash('sha256').update('cluster-shared-key').digest();
const STATE = () => ({ name: 'selfark', epoch: 42, hits: 42, log: ['r40', 'r41', 'r42'] });
const sh = (a) => Buffer.concat(a.map((s) => s.bytes));

test('v2 checkpoint is deterministic: same inputs -> identical anchor + shards', () => {
  const a = checkpoint(STATE(), KEY, 3, 6, 42, { version: 2 });
  const b = checkpoint(STATE(), KEY, 3, 6, 42, { version: 2 });
  assert.ok(a.anchor.equals(b.anchor), 'anchors identical');
  assert.ok(sh(a.shards).equals(sh(b.shards)), 'shard bytes identical');
  assert.equal(a.anchor[0], 2, 'v2 leading byte');
  assert.equal(a.anchor.length, 75);
});

test('v1 checkpoint is NON-deterministic (random nonce) — the contrast v2 fixes', () => {
  const a = checkpoint(STATE(), KEY, 3, 6, 42, { version: 1 });
  const b = checkpoint(STATE(), KEY, 3, 6, 42, { version: 1 });
  assert.ok(!a.anchor.equals(b.anchor), 'v1 anchors differ run-to-run');
});

test('v2 resurrects byte-exact from k of n', () => {
  const { anchor, manifest, shards } = checkpoint(STATE(), KEY, 3, 6, 42, { version: 2 });
  const revived = resurrect(anchor, manifest, shards.slice(0, 3), KEY);
  assert.ok(stateRoot(revived).equals(stateRoot(STATE())));
});

test('v2 fail-closed: wrong secret throws', () => {
  const { anchor, manifest, shards } = checkpoint(STATE(), KEY, 3, 6, 42, { version: 2 });
  assert.throws(() => resurrect(anchor, manifest, shards.slice(0, 3), createHash('sha256').update('x').digest()));
});

test('v2 fail-closed: a tampered shard is rejected', () => {
  const { anchor, manifest, shards } = checkpoint(STATE(), KEY, 3, 6, 42, { version: 2 });
  const bad = shards.slice(0, 3).map((s, i) => i === 0 ? { x: s.x, bytes: Buffer.from(s.bytes) } : s);
  bad[0].bytes[0] ^= 0xff;                                   // flip a byte
  assert.throws(() => resurrect(anchor, manifest, bad, KEY));
});

test('backward compat: v1 and v0 still checkpoint + resurrect', () => {
  for (const version of [0, 1]) {
    const { anchor, manifest, shards } = checkpoint(STATE(), KEY, 3, 6, 42, { version });
    const revived = resurrect(anchor, manifest, shards.slice(0, 3), KEY);
    assert.ok(stateRoot(revived).equals(stateRoot(STATE())), `v${version} roundtrip`);
    assert.equal(anchor.length, version === 0 ? 74 : 75);
  }
});

test('v2 nonce is bound to epoch: same state different epoch -> different cipher', () => {
  const a = checkpoint(STATE(), KEY, 3, 6, 42, { version: 2 });
  const b = checkpoint(STATE(), KEY, 3, 6, 43, { version: 2 });   // only epoch differs
  assert.ok(!sh(a.shards).equals(sh(b.shards)), 'different epoch => different ciphertext (nonce reuse avoided)');
});

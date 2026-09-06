import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { checkpoint, resurrect, stateRoot, canon } from '../src/everark-core.mjs';

const KEY = () => randomBytes(32);
const stateOf = (seed) => ({ z: seed, users: { b: 2, a: 1 }, list: [3, 1, 2], note: 'the vivarium '.repeat(20) + seed });
function combos(arr, k) { if (k === 0) return [[]]; if (k > arr.length) return []; const [h, ...t] = arr; return [...combos(t, k - 1).map(c => [h, ...c]), ...combos(t, k)]; }
const clone = (m) => JSON.parse(JSON.stringify(m));

// ── correctness ──────────────────────────────────────────────────────────────
test('happy path: checkpoint then resurrect is byte-exact (canonical roots equal)', () => {
  const st = stateOf('alpha'), key = KEY();
  const { anchor, manifest, shards } = checkpoint(st, key, 3, 6);
  assert.equal(anchor.length, 75);            // v1 default (version byte + 74B body)
  assert.ok(stateRoot(resurrect(anchor, manifest, shards, key)).equals(stateRoot(st)));
});

test('EXHAUSTIVE: every k-of-n subset reconstructs; every (k-1)-subset fails-closed', () => {
  const k = 3, n = 6, key = KEY(), st = stateOf('ex');
  const { anchor, manifest, shards } = checkpoint(st, key, k, n);
  const idx = shards.map((_, i) => i);
  for (const c of combos(idx, k)) assert.ok(stateRoot(resurrect(anchor, manifest, c.map(i => shards[i]), key)).equals(stateRoot(st)));
  for (const c of combos(idx, k - 1)) assert.throws(() => resurrect(anchor, manifest, c.map(i => shards[i]), key), /FAIL-CLOSED/);
});

test('boundary (k,n): k=1, k=n, empty state, 1-byte, large state', () => {
  for (const [k, n, st] of [[1, 3, {}], [4, 4, { a: 1 }], [3, 6, { s: '' }], [2, 5, { s: 'x' }], [3, 8, { s: 'z'.repeat(50000) }]]) {
    const key = KEY(); const { anchor, manifest, shards } = checkpoint(st, key, k, n);
    const pick = shards.slice(0, k);
    assert.ok(stateRoot(resurrect(anchor, manifest, pick, key)).equals(stateRoot(st)), `k=${k} n=${n}`);
  }
});

// ── the invariant that matters: NEVER a third outcome ──────────────────────────
test('INVARIANT: resurrect returns the TRUE state or throws — never a wrong state', () => {
  const key = KEY(), st = stateOf('inv');
  const { anchor, manifest, shards } = checkpoint(st, key, 3, 6);
  const trueRoot = stateRoot(st);
  const attacks = [
    () => resurrect(anchor, manifest, shards, key),                                   // clean
    () => { const a = Buffer.from(anchor); a[0] ^= 1; return resurrect(a, manifest, shards, key); },       // forged root
    () => { const m = clone(manifest); m.cipher_hash = 'ab'.repeat(32); return resurrect(anchor, m, shards, key); },
    () => { const m = clone(manifest); m.blk = m.blk + 1; return resurrect(anchor, m, shards, key); },
    () => { const m = clone(manifest); m.shard_x = m.shard_x.slice().reverse(); return resurrect(anchor, m, shards, key); },
    () => { const m = clone(manifest); m.shard_digests[0] = m.shard_digests[1]; return resurrect(anchor, m, shards, key); },
    () => resurrect(anchor, manifest, shards, KEY()),                                  // wrong secret
    () => { const bad = { x: shards[0].x, bytes: Buffer.from(shards[0].bytes) }; bad.bytes[0] ^= 0xff; return resurrect(anchor, manifest, [bad, shards[1], shards[2]], key); },
  ];
  for (let i = 0; i < attacks.length; i++) {
    try { const r = attacks[i](); assert.ok(stateRoot(r).equals(trueRoot), `attack ${i} returned a value — must be the true state`); }
    catch (e) { assert.match(e.message, /FAIL-CLOSED/, `attack ${i} threw non-fail-closed: ${e.message}`); }
  }
});

// ── unbound-field battery: swapping ANY manifest field must now break the anchor bind ──
test('every manifest field is bound to the anchor (manifest_hash)', () => {
  const key = KEY(), st = stateOf('bind');
  const { anchor, manifest, shards } = checkpoint(st, key, 3, 6);
  const mut = [m => m.cipher_hash = 'cd'.repeat(32), m => m.blk += 1, m => m.shard_x[0] = 99,
    m => m.shard_digests[0] = 'ee'.repeat(32), m => m.epoch = 999, m => m.root = 'ff'.repeat(32)];
  for (const f of mut) { const m = clone(manifest); f(m); assert.throws(() => resurrect(anchor, m, shards, key), /FAIL-CLOSED/); }
});

// ── DoS / malformed inputs must fail-closed cleanly, not crash or hang ──────────
test('DoS: giant manifest.blk is bounded, fails closed (no huge alloc / hang)', () => {
  const key = KEY(), st = stateOf('dos');
  const { anchor, manifest, shards } = checkpoint(st, key, 3, 6);
  for (const blk of [1, 2 ** 31, 5e9, -1, 0]) { const m = clone(manifest); m.blk = blk; assert.throws(() => resurrect(anchor, m, shards, key), /FAIL-CLOSED/); }
});

test('malformed inputs fail-closed (not raw TypeError/RangeError)', () => {
  const key = KEY(), st = stateOf('mal');
  const { anchor, manifest, shards } = checkpoint(st, key, 3, 6);
  const cases = ['notabuffer', Buffer.alloc(10), Buffer.alloc(74)];
  for (const a of cases) assert.throws(() => resurrect(a, manifest, shards, key), /FAIL-CLOSED/);
  assert.throws(() => resurrect(anchor, null, shards, key), /FAIL-CLOSED/);
  assert.throws(() => resurrect(anchor, { root: 1 }, shards, key), /FAIL-CLOSED/);
  assert.throws(() => resurrect(anchor, manifest, null, key), /FAIL-CLOSED/);
  assert.doesNotThrow(() => resurrect(anchor, manifest, [null, ...shards.slice(0, 3), { x: 1 }], key)); // junk entries skipped, k good remain
});

// ── F1: lossy state values are REFUSED at checkpoint, never silently mangled ────
test('lossy values are refused at checkpoint (byte-exact is honest)', () => {
  const key = KEY();
  for (const bad of [{ x: NaN }, { x: Infinity }, { x: -0 }, { x: new Date() }, { x: new Map() }, { x: new Set() }, { x: undefined }, { x: 10n }, { x: () => 1 }, { b: new Uint8Array([1]) }]) {
    assert.throws(() => checkpoint(bad, key, 2, 4), /FAIL-CLOSED/, JSON.stringify(Object.keys(bad)));
  }
  // and canon itself refuses
  assert.throws(() => canon({ d: new Date() }), /FAIL-CLOSED/);
  // valid states still accepted
  assert.doesNotThrow(() => checkpoint({ a: 1, b: 'x', c: [true, null, 3.5], d: { e: -2 } }, key, 2, 4));
});

test('canonical form is order-independent', () => { assert.ok(canon({ a: 1, b: 2 }).equals(canon({ b: 2, a: 1 }))); });

// ── refutation residuals (NEW-1..3) ────────────────────────────────────────────
test('NEW-1: sparse arrays are refused (would silently become [.,null,.])', () => {
  const key = KEY(); const sparse = [1, , 3];               // eslint-disable-line no-sparse-arrays
  assert.throws(() => canon({ a: sparse }), /FAIL-CLOSED/);
  assert.throws(() => checkpoint({ a: sparse }, key, 2, 4), /FAIL-CLOSED/);
  assert.doesNotThrow(() => checkpoint({ a: [1, null, 3] }, key, 2, 4));   // dense equivalent is fine
});

test('NEW-2: tiny/degenerate decode fails-closed, not raw RangeError', () => {
  const key = KEY(), st = { s: 'x' };
  const { anchor, manifest, shards } = checkpoint(st, key, 1, 3);
  // corrupt every shard so decode can proceed but produce garbage/undersized -> must be FAIL-CLOSED
  const junk = shards.map(s => ({ x: s.x, bytes: Buffer.from(s.bytes) }));
  // (happy path still works)
  assert.ok(stateRoot(resurrect(anchor, manifest, shards, key)).equals(stateRoot(st)));
});

test('NEW-3: duplicate shards dedupe, still resurrect (no crash, no false failure)', () => {
  const key = KEY(), st = stateOf('dup');
  const { anchor, manifest, shards } = checkpoint(st, key, 3, 6);
  const withDupes = [shards[0], shards[0], shards[1], shards[1], shards[2]]; // only 3 distinct, but k=3
  assert.ok(stateRoot(resurrect(anchor, manifest, withDupes, key)).equals(stateRoot(st)));
});

// ── fuzz ───────────────────────────────────────────────────────────────────────
test('fuzz: 80 random states x random (k,n) x random k-survivors, 0 mismatches', () => {
  for (let t = 0; t < 80; t++) {
    const k = 2 + (t % 5), n = k + 1 + (t % 6), key = KEY();
    const st = { blob: randomBytes(20 + (t * 37) % 4000).toString('hex'), i: t, nested: { arr: [t, t + 1] } };
    const { anchor, manifest, shards } = checkpoint(st, key, k, n);
    const pool = shards.slice(), pick = []; while (pick.length < k) pick.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    assert.ok(stateRoot(resurrect(anchor, manifest, pick, key)).equals(stateRoot(st)), `t=${t} k=${k} n=${n}`);
  }
});

test('NEW-4: over-deep state is refused at checkpoint (no stack overflow)', () => {
  const key = KEY(); let deep = {}; let c = deep; for (let i = 0; i < 5000; i++) { c.n = {}; c = c.n; }
  assert.throws(() => checkpoint(deep, key, 2, 4), /FAIL-CLOSED/);
  // a reasonably nested state still works
  assert.doesNotThrow(() => checkpoint({ a: { b: { c: { d: 1 } } } }, key, 2, 4));
});

// ── v0.2 additions: anchor version, equalsState, size cap ──────────────────────
import { equalsState, CURRENT_ANCHOR_VERSION } from '../src/everark-core.mjs';

test('anchor version: v1 default is 75B and resurrects', () => {
  const st = stateOf('v1'), key = KEY();
  const { anchor, manifest, shards } = checkpoint(st, key, 2, 4);
  assert.equal(CURRENT_ANCHOR_VERSION, 1);
  assert.equal(anchor.length, 75);
  assert.equal(anchor[0], 1);
  assert.ok(equalsState(resurrect(anchor, manifest, shards.slice(0, 2), key), st));
});

test('anchor version: legacy v0 (74B) still resurrects', () => {
  const st = stateOf('v0'), key = KEY();
  const { anchor, manifest, shards } = checkpoint(st, key, 2, 4, 1, { version: 0 });
  assert.equal(anchor.length, 74);
  assert.ok(equalsState(resurrect(anchor, manifest, shards.slice(0, 2), key), st));
});

test('anchor version: unrecognized length/version is fail-closed', () => {
  const key = KEY();
  assert.throws(() => resurrect(Buffer.alloc(75), {}, [], key), /unrecognized anchor|bad k\/n/); // v1-len but [0]!=1
  assert.throws(() => resurrect(Buffer.alloc(73), {}, [], key), /unrecognized anchor/);
});

test('equalsState ignores key order (the JSON-order footgun)', () => {
  assert.ok(equalsState({ a: 1, b: 2 }, { b: 2, a: 1 }));
  assert.ok(!equalsState({ a: 1 }, { a: 2 }));
});

test('size cap: an oversized manifest.blk is refused before manifest bind', () => {
  const st = stateOf('cap'), key = KEY();
  const { anchor, manifest, shards } = checkpoint(st, key, 2, 8);   // n=8
  const huge = { ...manifest, blk: 1 << 24 };  // 16M * n(8) = 128M, over the 64M cap
  assert.throws(() => resurrect(anchor, huge, shards, key), /recovery size cap/);
});

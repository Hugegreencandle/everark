# RT-failclosed — adversarial review of EverArk `resurrect()`

Reviewer: KVT red-team lane · 2026-09-06 · target `src/everark-core.mjs`, `demo/resurrect-demo.mjs`, `test/everark.test.mjs`

## Report-back packet

- **Status:** done (review complete; no forgery found; several robustness/DoS findings).
- **Files changed:** none in src/test/demo (read-only review). Written: this report `redteam/RT-failclosed.md`. Throwaway probes: `/tmp/probe2_binding.mjs`, `/tmp/probe1_malformed.mjs`, `/tmp/probe_dos.mjs`.
- **Headline:** In ~30 adversarial inputs, `resurrect()` **never returned a wrong/forged state** — every corrupted input either returned the true state or threw. The security property (never return forged state) HOLDS. BUT it holds because of a **single** backstop check (line 123, `H(bytes) == aRoot`); the intermediate "binding chain" is incomplete, and there is a real **DoS** (unbounded `blk` allocation → multi-minute hang) plus a wide band of **uncaught TypeError/RangeError** where the spec wants clean fail-closed throws.
- **Evidence:** probe outputs inline below (all commands re-runnable with `node <probe>`). Existing suite: 9/9 pass. Demo: byte-exact YES, honest.
- **Blockers:** none.
- **Next smallest action:** add the input-validation + `blk`/`k`/`n` bounds block at the top of `resurrect()` (fix in F2/F3 below) and the missing tests in §Test-gaps.

---

## The one line that carries the whole security property

`resurrect()` line 123:

```js
const bytes = decryptState(cipher, secret);
if (!H(bytes).equals(aRoot)) throw new Error('FAIL-CLOSED: recovered state root != anchor');
return JSON.parse(bytes.subarray('everark\0'.length).toString('utf8'));
```

`aRoot` is `anchor[0:32]` — taken directly from the on-chain (trusted) anchor. The returned plaintext is gated on `H(plaintext) == aRoot`. Since forging a plaintext with a chosen SHA-256 is infeasible, **the only value that can be returned is the true state**. Every other check in the function (merkle root, `manifest.root`, per-shard digest, `cipher_hash`, GCM auth) is defense-in-depth / fail-fast — none of them is individually load-bearing for non-forgery. This is why all the attacks below fail closed. It is also the review's central caution: **remove or move line 123 and the layer becomes forgeable**, because the intermediate binding is not sufficient on its own (Finding F1).

---

## Finding #2 (the priority): are `cipher_hash`, `blk`, `shard_x` swappable without detection?

**Yes, all three are outside the Merkle root and can be swapped freely — and doing so DOES corrupt the decode — but each corruption is caught downstream, so the result is fail-closed, not forgery.** This is NOT a critical finding; it is a defense-in-depth gap (F1).

Probe `/tmp/probe2_binding.mjs` (truth = `{name:vivarium,hp:20,motto:'cannot die'}`, k=3/n=6), output:

```
[baseline]           RETURNED TRUE state (fine)
[swap cipher_hash]   threw: FAIL-CLOSED: cipher_hash mismatch
[blk+1]              threw: FAIL-CLOSED: cipher_hash mismatch
[blk-1]              threw: length header corrupt          <-- NOT prefixed FAIL-CLOSED
[permute shard_x]    threw: FAIL-CLOSED: only 1 valid shards, need 3
[shard_x +100]       threw: FAIL-CLOSED: only 0 valid shards, need 3
[swap manifest.root] threw: FAIL-CLOSED: manifest.root != anchor root
[giant blk 5e9]      *** HUNG > 120s, task killed ***      <-- DoS, see F2
```

Why each fails closed:
- **`cipher_hash` swap** — reconstructed cipher no longer hashes to the (attacker) value → line 121 throws. Even if the attacker also rewrote the shards to match, line 123 would catch the resulting wrong plaintext.
- **`blk` swap** — changes the decode block size; the reconstructed cipher differs → `cipher_hash` (line 121) or the length header (rsDecode line 68) throws. `blk` is taken from `manifest.blk` (line 117) and *overrides* each shard's own `.blk`, so it is fully attacker-controlled — this is what makes F2 (DoS) possible.
- **`shard_x` swap** — `shard_x` is only used to map a shard's bytes to a digest index (line 116). The per-shard digest is `H(bytes)` and does **not** cover the x-coordinate, so x is not cryptographically bound to its bytes. Permuting `shard_x` makes the digest lookup miss → shards rejected → `< k valid` → throw. Note the decode itself uses the shard's *own* `s.x` (rsDecode line 49), not `manifest.shard_x`, so a lie about x can at worst reduce the valid-shard count or (if the attacker also supplies matching bytes) produce a wrong polynomial — again caught by line 121/123.

**Conclusion for #2:** swappable = yes; forgery = no. The absence of binding is masked by line 123. Recorded as F1 (fragility) not CRITICAL.

---

## Findings, ranked

### F1 — MEDIUM (design fragility): binding chain is incomplete; non-forgery rests on a single check
`cipher_hash`, `blk`, `shard_x`, and the anchor's `n` (byte 73) and `epoch` (bytes 64–71) are **not** bound to the anchor. `n` and `epoch` are in fact never even read by `resurrect()`. Today this is safe only because line 123 re-derives the plaintext root from the trusted anchor. There are two independent security-critical checks the reader should be able to point to; there is one. **One-line fix:** either (a) fold `cipher_hash` + `blk` into the 74-byte anchor (or under `manifest_root`) so the binding is explicit, or at minimum (b) add a comment marking line 123 as the sole non-forgery invariant and a dedicated regression test that fails if it is removed (see Test-gaps).

### F2 — HIGH (DoS): unbounded `blk` (and unvalidated `n`) → giant allocation / hang
`manifest.blk` is attacker-controlled and flows into `Buffer.alloc(blk * k)` (rsDecode line 62) and `Buffer.alloc(blk)` per shard, with no upper bound. Evidence:

```
# /tmp/probe2_binding.mjs, blk = 5e9, k=3  -> Buffer.alloc(~1.5e10) ≈ 15 GB
[giant blk 5e9]  HUNG > 120s (background task killed)

# /tmp/probe_dos.mjs, blk = ceil(MAX_LENGTH/2), k=3 -> overflow
[huge blk alloc-reject] RangeError: The value of "size" is out of range ... Received 13_510_798_882_111_488 (1ms)
```

A single malicious/corrupt manifest hangs or crashes the resurrector (uncaught `RangeError`, not FAIL-CLOSED). **One-line fix:** at the top of `resurrect`, read `n = anchor.readUInt8(73)`, require `1 <= k <= n <= 255`, derive/verify the expected `blk` bound (e.g. reject if `!Number.isInteger(manifest.blk) || manifest.blk < 1 || manifest.blk * k > MAX_CIPHER_BYTES`) before any allocation.

### F3 — MEDIUM (robustness): malformed inputs throw raw TypeError/RangeError, not clean FAIL-CLOSED
Spec requires "throw a clear error on any bad input (fail-closed)". No shape validation exists, so bad inputs surface internal errors. None returned wrong data — but callers keying on `/FAIL-CLOSED/` cannot distinguish these from an internal bug. Probe `/tmp/probe1_malformed.mjs`:

```
[anchor=string len74]      threw TypeError: anchor.subarray is not a function
[no shard_digests]         threw TypeError: Cannot read properties of undefined (reading 'map')
[no shard_x]               threw TypeError: Cannot read properties of undefined (reading 'indexOf')
[no root]                  threw TypeError: The first argument must be of type string...
[no cipher_hash]           threw TypeError: The first argument must be of type string...
[no blk]                   threw RangeError: "size" is out of range ... Received NaN
[shard_digests=string]     threw TypeError: manifest.shard_digests.map is not a function
[shards null]              threw TypeError: availableShards is not iterable
[shards [null,...]]        threw TypeError: Cannot read properties of null (reading 'x')
[entry no .bytes]          threw TypeError: The "data" argument must be of type string...
# handled cleanly / correctly:
[anchor len 10]            threw Error: FAIL-CLOSED: anchor not 74 bytes
[shards empty]             threw Error: FAIL-CLOSED: only 0 valid shards, need 3
[entry no .x]              threw Error: FAIL-CLOSED: only 2 valid shards, need 3
[duplicate x]              threw Error: singular (duplicate shard x?)   (not FAIL-CLOSED prefixed)
[negative x] / [x=0] / [x>n]  threw FAIL-CLOSED: only N valid shards    (rejected via digest miss)
[manifest.k=string]        RETURNED TRUE state   (manifest.k ignored; k comes from anchor — correct)
[bytes=string]             RETURNED TRUE state   (bad shard dropped, 3 good supplied — correct)
```

**One-line fix:** add a guard block validating `Buffer.isBuffer(anchor)`, that `manifest` has array `shard_digests`/`shard_x` of equal length and string `root`/`cipher_hash`, and that `availableShards` is an array of `{x:int, bytes:Buffer}`, each throwing `FAIL-CLOSED: ...`.

### F4 — LOW: degenerate anchor (all-zero, k=0) → uncaught TypeError
An all-zero 74-byte anchor gives `k=0`; with `shard_digests=[]` the zero Merkle root matches, `good.length (0) < k (0)` is false, and execution reaches `rsDecode([], 0)` → `use[0].blk` on an empty array → `TypeError: Cannot read properties of undefined (reading 'blk')`. Requires a crafted anchor (normally on-chain-trusted), hence LOW, but shows there is no `k >= 1` guard. Evidence (probe1): `[anchor all-zero74 + empty digests] threw TypeError: Cannot read properties of undefined (reading 'blk')`. **One-line fix:** the `1 <= k <= n` assert from F2 also closes this.

### F5 — INFO: `n` and `epoch` in the anchor are never consumed
`resurrect()` reads only `aRoot`, `aMroot`, and `k`. `n` (byte 73) and `epoch` (bytes 64–71) are ignored, so `manifest.shard_x.length` is never checked against the anchor's `n`, and a manifest with a mismatched epoch resurrects silently (epoch isn't in the returned state, so no data impact). Fix folded into F2's validation block.

---

## #4 Demo honesty

The demo is **honest and cannot show a false green.** `exact = stateRoot(revived).equals(stateRoot(dapp))` can only be true if `revived` equals the true state, and `resurrect()` already enforces `H(revived_bytes) == aRoot` internally, so a wrong state cannot reach the compare. If `resurrect()` instead threw, line 35 would throw uncaught and the process would exit non-zero **before** printing YES — there is no path where a failed resurrection prints green. Verified: demo prints `byte-exact match : YES`, anchored root == revived root (`a43134ee…`).

Two caveats worth a footnote (not dishonesty):
1. The headline compare is against the still-in-memory original `dapp` (line 12), not bytes independently re-read from disk/chain. The stronger property (matches the on-chain anchor) is enforced *inside* `resurrect` via line 123, so this is acceptable — but the demo's own compare is the weaker one.
2. "TOTAL DEATH" keeps `secret` resident in memory. Real total death also loses the secret (the comment says it is threshold-split across hosts), and `resurrect()` cannot recover without it. The demo does not demonstrate secret recovery — it demonstrates shard/anchor recovery given the secret.

---

## #3 Test-quality audit

Existing 9 tests all pass (`node --test test/everark.test.mjs` → 9/9). Coverage:

- Positive tests (happy, exhaustive k-of-n, total death, fuzz×60) **do** assert `deepEqual` to the true state → they confirm the *correct* state is returned on valid input. Good.
- Negative tests (tampered shard, forged anchor, swapped digest, wrong key) assert **only** `assert.throws(/FAIL-CLOSED/)`. That is adequate for those cases (a throw means no return), **but no test ever feeds a crafted input designed to induce a *wrong return* and asserts non-forgery.** The suite proves "throws on the obvious corruptions," not "never returns a wrong value under adversarial input."

**Does any test assert a WRONG state is never returned (vs just that it throws)?** Only implicitly, and only for *valid* inputs (the deepEqual positives). For invalid inputs, the assertion is "throws," never "if it returned, the value is the truth." The invariant the product sells — *return the true state or throw, never anything else* — is not directly tested.

A bombproof suite MUST add:
1. **Unbound-field battery (the F1/#2 gap):** for each of `cipher_hash`, `blk` (±1 and large), `shard_x` (permuted, offset), mutate the manifest *without* touching `shard_digests`/merkle root, and assert `throws`. Currently the entire "fields outside the Merkle root" class is untested.
2. **Non-forgery invariant test:** a loop over a battery of corrupted (anchor, manifest, shards) inputs asserting `resurrect` either `deepEqual`s the truth **or** throws — never returns a third value. This is the property, stated as a test.
3. **The single-backstop test (F1):** a test that would fail if line 123's root check were removed (e.g. construct inputs where every earlier check passes but the plaintext is wrong — only achievable by mutating internals; at minimum assert the exact error when cipher decrypts but root mismatches).
4. **Malformed/type-confusion (F3):** anchor as string, missing each manifest field, `shard_digests`/`shard_x` wrong type, `availableShards` null / `[null]` / entries missing `.x`/`.bytes` / `.bytes` not a Buffer — assert a **clean** `FAIL-CLOSED` throw (this test will fail today, correctly flagging F3).
5. **DoS bound (F2):** giant `blk` and `n` must throw `FAIL-CLOSED` fast, not hang/RangeError.
6. **Degenerate anchor (F4):** all-zero / k=0 / k>n → `FAIL-CLOSED`.
7. **Cross-anchor test:** shards+manifest from checkpoint A resurrected against the anchor from checkpoint B (different state) → must `FAIL-CLOSED`. Proves the anchor genuinely pins identity.
8. **Duplicate/degenerate x** already partly covered by the exhaustive test's singular path, but should assert the `FAIL-CLOSED` prefix (currently the message is `singular (duplicate shard x?)`, un-prefixed).

---

## Bottom line

No forgery, no wrong-state return was achievable — the layer's core promise holds. The gaps are (1) it holds on a single check while advertising a multi-step binding chain that is actually incomplete (F1), (2) a genuine DoS via unbounded `blk` (F2), and (3) a broad band of raw crashes where clean fail-closed throws are specified (F3). Fixes F2 and F3 are a single validation block at the top of `resurrect()`; F1 is a comment + dedicated regression test (or, better, fold `cipher_hash`/`blk`/`n` into the anchor). The test suite tests the happy path and obvious tampering well but never adversarially targets a wrong *return*, and never touches the unbound-field class.

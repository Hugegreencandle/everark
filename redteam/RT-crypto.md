# RT-crypto — adversarial review of `src/everark-core.mjs`

Target: `src/everark-core.mjs` (immortal-state / resurrection layer).
Spec: `the EverArk design spec (internal)`.
Reviewer stance: find any input that SILENTLY corrupts, loses, or returns a WRONG state.

---

## Report-back packet

- **Status:** done (review complete; evidence-backed).
- **Files changed:** only this report (`redteam/RT-crypto.md`). `src/` untouched (read-only as instructed). No push.
- **Evidence:** three Node harnesses run against the actual module (outputs quoted verbatim below):
  - `rt.mjs` — brute-forced `gmul`/`gdiv` over all 256×256 pairs vs a reference GF(256) impl; exhaustive C(n,k) MDS check; RS boundary cases. Result: **0 GF mismatches, 0 inverse failures, all MDS subsets reconstruct.**
  - `rt2.mjs` — 13 canon-collision + resurrect-binding attacks.
  - `rt3.mjs` — structured-type canonicalization.
- **Blockers:** none.
- **Next smallest action:** apply the F1 fix (reject/whitelist non-JSON-safe values in `canon`, and drop the object-rebuild that bypasses `toJSON`) — this is the one finding that silently corrupts the stored copy. F2 (derive `blk` from authenticated shard length) is a 1-line hardening.

**Bottom line:** the *resurrect integrity gate is sound* — every return path is bound to the on-chain root by the final `H(bytes)==aRoot` check (line 123); no forged-manifest / forged-shard / wrong-key path returns a wrong state. The GF/RS/AEAD core is correct. **The one catastrophic bug is upstream of the anchor: `canon()` silently and lossily mangles common state values (NaN/Infinity/-0/undefined/Date/Map/Set/typed arrays), so distinct states collide to one root and the "byte-exact" claim is false.** Because the loss happens *before* anchoring, every downstream check passes and nobody is ever warned.

---

## Findings, ranked by severity

### F1 — HIGH — `canon()` silently corrupts / collides common state values ("byte-exact" is false)
**File:** `everark-core.mjs:10-16` (`canon` / `norm`), consumed at `:94` (`checkpoint`) and `:124` (`resurrect` return).

`norm` rebuilds every non-array object as `Object.fromEntries(Object.keys(v).sort()...)`, then `JSON.stringify`s it. This is lossy in ways that are **silent and permanent** — the loss is committed into `root` at checkpoint time, so the on-chain anchor faithfully commits to the *corrupted* bytes and `resurrect` faithfully returns them. Every integrity check passes. The dApp author is never told their data changed.

Concrete failing inputs (all verified, same root ⇒ collision, or altered on round-trip):

| input state | stored/resurrected as | why |
|---|---|---|
| `{v: NaN}` | `{v: null}` | `JSON.stringify(NaN)=null` |
| `{v: Infinity}` | `{v: null}` | same |
| `{v: -Infinity}` | `{v: null}` | same |
| `{v: -0}` | `{v: 0}` | `JSON.stringify(-0)="0"` |
| `{a:1, b:undefined}` | `{a:1}` | key silently dropped |
| `{t: new Date(0)}` | `{t: {}}` | **`norm` rebuilds from own-keys, bypassing `toJSON`** — worse than plain JSON (which gives ISO string) |
| `{m: new Map([['a',1]])}` | `{m: {}}` | Map data destroyed |
| `{s: new Set([1,2,3])}` | `{s: {}}` | Set data destroyed |
| `{u: new Uint8Array([1,2,3])}` | `{u:{"0":1,"1":2,"2":3}}` (plain object, not a typed array) | structure lost |
| `{n: 1n}` (BigInt) | **throws** `TypeError: Do not know how to serialize a BigInt` at checkpoint | crash, not corruption (better, but still an unhandled abort) |

Evidence (`rt2.mjs` / `rt3.mjs`):
```
NaN vs null same root: true 69eab2af4e59b921...
Infinity vs null same root: true
-0 vs 0 same root: true
undefined-value key dropped: "{\"a\":1}"
state {x:NaN} resurrects to: {"x":null}
state {a:1,b:undefined} resurrects to: {"a":1}
Date   -> {"t":{}}   Map -> {"m":{}}   Set -> {"s":{}}   Uint8 -> {"u":{"0":1,...}}
Date==={} collision: true
NaN/Inf/-Inf/null roots: 3d9bef78 3d9bef78 3d9bef78 3d9bef78   (all identical)
```
`{t:new Date(0)}` and `{t:{}}` produce an **identical anchor**; `{v:NaN}`, `{v:Infinity}`, `{v:-Infinity}`, `{v:null}` all produce the **same root**. For a layer that stores "people's only copy," this is the worst class: a live dApp with any of these values in state will resurrect to a *different* state, provably-hashing to the anchor, with no error raised.

Note the spec headline ("rebuilt **byte-exact**", §4/§6/§10) is not achievable through `JSON.stringify` + object-rebuild. It is byte-exact to the *canonical form*, not to the *dApp state*.

**One-line fix:** make `canon` fail-closed on non-round-trippable values — in `norm`, throw on `number` that is `!Number.isFinite`, on `-0`, on `undefined`/`bigint`/`function`/`symbol`, and on any object whose prototype isn't `Object`/`Array` (Date/Map/Set/typed arrays) rather than silently rebuilding it; require the dApp to pre-serialize such types. (Refuse to anchor what you cannot reproduce.)

---

### F2 — MEDIUM — attacker-controlled `manifest.blk` is used in decode but bound to nothing; triggers uncaught crash / memory-DoS
**File:** `everark-core.mjs:117` (`good.push({ ...s, blk: manifest.blk })`) → `:48` (`rsDecode` uses `use[0].blk`).

`blk` is read straight from the (off-chain, attacker-mutable) manifest. It is **not** in the anchor (74-byte anchor has no `blk`) and **not** in the Merkle tree (`merkleRoot` covers `shard_digests` only). A lying `blk`:
- too small (`blk=1`) → `rsDecode` allocates a 3-byte `out`, then `out.readUInt32BE(0)` reads past it → **uncaught** `RangeError: Attempt to access memory outside buffer bounds` (not a clean `FAIL-CLOSED:` throw).
- negative (`blk=-1`) → `Buffer.alloc(-3)` → uncaught `ERR_OUT_OF_RANGE`.
- huge (`blk=2**31`) → `Buffer.alloc(blk*k)` = multi-GB allocation → hang / OOM **DoS** (this hung the harness for >120s until killed).

Evidence (`rt2.mjs`):
```
[blk=1 (too small)]  threw: Attempt to access memory outside buffer bounds
[blk=-1]             threw: The value of "size" is out of range ... Received -3
[blk=99999 (too big)]threw: FAIL-CLOSED: cipher_hash mismatch
```
**Integrity is not broken** — no `blk` value returns a wrong state (downstream `cipher_hash` and root checks catch the moderate cases, and the pathological cases throw/abort). But it's an availability hole (attacker who serves you a manifest can crash or OOM your resurrection) and it violates "verify EVERYTHING against the anchor": `blk` is trusted, unverified.

**One-line fix:** don't trust `manifest.blk`. In `resurrect`, use the authenticated shard length — `good.push({ ...s, blk: s.bytes.length })` (all good shards already passed the digest check, so their byte length is authenticated). Then delete `blk` from the trust surface entirely.

---

### F3 — LOW — manifest tamper-evidence is weaker than claimed: Merkle root not length-bound; `shard_x` and `n` unverified
**File:** `everark-core.mjs:88` (`merkleRoot` last-node duplication), `:100` (`shard_x` never hashed), `:107-119` (`resurrect` never checks `n` or manifest lengths).

- `merkleRoot` duplicates the last leaf on odd counts (`lvl[i+1] || lvl[i]`), so `[a,b,c]` and `[a,b,c,c]` yield the **same root** (verified: `merkle malleability ... same root: true`). The digest list is not length-committed.
- `manifest.shard_x` is not a Merkle leaf and not in the anchor, so it can be permuted/truncated freely. (`resurrect` decodes using each shard's *own* `s.x`, and rejects mismatches, so this can't corrupt — it only causes fail-closed shard rejection: `shard_x reversed → only 1 valid shards, need 3`.)
- The anchor commits `n` (byte 73) but `resurrect` never reads it, and never checks `manifest.shard_digests.length === n`.

No integrity break (the final root gate still holds), but the spec's "the manifest itself is tamper-evident" (§4) overstates it: an attacker can restructure/pad the manifest's shard list without changing `manifest_root`. Confirms only that shards can't be *forged* (preimage resistance), not that the shard *set* is fixed.

**One-line fix:** bind position and length into the leaves — `leaf_i = H(u32(n) ‖ u16(shard_x_i) ‖ shard_digest_i)` — and have `resurrect` assert `manifest.shard_digests.length === anchor.readUInt8(73)`.

---

### F4 — LOW — dead length-header guard + unverified `everark\0` prefix strip
**File:** `everark-core.mjs:68` and `:124`.

- Line 68 `if (len < 0 || len + 4 > out.length)`: `out.readUInt32BE(0)` is unsigned, so `len < 0` is **dead code**. Harmless, but the guard reads as if a signed length were possible; the real protection is only `len + 4 > out.length`.
- Line 124 strips `'everark\0'.length` (8) bytes with no check that the prefix is actually present. It always is (the bytes hashed to `root`, and `root` came from `canon` which prepends it), so this is benign today — but it's an unasserted invariant; if `canon`'s prefix ever changes, resurrect silently mis-slices.

**One-line fix:** `if (!bytes.subarray(0,8).equals(Buffer.from('everark\0'))) throw new Error('FAIL-CLOSED: domain prefix');` before the parse; drop the dead `len < 0`.

---

## What is genuinely sound (with the check run)

- **GF(256) math — correct.** `rt.mjs` brute-forced `gmul` and `gdiv` against an independent reference (poly 0x11d) over **all 256×256 pairs**: `GF MUL mismatches: 0`, `GF DIV mismatches: 0`, `inverse failures: 0`. EXP table indices stay in range: max `gmul` index `254+254=508`, max `gdiv` index `254+255-0=509`, both `< 512` (`EXP[508]=71, EXP[509]=142` are real entries; `EXP[255]=EXP[0]=1` correct wrap). `LOG[0]` is never referenced (both ops short-circuit on 0). `gdiv(_,0)` throws.
- **Reed-Solomon is truly MDS.** `rt.mjs` verified **every** C(n,k) subset reconstructs the exact data for (k,n) ∈ {(1,1),(1,3),(2,3),(3,3),(2,5),(3,5),(5,5),(1,7),(4,7),(7,7)} — all `OK`. Boundaries: empty state (len 0), 1-byte, tight-length (len=8,k=3), and **n=255,k=254** all round-trip `true`. `n=256` rejected (`bad k/n`). Eval points are `x=1..n`, distinct and nonzero for n≤255 (`min 1 max 255`). Duplicate-x is detected as singular (`singular (duplicate shard x?)`), not silently mis-decoded — the Vandermonde/Gaussian path is correct.
- **AEAD authenticity is enforced on the resurrect path.** `wrong key → Unsupported state or unable to authenticate data`; `16-byte key → Invalid key length` (aes-256-gcm requires 32B, so a short key can't silently weaken it); tampered shard → caught before decrypt. IV is `randomBytes(12)` per encrypt — no nonce-reuse path exists (a fresh IV every call; nothing derives the IV from key/plaintext).
- **`resurrect` is fail-closed against forgery.** Every attempted forgery aborts, and the *only* `return` is gated by `H(bytes).equals(aRoot)` (line 123), so any returned state provably hashes to the on-chain root:
  ```
  [forged shard bytes]                 threw: only 2 valid shards, need 3
  [unknown shard x=99]                 threw: only 0 valid shards, need 3
  [anchor 74B garbage]                 threw: manifest_root != anchor
  [evil manifest+shards, victim anchor]threw: manifest_root != anchor
  [manifest.k lies =1]                 RETURNED correct state (k is taken from the ANCHOR, manifest.k ignored — correct design)
  [no shards]                          threw: only 0 valid shards, need 3
  [anchor 73 bytes]                    threw: anchor not 74 bytes
  ```
  `[evil fully self-consistent (own anchor)]` returning the attacker's state is **not** a bug: whoever controls the on-chain anchor defines the state — that is the trust model (§2). `k` correctly comes from the anchor (line 110), not the manifest, so a lying `manifest.k` is ignored.

---

## Priority for a resurrection layer
1. **F1 first** — it silently corrupts the stored copy for ordinary inputs (NaN/Date/Map/undefined), and it's the only finding that produces a *wrong state that passes every check*. Everything else fails closed.
2. **F2** — cheap hardening; removes an unauthenticated field and a DoS/crash vector.
3. **F3/F4** — defense-in-depth on manifest tamper-evidence and invariants.

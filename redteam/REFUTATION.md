# REFUTATION — third-pass red-team of the HARDENED `src/everark-core.mjs`

Reviewer stance: break it or confirm each prior finding truly closed. Target read-only.
Date 2026-09-06 · target `src/everark-core.mjs`.

## Report-back packet

- **Status:** done — needs-review (core security property HOLDS; three residual robustness/completeness gaps found, none is a forgery).
- **Files changed:** only this report `redteam/REFUTATION.md`. `src/`, `test/`, `demo/` untouched. No push.
- **Probes (all re-runnable with `node <file>`):**
  - `/tmp/ea_probe_forgery.mjs` — 10-case forgery/wrong-state battery.
  - `/tmp/ea_probe_canon.mjs` — strict-canon completeness + collision hunt.
  - `/tmp/ea_probe_proto.mjs` — prototype pollution via resurrect's `JSON.parse`.
  - `/tmp/ea_probe_dos.mjs` — crafted-bundle robustness, blk bounds, duplicate-shard, degenerate anchor, deep nesting.
  - `/tmp/ea_probe_gf.mjs` — exhaustive C(n,k) MDS + boundaries + bad k/n.
- **Evidence:** probe outputs quoted verbatim below.
- **Blockers:** none.
- **Next smallest action:** in `canon`/`assertLossless`, reject sparse arrays (`v.length !== Object.keys(v).length`, or refuse holes) — closes the one silent-wrong-state path. Then in `resurrect`, dedupe `good` by `x` and guard `manifest.blk * k >= 4` (or wrap `rsDecode` and re-throw as FAIL-CLOSED) — closes the two uncaught-throw paths.

## Bottom line

**No forgery and no wrong-state-from-forgery was achievable.** Every tampered/cross-anchor/wrong-secret input fails closed; the whole-manifest binding (`manifest_hash`) + the final `H(bytes)==aRoot` gate hold. GF/RS is MDS-correct. Prototype pollution is not exploitable (`JSON.parse` uses define-property semantics). The strict-canon fix correctly refuses every enumerated dangerous value.

**But the "bombproof" claim is not yet fully true, on two of its three sub-claims:**
1. *"returns the true state"* — **broken for sparse arrays.** `canon` accepts a sparse array and silently rewrites holes to `null`; `[1,,3]` and `[1,null,3]` collide to the same anchor, and a dApp that checkpoints `{grid:[1,,3]}` resurrects `{grid:[1,null,3]}` after passing every integrity check. The strict-canon bullet ("throws FAIL-CLOSED on any non-round-trippable value") is false — sparse arrays are non-round-trippable yet pass.
2. *"no uncaught crash / always FAIL-CLOSED"* — **broken by two inputs:** a crafted self-consistent anchor with `blk*k < 4` throws an uncaught `RangeError` (not FAIL-CLOSED), and a duplicate shard in `availableShards` throws a plain `Error: duplicate shard x` (not FAIL-CLOSED) that also *fails an otherwise-recoverable resurrection* (availability).
3. *"never a wrong/forged state"* — **HOLDS.**

---

## Prior-finding disposition

| Finding | Verdict | Probe / evidence |
|---|---|---|
| **RT-crypto F1** canon silently corrupts/collides common values | **PARTIALLY** | `ea_probe_canon`: NaN/±Inf/-0/undefined/bigint/Date/Map/Set/Uint8Array/class/function/symbol all now `REFUSED (FAIL-CLOSED)`. **Residual:** sparse arrays pass and collide (`sparse-array COLLISION (same canon bytes): true`; round-trip `EXACT match … false`). See NEW-1. |
| **RT-crypto F2** attacker `blk` → crash/DoS, bound to nothing | **PARTIALLY** | `blk` is now anchor-bound (via `manifest_hash`, line 119/151) and range-checked 1..2^24 **before any alloc** (`blk=5e9/2^24+1/-1/1.5 → FAIL-CLOSED: manifest.blk out of range`). Giant-alloc DoS **CLOSED**. **Residual:** `blk*k < 4` → uncaught `RangeError` (NEW-2). |
| **RT-crypto F3** merkle malleability; `shard_x`/`n` unverified | **CLOSED** | Merkle tree replaced by whole-manifest hash binding `epoch,root,cipher_hash,k,n,blk,shard_digests,shard_x` (line 118-119). Any manifest mutation → `FAIL-CLOSED: manifest_hash != anchor` (`ea_probe_forgery`: blk/cipher_hash/shard_x tampers all fail closed; length==n and manifest.n==anchor.n checked, lines 147-148). |
| **RT-crypto F4** dead `len<0` guard; unchecked prefix strip | **CLOSED** | src line 93 is now `if (len + 4 > out.length)` (dead `len<0` gone); line 168 asserts the `everark\0` prefix before parse (`FAIL-CLOSED: canon prefix missing`). |
| **RT-failclosed F1** binding chain rests on a single check | **CLOSED** | Two independent load-bearing surfaces now exist: whole-manifest→anchor (`manifest_hash`, line 151) and plaintext→anchor (`H(bytes)==aRoot`, line 166). `cipher_hash/blk/shard_x/n/epoch` are all under `manifest_hash`. |
| **RT-failclosed F2** unbounded `blk`/`n` → hang/OOM | **CLOSED (DoS)** | Range check + anchor binding reject oversize `blk` in 0ms with no allocation (`ea_probe_dos`). `n` guarded `1≤k≤n≤255` (line 143). Residual small-`blk` crash tracked as NEW-2 (not a DoS). |
| **RT-failclosed F3** malformed inputs throw raw errors, not FAIL-CLOSED | **PARTIALLY** | Shape validation added (anchor Buffer/len, manifest object + typed fields, arrays len==n, shard entries) → those cases now FAIL-CLOSED. **Residuals:** `blk*k<4` RangeError (NEW-2); duplicate shard → plain `Error` (NEW-3); `rsDecode` internal throws (`singular`, `duplicate shard x`, `length header corrupt`, `shard length mismatch`) are un-prefixed plain Errors. |
| **RT-failclosed F4** degenerate anchor (k=0) → uncaught TypeError | **CLOSED** | `all-zero anchor → FAIL-CLOSED: bad k/n in anchor (k=0, n=0)` (line 143). |
| **RT-failclosed F5** `n`/`epoch` never consumed | **CLOSED** | `n` read (line 142) and enforced (lines 147-148); `epoch` folded into `manifest_hash` so it is anchor-bound. (Minor: anchor's own epoch bytes 64-71 are not cross-checked against `manifest.epoch`, but epoch never reaches the returned state — no data impact.) |

---

## Attack-by-attack evidence

### Attack 1 — forgery / wrong state — NOT ACHIEVABLE
```
[baseline]                                   RETURNED true state
[cross-anchor (B manifest+shards vs A anchor)] FAIL-CLOSED: manifest_hash != anchor
[self-consistent evil bundle (attacker anchor+secret)] RETURNED {"hp":999,"name":"evil"}
[forged shard bytes]                         FAIL-CLOSED: only 2 valid shards, need 3
[manifest.blk/cipher_hash/shard_x tampered]  FAIL-CLOSED: manifest_hash != anchor
[manifest tampered + attacker-recomputed manifest_hash] FAIL-CLOSED: manifest_hash != anchor
[wrong secret]                               FAIL-CLOSED: decryption failed
[manifest.k lies =1]                         FAIL-CLOSED: manifest k/n != anchor
```
The self-consistent "evil" bundle returning the attacker's own state is **not forgery** — the party who controls the on-chain anchor *defines* the state (the trust model). Making resurrect return B while the anchor commits to A requires a SHA-256 preimage against `aRoot` (line 166) — infeasible. Attempting to keep the victim anchor while swapping in a different manifest is caught by `manifest_hash` (the attacker cannot rewrite the anchor's committed `mHash`). Forgery **closed**.

### Attack 2 — strict canon completeness — ONE RESIDUAL (NEW-1)
All enumerated values are refused FAIL-CLOSED (see table). The residual:
```
[sparse [1,,3]]     ACCEPTED -> [1,null,3]
[dense  [1,null,3]] ACCEPTED -> [1,null,3]
sparse-array COLLISION (same canon bytes): true
  distinguishable states? (1 in sparse)= false  (1 in dense)= true
  roots: 63940eed… == 63940eed…
round-trip: input hole=false, returned hole=true  -> EXACT match … false  (silent corruption)
```
`assertLossless` uses `v.forEach(...)` (line 29) which **skips array holes**, so a sparse array is never inspected; `norm`'s `.map` also skips holes and `JSON.stringify` emits `null`. Numeric-string key ordering, NFC/NFD unicode, and large-number precision were tested and are NOT collisions (deterministic / same-float64 / correctly distinguished). Minor sibling: `Object.create(null)` is accepted and flattened to a plain object on round-trip (proto identity lost; key/value data preserved).

### Attack 3 — prototype pollution — NOT EXPLOITABLE
```
own keys of state: [ '__proto__', 'constructor', 'ok' ]
after checkpoint+resurrect:
  ({}).polluted = undefined     ({}).c = undefined     Object.prototype.polluted = undefined
  returned own keys: [ '__proto__', 'constructor', 'ok' ]
  round-trip preserved own __proto__ key? true
```
`JSON.parse` (line 169) creates `__proto__`/`constructor` as **own data properties** (define-property semantics), never invoking a setter, so `Object.prototype` is untouched. `Object.fromEntries` in `norm` behaves the same at checkpoint. In scope but harmless.

### Attack 4 — uncaught throw / DoS — TWO RESIDUALS (NEW-2, NEW-3)
```
[blk=1,k=1 (blk*k<4)]  RangeError: Attempt to access memory outside buffer bounds  <-- NOT FAIL-CLOSED
[blk=3,k=1] / [blk=1,k=3]  same RangeError
[blk=4,k=1]            FAIL-CLOSED: cipher_hash mismatch
[blk 5e9 / 2^24+1 / -1 / 1.5]  FAIL-CLOSED: manifest.blk out of range   (0ms, no alloc)
[duplicate shard0 before shard1, k=2]  Error: duplicate shard x  <-- NOT FAIL-CLOSED (and control {0,1} recovers fine)
[all-zero anchor]      FAIL-CLOSED: bad k/n in anchor
[deeply nested 20k]    RangeError: Maximum call stack size exceeded (self-inflicted; own secret+anchor)
```
`rsDecode` does `out = Buffer.alloc(blk*k)` then `out.readUInt32BE(0)` (src line 92) with no guard that the buffer holds the 4-byte length header, so any crafted anchor+manifest with `blk*k < 4` produces an uncaught `RangeError` (NEW-2). Duplicate shards are pushed to `good` without dedupe, so `rsDecode`'s `use = shards.slice(0,k)` can contain a repeated `x` → plain `Error: duplicate shard x`, which both breaks the FAIL-CLOSED contract and *fails a resurrection that the distinct shards would have completed* (NEW-3, reachable with a normal victim anchor).

### Attack 5 — GF/RS MDS at boundaries — CORRECT
```
exhaustive C(n,k) subsets tested: 1043, mismatches: 0
n=255,k=254: all 255 drop-one subsets correct? true
DUP-X rsDecode: duplicate shard x   (detected, not mis-decoded)
rsEncode(0,3)/(3,2)/(1,256)/(-1,3): all rejected: bad k/n
```
No (k,n)/subset decodes wrong silently. MDS holds through the new boundaries.

---

## NEW findings, ranked

- **NEW-1 — MEDIUM — sparse arrays defeat strict canon (silent wrong state + root collision).** `assertLossless`/`norm` skip array holes (`.forEach`/`.map`); a sparse array is accepted, holes become `null`, and `[1,,3]`/`[1,null,3]` share one anchor. A dApp checkpointing a sparse array resurrects a different array with every integrity check green. Directly falsifies the strict-canon claim. *Fix:* in `assertLossless`, `if (Array.isArray(v) && v.length !== Object.keys(v).length) fc('sparse array')` (and iterate by index, not `forEach`).
- **NEW-2 — LOW/MEDIUM — crafted `blk*k < 4` → uncaught `RangeError` (not FAIL-CLOSED).** Reaches `out.readUInt32BE(0)` on an undersized buffer. Needs a crafted anchor (nominally trusted), but the hardening explicitly promises shape-validation + "no uncaught crash." No wrong-state, no unbounded DoS. *Fix:* require `manifest.blk * k >= 4` (or `manifest.blk >= 4`) at line 149, or wrap `rsDecode` and re-throw as FAIL-CLOSED.
- **NEW-3 — MEDIUM — duplicate shard in `availableShards` fails an otherwise-recoverable resurrection with a non-FAIL-CLOSED `Error`.** Reachable with a normal anchor (e.g. the same shard fetched from two hosts). `resurrect` never dedupes `good` by `x` before `rsDecode` slices the first `k`. Availability regression + broken error contract. *Fix:* dedupe `good` by `x` (keep first) before the `good.length < k` check.
- **NEW-4 — LOW — `rsDecode` internal throws are un-prefixed plain `Error`s** (`singular`, `duplicate shard x`, `length header corrupt`, `shard length mismatch`); callers keying on `/FAIL-CLOSED/` cannot distinguish them from an internal bug. Also `canon` on cyclic/deeply-nested state throws an uncaught `RangeError` at checkpoint. *Fix:* funnel through `fc()`.

---

## One-line verdict

**Not yet bombproof:** forgery is genuinely closed (no wrong/forged-state path, MDS-correct, no pollution), but the "returns the true state" claim breaks on sparse arrays (silent corruption + root collision, NEW-1) and the "no uncaught crash / always FAIL-CLOSED" claim breaks on a crafted `blk*k<4` anchor (NEW-2) and on duplicate shards (NEW-3) — three narrow, one-line-fixable residuals.

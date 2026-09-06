# EverArk — pre-publish red-team (2026-09-07)

Fresh hostile pass on `src/everark-core.mjs` before making the repo public. Goal: make `resurrect()` return
a wrong or forged state, or fail-open. Method: read the core, then run adversarial probes (throwaway, not
committed) plus genuine-path controls.

## Result: fail-closed. No fail-open found.

| Attack | Outcome |
|---|---|
| Wrong secret | refused — decryption auth-tag fails |
| Tampered shard byte | refused — shard digest mismatch, drops below k |
| Shard relabeled to a different x | refused — digest binds x, mismatch, dropped |
| Manifest k bumped | refused — manifest k/n != anchor |
| Manifest shard-digest edited | refused — manifest_hash != anchor |
| Foreign shards (different state) under target anchor | refused — 0 digests match |
| Too few shards (k-1) | refused — insufficient valid shards |
| Foreign anchor + target's shards | refused — returns nothing of ours (0 match) |
| Genuine any-k recovery | byte-exact (compared by canonical stateRoot) |
| Duplicate shards + enough distinct | byte-exact, dedupe-tolerant |

The decisive backstop is the final gate: after decode + decrypt, `H(recovered) == anchor root` must hold, so
`resurrect()` cannot return a state the anchor did not commit to. Security reduces to the anchor being
trustworthy, which on-chain it is (immutable). This is the documented trust model, and it holds.

## Residuals (not bugs — hardening / DX notes)
1. **`blk*k` allocation can reach ~4GB** at the extremes (blk capped at 1<<24, k up to 255). It is BOUNDED
   and there is no amplification (an attacker must supply k full shards to get there), but a total-size cap
   (e.g. cap `n*blk`) would be belt-and-suspenders. LOW.
2. **No version byte in the 74-byte anchor.** Fine today, but a released format should carry a version for
   forward-compat. LOW/MED (do before wide adoption).
3. **`shardDigest` assumes x ≤ 255** (one byte). Safe in practice — a shard whose x isn't in the manifest is
   dropped by `indexOf` before the digest is trusted — but an explicit `x` range assert would be cleaner. LOW.
4. **"Byte-exact" means canonical-form exact** (object key order is normalized by `canon`). A consumer that
   compares raw `JSON.stringify` order will see a false mismatch — this false-negatived this red-team's own
   probe twice. Document it and expose a helper (compare via `stateRoot`). DX, not a security issue.

## Verdict
Sound and fail-closed. Safe to publish. The residuals are hardening/DX, none block release.

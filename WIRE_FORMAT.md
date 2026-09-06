# EverArk wire format

Two artifacts leave a checkpoint: the **anchor** (tiny, meant for an immutable sink like a Xahau memo or
Hook State) and the **manifest** (small JSON, replicated alongside the shards). The shards carry the data.

## Anchor

A fixed-size byte string. Two versions; a reader tells them apart by length and leading byte.

### v1 (current, 75 bytes)
```
offset  size  field
0       1     version = 0x01
1       32    root            sha256 of the canonical plaintext state
33      32    manifest_hash   sha256 binding every manifest field
65      8     epoch           uint64 big-endian
73      1     k               shards needed to rebuild (1..255)
74      1     n               shards produced (k..255)
```

### v0 (legacy, 74 bytes)
Identical to v1 without the leading version byte (root at offset 0, k at 72, n at 73). Still accepted by
`resurrect`; produced only with `checkpoint(..., { version: 0 })`. The first public testnet anchor is v0.

A reader MUST reject any other length, and reject a 75-byte anchor whose first byte is not `0x01`.

## Manifest (JSON)
```
epoch          number
root           hex sha256 of the canonical plaintext            (== anchor root)
cipher_hash    hex sha256 of the ciphertext
k, n           numbers                                          (== anchor k/n)
blk            number   shard block length in bytes             (1 .. 2^24; n*blk <= 64 MiB)
shard_digests  string[] length n; hex H( x_byte ‖ shard_bytes ) (binds each shard to its x)
shard_x        number[] length n; the x-coordinates 1..n
manifest_hash  hex; = H(canon of every field above)             (== anchor manifest_hash)
```
`resurrect` binds the whole manifest to the anchor via `manifest_hash` before trusting any field.

## Shard
`{ x: 1..n, bytes: <blk bytes> }`. On disk the CLI names them `shards/shard-<x>.bin` (raw bytes). Reed-Solomon
over GF(256) (primitive poly 0x11d), polynomial-evaluation form, so ANY k of the n shards reconstruct.

## Resurrection contract
`resurrect(anchor, manifest, shards, secret)` returns the exact state the anchor commits to, or throws
`FAIL-CLOSED`. The decisive gate is `sha256(recovered plaintext) == anchor.root`, so it can never return a
state the anchor did not commit to. Security reduces to the anchor being trustworthy (immutable on-chain).

## Canonical form
State is serialized as `"everark\0"` + `JSON.stringify` with object keys sorted recursively. Values that JSON
cannot round-trip losslessly (undefined, functions, symbols, bigint, NaN/±Infinity, -0, Date/Map/Set/typed
arrays, sparse arrays, non-plain objects, depth > 200) are REFUSED at checkpoint. "Byte-exact" is therefore
canonical-form exact: compare states with `equalsState`, not raw `JSON.stringify` order.

# EverArk

Immortal state + resurrection for Evernode dApps. Erasure-code a dApp's encrypted state into n shards
(any k of n recover), anchor a 74-byte root on Xahau, resurrect byte-exact after total death, fail-closed
against forged, tampered, or insufficient inputs.

## Status & scope (read this)
Early experiment, not a product. Proven on **Xahau testnet only** (not mainnet). The live demo splits the
state into shards held as **local files** and destroys some before resurrecting; putting those shards on
**genuinely independent Evernode hosts** is the next rung and is **not yet proven** (the host market was too
thin to demonstrate it). Everything claimed below is covered by the tests; nothing here has run against real
value.

- `src/everark-core.mjs` — canon/root, GF(256) Reed-Solomon (poly-eval, MDS), aes-256-gcm, manifest Merkle, anchor, resurrect.
- `test/everark.test.mjs` — 14 tests incl. exhaustive k-of-n subset recovery, manifest-binding battery, and fuzz.
- `demo/resurrect-demo.mjs` — kill a dApp entirely, bring it back proven.

Run: `node --test test/everark.test.mjs` · `node demo/resurrect-demo.mjs`

## Live demo (Xahau testnet)
`node scripts/live-resurrect.mjs` — checkpoints a dApp, writes the 74-byte anchor on-chain (real tx), kills all instances + n-k hosts, then resurrects byte-exact by reading the anchor BACK FROM THE CHAIN. Latest run: anchor tx `3863079E879DD00DD5970D14F1A53E059DA68B17F332A82F2CA4B655877EC12F` @ ledger 12078860, byte-exact YES. Next rung: shards on genuinely-independent rented Evernode hosts (needs RLUSD).

## CLI
```
npm link           # or: node bin/everark.mjs ...
everark checkpoint state.json --k 3 --n 6 --out ./out   # writes out/{anchor.hex,manifest.json,shards/}
                                                        # prints a random secret if you don't pass --secret — save it
everark resurrect --anchor ./out/anchor.hex --manifest ./out/manifest.json --shards ./out/shards --secret HEX64
```

## Anchor format & API notes
- Anchor is **v1 (75 bytes)** by default (a leading version byte + the 74-byte body); legacy **v0 (74B)** is
  still read, and `checkpoint(..., { version: 0 })` still emits it. Full layout: `WIRE_FORMAT.md`.
- "Byte-exact" means **canonical-form** exact (object key order is normalized). Compare states with the
  exported `equalsState(a, b)`, not raw `JSON.stringify`. TypeScript types: `index.d.ts`.
- Recovery is size-capped (`n * blk <= 64 MiB`), fail-closed.

## License
Apache-2.0. See `LICENSE` and `NOTICE`. Copyright 2026 Kairo Vault Technologies 合同会社 (G.K.).

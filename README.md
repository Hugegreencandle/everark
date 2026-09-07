# EverArk

Immortal state + resurrection for Evernode dApps. Erasure-code a dApp's encrypted state into n shards
(any k of n recover), anchor a 74-byte root on Xahau, resurrect byte-exact after total death, fail-closed
against forged, tampered, or insufficient inputs.

![EverArk resurrection demo: a dApp is checkpointed, every instance and 3 of 6 shards are destroyed, and it rebuilds byte-exact from the anchor](media/everark-demo.gif)

## Status & scope (read this)
Early experiment, not a product. The core library is covered by the tests. The headline claim — byte-exact
resurrection from **genuinely independent Evernode hosts** — was demonstrated on **Xahau mainnet on
2026-09-07**: shards on independent third-party hosts (GB/NZ/AU/US), rebuilt byte-exact from a k=3-of-n
subset after the other hosts were gone, with the 75-byte root anchored on mainnet (tx `9D0D2679…`). That run
used **demo application state and a sample data key** over short paid leases (4 of 6 hosts served, meeting the
k=3 threshold) — a **self-issued worked example, not a paid third-party audit and not real user funds**. The
earlier testnet demo splits shards as local files. Details + reproducibility: certificate and run log below.

- `src/everark-core.mjs` — canon/root, GF(256) Reed-Solomon (poly-eval, MDS), aes-256-gcm, manifest Merkle, anchor, resurrect.
- `test/everark.test.mjs` — 14 tests incl. exhaustive k-of-n subset recovery, manifest-binding battery, and fuzz.
- `demo/resurrect-demo.mjs` — kill a dApp entirely, bring it back proven.

Run: `node --test test/everark.test.mjs` · `node demo/resurrect-demo.mjs`

## Live demo (Xahau testnet)
`node scripts/live-resurrect.mjs` — checkpoints a dApp, writes the 74-byte anchor on-chain (real tx), kills all instances + n-k hosts, then resurrects byte-exact by reading the anchor BACK FROM THE CHAIN. Latest testnet run: anchor tx `3863079E879DD00DD5970D14F1A53E059DA68B17F332A82F2CA4B655877EC12F` @ ledger 12078860, byte-exact YES.

**Distributed run (2026-09-07) — the headline, done.** Shards were placed on genuinely independent, third-party Evernode hosts (GB/NZ/AU/US); the state was rebuilt **byte-exact** from a k=3-of-n subset after the other hosts were gone. The 75-byte root is anchored on **Xahau mainnet** (tx `9D0D2679B4F2B21FFDD52B025C5EB19F65A776EEDCD0048351B69658796C1924` @ ledger 25621999), so anyone can read it and re-check the match without trusting us. Harness: `scripts/{acquire-cluster,deploy-shards,resurrect-from-hosts,anchor-onchain}.mjs`; worked example: `certificate/KVT-Cert-EverArk-Distributed-2026-09-07.html`; run log: `DISTRIBUTED_RUN_2026-09-07.md`.

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
- **Anchoring the root on Xahau — two backends.** `scripts/anchor-onchain.mjs` writes it as an AccountSet **memo** (simple, but you hunt the tx history to find it). `scripts/anchor-remark.mjs` writes it as an **immutable Remark** (`SetRemarks`) on the account itself, so the anchor lives on-object and is directly queryable via `ledger_entry`/`account_objects` — no tx hunt. The remark is immutable (the transactor rejects any mutate/delete with `tecIMMUTABLE`, owner-only), which is what makes it tamper-evident; a re-checkpoint uses a new `RemarkName`. Remark idea: [@scotty2ten](https://x.com/scotty2ten).

## License
Apache-2.0. See `LICENSE` and `NOTICE`. Copyright 2026 Kairo Vault Technologies 合同会社 (G.K.).

# EverArk — renting 3 independent Evernode hosts for shard custody

The offline core + on-chain anchor are done and demonstrated (see README, live-resurrect). The only
remaining rung is placing the shards on genuinely INDEPENDENT hosts. Two paths.

## Path A — everhostx marketplace (pay RLUSD, no EVR needed)  [BLOCKED 2026-09-06: vendor rate feed down]
everhostx acquires the Evernode instance for you in exchange for RLUSD on XRPL mainnet.
1. `GET https://everhostx.com/catalog` must return a real price (currently errors "No RLUSD to EVR rate").
   The watch (scripts/watch-everhostx.mjs) alerts when it recovers.
2. When priced: for EACH of 3 hosts, DANE pays the quoted RLUSD in Xaman to everhostx's destination
   (from the catalog/checkout), 3 payments. (KVT never holds the anchor/host keys — Dane's Xaman only.)
3. everhostx `/buy` (or /orders) with each xrplTxHash returns instance ip + user port + upload key.
   Put the 3 into `orders.json` as {ip, port, instancePubKey, userPrivKey, x:1|2|3}.
4. `EVERARK_SECRET=<hex> node scripts/deploy-shards.mjs`  — bundles the shardstore contract with each
   host's shard and deploys it. Prints the 74-byte anchor hex.
5. Anchor that hex on-chain (Xaman AccountSet memo, or reuse live-resurrect's anchor step).
6. `EVERARK_SECRET=<hex> node scripts/resurrect-from-hosts.mjs` — pulls shards from the 3 hosts, reads
   the anchor, resurrects byte-exact. Kill hosts to prove k-of-n. This is the evidence table with real hosts.

## Path B — direct evdevkit (needs EVR in a mainnet account)
`evdevkit acquire <host>` per host (or `cluster-create 3 ...`), needs EVR + EV env keys. Skips everhostx
but you must hold/acquire EVR. Then bundle+deploy per host as in A.4-6.

## Cost
everhostx was ~1 RLUSD / 3-hour slot (2026-09-03). 3 hosts ≈ 3 RLUSD, DANE-signed in Xaman. Nothing here
spends money on its own — this repo prepares everything; the RLUSD payments are Dane's manual step.

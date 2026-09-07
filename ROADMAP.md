# EverArk — roadmap (ways to make the release more useful)

**Shipped in v0.2 (2026-09-07):** CLI (#1), anchor version byte + `WIRE_FORMAT.md` (#3), consumer helper
`equalsState` + TypeScript `index.d.ts` (#4), and the total-size cap (#5).

**Item #2 (independent-host custody) — CLOSED 2026-09-07.** Proven: EverArk rebuilt a live application's
state **byte-for-byte** from a k=3-of-n subset of shards held on genuinely independent, third-party Evernode
hosts (GB/NZ/AU/US), after the other hosts were gone. Recovered canonical root == anchored root
(`f33f03b2…8e4ffa39`), and the 75-byte anchor is on **Xahau mainnet** (tx
`9D0D2679B4F2B21FFDD52B025C5EB19F65A776EEDCD0048351B69658796C1924`, ledger 25621999) so anyone can
re-check it without trusting the author. Harness: `scripts/deploy-shards.mjs`, `scripts/acquire-cluster.mjs`,
`scripts/resurrect-from-hosts.mjs`, `scripts/anchor-onchain.mjs`. Worked example / cert:
`certificate/KVT-Cert-EverArk-Distributed-2026-09-07.html`; run log: `DISTRIBUTED_RUN_2026-09-07.md`.


Reviewed by an internal panel before publishing. Ranked by adoption impact vs effort. This is an early
experiment (testnet only); the items below are what would turn it into something people actually build on.

## High impact
1. **A tiny CLI.** `everark checkpoint <state.json> --k 3 --n 6` and `everark resurrect <anchor> <dir>` so
   people can use it without writing a line of code. Biggest adoption lever for a primitive like this.
2. **✅ Genuine independent-host custody (the headline) — DONE 2026-09-07.** Shards on genuinely independent
   rented Evernode hosts, resurrected byte-exact after losing a subset (k=3 of n, 4 of 6 hosts served). This
   was the whole promise ("survives total death"); it is now proven and mainnet-anchored (see the CLOSED note
   at the top). The earlier blocker (everhostx offered only one host) was solved by acquiring a real
   independent cluster.
3. **Anchor version byte + a written wire-format spec.** Add a version to the 74-byte anchor and document the
   exact layout so the format can evolve and third parties can implement compatible readers. Cheap, and it is
   the difference between "a script" and "a format others adopt."

## Medium
4. **Consumer helpers + types.** Export `equalsState(a,b)` (compare via `stateRoot`, killing the JSON key-order
   footgun the red-team hit) and ship `.d.ts` TypeScript types for DX.
5. **Total-size cap.** Bound `n*blk` so a crafted manifest can't request an outsized allocation (belt-and-
   suspenders; see RT-prepublish residual #1).
6. **Pluggable anchor backend.** The anchor is 74 opaque bytes; let it be written to any chain memo, not just
   Xahau. Broadens reach to XRPL, and anywhere with an immutable 74-byte sink.
   - ★ **Store it as an immutable Xahau Remark (`SetRemarks`)** rather than an AccountSet memo (idea from
     @scotty2ten, 2026-09-07): the anchor then lives ON the account/object and is directly queryable, no tx
     hunt. Must set the remark immutable, or a mutable anchor defeats the tamper-evidence. Hook State is the
     other on-object option. This is the better default anchor home for a real deployment.
     **✅ Built 2026-09-07: `scripts/anchor-remark.mjs`** — writes the 74/75-byte root as an immutable remark
     (per-remark `Flags: 1`) on the tenant's Account Root; `ObjectID` is the account-root index read from
     chain (no hand-derived keylet); reads the remark back to confirm the value matches. Because an immutable
     remark can't be overwritten, a re-checkpoint uses a new `RemarkName` (`EVERARK_REMARK_NAME`, see #7).
   - ★★ **URIToken variant (@scotty2ten):** mint a URIToken as the vault's identity and store the 74 bytes as an
     immutable remark ON the token. The anchor then travels with the token, so a checkpoint or a whole lineage
     becomes a transferable object — and it dovetails with the M16 graveyard idea (death mints a URIToken).
7. **Rotation / re-checkpoint helper.** A helper to re-shard and re-anchor as state grows or membership
   changes, with the old anchor superseded — the real lifecycle of a long-lived dApp.

## Lower / later
8. **Streaming for large state** (state bigger than `k*blk` fits in memory) + a wider length header if ever needed.
9. **Reference HotPocket integration** showing a real Evernode contract checkpointing itself on a schedule and
   resurrecting on redeploy — the "contract that pays its rent can also come back from the dead" story, end to end.
10. **Shard custody proofs.** Have each host periodically prove it still holds its shard (a challenge-response),
    so you learn a shard is gone before you need it.

## What NOT to add
- Not a token, not a fee, not a "product" wrapper. EverArk is a public-good primitive; keep the core small and
  let others build the products. Sell the *verification* of those products, not the primitive.

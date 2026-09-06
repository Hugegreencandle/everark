# Security

EverArk is an early experiment (Xahau testnet only). Do not use it to protect real value yet.

## Reporting a vulnerability
Report privately, not in a public issue. Email the maintainer at security@kairovault.com with a description and,
if possible, a reproduction. We aim to acknowledge within a few days. Please give us reasonable time to fix before
any public disclosure.

## Security model (what EverArk does and does not protect)
- **The 32-byte secret is the single point of failure.** Lose it and the state can never be resurrected; leak it
  and anyone with the shards can read the state. EverArk does not manage the secret for you. In production it should
  be threshold-split across the hosts, never held whole in one place.
- **Trust reduces to the anchor.** `resurrect` returns exactly the state the anchor commits to, gated by
  `sha256(recovered) == anchor.root`. It cannot return a state the anchor did not commit to. This is only as strong
  as the anchor's immutability — on-chain (a Xahau memo / Hook State) it is immutable; a locally-held anchor is not.
- **Integrity, not availability.** Fewer than k valid shards means no resurrection (fail-closed) — that is correct,
  not a bug. Availability depends on keeping at least k of n shards reachable.
- **Fail-closed by design.** Forged/tampered/insufficient inputs are refused, never silently accepted. See
  `redteam/RT-prepublish-2026-09-07.md` for the adversarial pass.

## Out of scope (current release)
- Mainnet use. Genuine independent-host shard custody (not yet proven; harness in `scripts/`). Secret management /
  key custody. Denial-of-service beyond the built-in `n*blk <= 64 MiB` recovery cap.

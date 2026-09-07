# EverArk — distributed resurrection PROVEN on independent hosts (2026-09-07)

First real end-to-end run across genuinely independent, third-party Evernode hosts (John's cluster,
@AverageJohnEVR). Byte-exact rebuild from any-k-of-n shards after loss.

- Acquired 6 independent hosts (6 countries): CA, GB, NZ, AU, US, IE.
- Deployed EverArk shard contracts; 4 served on the resurrect run (host1 held a debug echo contract,
  host6 unreachable) — any 3 of n needed (k=3).
- Pulled shards x=2 (evr001.blocknodes.uk / GB), x=3 (evernode.onledger.net / NZ),
  x=4 (xahau.taylor.nu / AU), x=5 (evernode11.infoevernode.xyz / US).
- RESURRECTED: {"cluster":"john-6-independent-hosts","epoch":9,"motto":"a contract that cannot die",
  "name":"vivarium","organisms":[{"hp":20,"id":"a"},{"hp":12,"id":"b"}]}
- anchored root == revived root = f33f03b2baf79d66b418b11c081d08fa275743792c612a7571fb48c98e4ffa39
- byte-exact: YES.

Roadmap #2 (genuine independent-host custody) CLOSED. This is no longer aspirational.

## Bugs fixed to get here (all were untested-until-live code)
1. Contract deps: node_modules must be bundled with the contract (was missing).
2. Contract bin_path: must be /usr/bin/node with the script as a contract-arg — passing the .js as the
   contract-bin made HotPocket try to exec the script directly (BinaryNotFound / contract never started).
3. Client read API: submitContractReadRequest RESOLVES with the reply; the script wrongly listened on the
   contractOutput event (that's for consensus outputs), so replies were dropped.
4. v1 anchor offset: the byte-exact display compared against anchor.subarray(0,32), but the v1 anchor has a
   leading version byte (root at offset 1) — false-negative fixed.
5. Hygiene: a .letta session file (no credentials) had been bundled; removed + gitignored.

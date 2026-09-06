'use strict';
// EverArk shard-store — a minimal HotPocket contract that holds ONE shard and serves it back.
// One of these runs on each independent rented Evernode host; host_i holds shard_i.
// A client connects and sends "GET" (or its own pubkey); the contract replies with a JSON
// { x, bytes_b64, digest } read from the local shard.json bundled at deploy time.
// Read-only: it never mutates. The shard's integrity is verified by the CLIENT against the
// on-chain anchor (this host is untrusted — it cannot forge a shard that matches the manifest digest).
const HotPocket = require('hotpocket-nodejs-contract');
const fs = require('fs');
const path = require('path');

const SHARD_PATH = path.join(__dirname, 'shard.json');   // { x:int, bytes_b64:string, digest:hex } bundled per host

async function contract(ctx) {
  let shard = null;
  try { shard = JSON.parse(fs.readFileSync(SHARD_PATH, 'utf8')); } catch { /* not provisioned */ }
  for (const user of ctx.users.list()) {
    for (const input of user.inputs) {
      const req = (await ctx.users.read(input)).toString().trim();
      if (!shard) { await user.send(JSON.stringify({ error: 'no shard provisioned' })); continue; }
      if (req === 'GET' || req === '' || req.startsWith('r') || req.length === 64) {
        await user.send(JSON.stringify({ x: shard.x, bytes_b64: shard.bytes_b64, digest: shard.digest }));
      } else {
        await user.send(JSON.stringify({ error: 'unknown request; send GET' }));
      }
    }
  }
}
const hpc = new HotPocket.Contract();
hpc.init(contract);

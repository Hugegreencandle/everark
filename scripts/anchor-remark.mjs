// Anchor the EverArk run's 74/75-byte root as an IMMUTABLE Xahau Remark (SetRemarks) on the
// tenant's own Account Root — instead of (or in addition to) an AccountSet memo.
// Idea: @scotty2ten (2026-09-07). The anchor then lives ON the account object and is directly
// queryable via ledger_entry / account_objects — no transaction-history hunt to find it.
//
// The remark is set IMMUTABLE (per-remark Flags = 1 / tfImmutable). A mutable anchor would defeat
// the whole point (someone could rewrite it), so immutability is required, not optional. The
// xahaud transactor enforces this: an attempt to mutate OR delete an immutable remark returns
// tecIMMUTABLE, and only the object owner may write (issuer == Account for ltACCOUNT_ROOT, else
// tecNO_PERMISSION) — verified in Xahau/xahaud src/xrpld/app/tx/detail/SetRemarks.cpp. Because an
// immutable remark can never be changed or removed, a re-checkpoint must use a NEW RemarkName
// (e.g. everark:<epoch>) rather than overwriting — set EVERARK_REMARK_NAME per checkpoint if you
// rotate. See ROADMAP #7 (rotation).
//
// Needs: ~/.ev_tenant (mainnet seed, never printed) + checkpoint-anchor.hex (from deploy-shards.mjs).
// Run from the repo root:  node scripts/anchor-remark.mjs
import pkg from 'xahau';
const { Wallet, Client } = pkg;
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const WS = 'wss://xahau.network', NET = 21337;                 // Xahau mainnet
const REMARK_NAME = process.env.EVERARK_REMARK_NAME || 'everark';
const IMMUTABLE = 1;                                           // per-remark Flags: 1 = immutable, 0 = mutable

const seed = readFileSync(homedir() + '/.ev_tenant', 'utf8').trim();
const anchorHex = readFileSync('./checkpoint-anchor.hex', 'utf8').trim().toUpperCase();
if (!(anchorHex.length === 148 || anchorHex.length === 150)) {  // 74B v0 or 75B v1
  throw new Error(`anchor is ${anchorHex.length / 2}B; expected 74 (v0) or 75 (v1)`);
}
const nameHex = Buffer.from(REMARK_NAME, 'utf8').toString('hex').toUpperCase();  // RemarkName: hex, <=256B
if (nameHex.length > 512 || anchorHex.length > 512) throw new Error('RemarkName/RemarkValue exceed 256 bytes');

const w = Wallet.fromSeed(seed);
const c = new Client(WS);
await c.connect();

// ObjectID = the account-root ledger index, read from chain (no hand-derived keylet).
const le = await c.request({ command: 'ledger_entry', account_root: w.classicAddress, ledger_index: 'validated' });
const objectId = le.result.index;
console.log('anchoring', anchorHex.length / 2 + 'B root as remark', JSON.stringify(REMARK_NAME),
  'on account', w.classicAddress, '\nObjectID (account root):', objectId);

const tx = await c.autofill({
  TransactionType: 'SetRemarks',
  Account: w.classicAddress,
  NetworkID: NET,
  Flags: 0,
  ObjectID: objectId,
  Remarks: [{ Remark: { RemarkName: nameHex, RemarkValue: anchorHex, Flags: IMMUTABLE } }],
});
const res = await c.submitAndWait(w.sign(tx).tx_blob);
const code = res.result.meta.TransactionResult;
console.log('RESULT:', code, '\nTX:', res.result.hash, '\nLEDGER:', res.result.ledger_index);

// Read it back so the console shows the anchor now lives on the account object.
if (code === 'tesSUCCESS') {
  const back = await c.request({ command: 'ledger_entry', account_root: w.classicAddress, ledger_index: 'validated' });
  const remarks = back.result.node?.Remarks || [];
  const mine = remarks.find(r => r.Remark?.RemarkName === nameHex);
  console.log('\nremark on account:', mine ? JSON.stringify(mine.Remark) : '(not found — check node version)');
  console.log(mine && mine.Remark.RemarkValue === anchorHex ? 'READBACK OK — anchor matches, immutable\n' : '');
}
await c.disconnect();
process.exit(code === 'tesSUCCESS' ? 0 : 1);

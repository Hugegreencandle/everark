// EverArk anchor variant — mint a URIToken as the vault's identity and store the 74/75-byte root as an
// IMMUTABLE Remark ON THE TOKEN (idea: @scotty2ten, ROADMAP #6 ★★). The anchor then travels WITH the
// token: transferring the URIToken hands over the checkpoint's identity + its anchor as one object, and it
// dovetails with the M16 "graveyard" idea (a death could mint such a token).
//
// Two txns: (1) URITokenMint -> a token owned by this account; (2) SetRemarks on that token's ledger index
// with the anchor, immutable. Owner-only + tecIMMUTABLE are enforced by xahaud (verified in SetRemarks.cpp:
// ltURI_TOKEN issuer = sfIssuer). Needs ~/.ev_tenant (mainnet seed, never printed) + checkpoint-anchor.hex.
// Run from repo root:  node scripts/anchor-uritoken.mjs
import pkg from 'xahau';
const { Wallet, Client } = pkg;
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const WS = 'wss://xahau.network', NET = 21337;
const URI = process.env.EVERARK_URI || 'everark:vault';           // the token's URI (hex on the wire)
const REMARK_NAME = process.env.EVERARK_REMARK_NAME || 'everark';
const IMMUTABLE = 1;

const seed = readFileSync(homedir() + '/.ev_tenant', 'utf8').trim();
const anchorHex = readFileSync('./checkpoint-anchor.hex', 'utf8').trim().toUpperCase();
if (!(anchorHex.length === 148 || anchorHex.length === 150)) throw new Error(`anchor is ${anchorHex.length / 2}B; expected 74 or 75`);
const uriHex = Buffer.from(URI, 'utf8').toString('hex').toUpperCase();
const nameHex = Buffer.from(REMARK_NAME, 'utf8').toString('hex').toUpperCase();

const w = Wallet.fromSeed(seed);
const c = new Client(WS);
await c.connect();

// 1. mint the URIToken.
console.log('minting URIToken', JSON.stringify(URI), 'on', w.classicAddress);
const mintTx = await c.autofill({ TransactionType: 'URITokenMint', Account: w.classicAddress, NetworkID: NET, URI: uriHex, Flags: 0 });
const mintRes = await c.submitAndWait(w.sign(mintTx).tx_blob);
const mintCode = mintRes.result.meta.TransactionResult;
console.log('mint:', mintCode, 'tx', mintRes.result.hash);
if (mintCode !== 'tesSUCCESS') { await c.disconnect(); process.exit(1); }

// the token's ledger index = ObjectID for the remark, taken from the mint tx meta (chain-derived).
const created = (mintRes.result.meta.AffectedNodes || [])
  .map((n) => n.CreatedNode).filter(Boolean).find((n) => n.LedgerEntryType === 'URIToken');
const objectId = created?.LedgerIndex || mintRes.result.meta.uritoken_id || mintRes.result.meta.URITokenID;
if (!objectId) throw new Error('could not find minted URIToken index in tx meta');
console.log('URIToken ObjectID:', objectId);

// 2. write the anchor as an immutable remark ON the token.
const remTx = await c.autofill({
  TransactionType: 'SetRemarks', Account: w.classicAddress, NetworkID: NET, Flags: 0, ObjectID: objectId,
  Remarks: [{ Remark: { RemarkName: nameHex, RemarkValue: anchorHex, Flags: IMMUTABLE } }],
});
const remRes = await c.submitAndWait(w.sign(remTx).tx_blob);
const remCode = remRes.result.meta.TransactionResult;
console.log('remark:', remCode, 'tx', remRes.result.hash, 'ledger', remRes.result.ledger_index);

// 3. read the token back and show the anchor now lives on it.
if (remCode === 'tesSUCCESS') {
  const objs = await c.request({ command: 'account_objects', account: w.classicAddress, type: 'uritoken', ledger_index: 'validated' });
  const tok = (objs.result.account_objects || []).find((o) => o.index === objectId);
  const mine = (tok?.Remarks || []).find((r) => r.Remark?.RemarkName === nameHex);
  console.log('\nremark on URIToken:', mine ? JSON.stringify(mine.Remark) : '(not found)');
  console.log(mine && mine.Remark.RemarkValue === anchorHex ? 'READBACK OK — anchor lives on the token, immutable\n' : '');
}
await c.disconnect();
process.exit(remCode === 'tesSUCCESS' ? 0 : 1);

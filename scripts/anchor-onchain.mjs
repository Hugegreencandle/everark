// Anchor the EverArk run's 75-byte root on Xahau MAINNET as a permanent, publicly-readable AccountSet memo.
// Reads the tenant seed from ~/.ev_tenant (never printed) and the anchor from checkpoint-anchor.hex.
import pkg from 'xahau';
const { Wallet, Client } = pkg;
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
const WS = 'wss://xahau.network', NET = 21337;               // Xahau mainnet
const seed = readFileSync(homedir() + '/.ev_tenant', 'utf8').trim();
const anchorHex = readFileSync('./checkpoint-anchor.hex', 'utf8').trim().toUpperCase();
const w = Wallet.fromSeed(seed);
const c = new Client(WS); await c.connect();
const MEMO_TYPE = Buffer.from('everark/anchor', 'utf8').toString('hex').toUpperCase();
const MEMO_FMT = Buffer.from('bin75', 'utf8').toString('hex').toUpperCase();
console.log('anchoring root', anchorHex.slice(0, 32) + '…', 'from', w.classicAddress);
const tx = await c.autofill({ TransactionType: 'AccountSet', Account: w.classicAddress, NetworkID: NET,
  Memos: [{ Memo: { MemoType: MEMO_TYPE, MemoFormat: MEMO_FMT, MemoData: anchorHex } }] });
const res = await c.submitAndWait(w.sign(tx).tx_blob);
console.log('RESULT:', res.result.meta.TransactionResult);
console.log('TX:', res.result.hash);
console.log('LEDGER:', res.result.ledger_index);
await c.disconnect(); process.exit(res.result.meta.TransactionResult === 'tesSUCCESS' ? 0 : 1);

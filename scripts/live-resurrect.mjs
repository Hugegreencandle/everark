// EverArk LIVE demo: real on-chain anchor on Xahau testnet, then TOTAL DEATH, then resurrect
// byte-exact by reading the 74-byte anchor back FROM THE CHAIN. Shards go to N local host dirs
// (renting genuinely-independent Evernode hosts for the shards is the next rung — needs RLUSD).
import pkg from 'xahau';
const { Wallet, Client } = pkg;
import { mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { checkpoint, resurrect, stateRoot, hx } from '../src/everark-core.mjs';

const WS = 'wss://xahau-test.net', NET = 21338, DIR = '/tmp/everark-live';
const MEMO_TYPE = Buffer.from('everark/anchor', 'utf8').toString('hex').toUpperCase();
const MEMO_FMT = Buffer.from('bin74', 'utf8').toString('hex').toUpperCase();

async function faucetWallet(c, bal) {
  for (let a = 0; a < 8; a++) {
    const fa = await fetch('https://xahau-test.net/accounts', { method: 'POST' }).then(r => r.json()).catch(() => ({}));
    if (fa.account?.secret) {
      const w = Wallet.fromSeed(fa.account.secret, { algorithm: 'ecdsa-secp256k1' });
      for (let i = 0; i < 12; i++) { if (await bal(w.classicAddress)) return w; await new Promise(r => setTimeout(r, 5000)); }
    }
    await new Promise(r => setTimeout(r, 30000));
  }
  throw new Error('faucet exhausted');
}

const c = new Client(WS); await c.connect();
const balance = (a) => c.request({ command: 'account_info', account: a, ledger_index: 'validated' }).then(r => r.result.account_data.Balance).catch(() => null);

rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR + '/hosts', { recursive: true });

// 1. a living dApp
const dapp = { name: 'vivarium', epoch: 7, organisms: [{ id: 'a', hp: 20 }, { id: 'b', hp: 12 }], motto: 'a contract that cannot die', at: Date.now() };
const secret = randomBytes(32);
const K = 3, N = 6;
console.log('LIVE dApp:', JSON.stringify(dapp));

// 2. checkpoint -> anchor (74B) + shards
const { anchor, manifest, shards } = checkpoint(dapp, secret, K, N, dapp.epoch);
for (const s of shards) writeFileSync(`${DIR}/hosts/host-${s.x}.shard`, s.bytes);
writeFileSync(`${DIR}/manifest.json`, JSON.stringify(manifest));   // (lives replicated with shards; only its hash is on-chain)
console.log(`\nCHECKPOINT: anchor ${anchor.length}B root ${hx(anchor.subarray(0,32)).slice(0,16)}…, ${N} shards, any ${K} recover`);

// 3. ANCHOR ON XAHAU TESTNET — a real AccountSet carrying the 74-byte anchor as a memo
const w = await faucetWallet(c, balance);
console.log('anchor account:', w.classicAddress, '(', await balance(w.classicAddress), 'drops )');
const tx = await c.autofill({ TransactionType: 'AccountSet', Account: w.classicAddress, NetworkID: NET,
  Memos: [{ Memo: { MemoType: MEMO_TYPE, MemoFormat: MEMO_FMT, MemoData: anchor.toString('hex').toUpperCase() } }] });
const res = await c.submitAndWait(w.sign(tx).tx_blob);
const anchorTx = res.result.hash, anchorLedger = res.result.ledger_index;
console.log(`\nANCHORED ON-CHAIN: ${res.result.meta.TransactionResult}  tx ${anchorTx}  ledger ${anchorLedger}`);

// 4. TOTAL DEATH — live state gone; destroy n-k hosts; forget the in-memory anchor entirely
const kill = [1, 2, 5];
for (const x of kill) rmSync(`${DIR}/hosts/host-${x}.shard`);
console.log(`\nTOTAL DEATH: all instances gone; hosts ${kill.join(', ')} destroyed. Surviving: ${readdirSync(DIR+'/hosts').join(', ')}`);

// 5. RESURRECT — read the anchor BACK FROM THE CHAIN (not from memory/disk), then rebuild
const txr = await c.request({ command: 'tx', transaction: anchorTx });
const memo = txr.result.Memos.find(m => m.Memo.MemoType === MEMO_TYPE).Memo;
const anchorOnChain = Buffer.from(memo.MemoData, 'hex');
console.log(`\nread anchor from chain (tx ${anchorTx.slice(0,12)}…): ${anchorOnChain.length} bytes`);
const survivors = readdirSync(DIR + '/hosts').map(f => ({ x: Number(f.match(/host-(\d+)/)[1]), bytes: readFileSync(`${DIR}/hosts/${f}`) }));
const manifestBack = JSON.parse(readFileSync(`${DIR}/manifest.json`, 'utf8'));
const revived = resurrect(anchorOnChain, manifestBack, survivors, secret);

// 6. prove
const exact = stateRoot(revived).equals(anchorOnChain.subarray(0, 32));
console.log('\nRESURRECTED:', JSON.stringify(revived));
console.log('\n--- evidence (all real) ---');
console.log('on-chain anchor tx  :', anchorTx);
console.log('anchor ledger       :', anchorLedger);
console.log('anchored state root :', hx(anchorOnChain.subarray(0,32)));
console.log('revived state root  :', hx(stateRoot(revived)));
console.log('survivor shard digests:', survivors.map(s => hx(createHash('sha256').update(Buffer.concat([Buffer.from([s.x]), s.bytes])).digest()).slice(0,12)).join(', '));
console.log('byte-exact match    :', exact ? 'YES ✓ resurrected from chain after total death' : 'NO ✗');
writeFileSync(`${DIR}/evidence.json`, JSON.stringify({ anchorTx, anchorLedger, root: hx(anchorOnChain.subarray(0,32)), killed: kill, survivors: survivors.map(s=>s.x), byteExact: exact }, null, 2));
await c.disconnect();
process.exit(exact ? 0 : 1);

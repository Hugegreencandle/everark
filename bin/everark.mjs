#!/usr/bin/env node
// EverArk CLI — checkpoint a JSON state to shards + a 74/75-byte anchor, and resurrect it back.
// No external deps. See WIRE_FORMAT.md.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { checkpoint, resurrect, hx, equalsState } from '../src/everark-core.mjs';

function parse(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const key = a.slice(2); const nx = argv[i + 1];
      if (nx === undefined || nx.startsWith('--')) opt[key] = true; else { opt[key] = nx; i++; } }
    else pos.push(a);
  }
  return { pos, opt };
}
const die = (m) => { console.error('everark: ' + m); process.exit(1); };
const USAGE = `everark — immortal state for Evernode dApps

  everark checkpoint <state.json> --k K --n N [--epoch E] [--secret HEX64] [--out DIR] [--v0]
      Split state into N shards (any K rebuild), anchor a 74/75-byte root. Writes DIR/{anchor.hex,manifest.json,shards/}.
      If --secret is omitted a random 32-byte key is generated and PRINTED — save it, resurrection needs it.

  everark resurrect --anchor <hex|file> --manifest <manifest.json> --shards <DIR> --secret HEX64
      Rebuild the state from the anchor + any K valid shards in DIR. Prints the JSON state to stdout.

  everark --help`;

function readAnchor(v) {
  if (existsSync(v)) { const raw = readFileSync(v); const s = raw.toString('utf8').trim();
    return /^[0-9a-fA-F]+$/.test(s) ? Buffer.from(s, 'hex') : raw; }         // file: hex text or raw bytes
  if (/^[0-9a-fA-F]+$/.test(v)) return Buffer.from(v, 'hex');
  die('--anchor must be a hex string or a path to an anchor file');
}
function readSecret(v) {
  if (!v || v === true) die('--secret HEX64 required (64 hex chars = 32 bytes)');
  if (!/^[0-9a-fA-F]{64}$/.test(v)) die('--secret must be 64 hex chars (32 bytes)');
  return Buffer.from(v, 'hex');
}

function cmdCheckpoint(pos, opt) {
  const file = pos[0]; if (!file) die('checkpoint needs <state.json>');
  const k = Number(opt.k), n = Number(opt.n);
  if (!Number.isInteger(k) || !Number.isInteger(n)) die('--k and --n are required integers');
  const epoch = opt.epoch ? Number(opt.epoch) : 1;
  let state; try { state = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { die('cannot read/parse ' + file + ': ' + e.message); }
  let secret, generated = false;
  if (opt.secret) secret = readSecret(opt.secret); else { secret = randomBytes(32); generated = true; }
  const version = opt.v0 ? 0 : 1;
  let out; try { out = checkpoint(state, secret, k, n, epoch, { version }); } catch (e) { die(e.message); }
  const dir = opt.out || './everark-out';
  mkdirSync(join(dir, 'shards'), { recursive: true });
  writeFileSync(join(dir, 'anchor.hex'), hx(out.anchor));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(out.manifest, null, 2));
  for (const s of out.shards) writeFileSync(join(dir, 'shards', `shard-${s.x}.bin`), s.bytes);
  console.log(`checkpoint ok: ${n} shards, any ${k} rebuild. anchor v${version} (${out.anchor.length}B).`);
  console.log(`  out:    ${dir}/  (anchor.hex, manifest.json, shards/shard-*.bin)`);
  console.log(`  anchor: ${hx(out.anchor)}`);
  if (generated) { console.log(`  SECRET (SAVE THIS — resurrection needs it): ${hx(secret)}`); }
}

function cmdResurrect(opt) {
  const anchor = readAnchor(opt.anchor || die('--anchor required'));
  const secret = readSecret(opt.secret);
  let manifest; try { manifest = JSON.parse(readFileSync(opt.manifest, 'utf8')); } catch (e) { die('cannot read --manifest: ' + e.message); }
  const dir = opt.shards || die('--shards DIR required');
  const shards = [];
  for (const f of readdirSync(dir)) {
    const m = basename(f).match(/shard-(\d+)\.bin$/); if (!m) continue;
    shards.push({ x: Number(m[1]), bytes: readFileSync(join(dir, f)) });
  }
  if (!shards.length) die('no shard-*.bin files in ' + dir);
  let state; try { state = resurrect(anchor, manifest, shards, secret); } catch (e) { die(e.message); }
  process.stdout.write(JSON.stringify(state, null, 2) + '\n');
}

const { pos, opt } = parse(process.argv.slice(2));
const cmd = pos.shift();
if (opt.help || !cmd) { console.log(USAGE); process.exit(opt.help ? 0 : 1); }
else if (cmd === 'checkpoint') cmdCheckpoint(pos, opt);
else if (cmd === 'resurrect') cmdResurrect(opt);
else die(`unknown command '${cmd}'. Try: everark --help`);

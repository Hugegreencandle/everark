// EverArk MVP core (hardened after red-team 2026-09-06).
// Commitment, Reed-Solomon (k-of-n) erasure coding over GF(256), AEAD encryption, a full-manifest
// binding under a 74-byte on-chain anchor, and FAIL-CLOSED resurrection. Offline + deterministic.
// No live hosts (deploy-ladder rung 3). Spec: the EverArk design spec (internal)
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export const H = (b) => createHash('sha256').update(b).digest();
export const hx = (b) => Buffer.from(b).toString('hex');
const MAX_N = 255;
const MAX_TOTAL = 64 * 1024 * 1024;          // cap on n*blk recovery footprint (fail-closed DoS bound)

// Anchor wire format (see WIRE_FORMAT.md):
//   v0 (legacy, 74B): root(32) | manifest_hash(32) | epoch(8 BE) | k(1) | n(1)
//   v1 (current, 75B): 0x01 | <the v0 body>          -- a leading version byte for forward-compat
export const CURRENT_ANCHOR_VERSION = 1;
const ANCHOR_V0_LEN = 74, ANCHOR_V1_LEN = 75;

// Compare two states for EverArk-equality: same canonical form (object key order is normalized, so this
// is the right check — raw JSON.stringify order is NOT). Use this instead of ===/JSON string compare.
export const equalsState = (a, b) => stateRoot(a).equals(stateRoot(b));

class FailClosed extends Error { constructor(m) { super('FAIL-CLOSED: ' + m); } }
const fc = (m) => { throw new FailClosed(m); };

// ---- STRICT deterministic canonical serialization (F1 fix) ----
// Accepts ONLY values that JSON round-trips losslessly. Anything EverArk cannot preserve byte-exact
// (undefined, functions, symbols, bigint, NaN/±Infinity, -0, Date/Map/Set/typed arrays, class
// instances) is REFUSED at checkpoint — never silently mangled. "Byte-exact" is then true by construction.
const MAX_DEPTH = 200;
function assertLossless(v, path = '$', depth = 0) {
  if (depth > MAX_DEPTH) fc(`state nested deeper than ${MAX_DEPTH} at ${path}`);
  if (v === null) return;
  const t = typeof v;
  if (t === 'boolean' || t === 'string') return;
  if (t === 'number') {
    if (!Number.isFinite(v)) fc(`non-finite number at ${path} (NaN/Infinity cannot be preserved)`);
    if (Object.is(v, -0)) fc(`negative zero at ${path} (collapses to 0)`);
    return;
  }
  if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint')
    fc(`unpreservable ${t} at ${path}`);
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) { if (!(i in v)) fc(`sparse array hole at ${path}[${i}] (JSON fills it with null)`); assertLossless(v[i], `${path}[${i}]`, depth + 1); }
    return;
  }
  if (t === 'object') {
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null)
      fc(`non-plain object at ${path} (${v.constructor?.name || 'unknown'}) — only plain objects/arrays are preserved`);
    for (const k of Object.keys(v)) {
      if (v[k] === undefined) fc(`undefined-valued key ${path}.${k} (silently dropped by JSON)`);
      assertLossless(v[k], `${path}.${k}`, depth + 1);
    }
    return;
  }
  fc(`unsupported value at ${path}`);
}
export function canon(state) {
  assertLossless(state);
  const norm = (v) => Array.isArray(v) ? v.map(norm)
    : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, norm(v[k])]))
    : v;
  return Buffer.from('everark\0' + JSON.stringify(norm(state)), 'utf8');
}
export const stateRoot = (state) => H(canon(state));

// ---- GF(256) (primitive poly 0x11d) — exhaustively verified vs a carryless-mul reference ----
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];
const gdiv = (a, b) => { if (b === 0) throw new Error('gf div by zero'); return a === 0 ? 0 : EXP[LOG[a] + 255 - LOG[b]]; };

// ---- Reed-Solomon via polynomial evaluation (MDS: ANY k of n reconstruct) ----
export function rsEncode(data, k, n) {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 1 || n < k || n > MAX_N) throw new Error('bad k/n');
  const blk = Math.ceil((data.length + 4) / k);           // +4 bytes: original length header
  const buf = Buffer.alloc(blk * k);
  buf.writeUInt32BE(data.length, 0); data.copy(buf, 4);
  const blocks = []; for (let j = 0; j < k; j++) blocks.push(buf.subarray(j * blk, (j + 1) * blk));
  const shards = [];
  for (let i = 0; i < n; i++) {
    const x = i + 1, s = Buffer.alloc(blk);
    for (let p = 0; p < blk; p++) { let acc = 0, xp = 1; for (let j = 0; j < k; j++) { acc ^= gmul(blocks[j][p], xp); xp = gmul(xp, x); } s[p] = acc; }
    shards.push({ x, blk, bytes: s });
  }
  return shards;
}
export function rsDecode(shards, k) {
  if (!Number.isInteger(k) || k < 1) throw new Error('bad k');
  if (shards.length < k) throw new Error(`need ${k} shards, have ${shards.length}`);
  const use = shards.slice(0, k);
  const blk = use[0].bytes.length;                          // blk from the (verified) shard bytes, never from an untrusted field
  if (use.some(s => s.bytes.length !== blk)) throw new Error('shard length mismatch');
  const xs = use.map(s => s.x);
  if (new Set(xs).size !== xs.length) throw new Error('duplicate shard x');
  const A = xs.map(x => { const row = []; let xp = 1; for (let j = 0; j < k; j++) { row.push(xp); xp = gmul(xp, x); } return row; });
  const I = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 1 : 0)));
  for (let col = 0; col < k; col++) {
    let piv = col; while (piv < k && A[piv][col] === 0) piv++;
    if (piv === k) throw new Error('singular');
    [A[col], A[piv]] = [A[piv], A[col]]; [I[col], I[piv]] = [I[piv], I[col]];
    const inv = gdiv(1, A[col][col]);
    for (let j = 0; j < k; j++) { A[col][j] = gmul(A[col][j], inv); I[col][j] = gmul(I[col][j], inv); }
    for (let r = 0; r < k; r++) { if (r === col || A[r][col] === 0) continue; const f = A[r][col]; for (let j = 0; j < k; j++) { A[r][j] ^= gmul(f, A[col][j]); I[r][j] ^= gmul(f, I[col][j]); } }
  }
  const out = Buffer.alloc(blk * k);
  for (let p = 0; p < blk; p++) { const y = use.map(s => s.bytes[p]); for (let j = 0; j < k; j++) { let c = 0; for (let m = 0; m < k; m++) c ^= gmul(I[j][m], y[m]); out[j * blk + p] = c; } }
  if (out.length < 4) throw new Error('decoded buffer too small for length header');
  const len = out.readUInt32BE(0);
  if (len + 4 > out.length) throw new Error('length header corrupt');
  return out.subarray(4, 4 + len);
}

// ---- AEAD (aes-256-gcm; random iv per encrypt; auth tag detects wrong secret / tamper) ----
function normKey(secret) {
  const k = Buffer.isBuffer(secret) ? secret : Buffer.from(secret);
  if (k.length !== 32) fc('secret must be 32 bytes');
  return k;
}
export function encryptState(bytes, secret) {
  const key = normKey(secret), iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(bytes), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);          // iv(12) | tag(16) | ct
}
export function decryptState(cipher, secret) {
  const key = normKey(secret);
  if (!Buffer.isBuffer(cipher) || cipher.length < 28) fc('cipher too short');
  const d = createDecipheriv('aes-256-gcm', key, cipher.subarray(0, 12)); d.setAuthTag(cipher.subarray(12, 28));
  return Buffer.concat([d.update(cipher.subarray(28)), d.final()]);
}

// ---- shard digest binds the x-coordinate + bytes (F3: x is now cryptographically bound) ----
const shardDigest = (x, bytes) => H(Buffer.concat([Buffer.from([x]), bytes]));
// ---- manifest hash binds EVERY manifest field (defense-in-depth, not a single backstop) ----
function manifestHash(m) {
  return H(canon({ epoch: m.epoch, root: m.root, cipher_hash: m.cipher_hash, k: m.k, n: m.n, blk: m.blk, shard_digests: m.shard_digests, shard_x: m.shard_x }));
}

// ---- checkpoint: state -> {anchor, manifest, shards} ----
// version 1 (default) prepends a version byte -> 75-byte anchor; version 0 emits the legacy 74-byte anchor.
export function checkpoint(state, secret, k, n, epoch = 1, { version = CURRENT_ANCHOR_VERSION } = {}) {
  if (!Number.isInteger(k) || !Number.isInteger(n) || k < 1 || n < k || n > MAX_N) throw new Error('bad k/n');
  if (version !== 0 && version !== 1) throw new Error('bad anchor version');
  const bytes = canon(state), root = H(bytes);
  const cipher = encryptState(bytes, secret), cipherHash = H(cipher);
  const shards = rsEncode(cipher, k, n);
  const manifest = {
    epoch, root: hx(root), cipher_hash: hx(cipherHash), k, n, blk: shards[0].blk,
    shard_digests: shards.map(s => hx(shardDigest(s.x, s.bytes))), shard_x: shards.map(s => s.x),
  };
  const mHash = manifestHash(manifest); manifest.manifest_hash = hx(mHash);
  const meta = Buffer.alloc(10); meta.writeBigUInt64BE(BigInt(epoch), 0); meta.writeUInt8(k, 8); meta.writeUInt8(n, 9);
  const body = Buffer.concat([root, mHash, meta]);          // 32 + 32 + 10 = 74 bytes
  const anchor = version === 1 ? Buffer.concat([Buffer.from([1]), body]) : body;
  return { anchor, manifest, shards };
}

// ---- resurrect: FAIL-CLOSED. Validate shapes, bind the whole manifest to the anchor, then decode. ----
export function resurrect(anchor, manifest, availableShards, secret) {
  if (!Buffer.isBuffer(anchor)) fc('anchor must be a Buffer');
  // detect wire version by length + leading byte; both v0 (74B) and v1 (75B) are accepted
  let off;
  if (anchor.length === ANCHOR_V1_LEN && anchor[0] === 1) off = 1;
  else if (anchor.length === ANCHOR_V0_LEN) off = 0;
  else fc(`unrecognized anchor (len ${anchor.length}; expected 74 v0 or 75 v1)`);
  const aRoot = anchor.subarray(off, off + 32), aMHash = anchor.subarray(off + 32, off + 64);
  const k = anchor.readUInt8(off + 72), n = anchor.readUInt8(off + 73);
  if (k < 1 || n < k || n > MAX_N) fc(`bad k/n in anchor (k=${k}, n=${n})`);
  if (!manifest || typeof manifest !== 'object') fc('manifest must be an object');
  for (const f of ['root', 'cipher_hash']) if (typeof manifest[f] !== 'string') fc(`manifest.${f} missing/!string`);
  if (!Array.isArray(manifest.shard_digests) || !Array.isArray(manifest.shard_x)) fc('manifest.shard_* must be arrays');
  if (manifest.shard_digests.length !== n || manifest.shard_x.length !== n) fc('manifest.shard_* length != n');
  if (manifest.k !== k || manifest.n !== n) fc('manifest k/n != anchor');
  if (!Number.isInteger(manifest.blk) || manifest.blk < 1 || manifest.blk > 1 << 24) fc('manifest.blk out of range');
  if (n * manifest.blk > MAX_TOTAL) fc(`recovery size cap: n*blk (${n * manifest.blk}) exceeds ${MAX_TOTAL}`);
  // bind the ENTIRE manifest to the anchor — after this, every manifest field is trusted
  if (!manifestHash(manifest).equals(aMHash)) fc('manifest_hash != anchor');
  if (!Buffer.from(manifest.root, 'hex').equals(aRoot)) fc('manifest.root != anchor root');
  // collect shards whose (x-bound) digest matches the now-trusted manifest
  if (!Array.isArray(availableShards)) fc('availableShards must be an array');
  const good = [], seen = new Set();
  for (const s of availableShards) {
    if (!s || !Number.isInteger(s.x) || !Buffer.isBuffer(s.bytes)) continue;
    if (seen.has(s.x)) continue;                             // dedupe: same shard from two hosts is fine
    const idx = manifest.shard_x.indexOf(s.x); if (idx < 0) continue;
    if (s.bytes.length !== manifest.blk) continue;
    if (hx(shardDigest(s.x, s.bytes)) === manifest.shard_digests[idx]) { good.push({ x: s.x, bytes: s.bytes }); seen.add(s.x); }
  }
  if (good.length < k) fc(`only ${good.length} valid shards, need ${k}`);
  let cipher; try { cipher = rsDecode(good, k); } catch (e) { fc('decode failed: ' + e.message); }
  if (!H(cipher).equals(Buffer.from(manifest.cipher_hash, 'hex'))) fc('cipher_hash mismatch');
  let bytes; try { bytes = decryptState(cipher, secret); } catch { fc('decryption failed (wrong secret or tamper)'); }
  if (!H(bytes).equals(aRoot)) fc('recovered state root != anchor');           // the final integrity gate
  const prefix = 'everark\0';
  if (bytes.subarray(0, prefix.length).toString('utf8') !== prefix) fc('canon prefix missing');
  return JSON.parse(bytes.subarray(prefix.length).toString('utf8'));
}

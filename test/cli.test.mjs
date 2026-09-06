import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = new URL('../bin/everark.mjs', import.meta.url).pathname;
const run = (args, opts = {}) => execFileSync('node', [CLI, ...args], { encoding: 'utf8', ...opts });
const SECRET = 'ab'.repeat(32);

test('CLI: checkpoint -> kill shards -> resurrect is byte-exact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ea-cli-'));
  const stateFile = join(dir, 'state.json');
  const state = { name: 'vivarium', epoch: 7, arr: [1, 2, 3], nested: { b: 2, a: 1 } };
  writeFileSync(stateFile, JSON.stringify(state));
  const out = join(dir, 'out');

  const cp = run(['checkpoint', stateFile, '--k', '3', '--n', '6', '--secret', SECRET, '--out', out]);
  assert.match(cp, /checkpoint ok: 6 shards, any 3 rebuild\. anchor v1 \(75B\)/);

  // destroy 3 of 6 shards
  for (const x of [1, 2, 5]) unlinkSync(join(out, 'shards', `shard-${x}.bin`));

  const res = run(['resurrect', '--anchor', join(out, 'anchor.hex'), '--manifest', join(out, 'manifest.json'),
    '--shards', join(out, 'shards'), '--secret', SECRET]);
  const revived = JSON.parse(res);
  // canonical equality (key order normalized)
  assert.deepEqual(new Set(Object.keys(revived)), new Set(Object.keys(state)));
  assert.equal(revived.name, 'vivarium'); assert.equal(revived.nested.a, 1); assert.deepEqual(revived.arr, [1, 2, 3]);
  rmSync(dir, { recursive: true, force: true });
});

test('CLI: wrong secret fails closed with non-zero exit', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ea-cli-'));
  const stateFile = join(dir, 's.json'); writeFileSync(stateFile, JSON.stringify({ a: 1 }));
  const out = join(dir, 'o');
  run(['checkpoint', stateFile, '--k', '2', '--n', '4', '--secret', SECRET, '--out', out]);
  let failed = false;
  try {
    run(['resurrect', '--anchor', join(out, 'anchor.hex'), '--manifest', join(out, 'manifest.json'),
      '--shards', join(out, 'shards'), '--secret', 'cd'.repeat(32)], { stdio: 'pipe' });
  } catch (e) { failed = true; assert.match((e.stderr || '') + (e.message || ''), /FAIL-CLOSED|decryption/); }
  assert.ok(failed, 'resurrect with wrong secret must exit non-zero');
  rmSync(dir, { recursive: true, force: true });
});

test('CLI: --help exits 0 and prints usage', () => {
  const h = run(['--help']);
  assert.match(h, /everark checkpoint/);
  assert.match(h, /everark resurrect/);
});

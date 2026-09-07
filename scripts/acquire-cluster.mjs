// Acquire the remaining EverArk cluster hosts and complete orders.json.
// Skips hosts already in orders.json (by _host). Spends EVR (one acquire per new host).
// Needs env: EV_TENANT_SECRET + EV_USER_PRIVATE_KEY (same as evdevkit acquire).
// Reads the client key from ~/.ev_user_key to fill orders.json (keeps it out of the console).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const hostsFile = join(ROOT, 'john-hosts.txt');
const ordersFile = join(ROOT, 'orders.json');
const userKeyFile = join(homedir(), '.ev_user_key');

const hosts = readFileSync(hostsFile, 'utf8').trim().split('\n').map(s => s.trim()).filter(Boolean);
const userKey = existsSync(userKeyFile) ? readFileSync(userKeyFile, 'utf8').trim() : (process.env.EV_USER_PRIVATE_KEY || '');
if (!userKey) { console.error('no client key: ~/.ev_user_key missing and EV_USER_PRIVATE_KEY unset'); process.exit(1); }

let orders = existsSync(ordersFile) ? JSON.parse(readFileSync(ordersFile, 'utf8')) : [];
const have = new Set(orders.map(o => o._host));
let x = orders.reduce((m, o) => Math.max(m, o.x), 0);

for (const h of hosts) {
  if (have.has(h)) { console.log('skip (already acquired):', h); continue; }
  x += 1;
  console.log(`\n=== acquiring x=${x} on ${h} ===`);
  let out;
  try { out = execFileSync('evdevkit', ['acquire', h, '-m', '1'], { encoding: 'utf8', env: process.env }); }
  catch (e) { console.error(`acquire FAILED on ${h}:\n`, (e.stdout || '') + (e.stderr || e.message)); console.log('continuing with the hosts already acquired…'); break; }
  const pk = (out.match(/pubkey:\s*'([0-9a-fA-F]+)'/) || [])[1];
  const up = (out.match(/user_port:\s*'?(\d+)'?/) || [])[1];
  const dom = (out.match(/domain:\s*'([^']+)'/) || [])[1];
  if (!pk || !up || !dom) { console.error('PARSE FAIL — raw output:\n', out); process.exit(1); }
  orders.push({ x, ip: dom, port: Number(up), instancePubKey: pk, userPrivKey: userKey, _host: h });
  writeFileSync(ordersFile, JSON.stringify(orders, null, 2));
  console.log(`  ok x=${x}  ${dom}:${up}`);
}

// backfill the client key on every entry (e.g. the seeded host 1)
for (const o of orders) if (!o.userPrivKey) o.userPrivKey = userKey;
writeFileSync(ordersFile, JSON.stringify(orders, null, 2));
console.log(`\norders.json complete: ${orders.length} hosts (x=1..${orders.length}).`);
console.log('hosts:', orders.map(o => `${o.x}:${o.ip}`).join('  '));

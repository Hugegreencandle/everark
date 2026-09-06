// Watch everhostx pricing: poll /catalog until it returns a real price (stops erroring
// "No RLUSD to EVR rate"), then exit 0 so the caller is re-invoked to proceed with renting.
const url = 'https://everhostx.com/catalog';
const started = Date.now();
async function once() {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'kvt-everark-watch' } });
    const t = await r.text();
    if (r.status === 200 && !/No RLUSD to EVR rate/i.test(t)) { console.log('EVERHOSTX PRICING BACK:', r.status, t.slice(0, 200)); return true; }
    return false;
  } catch { return false; }
}
const mins = Number(process.argv[2] || 10);
console.log(`watching ${url} every ${mins}m (was: No RLUSD to EVR rate)`);
for (;;) {
  if (await once()) { console.log('recovered after', Math.round((Date.now() - started) / 60000), 'min — ready to rent (see RENTING.md)'); process.exit(0); }
  process.stdout.write('.');
  await new Promise(r => setTimeout(r, mins * 60000));
}

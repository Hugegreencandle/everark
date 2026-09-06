# EverArk — pre-release panel (v0.2, 2026-09-07)

Second review pass after the v0.2 build (CLI, anchor version byte, equalsState/types, size cap). Panel lenses:
release engineer, security reviewer, DX/adoption, and a skeptic. Focus: anything left before making the repo public.

## Defect found and FIXED this pass
- **Demo printed a garbled "anchored state root."** After the anchor gained a version byte (v1, 75B), the demo
  still read the root at offset 0, so it displayed `[version byte + 31 root bytes]`. Resurrection was unaffected
  (it is version-aware) and still byte-exact, but the shown root was wrong. Fixed with a `rootOf()` offset helper;
  anchored root now equals revived root. *(Release engineer: exactly why you re-run the flagship demo before shipping.)*

## Recommendations — do BEFORE release (cheap, matter for a public security primitive)
1. **SECURITY.md** — responsible-disclosure contact + a short **security model**: the 32-byte secret is the single
   point of failure (lose it → no resurrection; leak it → state readable); anchor trust is the whole basis; testnet
   only. On-brand for KVT and expected of a security repo. **(building now)**
2. **Automated CLI test** — the CLI is only manually smoke-tested; a test locks checkpoint→resurrect so it can't
   silently break. **(building now)**
3. **CHANGELOG.md** — v0.1 (core) → v0.2 (CLI/version/types/cap). **(building now)**
4. **CI** (`.github/workflows/ci.yml` running `npm test` on push/PR) + a Node `engines` field. Catches regressions,
   signals maturity. **(building now)**
5. **README title/quickstart** — retitle from "MVP core" to a crisp one-liner + install/quickstart + links to
   WIRE_FORMAT / SECURITY / ROADMAP. **(building now, light)**
6. Factual drift fixed this pass: package.json description ("74-byte" → "compact root"); `.gitignore` now excludes
   the CLI's `everark-out/`.

## Recommendations — AFTER release / need a decision
7. **Publish to npm** so it's `npx everark` — biggest adoption lever, but needs an npm account + name check. (Dane)
8. **Known-answer test vectors (KATs)** — a fixed (state, secret) → (anchor, manifest, shards) fixture so a
   third-party reimplementation can prove wire-compatibility. Strengthens WIRE_FORMAT as an adoptable format. MED.
9. **examples/** with a runnable sample state; **CONTRIBUTING.md / CODE_OF_CONDUCT** only if courting contributors.
10. Independent-host custody (roadmap #2) — still blocked on a liquid Evernode host market; harness ready.

## Skeptic's honest note
The core has now had two adversarial passes and is sound/fail-closed; the remaining work is packaging and DX, not
soundness. Don't let polish delay a decision — the repo is safe to publish today. The one substantive open item is
independent-host custody, which is a live-network dependency, not a code gap.

## Verdict
Ship-ready after items 1–6 (all cheap, being applied now). 7–10 are post-release choices.

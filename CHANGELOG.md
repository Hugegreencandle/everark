# Changelog

All notable changes to EverArk. Early experiment; Xahau testnet only.

## [0.2.0] — 2026-09-07
### Added
- CLI (`bin/everark.mjs`): `everark checkpoint` and `everark resurrect`, no dependencies.
- Anchor **version byte**: v1 (75 bytes) is now the default; legacy v0 (74 bytes) is still read, and
  `checkpoint(..., { version: 0 })` still emits it. Wire format documented in `WIRE_FORMAT.md`.
- `equalsState(a, b)` helper and TypeScript types (`index.d.ts`).
- `SECURITY.md` (disclosure + security model), `CHANGELOG.md`, CI, automated CLI tests.
### Changed
- `resurrect` enforces a recovery size cap (`n * blk <= 64 MiB`), fail-closed.
### Fixed
- Demo displayed a wrong "anchored state root" under v1 anchors (offset off by one); resurrection was unaffected.

## [0.1.0] — 2026-09-06
- Core: canonical serialization, GF(256) Reed-Solomon (any k of n), aes-256-gcm, full-manifest binding under a
  74-byte anchor, fail-closed resurrection. Live testnet resurrection proven. Red-teamed.

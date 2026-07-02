# controlled-vocab
<!-- Generated file — edit the source area record and regenerate; do not edit by hand. -->

The controlled-vocabulary subsystem is cross-cutting (not a single package): the stable
enumerations the system uses for work-record authoring, dispatch readiness, and runtime
diagnostics. It is frequently misread as a large up-front classification burden. In practice
it splits into a small ROUTINE author-facing subset plus a larger set of system-EMITTED
diagnostics that are read only as-needed (when a gate fires), not authored.

## Public Surface

Sources of truth (for any future count, read these — do not estimate):
- `packages/wiki-core/data/runtime-blocker-codes.v1.json` — the 33-code runtime-blocker taxonomy.
- `packages/wiki-core/src/lib/work-record-schema-constants.mjs` — author-facing work-record enums.
- `packages/wiki-core/src/lib/work-record-admission-decision-codes.mjs` and
  `packages/wiki-core/src/lib/work-record-dispatch.mjs` — admission / dispatch decision codes.

## Roadmap

Directional open work for this area. Ordered by dependency when available; otherwise by a stable fallback. This is not a delivery schedule.

- No open work is currently mapped to this area.

## Related Docs

- [Package Install](../../../docs/package-install.md)
- [operating-model.md](../../../docs/operating-model.md)

# @agent-chassis/wiki-core
<!-- Generated file — edit the source area record and regenerate; do not edit by hand. -->

`packages/wiki-core` is the canonical substrate for the repo's knowledge-and-coordination
system. It owns the `work-record.v1` JSON schema, parser, validator, and
Markdown/agent-brief renderer; the deterministic dispatch-readiness / blast-radius /
worker-admission evidence pipeline; the generated-view and lint operations
(catalog/now/backlog/summary plus the freshness model); and the read-only code-index /
graph-impact ("sidecar") retrieval layer. JSON records are canonical; Markdown and
generated views are projections, never authority. The `wiki-cli` and `wiki-mcp` packages
are thin surfaces over these operations.

## Exports

- `packages/wiki-core/src/index.mjs` — public export surface.
- `packages/wiki-core/src/operations/` — verbs: validate, generate, lint, dispatch
  readiness, work-record edits, graph-impact persistence.
- `packages/wiki-core/src/lib/` — core libraries: schema, parser, renderer, sidecar
  graph-impact, worker-admission evidence.
- `packages/wiki-core/contract/` and `packages/wiki-core/data/` — the schema manifest,
  templates, and controlled-vocabulary data.

## Package Role

This package is installed through `@agent-chassis/core` for normal use. It remains available as a granular package for consumers that need direct package control.

## Related Docs

- [Package Install](../../docs/package-install.md)
- [work-record-ontology.md](../../docs/work-record-ontology.md)
- [operating-model.md](../../docs/operating-model.md)

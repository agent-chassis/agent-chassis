# @agent-chassis/wiki-cli
<!-- Generated file — edit the source area record and regenerate; do not edit by hand. -->

`packages/wiki-cli` is the human / operator command-line surface (`wiki` bin) over the
`wiki-core` substrate: create / validate / migrate work records, generate views, lint,
search / read, run code-index and graph-impact queries, and check dispatch readiness. CLI
forms are operator examples and fallbacks — agents use the structured MCP routes
(`wiki-mcp`), not the CLI, for schema-validated workspace actions. It depends only on `wiki-core`.

## Entry Points

Entry points:
- `packages/wiki-cli/src/index.mjs` — the `wiki` command bin.
- `packages/wiki-cli/src/commands/` — per-command modules (work-records, generate, lint,
  search, sidecar / code-index, dispatch).

`npm run wiki -- <command>` forms in docs are operator/human usage; they are not an agent
authority surface.

## Package Role

This package is installed through `@agent-chassis/core` for normal use. It remains available as a granular package for consumers that need direct package control.

## Related Docs

- [Package Install](../../docs/package-install.md)
- [operating-model.md](../../docs/operating-model.md)
- [mcp-integration.md](../../docs/mcp-integration.md)

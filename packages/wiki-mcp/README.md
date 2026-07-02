# @agent-chassis/wiki-mcp
<!-- Generated file — edit the source area record and regenerate; do not edit by hand. -->

`packages/wiki-mcp` is the stdio MCP server that exposes the `wiki-core` substrate to
repository-aware agents. It wraps the canonical work-record, retrieval, dispatch-readiness,
generate/lint, and code-index / graph-impact operations as workspace-scoped `workspace_*`
MCP tools, plus the structured agent-dispatch, tool-discovery, and agent-faq surfaces. JSON
work records stay canonical; this package is transport, not authority. It depends on
`wiki-core` (operations) and on `agent-launch-core` / `agent-launch-cli` for the dispatch
and launch path.

## Entry Points

Entry points:
- `packages/wiki-mcp/src/server.mjs` — the `wiki-mcp` server bin and the tool-registration
  surface (source-scanned by a registration test).
- `packages/wiki-mcp/src/lib/` — per-tool modules (code-index, agent-dispatch, agent-faq,
  work-record edit routes).

Workspace tools take a `repo` alias, never a caller-supplied filesystem path. CLI forms in
the docs are operator examples, not agent authority.

## Package Role

This package is installed through `@agent-chassis/core` for normal use. It remains available as a granular package for consumers that need direct package control.

## Related Docs

- [Package Install](../../docs/package-install.md)
- [mcp-integration.md](../../docs/mcp-integration.md)
- [tool-discovery.md](../../docs/tool-discovery.md)

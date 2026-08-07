# Tool Discovery Fragment Registry

Backlink: [Tool Discovery v1](tool-discovery.md).

This page is the canonical reference for the checked-in fragment registry that
assembles into the `tool-discovery.v1` descriptor: the fragment layout, the
deterministic manifest order, duplicate `tool_name` handling, descriptor digest
semantics, and package install expectations.

## Canonical Fragment Registry

The canonical checked-in registry is a set of JSON fragments under
`packages/wiki-core/data/tool-discovery/`, assembled at load time into one
`tool-discovery.v1` descriptor. There is no monolithic descriptor file; the
assembled fragment registry is the only canonical tool-discovery data source.

### Fragment Layout

The fragment directory contains a manifest plus one fragment file per tool
family:

- `packages/wiki-core/data/tool-discovery/manifest.json` — names the fragment
  files in canonical order, carries the canonical per-fragment `tool_count`
  values and the `expected_tool_count` corpus total, and is the registry
  identity anchor.
- `packages/wiki-core/data/tool-discovery/mcp-tools.json` — MCP discovery,
  router, read, search, wiki hygiene, docs-policy, and contract-manifest tools.
- `packages/wiki-core/data/tool-discovery/mcp-work-record-tools.json` — MCP
  work-record evidence and review-result recording tools.
- `packages/wiki-core/data/tool-discovery/mcp-launcher-tools.json` — MCP
  launcher, runtime diagnostic, dispatch-readiness, and validation-run tools.
- `packages/wiki-core/data/tool-discovery/mcp-coordination-tools.json` — MCP
  initiative and integration status coordination tools.
- `packages/wiki-core/data/tool-discovery/tool-usage-audit-tools.json` —
  tool-use audit observability tools.
- `packages/wiki-core/data/tool-discovery/work-record-core-mcp-tools.json` —
  MCP work-record create, validate, status, task, closure, and summary routes.
- `packages/wiki-core/data/tool-discovery/work-record-core-cli-tools.json` —
  operator-shell wiki CLI fallbacks for work-record summary, issue creation,
  validate, status, task, closure, and Markdown-to-JSON migration.
- `packages/wiki-core/data/tool-discovery/work-record-edit-mcp-tools.json` —
  MCP work-record derived-evidence refresh/cleanup and structured slice,
  list-field, acceptance, and review-unit editing tools.
- `packages/wiki-core/data/tool-discovery/work-record-edit-cli-tools.json` —
  operator-shell wiki CLI fallbacks for work-record derived-evidence
  refresh/cleanup and structured slice, list-field, acceptance, and review-unit
  editing.
- `packages/wiki-core/data/tool-discovery/code-index-tools.json` — code-index
  and graph-impact tools across MCP and CLI.
- `packages/wiki-core/data/tool-discovery/launcher-tools.json` — dispatch,
  run-status, coordination preflight, and runtime-blocker-taxonomy tools.
- `packages/wiki-core/data/tool-discovery/cli-commands.json` — wiki and
  agent-launch CLI command rows.
- `packages/wiki-core/data/tool-discovery/integration-tools.json` —
  integration-scoped local coordination tools when present, including read-only
  coordination checks for WK-to-integration promotion readiness.
- `packages/wiki-core/data/tool-discovery/wrapper-commands.json` — empty
  historical role-wrapper fragment retained for manifest-order stability after
  the family-role wrapper commands were removed from package source.

The manifest is the canonical source for the per-fragment counts and the
corpus total; treat its `tool_count`/`expected_tool_count` values as
authoritative rather than any count repeated in prose. Each `tool_name` is owned
by exactly one fragment; a fragment must not repeat a `tool_name` that appears in
any sibling fragment.

### Deterministic Fragment Order

Fragment assembly order is fixed by the manifest, not by filesystem read order,
directory listing order, or glob expansion. The canonical order is:

1. `mcp-tools.json`
2. `mcp-work-record-tools.json`
3. `mcp-launcher-tools.json`
4. `mcp-coordination-tools.json`
5. `tool-usage-audit-tools.json`
6. `work-record-core-mcp-tools.json`
7. `work-record-core-cli-tools.json`
8. `work-record-edit-mcp-tools.json`
9. `work-record-edit-cli-tools.json`
10. `code-index-tools.json`
11. `launcher-tools.json`
12. `cli-commands.json`
13. `integration-tools.json` when listed by the manifest
14. `wrapper-commands.json`

The four `work-record-*` fragments occupy, in that order, the single manifest
position the former `work-record-tools.json` held. They were split apart along
surface and family boundaries (core lifecycle vs. structured editing, MCP vs.
CLI fallback) so no single fragment sits against the write-scope LOC deny band
that would make it unwritable. Because the split preserved entry order, the
assembled corpus and `descriptor.digest` are unchanged by it.

The loader assembles fragments strictly in manifest order so the assembled
descriptor — and therefore its digest — is reproducible across machines and
checkouts. Manifest order fixes assembly and digest determinism; it does not
change query ranking, which remains governed by the
`priority`/`tool_name`/`entrypoint` rules in [Ranking And Query
Behavior](tool-discovery.md#ranking-and-query-behavior).

### Duplicate `tool_name` Handling

`tool_name` is unique across the whole assembled corpus. A duplicate
`tool_name` — whether repeated within one fragment or appearing in two
fragments — is a fragment-corpus integrity error, not a last-writer-wins
merge. The loader exposes a validation hook that fails (or emits a
deterministic diagnostic) on a duplicate `tool_name` rather than silently
collapsing or overwriting entries. The same posture applies to invalid
fragment shape, invalid tool entries, and partial-corpus fixture omissions:
these are surfaced as validation failures, not silently tolerated.

### Descriptor Digest Semantics

The descriptor digest is computed over the assembled descriptor — the
fragments combined in manifest order — not over any single fragment file and
not over an arbitrary filesystem read order. Because assembly order is fixed by
the manifest, the same fragment contents always produce the same digest. The
`descriptor.path` field in the discovery envelope identifies the assembled
fragment registry by its manifest
(`packages/wiki-core/data/tool-discovery/manifest.json`), and
`descriptor.digest` is the digest of the assembled corpus. The runtime MCP
envelope reports the same digest as the checked-in fragment registry whenever
the runtime data matches the checked-in fragments; a divergence is a freshness
problem (`descriptor_digest_mismatch`), exactly as for the prior monolithic
descriptor.

### Package Install Expectations

The fragment directory ships as package data with `wiki-core`. A published
install must contain `packages/wiki-core/data/tool-discovery/manifest.json` and
every fragment file listed by that manifest, resolved package-relative — the
same install-layout asset-resolution contract for the relocated `contract/`
tree and the other checked-in descriptors. The loader resolves the manifest
and fragments relative to the installed `wiki-core` package, not the monorepo
working tree, so discovery behaves identically from a published tarball and
from the repo checkout. Explicit `descriptorPath` loading of a single
full-descriptor JSON remains supported only for tests and fixtures (or through
a clearly exposed replacement explicit-load API); it is not the default
runtime data path, and a fixture file named `tool-discovery.v1.json` inside a
test is not a live aggregate dependency.

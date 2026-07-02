
# Agent orientation

This page orients agents working in `agent-chassis`, the
source-available AgentChassis repository. It explains what the major docs,
packages, wiki records, generated views, and tool surfaces are for.

The repo-root `AGENTS.md` is the operating contract. This page is the map of the
repo.

## Repo layers

- `docs/` — durable system knowledge, public docs, operator docs, and technical
  contracts.
- `packages/wiki-core/` — shared wiki contract logic: schemas, templates, lint,
  generation, search, work-record handling, tool-discovery data, and code-index
  contracts.
- `packages/wiki-cli/` — the `wiki` operator/CI CLI over `wiki-core`.
- `packages/wiki-mcp/` — the agent-facing stdio MCP server over the same
  `wiki-core` behavior.
- `packages/agent-launch-core/` — shared launcher policy, model/config
  resolution, dispatch-runtime vocabulary, and backend contracts.
- `packages/agent-launch-cli/` — the `agent-launch` operator entrypoints,
  orchestrator launch/resume/list, and launcher-controlled role dispatch
  runtime.
- `wiki/work-records/` — canonical `WK-*` work contracts in JSON.
- `wiki/initiatives/`, `wiki/decisions/`, `wiki/areas/`, and `wiki/sources/` —
  durable coordination, design history, subsystem boundaries, and evidence.
- `wiki/catalog.md`, `wiki/now.md`, `wiki/backlog.md`, `wiki/inbox.md`, and
  `wiki/archive.md` — generated navigation views. Read them for orientation;
  do not treat them as independent authority.

## Core docs by topic

- Product overview and public positioning: [README.md](../README.md).
- First setup path: [quickstart.md](quickstart.md).
- Package roles and npm distribution: [package-install.md](package-install.md)
  and [local-package-install.md](local-package-install.md).
- Shared-substrate vs. consuming-repo boundary:
  [operating-model.md](operating-model.md).
- Free/source-available local tier vs. hosted Chassis Control Engine:
  [enforcement-model.md](enforcement-model.md).
- Versioning and migration posture: [versioning.md](versioning.md).
- MCP setup and agent-facing tool model:
  [mcp-integration.md](mcp-integration.md),
  [tool-discovery.md](tool-discovery.md), and
  [mcp-operation-reference.md](mcp-operation-reference.md).
- Launcher and dispatch runtime:
  [agent-launch-quickstart.md](agent-launch-quickstart.md),
  and [agent-launch-operator-entrypoints.md](agent-launch-operator-entrypoints.md).
- Work-record schema and coordination semantics:
  [work-record-ontology.md](work-record-ontology.md) and
  [initiative-status.md](initiative-status.md).
- Repo-local wiki structure and consumer-owned docs:
  [areas.md](areas.md),
  [consumer-owned-docs.md](consumer-owned-docs.md), and
  [wiki-contract-metadata.md](wiki-contract-metadata.md).

## Package README roadmaps

Package README roadmaps are generated from canonical work records. Use them for
per-package open-work orientation, then open the underlying `WK-*` records before
acting.

- `packages/wiki-core/README.md`
- `packages/wiki-mcp/README.md`
- `packages/wiki-cli/README.md`
- `packages/agent-launch-core/README.md`
- `packages/agent-launch-cli/README.md`

For the cross-cutting repo view, use the generated `wiki/now.md` and
`wiki/backlog.md` views as navigation, then read the canonical records they
point to.

## How to navigate this repo

1. Use `workspace_search_repo` for docs/wiki questions.
2. Open the selected canonical page with `workspace_read_page`.
3. Use generated views only as navigation into canonical docs and wiki records.
4. Load known `WK-*` records with `workspace_work_record_summary` or
   `workspace_get_record`.
5. Use tool discovery before choosing an agent-facing tool:
   `workspace_tools_list`, `workspace_tools_query`, then
   `workspace_tools_describe` for targeted detail.
6. Use code-index and graph-impact tools before moving from docs/records into
   implementation files.
7. Inspect package source only after the canonical docs or records identify the
   relevant implementation surface.

## Authority boundaries

- `docs/` is the durable knowledge layer.
- `wiki/work-records/WK-*.json` is the canonical task/contract layer.
- `wiki/initiatives/`, `wiki/decisions/`, `wiki/areas/`, and `wiki/sources/`
  are durable coordination and design context.
- Generated views and package README roadmaps are projections, not the source of
  record.
- `.agent-runs/`, local caches, generated sidecars, and runtime artifacts are
  evidence or navigation only unless a canonical doc or work record says
  otherwise.

## Role and tool boundaries

Agents use structured MCP tools for repo/wiki work when those tools are
available. Do not infer support from package manifests, wrapper filenames,
executable bits, generated examples, or historical work records.

Worker, reviewer, and redteam dispatch goes through `workspace_agent_dispatch`.
Monitor those runs with `workspace_agent_run_status` or
`workspace_agent_run_wait`. Operator shell wrappers and package-file-only role
shims are inventory/debug surfaces, not agent dispatch authority.

Orchestrators are human/operator-launched through `agent-launch`. Agents do not
start or resume orchestrators from inside an agent session.

## When editing this repo

- Start from the relevant durable doc and canonical `WK-*` record.
- Keep docs changes in `docs/` and coordination changes in `wiki/`; do not use
  generated views as edit targets.
- Use allocator-backed creation for new `WK-*`, `IN-*`, `DEC-*`, `SRC-*`, and
  area records.
- After structural wiki changes, use the structured generate/lint route so
  generated views stay aligned.
- If a task changes launcher behavior, dispatch authority, local/hosted tier
  semantics, or work-record protocol, update the durable docs in the same
  change.

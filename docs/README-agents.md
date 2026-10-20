
# Agent orientation

This page orients agents working in `agent-chassis`, the
source-available AgentChassis repository. It explains what the major docs,
packages, wiki records, generated views, and tool surfaces are for.

The repo-root `AGENTS.md` is the operating contract. This page is the map of the
repo.

## Repo layers

Package paths on this page refer to the source checkout; linked public docs
are also available in the installed core package.

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
- `packages/controlled-contract/` — controlled-contract validation, reusable
  proof definitions, and proof-plan assessment. Candidate execution and runtime
  observation collection are separate launcher responsibilities.
- `wiki/work-records/` — canonical `WK-*` work contracts in JSON.
- `wiki/initiatives/`, `wiki/decisions/`, `wiki/areas/`, and `wiki/sources/` —
  durable coordination, design history, subsystem boundaries, and evidence.
- `wiki/catalog.md`, `wiki/now.md`, `wiki/backlog.md`, `wiki/inbox.md`, and
  `wiki/archive.md` — generated navigation views. Read them for orientation;
  do not treat them as independent authority.

Work contracts define assignments, scope, deliverables and dependencies.
Controlled acceptance states required behavior, the claims that need proof
(proof obligations), and how evidence must establish particular properties.
Work records connect those requirements and obligations to assigned work.

Assessing an authored contract checks its declared structure, completeness and
proof selections; it cannot discover unauthored requirements or establish
implementation behavior. Certifying a reusable proof definition establishes
declaration adequacy under its stated authority and exclusions. Candidate
verification evaluates evidence bound to the tested source; a passing test
alone does not establish requirement satisfaction.

## Understanding the implementation

- Controlled-contract representation and assessment:
  [packages/controlled-contract/](https://github.com/agent-chassis/agent-chassis/tree/main/packages/controlled-contract)
  (source repository).
- Requirement and proof authoring:
  [mcp-controlled-contract-operations.md](mcp-controlled-contract-operations.md).
- Acceptance criteria and proof obligations:
  [acceptance-coverage-mcp.md](acceptance-coverage-mcp.md).
- Current proof definitions, parameters and exclusions:
  [proof-pack-parameters.md](proof-pack-parameters.md) and its
  [per-definition index](proof-pack-parameters/index.md).
- Runtime verification and interpretation of results:
  [test-proof-execution.md](test-proof-execution.md) and
  [test-proof-results.md](test-proof-results.md).
- Work coordination: `packages/wiki-core/` and `packages/agent-launch-core/`;
  [work-record-ontology.md](work-record-ontology.md) and
  [initiative-status.md](initiative-status.md) explain coordination semantics.

For an architectural assessment, examine both work orchestration and controlled
acceptance. Trace requirements through proof selection, contract assessment,
runtime evidence and acceptance coverage, checking what each stage establishes
and excludes. Use this map for investigation; routine operational tasks follow
their granted tools and returned next calls.

## Core docs by topic

- Product overview and public positioning: [README.md](../README.md).
- First setup path: [quickstart.md](quickstart.md).
- Package roles and npm distribution: [package-install.md](package-install.md)
  and [local-package-install.md](local-package-install.md).
- Shared-substrate vs. consuming-repo boundary:
  [operating-model.md](operating-model.md).
- Admission authority and enforcement facts:
  [enforcement-model.md](enforcement-model.md).
- Versioning and migration posture: [versioning.md](versioning.md).
- MCP setup and agent-facing tool model:
  [mcp-integration.md](mcp-integration.md),
  [tool-discovery.md](tool-discovery.md), and
  [mcp-operation-reference.md](mcp-operation-reference.md).
- Launcher and dispatch runtime:
  [agent-launch-quickstart.md](agent-launch-quickstart.md),
  and [agent-launch-operator-entrypoints.md](agent-launch-operator-entrypoints.md).
- Repo-local wiki structure and consumer-owned docs:
  [areas.md](areas.md),
  [consumer-owned-docs.md](consumer-owned-docs.md), and
  [wiki-contract-metadata.md](wiki-contract-metadata.md).

## Public packages and repository-local coordination

The installed core package carries public `docs/` and selected package-owned
references. This source repository's `wiki/decisions/`, work records, generated
views and `internal/` material are not bundled public guidance. A decision ID
may explain provenance, but an installed consumer cannot be required to open
that private decision or a source-repository roadmap to complete setup.

For this source checkout, generated package README roadmaps and wiki views are
navigation into canonical records. For an installed consumer, use the public
[documentation index](index.md), the session's supplied role guide and its own
canonical records.

## How to navigate a managed session

1. Read known records with `workspace_read_wiki({subject})`; use its `search`
   input for unknown identities. Follow the returned selection to read the
   chosen document or guidance completely.
2. Use the selected record's current combined revision and input contract for
   `save_record`; use `workspace_create_record` for allocation.
3. Read the host-selected guide and authoring vignette named at startup. Use this session’s supported selected schemas and authoring information. Preserve full written requirements, criteria, validation and scope. Missing capability chooses no exemption and establishes no readiness.

4. Inspect implementation with the family's repository read/search tools within
   its entitlement; use `query_code_index` only when actually granted. Record
   incomplete evidence rather than treating an empty search as complete coverage.
5. Start with `start_agent`, observe through `get_run_result`, and integrate
   explicitly through `integrate_work`. The [operation reference](mcp-operation-reference.md)
   owns the registered inventory. Retired help/router, shared reader and dispatch
   names are not indirect routes to a missing capability.

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
Published package capabilities do not grant session access: actual registration,
role and tier determine tool exposure. See
[tool-discovery-tiers.md](tool-discovery-tiers.md) for availability and the
[enforcement model](enforcement-model.md#registered-task-authority) for authority.

Worker, reviewer, and redteam dispatch goes through `start_agent`.
Observe those runs by canonical subject and returned attempt with `get_run_result`.
Operator shell wrappers and package-file-only role
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
- If a task changes launcher behavior, dispatch authority, session capability
  semantics, or work-record protocol, update the durable docs in the same
  change.

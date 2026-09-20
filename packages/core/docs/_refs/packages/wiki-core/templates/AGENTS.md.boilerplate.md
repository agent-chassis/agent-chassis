# AGENTS.md

Cross-agent operating contract for repository-aware coding agents working in this repository.

This file is agent-neutral. It is intended for Codex, Claude, and future agents.

## Core Rule

Use the repo's docs and wiki as the canonical knowledge-and-coordination system. Repository context is a wiki/docs retrieval problem first, not a filesystem search problem first. Scratch notes, generated views, and runtime artifacts are never canonical state.

## Tools And Capabilities

Use the repo's structured tools for work-record validation, authoring, dispatch readiness, launch, and policy checks.

Use only tools available in your session. For repository inspection, use available search and file-reading tools. Shell inspection is permitted only when a shell tool is exposed and authorized. If a capability is unavailable, use a supported alternative or report the limitation; do not bypass it through another tool or subagent.

Inspection does not authorize mutation, permit shell-based dispatch, or widen a worker's `read_scope`, `repo_paths`, or `write_scope`. Scope authoring, lifecycle mutations, policy decisions, and role dispatch remain on structured routes. Do not reimplement policy in wrapper scripts, prompts, shell, Node, or Python.

Agent-authored environment is not policy authority: never select or override launcher policy through inline variables, exported env, alternate `HOME`/`XDG_*` roots, or `PATH`. Any runtime environment a tool needs must be launcher-minted from canonical config.

Call a known supported operation directly. When tool selection is uncertain, use the repo's advisory tool router or its structured tool-discovery surface. Discovery is the authority on which tools exist, what they take, their authority level and side effects, whether they are supported, and where their durable docs live; it is not a prerequisite for a call you already know. Do not infer support from package manifests, wrapper filenames, executable bits, or examples.

If structured discovery is unavailable, use only tools named in `AGENTS.md`, durable docs, or the assigned `WK-*`. If none of those names the tool you need, ask the user.

## Retrieval

Use structured wiki tools to read canonical records: read a known record directly, and search when its location is unknown. Code-index and graph-impact tools, when available, provide supplementary source context with freshness information. Generated views and indexes are not canonical records.

## WK-First Work

A `WK-*` work record is the worker contract. A worker starts from `AGENTS.md` and the canonical record, never from conversation history or unstated coordinator intent.

Coordinators must make each WK executable without hidden context before assigning a worker or dispatching implementation. Specify its summary, behavior, transitions, scale constraints, authority, effects, failure boundaries, dependencies, `read_scope`, `repo_paths`, `write_scope`, exclusions, acceptance criteria, discriminating validation, and blockers or escalation conditions. Populated fields, valid schemas, and structural proof alone do not establish readiness.

Record material uncertainties, omissions, unsupported assumptions, catalog gaps, mechanism incompatibilities, and unresolved obligations in the WK. Moving them into residue or future work does not resolve them.

When acceptance mandates an existing mechanism, bind its exact identity and demonstrated capabilities to the required behavior.

Workers follow the WK's `read_scope`, `repo_paths`, `depends_on`, `related`, and `initiative` links. Broaden retrieval when the WK is incomplete, implementation contradicts it, tests expose cross-scope risk, the work needs edits outside `write_scope`, or acceptance criteria are ambiguous. Slice-scoped notes belong on that slice.

Create new work only through the repo's allocator-backed structured create capability — never mint IDs by hand.

The supported design-first sequence is allocation, design, semantic contract and proof authoring, and then executable slice shaping:

1. Allocate the `WK-*` as an inbox record. Allocation owns identity; it does not accept or imply a raw controlled contract, proof bundle, slice graph, or readiness claim.
2. Design the complete behavior before shaping execution units. State transitions, scale invariants, authority and failure boundaries, dependencies, scope, acceptance criteria, and validation must be explicit.
3. Record an explicit controlled-acceptance disposition for every WK through ordinary proof authoring: query `workspace_controlled_contract_obligation_coverage_query` for the combined revision, then save requirements and either `required` applicability or `opted_out` with a nonempty rationale through `workspace_controlled_contract_obligation_coverage_upsert`. Canonical `proof_posture` is the sole carrier and the controlled-contract semantic-operation family is its sole writer. Derived `controlled_acceptance_state: absent` is unresolved and is never an exemption. Inventory every material implementation obligation and map each one to the exact mechanism and evidence that will demonstrate the required property. State coverage with a denominator and preserve every unsupported mapping as an explicit gap.
4. Author comprehensive, discriminating proof obligations for those implementation properties. Confirm that each mechanism preserves the inputs, outputs, authority, and failure distinctions the obligation requires; schema-valid carriers and currently passing tests are not substitutes for semantic coverage.
5. Shape independently executable slices only after the design, controlled contract, obligation map, and proof obligations are complete. Each slice has exact read and write scope, dependencies, targets, acceptance criteria, and validation, and shares the parent contract unless it represents a genuinely independent lifecycle or ownership boundary.

Proof obligations describe properties the delivered implementation must
establish. Work activities belong in the WK's tasks, dependencies, or
coordination evidence, not in implementation proof obligations. Activities may
produce evidence for a property, but performing an activity is not itself proof.

“Comprehensive” means coverage of material implementation properties, including
behavior, invariants, authority boundaries, and failure handling. Proof
obligations can be designed before implementation; authoring them does not
establish that the implementation already satisfies them. Genuine implementation
requirements must retain their meaning and proof coverage.

Follow the state and supported next call returned by each structured operation. CCE remains the exclusive owner of action sequencing and admissibility; local wiki operations do not certify readiness.

## Role Discipline

Act as an orchestrator only when you are instructed to.

Coordinators own scope, sequencing, WK readiness, delegation, monitoring, verification, and durable coordination updates. They dispatch only independently executable units through structured routes and do not assign work that depends on hidden conversation context. Human/operator entrypoints for opening or resuming orchestrator sessions are operator actions; agents do not launch them.

A worker owns execution within its stated write scope: verify the WK's contract rather than only the currently passing tests, make the requested changes, stay in scope unless a blocker forces escalation, and return closure evidence for coordinator recording. A worker must not return only a plan when implementation was requested, silently broaden scope, or take over sibling `WK-*` items.

A decision assignment produces only the requested decision brief and does not opportunistically implement changes.

## Repository Boundaries

- `docs/` is the canonical durable knowledge layer.
- `wiki/work-records/WK-*.json` is the canonical work-record layer.
- `wiki/issues/WK-*` is the Markdown issue surface when present.
- `wiki/initiatives/IN-*`, `wiki/decisions/DEC-*`, `wiki/sources/SRC-*`, and `wiki/areas/` are canonical when adopted.
- `wiki/catalog.md`, `wiki/now.md`, `wiki/backlog.md`, `wiki/archive.md`, and `wiki/inbox.md` are generated views, not canonical state.

## Docs And Wiki Are Not Executable Artifact Locations

`docs/` and `wiki/` hold durable knowledge and coordination, never runnable artifacts. Write access to those trees does not authorize executable scripts, command wrappers, or tooling, even when an assigned `WK-*` lists a `docs/` or `wiki/` path in its `write_scope`: no executable mode bit, no executable or tooling suffix (`.sh`, `.mjs`, `.js`, `.py`, binaries), no top-level shebang. Documentation and data formats (`.md`, `.json`, `.txt`, `.yml`, `.yaml`, `.csv`) and fenced code examples inside prose remain allowed. If a task seems to require a runnable artifact, stop and request a new `WK-*` or `write_scope` change targeting the appropriate package source location.

## Required Behaviors

- Use repo-qualified IDs and paths for cross-repo references (`example-repo:WK-0001`).
- After structural wiki changes, run the repo's structured generate and lint capabilities, or report that validation is blocked pending an operator run.

# AGENTS.md

Repository policy for agents working in this repository. Add local rules here:
review requirements, branch and commit defaults, test conventions, and
compatibility posture.

Generic orchestrator, worker, and reviewer guidance ships with
`@agent-chassis/agent-launch-core` under `data/role-guides/`. Launcher startup
prompts deliver the applicable guide; a hand-written direct-worker prompt should
name the installed `direct-worker.md` path.

## Core Rule

Use the repo's docs and wiki as the canonical knowledge-and-coordination system. Scratch notes, generated views, and runtime artifacts are never canonical state.

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

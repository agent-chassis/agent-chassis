# AGENTS.md

Repository policy for agents working in this repository. Add local rules here:
review requirements, branch and commit defaults, test conventions, and
compatibility posture.

Generic orchestrator, worker, and reviewer guidance ships with
`@agent-chassis/agent-launch-core` under `data/role-guides/`. Launcher startup
prompts deliver the applicable guide.

## Core Rule

Use the repo's docs and wiki as the canonical knowledge-and-coordination system. Scratch notes, generated views, and runtime artifacts are never canonical state.

## Repository Boundaries

- `docs/` is the canonical durable knowledge layer.
- `wiki/work-records/WK-*.json` is the canonical work-record layer.
- `wiki/issues/WK-*` is the Markdown issue surface when present.
- `wiki/initiatives/IN-*`, `wiki/decisions/DEC-*`, `wiki/sources/SRC-*`, and `wiki/areas/` are canonical when adopted.
- `wiki/catalog.md`, `wiki/now.md`, `wiki/backlog.md`, `wiki/archive.md`, and `wiki/inbox.md` are generated views, not canonical state.

## Artifact Ownership And Role Boundaries

AgentChassis artifact lint covers its dedicated record, contract, template and generated storage namespaces, runtime metadata and generated wiki views. Native `docs/`, consumer-owned wiki prose and declared extension content are outside that artifact policy by default; existing structural, schema and reference checks continue. Repositories may add concrete directories through the closed local `artifactLint.additionalRoots` setting in `wiki/.wiki-contract.json`. Bootstrap and sync preserve that setting without imposing this source repository's broader documentation policy on consumers. Selected content permits documentation/data formats (`.md`, `.json`, `.txt`, `.yml`, `.yaml`, `.csv`), placeholders and fenced examples; executable modes, tooling suffixes and byte-zero shebangs are findings.

Coordinators do not write runnable product artifacts. A `docs/` or `wiki/` write scope alone does not authorize executable tooling in governed storage. If an assignment needs runnable output beyond its authorized scope, request scope targeting the appropriate package source. Artifact lint reports maintenance findings; it creates no local admission or lifecycle refusal authority, which remains with CCE.

## Required Behaviors

- Use repo-qualified IDs and paths for cross-repo references (`example-repo:WK-0001`).
- After structural wiki changes, run the repo's structured generate and lint capabilities, or report that validation is blocked pending an operator run.

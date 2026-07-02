# Consumer-Owned Docs

This document explains how consuming repositories should use and maintain repo-local wiki guidance without forking the shared contract.

## Why These Docs Exist

`agent-chassis` owns the shared contract, templates, allocator behavior, lint rules, generation rules, and MCP/CLI interfaces.

Consuming repositories still need local documentation that explains:

- how that repo uses the shared contract
- which profile it has adopted
- which extension namespaces it declares
- which local retrieval and operating choices it makes
- which repo-specific docs matter to agents and humans working there

That local guidance is not a contract fork. It is the repo's interpretation and operating playbook on top of the shared contract.

## Ownership Classes

Shared-synced or shared-defined:

- `wiki/.wiki-contract.json`
- `wiki/templates/`
- shared meanings for `wiki/issues/`, `wiki/initiatives/`, `wiki/decisions/`, `wiki/sources/`, `wiki/areas/`
- shared meanings for overlapping frontmatter fields, IDs, lint rules, and generation rules

Consumer-owned local docs:

- `wiki/schema.md`
- `wiki/conventions.md`
- `wiki/index.md`
- repo-local governance or migration docs
- repo-local extension schema docs such as `wiki/WIKI_SCHEMA.md`
- core-surface `README.md` files inside `wiki/issues/`, `wiki/initiatives/`, `wiki/decisions/`, `wiki/sources/`, and `wiki/areas/`

Consumer-owned local content:

- canonical records in the repo's `wiki/` and `docs/`
- declared extension namespace pages

Generated, non-canonical views:

- `wiki/catalog.md`
- `wiki/now.md`
- `wiki/inbox.md`
- `wiki/backlog.md`
- `wiki/archive.md`
- `wiki/generated/`

## File Roles

### `wiki/schema.md`

Use this file to explain how the repo maps the shared contract into its local operating model.

Good content:

- adopted profile: `standard` or `research`
- durable knowledge layer usage
- declared extension namespaces
- local canonical-vs-generated guidance
- cross-repo reference conventions used by that repo
- repo-specific constraints that do not redefine the shared core

Do not use it to:

- invent new meanings for `WK`, `IN`, `DEC`, `SRC`, or area records
- replace shared template or field definitions with incompatible local ones
- declare repo-specific schema forks for shared core record types

`wiki/schema.md` should explain local usage of the shared contract, not rewrite the contract itself.

### `wiki/conventions.md`

Use this file for repo-local working rules for humans and agents.

Good content:

- how to create and update records in that repo
- how retrieval should usually start in that repo
- how repo-local extension pages should be used
- when to prefer canonical records over generated views
- any repo-local workflow rules that sit on top of the shared contract

Do not use it to:

- contradict shared allocator, lint, or generation behavior
- tell agents to guess IDs manually
- reframe extension namespaces as replacements for the shared core record types

### `wiki/index.md`

Use this as the repo-local doorway for humans and agents who need orientation.

Good content:

- links to `schema.md`, `conventions.md`, and the current retrieval entrypoints
- a short statement of the repo's operating model
- the most important canonical surfaces and extension namespaces
- links to active decisions, areas, initiatives, issues, and sources when relevant

Do not use it as:

- a substitute for canonical records
- a hidden schema fork
- a stale bootstrap note after the repo is already enrolled

### Extension schema docs such as `wiki/WIKI_SCHEMA.md`

Use these only for repo-local extension page guidance.

Good content:

- page shapes for extension namespaces
- citation expectations for extension pages
- extension-specific ownership or maintenance rules
- how extension pages relate to the shared core

Do not use them to:

- redefine `issues`, `initiatives`, `decisions`, `sources`, or `areas`
- claim the shared runtime does not exist after the repo is enrolled
- treat extension namespaces as a reason to fork the shared contract

### Core directory `README.md` files

Use these as local orientation notes for each core surface.

Good content:

- what kinds of records live there
- filename or ID shape
- current repo usage notes
- links to the most relevant canonical records in that directory

Do not leave these frozen in bootstrap language once the repo is adopted.

If canonical records now exist, the README should say so. If allocator-backed tooling is live, the README should say so. These files are often linked from `wiki/index.md`, so stale directory READMEs can pull agents back into the wrong operating model.

## What Local Docs Should Not Do

Consumer-owned docs should not:

- redefine the shared core record taxonomy
- invent incompatible frontmatter for shared core records
- claim the repo is still in bootstrap mode after enrollment and active use
- tell agents to rely on extension pages instead of canonical source/work/decision records when the repo has already adopted them
- treat generated views as canonical

## What Local Docs Should Do

Consumer-owned docs should:

- explain how the shared contract is used in that repo
- document local extension namespaces and local retrieval choices
- explain any repo-specific reason to keep consumer-owned entrypoints or docs
- stay current as the repo moves from bootstrap to active shared-runtime use

## Maintenance Triggers

Update consumer-owned docs when:

- the repo is first enrolled with `bootstrap` or `sync-contract`
- the repo starts using canonical `WK`, `IN`, `DEC`, `SRC`, or area records
- the repo changes profile or declared extension namespaces
- the repo adopts or rejects shared generated views
- old bootstrap or "tooling gap" language becomes false

## Maintenance Pattern

The shared tooling intentionally preserves `wiki/schema.md`, `wiki/conventions.md`, and `wiki/index.md` once they exist.

That means consuming repos must maintain those files deliberately. Shared tooling should prevent contract drift, but it should not overwrite repo-local operating guidance.

The right split is:

- shared tooling enforces the contract
- consumer-owned docs explain the repo's local use of that contract

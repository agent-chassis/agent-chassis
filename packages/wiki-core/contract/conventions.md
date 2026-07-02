# Shared Wiki Conventions

These conventions operationalize the shared portfolio wiki contract for core-plus-extension repositories.

Related shared semantics:

- `taxonomy.md` defines shared controlled vocabulary
- `query.md` defines shared retrieval order and search expectations
- `lint.md` defines shared lint classes and severity expectations
- `retrieval.md` defines shared retrieval-curation vocabulary and inference rules

## Core Meaning

Across participating repositories:

- `wiki/work-records/` tracks migrated and current canonical work as `WK-*` JSON records
- `wiki/issues/` is the legacy Markdown issue surface for `WK-*` records that are not yet migrated, plus generated/projection or compatibility material when a repo keeps that surface
- `wiki/initiatives/` tracks grouped execution as `IN-*`
- `wiki/decisions/` tracks durable decisions as `DEC-*`
- `wiki/sources/` tracks source registry entries as `SRC-*`
- `wiki/areas/` tracks durable repo boundaries as slug-based pages
- `wiki/catalog.md` is the generated retrieval entrypoint
- `wiki/now.md`, `wiki/inbox.md`, `wiki/backlog.md`, and `wiki/archive.md` are generated queue views

These meanings must not be silently forked by individual repos.

## Durable Knowledge Layer

The meaning of `docs/` stays consistent when it exists:

- it is the durable synthesized knowledge layer
- it is not a generated queue view
- it is not a dumping ground for operational logs

Not every repo is required to have `docs/`. Research-corpus repos may keep durable synthesis in declared wiki extension namespaces instead.

## Extension Namespaces

Extension namespaces exist so repos with real typed corpora can stay aligned without flattening everything into generic work items.

Examples:

- `organizations/`
- `people/`
- `themes/`
- `signals/`
- `vendors/`

Rules:

- declare extensions explicitly
- keep the shared core meanings intact
- document local ownership and schema in the consuming repo
- allow baseline tooling to validate presence without hard-coding local taxonomy into the shared contract

## Template Sync

Shared core templates originate in this repository under `contract/templates/`.

Consuming repositories should sync them into:

- `wiki/templates/`

Local repos may add extra templates for extension namespaces, but should not silently fork the shared core templates.

## File Naming

Canonical filename strategy for the shared core:

- `wiki/work-records/WK-0001.json`
- `wiki/issues/WK-0001.md` for legacy Markdown work items, projections, or compatibility fixtures when present
- `wiki/initiatives/initiative.md`
- `wiki/decisions/decision.md`
- `wiki/sources/source record.md`
- `wiki/areas/runtime-architecture.md`

The baseline contract should not force slugged filenames for allocated core IDs.

Allocation rule:

- treat allocated IDs as stable identity, not as a reliable creation-order signal under concurrent agent activity
- use `created`, `updated`, `priority`, `status`, and dependency fields for operational ordering instead

## Anti-Drift

Anti-drift should come from shared tooling rather than human memory.

The shared tooling is responsible for:

- bootstrapping the shared core surface
- syncing shared templates
- allocating canonical IDs for `WK`, `IN`, `DEC`, and `SRC`
- maintaining lock-safe allocator state in `wiki/.id-state.json`
- validating baseline schema and core presence
- understanding profile-aware repos and declared extension namespaces
- generating only non-canonical derived views

Repo-local tooling may extend generation, linting, or search behavior on top of the shared baseline.

## Repo-Local Extensions

Consuming repositories may extend locally by:

- adding extension namespaces
- adding repo-local templates
- generating repo-specific dashboards and retrieval pages
- layering stricter lint rules on top of the shared baseline

Consuming repositories may not extend by:

- redefining the core meanings of `work-records`, `issues`, `initiatives`, `decisions`, `sources`, or `areas`
- changing the shared ID families for overlapping core types
- forcing the shared contract to mirror one repo's entire taxonomy

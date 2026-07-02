# Shared Wiki Schema

This schema defines the portable core contract used across participating repositories. It aligns the shared surface with the established portfolio model while leaving room for repo-local extension namespaces.

## Scope

This contract governs:

- required core wiki files and directories
- identifier families for overlapping core page types
- baseline front matter expectations
- retrieval entrypoints and canonical versus generated rules
- shared taxonomy, query, and lint semantics for the core contract
- profile-aware handling of the durable synthesized knowledge layer
- declared extension namespaces for repos with richer local corpora

This contract does not create a central content repository. Durable content remains local to each consuming repository.

Related shared contract documents:

- `contract/taxonomy.md`
- `contract/query.md`
- `contract/lint.md`
- `contract/retrieval.md`

## Core Files And Directories

Every participating repository must expose the same core wiki surface:

- `wiki/schema.md`
- `wiki/conventions.md`
- `wiki/catalog.md`
- `wiki/now.md`
- `wiki/inbox.md`
- `wiki/backlog.md`
- `wiki/archive.md`
- `wiki/index.md`
- `wiki/work-records/`
- `wiki/issues/`
- `wiki/initiatives/`
- `wiki/decisions/`
- `wiki/sources/`
- `wiki/areas/`
- `wiki/templates/`

Core meaning:

- `work-records/` (`wiki/work-records/WK-*.json`) is the canonical work-record layer for `WK-*` work
- `issues/` is a legacy/historical Markdown issue surface for `WK-*` work items not yet migrated to JSON authority
- `initiatives/` is the grouped execution layer
- `decisions/` is the durable decision layer
- `sources/` is the evidence and provenance layer
- `areas/` groups durable repo boundaries or domains
- `catalog.md` is the generated retrieval entrypoint
- `now.md`, `inbox.md`, `backlog.md`, and `archive.md` are generated queue views
- `schema.md` and `conventions.md` document the local adoption of the shared contract
- `index.md` is a local orientation page and remains consumer-owned

Runtime contract files:

- `wiki/.wiki-contract.json`
- `wiki/.id-state.json`

## Profile-Aware Durable Knowledge Layer

The durable synthesized knowledge layer is profile-aware:

- `standard` profile: `docs/` is required
- `research` profile: `docs/` is optional

This allows research-corpus repositories to keep durable synthesis in typed wiki namespaces without forcing an empty `docs/` layer into the contract.

## Core Identifier Families

The shared core ID families are:

- `WK-0001` for work records in `wiki/work-records/WK-*.json`
- `IN-0001` for initiatives in `wiki/initiatives/`
- `decision` for decisions in `wiki/decisions/`
- `source record` for source registry entries in `wiki/sources/`

Area pages use slug identities rather than opaque allocated IDs:

- `wiki/areas/<slug>.md`

Rules:

- allocated IDs are monotonic within a repository and type
- allocated IDs are never reused
- allocated IDs are identity tokens, not a guaranteed chronology signal under concurrent creation
- local filenames may remain canonical as `WK-0001.json`, `IN-0001.md`, `decision.md`, or `source record.md`
- `wiki/issues/WK-0001.md` may exist only as a legacy Markdown issue surface, generated projection, or compatibility fixture for `WK-*` records
- area page identity is the slug and should remain stable once created

## Baseline Front Matter

The shared contract defines baseline Tier 1 required fields plus shared Tier 2 contextual fields that tooling understands. Repositories may still add extra fields locally. Current and migrated `WK-*` work-record field authority lives in the `work-record.v1` JSON schema and the `workRecordAuthority` stanza of `contract/manifest.json`; this schema document intentionally does not duplicate that full JSON field model.

### Work Record

Current and migrated work records are canonical JSON records under `wiki/work-records/WK-*.json`. `wiki/issues/WK-*.md`, when present, is legacy Markdown issue/projection compatibility material rather than current authority.

Shared tooling should validate `WK-*` records against the canonical JSON schema and use `wiki/issues/` only for legacy Markdown, generated projections, migration compatibility, or historical fixtures.

### Initiative

Required:

- `id`
- `title`
- `status`
- `priority`
- `owner`
- `created`
- `updated`

Shared contextual fields:

- `area`
- `tags`
- `docs`
- `depends_on`
- `blocks`
- `related`
- `write_scope`
- `assignees`
- `agents`
- `reviewers`
- `target`
- `started`
- `completed`

### Decision

Required:

- `id`
- `title`
- `status`
- `date`
- `owners`

Shared contextual fields:

- `area`
- `docs`
- `related`
- `supersedes`
- `superseded_by`

### Source

Required:

- `id`
- `title`
- `kind`
- `captured`
- `updated`
- `source_uri`
- `authority`
- `immutable_hint`

Shared contextual fields:

- `related_docs`
- `related_work`
- `anchors`

### Area

Required:

- `id`
- `title`
- `owners`
- `updated`

Shared contextual fields:

- `docs`
- `initiatives`
- `sources`
- `decisions`
- `related`

The baseline contract still does not prohibit additional local fields, typed backlinks, or repo-specific relation objects.

## Extension Namespaces

Repositories may add typed extension namespaces when the shared core is insufficient.

Rules:

1. Extension namespaces must not replace the core meanings of `issues`, `initiatives`, `decisions`, `sources`, or `areas`.
2. Extension namespaces must be declared in the local contract metadata and documented in `wiki/schema.md`.
3. Extension namespaces may have repo-specific schemas and templates.
4. Shared lint should validate their declared presence, but not redefine their internal page schema in the baseline contract.

## Cross-Repo References

Cross-repo references should use repo-qualified identities.

Recommended forms:

- `org/repo:WK-0001`
- `org/repo:decision`
- `org/repo/wiki/areas/runtime-architecture.md`

The repo prefix disambiguates local opaque IDs and extension slugs without changing local filenames.

## Canonical Versus Generated

Canonical state:

- current and migrated `WK-*` work records under `wiki/work-records/`
- legacy Markdown issue records under `wiki/issues/` only when they have not yet migrated to JSON authority
- core records under `wiki/initiatives/`, `wiki/decisions/`, `wiki/sources/`, and `wiki/areas/`
- durable synthesized knowledge in `docs/` when the repo profile uses it
- repo-local extension pages under declared extension namespaces

Non-canonical state:

- `wiki/catalog.md`
- `wiki/now.md`
- `wiki/inbox.md`
- `wiki/backlog.md`
- `wiki/archive.md`
- generated summary views under `wiki/generated/`
- other reproducible retrieval surfaces

Generated pages must never become the sole source of truth for core wiki data.

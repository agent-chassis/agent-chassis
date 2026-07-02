# Shared Retrieval And Curation Vocabulary

This document defines the shared retrieval-curation vocabulary for participating repositories.

The goal is to make retrieval semantics portable across repos without replacing path, directory, template, or ID family as the primary kind system.

## Design Principles

1. Page family, path, template, and ID type remain the primary kind system.
2. Shared retrieval semantics cut across those kinds; they do not replace them.
3. Most semantics should be inferred from path or template defaults where possible.
4. Repo-local extension is narrow and controlled.
5. Views should emerge from typed structure, links, and shared facets rather than from free-form tags or prose heuristics.

## Shared Facets

### `retrieval_role`

Meaning:

- how a page should function in retrieval

Values:

- `entrypoint`
- `hub`
- `inventory`
- `record`

Rules:

- `retrieval_role` is multi-value, but may contain at most two values
- one role is the primary retrieval role
- a second role is allowed only when it refines the page's retrieval shape, not when it dodges classification

Allowed combinations:

- `entrypoint + inventory`
- `entrypoint + hub`
- `record + hub`

Invalid combinations include:

- `record + inventory`
- `record + entrypoint`
- `inventory + hub` without `entrypoint`

Definitions:

- `entrypoint`: doorway page for humans or agents
- `hub`: page that organizes multiple related canonical records or pages
- `inventory`: broad listing page
- `record`: canonical target page for one concrete subject, entity, issue, initiative, source, decision, session, thread, or similar unit

Guideline:

- use `record + hub` when a canonical page about one durable subject also organizes related canonical records
- this is common in extension-heavy repos and should not be treated as an edge case

### `canonicality`

Meaning:

- whether the page is authoritative local state

Values:

- `canonical`
- `noncanonical`

Rules:

- generated views are always `noncanonical`
- local source-of-truth records are usually `canonical`

### `maintenance_mode`

Meaning:

- how the page is maintained over time

Values:

- `curated`
- `generated`
- `operational`

Definitions:

- `curated`: intentionally maintained by humans
- `generated`: produced by tooling and overwritten wholesale
- `operational`: mutated in place as part of ongoing workflow state

Examples:

- `wiki/catalog.md` is `generated`
- `wiki/work-records/WK-0001.json` is usually `operational`
- `wiki/issues/WK-0001.md` is a legacy Markdown issue, projection, or compatibility surface when present
- `wiki/log.md` may be `operational`
- a stable architectural doc is usually `curated`

Rules:

- `maintenance_mode` is single-value
- when a page could be described as both curated and operational, `operational` wins
- `canonicality=canonical` plus `maintenance_mode=generated` is invalid

### `knowledge_role`

Meaning:

- what kind of knowledge artifact the page is

Values:

- `evidence`
- `synthesis`
- `decision`
- `work`
- `reference`

Definitions:

- `evidence`: source-bearing material
- `synthesis`: interpretive cross-source material
- `decision`: durable conclusion or choice
- `work`: coordination or execution artifact
- `reference`: lookup or background artifact

### `evidence_stage`

Meaning:

- provenance stage for evidence pages

Values:

- `primary`
- `derived`

Rules:

- only valid when `knowledge_role=evidence`
- `evidence_stage` is always authored unless the repo's contract declares a namespace-level default
- if `knowledge_role=evidence` and no namespace-level default exists, `evidence_stage` should be explicit

### `retrieval_visibility`

Meaning:

- how the page should appear in default generated retrieval views

Values:

- `default`
- `support`
- `suppressed`

Definitions:

- `default`: included normally in default generated views
- `support`: included in default generated views, but demoted behind `default` surfaces
- `suppressed`: excluded from default generated views unless a view explicitly opts in

Rules:

- `retrieval_visibility` is orthogonal to `lifecycle`
- `retrieval_visibility` is orthogonal to `sensitivity`
- `entrypoint` must not pair with `retrieval_visibility=suppressed`
- omitted `retrieval_visibility` implies `default`
- default search behavior should exclude `suppressed` pages unless a query explicitly opts in

### `lifecycle`

Meaning:

- retrieval freshness or historical state

Values:

- `active`
- `stable`
- `historical`

Rules:

- `lifecycle` is independent of work status
- `historical` means old or archival, not hidden
- omitted `lifecycle` implies `active`

### `sensitivity`

Meaning:

- access and surfacing constraints stronger than simple ranking

Values:

- `normal`
- `restricted`

Future shared values may include:

- `confidential`

Rules:

- `restricted` is not just a ranking hint
- `sensitivity` expresses visibility or confidentiality constraints, not retrieval ranking
- repos that use `restricted` should enforce stronger behavior than simple demotion, such as suppression from default indexing, stricter linking rules, or export restrictions
- omitted `sensitivity` implies `normal`

### `topics`

Meaning:

- controlled subject-matter vocabulary

Rules:

- `topics` is the only repo-extensible facet in v1
- shared seed topics are defined here
- local topics must be declared before use in `wiki/.wiki-contract.json`
- undeclared local topics must fail lint
- local topics must not collide with canonical extension slugs or area slugs without an explicit resolution rule

Shared seed topics:

- `architecture`
- `automation`
- `compliance`
- `documentation`
- `metadata`
- `provenance`
- `retrieval`
- `schema`
- `testing`
- `tooling`
- `workflow`

## Inference Defaults

The shared tooling should infer these facets by path, template, or generated-surface class wherever possible:

- `canonicality`
- `maintenance_mode`
- `knowledge_role`
- default `retrieval_role`

These facets are usually authored:

- `topics`
- `lifecycle`
- `retrieval_visibility`
- `sensitivity`
- `evidence_stage`

### Core Namespace Defaults

Shared defaults for core namespaces:

- `wiki/catalog.md`
  - `retrieval_role: [entrypoint, inventory]`
  - `canonicality: noncanonical`
  - `maintenance_mode: generated`
- `wiki/now.md`, `wiki/inbox.md`, `wiki/backlog.md`, `wiki/archive.md`
  - `retrieval_role: inventory`
  - `canonicality: noncanonical`
  - `maintenance_mode: generated`
  - `knowledge_role: work`
- `wiki/sources/*`
  - `retrieval_role: record`
  - `canonicality: canonical`
  - `knowledge_role: evidence`
- `wiki/decisions/*`
  - `retrieval_role: record`
  - `canonicality: canonical`
  - `knowledge_role: decision`
- `wiki/work-records/*`
  - `retrieval_role: record`
  - `canonicality: canonical`
  - `maintenance_mode: operational`
  - `knowledge_role: work`
- `wiki/issues/*`
  - `retrieval_role: record`
  - `canonicality: noncanonical`
  - `maintenance_mode: operational`
  - `knowledge_role: work`
  - legacy Markdown issue, projection, or compatibility surface for work records when present
- `wiki/initiatives/*`
  - `retrieval_role: record`
  - `canonicality: canonical`
  - `maintenance_mode: operational`
  - `knowledge_role: work`
- `wiki/areas/*`
  - `retrieval_role: hub`
  - `canonicality: canonical`
  - `knowledge_role: synthesis`

### Repo-Declared Path Defaults

Some durable paths, especially `docs/**`, are repo-dependent.

Each consuming repo may declare additional inference defaults in `wiki/.wiki-contract.json`.

Example:

```json
{
  "vocab": {
    "topics": {
      "shared": [
        "architecture",
        "automation",
        "compliance",
        "documentation",
        "metadata",
        "provenance",
        "retrieval",
        "schema",
        "testing",
        "tooling",
        "workflow"
      ],
      "local": ["widget", "acme"]
    }
  },
  "inference": {
    "paths": [
      {
        "glob": "docs/**/*.md",
        "defaults": {
          "canonicality": "canonical",
          "maintenance_mode": "curated"
        }
      }
    ]
  }
}
```

For v1, `wiki/.wiki-contract.json` should carry:

- local topic declarations
- repo-local path inference defaults

It should not become a generic override dump for the full retrieval model.

## Inference Precedence And Conflict Handling

Rules:

1. inferred defaults exist to reduce authoring burden, not to create silent ambiguity
2. explicit values must not conflict silently with inferred defaults
3. invalid combinations must fail lint
4. undeclared local topics must fail lint

Recommended lint behavior:

- error on incompatible explicit overrides
- error on invalid multi-value `retrieval_role` combinations
- error on undeclared local topics
- error on forbidden combinations such as:
  - `canonicality=canonical` with `maintenance_mode=generated`
  - `entrypoint` with `retrieval_visibility=suppressed`
  - `knowledge_role!=evidence` with `evidence_stage` present

## Generated Views

Generated queue and catalog views are always noncanonical.

Their facets apply to the generated surface itself, not to the underlying canonical records.

Examples:

- `wiki/now.md` is `generated`
- the `WK-*` and `IN-*` pages that feed it may be `operational`

## What This Vocabulary Does Not Do

This vocabulary does not:

- replace path/template/ID family as the primary kind system
- create a shared `record_kind` ontology in v1
- bless a generic operational `tags:` field
- introduce advisory `view_hints`

If a future need proves that path and typed namespaces are insufficient, the shared contract may add more structure later. v1 intentionally keeps the model small.

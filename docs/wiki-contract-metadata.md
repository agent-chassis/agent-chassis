# Wiki Contract Metadata

This document explains the local `wiki/.wiki-contract.json` file used by consuming repositories.

It covers:

- what the file is for
- which fields are shared-runtime metadata versus repo-owned local settings
- how local topics are declared
- how path-based inference defaults are declared
- which retrieval facets are usually inferred versus authored

## Purpose

`wiki/.wiki-contract.json` is the repo-local metadata surface for the shared contract runtime.

It is not a central content store and it is not a second schema language. Its purpose is to record local enrollment plus the small amount of repo-owned configuration the shared runtime needs to interpret the repo consistently.

## Ownership

Written and maintained by shared tooling:

- `repo`
- `profile`
- `extensionNamespaces`
- `contractVersion`
- `syncedAt`
- `sourceRepo`
- `retrievalEntrypoint`

Preserved as repo-owned local contract settings:

- `vocab`
- `inference`

Shared tooling should preserve the repo-owned sections during `sync-contract` and `bootstrap`, not overwrite them.

## Current Shape

Example:

```json
{
  "repo": "org/repo",
  "profile": "standard",
  "extensionNamespaces": [],
  "contractVersion": "0.2.0",
  "syncedAt": "2026-04-13T00:00:00.000Z",
  "sourceRepo": "example-org/example-repo",
  "retrievalEntrypoint": "wiki/catalog.md",
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
      "local": ["billing", "catalog"]
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

## `vocab`

`vocab` declares controlled repo-local vocabulary that extends the shared contract.

In v1, only one extensible facet is supported:

- `vocab.topics.local`

Rules:

- local topics must be declared before use
- undeclared local topics fail lint
- local topics must not collide with canonical extension slugs or area slugs without an explicit resolution rule
- shared tooling should keep `vocab.topics.shared` aligned with the contract manifest

## `inference`

`inference` declares repo-local path defaults for durable content paths that are not fully determined by the shared core namespaces.

In v1, the supported path-default use case is:

- `docs/**/*.md`

That keeps the model narrow while still giving standard-profile repos a shared way to say how `docs/` should behave.

Rules:

- only supported path globs are allowed
- unsupported globs fail lint
- defaults must use shared facet values
- path inference is meant to reduce authoring burden, not replace the shared contract

## Inferred vs Authored Facets

Usually inferred by path/type/template:

- `canonicality`
- `maintenance_mode`
- `knowledge_role`
- default `retrieval_role`

Usually authored:

- `topics`
- `lifecycle`
- `retrieval_visibility`
- `evidence_stage`
- `sensitivity`

In practice, most repos should author only the page-specific facets that path and template cannot determine:

- `topics`
- `lifecycle`
- `retrieval_visibility` when a page should be demoted or suppressed
- `evidence_stage` on evidence pages when the repo has no namespace-level default
- `sensitivity` only when the repo actually enforces stronger visibility rules than ranking

Operational rule:

- explicit values must not silently conflict with inferred defaults
- shared lint should fail on incompatible conflicts

## Template Guidance

Shared templates should not force every page to author every retrieval facet.

Instead:

- keep the common structural fields in the templates
- add optional commented retrieval-facet examples where authors are likely to need overrides
- rely on inference for the rest

That keeps frontmatter small while still giving authors a clear place to put:

- `topics`
- `lifecycle`
- `retrieval_visibility`
- `evidence_stage`

when they need them.

### Core Template Defaults

Shared core templates should assume path-based defaults and expose only the likely authored overrides.

- `issue.md`
  - infer `retrieval_role: record`
  - infer `canonicality: canonical`
  - infer `maintenance_mode: operational`
  - infer `knowledge_role: work`
  - authors usually add `topics`, `lifecycle`, or `retrieval_visibility` only when needed
- `initiative.md`
  - infer `retrieval_role: record`
  - infer `canonicality: canonical`
  - infer `maintenance_mode: operational`
  - infer `knowledge_role: work`
  - authors usually add `topics`, `lifecycle`, or `retrieval_visibility` only when needed
- `decision.md`
  - infer `retrieval_role: record`
  - infer `canonicality: canonical`
  - infer `knowledge_role: decision`
  - authors usually add `topics`, `lifecycle`, or `retrieval_visibility` only when needed
- `source.md`
  - infer `retrieval_role: record`
  - infer `canonicality: canonical`
  - infer `knowledge_role: evidence`
  - authors should usually add `evidence_stage`
  - authors may also add `topics`, `lifecycle`, or `retrieval_visibility`
- `area.md`
  - infer `retrieval_role: hub`
  - infer `canonicality: canonical`
  - infer `knowledge_role: synthesis`
  - authors may override `retrieval_role` to `[record, hub]` when one canonical page both owns a durable subject and organizes related records
  - authors usually add `topics`, `lifecycle`, or `retrieval_visibility` only when needed

## What This File Should Not Become

`wiki/.wiki-contract.json` should not become:

- a generic override dump for every retrieval behavior
- a repo-local fork of the shared contract
- a place to redefine core namespace meaning
- a second consumer-owned prose document

The intended split is:

- contract docs define the shared semantics
- `wiki/.wiki-contract.json` declares narrow local vocabulary and inference defaults

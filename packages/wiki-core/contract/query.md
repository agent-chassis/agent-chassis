# Shared Wiki Query Model

This document defines the shared retrieval model for the portfolio wiki contract.

## Retrieval Principle

Default to knowledge-first retrieval, not queue-first retrieval.

## Shared Query Order

1. Start from `wiki/catalog.md`.
2. Follow into relevant `docs/` pages when the repo profile uses them.
3. Check decision pages for durable architectural conclusions.
4. Check area pages for durable repo boundaries and entrypoints.
5. Drill into work-record JSON and initiative pages for execution state; use
   `wiki/issues/` only for legacy Markdown work items, projections, or
   compatibility material when present.
6. Check source pages when provenance or evidence matters.

## Bootstrap Query Path

Before generated views or search indices exist:

1. inspect relevant `docs/` subtrees directly when present
2. inspect `wiki/decisions/`
3. inspect `wiki/areas/`
4. inspect `wiki/work-records/` and `wiki/initiatives/`; inspect
   `wiki/issues/` only for legacy Markdown work items, projections, or
   compatibility material when present
5. inspect `wiki/sources/`

## Shared Search Expectations

The shared search layer should support:

- exact and lexical matching for IDs, titles, headings, and obvious phrase hits
- metadata narrowing for fields such as `type`, `status`, `priority`, `owner`, `area`, and `initiative`
- authority-aware ordering so canonical docs and well-linked decisions surface more reliably
- exclusion of generated views from indexing

Generated views that must not be indexed as canonical search targets:

- `wiki/catalog.md`
- `wiki/now.md`
- `wiki/inbox.md`
- `wiki/backlog.md`
- `wiki/archive.md`

## Generated View Trust Rule

Generated views are useful retrieval aids, but they are only trustworthy when they are current.

Before relying on `wiki/catalog.md`, `wiki/now.md`, `wiki/inbox.md`, `wiki/backlog.md`, or `wiki/archive.md`:

1. regenerate them with the shared generation tool, or
2. run shared lint and confirm there are no `missing_generated_view` or `stale_generated_view` findings

If neither condition is true, agents should prefer canonical pages directly over generated views.

## Standard Filters

The shared query/search core should support these filter dimensions when the page type exposes them:

- `kind`
- `type`
- `status`
- `priority`
- `owner`
- `area`
- `initiative`

## Query Outcomes

Queries can end in two ways:

- read-only retrieval when no durable new understanding was produced
- promotion into a docs update, decision update, source page, or new work item when durable understanding was produced

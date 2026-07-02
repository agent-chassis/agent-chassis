# Shared Wiki Lint Model

This document defines the shared lint classes for the portable portfolio wiki contract.

## Purpose

Lint exists to keep the wiki trustworthy as the corpus grows.

## Shared Lint Classes

### Structural

- missing required frontmatter
- invalid enum values
- malformed array or object fields
- duplicate IDs
- canonical filename mismatches
- broken dependency or relation references

### Knowledge Linkage

- issues listing docs that do not exist
- docs pages missing required wiki backlinks
- sources listing related docs that do not exist
- source backlinks that are missing from docs pages

### Concurrency

- overlapping `write_scope` across active items
- active items missing `owner`
- active items missing `write_scope` when they appear to own code changes

### Staleness

- generated views missing or stale
- `write_scope` paths that no longer exist
- initiatives whose child issues are all closed
- active items untouched for too long

Generated-view findings are especially important because stale queue pages can create false review conclusions even when canonical issue and initiative pages are correct.

## Severity Model

- `error`: canonical trust is broken
- `warning`: actionable maintenance or coordination signal

The shared contract should remain conservative about auto-fixing canonical pages. Generated views may be regenerated automatically; canonical pages should only change through explicit create/update flows.

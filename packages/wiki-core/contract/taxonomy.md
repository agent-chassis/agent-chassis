# Shared Wiki Taxonomy

This document defines the shared controlled vocabulary for the portable portfolio wiki contract.

## Core Work Item Types

- `bug`
- `feature`
- `task`
- `investigation`
- `chore`
- `docs`
- `infra`
- `migration`

## Core Status Values

- `inbox`
- `todo`
- `in_progress`
- `blocked`
- `review`
- `done`
- `parked`
- `cancelled`
- `deprecated`
- `duplicate`
- `superseded`
- `wont_do`

## Resolution Values

Use on closed, retired, duplicated, deprecated, or superseded work:

- `unresolved`
- `fixed`
- `implemented`
- `completed`
- `duplicate`
- `deprecated`
- `superseded`
- `cancelled`
- `wont_do`
- `not_repro`

## Priority Values

- `critical`
- `high`
- `medium`
- `low`

## Severity Values

- `critical`
- `high`
- `medium`
- `low`
- `none`

## Source Kinds

- `web`
- `paper`
- `issue`
- `commit`
- `log`
- `artifact`
- `discussion`
- `file`
- `dataset`

## Backlink Relations

- `creates`
- `updates`
- `references`
- `obsoletes`
- `supports`
- `contradicts`
- `derived_from`
- `decision_for`
- `evidence_for`

## Contract Rule

Consuming repositories may extend taxonomy locally, but they must not silently redefine the shared meanings above for overlapping core page types.

## Runtime reason taxonomy storage

`data/runtime-blocker-codes.v1.json` owns metadata and the ordered `code_shards`
manifest. `src/lib/runtime-blocker-taxonomy.mjs` is the sole composition owner.
Each declared `runtime-blocker-codes/<name>.v1.json` uses
`runtime-blocker-code-shard.v1` with a nonempty `codes` array. The two shards
contain contiguous segments of the original ordered population; their names do
not imply thematic membership. Composition concatenates entries in manifest
order and preserves all metadata, then validates the complete taxonomy,
including the bootstrap subset. Missing or malformed shards, escaping paths,
unknown schemas, duplicate codes and conflicting enum identities fail closed.
There is no embedded-code read or alternative storage shape. Consumers use the
composed descriptor or its public loader, including initiative-status detection.

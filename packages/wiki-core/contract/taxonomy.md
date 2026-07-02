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

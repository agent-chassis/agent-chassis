
# Versioning And Migration

<!-- wiki: id=IN-0001 relation=tracks -->

Contract changes should be explicit, versioned, and migratable.

## Versioning Strategy

The shared contract version is tracked in `packages/wiki-core/contract/manifest.json`.

Recommended semantics:

- patch: template wording changes, doc clarifications, non-breaking tooling fixes
- minor: additive fields, new lint checks that can be adopted with straightforward updates, new optional tooling behavior
- major: breaking schema changes, identifier changes, or required surface changes

## Protocol Versioning

The agent blackboard launcher protocol is versioned separately from the shared wiki contract.

The reviewed-blackboard launcher protocol is deactivated and no longer ships as
active source documentation.

Recommended semantics for protocol revisions:

- patch: clarifications, examples, or non-breaking launcher behavior fixes
- minor: additive launcher fields, new optional artifacts, or backward-compatible workflow extensions
- major: breaking launcher schema changes, token/state model changes, or incompatible runtime artifact changes

Do not assume a contract version bump implies a protocol version bump, or vice versa. They evolve on related but separate tracks.

## Local Version Tracking

Consuming repositories should track the last synced contract version in a local metadata file written by the shared tooling:

- `wiki/.wiki-contract.json`

That file should identify:

- the shared contract version
- the repo slug
- the selected contract profile
- the declared extension namespaces
- the time of the last sync
- the source of the synced contract
- any preserved local vocabulary and path-inference settings needed by the shared runtime

## Migration Expectations

Breaking changes should ship with:

- a documented rationale
- a migration procedure
- tooling support where practical
- lint signals that make version skew visible

This prevents silent divergence and avoids repo-specific schema forks.

## MVP Status

In this initial version:

- contract versioning is defined
- local sync metadata is written by the CLI
- explicit migration commands are not yet implemented

Until migration commands exist, migrations are handled through:

- contract documentation updates
- sync tooling
- lint failures that surface mismatch

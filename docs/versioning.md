
# Versioning And Migration

Contract changes should be explicit and versioned. They are not required to be
backward compatible or migratable unless an accepted canonical `DEC-*`
authorizes that exact compatibility obligation under the repository-wide
[compatibility posture](operating-model.md#compatibility-posture-current-contracts-only).

## Versioning Strategy

The shared contract version is tracked in `packages/wiki-core/contract/manifest.json`.

Recommended semantics:

- patch: template wording changes, doc clarifications, non-breaking tooling fixes
- minor: additive fields, new lint checks, or new optional tooling behavior for the current contract
- major: breaking schema changes, identifier changes, or required surface changes

## Protocol Versioning

The agent blackboard launcher protocol is versioned separately from the shared wiki contract.

The reviewed-blackboard launcher protocol is deactivated and no longer ships as
active source documentation.

Recommended semantics for protocol revisions:

- patch: clarifications, examples, or non-breaking launcher behavior fixes
- minor: additive launcher fields, new optional artifacts, or workflow extensions for the current protocol
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
- lint signals that make version skew visible

Migration procedures, compatibility adapters, old-version readers, and other
transition support are excluded by default. They may ship only when an accepted
canonical `DEC-*` names the exact old and current contracts, authorized support
surface, consumers, tests, owner, and removal condition or review date. A
proposed decision does not authorize implementation or preservation.

Absent that authority, consumers must move to the current contract as part of
the breaking change. Tooling may fail loudly on obsolete inputs; it must not
silently retain or reconstruct the old behavior.

## MVP Status

In this initial version:

- contract versioning is defined
- local sync metadata is written by the CLI
- explicit migration commands are not yet implemented

Until migration commands exist, migrations are handled through:

- contract documentation updates
- sync tooling
- lint failures that surface mismatch

## Controlled-Acceptance Test-Proof Family

`controlled-acceptance-contract.experimental.v0.2` remains valid and is still
evaluated with its unchanged v0.2 schema, profile, and `cv.experimental.0.34`
semantics. Test-proof adoption creates a distinct
`controlled-acceptance-contract.experimental.v0.3` carrier; it does not change
or reinterpret a v0.2 carrier.

The v0.3 family preserves all v0.2 references, propositions, claims, relations,
collections, residue, and annotations by identity. It changes the schema and
profile IDs and adds the required `controlled-contract-test-proof.v1` binding
population. Every `test_execution` verification claim has exactly one binding;
other verification methods have none. The controlled-contract package owns the
binding schema, identity grammars, closed vocabulary, validation, canonical
ordering, provider catalog, and runtime-evidence schema. Provider bindings are
closed data: they carry exact provider ID, version, capability, supported
strategy or boundary kind, observation mechanism, observation seam, and artifact type (or the
exact registry-unsupported traversal disposition), never executable paths,
commands, argv, environment, callbacks, shell text, or arbitrary modules. The
only admitted falsifier mechanism is launcher-applied dependency failure by
ephemeral module substitution, and the only admitted traversal mechanism is
launcher-captured V8 coverage for a canonical Node module boundary. Other
strategies fail resolution and other boundary kinds use authenticated
`registry_unsupported`/`review_only` state.

Migration uses `migrateControlledAcceptanceContractV02ToV03` with a valid v0.2
carrier and the complete authored test-proof population. The operation is
deterministic, does not mutate its input, preserves every existing carrier ID,
and refuses pre-existing, mixed, incomplete, or invalid test-proof state. A
coordinator must author the boundary, observable, falsifiers, coverage
dispositions, and prohibited shortcuts; migration never guesses them.
The coordinator must also select every candidate, falsifier, and traversal
provider. A provider-incomplete migration fails with
`migration_provider_bindings_required`; v0.2 carriers remain readable and valid
without provider state.

An operator can perform that explicit conversion directly from the repository:

```sh
node tools/migrate-controlled-contract-v02-to-v03.mjs \
  --input <v0.2-contract.json> \
  --test-proofs <complete-test-proofs.json> \
  [--output <new-v0.3-contract.json>]
```

The test-proofs file is the complete coordinator-authored JSON array; the tool
does not discover, infer, or fill bindings. Without `--output`, it writes the
canonical v0.3 JSON document to stdout. With `--output`, it creates a new file
and refuses to replace an existing path. This direct Node entrypoint is an
explicit operator utility, not a package bin, MCP route, implicit migration, or
product/runtime authority.

`validateTestProofContract` proves only schema presence, closed-vocabulary and
identity/reference integrity, canonical ordering, and population completeness.
Its result explicitly records `not_performed_coordinator_owned` for semantic
judgment. Runtime evidence uses
`controlled-contract-test-proof-runtime-evidence.v1`; it is deterministic,
identity-bound advisory execution data and is not itself proof of test adequacy.
The launcher-owned closed registry resolves the package-owned identities,
brands the implementations, and authenticates its deterministic capability
snapshot. Unsupported traversal is registry-authenticated `review_only`; a
caller cannot mint that disposition or inject an executor callback.
Candidate status and the complete observed/executed/skipped identity inventory
come from child disposition and launcher-captured Node test-runner events;
callers cannot supply observed inventory. Falsifier proof additionally requires an isolated attempt,
an observed launcher substitution, and a structured failure after the unchanged
candidate passes. Module traversal requires launcher-owned V8 instrumentation
and binds the observation to the `node_test_structured_assertion` seam.
Each observation is represented by a launcher-owned content-addressed artifact;
its ID is `artifact-` followed by the hexadecimal portion of the SHA-256 digest
of its retained canonical-JSON payload, which validation rehashes. Test stdout/stderr,
printed traversal markers, echoed reason
codes or environment values, test-authored artifacts, aggregate counts, and
source inspection are diagnostic-only and cannot establish either result.
# Controlled-contract stable identities

The supported normal path is the exact native-v1 family. Admitted-proof-pack
v1 and v2 and assessment v1 and v2 remain distinct data identities and are
validated by their actual consumers; versions are never inferred or aliased.
Experimental carrier/profile identities are not accepted by stable create,
query, authoring, compilation, assessment, or generation entrypoints.

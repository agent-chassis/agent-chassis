
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
admitted falsifier strategies and traversal mechanisms are exactly those the
current package provider catalog declares for each provider (see
[Test-proof runtime identity](test-proof-runtime-identity.md)); every
credit-bearing mechanism has one provider-owned witness validator, and a
mechanism without one cannot receive credit. Other strategies fail resolution
and other boundary kinds use authenticated `registry_unsupported`/`review_only`
state.

There is no migration operation and no operator conversion tool. work record retired
the experimental v0.2/v0.3 families along with `stable-v1-migration.mjs`, so a
carrier in either family is refused at family identity
(`stable_family_experimental_substitution`) rather than read, converted, or
supplemented. A contract is authored directly in the current
`controlled-acceptance-contract.v1` family through its semantic operations, and
a `test_execution` verification claim and its declarative proof definition are
one publishable unit: the carrier refuses the claim without exactly one complete
definition bound to it. Coordinators author that meaning; nothing derives it from
evidence.

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
come from child disposition and the provider's launcher-authenticated structured
events; callers cannot supply observed inventory. Falsifier proof additionally
requires an isolated attempt, an observed launcher-applied mutation whose
provider witness validates, and a structured failure after the unchanged
candidate passes. Traversal requires the provider's launcher-owned observation
of the declared boundary at the provider's declared observation seam.
Each observation is represented by a launcher-owned content-addressed artifact;
its ID is `artifact-` followed by the hexadecimal portion of the SHA-256 digest
of its retained canonical-JSON payload, which validation rehashes. Test stdout/stderr,
printed traversal markers, echoed reason
codes or environment values, test-authored artifacts, aggregate counts, and
source inspection are diagnostic-only and cannot establish either result.
# Controlled-contract stable identities

The supported normal path is the exact native-v1 family. The admitted-pack
loader validates `controlled-contract-admitted-proof-pack.v3`, including its
profile and parameter-companion digest bindings, after selecting the current
catalog identity. Admission v1/v2 artifacts and schemas are retained historical
evidence; they are not supported inputs to that loader.

Assessment versions name different contracts, not interchangeable inputs.
`lib/contract-assessment.mjs` produces and validates the single-pack
`controlled-contract-assessment.v1`. `lib/multi-pack-assessment.mjs` produces
`controlled-contract-multi-pack-assessment.v2`, whose schema is consumed by
`lib/proof-authoring-schemas.mjs`; the wiki-core assessment semantic projection
also requires that exact v2 producer identity. Its pack rows report admission
version 3. Historical multi-pack assessment v1 is not accepted by those current
consumers. Retaining historical bytes does not authorize a compatibility reader;
versions are never inferred, aliased or silently substituted.
Experimental carrier/profile identities are not accepted by stable create,
query, authoring, compilation, assessment, or generation entrypoints.

### Certification retirement and storage

`packages/controlled-contract/profiles/catalog.json` is the sole owner of current
proof-definition membership, and only its identities are stored. Each current
identity has exactly two directories:

- `profiles/<id>/<version>/` holds the runtime definition as raw JSON: profile,
  admission, parameter contract and evaluation template, plus the evaluator or
  component-exclusion companion where the definition has one. The package
  publishes exactly these files and the catalog.
- `test/certification/profiles/<id>/<version>/` holds one `certification.json.gz`
  archive and an optional `README.md`, nothing else. There is no certification
  catalog, and runtime metadata is never copied into it.

When an identity leaves the catalog, its runtime directory, certification
directory and package `files` entries are deleted in the same change. No archive,
alias or historical compatibility fixture is kept, and tests assert current
behavior directly instead of comparing with retired versions. Git history is the
only record of retired bytes.

The archive is a single gzip member written at level 6 with no filename,
timestamp or flags. It is deterministic for one supported Node/zlib toolchain;
byte-equal re-encoding across toolchains is not required. It decodes to a
`controlled-contract-certification-bundle.v1` document naming the exact
`profile_id` and `profile_version`, with `members` sorted by unique relative
path. Each member's `text` is the exact original bytes of one certification
document: the adequacy declaration, negative fixtures, witness index, corpus
and full-census result. Adequacy declarations still name fixtures and witness
indexes by their logical repository path
(`packages/controlled-contract/test/certification/profiles/<id>/<version>/<member>`),
and their `sha256` digests bind the member bytes, not the encoded archive.
Admissions keep their canonical-JSON `adequacy_declaration_digest` and
`adequacy_result_digest`. Executable-closure resources are raw runtime files; no
archive enters a certification closure.

`packages/controlled-contract/test/support/certification-artifact.mjs` is the one
reader and writer. Reads are bounded to 32 MiB encoded and 32 MiB decoded. They
require one gzip member with a matching CRC-32 and length, strict UTF-8 and JSON,
the closed bundle shape, the exact identity when the caller supplies one, and
members that lie inside that definition's archive. Certification generation
supplies the catalog identity. The adequacy loader authenticates the archive's
own identity and resolves that identity's current runtime profile from the
catalog; it does not derive identity from the containing directory. Failures refuse with `<subject>_missing`,
`_encoded_size_exceeded`, `_decoded_size_exceeded`, `_gzip_framing_invalid`,
`_gzip_truncated`, `_gzip_corrupt`, `_gzip_integrity_mismatch`, `_utf8_invalid`,
`_invalid_json`, `_bundle_invalid`, `_identity_mismatch` or
`<subject>_outside_certification_archive`. Every refusal names the artifact and
its recovery. Reads never write, regenerate, fetch or look for a raw JSON file.

Recovery comes in two steps:

1. Restore a damaged archive from version control. Authored negative fixtures,
   witness indexes and corpora cannot be regenerated.
2. Only once every authored input is intact, rebuild the derived adequacy
   digests, results and admissions with
   `node packages/controlled-contract/test/support/build-admitted-proof-pack-catalog.mjs --destination <existing-empty-directory>`,
   then copy its output back.

The generator refuses a certification directory that holds anything besides the
archive and README, and a late certification failure leaves the destination
empty.

Certification archives, the generator and all certification test support are
development-only. The package `files` list never names `test/`, and the package
surface test checks the packed tarball for it.

Regenerating certification changes admission digests. A saved selection pinned to
a changed admission refuses with `verify_proof.execution_pack_binding_mismatch.v1`
until its owner refreshes it through the obligation-coverage upsert
(`refresh_proof_version`). A saved pin to a retired version refuses with
`proof_pack_exact_version_not_current`, and a pin to a definition with no catalog
entry refuses with `proof_pack_not_found`. No pin is rewritten automatically.

### Saved-application verification cutover (work record)

The sole current supported test-validity identity is 11.0.0 (see the mutation
limitation cutover below). Runtime and intent catalogs agree with its single
evaluator registry entry.
Exact admission first compares the requested version with the unique catalog
entry, refusing historical pins with `proof_pack_exact_version_not_current`.
Retired identities are deleted as described under
[Certification retirement and storage](#certification-retirement-and-storage);
there is no alias, upgrade, dual consumer or certificate transfer.

The obligation resolution, population resolution and verification result advance
together to v3. The result replaces plan identities and `planning_pack` with
`execution_source_binding`, `selected_definition` and `resolved_node_identity`.
The package resolver/result builder, wiki-core verifier operation and MCP
execution/detail/summary owners consume the new contracts together. Aggregate
and compact summary remain v1; runtime receipts and semantic kernel are unchanged.
Saved application drafts remain v3, and design validation remains independent.

### Node module-fault provider cutover

`launcher.node-test-module-fault@2.0.0` replaces 1.0.0 as the sole current
module-fault provider. Its observation semantics changed incompatibly: both
strategies are attempt-nonce bound, reached-valid mutation is reported separately
from the selected test's status, and dependency failure no longer detects through
error codes. The provider registry advances to 1.2.0 with a newly derived
capability snapshot; every other provider identity is unchanged. The outer
`controlled-contract-test-proof-runtime-evidence.v2` identity and artifact kinds
remain, with current constraints requiring registry 1.2.0 and allowing a forced
observation that is observed without a selected failure.

`proof.verification.test-validity@10.0.0` becomes the sole current test-validity
definition. Its guarantee and evaluator are unchanged; it publishes the provider
2.0.0 and registry 1.2.0 examples under a new exact identity instead of altering
9.0.0. Provider 1.0.0 bindings and evidence refuse with
`stable_test_proof_provider_version_mismatch`, and stale snapshots refuse with
`stable_test_proof_provider_snapshot_mismatch`. Saved 9.0.0 selections refuse with
`proof_pack_exact_version_not_current` until their owners explicitly refresh them.
Retired definitions and their certifications are deleted. There is no alias, dual
reader, automatic pin upgrade, or evidence credit transfer. The launcher-internal, non-persisted
`workspace-agent-test-proof-module-fault.v1` configuration label is retained
because its producer and consumer change together under provider 2.0.0.

### Native provider family catalog

The provider registry advances to 1.3.0 when the Jest, Vitest, Mocha, AVA,
Deno, lib0/testing, stestr, go test and cargo test families join node:test and
pytest (see
[Test-proof runtime identity](test-proof-runtime-identity.md#native-provider-families)).
Every existing provider identity, mechanism and seam is unchanged. The
definitions and runtime-evidence schemas add the new families' selector source
suffixes, mechanisms (`scalar_return_substitution`, `function_entry_probe` and
each family's candidate mechanism), seams and the `native_test_observation`
artifact type. They require registry 1.3.0 for `registry_unsupported`
traversal. The capability snapshot digest is derived from the new catalog, so
evidence and bindings that carry the 1.2.0 snapshot refuse with
`stable_test_proof_provider_snapshot_mismatch`.

`proof.verification.test-validity@10.0.0` remains the sole current test-validity
definition: its profile, guarantee, parameter contract and evaluator are
unchanged. Its shipped evaluation template binds the current snapshot, and the
existing publisher regenerates the current admissions. Saved selections pin the
admission digest, so a selection saved against the previous admission refuses
with `verify_proof.execution_pack_binding_mismatch.v1` until its owner refreshes it
through the obligation-coverage upsert (`refresh_proof_version`). No pin is
rewritten automatically, and there is no alias or dual reader.

Because every current proof definition's certification closure hashes the provider
registry and the test-proof definitions schema, the cutover regenerates their
certification closure digests, results and admissions through the incumbent
full-census generator. Their profiles, parameter companions and guarantees are
unchanged.

### Mutation limitation cutover

`proof.verification.test-validity@11.0.0` replaces 10.0.0 as the sole current
test-validity definition because its guarantee and exact evaluator change
meaning: an unavailable mutation is a capability limitation that neither earns
nor withholds credit, only a supported, isolated, observed survivor is
counterevidence, and for a passing candidate an incomplete falsifier population
or an unevaluable supported member is `not_executable` rather than unsatisfied.
The evaluator implementation advances to 9.0.0 and the evaluator registry names
only the 11.0.0 entry. The semantic facts keep
`controlled-contract-test-proof-semantic-facts.v1`; each falsifier observation
adds its recorded provider support, isolation, candidate, falsified and
mutation facts and the shared classification `outcome`, and the population adds
`declared_unsupported` and `outcome_counts`. Only the 11.0.0 evaluator consumes
those facts.

The certified, registered and shipped 11.0.0 evaluator bytes are one value: the
evaluator source is the public snapshot's publish-filter fixed point (it carries
no comments for the filter to strip), so publication copies it unchanged. The
snapshot refuses an evaluator that is not that fixed point at its source
boundary with `snapshot_proof_evaluator_not_publication_final`, before any copy,
and still refuses any later byte drift with
`snapshot_proof_evaluator_census_mismatch`.

The certification corpus advances to
`controlled-contract-test-validity-execution-certification-corpus.v3` with three
positive cases, nine single-axis weakenings and two not-evaluable refusal
cases, so the current admission records 14 controls, 9 negative fixtures and 9
coverage witnesses through the incumbent full-census generator. The 10.0.0
definition, evaluator and certification are retired and deleted. Saved 10.0.0
selections refuse with
`proof_pack_exact_version_not_current` until their owners refresh them through
the existing requested/current recovery; no pin is rewritten automatically,
there is no alias or dual evaluator, and retained results keep the verdicts and
evaluator identity they were produced with.

The runtime assessment `controlled-contract-assessment.v3` population adds the
required `falsifier_unavailable_count`, allows `falsifier_count: 0`, and a
proven assessment no longer requires a detected falsifier receipt: unavailable
members produce no receipt. The public verification aggregate and summary keep
their schema identities; freshly produced results use `proven` / `unproven`
statuses and `counts.proven` / `counts.unproven`, while retained historical
records keep the statuses they recorded. New retained verification descriptors
add `outcome_summary` under the current descriptor.

### Proof capability limitations

The test-proof definitions schema adds the optional `falsification_provider`
binding. Omitting it is the incumbent meaning, `provider` mode, under which a
proof declares at least one falsifier, so every saved proof keeps the meaning it
already had and none is rewritten. `registry_unsupported` is the new
declaration: the proof then declares no falsifier, and its selected test still
executes.

`controlled-contract-test-proof-runtime-evidence.v2` adds the required
`capability_limitations` population and the per-check `provider_support` and
`limitation` facts, with `not_run` and `review_only` for a falsifier whose
provider refused its declared subject. The schema version does not advance:
runtime evidence is produced and consumed inside one `workspace_verify_proof`
invocation and retained only as runtime state, so it has no durable consumer to
pin. The launcher is its only producer and always emits the population, empty
when every declared check was applied.

An empty limitation population never means a check was satisfied, and a
limitation never earns the credit of the check it replaces
(see [Test-proof runtime identity](test-proof-runtime-identity.md#capability-limitations)).

### Proof-definition format cutover (work record)

work record subsequently adds package-owned parameter companions and advances current
3.0.0 packs to 4.0.0, idempotency 4.0.0 to 5.0.0, and test-validity's distinct
5.0.0 and 6.0.0 definitions to 7.0.0 and 8.0.0. Admission v3 binds the companion
digest; proof-intent catalog v2 selects admission v3, and multi-pack assessment
v2 reports admission version 3. The package advances to 1.0.0. Superseded
definitions are retired without a dual reader. See [Proof pack parameters](proof-pack-parameters.md).

The removal of global proof-stage classification is a breaking definition-format
change. Current proof definition, input, result, authoring, component-exclusion,
obligation-coverage and proof-verification-result schemas initially used v2;
current authored coverage and execution results use v3 as described above. Current pack
versions advance explicitly: catalog 2.x definitions become 3.0.0 (test-validity becomes 5.0.0),
idempotency 3.0.0 becomes 4.0.0, and the verifier's independent test-validity
4.0.0 becomes 6.0.0. Test-validity 5.0.0 and 6.0.0 retain distinct guarantees.
The embedded authoring projection advances proof-pack selection schemas from
v1/v2 to v3/v4; selector indexes, assessment component-applicability projections and proof resolutions use v2.
Superseded definitions and their certifications are deleted;
no certificate transfers to a changed definition and no consumer silently
substitutes a version. The complete census and certification contract is in the
`@agent-chassis/controlled-contract` package README, "Current proof definition
format and certification (work record)".

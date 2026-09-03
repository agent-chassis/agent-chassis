
# Consumer-independent artifact-set provenance

`@agent-chassis/controlled-contract` owns one artifact-set composition carrier,
`controlled-contract-artifact-set-provenance.v1`, and the build, validate, and
verify operations over it. The carrier answers a single question: for one
authenticated observation occurrence and one exact-binding result, which complete
package population and which complete packed-artifact population were composed,
and what is the resulting artifact-set identity?

Every other fact in the carrier already has an owner inside the package. The
provider composes and binds those owners' outputs; it never restates their
semantics and never establishes a fact of its own.

## What the provider owns and what it delegates

| Responsibility | Owner |
| --- | --- |
| Artifact-set composition, its schema, its public API | this provider |
| Authenticated source, target, attempt, and evidence-occurrence facts | `lib/authentication-provenance-occurrence-projection.mjs` |
| Exact-binding identity carried as `binding_set_sha256` | `lib/exact-binding.mjs` and `controlled-contract-exact-binding-result.v1` |
| Duplicate detection and complete-population comparison | `lib/population-semantics-v1.mjs` |
| Member ordering | `scalarCompare` in `lib/deterministic-lexicographic-ordering.mjs` |
| Carrier identity | `domainSeparatedDigest` in `lib/proof-aware-digest.mjs` |
| Diagnostic bounds, ordering, truncation, and path addressing | `lib/bounded-diagnostic-projection.mjs` |
| Type terms and operators | `vocabulary/controlled-contract-vocabulary.v1.mjs` |
| Caller-input authority confinement | `lib/caller-input-authority-confinement-projection.mjs` |

Refusal codes are the one vocabulary the provider does own. They are its own
closed, stable set, exported as `ARTIFACT_SET_PROVENANCE_REFUSAL_CODES`; the
controlled vocabulary is not the refusal-code owner and is used only for its
existing type-term and operator responsibilities.

## Authentication provenance enters through one gate

`buildArtifactSetProvenance` accepts authentication provenance only as the six
exact witness byte sources of the provenance owner, and admits them by calling
`deriveAuthenticationProvenanceOccurrenceCapture` itself:

```js
buildArtifactSetProvenance({
  authentication_provenance_witnesses: {
    evidenceContentBytes,
    targetResolutionWitnessBytes,
    sourceAuthenticationWitnessBytes,
    sourceOfRecordAssignmentWitnessBytes,
    attemptBindingWitnessBytes,
    authenticationWitnessBytes
  },
  binding_set_sha256,
  package_population: { complete_capture_source_set_sha256, members },
  artifact_population: { complete_capture_source_set_sha256, members }
});
```

`assertAuthenticationProvenanceOccurrenceCapture` is a structural assertion over
an already-admitted value. It is deliberately not reachable from the build path,
so a caller-constructed or merely asserted capture object cannot enter a carrier.
Supplying one under `authentication_provenance_capture` refuses with
`artifact_set_capture_ingress_required`.

Both populations declare the `complete_capture_source_set_sha256` they are bound
to, and both must equal the digest carried by the admitted capture. A population
bound to any other capture refuses with
`artifact_set_capture_population_mismatch`, at build time and again on every
later validation, so mixed or contradictory capture/population combinations
cannot survive in a carrier.

## Composed carrier

```
schema_version                      controlled-contract-artifact-set-provenance.v1
authentication_provenance_capture   the package-produced admitted capture
complete_capture_source_set_sha256  the capture's complete source set
binding_set_sha256                  an input field from the exact-binding owner
package_population                  complete population, bound to the capture
artifact_population                 complete population, bound to the capture
artifact_set_sha256                 the artifact-set identity
```

Each population is the complete-population object produced by
`buildCompletePopulation`, with `complete_capture_source_set_sha256` added as its
capture binding. Members are ordered exclusively by `scalarCompare` over
`member_id`, so ordering follows Unicode scalar values rather than UTF-16 code
units; duplicate identities are refused by the population owner rather than by
this provider.

A package member declares `member_id`, `type_term`, `declared_version`, and
`declared_content_sha256`. A packed-artifact member declares the same fields plus
the `package_member_id` it packs. The packed-artifact population must cover the
package population exactly — one packed artifact per package member, no more and
no fewer — and each packed artifact must declare the same version and content
digest as the package member it names.

## Identity

`artifact_set_sha256` is produced only by `domainSeparatedDigest` under the
literal domain `controlled-contract-artifact-set-provenance.v1`, over exactly:

```js
{
  schema_version,
  authentication_provenance_capture,
  complete_capture_source_set_sha256,
  binding_set_sha256,
  package_population,
  artifact_population
}
```

No other digest and no other comparator determines carrier identity. In
particular `binding_set_sha256` participates as a bound input, not as the
artifact-set identity producer.

The whole admitted capture object is bound directly into that preimage, not only
transitively through `complete_capture_source_set_sha256`. Changing any part of
it — the capture-authority grounded identity or its digest, any projected role's
grounded identity, type term, or raw reference id, the exact normalized
applicability including its operand identities and raw operand reference ids, the
evidence content digest, any witness digest, or any proof digest — changes
`artifact_set_sha256`, even when the other five preimage fields are held constant.
A carrier whose capture was altered after composition therefore refuses with
`artifact_set_identity_mismatch` on every later validation or verification.

Direct binding changes only what the identity covers. The capture is still owned
and validated by `controlled-contract-authentication-provenance-capture.v1`, and
`complete_capture_source_set_sha256` is still exactly the capture's own complete
source set, which the carrier and both populations must carry identically.

Equivalent inputs — permuted member sequences, differing object key order,
distinct but equal buffers — yield exactly one canonical identity. Changing the
capture, the capture source set, either population, or the binding set changes it.

## Failure projection

Every refusal throws `ArtifactSetProvenanceError` carrying a provider-local
stable `code` and a `diagnostics` envelope produced by
`projectBoundedDiagnostics`. The projection owner decides count bounds, byte
bounds, field truncation, and ordering; the provider chooses only the code,
pointer, message, and the expected/actual identities. Diagnostics name member
identities and JSON pointers, never private roots or raw package bytes.

The stable codes, in refusal precedence order, are
`artifact_set_input_unknown_field`, `artifact_set_capture_ingress_required`,
`artifact_set_input_invalid`, `artifact_set_capture_admission_failed`,
`artifact_set_binding_digest_malformed`,
`artifact_set_capture_population_mismatch`, `artifact_set_member_invalid`,
`artifact_set_member_duplicate`, `artifact_set_population_noncanonical`,
`artifact_set_member_missing`, `artifact_set_member_unexpected`,
`artifact_set_content_version_disagreement`,
`artifact_set_carrier_schema_invalid`, and `artifact_set_identity_mismatch`.

Unknown fields, malformed digests, out-of-vocabulary type terms, noncanonical or
contradictory populations, missing or unexpected members, content or version
disagreement, and digest mismatch all refuse. There is no permissive path and no
fallback: nothing is repaired, defaulted, or accepted on a second reading.

## Authority boundary

The provider adds no authority of any kind. It performs no filesystem discovery,
no Git invocation, no environment lookup, no package installation, no release
behavior, no DeepSWE behavior, no wiki persistence, no MCP route, no launcher
receipt, and no storage or policy authority. It reads nothing outside its
arguments.

It consumes authenticated facts only from the admitted capture. It does not
authenticate filenames, paths, mtimes, versions, environment labels, prompts,
prose, or caller digests; those remain caller-declared composition inputs bound
to an authenticated occurrence, and validation success mints no authority over
them. The provider defines no second prohibited-family list and takes no
authority facts from the caller-input authority-confinement projector.

Provider-local schema validation lives in `lib/artifact-set-provenance.mjs`. The
closed schema registry in `lib/exact-binding-common.mjs` is deliberately not
extended, so the exact-binding registry keeps exactly the schemas it already
admits.

## Consumer integration rule

Consumers are adapters, never semantic owners. A consumer acquires its own
authenticated facts, calls `buildArtifactSetProvenance` to compose them, and
calls `validateArtifactSetProvenance` or `verifyArtifactSetProvenance` to confirm
a carrier it received. `verifyArtifactSetProvenance` optionally takes the
identities the consumer expects (`artifact_set_sha256`, `binding_set_sha256`,
`complete_capture_source_set_sha256`) and refuses on any disagreement.

Release integration and DeepSWE fresh-install integration are two independent
consumers of this API. Neither depends on the other, and neither owns or forks
the carrier composition, the delegated primitives, the schema, or the
diagnostics. A consumer that needs different composition semantics changes this
provider under its own work record rather than copying it.

## Publication

`packages/controlled-contract/package.json` is the single publish-closure owner.
The runtime module, its declaration, and the schema enter the published `files`
allowlist and the `exports` surface:

- `@agent-chassis/controlled-contract` — root re-export of the operations, error
  class, schema, and stable code set.
- `@agent-chassis/controlled-contract/artifact-set-provenance` — the module and
  its types directly.
- `@agent-chassis/controlled-contract/schema/controlled-contract-artifact-set-provenance.v1.schema.json`
  — the schema as data.

`packages/controlled-contract/test/artifact-set-provenance.test.mjs` validates
that publication closure and is deliberately not part of the published files
allowlist.

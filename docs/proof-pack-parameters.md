# Proof pack parameters and construction

Each current exact proof definition ships `parameter-contract.json`. The
controlled-contract package owns this metadata, its closed schema, semantic
validation and documentation projection. Instance values, canonical WK sources
and generic construction/resolution belong to work record. This API neither writes
instances nor executes observation providers or `verify_proof`.

The [complete generated index](proof-pack-parameters/index.md) links every current
catalog definition exactly once. The current catalog owns membership, including
test-validity 12.0.0 and its execution evaluator. Only catalog identities are
stored; retired definitions and their certifications are deleted under the
[certification retirement and storage policy](versioning.md#certification-retirement-and-storage).

## Exact binding and publication

`proof.pagination.complete-traversal` is contained at the shared stable
`evaluateVerificationProfileV1` boundary. Evaluation returns an `indeterminate`
result with a `proof_evaluation_unavailable` diagnostic, `outcome: unsupported`
and zero proof credit, naming the proof and the missing connection
between captured transformer inputs/output and the evaluated declaration graph.
The advertised captured/authenticated traversal guarantee cannot currently be
verified. This is a per-proof result: combined assessment continues with the
other selected proofs, retains their results and cannot report all requested
guarantees proven. Unsupported evaluation does not classify the authored
contract as invalid. Unexpected evaluation errors retain their normal causes.

This applies to direct stable evaluation, CLI proof-pack checking, single-pack
and multi-pack assessment, selected-pack claim participation, and explicit
claim-binding validation. Catalogue discovery and definition reads remain
available, with the complete authored guarantee retained. Discovery describes
the published definition; its evaluation metadata does not override this
execution limitation. Pattern matches retain their declaration identities; the
diagnostic identifies the patterns that satisfied declaration matching. Those
patterns report `indeterminate` for guarantee participation, so neither claim
participation nor component selectors can promote them to guarantee credit.
Existing captured-input transformer results remain evidence of those separate
checks. Experimental unadmitted pattern matching is not a stable proof result
and cannot establish the guarantee.

The unresolved decomposition is declaration matching against authored population,
count, ordering and binding constraints; captured trace checks for occurrence
coverage, uniqueness, order, cursors, snapshot/version and terminal state; source
authentication and exact subject/attempt alignment; and the enforced connection
from those captured inputs and transformer output to the evaluated graph. The
first is bounded model evidence, and the transformer separately checks its
supplied captures. Neither establishes the remaining connections through public
proof evaluation. No weaker proof definition or saved-reference transfer is
introduced: the existing full guarantee remains unsupported.

Containment changes no digest-bound definition, admission, certification or saved
proof pin. Required evaluator checks remain unmet: transformer rejection is not
proof-evaluator rejection. This is not a repaired or certified proof capability.
The full captured-traversal guarantee remains unsupported. Future work must separate supported claims from unsupported claims;
removing containment requires evidence for the exact guarantee being enabled.

`proof.pagination.snapshot-consistency` and
`proof.pagination.versioned-cursor-refusal` use the same shared unsupported
outcome. Generic evaluation matches authored declarations but neither invokes
`mutation-pagination-trace.v1` nor connects its checked source inputs and result
to the evaluated graph. Each full captured-trace guarantee therefore remains
unsupported, with its own missing-connection diagnostic, zero guarantee and
component credit, and retained `authored_declarations_only` match evidence.
Single-pack assessment and participation withhold credit; combined assessment
continues supported siblings and retains the unsupported claim without claiming
complete success. Requirements, discovery and authoring remain available.

The existing transformer retains its supplied-trace checks. Snapshot consistency
checks the declared immutable snapshot identity and exact captured state, the
relevant live-source mutation between reads, and equality of the stable and
mutation-interleaved ordered member-occurrence sequences. Versioned-cursor
refusal checks the exact stale attempt and refusal, distinct stale/current
versions and captured content, absence of prohibited returns, cursor advances
and protected effects throughout that attempt, and successful continuation after
an unrelated-source mutation in the non-stale control.

Capture provenance is explicitly excluded by both proofs; authentication is not
a prerequisite for their stated guarantees. Neither proof establishes standalone
traversal completeness or unrestricted runtime behavior. Transformer results
remain separate evidence and cannot grant generic assessment guarantee credit.
No source acquisition, authentication, evidence-binding capability, weaker
replacement definition, saved-reference transfer or certificate regeneration is
introduced. Future work must separate supported claims from unsupported claims;
removing containment requires evidence for the exact guarantee being enabled.

`proof.policy.declared-boundary-record-consistency` uses the same shared
unsupported outcome. Its transformer-backed guarantee is unsupported in
assessment: the evaluator matches the independent authored declaration graph
but neither invokes `deriveDeclaredBoundaryRecordConsistency` nor establishes
that its report was derived from the exact policy, caller-supplied observation
record and subject inputs. Matching declarations remain visible as
`authored_declarations_only`; guarantee patterns become `indeterminate`, with
`proof_evaluation_unavailable`, the specific missing connection and zero credit.
Single-pack checking and participation withhold credit, and combined assessment
continues other proofs while retaining this unmet guarantee.

The transformer and its CLI retain their actual supplied-data checks: closed
units and measurement classes, normalized subject measurements, the exact
N-1/N/N+1 census for nonzero limits or N/N+1 for a zero maximum, recorded
dispositions, complete populations/counts/associations and canonical reporting
bound to the exact source-set digest. Removing a boundary case still fails with
`boundary_census_incomplete`, even when the separate graph matches. The existing
`verifyDeclaredBoundaryRecordConsistency` wrapper runs those data checks with
`caller_declaration_only` authority; it grants no assessment proof credit.
Observation provenance remains `caller_asserted`. Authentication and production
enforcement are outside this proof's scope; they are not missing prerequisites
for its stated supplied-record guarantee.

The complete published requirement, admission, parameters, discovery and authoring
remain available and unchanged. Evaluation metadata describes the published
definition; it does not establish the missing connection. Declaration matching
and transformer verification need a later definition separation before either
can be independently advertised for credit. That separation is not implemented,
and no weaker definition, saved-pin refresh or certification regeneration is
part of containment. Historical adequacy controls record transformer kills
separately from graph satisfaction; those kills do not establish evaluator
rejection or the transformer/source connection.

`proof.policy.declared-limit-propagation` independently uses that shared
unsupported outcome, with zero guarantee credit and its own missing-connection
reason. Assessment matches its declarations but neither invokes
`deriveDeclaredLimitGuidancePropagation` nor binds its report to the exact
declared policy and raw UTF-8 guidance artifact. A matching graph cannot certify
missing guidance, a stale decimal value or a wrong unit token. The raw-guidance
transformer and CLI still require exactly one plain-decimal value and exact unit
token per policy key; they reject missing, duplicate, stale, conflicting,
substituted, wrong-unit and unrelated-number guidance and emit source-bound
canonical reports with complete populations, counts and associations.

These policy meanings remain separate: boundary-record consistency does not
establish guidance propagation, and guidance propagation does not establish
boundary-record consistency. Their full requirements, discovery and authoring
survive containment. Combined assessment retains both unsupported results and
continues supported siblings. Independent declaration matching and raw-guidance
verification also require later definition separation; no such definition
change or new capture capability is implemented here.

`proof.authentication.direct-source-provenance`,
`proof.observation.sound-negative` and
`proof.input.caller-authority-confinement` use the same shared unsupported
outcome, each with its own missing-connection reason and zero guarantee credit.
Generic assessment matches independently authored declarations; it does not
invoke their source checkers or establish that the checked sources and derived
output are the evidence for the evaluated graph. Direct stable evaluation,
admitted checking, single-pack and multi-pack assessment, participation and
component selectors all withhold the full source-backed guarantees. Combined
assessment retains all three unsupported outcomes and supported sibling results;
it cannot report complete proof success. Declaration matches remain visible as
`authored_declarations_only`, with matching guarantee patterns indeterminate.

The source checkers remain separate supported operations:

- `deriveAuthenticationProvenanceOccurrenceCapture` checks exact evidence content,
  target resolution, source authentication, source-of-record assignment, attempt
  binding and authentication witnesses. Its Ed25519 signatures and identity
  bindings are checked within the existing declared trust boundary; containment
  adds no external trust-root or source acquisition authority.
- `deriveSoundNegativeObservationCapture` composes authentication checking with
  required-source coverage, observation/attempt alignment and interval checks.
  It retains its actual absent, present and unavailable conclusions; incomplete
  or invalid observations cannot establish absence.
- `deriveCallerInputAuthorityConfinementCapture` composes sound-negative checking
  with the exact policy, accepted and forbidden requests and observation capture.
  It retains typed member classification, resolution-coordinate confinement,
  refusal-cut checks and rejection of prohibited pre-refusal effects.

Assessment does not connect the authentication witnesses to the claimed
occurrence, the sound-negative capture to the claimed absence, or the policy,
requests and composed observation capture to the claimed caller confinement.
Matching graphs cannot establish any of these connections. No acquisition,
authentication, capture or binding capability is added. The full authored
profiles, admissions, parameter contracts, discovery and authoring remain
unchanged. Certification artifacts and saved pins are not refreshed. Definition
separation is still distinct future work; no saved guarantee is reassigned to a
narrower declaration claim.

`proof.failure.supplementary-isolation` and
`proof.ordering.lexicographic-conformance` also use the shared unsupported
outcome, each with its specific missing-connection reason and zero guarantee and
component credit. Assessment matches authored declarations but neither invokes
their captured-source transformers nor connects the checked sources and
transformer result to the evaluated graph. Matching patterns remain bounded
`authored_declarations_only` evidence; guarantee participation is indeterminate.
Mixed assessment retains both separate unsupported outcomes and unrelated
supported results without reporting complete proof success.

The separate source transformations retain their useful results:

- `supplementary-isolation-attempt-record.v1` derives a graph from the exact
  attempt, core-settlement, supplementary-failure and final-result captures.
  Its captured facts preserve core settlement before supplementary failure,
  exact core value/member preservation, exactly one present-unavailable or
  omitted-disclosed branch, and exactly one reason from the closed captured
  population. Bad captures retain their failed declaration checks; projection
  alone does not establish satisfaction.
- `deterministic-lexicographic-conformance.v1` and its
  `derive-lexicographic-conformance` CLI retain complete populations/counts,
  key precedence/direction, first-unequal-key comparison, stable identity
  tie-breaking, and the existing comparator and input, declaration and
  serialization permutation checks. Invalid captured artifacts still fail;
  valid artifacts still produce the canonical digest-bound conformance report.

The full requirements, exclusions, profiles, admissions, parameter contracts,
discovery and authoring remain unchanged. No runtime execution, source
acquisition, authentication or evidence-binding capability is added. Certificates,
saved pins and publication inputs are not refreshed to obtain credit. Declaration
matching and captured-source verification still require later definition
separation; that separation is not complete and no saved guarantee is weakened
or reassigned.

`proof.dormancy.nonactivation` uses the same shared unsupported outcome for its
full exact-capture guarantee, with zero guarantee and component credit. Its
declaration checks remain observable in the diagnostic's
`declaration_match.satisfaction` and `satisfied_pattern_ids`, alongside retained
pattern identities and ordinary failure diagnostics. These checks cover declared
complete graph, entrypoint and activation populations, membership, exactly zero
declared activation events, operand joins, and four caller-supplied resolver
facts: direct construction succeeds, direct registration succeeds, no path from
declared production entrypoints, and complete activation observation is empty.
Their meaning is conditional on the supplied declarations and resolver facts.
Missing, false, duplicated or misbound facts retain their actual blocked,
unsatisfied or ambiguous results; a nonzero declared activation population does
not establish nonactivation.

The unavailable connection is from those evaluated declarations to the exact
captured production reachability snapshot, default-configuration artifact and
activation-observation artifact named by the guarantee. Positive resolver facts
alone establish neither that connection nor actual production nonactivation.
The contract intentionally excludes dishonest resolver results, independent
reachability recomputation, independent interpretation of configuration bytes
and independent resolver authority; accepting the supplied facts is part of its
declared model. The `executeDormancy` adequacy harness returns synthetic facts;
it neither executes a real component nor discovers production paths.

Direct evaluation, checking, assessment and claim participation withhold the
unsupported guarantee's credit. Mixed assessment continues supported siblings
and retains the full dormancy requirement and its unsupported result. Discovery,
authoring, parameters, admissions and exclusions remain usable and unchanged.
This containment adds no constructor, reachability engine, runtime observer,
configuration parser or authentication requirement. No certificate or saved pin
is refreshed, no narrower capability is introduced, and no requirement is
weakened. Removing containment requires evidence for the exact guarantee being
enabled.

The binding is acyclic: a companion names its profile ID, version and canonical
profile digest; admission v3 names the profile digest and canonical companion
digest. The incumbent admitted-pack loader validates all three before returning
its immutable snapshot. Missing files, malformed JSON, stale digests, unknown
versions, invalid schemas and incomplete role coverage fail explicitly. A
well-formed unavailable constructor is a capability fact, not a policy refusal.

The first parameter-contract cutover was a breaking pack change. Ordinary 3.0.0
packs advanced to 4.0.0; idempotency 4.0.0 advanced to 5.0.0. The then-distinct
test-validity definitions advanced from 5.0.0 to 7.0.0 and from 6.0.0 to 8.0.0,
avoiding reuse of historical identities. Admission became v3 and multi-pack
assessment became v2; the proof-intent catalog advanced to v2 and the JavaScript
package to 1.0.0. The subsequent single-current-identity cutover selected existing
test-validity 9.0.0 alone. The Node module-fault provider cutover then publishes
test-validity 10.0.0 as the sole current identity: its guarantee and evaluator are
unchanged, and its shipped evaluation template binds
`launcher.node-test-module-fault@2.0.0` and the capability snapshot of the
current provider registry. Exact loads of 9.0.0 or 7.0.0 return
`proof_pack_exact_version_not_current` with requested/current identities. Saved
selections pinned to 9.0.0 keep refusing until their owners explicitly refresh
them; no pin is rewritten automatically. The mutation limitation cutover then
publishes test-validity 11.0.0 as the sole current identity with a changed
guarantee and evaluator (see [Versioning](versioning.md#mutation-limitation-cutover)):
unavailable mutation neither earns nor withholds credit, and exact loads of 10.0.0
refuse the same way. Its role and parameter population is unchanged.
Retired profiles, admissions and certifications are deleted rather than retained.
No compatibility reader accepts them, and nothing substitutes them for the
selected current version.

The existing full-census certification and admission generator certifies the new
exact definitions. Each current definition's certification documents are stored
in one `certification.json.gz` archive whose member bytes carry the certified
digests. Runtime metadata stays raw under `profiles/<id>/<version>/`
(see [Versioning](versioning.md#certification-retirement-and-storage)). Definition certification establishes reusable declaration
adequacy under its existing experimental/local authority; it does not establish
that a particular implementation satisfies the guarantee. The parameter schema
and semantic checks additionally bind metadata before admission publication.

## Semantic inputs and sources

The shared kinds are `typed_referent`, `complete_population`,
`bounded_observation`, `selected_value_comparison`, `typed_policy_reference` and
`test_assertion_selector`. Slots carry exact role-refinement and applicability
pointers into the bound profile. The public description returns those constraints
in full, including types, identity kinds, cardinalities, population joins,
equality, multiplicity, order, boundary contexts and satisfaction expressions.
Metadata does not maintain a second editable copy of these constraints.

A semantic referent uses the incumbent native identity schema; generated graph
reference IDs are not semantic author inputs. An assertion selector uses the
incumbent test-selector schema. A policy reference retains the policy's exact
profile constraints; it is not an arbitrary dictionary of limits or ordering
options. Population identities declare intended scope. They do not authenticate
observed membership or let an author certify completeness with a boolean.

Each slot declares exactly one source policy:

- `configurable` permits an explicit semantic input. Only a declared canonical
  mapping may supply a missing input. Current configurable slots declare no
  default or mapping; absence remains missing.
- `canonical` identifies a source-owned relationship. Supplying an explicit
  duplicate produces `canonical_conflict`; it is not an override. Test-validity's
  component and suite come from the canonical test declaration, including its
  exact target and assertion selector.
- `derived` describes a named deterministic operation over declared inputs.
  Values are never persisted as explicit parameters by this package.

The current internal derivations are profile-fixed numeric expectations,
same-reference aliases justified by an actual binding rule, and complete
reference-population count joins. Count joins preserve list length, duplicate
occurrences and every linked input; disagreement is incompatible. Unknown is
distinct from an observed or declared empty list. The incumbent evaluator remains
responsible for validating native population closure, applicability and equality.
The pure derivation API consumes already-resolved lists and does not acquire them.

A `complete_population` reference binding names a population followed by one or
more member roles. The evaluator concatenates all bound member occurrences and
passes them to the existing scoped, equality-normalized closure check. It does
not deduplicate them: duplicate or equality-equivalent bound members, including
overlap between roles, refuse satisfaction. A combined binding closes the whole
partition; it cannot substitute for the separate closure of one iteration or
association population. Identity comparisons still name exactly two roles.

`proof.completeness.lossless-projection@5.0.0` uses this binding to require the
actual compact and omission member roles together to account for the closed
source population. Its independent accounted population remains checked, but
cannot conceal a member missing from both parts. It replaces 4.0.0 as the sole
current identity; saved selections require an explicit owner refresh. The
guarantee and exclusions are unchanged. This checks the declared model and does
not establish that its populations faithfully capture arbitrary runtime output.

Fixed zero is an expectation, not a default measurement. In particular,
settlement-and-cleanup's unlinked `residue_count` remains an owned observation
gap. A count expectation cannot fabricate a post-settlement observation. State
identity, state-value equality, selected-value equality and whole-object equality
remain distinct.

## Role production and construction limits

Every reference and number role has exactly one producer. Coverage distinguishes
semantic parameters, canonical relationships, constants, aliases, count joins,
constructor outputs, required observations and specific capability gaps. Required
roles without an established rule-linked source retain their original
type/cardinality obligations and a named owner; they are not deleted.

The existing integration-prefix builder supplies its 11 declaration outputs.
Its source contract requires canonical slices and a complete typed ownership/path
mapping. Metadata records this capability with static source evidence; reading
metadata does not invoke the builder or prove that its required sources exist.
General skeleton matching against an already-populated native graph does not
establish a general named-pack constructor. Other packs identify that limitation
separately from their usable semantic parameters and required observations.

`proof.integration.prefix-safety` has a working construction path:
`buildIntegrationPrefixAuthoring` invokes the package-owned
`integration-prefix-census.v1` transformer over the derived DAG, integration-unit
partition, execution paths and required branches. It constructs the complete
prefix × path × required-branch population, emits the exact source and census
artifacts, and authors the corresponding case graph. These census-derivation
results remain usable. Structural and binding validity are checked independently
of guarantee establishment; unsupported assessment does not invalidate generated
bindings or prevent proof-plan construction. Malformed bindings still refuse.

Generic assessment can match an independently authored graph without establishing
that the transformer derived its case population from those exact sources. It
therefore reports the guarantee as unsupported through
`proof_evaluation_unavailable`, with zero proof credit, while retaining declaration
matches and unrelated supported proof results. A self-consistent reduced or
substituted population cannot establish complete source-derived census coverage.
Each case's preservation is an authored declaration, not runtime preservation
evidence. Dishonest preservation declarations and runtime/deployment behavior
remain excluded; no execution requirement or preservation checker is implied.
Admission requirements, parameters and discovery remain available. Removing this
assessment limitation requires establishing the exact source-to-census-to-graph
derivation, not relaxing its declarations or exclusions.

Capabilities separately describe construction, canonical source resolution,
observation acquisition and evaluation. `implemented`, `declared_requirement`
and `unavailable` are distinct states. Implemented identities belong to the
package's closed capability vocabulary; metadata cannot name a command or import
an arbitrary module. Static evidence is explicitly labeled static.

Implemented capabilities name their own implementation version in addition to
the export identity. That version identifies the implementation behind the
capability, not the release that ships it, so a package bump does not reauthor
a pack whose capabilities did not change. Unavailable and declared-requirement
capabilities carry no implementation version. Integration construction
separately declares its required canonical slice DAG and typed ownership/path
source map.

Dependencies are either a complete authored declaration of exact supporting
identities and input/output mappings, or an owned unresolved construction fact.
An empty complete list means the author established no supporting packs.
An absent dependency recipe does not establish that conclusion. Current companions
retain unresolved recipes explicitly. Validation detects duplicate identities,
stale digests, missing inputs/outputs, ordering errors and cycles. Instance
expansion, sharing and deletion belong to work record.

## Package API and documentation

Import the public API from `@agent-chassis/controlled-contract/pack-parameters`.

```javascript
import { loadCurrentParameterPopulation, describePackParameters,
  inspectPackParameterCoverage } from '@agent-chassis/controlled-contract/pack-parameters';

for (const { pack, contract } of await loadCurrentParameterPopulation()) {
  const parameters = describePackParameters(contract);
  const coverage = inspectPackParameterCoverage(contract, pack.profile);
}
```

`loadPackParameterContract` accepts only the incumbent admitted snapshot.
`validatePackParameterContract` validates a companion against a bound profile and
returns an immutable snapshot. Description and rendering require that validated
snapshot. Coverage and descriptions return complete populations with exact
`total`, `returned` and `omitted: 0`; no compact transport or secondary cursor
system is introduced. Downstream bounded transports must retain their existing
complete retrieval path.

The package command uses the same validator and renderer as the API:

```sh
node packages/controlled-contract/bin/proof-pack-parameter-docs.mjs --write docs/proof-pack-parameters
node packages/controlled-contract/bin/proof-pack-parameter-docs.mjs --check docs/proof-pack-parameters
```

Both modes derive the complete expected file set from current validated metadata.
Check mode detects missing, extra and edited output and performs no writes.
Generation refuses unrecognized extra files rather than deleting them silently.
Pages contain no timestamps or absolute checkout paths. The installed package can
generate or check a supplied documentation directory without scratch artifacts
or source-checkout imports. Run it from the consumer's Git repository: the
incumbent validator cache stores generated validators under that writing
repository, as documented in the package README. Generated pages are projections; this guide and the
package's exact metadata/profile/admission owners remain authoritative.

## Validation and reconciliation

The current population contains 37 definitions, 957 roles and 733 parameters,
and the parameter tests check every current contract's role coverage and
mutation refusals directly. `proof.verification.test-validity@12.0.0` is current,
replacing 11.0.0 with no fixed graph roles or semantic parameters. Write confinement is
deactivated as a selectable proof: it has no catalog entry, no controlled intent
and no discovery candidate. Repository write-scope enforcement and candidate-diff
checks do not depend on it. The live population is projected from the current
catalog exactly once on every load. Retired definitions, including
test-validity 7.0.0 to 11.0.0 and write-confinement 4.0.0, have no files and no
generated documentation page.

A saved selection of a definition outside the current catalog is never
substituted, repinned or deleted. Exact loading refuses it with
`proof_pack_not_found` naming the requested profile id, validation reports that
refusal against the saved selection, and the obligation and its authored
parameters remain as saved without proof credit.

P1–P8 are exercised by the parameter unit tests; P9 by documentation drift tests;
P10 by installed-package publication and corruption tests; P11 by incumbent
full-census certification/publication checks; and P12 by installed-package current
selection, exact parameter binding and execution-guard checks. P12 exercises
named/exact selection agreement, noncurrent 7.0.0 refusal, accepted execution
identity and rejection of an admitted snapshot with a corrupted evaluator
identity. These are ordinary engineering
obligations for work record, separate from its coordinator-owned implementation review.

## Prospective native compatibility

The current `proof.verification.test-validity@12.0.0` definition describes the
existing authenticated execution mechanism through the closed
`controlled-contract-test-execution-profile.v1` schema. It requires no fixed
component-exists, suite-covers-component or suite-verifies-component graph, and
no fixed absence falsifier. Native case authoring associates the selected test
with the caller's unchanged requirement, verification and falsification meanings.
The case's component, target, observation and optional supported falsification
remain native execution inputs; they are not generic graph-role parameters.

Definition assessment reports execution pending. The exact runtime evaluator
continues to check authenticated candidate and selected-test facts, supported
mutation outcomes, required traversal and prohibited shortcuts. Unavailable
mutation remains a capability limitation. Assertion-to-requirement adequacy is
unsupported and passing execution grants no requirement-satisfaction credit.
Retired versions are deleted; saved pins move only through explicit refresh.

`inspectParameterSource`, profile binding validation and candidate offers share
the package reference-role predicate. Ordinary native/proof edits use the existing
resolver in known-parameter mode: absent facts are incomplete, while supplied
cardinality, type, identity-kind and source-policy contradictions refuse before
publication. This mode never invokes constructors or observation providers.

Case instance edits retain the current definition publication. The parent
obligation source owns each authored case once; uses reference `case_id`. The
existing resolver checks known prospective parameters across all parent/slice
uses against that same definition. Native projections and verification consume
the saved case revision, with no independently editable native copy or new pack
version for a case edit. See [ordinary case authoring](acceptance-coverage-mcp.md#incremental-authored-cases).

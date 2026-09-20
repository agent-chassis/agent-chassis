# Proof pack parameters and construction

Each current exact proof definition ships `parameter-contract.json`. The
controlled-contract package owns this metadata, its closed schema, semantic
validation and documentation projection. Instance values, canonical WK sources
and generic construction/resolution belong to work record. This API neither writes
instances nor executes observation providers or `verify_proof`.

The [complete generated index](proof-pack-parameters/index.md) links every current
catalog definition exactly once. The current catalog owns membership, including
test-validity 10.0.0 and its execution evaluator. Historical directories
are evidence; directory enumeration and historical fixture counts do not select
current definitions.

## Exact binding and publication

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
them; no pin is rewritten automatically.
Historical profiles, admissions and
certification results retain their original bytes. They are not accepted through
a compatibility reader or substituted for the selected current version.

The existing full-census certification and admission generator certifies the new
exact definitions. Definition certification establishes reusable declaration
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

The cutover ledger in the package test data records historical, work record baseline
and new identities, profile digests and each role refinement. Its original
39 definitions, 968 roles and 744 parameters remain historical reconciliation
evidence. The current population contains 37 definitions, 959 roles and 735
parameters. The removed current identities are
`proof.verification.test-validity@7.0.0`, with two roles and two parameters, and
`proof.scope.write-confinement@4.0.0`, with seven roles and seven parameters;
`proof.verification.test-validity@10.0.0` is current, replacing 9.0.0 with the same
role and parameter population. Write confinement is
deactivated as a selectable proof: it has no catalog entry, no controlled intent
and no discovery candidate. Repository write-scope enforcement and candidate-diff
checks do not depend on it. The live population is projected from the current
catalog exactly once on every load. Historical profile, companion and
certification bytes and the original ledger remain unchanged; the obsolete 7.0.0
and write-confinement 4.0.0 pages are excluded from the generated current docs.

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

The current `proof.verification.test-validity@10.0.0` component role accepts exactly
one explicit `cc:runtime_component` with `repository_path` or `profile_term`
identity. The suite remains exactly one `cc:test`/`profile_term`, distinct from
the component. The authenticated execution guarantee and evaluator implementation
are unchanged from v9. Historical v8 and v9 bytes are retained; exact v8 or v9
selection is not an alias for v10 and saved pins move only through explicit refresh.

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

# @agent-chassis/controlled-contract

Deterministic controlled-contract validation and proof-plan assessment.

The package has bounded proof-intent discovery, selection, authoring, and
assessment commands:

```sh
controlled-contract --input contract.json

controlled-contract-discover-proof-intents

controlled-contract-discover-proof-intents \
  --query "compact result omissions"

controlled-contract-select-proof-packs \
  --input contract.json \
  --intent controlled-proof-intent.lossless-projection

controlled-contract-describe-proof-pack \
  --profile-id proof.completeness.lossless-projection \
  --profile-version 1.0.0 \
  --intent controlled-proof-intent.lossless-projection

controlled-contract-inspect-proof-pack-bindings \
  --input contract.json \
  --profile-id proof.completeness.lossless-projection \
  --profile-version 1.0.0 \
  --intent controlled-proof-intent.lossless-projection

controlled-contract-build-proof-plan \
  --input contract.json \
  --request proof-plan-request.json

controlled-contract \
  --input contract.json \
  --proof-plan proof-plan.json
```

It checks the v0.34 controlled graph and writes a bounded assessment to stdout.
The lossless reports are stored beneath
`.cache/controlled-contract/assessments/sha256/<assessment-digest>/`.

## What the result means

The planning assessment keeps four questions separate when an exact-bound pack is selected:

- `structure`: is the authored controlled graph internally valid?
- `profile_discrimination`: does it satisfy a release-certified proof pack?
- `exact_binding`: do the complete captured inputs satisfy that pack's exact
  binding declaration?
- `residue_status`: what meaning remains explicitly outside the controlled graph?

The command is non-authoritative. It never turns authored claims into runtime
truth, and honest residue does not make a structurally valid contract invalid.
There is no unqualified `pass` result.

The checker cannot discover an obligation omitted from the authored contract.
Repository grounding is only a structural anchor; it does not prove that a path
or symbol exists or is honest. Delivered runtime behavior is outside this
planning assessment, and a clean structural assessment alone does not prove that
a WK is implementation-ready.

## Discover controlled proof intents

`controlled-contract-discover-proof-intents` is the preceding discovery step.
With no arguments it returns all 27 controlled intents exactly once. Each compact
summary contains the exact intent ID, its one-sentence definition, controlled
discovery terms, exact capable pack IDs and versions, and authored distinctions
from commonly confused intents. It reads only the intrinsic
`proof-intents/catalog.json`; complete profiles, adequacy controls, certification
corpora, and the raw catalog do not appear in the result.

Search mode accepts ordinary local text:

```sh
controlled-contract-discover-proof-intents \
  --query "refusal before effects"
```

Search normalizes case, punctuation, Unicode compatibility forms, repetition,
and query-term order. Exact all-token matches are the strongest result class.
When none exists, any catalog entries sharing at least one term are returned as
explicit `partial_match` candidates with matched and unmatched terms. A true
zero-overlap query remains `no_match`; both outcomes include bounded remediation
guidance rather than dumping the catalog. Exact IDs are mechanically matched
without suppressing another entry in the same strongest class. All catalog
entries are evaluated before the optional `--limit` is applied. Every result
includes exact source values and match coverage plus `evaluated_intent_count`,
`total_match_count`, `returned_count`, `omitted_count`, and `truncated`; zero
matches reports `no_match`. Candidate order is stable intent-ID order, not a
ranking, and partial discovery never calls any candidate best or authoritative.

The pure `discoverProofIntents` API accepts only `query` and, in search mode,
`limit`. The CLI and API accept no path, root, catalog, executable, module, or
environment override. They never select, combine, invoke, or admit a pack. The
canonical UTF-8 JSON result is bounded to 65,536 bytes and fails closed rather
than omitting fields required to interpret the result.

## Select proof packs mechanically

`proof-intents/catalog.json` is the single intrinsic mapping from stable
controlled proof-intent IDs to exact admitted pack IDs and versions. It records
the intent definition, mechanically checkable compatibility, required inputs,
exact-binding requirement, and distinctions from commonly confused intents.

After discovery, explicitly choose controlled intent IDs. The pure
`selectProofPacks` API accepts only a controlled contract and those explicitly
requested controlled intents. It never infers an intent from prose or graph
omission. A missing obligation therefore leaves the requested candidate visible
as `requires_bindings`; unknown or stale-digest requests fail closed; multiple
mechanically valid candidates remain an explicit ambiguity with no ranking.
The compact selector command returns only relevant intent definitions and
distinctions, pack guarantees and exclusions, required inputs, remediation
codes, an exact authoring-projection digest and pattern counts, and
substrate/source digests. It does not return the 26 profile definitions or
certification corpora.

## Author one selected proof pack

After choosing an exact candidate, use
`controlled-contract-describe-proof-pack` with its exact profile ID and version.
The command accepts no path, catalog, root, module, executable, or environment
override. An optional repeated `--intent` narrows the projection and fails when
the intent does not map to that exact pack.

The result is a typed `controlled-contract-proof-pack-authoring.v1` projection.
It contains the selected guarantee, every explicit exclusion, relevant intent
distinctions, every reference and number binding requirement, distinctness and
population/count constraints, compact claim propositions, falsifiers,
verification relations, collections, resolver/evidence requirements, and the
exact satisfaction expression. Its evaluation-input skeleton names where the
caller must supply contract reference IDs and numbers without copying the
pack's example identities into a new contract.

Claim propositions use a display notation only: `$role` is a profile role,
`number($role)` is a number-role operand, brackets contain the operand list, and
`@mode($role)` is the applicability context. The profile remains the enforcing
artifact; the projection is a digest-bound authoring view, not a second grammar.
Every shipped pack must project within 65,536 UTF-8 bytes. An oversized
projection fails closed instead of truncating. Certification controls,
mutation corpora, profile source paths, and executable modules never appear.

## Inspect evaluation-input bindings

After describing an exact admitted pack, run
`controlled-contract-inspect-proof-pack-bindings` with the contract, exact
profile ID/version, optional repeated controlled intents, and optionally an
existing `--evaluation-input`. The pure `inspectProofPackBindings` API accepts
the corresponding in-memory JSON values.

For every reference and number role, the result reports allowed types, identity
kinds, cardinality or numeric constraints, every mechanically compatible
contract candidate, exact compatibility facts, any supplied binding, and a
typed `unbound`, `one_compatible_candidate`, `ambiguous`, `incompatible`, or
`validly_bound` status. It also identifies profile patterns, population uses,
distinctness sets, and count constraints that consume the role. A single
candidate remains unselected: neither the API nor CLI writes an evaluation
input, interprets identity names, or treats compatibility as semantic truth.

Profiles, admissions, catalogs, and intent mappings are package-owned. Stale
identity, incompatible intent, malformed contract, and malformed evaluation
input fail closed. Semantically invalid supplied bindings remain explicit as
`incompatible` and make the CLI exit 2. Canonical output binds contract,
evaluation-input, profile, admission, catalog, vocabulary, profile-population,
intent-artifact, and authoring-projection digests; it fails instead of
truncating beyond 65,536 UTF-8 bytes.

Population remediation reports name both accepted membership declarations,
`reference:contains` and `reference:member_of`, together with the affected
population, applicability scope, declared members, membership claims, declared
cardinality, and observed member count. Empty populations still require an
explicit exact cardinality of zero, and enforcement is unchanged.

## Build a canonical proof plan

After authoring every required evaluation input, put only the remaining caller
choices in a schema-valid `controlled-contract-proof-plan-request.v1` document:

```json
{
  "schema_version": "controlled-contract-proof-plan-request.v1",
  "requested_intents": [
    "controlled-proof-intent.lossless-projection"
  ],
  "selected_packs": [
    {
      "profile_id": "proof.completeness.lossless-projection",
      "profile_version": "1.0.0",
      "evaluation_input_path": "lossless-projection.evaluation-input.json"
    }
  ]
}
```

Then compile it mechanically:

```sh
controlled-contract-build-proof-plan \
  --input contract.json \
  --request proof-plan-request.json > proof-plan.json
```

The compiler reruns intrinsic selection, loads only exact admitted package-owned
packs, verifies that each requested intent is assigned to exactly one explicitly
selected capable pack, validates supplied evaluation-input bindings, and computes
the contract, catalog, vocabulary, profile-population, intent-artifact, profile,
admission, guarantee, adequacy, evaluation-input, and exact-binding digests. For
exact-bound packs, the selected-pack request must also declare `exact_capture`
with its capture root, normalized relative contract and evaluation-input paths,
and exact sources. Paths in the request are resolved relative to the request
file; the emitted plan binds resolved evaluation-input and capture-root paths.

Missing inputs are returned together as stable typed diagnostics. Omitted or
unknown intents, ambiguous assignments, uncovered or incompatible intents,
duplicate or stale packs, malformed or incompatible evaluation inputs,
unexpected exact capture, unsafe exact paths, and conflicting exact file
identities fail closed. The request cannot contain digests, placeholders,
caller catalogs, profile paths, modules, executables, environment overrides,
alternate package roots, or an output path. The compiler never infers an intent,
selects a pack, or binds a role. Its canonical JSON is deterministic under
property, intent, and selected-pack reordering and is bounded to 131,072 UTF-8
bytes.

The complete authoring workflow is:

```text
discover-proof-intents
→ select-proof-packs
→ describe-proof-pack
→ inspect-proof-pack-bindings
→ author evaluation input
→ build-proof-plan
→ assess-contract
```

## Assess proof packs

The package contains only each pack's compact runtime carriers. Ordinary packs
ship a profile, evaluation-input template, and release admission. Exact-bound
packs also ship an exact-binding declaration and its release certification.
Assessment verifies those digest bindings; it does not ship or rerun the large
mutation, negative-fixture, and coverage-witness corpora used to certify a pack
release.

Every admitted assessment, including a one-pack assessment, requires a
schema-valid `controlled-contract-proof-plan.v1` document. The CLI has no
single-pack flags and never assigns proof intent implicitly. Exact-bound pack
entries carry their capture root, relative contract and evaluation paths, and
source declaration inside that plan.

`proof.compatibility.behavioral-preservation` binds complete baseline and
candidate behavior-report artifacts to the same contract/evaluation snapshot.
It requires equal captured bytes and distinct caller-selected source
descriptors. Different paths are not proof of different filesystem objects,
producers, or honest baseline/candidate provenance; byte-identical copies and
hard links remain inside that explicit grounding boundary.

## Assess a proof plan

Use a schema-valid `controlled-contract-proof-plan.v1` document for zero, one,
or several packs:

```sh
controlled-contract \
  --input contract.json \
  --proof-plan proof-plan.json
```

Each pack entry independently binds its profile ID and version, requested
controlled intents, evaluation-input location and digest, admission/profile
digests, and—when required—its capture root, relative contract and evaluation
paths, exact source declaration, and exact-binding digests. Plan-level digests
bind the contract, admitted catalog, vocabulary, profile population, and intent
artifact. Duplicate identities, conflicting inputs, unknown intents, stale
digests, and pack/intent mismatches fail closed.

The aggregate result proves profile discrimination only when every selected
pack proves its own guarantee. Every v2 pack runs its own deterministic exact
capture. Per-pack guarantees are not collapsed, and all diagnostics, exclusions,
and missing inputs retain their pack ID/version provenance. Zero packs leaves
profile discrimination and exact binding `not_assessed`; authority is always
`non_authoritative`. Delivered runtime behavior is outside the assessment rather
than an incomplete proof intent or axis.

The complete machine-readable list is `profiles/catalog.json`. A missing pack is
reported as not assessed; a different proof pack cannot silently substitute.

## Compact output

The multi-pack terminal result is intentionally small:

```json
{
  "requested_proof_intents": ["controlled-proof-intent.lossless-projection"],
  "selected_pack_count": 1,
  "evaluated_pack_count": 1,
  "structure": "proven",
  "profile_discrimination": "proven",
  "exact_binding": "not_assessed",
  "assessment_scope": "planning",
  "authority": "non_authoritative",
  "per_pack": [{
    "profile_id": "proof.completeness.lossless-projection",
    "profile_version": "1.0.0",
    "profile_discrimination": "proven",
    "exact_binding": "not_applicable"
  }],
  "diagnostic_count": 0,
  "exclusion_count": 0,
  "missing_input_count": 0,
  "artifact": "controlled-contract-assessment://sha256/.../manifest.json"
}
```

The bundle uses the fixed files `assessment.json`, `assessment.md`,
`structural.full.json`, `proof-packs.full.json`, and `manifest.json`.
`proof-packs.full.json` losslessly preserves every independently evaluated pack,
its admission, diagnostics, exclusions, missing inputs, source digests, and exact
capture result without filename collisions. Caller plan paths and capture-root
paths do not participate in the content identity.

## Library API

```js
import {
  assessContractFiles,
  assessExactBoundContractFiles,
  assessProofPlanFiles,
  assessStructuralContractFile,
  buildProofPlan,
  buildProofPlanFiles,
  canonicalProofPlanJson,
  canonicalProofIntentDiscoveryJson,
  discoverProofIntents,
  inspectProofPackBindings,
  selectProofPacks,
  loadAdmittedProofPack,
  readProofPackCatalog,
  describeProofPackAuthoring,
  searchVocabulary
} from "@agent-chassis/controlled-contract";
```

Vocabulary queries return advisory slices for authoring convenience. Validation
always uses the complete intrinsic v0.34 vocabulary and its declared algebra.

## Deterministic projection bounds

The package-owned `integration-prefix-census.v1` transformer is a bounded local
materialization mechanism. It deterministically expands an exact captured slice
DAG, its exact integration-unit partition, and its exact execution-path and
required-branch population into the complete supplied prefix-case census. It is
not an unbounded symbolic proof engine.

The transformer accepts at most 20 integration units and materializes at most
100,000 prefix/path/branch cases. Inputs at either bound are accepted. An input
that would exceed either bound fails closed with the stable
`projection_population_limit_exceeded` diagnostic; the transformer never
truncates or samples the census. A larger population therefore needs a different
package-owned derivation strategy rather than an author-selected cap.

## Supported public surface

The published artifact contains the current v0.34 runtime, bounded discovery,
selection, authoring, binding-inspection, proof-plan compilation, and assessment
commands, current schemas, the intrinsic
vocabulary, and compact admitted packs. Historical carriers, prototype policy
tools, pack fixtures, mutation corpora, coverage witnesses, and
release-certification executables are development sources and are not
published.

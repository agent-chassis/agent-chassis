# Verification Profile SDK

The verification-profile SDK is the free-tier extension point for deterministic
proof packs. A native controlled contract states required behavior and its
authored verification. A verification profile states the controlled graph shape
that counts as an adequate proof plan for one reusable behavior class.

Profiles are versioned JSON data. They contain no executable code, prose
predicate, model instruction, policy decision, or authorization effect.

The v0.2 path derives proposition terms, signatures, applicability, and
complements from the complete `cv.experimental.0.34` artifact. A profile binds
that vocabulary's signature, algebra, definitions, and complete digests. Its
result envelope repeats those digests and the contract schema version. A direct
evaluator result also states `admission.kind: unadmitted_direct`; only the outer
local CLI envelope can state that the pack's adequacy gate ran. Reduced
vocabulary query views remain authoring aids only and never participate in
validation.

## Public experimental surfaces

- Current vocabulary-derived profile schema:
  `schema/controlled-contract-verification-profile.experimental.v0.2.schema.json`
- Current evaluation-input schema:
  `schema/controlled-contract-verification-profile-input.experimental.v0.2.schema.json`
- Current result schema:
  `schema/controlled-contract-verification-profile-result.experimental.v0.2.schema.json`
- Current pure evaluator: `experimental/verification-profile-v034.mjs`
- Frozen v0.33 compatibility schemas:
  `schema/controlled-contract-verification-profile.experimental.v0.1.schema.json`
  `schema/controlled-contract-verification-profile-input.experimental.v0.1.schema.json`
  `schema/controlled-contract-verification-profile-result.experimental.v0.1.schema.json`
- Frozen compatibility evaluator: `experimental/verification-profile.mjs`
- Local CLI: `bin/check-verification-profile.mjs`
- Current idempotency pack:
  `profiles/proof.idempotency.effect-nonduplication/2.0.0/profile.json`
- Current refusal-before-effects pack:
  `profiles/proof.authorization.refusal-before-effects/1.0.0/profile.json`
- Current atomicity pack:
  `profiles/proof.atomicity.failure-boundary/1.0.0/profile.json`
- Current failed-attempt nonconsumption pack:
  `profiles/proof.authorization.failed-attempt-nonconsumption/1.0.0/profile.json`
- Current single-use replay-refusal pack:
  `profiles/proof.single-use.replay-refusal/1.0.0/profile.json`
- Current readiness-before-success pack:
  `profiles/proof.readiness.before-success/1.0.0/profile.json`
- Current failure-settlement-and-cleanup pack:
  `profiles/proof.failure.settlement-and-cleanup/1.0.0/profile.json`
- Current result-shape-conformance pack:
  `profiles/proof.result-shape.conformance/1.0.0/profile.json`
- Current lossless-projection pack:
  `profiles/proof.completeness.lossless-projection/1.0.0/profile.json`
- Current exact-ownership-isolation pack:
  `profiles/proof.ownership.exact-isolation/1.0.0/profile.json`
- Current cancellation-isolation pack:
  `profiles/proof.cancellation.isolation/1.0.0/profile.json`
- Frozen final v0.33 pack:
  `profiles/proof.idempotency.effect-nonduplication/1.9.0/profile.json`
- Frozen eighth pressure-test pack:
  `profiles/proof.idempotency.effect-nonduplication/1.8.0/profile.json`
- Frozen seventh pressure-test pack:
  `profiles/proof.idempotency.effect-nonduplication/1.7.0/profile.json`
- Frozen sixth pressure-test pack:
  `profiles/proof.idempotency.effect-nonduplication/1.6.0/profile.json`
- Frozen fifth pressure-test pack:
  `profiles/proof.idempotency.effect-nonduplication/1.5.0/profile.json`
- Frozen fourth pressure-test pack:
  `profiles/proof.idempotency.effect-nonduplication/1.4.0/profile.json`
- Frozen third pressure-test pack:
  `profiles/proof.idempotency.effect-nonduplication/1.3.0/profile.json`
- Frozen second pressure-test pack:
  `profiles/proof.idempotency.effect-nonduplication/1.2.0/profile.json`
- Frozen work record pressure-test pack:
  `profiles/proof.idempotency.effect-nonduplication/1.1.0/profile.json`
- Frozen first-evaluation pack:
  `profiles/proof.idempotency.effect-nonduplication/1.0.0/profile.json`

## Evaluation model

```text
native controlled contract
+ versioned verification profile
+ typed reference-role bindings
+ optional explicit claim-pattern bindings
+ supplied resolver facts or delivered evidence
                         |
                         v
bounded deterministic graph matching
                         |
                         v
satisfied | unsatisfied | indeterminate | invalid
```

The authoring agent binds abstract profile roles such as `operation`,
`second_invocation`, and `effect_after_second` to grounded references in the
concrete contract. The evaluator then matches controlled propositions, claim
kinds and modalities, verification methods and falsifiers, claim relations, and
closed or ordered collections.

A profile may also declare typed scalar placeholders such as
`expected_effect_cardinality`. Their values arrive through separate numeric
bindings. This lets one profile require a controlled numeric proposition without
hard-coding a domain value or asking the evaluator to infer one.

Automatic claim matching is allowed only when exactly one contract claim matches
a pattern. Zero matches are `unsatisfied`. Multiple matches are `indeterminate`
until the caller supplies an explicit claim-pattern binding. The evaluator never
chooses an arbitrary candidate.

Reference-binding patterns compare supplied role bindings without interpreting
their identities. `same_reference` and `distinct_references` distinguish literal
reuse from separately referenced inputs. On v0.2, `complete_population` instead
binds one exactly-one population role to the equality-normalized complete member
set declared by the contract. These checks do not establish honest grounding of
the supplied identities.

## Profile anatomy

A profile declares:

- `reference_roles`: typed placeholders, their cardinality, and optional
  `allowed_identity_kinds` constraints. Identity-kind constraints let a pack
  reject an abstract `profile_term` where its guarantee requires a repository
  path, code symbol, durable ID, or runtime parameter. They constrain the
  authored identity form; they do not prove that the referenced object exists;
- `number_roles`: optional caller-bound numeric placeholders, with optional
  integer and inclusive minimum/maximum constraints;
- `distinct_reference_role_sets`: groups of exactly-one roles whose bindings
  must resolve to different grounded references;
- `reference_binding_patterns`: same-reference or distinct-reference
  comparisons over two exactly-one roles, or a v0.2 complete-population binding
  from one exactly-one population role to one plural member role;
- `reference_role_count_bindings`: optional structural bindings requiring the
  number of references supplied for one required reference role to equal a
  required integer number-role value;
- `claim_patterns`: exact controlled proposition and claim shapes;
- `relation_patterns`: required directed relationships between matched claims;
- `collection_patterns`: exact closed populations or ordered proof sequences,
  optionally matched to a controlled collection purpose;
- `resolver_fact_patterns`: argument-bound facts supplied by an external
  resolver;
- `evidence_patterns`: post-delivery evidence bound to a matched verification;
  and
- `satisfaction_expression`: bounded `all_of` and `any_of` composition over the
  pattern IDs.

The expression language has no general negation or executable condition.
Prohibitions remain ordinary controlled propositions and modalities. Every
declared pattern must appear in the satisfaction expression, and every referenced
role, endpoint, member, and pattern ID must resolve within the profile.

### Complete populations and universal claims

The v0.2 role cardinalities include `zero_or_more` for a population that may be
closed and empty. Input arrays may therefore be structurally empty; the declared
role cardinality determines whether an empty binding is valid. Raw duplicate
reference IDs remain schema-invalid.

A `complete_population` reference-binding pattern has exactly two roles. The
first is an `exactly_one` `cc:population` or `cc:scope`; the second is
`one_or_more` or `zero_or_more`. It satisfies only when the supplied member role
equals the contract's complete equality-normalized membership. The evaluator
reports omitted members, unexpected members, and alias/duplicate collapse
deterministically.

A claim pattern may add:

```json
"for_each": {
  "population_role": "observables",
  "member_role": "observable"
}
```

The population role must be `one_or_more` and covered by exactly one
`complete_population` pattern. The member role is local to that claim pattern,
inherits the population role's allowed types, and must occur in its proposition
or falsifier template. Every population member must resolve to exactly one claim;
a missing member is unsatisfied and an ambiguous member is indeterminate.
Verification falsifiers are resolved separately for each member. Because an
iterated pattern is one aggregate result, explicit single-claim bindings,
relation endpoints, evidence targets, and collection membership cannot refer to
it.

## Stages and proof sources

`pre_dispatch` evaluates authored proof structure and any supplied resolver facts.
`post_delivery` can additionally require delivered evidence. A later-stage pattern
is inactive at an earlier stage rather than treated as missing.

Resolver facts and delivered evidence are explicit inputs. The free-tier evaluator
matches their type, key, bound arguments, verification identity, and asserted
result. It does not run a resolver, execute a test, trust an attestation, or grant
authority to the supplied fact. A missing required fact or evidence item is
`indeterminate`, never success.

## Result meanings

- `satisfied`: every active required branch has a deterministic match.
- `unsatisfied`: at least one required branch is deterministically absent or
  false.
- `indeterminate`: the result depends on a missing binding/fact/evidence item or
  an ambiguous claim match.
- `invalid`: the profile, evaluation input, reference binding, or controlled
  contract is structurally invalid.

An overall `indeterminate` result emits `profile_satisfaction_indeterminate`
with its unbound roles and directly or downstream blocked and ambiguous pattern
IDs. The diagnostic explains the fail-closed result; it does not convert an
unknown alternative into a deterministic failure.

All results declare `free_tier_local` and `authoritative: false`. Pack selection is
caller input. The evaluator does not determine which profiles apply to a contract.
An organization catalog, mandatory applicability, trusted resolvers, evidence
attestation, override handling, and authorization consequences belong to a later
policy tier.

`binding_analysis` distinguishes missing roots from their consequences. It
reports unbound reference and numeric roles, claim patterns directly blocked by
those bindings, and relation, collection, or evidence patterns that are only
blocked downstream. An optional role can leave one alternative branch
indeterminate while the overall bounded `any_of` expression is satisfied by a
different branch.

It also reports roles for which no currently declared reference is eligible and
the exact proposition or falsifier roles blocking each claim pattern.
`reference_binding_blockers` reports the missing roles for a same-reference or
distinct-reference comparison directly.
When a required role has no eligible declared reference, affected patterns are
deterministically `unsatisfied`; an unbound role with eligible candidates remains
`indeterminate`. `ambiguity_analysis` separately identifies directly ambiguous
claim matches and patterns blocked downstream by them.
`satisfaction_trace` mirrors the bounded expression and identifies which
alternative satisfied the profile without disguising inactive or indeterminate
sibling branches.

An `ordered_sequence` pattern selects `exact`, `subsequence`, or
`contiguous_subsequence` matching through `match_mode`. The default remains
`subsequence` for frozen profiles that predate the field. `closed_set` matching
remains exact. `candidate_quantifier: all_covering` requires every declared
collection of the selected kind containing the complete matched member
population to conform: ordered sequences must preserve the requested order and
closed sets must contain no additional member. When `collection_purpose` is
declared, only contract collections with that same purpose are candidates. On
the v0.34 path, every same-purpose collection of the selected kind is a
candidate, including a disjoint closed set or ordered sequence. This is
profile-scoped consistency. A covering collection excluded
only by purpose emits
`collection_covering_purpose_mismatch` without changing satisfaction, because
the local matcher can expose the relabeling but cannot determine its intent. An
overlapping collection that omits any expected member emits
`collection_noncovering_population_overlap` with its shared, missing, and extra
members. This advisory fact makes near-matches visible without inferring that
they serve the profile's purpose. A disjoint collection that nevertheless claims
the selected purpose emits `collection_disjoint_purpose_match` and prevents the
v0.34 pattern from satisfying. An all-covering
pattern with no candidate emits `collection_pattern_no_candidate`, whether or
not the pattern declares a purpose.
Frozen profiles keep the default existential `any` behavior.

`subsequence` deliberately permits harmless claims before, after, or between
the required ordered members. A same-purpose ordered-sequence superset therefore
matches when it preserves order. Exact membership is a separate `closed_set`
assertion; changing the ordered sequence to `exact` would restore the false
rejections that subsequence matching was introduced to remove.

Purpose-mismatch diagnostics are advisory and may accompany `satisfied`. The
free local CLI exits from satisfaction, not from diagnostic presence. A policy
consumer may escalate those diagnostics, but the matcher cannot mechanically
declare a differently purposed collection dishonest without rejecting legitimate
parallel collections.

## Local use

```sh
node packages/controlled-contract/bin/check-verification-profile.mjs \
  --contract contract.json \
  --profile packages/controlled-contract/profiles/PROFILE/VERSION/profile.json \
  --input evaluation-input.json
```

Use `--output result.json` to retain the complete result envelope. The outer CLI
envelope binds the raw contract, profile, evaluation input, guarantee, adequacy
declaration, and adequacy result by SHA-256, and marks the local pack admission
explicitly. The nested pure-evaluator result remains explicitly unadmitted. A
nonzero exit means the profile was not satisfied; it is not an authorization
refusal.

`bin/check-contract.mjs` also exposes this admitted path while retaining its
original structural checker as an explicitly unadmitted mode:

```sh
node packages/controlled-contract/bin/check-contract.mjs \
  --input contract.json \
  --pack packages/controlled-contract/profiles/PROFILE/VERSION \
  --evaluation-input evaluation-input.json
```

That combined envelope includes the structural report and binds the exact
contract, evaluation input, frozen pack snapshot, adequacy result, and profile
evaluation. Exit 0 is reserved for a structurally complete, satisfied admitted
evaluation; completed non-satisfaction exits 2, while stale or failed pack
admission exits 1 before profile evaluation.

For a v0.34 profile this command first loads the canonical `profile.json` and
sibling `adequacy.json` as one pack. Missing, stale, mismatched, or orphaned
adequacy, or a failed executable adequacy run, fails before evaluation. Run the independent executable release gate
with `bin/check-proof-pack.mjs --pack <pack-directory>`.
The CLI loads the pack exactly once into an immutable snapshot. Adequacy,
evaluation, and the admission envelope consume that same snapshot; no second
filesystem read can bind the gate to different pack contents.

## Pack authoring contract

A pack directory contains at minimum:

```text
profiles/PROFILE_ID/VERSION/
  profile.json
  adequacy.json
  README.md
```

The declared executable module must be a real path below
`packages/controlled-contract`. Parent-directory segments are refused, and
symlinks cannot move execution outside that tree. Its raw SHA-256 and the raw
SHA-256 of every declared pack-owned executable dependency are part of
`adequacy.json`. The loader captures those verified bytes, and the runner imports
an isolated module graph containing those captured bytes; it never imports the
declared executable or dependencies from their original paths after verification.
Tests remain ordinary tracked package tests; naming a test file in
`adequacy.json` is not an execution gate.

A pack is not generalized merely because its identifiers are abstract. Before it
is treated as reusable, freeze the profile and evaluate materially distinct
implementations; if the pack claims cross-domain generality, use unrelated
domain-shaped fixtures. Each evaluation includes:

- a minimal discriminating plan;
- a superficially relevant nondiscriminating plan;
- a missing stimulus or observation;
- the wrong ordering;
- an ambiguous duplicate match;
- a valid controlled alternative; and
- a missing or mistyped role binding.

Changes made after seeing fixture outcomes require a new profile version or an
explicit correction record. Pack tests must establish identifier and array-order
invariance and must demonstrate that the evaluator invokes no model or network
service.

## Current boundary

The SDK proves conformance to a selected proof profile. It does not prove that the
profile is semantically sufficient, that role bindings are honest, that delivered
code implements the behavior, or that a delivered test implements the matched
plan. Those are distinct profile-quality, policy, evidence, and review questions.

The carrier additionally diagnoses directly decidable proposition
contradictions: opposed mandatory modalities over one proposition, opposed
equals/member operators over the same operands, conflicting values for
single-valued state, status, resolution, order, equality, cardinality, or boolean
operators, and opposed mandatory boolean existence values in the same subject
and applicability context. Range constraints and multi-valued `has_value` or
`returns` claims are not functional. Behavior and evidence claims participate
together because claim kind does not change the truth value of an otherwise
identical controlled proposition. A verification falsifier is a failure
condition rather than an asserted world proposition and therefore does not
participate in direct contradiction analysis. The carrier does not infer
cross-operator interference or temporal interval overlap.

The v0.34 carrier derives the intrinsic `number:has_cardinality` numeric domain
from the vocabulary signature: its operand must be a nonnegative integer. It
also rejects an exact `number:has_cardinality` declaration
that is smaller than the distinct membership already declared through
`reference:contains` and `reference:member_of`. A scoped exact declaration uses
the same normalized applicability scope; an unconditional exact declaration
also includes scoped membership assertions. Mandatory `reference:equals`
classes are substituted before this count and before complement contradiction
checks.
It does not infer missing members when fewer members are declared than the exact
number. A proof pack that needs a complete caller-bound population combines its
membership proposition, exact cardinality proposition, and a
`reference_role_count_bindings` entry.

For v0.34 operators declared with `relation_set` multiplicity, a `MUST_NOT`
claim is pointwise over the normalized operands. A positive mandatory relation
to any same-scope member, including an equality alias, is a direct
contradiction. This prevents a multi-member prohibition from accepting a
truthful effect on only one protected member.
An unconditional mandatory `reference:equals` alias participates in substitution
in every applicability scope. A scoped equality remains confined to its exact
applicability context.

Temporal `reference:precedes` and `reference:follows` claims are normalized as
one inverse relation on the v0.34 path. A cycle formed by mandatory claims in
one applicability scope is a direct proposition contradiction. No temporal
edge is inferred across different applicability scopes.

Only a `MUST` verification claim discharges mandatory behavior coverage. A
`SHOULD`, `SHOULD_NOT`, `MAY`, or `MUST_NOT` verifier remains supplementary
traceability and does not invalidate an otherwise covered contract. Only an
unattached `MUST` verification is a missing proof obligation.

These carrier diagnostics and duplicate-collection-member validation apply to
every contract version evaluated by its selected carrier. They are global
fail-closed hardening, not profile fields that frozen profiles opt into. Profile
schema extensions such as numeric bounds, collection purpose, and
`all_covering` remain opt-in. A profile may also opt into
`verification_falsifier_policy: controlled_complement_per_target`. The semantic
validator then requires every profile-authored `verifies` target to have the
same subject and complementary operands as its verification falsifier. On the
v0.2 path, the complement is read from the intrinsic vocabulary and may be an
opposing operator or a declared operand transform such as boolean negation. A
term that explicitly has no controlled complement cannot support this policy.
When a target pattern permits only negative modalities (`MUST_NOT` or
`SHOULD_NOT`), the modality supplies the negation: its falsifier is the identical
positive proposition with the same operator, subject, operands, and bound
applicability condition. A target pattern mixing positive and negative modalities
is rejected because one falsifier cannot discriminate both meanings.
Every behavior pattern must have a profile-authored verification target and
every verification pattern must target a behavior. Frozen profiles without the
field retain their historical declared-edge semantics.

The current idempotency pack requires both the relative temporal order and an
exact closed proof population. The closed population is an explicit completeness
assertion; it is not evidence that the declaration is honest or that no runtime
action was omitted. Purpose-mismatch reporting covers collections containing the
complete proof population. On the v0.34 path, every same-purpose collection of
the selected kind is a competing candidate: a closed population must match
exactly and an ordered sequence must preserve the required order. Frozen v0.1
profiles retain their historical advisory behavior.

Version 2.0 rebuilds the proof as one equality-only sequential complete-state
observation obligation over an elected `cc:resource` that the operation writes. It uses
`reference:equals`/`reference:not_equals`; the weaker cardinality branch was
removed rather than retained as an alternative proof of the same property.
Each verification targets only the behavior its falsifier can negate, and each
verification relation binds the applicability condition expected on its
falsifier.
It compares state after the first invocation, immediately before the second,
and after the second. Intervening reset or mutation history is an explicit
exclusion until temporal action/state semantics or trusted runtime evidence can
establish it.
Until the vocabulary gains semantic inequality, the pack requires literal reuse
of one input reference rather than accepting an inadequately verified semantic-
equivalence claim. Profiles and result envelopes bind the vocabulary signature,
algebra, definitions, and complete digests. Falsifier templates are counterfactual by their verification
role; their `when` applicability names the condition under which the check must
fail rather than inventing a `counterfactual` applicability mode.

Every pack must also ship an executable adequacy declaration. The declaration
binds the guarantee digest, canonical profile digest, and executable module, and
the module independently binds the profile digest its controls cover,
then names required positive cases, mutants the pack must kill, profile
rejections, and explicit exclusions. The generic runner requires every named
control to report, and mutant controls must both fail the implementation oracle
and produce a non-satisfied profile evaluation from the observed contract.
Profile schema validity alone is not proof that the authored pattern list
establishes the property in the pack identity.

The executable controls need not independently discriminate every profile field.
The exact digest makes every other edit a trusted executable-release change that
must be reviewed together with its controls. For idempotency 2.0, fields guarded
only by that digest/review boundary include some role-distinctness sets,
same-reference binding, allowed subject types, ordered-sequence quantification,
falsifier-condition wiring, and collection membership. Editing the module's bound
digest is therefore an explicit trusted-code action, not evidence that those
fields gained behavioral coverage.

`reference:ordered_as` is a complete ordering assertion over its operand list;
two different asserted lists in one subject and scope conflict. Prefix order
constraints belong in `ordered_sequence` collections or dependency relations,
not this functional operator.

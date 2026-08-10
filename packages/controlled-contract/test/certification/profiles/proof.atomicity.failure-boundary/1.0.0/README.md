# Atomicity Failure-Boundary 1.0.0

Candidate experimental proof pack for
`proof.atomicity.failure-boundary@1.0.0`, composed against the working-tree
v0.34 vocabulary, the v0.2 contract and verification-profile schemas, and the
modality-aware negative-behavior falsifier semantics in
`experimental/verification-profile-v034.mjs`.

It is a deterministic, free-tier, non-authoritative check of a supplied proof
plan. It does not select itself, establish that any authored claim is true, or
authorize work.

## Behavioral property

When failure is injected at a declared boundary within a compound operation, the
complete constituent-effect population settles either fully committed or
entirely uncommitted, never partially committed.

## Local guarantee

When a declared failure is injected at a declared boundary positioned between
two distinct ordered constituent effects of one compound-operation attempt, the
declared constituent-effect population of at least two members, observed at the
declared settlement event that follows the injected failure, has a settled state
that is a member of a closed two-member population of allowed settled states
whose declared members are the fully-committed state and the fully-uncommitted
state, and the declared partial-commit state is not a member of that allowed
population.

`settled` always means the state held at the declared `settlement_event`, and
that event is required to follow the injected failure. Observations are taken
after settlement and record the settlement-time state, so a plan whose
observation records a different state than the one that settled does not match.

## Chosen formulation

The verified behavior is the positive form:

```text
settled_result MUST member_of allowed_settlement_states
  falsifier: settled_result not_member_of allowed_settlement_states
             when partial_commit_condition
```

The modality-aware negative form
(`settled_result MUST_NOT member_of forbidden_partial_states`) was authored as a
complete variant profile and evaluated against the same executed attempts. It is
three patterns and one role smaller, and it is strictly weaker for two reasons
that show up as executed false accepts:

1. Excluding an enumerated forbidden population says nothing about a settled
   state outside both populations. A run whose earlier effect settles neither
   durably committed nor absent (a torn write) is accepted by the negative form
   and rejected by the positive form.
2. The forbidden mixed population has `2^n - 2` members, so a fixed enumeration
   is only correct for exactly two constituent effects. A three-effect attempt
   whose third effect never commits is accepted by the negative form and
   rejected by the positive form.

The positive form pins the settled state into a closed two-member population
regardless of `n`, so it is the smaller discriminating and non-vacuous proof
even though it carries more patterns. A satisfying fixture binds
`settled_result` to the applicable allowed-state reference; it does not invent a
third distinct member of the exact two-member population.

The negative modality-aware form is still used where it is the stronger
statement: `partial-state-not-allowed` is an evidence claim with modality
`MUST_NOT` asserting that the declared partial-commit state is not a member of
the allowed population. Aliasing that state onto an allowed state produces a
carrier-level `opposed_modality` contradiction as well as a collapsed
distinct-role-set.

## Required proof

Exactly-one roles: `compound_operation`, `operation_attempt`,
`constituent_effect_population`, `earlier_constituent_effect`,
`later_constituent_effect`, `failure_boundary`, `injected_failure`,
`settlement_event`, `earlier_effect_settled_state`,
`later_effect_settled_state`, `settled_result`, `earlier_effect_observation`,
`later_effect_observation`, `allowed_settlement_states`,
`fully_committed_state`, `fully_uncommitted_state`, `forbidden_partial_state`,
`verification`, `partial_commit_condition`. One number role,
`constituent_effect_count`, is an integer with minimum 2.
The `constituent_effects` role is `one_or_more`; its supplied reference count
must equal `constituent_effect_count`.

The pack requires:

1. the attempt performs the compound operation, and the compound operation
   writes the complete caller-bound constituent-effect list;
2. the declared population contains that same list, both pinned boundary
   effects are members of it, its exact cardinality equals the bound list size,
   and its contract-intrinsic cardinality range has minimum two;
3. a controlled order between the two effects during the attempt;
4. a failure boundary that follows the earlier effect and precedes the later
   effect during the attempt, with the injected failure targeting that boundary;
5. a settlement event that follows both the injected failure and the later
   constituent effect;
6. per-effect settled states at the settlement event, a population settled state
   at the settlement event, and a composition claim relating them;
7. an observation per effect after settlement recording that effect's settled
   state, and a verification that reads every such observation after settlement;
8. a closed two-member allowed settled-state population whose declared members
   are the fully-committed and fully-uncommitted states, with the partial-commit
   state declared not to be a member, and with the partial-commit condition
   anchored to the partial-commit state;
9. identification of the settled result with one of the two allowed states
   (`any_of`), plus the verified membership behavior; and
10. a purpose-labelled ordered proof sequence and a purpose-labelled exact
    closed proof population over the fourteen spine claims.

Order is carried by two per-effect ordered chains under distinct purposes
(`profile_proof_sequence_earlier_effect`, `profile_proof_sequence_later_effect`),
not by one total order over the spine. Facts that hold at the same settlement
event — the two per-effect settled states, the population settled state, and the
composition claim — are deliberately not ordered against each other; only
genuinely ordered pairs are constrained. Both chains use subsequence matching, so
harmless unrelated claims may be interleaved. Exact membership belongs to the
separate closed population.

Collection concealment is only partly guarded. Every collection of the same kind
carrying the same purpose must agree, so a rival same-purpose collection is
caught. A rival collection of a different kind or purpose is reported as an
advisory diagnostic only (`collection_covering_purpose_mismatch`,
`collection_noncovering_population_overlap`) and does not change satisfaction:
the all-covering candidate filter in `verification-profile.mjs` excludes it from
candidacy precisely because it disagrees about purpose.

Each constituent effect needs its own `cc:state` reference for its settled state,
with its own identity, even when the two effects settle in the same value. A
shared reference collapses a distinct role set and two references sharing one
identity term trip the carrier's `duplicate_reference_identity` check.

## Plurality

The role-cardinality vocabulary has no term for a minimum above one, so
"at least two constituent effects" is enforced compositionally:

- two positional roles bound to distinct references (`distinct-constituent-effects`);
- `reference:precedes` between them, which is irreflexive in the carrier, so a
  collapsed pair makes the contract invalid;
- an integer number role with minimum two carrying the declared exact population
  cardinality;
- a reference-role count binding requiring the complete bound effect list to
  contain exactly that many references; and
- a contract-intrinsic `range:has_cardinality` with minimum two, which the
  carrier's `exact-cardinality-within-range` cross-operator constraint checks
  against the exact cardinality claim.

The two positional roles are the generic minimum-two model: they are the pair
the declared boundary separates, not two domain-specific effects. For `n > 2`
the population-level settled state carries the whole-population guarantee, and
the per-effect obligations are pinned only for the boundary pair.

## Executable adequacy

`adequacy.json` binds the guarantee, the canonical profile digest, and the raw
SHA-256 of the adequacy module, fixture, and harness. The module executes real compound
operations over three materially different stores: a ledger with balances and a
journal, a catalog with rows and an event log, and a platform with three
independent configuration resources. Every mutant executes; the observed
committed state is read back from the store and drives the truthful contract
that the profile then evaluates. There is no handwritten assertion that a
partial commit occurred.

The 46 required controls include profile-independent attacks for every
guarantee-critical population and ordering field, plus a same-scope temporal
cycle. Removing one of those fields from the profile cannot also remove its
attack construction from the executable gate.

Because the transient-state model is three-valued, an effect that settles
neither durably committed nor absent is classified as a settled state outside
both declared populations rather than as a mixed commit.

## Explicit exclusions

This pack does not establish:

- that any authored claim is true, including the settled-state classification;
- anything about transient partial internal state before settlement, which is
  deliberately outside the guarantee;
- concurrency, isolation, linearizability, or interference between attempts;
- durability, crash recovery, or state after the declared observation;
- preservation of resources outside the declared constituent-effect population;
- that an injected failure aborts the operation — completing every constituent
  effect and then reporting failure settles fully committed and is allowed;
- per-effect obligations for constituent effects beyond the pinned boundary
  pair when `n > 2`; or
- that the matched verification claim verifies only the required behavior;
- that the contract carries no claim contradicting the required ones — a
  contradicting sibling in a different applicability scope is invisible to the
  carrier;
- that a role names the real thing it is called — the evaluator reads a
  reference's `type_term` and never its `identity`, so role assignment is
  caller-supplied.

## Candidate-tree note

This candidate lives outside the repository, so the two experimental modules
import repository modules by absolute path. A pack adopted into the repository
would use relative imports like the idempotency pack.

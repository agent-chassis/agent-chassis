# Controlled Vocabulary v0.34 Foundation

> Experimental internal design. This is the proposition-vocabulary foundation
> for the controlled-contract prototype. It does not authorize CCE policy,
> dispatch, or proof-pack applicability.

## Decision

Vocabulary terms and their definitions are one versioned artifact. A consumer
cannot select a term list independently from its definitions or mechanical
semantics. The artifact may expose separate signature, algebra, and definition
digests for precise comparison, but those digests are projections of one
vocabulary version rather than independently selectable registries.

The canonical draft is
`packages/controlled-contract/vocabulary/cv.experimental.0.34.mjs`. Its scope is
the proposition lexicon:

- value kinds;
- reference type terms;
- applicability modes; and
- operators.

Carrier structure remains grammar-owned. Identity kinds, claim kinds,
modalities, verification methods, relation roles, collection kinds, and policy
terms are not silently pulled into the proposition vocabulary.

## Complete Means Explicit

Every active operator declares:

- its normative definition;
- subject and operand type constraints;
- operand value kind and cardinality;
- whether operand order and duplicates matter;
- whether one scope permits one value, several relations, a complete order, or
  conjunctive constraints;
- a controlled complement, an operand-level complement transform, or an
  explicit statement that the vocabulary provides no complement;
- a controlled inverse or an explicit statement that none is provided;
- algebraic traits together with whether each trait is mechanically enforced,
  declared for interpretation only, or not applicable; and
- the applicability modes it accepts.

Every operator also carries an explicit controlled-entailment declaration. The
artifact carries declared, mechanically enforced exact-number/range constraints
for value and cardinality operators. It also rejects an exact population
cardinality smaller than the distinct membership already declared through
`contains` and `member_of`. A scoped exact-cardinality declaration counts only
membership in the same normalized scope; an unconditional exact-cardinality
declaration counts membership asserted in every scope because its closure claim
applies without qualification. The carrier also substitutes mandatory
`reference:equals` equivalence classes before complement and population checks,
so an equality alias cannot conceal a contradiction. Other cross-operator
inference remains unsupported. That is a deliberate exact-matching foundation: `equals` does not
silently satisfy a `semantically_equivalent` pattern, and `deletes` does not
silently contradict `has_state`. Adding either inference requires a vocabulary
change rather than a private consumer rule.

Mechanical support is not inferred from the presence of a semantic field. The
artifact marks active support explicitly. Symmetry, irreflexivity, controlled
complements, normalization, multiplicity, applicability, and the declared
exact/range constraints are enforced. Equality transitivity participates in
contradiction detection. The `precedes`/`follows` inverse pair and transitivity
are also enforced, including cycle rejection within one normalized
applicability scope. Transitivity on other operators and their declared inverse
relationships remain `declared_only`; no result may represent them as an
executed check.

`MUST_NOT` over an operator whose declared multiplicity is `relation_set` is
mechanically pointwise over its normalized operand members. A same-subject,
same-scope positive mandatory relation to any equal or equality-aliased member
contradicts the prohibition; it need not repeat the complete prohibited operand
set. Prohibiting writes to `[A, B]` therefore rejects a truthful positive write
to `A`, not only a write to both.
An unconditional mandatory equality participates in substitution in every
applicability scope. A scoped equality remains confined to its exact scope.

`cc:population` identifies a closed extensional population. Closure requires
one exact integer `number:has_cardinality` value and the same number of distinct,
equality-normalized members declared by positive mandatory
`reference:contains` or `reference:member_of` claims in the applicable scope.
Unconditional membership and equality facts participate in every scope; facts
from another scoped applicability do not. Empty populations are closed when
their exact cardinality is zero.

The integer and nonnegative domain of `number:has_cardinality` is part of that
operator's intrinsic signature and is projected into the native carrier schema.
Fractional or negative cardinality operands are schema-invalid; a proof pack
does not need to restate that foundational constraint through a number role.

`reference:subset_of` and `reference:not_subset_of` compare two closed
populations or scopes. They are controlled complements with exactly one operand:
`subset_of(A, B)` holds when every normalized member of `A` belongs to `B`, and
`not_subset_of(A, B)` holds when at least one member of `A` is absent from `B`.
The former is reflexive and transitive; the latter is irreflexive and
non-transitive. Missing closure, contradictory cardinality, false mandatory
relations, and incomplete membership are deterministic carrier diagnostics.

Absence is never interpreted as `none`. A term with a missing definition or
mechanical field makes the vocabulary invalid.

`unrestricted` is a deliberate signature, not missing type information. It
means any type term in this exact vocabulary version is accepted. Narrowing a
signature later is an algebra/signature change and therefore changes the
corresponding digest.

## Derived Consumers

Schema enums, proposition branches, complement lookup, functional-operator
sets, and operand-normalization rules are projections of the artifact. They are
not maintained as independent lists. The v0.33 compiler and proof-pack runtime
remain the compatibility path for frozen contracts and packs; copying v0.34
terms into those files would recreate the drift this version is intended to
remove.

The parallel v0.34 carrier is
`experimental/native-contract-carrier-v034.mjs`; its tracked schema is
`schema/controlled-acceptance-contract.experimental.v0.2.schema.json`. The
carrier composes the existing structural grammar with vocabulary-derived type,
operator, applicability, operand-cardinality, complement, normalization,
multiplicity, supported algebraic traits, and cross-operator-constraint
projections. The existing v0.33 carrier remains
the compatibility path for frozen proof-pack versions.

The parallel v0.34 proof-profile evaluator is
`experimental/verification-profile-v034.mjs`. Its v0.2 profile, input, and
result schemas are derived alongside the contract schema. Profiles bind the
vocabulary signature, algebra, definitions, and complete digests, and v0.2
result envelopes repeat those bindings. The first rebuilt pack is
`proof.idempotency.effect-nonduplication@2.0.0`; versions 1.0 through 1.9 remain
byte-frozen on the v0.33 path.

The v0.2 profile path also derives complete-population binding and universal
claim matching. `complete_population` binds one exactly-one population role to
one `one_or_more` or `zero_or_more` member role and rejects omissions, decoys,
duplicates, and equality aliases. A claim pattern's `for_each` member creates a
fresh local member role and requires exactly one matching claim for every bound
population member. Iterated patterns are aggregate results and cannot be used as
single claim endpoints or collection members.

## Agent Context

Agents do not need the complete vocabulary for every contract. Exact queries
and advisory authoring views may return only the relevant definitions. Every
reduced view:

- is marked non-authoritative;
- binds the parent vocabulary version and digests;
- reports explicit omission counts; and
- distinguishes active terms, intentionally withheld terms with reasons, and
  requested terms that were not found.

Validation always uses the complete artifact. A reduced view can help an agent
author a contract; it cannot narrow what the validator accepts or what the
mechanical checker enforces.

The internal query transport is `bin/query-vocabulary.mjs`. It supports exact
term lookup, definition search, and explicit advisory views. It is intentionally
read-only and labels every result non-authoritative; production tool discovery
and CCE transport remain outside this prototype.

## Withheld Applicability Terms

v0.33 consumers disagree about `role_route` and `counterfactual`. v0.34 does not
resolve that drift by taking the union.

- `role_route` is withheld because no normative or mechanical applicability
  meaning exists. Routing remains an explicit graph relation.
- `counterfactual` is withheld from applicability because it describes the
  role of a verification falsifier or scenario, not the scope in which an
  asserted proposition holds.

Both decisions are recorded in the artifact so their absence is reviewable.

## Proof-pack boundary

v0.34 defines the semantic material a proof pack may use. It does not define
proof-pack applicability, evidence authority, organization policy, or the
meaning of `satisfied` at CCE policy level. The rebuilt idempotency pack consumes
declared complements, applicability, and normalization rules rather than
inventing private semantics.

The foundation cannot prove that a hand-authored pattern list entails the
property named by a pack. Each proof pack therefore carries an executable
adequacy contract: positive implementations, inadequate mutants, profile
rejections, explicit exclusions, and expected outcomes. Its guarantee digest,
canonical profile digest, and executable module are mandatory pack members. The
module independently reports the profile digest its controls were written for;
echoing the caller-supplied digest is not a binding. The generic runner rejects
missing controls, stale executable/profile bindings, and mutants whose observed
behavior still produces a satisfied profile evaluation. Structural profile
validation and executable adequacy are separate release gates.

# Refusal before protected effects 1.0.0

`proof.authorization.refusal-before-effects@1.0.0` is a v0.34
controlled-contract proof pack for one declared unauthorized operation attempt,
one exact refusal, and one complete caller-declared protected-effect population.

## Exact local guarantee

Given one declared operation attempt, one declared refusal event, one declared
authority, one declared unauthorized subject, one declared reusable operation,
and one complete caller-supplied protected-effect list bound to an exact declared
cardinality, this pack establishes only in the declared controlled graph that:
the attempt performs the operation and uses the subject; the authority does not
authorize that subject for the operation; the refusal rejects that exact attempt;
the attempt precedes a protected-interval witness which precedes the refusal;
before that refusal the same attempt neither writes nor mutates any listed
protected effect; and the verification reads the exact attempt, refusal,
operation, and every listed protected effect, with a positive same-attempt,
same-population, same-refusal pre-refusal write or mutation as the corresponding
falsifier.

The graph is local and declared-world only. It does not establish production-path
discovery, truthful grounding, evidence authority, pack applicability, CCE
consequences, or completeness beyond the caller-declared protected-effect
population.

## Controlled graph

The reusable operation and its attempt occurrence are distinct references. The
attempt performs the operation, uses the subject, and is the subject of both
effect prohibitions. The authority's `MUST_NOT reference:authorizes` evidence is
scoped `where` the reusable operation. The refusal event rejects the attempt.

Two mandatory `reference:precedes` propositions state only
`attempt -> protected_interval -> refusal`. No ordered-sequence collection
orders the observation claims. The carrier therefore rejects a same-scope cycle
while leaving otherwise simultaneous evidence unordered.

The protected-effect scope `reference:contains` every reference supplied for the
`protected_effects` role and has the caller-bound exact
`protected_effect_count`. `reference_role_count_bindings` makes the numeric value
equal the complete role-binding list length. An exact, all-covering closed set
contains the attempt/refusal observation spine.

The two behavior claims are `MUST_NOT reference:writes` and
`MUST_NOT reference:mutates` by the attempt before the refusal. Each has its own
`MUST` verification, `verifies` edge, and identical positive proposition as its
negative-modality falsifier. The separate observation claim requires the
verification to read the exact attempt, refusal, reusable operation, and every
protected effect.

## Executable adequacy

`adequacy.json` binds the profile, this guarantee, the executable adequacy
module, and both pack-owned executable dependencies by SHA-256. The executable
controls include three unrelated positive domains, every allowed verification
method, legitimate extra evidence and effects outside the protected population,
four implementation mutants, thirty-five independently authored plan attacks, and
six explicit boundary demonstrations.

The negative plans are constructed from a fixed pack blueprint rather than from
the profile pattern list being tested. Deleting a guarantee-critical profile
field therefore does not delete its attack construction. Repository tests also
exercise fully re-digested semantic weakenings.

Run the release gate with:

```sh
node packages/controlled-contract/bin/check-proof-pack.mjs \
  --pack packages/controlled-contract/profiles/proof.authorization.refusal-before-effects/1.0.0
```

The result is a local non-authoritative adequacy fact. It is not delivered
evidence, authorization, policy, or a CCE judgment.

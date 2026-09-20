# Idempotency Effect-Nonduplication 2.0.0

This experimental pack checks one precise guarantee: two completed sequential
invocations using the same input leave one elected durable effect resource
observed in the same complete controlled state after the first invocation,
immediately before the second invocation, and after the second invocation. It is a
deterministic, free-tier, non-authoritative check of a supplied proof plan. It
does not select itself, establish honest grounding, or authorize work.

## Foundation binding

The profile binds the exact v0.34 vocabulary version and its signature,
algebra, definitions, and complete-artifact digests, plus the v0.2 contract
schema. Validation always uses the complete vocabulary artifact; an advisory
vocabulary view cannot narrow the terms or semantics accepted by this pack.

Version 2.0 starts a new pack line. Versions 1.0 through 1.9 remain byte-frozen
on the v0.33 carrier and profile schema.

## Required proof

The pack requires:

1. one operation and two distinct sequential invocation occurrences;
2. literal reuse of one input reference;
3. an elected `cc:resource` that the operation declares it writes;
4. distinct observation records of that resource's complete controlled state
   after the first invocation, immediately before replay, and after replay;
5. exact equality between the first and immediately pre-replay states;
6. exact equality between the first and final states;
7. a discriminating inequality falsifier for both comparisons;
8. a purpose-labelled ordered proof sequence; and
9. a purpose-labelled exact closed proof population.

The ordered sequence uses subsequence matching intentionally: additional harmless
claims may appear around or between the required observations as long as their
relative order is preserved. Exact membership belongs to the separate closed
proof population. A differently purposed covering collection is reported as an
advisory diagnostic rather than treated as proof of dishonest relabeling.

The falsifier's counterfactual meaning comes from its role on a verification
claim. `counterfactual` is not an applicability mode. Each verification-target
relation separately binds the condition under which its falsifier applies, so
swapping the reset and duplicate-effect conditions makes the profile invalid.
Those two condition roles must also bind distinct references.

There is no cardinality alternative in this pack. Final-count stability is a
different and weaker guarantee: deletion and replacement can preserve a count,
and a caller-selected final count says nothing about the count after the first
invocation. A future cardinality pack must carry its own name, adequacy contract,
and executable controls rather than acting as an escape branch here.

## Executable adequacy contract

`adequacy.json` binds this guarantee and the canonical digest of `profile.json`
to a standardized executable module, and binds the raw bytes of that module and
its pack-owned fixture dependency by SHA-256. The runner executes captured copies
of those verified bytes rather than importing their original filesystem paths.
The module independently reports the exact profile digest its controls cover
rather than echoing its caller. The generic pack loader refuses missing, stale,
identity-mismatched, or orphaned declarations.
The generic adequacy runner requires one machine-readable result for every
positive, mutant, profile-rejection, and exclusion control.

The executable controls apply one domain-neutral proof shape to payment, queue,
and database storage architectures. Each required mutant is executed and then
represented by a truthful contract whose observed state comparison is evaluated
by the profile. One mutant changes the elected resource between the first and
pre-second observations, then restores it during replay, so the middle observation
is independently exercised. The gate fails when any guarantee-critical profile
edit is re-digested without updating the trusted executable controls. Response
equality remains an explicit, structurally valid negative control: response
equality alone does not satisfy durable-effect equality.

The controls directly discriminate the two state-equality obligations, their
applicability, the closed-population quantifier, response-only proof, and the
current runtime mutants. Other profile surfaces—including some role-distinctness
sets, literal-input binding, allowed subject types, ordered-sequence
quantification, falsifier-condition wiring, and collection membership—are bound
by the independently authored profile digest and mandatory trusted-code review,
not by a separate behavioral control. Updating that digest is an explicit
release-code change.

Run the generic release gate with:

```sh
node packages/controlled-contract/bin/check-proof-pack.mjs \
  --pack packages/controlled-contract/profiles/proof.idempotency.effect-nonduplication/2.0.0
```

Adding a pattern is not sufficient evidence that the pack proves its name. Any
future semantic change must update the frozen positive cases, required mutant
kills, profile rejections, explicit exclusions, and cross-storage profile
fixtures.

## Explicit exclusions

This pack does not establish:

- concurrent replay safety;
- recovery after a partial commit;
- idempotency-key scope across principals or operation classes;
- preservation of resources outside the elected effect resource;
- intervening reset or mutation history between the three observation points;
- absence of undeclared runtime actions; or
- honest correspondence between a declared identity and a real object.

Those require separate proof obligations and, for runtime behavior or complete
affected-resource populations, delivered evidence or authoritative resolver
facts. A local `satisfied` result means only that the declared graph matches this
sequential complete-state proof shape.

# Exact ownership isolation proof pack 1.0.0

`proof.ownership.exact-isolation@1.0.0` is the v0.34 composite profile for
refusing a distinct foreign subject before effects on one exact owned resource,
without consuming the legitimate owner's authority, followed by a successful
valid use.

## Exact local guarantee

Given one grounded owned resource, legitimate owner, distinct foreign subject,
legitimate authority, reusable operation, refused foreign attempt, protected
interval, complete authority-state observations before the foreign attempt and
after refusal, and a distinct later valid attempt and expected successful
result, satisfaction establishes only in the declared controlled graph that:

1. the resource is assigned to the legitimate owner;
2. the authority authorizes that owner but not the foreign subject for the
   operation;
3. the foreign attempt targets the exact resource and is refused;
4. the foreign attempt neither writes nor mutates that resource before refusal;
5. the legitimate authority state after refusal equals its state before the
   foreign attempt; and
6. the later attempt uses the same authority, owner, operation, and resource and
   reaches the expected result state.

Four separate verification claims prove the two pre-refusal effect
prohibitions, authority-state preservation, and later success. Each has its own
grounded verifier and abstract controlled falsifier condition.

## Explicit exclusions

- concurrent access, interference, isolation levels, or linearizability;
- discovery or completeness of owners, resources, or authorization policy;
- truthfulness of caller-supplied identities and observations beyond local
  grounding and distinctness checks;
- resources or effects outside the exact elected owned resource;
- external authorization, tenancy, or identity-provider policy;
- authenticity or mutation sensitivity of delivered evidence; and
- proof-pack applicability or external policy consequences.

## Controlled proof shape

The profile directly composes the refusal-before-effects and failed-attempt
nonconsumption proof shapes; it does not depend on either profile at runtime.
It uses 26 exactly-one reference roles, 35 claim patterns, four verifies
relations, and two all-covering collections. The 21 operative owner, authority,
resource, attempt, observation, result, and verifier roles require repository-
path, code-symbol, durable-id, or runtime-parameter identities. Only the success
criterion and four falsifier conditions accept profile-term identities.

Distinct-role sets prevent owner aliasing, attempt/result collapse, shared state
or observations, shared verifiers, shared failure conditions, and collapse of
the operation, resource, and authority. Both the foreign and later valid
attempts target the same grounded resource reference.

## Executable adequacy

The release gate contains 38 controls: 10 positives across tenant document,
cloud bucket, and payment account domains; six executed mutants; 15 profile
rejections; and seven boundary demonstrations. Mutants cover cross-owner
acceptance, owner aliasing, wrong-resource targeting, refusal after effects,
legitimate-authority consumption, and failed later valid use.

Seven fixed negative-fixture wrappers carry 158 claim-semantic and 52 role
variations plus aggregate relation, collection, binding, and satisfaction
attacks. The adequacy declaration classifies 228 critical and 165 mechanically
noncritical surfaces. Indexed admission and exhaustive `full_census` mode both
evaluate the complete fixed corpus.

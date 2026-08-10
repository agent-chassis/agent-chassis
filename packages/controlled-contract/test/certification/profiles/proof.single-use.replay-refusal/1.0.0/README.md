# Single-use replay-refusal proof pack 1.0.0

`proof.single-use.replay-refusal@1.0.0` is the v0.34 behavioral profile for
one successful use of a declared single-use authority followed by one refused
replay of the same operation, authority, and input.

## Exact local guarantee

Given one declared single-use authority and authorized input, two distinct
ordered attempts of the same operation using that authority and input, one
closed one-member effect-occurrence population, one elected durable effect
resource with complete observations before first use, after first success, and
after replay refusal, and one expected success state, satisfaction establishes
only in the declared controlled graph that:

1. the first attempt is accepted, reaches the expected state, creates the sole
   declared effect occurrence, and changes the elected resource state;
2. after that success the authority no longer authorizes the input;
3. the replay follows the success and uses the same operation, authority, and
   input;
4. the replay is rejected and is not accepted;
5. the replay creates no member of the declared effect population; and
6. the elected resource state after replay refusal equals its state after the
   first success.

Separate verification claims read the exact result, event, and state
observations and carry controlled falsifiers for first-use failure, absent first
effect, authority survival, replay acceptance, replay creation, and post-replay
state inequality. The proof spine is both an all-covering ordered sequence and
an exact all-covering closed population.

This is an observation-bounded guarantee for one declared replay. It is not a
trajectory-wide or distributed exactly-once claim.

## Explicit exclusions

- transient duplicate effects or mutations restored before the post-replay
  observation;
- additional replay attempts beyond the one declared replay;
- concurrency, interference, linearizability, crash windows, or distributed
  exactly-once delivery;
- effects outside the elected closed effect population or durable resource;
- purely transient effects with no complete durable state observation;
- truthful identity grounding and real-world completeness beyond the identity-
  kind and declared-population constraints enforced locally;
- refusal-before-effects, settlement, cleanup, or failure-boundary atomicity;
- execution, authenticity, or mutation sensitivity of delivered evidence; and
- proof-pack applicability or policy consequences.

## Controlled proof shape

The profile uses 30 exactly-one reference roles, one integer binding fixed to
one effect occurrence, 42 claim patterns, six verifies relations, and two
all-covering collections. Operational roles require repository, code-symbol,
durable-id, or runtime-parameter identities; profile terms remain available only
for the abstract success criterion and falsifier conditions.

Positive refusal evidence uses `reference:rejects`. The verified replay property
is separately stated as `MUST_NOT reference:accepts`, allowing its falsifier to
use the mechanically controlled positive form without pretending that
`accepts` and `rejects` are exhaustive vocabulary complements.

## Executable adequacy

The release gate contains 40 executable controls: 10 positives, five mutation
kills, 15 profile rejections, and 10 explicit boundary demonstrations. They
span password-reset, queue-permit, and voucher-claim implementations and all
five controlled verification methods. The mutants cover first-use refusal,
accepted-without-effect, unconsumed authority, accepted replay, and a duplicate
effect despite replay refusal.

Eight fixed negative-fixture wrappers carry 250 independently evaluated claim-
semantic and reference-role variations plus aggregate relation, collection,
binding, and satisfaction weakenings. The adequacy manifest classifies 269
guarantee-critical surfaces and gives 204 remaining surfaces mechanically
checked noncritical reasons. Both indexed admission and the exhaustive
`full_census` release mode reject the complete fixed corpus.

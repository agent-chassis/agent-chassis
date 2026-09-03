# Cancellation isolation proof pack 1.0.0

`proof.cancellation.isolation@1.0.0` is the v0.34 profile for proving that
cancelling one generation does not consume the selected state or authority of a
distinct in-flight generation, which later succeeds.

## Exact local guarantee

Given two distinct grounded generations, two distinct grounded attempts, one
grounded operation and a distinct grounded cancellation operation, satisfaction
establishes only in the declared controlled graph that:

1. both attempts perform the same operation against their respective distinct
   generations and exist before the cancellation request;
2. the request performs the cancellation operation, targets only the elected
   cancelled generation, and precedes an accepting cancellation result;
3. after the cancellation result, the exact cancelled generation has an observed
   complete state equal to a separately declared cancelled state conforming to
   the cancellation criterion, and the cancellation observation records it;
4. the surviving generation uses the same selected protected resource before the
   request and after its result, and that resource has equal complete states at
   those two observation points;
5. the selected authority authorizes the surviving generation before the request
   and after the cancellation result, and that result does not invalidate it;
6. after the cancellation result, the surviving result accepts the exact
   surviving attempt and carries a complete state equal to a separately declared
   expected state conforming to the success criterion; and
7. four distinct verification claims read their exact proof subjects, verify the
   cancellation, state-isolation, authority-isolation, and later-success
   behaviors, and carry separately targeted controlled falsifiers.

The operation, cancellation operation, both generations, both attempts, selected
resource, and selected authority must use repository-path, code-symbol,
durable-domain, or runtime-parameter identities. Abstract `profile_term`
identities cannot ground those roles.

## Explicit exclusions

- arbitrary concurrent schedules, overlapping execution internals, race freedom,
  serializability, or linearizability;
- interference that occurs and is completely restored between the elected
  before/after state observations;
- cancellation propagation to generations other than the two elected roles;
- state outside the selected protected resource or authority outside the selected
  surviving authority;
- results, retries, or authority use after the elected later successful result;
- existence or truthfulness of a syntactically eligible repository, symbol,
  durable-domain, or runtime-parameter identity;
- delivered-evidence authenticity or execution-environment integrity; and
- proof-pack applicability or external policy consequences.

The two attempts are explicitly ordered before the cancellation request and the
surviving result after the cancellation result. This establishes the declared
overlap-shaped lifecycle, not a general concurrency model. A caller that needs a
linearizability claim must use a separate profile with a schedule population,
linearization points, and schedule-complete falsification.

## Controlled proof shape

The profile uses 31 exactly-one roles and 39 claim patterns. Four verification
relations and four distinct condition roles prevent a cancellation failure from
standing in for state interference, authority interference, or later-result
failure. State and result behaviors use `reference:equals` with
`reference:not_equals` falsifiers. Authority isolation uses negative modality
over `reference:invalidates`, with the corresponding positive proposition as its
falsifier.

One exact all-covering closed proof population prevents a competing thin
same-purpose population from concealing omitted lifecycle, observation, or
verification claims. A plan that reports only a successful status is structurally
valid but unsatisfied: it contains neither distinct generations nor an observed
cancellation, preservation boundary, or later successful result.

## Executable adequacy

The adequacy harness executes search-session, media-transcode, and deployment-
rollout implementations. Positive controls cover every accepted verification
method, alternate admitted role types, and every admitted grounding kind.
Executed mutants cover status-only success, cancellation of the surviving
generation, a cancelled generation that continues, cross-generation state
corruption, cross-generation authority revocation, a later failure, and a missing
later result. Required rejection controls also cover a target generation that is
still running after the cancellation result, a survivor bound to a different
resource, and authority that no longer authorizes the survivor after cancellation.

The digest-bound fixed negative corpus classifies every profile surface and
rejects each guarantee-critical weakening, including broadened role types or
identities, collapsed generations or attempts, altered temporal subjects,
misdirected verification relations or falsifiers, competing proof populations,
and broadened satisfaction.

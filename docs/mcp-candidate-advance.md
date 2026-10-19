# Selected candidate advancement

`workspace_advance_candidate` advances one explicitly selected stale candidate
to the current accumulated WK state. Its request is exactly `{subject, version}`:
a root `WK-####` and the immutable lowercase 64-hex version supplied by candidate
inspection. The repository is server-bound. A held exact call may be used
directly when advancement is already authorized; inspection is not a mandatory
preliminary step.

The selected-version owner authenticates the requested version under the existing
WK exclusion. It must match the selected candidate. The existing fixed-base,
generation, input-freeze, final-recheck and atomic selection/version publication
owners remain authoritative. They do not substitute a candidate, repair an
input, retry, or roll back. Advancement performs no implementation, integration,
test/proof execution, review dispatch, external publication, landing or completion.
Availability and the absence of an advance gate grant no authority. Direct-to-main
review does not use candidate advancement.

## Agent response

The serving response projects the complete internal task result. Success contains
`ok`, `outcome`, `subject` and `next_calls`. The internal result's schema marker
is not agent task information. `advanced` means this
request's advancement was acknowledged. `converged` means the complete intended
result was observed after an unacknowledged transaction; it also reports
`write_attribution: "not_established"` and does not attribute the write to this
request.

An advance-only task can finish on either success. If the actual serving contract
registers inspection, the response offers one optional
`workspace_inspect_candidate({subject, version})` call bound to the confirmed new
version. Use it only for an intended exact-version question. It establishes
historical version facts, not currentness, review approval or publication
authority. No current-inspection step is required after success. When inspection
is unavailable, success has an empty call list without an unrelated capability
warning.

Full candidate tuples, internal refs, generation identities, digests, derivation
mechanics and successful validation/gate inventories remain internal. They are
not moved behind an original-result reader. Necessary version identities are
bound into the offered calls. The complete internal task result and existing
diagnostic retention remain with their owners.

## Failure and caller choice

A failure preserves `selection.version`, its specific code and diagnosis,
established effects, cause-specific recovery or stopping condition, and supported
calls. A selection disagreement identifies the requested and observed versions.
Current inspection is informational: it neither repairs the condition nor
authorizes advancement of a replacement selection. Choosing another candidate
requires a new explicit decision. A historical read never reselects that version.

An early exclusion remains a refusal, with unchanged gates and effects. Its
observation distinguishes a healthy current candidate, no candidate, and an
invalid observation with its actual cause. The requested version is marked
`authentication: "unverified"`; the exclusion occurs before its authentication.
A healthy current observation does not establish that the requested version is
current or that the request succeeded. An absent candidate needs candidate-only
preparation, for which this tool supplies no route. An invalid observation needs
its diagnosed owner correction. Neither is successful no-op confirmation.

Effects distinguish unchanged selection/version state from uncertain or unknown
state. Preparation may leave objects without a confirmed advancement; their
internal identities are not a usable selected candidate. An immutable version
without matching current selection is not convergence. Failed reobservation
preserves uncertainty and the failed write's cause. No outcome permits an
unchanged automatic retry. Movement during generation checks is a movement
condition; an invalid generation still requires its owner's correction.

Optional inspection and guidance calls use the serving registrar's retained
request contracts, validated by the canonical continuation/refusal constructors.
No missing registration is replaced with an advertised-only or inferred route.
Strict serving input failures retain validator diagnostics. A slice address
with an already selected valid version offers the exact parent-WK advance call
with that version unchanged; choosing the call is a separate explicit action.
A clean request that omits the version may offer current inspection to acquire
one. A supplied malformed version or unsupported fields requires correction of
the authored request, without current-selection substitution or capability
guidance. No corrected mutation executes as part of validation. Missing backend
or generation capabilities identify their cause and stopping boundary; ordinary
responses do not prescribe launcher or server-configuration workflows.

Oversized task-relevant diagnoses use the existing selected-response transport
to deliver the complete semantic answer in one response. The retained carrier
contains only this tool's public meaning. It does not use inspection's status
projection, disclose raw logs, or require an original reread, filesystem rescue,
byte assembly or integrity work.

Publication is a separate task. Its subject-only request does not pin an earlier
advanced version. A dependent review/publication task must satisfy its own
identity and lifecycle contract; another inspection does not make publication
atomic or waive review.

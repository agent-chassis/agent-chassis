
# MCP dispatch runtime contract

`workspace_agent_dispatch` and its monitor routes are backed by one
launcher-owned in-process runtime. The runtime freezes the selected family,
role, work record or slice, managed worktree binding, read and write authority,
model registration adapter, host wiki-MCP server, named-FIFO conduit, and
lifecycle owner before spawning the role.

Reviewer and redteam roles are selected before the implementation lifecycle and
share one action-local advisory-review execution pipeline. WK, slice, current
canonical design, immutable implementation delivery, explicit SHA pair, and
terminal candidate inputs only select material for that pipeline. They do not
select execution owners or confer authority. Review output is influential
advisory evidence only; no legacy review receipt, recovery, replay, replacement,
or continuation path exists.

## Launcher-transition failure contract

Every `launcher-transition-plan.v1` has exactly the role/runtime, lifecycle,
dependency, publication, CCE, reservation, spawn, and failure axes documented in
[MCP dispatch launch and admission](mcp-dispatch-launch-and-admission.md#unified-launcher-transition-plan).
Its `failure` is null or one tuple from this closed population:

| Stable code | decision limb | Executable next action |
| --- | --- | --- |
| `launcher_transition.prospective_lifecycle_unavailable.v1` | `mechanical_failure` | Retry `workspace_agent_dispatch` after lifecycle preflight succeeds. |
| `launcher_transition.lifecycle_allocation_failed.v1` | `mechanical_failure` | Complete launcher allocation recovery, then retry `workspace_agent_dispatch`. |
| `launcher_transition.dependency_identity_unresolved.v1` | `mechanical_failure` | Publish or integrate the exact dependency, then retry `workspace_agent_dispatch`. |
| `launcher_transition.publication_identity_unresolved.v1` | `mechanical_failure` | Obtain the carrier returned by work record's landed-publication observer, then retry `workspace_agent_dispatch`. |
| `launcher_transition.cce_policy_refused.v1` | `exact_returned_policy` | Perform the exact recovery returned by CCE, then retry `workspace_agent_dispatch`. |
| `launcher_transition.findings_route_authentication_failed.v1` | `mechanical_failure` | Dispatch the exact canonical findings unit through `workspace_agent_dispatch`. |
| `launcher_transition.runtime_backend_unavailable.v1` | `mechanical_failure` | Restore the registered launcher backend, then retry `workspace_agent_dispatch`. |

The tuple always carries one stable code, its exact decision authority limb, and
that executable action. `managed_lifecycle_required` cannot replace a more
specific transition failure. Review findings, status, prose, messages, and local
inference are not refusal limbs. CCE decisions are forwarded exactly and are
never locally synthesized; all other entries above are mechanical facts.

### Mechanical failure versus exact returned policy (work record)

The same two-limb split governs every dispatch-admission refusal, not only the
launcher transition. The registered `workspace_agent_dispatch` route publishes
the limb it resolved on the refusal envelope as `authority_limb`, and the limb
determines what else the envelope may contain.

**Exact returned policy.** An authenticated CCE `needs_review` or `reject`
refuses under `launcher_transition.cce_policy_refused.v1` and carries a
`policy_result` block holding the authority's own output verbatim: the effect,
the outbound verdict, complete reason facts, optional returned remediation,
`response_provenance` containing exactly `schema_version`, `pack`, and
`operation`, the ratification state, and the digest and authority-binding
evidence that authenticated it. The route generates no repository blocker code
for that decision, computes no threshold conclusion, and substitutes no split,
review, or escalation recipe. When the authority returned no recovery, the
`remediation` member is absent — none is invented in its place.

An authenticated decision requires the FULL authentication contract: genuine
Node Engine backing, a real pack envelope, a ratified authority binding carrying
the stable ratified marker, present operator authority-binding evidence, present
request-contract digest evidence, the client-owned exact-payload authentication,
and a recognised effect that agrees with the interpreted status. A pack-SHAPED
`needs_review` or `reject` that fails any limb
is an unauthenticated envelope, never a returned denial, and fails on the
applicable mechanical limb instead.

**Mechanical failure.** Everything else. Public code selection is owned by one
shared classifier,
`packages/wiki-mcp/src/lib/dispatch-tools/runtime-blocker-classifier.mjs`, which
turns explicit typed producer facts into a registered actor-correct code plus a
bounded cause and detail. It is structurally incapable of expressing a policy
result: it has no admit/needs_review/reject vocabulary, no threshold arithmetic,
and no `worker_admission_review_threshold_exceeded` identity, and it refuses a
policy-result-shaped input rather than reclassifying one. It also refuses
incomplete, contradictory, unlisted, or unbounded input — it never falls back to
a default code.

Producers keep their own fact detection and dynamic detail; they do not repeat
the state table. The full producer-to-code table lives in
[Tool Discovery Dispatch Runtime Contract](tool-discovery-dispatch-runtime.md#producer-to-code-state-table).

**No-decision states stay distinguishable.** A missing launcher declaration is
`launcher_declaration_missing`; a configured but unreachable CCE or absent
response is `backend_unavailable`; an unratified binding is
`authority_binding_unratified`; and malformed, unknown, contradictory, or
unauthenticated envelopes keep their corresponding `decision_envelope_*`
identity. Recovery-envelope failures keep their narrower
`worker_admission_recovery_*` identity. None is labelled
`exact_returned_policy`, treated as a returned denial, mapped to
`work_record_readiness_failure`, or collapsed into `operator_recovery_needed`.

`operator_recovery_needed` is a break-glass classification only. The shared
classifier can select it solely from an authenticated unexpected condition that
originated outside the tooling model, and the public result must preserve that
exact external condition. Validation failures, scope thresholds, backend
refusals, missing routes, malformed or missing envelopes, unknown versions or
fields, contradictions, projection failures, handler exceptions, portfolio
defects, and default branches are modeled outcomes and may never select it.

**Confirmed no-authority is positive only.** A launcher-confirmed declaration
that no CCE authority is configured produces no local admissibility block: a
structurally runnable, contained unit proceeds and the measured facts stay
advisory. Silence never selects that posture — an absent admissibility block is
a missing declaration and fails closed — and neither does caller assertion: the
closed authority-input schema refuses caller-supplied Node Engine authority
fields before admission, and the posture must additionally report that it was
evaluated from the local-only config authority with no authenticated request
sent and no pack or Node Engine backing claimed.

The confirmation is a capability carried from the authenticated launcher over a
dedicated, prewritten and unlinked inherited authority descriptor, not a truthy
flag or a shape ordinary library or MCP-registration callers can reproduce. The
server brands only the exact complete declaration read from that descriptor. It
explicitly states that no authenticated Node Engine request exists, no Node
Engine backing exists, and every authority/configuration carrier is
intentionally undeclared. Empty environment state, missing variables,
caller-supplied config, partial, malformed, oversized, or caller-authored
declarations never select `local_only_fail_open`. A standalone published
`wiki-mcp` bin launch inherits no descriptor and so cannot select it either.

The launcher resolves canonical workspace configuration before it creates the
descriptor, and it does so per server generation rather than once per conduit;
no authority or policy is reconstructed from process environment in the server
or core library. It emits a declaration only when every CCE authority
carrier — service URL, API key, worker-admission route, request-contract digest,
and worker-admission authority binding — is undeclared for that generation, so a
carrier configured while a conduit is live withdraws the declaration from every
later generation. The registered dispatch route then publishes the local-only
result shape explicitly: `authority: local_only_config`, effect and status
`local_only_fail_open`, no authenticated request sent, no pack or Node Engine
backing, and the single fixed diagnostic `launcher_confirmed_no_cce_authority`
naming the launcher declaration it accepted. A caller-supplied config bag or
resolver is an assertion, not that declaration, and can never select the
posture.

**Exact returned policy consumes the client-owned typed result.** The route
publishes `exact_returned_policy` when the client-authenticated decision has a
matching effect/status plus the independent ratification, digest, and
authority-binding evidence. It does not repeat response recognition, impose a
reason-count limit, require optional recovery, or revalidate recovery by effect.
The current response contract and distinct admit-consumption rule are owned by
[the enforcement model](enforcement-model.md#the-authority-boundary-at-mcp-dispatch-admission-wk-2316);
this runtime contract does not restate or re-evaluate that rule.

`workspace_validate_dispatch` consumes the wiki-core validator-owned typed
recovery result. It never parses raw CCE recovery or owns an action, reason,
field, or schema vocabulary. Ordinary output remains bounded to the validator's
diagnostic metadata and the existing non-authorizing continuation; it omits the
retained recovery value. With both `node_engine_admissibility:true` and
`verbose:true`, it publishes the same typed result and complete retained
diagnostic carrier, including the CCE source boundary, live decision and
authority-binding evidence, canonical digest, UTF-8 byte count, member count,
ordered JSON-Pointer/type census, validator issue, and retained recovery value.

The shared `jsonContent` response boundary is the sole size owner. If that
complete verbose envelope exceeds its inline limit, it persists the already
complete JSON bytes and returns a `content_reference`;
`workspace_read_mcp_content_reference` range-reads those exact bytes. Neither
route reconstructs discarded recovery, and neither owns CCE schema semantics.
Malformed present recovery is rejected by wiki-core's single client validation
boundary. Downstream MCP and launcher consumers never recheck the typed result,
synthesize recovery, or change the original `needs_review` or `reject` effect.

**Malformed exact-policy payload diagnostic (work record).** For the
`node_engine_decision_envelope_malformed` path only, the public readiness
admissibility block from `workspace_validate_dispatch` and the mechanical detail
from `workspace_agent_dispatch` may include `exact_policy_payload_issue`. Its
closed population is exactly:

- `decision_reasons_malformed`
- `worker_admission_recovery_missing`
- `worker_admission_recovery_malformed`
- `worker_admission_recovery_unknown_version`
- `worker_admission_recovery_unknown_field`
- `worker_admission_recovery_wrong_projection_mode`
- `worker_admission_recovery_authority_mismatch`
- `worker_admission_recovery_resubmission_mismatch`
- `worker_admission_recovery_truncated`
- `worker_admission_recovery_actions_malformed`

`worker_admission_recovery_missing` belongs to validator-owned recovery handling
for a route-problem recovery contract. It does not make optional
`pack_result.recovery` absence malformed and is not missing exact-policy evidence.

The Node Engine API client owns this frozen taxonomy and its bounded-membership
predicate. Downstream interpretation, readiness, and MCP layers only validate
and forward that owner. An unrecognized value is omitted. The field is also
omitted from every other outcome, including authenticated decisions, reject,
needs-review, unratified, transport-failure, unavailable, unknown, and
contradictory branches, even if an upstream-shaped object supplies a recognized
value. A conformant admit is an authenticated exact returned policy and likewise
omits this field.

This field is redacted mechanical diagnostic evidence only. The malformed result
remains undetermined, non-dispatchable, and on the `mechanical_failure` authority
limb. The field carries no raw response, reasons, recovery body, policy authority,
remediation, recommendation, or synthetic recovery and cannot substitute for an
authenticated CCE decision.

**A partial declaration is not confirmed absence.** A launcher that declared any
one carrier HAS declared CCE authority, so a missing sibling carrier is an
operator configuration shortfall, not evidence that no authority exists. It falls
through to the admissibility overlay and fails closed there — never open on the
strength of one unset environment variable. Configured-but-unreachable backends
and absent responses are likewise never this posture; they carry their own
mechanical limbs above.

**`work_record_readiness_failure` is narrow.** It is reserved for a genuine
authored or structural WK/slice contract defect and is emitted only with the
exact failed check, status, and contract path. Its supported recovery targets
that exact defect; it never advises a coordinator to generically revise a work
record, and a graph, backend, carrier, review-target, launcher, runtime, or CCE
failure may not borrow it. The ready-slice structural projection in
`work-record-write-route-helpers.mjs` is the retained legitimate producer; a
findings-only admission may also use it for an actually invalid canonical review
contract or an unresolvable findings-only subject, again only while naming the
exact field.

### Authenticated backend-refusal classification

`launcher_transition.runtime_backend_unavailable.v1` means the selected
registered runtime backend is **actually absent**. Nothing else selects it. The
registered `workspace_agent_dispatch` route emits it on exactly one branch — the
one guarded by a missing dispatch backend. work record is why: a managed Claude
reviewer whose confined wiki-MCP conduit refused its launcher-resolved input was
reported to the coordinator as an absent launcher backend, and the coordinator
spent the incident looking for a backend that had authenticated the refusal
itself.

Every authenticated backend refusal is classified exactly once, by
`classifyLauncherTransitionBackendRefusal` in
`@agent-chassis/agent-launch-core/src/lib/launcher-transition-plan.mjs`. That
result is the sole authority for the failure code, cause, authority limb, public
diagnostics, recovery, classification state, and redaction signals of that
refusal. `packages/wiki-mcp/src/lib/dispatch-tools/register.mjs` consumes it and
performs only a structural public allowlist projection; on an authenticated
refusal path no route-local helper — corrective-status projection, needs-review
projection, reason matching, authority-limb matching, nullish fallback, or the
backend-refusal blocker map — may select or override any of those fields. Those
helpers keep their pre-launch and readiness behaviour and lose nothing else.

A classification is in exactly one state:

| State | Meaning | Selected by |
| --- | --- | --- |
| `actual_backend_unavailable` | The registered runtime backend is absent. | `backend_unavailable` or `launch_backend_unavailable` — the closed absence set — and nothing else. |
| `known` | The cause is in the canonical vocabulary. | A closed `launcher_transition.*` code, or a cause registered in `runtime-blocker-codes.v1` whose category maps to a transition limb. |
| `authenticated_unclassified` | The backend authenticated a valid bounded cause that is outside the canonical vocabulary. | Everything else. |

An unclassified refusal stays visibly unclassified. It surfaces the registered
code `launcher_transition.authenticated_backend_refusal_unclassified.v1` and its
exact cause, and is never relabelled as a known failure or as backend absence.
That code is deliberately not a member of the closed plan-failure taxonomy above:
the plan still records one of those seven, while this code is what makes the
unclassified state visible and enumerable through
`workspace_runtime_blocker_taxonomy`.

Registration under the `backend` category is not evidence of absence. A backend
that ran and exited — `stdio_mcp_conduit_server_exit`, for instance — is
demonstrably present, so it takes a lifecycle-allocation limb.
`stdio_mcp_conduit_input_invalid` keeps its exact mechanical transport cause and
the operator recovery its registry entry already declares; no backend-restore
instruction is invented for it.

Four registered-route branches that used to collapse into the absence limb now
each keep a non-absence transition failure and their own operator consequence,
because in every one of them the backend answered:

| Route condition | Transition failure | Operator consequence |
| --- | --- | --- |
| The launcher resolved no routing decision for this role and subject. | `launcher_transition.prospective_lifecycle_unavailable.v1` | The prospective transition could not be planned; retry after lifecycle preflight succeeds. |
| A settled managed-WK refusal projection did not match this attempt's identity. | `launcher_transition.lifecycle_allocation_failed.v1` | The settled lifecycle projection is incoherent; complete launcher allocation recovery. |
| An accepted plan is not the allocated continuation of the prospective plan. | `launcher_transition.lifecycle_allocation_failed.v1` | The backend accepted the launch and returned a foreign plan identity. |
| An accepted managed-WK allocation did not project into public readiness. | `launcher_transition.lifecycle_allocation_failed.v1` | The backend accepted the launch and returned an unprojectable allocation. |

The three allocation-integrity branches share one limb deliberately. The closed
seven-code taxonomy carries no projection-integrity limb, and assigning a
dependency or publication limb to an identity divergence would hand an operator a
recovery instruction that does not apply. Their distinct `reason` values and the
incident coverage in
`tests/workspace-agent-dispatch-corrective-status-recovery.test.mjs` separate
them.

### Producer-originated envelopes and the public response field list

The classifier accepts only an envelope identified by the producer boundary:
`schema_version`,
`accepted: false`, and `refusal.{code,reason,detail}`. Exactly three producer
projections are reachable, and the cause is read from them in this order:

1. **managed bootstrap** — `detail.cause.{type,code}`, alongside the producer's
   own `detail.recovery` carrier. A `cause.code` of `null` means the producer
   already refused to carry a code there, so the next source is consulted.
2. **managed-tip authentication** — `detail.cause_code`, the originating code
   behind a restart or continuation diagnostic.
3. **Claude conduit** — `refusal.reason`, which carries the typed conduit error
   code directly.

A cause code matches `/^[a-z][a-z0-9_.-]{0,159}$/u`. A missing, malformed, or
over-bound code **fails schema classification loudly**: the classifier raises
`LauncherTransitionRefusalSchemaError`, which surfaces through the route's
exception boundary. It is never trimmed to fit, never treated as secret
redaction, and never converted into backend absence. The raised message names the
field path and, for an over-bound value, its observed length — never the value.

These producer paths, and only these, may cross the public boundary:

`refusal.code`, `refusal.reason`, `detail.cause.type`, `detail.cause.code`,
`detail.cause_code`, `detail.recovery.{state,route,args}`, `detail.next_action`,
`detail.actor_recovery`, `detail.next_action_args.{role,subject}`, and the
declared mismatch facts `detail.{mismatch_field,expected,actual,subject,role}`.
Ordinary diagnostic fields also cross completely: `detail.message`,
`detail.detail`, `detail.error`, `detail.stderr`, `detail.stdout`, `detail.stack`,
`detail.explanation`, `detail.reason_detail`, `detail.diagnostic`, and
`detail.output`.

A contract-valid value crosses **completely** (decision). Nothing on this list is
summarized, ellipsized, or trimmed to a bound. A value that does not satisfy its
declared schema is rejected instead: its field path appears in the
classification's `schema_rejected` list and the value is absent. Rejection and
redaction are distinct and separately reported, so a caller can always tell
"absent because malformed" from "absent because producer-classified".

Recovery comes only from those declared paths. A valid `detail.recovery` state is
authoritative — including when it is `no_supported_route`; only when no valid
recovery carrier is present does the declared next-action triple
(`next_action` + `actor_recovery` + `next_action_args`) supply a callable
continuation. A redacted or schema-rejected field can never select recovery, and
no recovery is invented when neither declared path is present.

### Redaction signals

Only an exact value explicitly declared sensitive by its producer, or a value on
the launcher's declared private transition protocol, is removed and emits exactly
one `{ field, reason }` signal. Unknown fields are schema-rejected, not called
redacted. The launcher-private reason vocabulary is closed to two values, exported as
`LAUNCHER_TRANSITION_REDACTION_REASONS`:

| Reason | Applies to |
| --- | --- |
| `secret_material` | Exact credential or authorization material explicitly identified by its producer. |
| `launcher_private_state` | Authenticated capability-scoping and private lifecycle state, including observed status carriers and producer authority tokens such as `detail.authority_limb`. |

Diagnostic, error, stderr, stack, free-form, caller-controlled, untrusted, long,
or inconvenient text is not inherently sensitive and is not a redaction class.
The classifier never guesses from field names or words inside prose. Paths and
nested diagnostic structures are ordinary diagnostics and remain value-identical.
When a structured diagnostic explicitly identifies a genuine sensitive value,
only that exact value is removed and signalled; the remainder is preserved
exactly. An oversized
public response uses the MCP content reference with `total_bytes` and operative
`workspace_read_mcp_content_reference` ranged retrieval, so the complete
ordinary diagnostic remains reconstructable.

This is an exact response-shape rule, not a general confidentiality or
credential-leak-prevention posture. A producer-classified removed value does not
appear in diagnostics, recovery, or an alternate response field, and a removed
field cannot select recovery. Because `detail.authority_limb`
is removed, a producer authority token can no longer promote a refusal to the
exact-returned-policy limb; that limb is selected from the canonical registry
category of the cause itself.

The plan consumes authenticated results without transferring their authority.
work record remains settlement/recovery owner, work record role/runtime owner,
work record receipt owner, work record findings-route and transport owner,
work record publication producer, and CCE policy/recovery owner. A consumer must not
reconstruct, reduce, or substitute any of those carriers.

## The registered public refusal stack (work record)

A public mechanical refusal has exactly one owner for each of its parts. The
split exists because a refusal assembled from several partial opinions loses the
one thing it is for: the deciding fact, stated once, with a route the caller can
actually take.

| Concern | Sole owner |
| --- | --- |
| Public mechanical code identity | `packages/wiki-core/data/runtime-blocker-codes.v1.json` |
| Envelope construction and taxonomy-derived validation | `packages/wiki-core/src/lib/refusal-payload.mjs` |
| The closed PUBLIC redaction-reason vocabulary | `packages/wiki-core/src/lib/refusal-payload.mjs` |
| Tool-named next-call shape and canonical discovery validation | `packages/wiki-core/src/lib/next-calls-descriptor.mjs` |
| Non-launcher mechanical mapping | `packages/wiki-mcp/src/lib/dispatch-tools/runtime-blocker-classifier.mjs` (work record) |
| Authenticated launcher-transition mapping | `packages/agent-launch-core/src/lib/launcher-transition-plan.mjs` (work record) |

Package-local typed errors, `worker_admission.*` policy identities, and the
work record launcher state and action tokens remain package-internal vocabularies. Each is
projected exactly once, at a declared public boundary, and none is re-registered
as a public blocker or tool identity.

### Envelope content

`buildPublicMechanicalRefusal` refuses to construct anything incomplete, because
a partially-correct refusal is worse than a loud failure. Every envelope carries:

- **one registered code**, whose category, blocking flag, and summary are DERIVED
  from the registry — a caller selects an identity, it never authors one;
- **at least one deciding fact**, by field identity. A non-sensitive fact carries
  its value; a producer-classified omitted fact carries its field identity plus a closed
  redaction reason and NO value; another omission carries a documented
  complete, ranged, or paginated retrieval route (decision §4);
- **exactly one continuation limb** — either `next_calls` validated against the
  canonical tool-discovery corpus, or an explicit `no_supported_route`. Silence
  is not a limb, and neither is naming a route the agent cannot invoke;
- **a recovery** that, when callable, names the currently FALSE prerequisite, the
  operation capable of changing it, and a machine-checkable success condition;
- **the authenticated facts it observed** (`observed_facts`), so a later boundary
  re-evaluates the same envelope against the producer's facts instead of against
  whatever the world looks like when it is read.

The envelope is a pure function of its inputs — no clock, no randomness, no
ambient state — so identical authenticated facts reproduce an identical refusal
and an identical action. That is what makes a repeated correct refusal readable
as correct rather than as a loop.

### One contract, always enforced

There is ONE public mechanical refusal contract and no way to select a weaker
one. `buildPublicMechanicalRefusal` and `validatePublicMechanicalRefusal` take
no profile parameter, carry no compatibility limb, and record no contract
identity, because there is only one contract to record. A carrier that cannot
meet it is refused rather than downgraded.

Concretely, every construction and validation path enforces all of the
following, and each of them fails closed:

- a continuation entry states a **machine-checkable success predicate** over ONE
  fact: `{ fact, operator, value? }` with a closed operator set. A predicate that
  is already TRUE against the observed facts is refused (calling it again
  reproduces the refusal), and one naming a fact the refusal never observed is
  refused too, because its convergence cannot be checked;
- a continuation's arguments are checked against the **authoritative request
  schema the named route itself publishes**, supplied by the producer. Missing
  required arguments, undeclared arguments, and invalid value shapes are each
  refused, and the ABSENCE of that schema authority is refused as well — an
  unvalidatable call is not a validated call. No boundary keeps a second copy of
  another route's request contract: the dispatch family records what each route
  declares as it registers, and the ready-authoring schema is imported from the
  module that owns it;
- an actionable `next_calls` limb contains at least one **non-disallowed callable
  entry**, and a callable recovery matches only such an entry. A list whose every
  member is disallowed states no executable next step, and a recovery that named
  a disallowed entry would be a refusal pointing at the call its own list forbids.

### Mechanical refusal versus authenticated policy

The two are different claims with different owners, and the envelope keeps them
apart:

- a MECHANICAL refusal is this repository's own translation of a mechanical
  fact. Its code is a registered public mechanical identity, and the carrier
  owns its deciding facts, continuation limb, and recovery.
- an AUTHENTICATED CCE POLICY result is a decision this repository did not make.
  Its verdict, reasons, optional remediation, response provenance, and authority
  binding travel VERBATIM inside `carried`, and the carrier refuses to author
  any of those fields at envelope top level. Local code may authenticate and
  enact a policy result; it may not reinterpret one as a mechanical code, and it
  does not invent a mechanical continuation for a question CCE already answered.

Launcher transition classification — cause category, authority limb,
prerequisite, operation, and recovery selection — remains owned by work record. A
carried classification is validated for completeness and travels unchanged; this
carrier never derives, replaces, or substitutes one.

### Internal action tokens are not callable routes

A launcher-internal action token (`retry_workspace_agent_dispatch_after_...`,
`restore_wk_lifecycle`) and an internal lifecycle cause are not routes and
not public identities. They never occupy the public mechanical code slot and
never occupy a callable `next_calls` entry: canonical membership is checked on
every entry, so a token cannot validate as a tool name. An internal package cause
is registered only when a declared owner publishes it, never merely because it
exists.

### Adopted producers

The dispatch family builds every mechanical refusal through this carrier:
`workspace_agent_dispatch` admission (including the findings-only write-scope
seam and graph admission), the run-monitor routes, and forge handoff.
`dispatch-tool-helpers.mjs` retains only the transport projection — the
per-schema envelope, the blocker limb, and the scalar `next_action` — and
re-validates nothing the carrier already decided.

At the generic MCP boundary, `mcp-response.mjs` translates an untyped throw, a
platform error, and a nested cause exactly once: the client receives a registered
code, the deciding fact that the handler did not complete, the complete ordinary
producer diagnostic, and an explicit `no_supported_route`. A host errno is reported
as the FACT that a platform error occurred and never as the public reason; a
cause identity survives only when a declared owner vouches for it. When an
oversized payload cannot be spilled, the refusal discloses the CORE operation's
own outcome and identity beside the supplementary transport failure rather than
reporting a failure the operation did not have.

Repository-wide enumeration of producers, source-move detection, field-list
sunset, and catch/code ownership enforcement remain work record responsibilities and
are not claimed here.

### Next calls require mechanical validation

`validateNextCalls` checks canonical tool-discovery membership on EVERY call.
Before work record it checked registration only when a caller passed `knownTools`, so
every caller that omitted the option accepted an unregistered — or entirely
invented — tool name, and a private launcher action token such as
`restore_wk_lifecycle` validated exactly as well as a real MCP route. The
`knownTools` option now only NARROWS the canonical corpus to a route-specific
subset; it cannot widen it and cannot switch the check off.

### The closed public redaction vocabulary

decision §3 permits redaction only where it is deliberate, documented, signalled
with the field name, drawn from a CLOSED enumeration, and never routed to a
recovery path. The public enumeration is owned by `refusal-payload.mjs`:
`secret_material`, `launcher_private_state`, `internal_identifier`, and
`personal_data`. These names do not classify fields or prose: a producer must
explicitly identify the exact value being removed. Unknown and retired reasons
fail validation loudly. This vocabulary defines an exact response shape; it is
not a general confidentiality or minimum-disclosure policy.

work record's two private launcher reasons are not published
directly. They cross into the public vocabulary exactly once, through
`projectLauncherRedactionReason`. An unrecognised internal reason FAILS rather
than being published verbatim, because publishing an unknown reason would reopen
the free-text redaction hole the closed enumeration exists to close.

A redacted or omitted deciding fact may not select a recovery. Where a producer
declares `recovery.selected_from`, every named fact must be a PUBLISHED one — a
caller cannot verify a selection it cannot see.

### Identity is decided by membership, not by spelling

Many owner-defined identities are dotted and versioned —
`launcher_transition.cce_policy_refused.v1`,
`agent_dispatch_identity.ambient_env_role.v1`,
`worker_admission.accepted_authority.v1`. Most are deliberately PRIVATE: they are
their package's semantics, not public blocker codes.

Classifying these by SYNTAX fails in both directions. A flat `snake_case`-only
grammar destroys every one of them — the first cut of work record's classifiers did
exactly that, collapsing even codes already registered in
`runtime-blocker-codes.v1.json` into the module-generic
`controlled_contract_operation_failed`. Widening that grammar to admit dots would
have preserved the real identities and equally admitted
`attacker.supplied.evil.v1`.

Membership is therefore authoritative, not syntactic.
`runtime-blocker-codes.v1.json` declares a CLOSED set of
`package_local_identity_namespaces`, each naming its owning package and,
optionally, the single registered public code its members project to. An identity
is trusted when **both** hold: its leading namespace is declared, and it matches
the declared identity shape (`<namespace>.<segment>…​.v<N>`). Neither alone
suffices — the shape rule only bounds something whose ownership is already proven,
so namespace ownership cannot launder an arbitrary suffix.

The declaration deliberately does not enumerate the individual identities.
Enumerating them would require scanning the repository, which is work record's
exclusive function, and would turn every new identity into a registry edit. The
namespace is the unit of ownership.

Two rules follow:

- **Preserve, then project.** A trusted identity stays byte-for-byte in its
  owner-defined private field — `reason_code`, a cause code, a decision code, a
  classification code, or a policy reason. Where a public mechanical envelope
  needs a public code, the identity is projected exactly once: a REGISTERED
  identity projects to itself, so a producer's own reported failure is never
  replaced by this route's opinion; an unregistered member of a declared
  namespace takes that namespace's single declared public code. Projection reads
  the identity, it never consumes it.
- **A declared namespace is not a licence to publish.** The public `code` field
  still requires REGISTRY membership. `worker_admission.*` is declared, so it is
  preserved and transported — and it still cannot be published as a public
  blocker code.

Precedence is fixed, and platform detection runs FIRST, so a host code can never
be laundered into a semantic identity by a later rule.

`exact_returned_policy` is outside all of this. A carried policy carrier's reason
and decision identities are the authority's own vocabulary, transported unchanged
even when this repository declares no namespace for them — rewriting or dropping
one would be inventing a policy result. Membership gates LOCAL classification; it
never filters carried policy content.

### Platform codes never become public semantic reasons

`isPlatformErrorCode` and `boundPublicSemanticCode` (also owned by
`refusal-payload.mjs`) are the single detection point for the rule that a POSIX
errno or a Node `ERR_*` code is a fact about the HOST, not about the contract.
A boundary that would otherwise project `error.code` directly calls
`boundPublicSemanticCode` instead, which keeps a genuine package-local semantic
identity and substitutes a declared default for a platform or arbitrary one.

At the controlled-contract boundary, four populations are separated and each is
translated exactly once:

| Population | Public reason |
| --- | --- |
| Package-defined semantic failure (lowercase snake_case grammar) | PRESERVED verbatim |
| Platform failure (POSIX errno, Node `ERR_*`) | `controlled_contract_platform_failure`, with a bounded host-condition CLASS |
| Parser failure (a raw `SyntaxError` that escaped an untyped path) | `controlled_contract_document_parse_failed` |
| Unexpected internal exception | `controlled_contract_operation_failed`, carrying the registered `controlled_contract_internal_invariant` identity |

`controlled_contract_operation_failed` is a module-generic default and is
admissible only because its cause set is CLOSED and mechanically enforced: it is
reachable from an unexpected internal exception and from nothing else. Its
internal-invariant limb names the exact operation, the stage, the owning
boundary, and a deterministic correlation identity, and it declares no retry and
no recovery — no named prerequisite is known to be false, so claiming a route
would be inventing one.

### Blocked dispatch envelopes pass one gate

The four blocked-envelope builders — dispatch, run status, run wait, and runs
list — share one blocker limb and one validation gate in
`packages/wiki-mcp/src/lib/dispatch-tool-helpers.mjs`. A `blockerCode` must be
registered in the canonical taxonomy and a supplied `next_calls` list must pass
canonical validation; both are fail-closed and throw rather than publishing a
plausible-looking refusal. Every production call site selects its code from a map
already asserted against the taxonomy at module load, so the gate fires only on a
defect.

The runs-list builder previously lived in `dispatch-run-monitor-routes.mjs` as a
fourth, route-LOCAL copy of the same shape. Being local, it was the one builder
that never gained the remedy slot its siblings share and never passed through any
validation. It now sits beside them.

Codes published on other public MCP envelopes are registered too:
`mcp_response.spill_persistence_failed.v1` and
`mcp_response.content_reference_ranged_read_unavailable.v1` were previously
defined only at their producer, so no registry described them and
`workspace_runtime_blocker_taxonomy` could not enumerate them. `mcp-response.mjs`
now fails its own module load if either identity leaves the registry.

Where a launcher refusal reaches the public dispatch envelope, its redaction
signals cross through `projectLauncherRedactionReason` exactly once. work record's
three private reasons are unchanged and unregistered here; the FIELD path is
preserved so a caller still knows which field was removed, and only the reason is
re-expressed in the public vocabulary.

### Preflight stays projection-only

Coordination preflight consumes the immutable work record launcher-transition
projection and renders NO model, app, backend, or profile selection verdict. It
refuses a plan that is not frozen or does not carry the exact plan schema, it
forwards the plan by reference rather than rebuilding it, and it reports absence
rather than synthesizing one.

Dispatch extends the existing backend-owned
`workspace-agent-canonical-findings-route-admission.v1` carrier rather than
minting a third route selector. That carrier binds and authenticates the selected
unit and route, subject, technical role, purpose, and frozen contract identity,
and each mismatch fails before spawn. It retains no bound run or attempt.
Carrier membership is based on process-local identity, not shape: a structurally
identical copy is refused. This supports ownership, correlation, freshness, and
cross-session noninterference; it is not an adversarial forgery-resistance claim.
The same route admission may identify independent attempts; after lifecycle minting, each
process-local run context and registry owns its exact attempt identity.

Final model, app, backend, profile, configuration, generation, revision, and
launcher-context authentication remain launcher-owned at the launch boundary and
are consumed without local reselection. None of them appears on the carrier — if
one did, the backend would have become a second selector.

A structurally runnable unit proceeds with NO CCE decision only under the
positive launcher-confirmed no-authority posture, which requires every field of
that posture to have been positively derived. It is never selectable by silence,
by a partially-shaped envelope, or by caller assertion.

### Preflight discloses its coverage and its deferrals

`workspace_coordination_preflight` answers a bounded question. A caller that read
`next_action: "proceed"` as launch readiness was reading a fact preflight never
evaluated, and preflight cannot fix that by evaluating more — those facts belong
to other owners. It fixes it by disclosure instead. The result carries every fact
family a coordinator needs before dispatch, each with one stable identity, one
evaluation origin, one local handling, and one authoritative boundary.

`local_handling` is a closed three-value vocabulary:

| Value | Meaning |
| --- | --- |
| `evaluated_locally` | Preflight decided this fact from inputs it owns. |
| `projected` | Another boundary decided it. Preflight reports that decision without re-deciding it and acquires no ownership of it. |
| `not_evaluated` | Nothing decided it here. `authoritative_boundary` names the boundary that must. |

The complete fact-family matrix and its owners:

| Fact family | Authoritative boundary |
| --- | --- |
| `coordinator_identity_and_role` | the dispatch-identity contract |
| `repository_docs_wiki_mount_and_writeback` | coordination preflight |
| `structured_route_registration` | wiki-MCP tool registration |
| `launcher_active_composition_compatibility` | the launcher |
| `graph_impact` | the code-index graph-impact routes |
| `local_dispatch_structural_readiness` | `workspace_validate_dispatch` |
| `cce_declaration_admissibility_and_policy` | CCE |
| `launcher_backend_provisioning_and_spawn_readiness` | the launcher |

Local structural and mechanical readiness belongs to `workspace_validate_dispatch`
and is never re-derived here. Seeing that route registered moves the family's
STATE, never its ownership: the presence of a tool does not stand in for having
called it.

CCE declaration, admissibility, and policy results belong to CCE alone, and
launcher and dispatch boundaries only authenticate, project, enact, or report
them. An absent, malformed, unrecognized, or unauthenticated CCE carrier keeps
its decision-defined NON-POLICY classification: preflight synthesizes no local
verdict, and silence is never permission. It equally never becomes a local
refusal — a projected or deferred family is visible, not a gate. An authenticated
projection is carried by reference, so it remains its owner's fact rather than a
rebuilt copy that would compare equal while having lost that owner's authority
over it.

A proceed result is scoped in the same breath it is given. `proceed_scope` states
the scope, sets `asserts_complete_launch_readiness: false`, names the
launch-readiness owner, and enumerates the deferred boundaries. It does so on
refusals as well as on proceeds, so completeness can never be read into the
absence of a caveat.

Compact output omits exactly one thing: the per-family detail. It still reports
the complete family count, the omission counts, the closed vocabulary, the
deferred boundaries, and the operative route that returns the rest —
`verbose:true` on `workspace_coordination_preflight`. Both projections derive
their counts from the same family set, so they cannot disagree about coverage.

### Point-in-time corpora

Two corpora record what work record audited, and both state their own limits:

- `packages/wiki-core/data/refusal-emission-census.v1.json` assigns each public
  refusal emission at an in-scope boundary exactly one decision limb
  (authenticity, integrity, identity, confinement, transaction safety, replay) or
  `exact_returned_policy`, names the failed operation, and states the unsafe
  effect of continuing. Procedure-only rules are excluded: under decision a rule
  about what SHOULD happen is policy, not mechanism.
- `packages/wiki-core/data/exception-disposition-census.v1.json` gives each
  in-scope exception-handling site one closed disposition — a local typed domain
  reaching a named translator, a registered public refusal, a proven-safe
  suppression with an executed behavioural witness, or a confirmed
  public-translation defect with an explicit owner WK.

Both are POINT-IN-TIME and record their base identity, audit method, declared
population, and disclosed omissions. Neither claims repository-wide completeness,
performs discovery, detects source moves, or gates drift: **work record** exclusively
owns repository enumeration and mutation gating. Asynchronous settlement,
teardown, cache, detached-rejection, and process-guard sites are carried in the
exception corpus as **work record**-owned external references only — they are neither
re-adjudicated nor re-witnessed here.

## Canonical document map

This page is the canonical entry page for the MCP dispatch runtime contract. Its
normative text is organized across five focused canonical documents. Every
section heading that this page previously carried is retained below as a
compatibility landing point linking to the canonical location of that section.
Three sections are carried canonically on this page rather than on a focused
document: already-integrated restart finalization and cross-backend integration
continuation, the dispatch-readiness generated write surface, and the
crash-durable state substrate.

## Managed structured-role-result capture

The launcher semantic validator owns reviewer/redteam summary-budget state. Its
numeric recommendation, JavaScript string-length measurement, role eligibility,
absent/null behavior, and captured-evidence semantics are defined only in
agent-role-result.
The child payload cannot supply that state.

On the default managed parser path, captured response and payload bytes are not
rejected by a default whole-result policy ceiling. An explicit positive caller
override for either supported byte coordinate is still enforced. JSON
extraction, exact schema and type checks, duplicate-key rejection,
role/outcome/count consistency, and other mechanical validity checks fail closed
only for the optional structured observation and formal-attestation consumer.
They never invalidate, hide, or make unusable captured reviewer/redteam text.

After semantic validation, dispatch projects the validator-minted
`summary_budget` verbatim for valid reviewer and redteam results. It does not
measure the summary or derive budget state from text, diagnostics, findings,
counts, or outcome. Authenticated wiki-core managed evidence consumes the same
state under the rules in
Agent role result.
Absent or malformed managed budget state is invalid at that consumer boundary.

Budget excess alone is nonfatal. A captured semantically valid result retains
its exact summary, findings, and outcome in validator evidence; this is not a
promise that every dispatch projection exposes those fields. Provider or
transport output that was not captured uses the existing `missing_result`
evidence and gains no reconstruction claim. Captured output that does not
conform to the schema retains its complete response and retrieval path; only the
structured observation lacks a valid `summary_budget`.

Terminal result-mode semantics have one family-neutral owner chain. A family
adapter may resolve and forward the concrete selected-contract fact required by
its harness, but its accepted launch result carries only the closed fact carrier;
the adapter does not classify an outcome or construct, map, default, or attach a
complete result-mode envelope. The shared terminal final-result normalization
seam consumes that fact only after terminal and structured-result evidence is
available, invokes `workspace-agent-dispatch-result-mode.mjs`, and attaches the
owner-produced `workspace-agent-result-mode.v1` envelope. The owner exclusively
defines the selected-contract and outcome vocabularies, validation, construction,
classification, and exact equality. `selected_contract` is one of `fenced`,
`schema_constrained`, or `free_prose` when selected; `mode` is the independently
classified terminal outcome. No scalar overload or family-local mapping bridges
those vocabularies.

Ordinary reviewer and redteam output is text-first advisory evidence. The public
terminal result separates execution status, advisory text availability and
usability, schema conformance, and optional same-result attestation metadata.
Whenever text was captured it is explicitly usable, including invalid JSON,
worker-only outcomes, missing fields, unknown enums, extra fields, and prose.
Bounded parser diagnostics annotate `schema_observation`; they never produce an
`invalid_result`, mandatory retry, replacement, or recovery posture for the
ordinary review. Compact monitoring supplies a bounded content reference, while
`include_final_result:true` returns the complete captured text.

`formal_attestation` is requested only when the launcher-selected canonical
result contract is `schema_constrained`; ordinary reviews report
`requested:false`, `available:false`, `reason:not_requested`. For a requested,
schema-adherent review the original result settlement derives and durably publishes
the existing formal attestation, then projects it on that same result. A
nonadherent result reports `requested:true`, `available:false`,
`reason:schema_non_adherent` without changing advisory text usability. No later
lookup, append, authentication, persistence, or recovery operation exists. The
attestation retains its existing narrow admission consumer semantics. The
coordinator instruction is explicit: read and disposition the actual response
normally. All result shapes carry the same non-authorizing,
non-vetoing, non-recovery lifecycle posture.

Findings monitoring applies the same ownership boundary without a recovery
path. Current status and wait read only the owning process's registered run.
Receipt or terminal-result bytes may remain readable audit evidence, but no
current, historical, partial, malformed, or conflicting receipt can restore a
findings run, authorize a launch, or produce accepted monitoring. Implementation
worker and integration recovery retain their separately owned durable contracts.

work record remains the owner of MCP evidence projection, and work record remains the
owner of compact/full status, wait, spill, and ranged retrieval. This capture
contract does not create a caller-selected storage authority, spill store,
diagnostic-detail policy, reviewer write authority, or recovery guarantee.

## Contributor sequencing versus integration authority

The repository's contributor lifecycle and the consuming-repository runtime
have different authorities. `AGENTS.md` sequencing is coordinator policy:
work record's findings-only DRY/DEC reviews, controlled-contract authoring, and
design-redteam boundary organize work but do not select a runtime reviewer mode
or refuse committed-slice integration. work record records completed reviewer
attempt-lineage and monitoring work delivered directly on `main`; its cancelled
implementation slices and historical review evidence are not delivery,
integration, or terminal-review authority and must not be reconstructed.

The integration path has an explicit owner chain. The canonical slice-unit
registry is `resolveCanonicalSliceIntegrationUnit` in
`packages/agent-launch-cli/src/lib/backend-scope-authority.mjs`; it resolves
the canonical record and exact slice contract/ref identity. The launcher
producer is `requestCommittedSliceIntegration` in
`packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-integration.mjs`;
it derives the target, verifies mechanical Git and record facts, carries review
output only as advisory evidence, and obtains any configured CCE decision
before calling the integration primitive. The MCP projector is
`registerCommittedSliceIntegrationRoute` (including
`projectIntegrationSuccess`) in
`packages/wiki-mcp/src/lib/dispatch-tools/committed-slice-integration-route.mjs`;
it projects the producer's result and owns no target derivation or policy.
This is an explicit function-and-schema mapping, not substring inference from
diagnostic codes, reasons, subjects, or prose.

The result must preserve three separate limbs. Mechanical facts include
launcher-bound identity, refs, immutable objects, scope, CAS state, and typed
runtime prerequisites; a failure there is a technical refusal. Advisory
evidence includes findings, clean results, receipts, lifecycle status, and
orchestrator dispositions; it may be correlated or supplied to CCE but cannot
authorize or veto integration. An explicit, ratified, target-matched CCE
decision is the only configured policy decision. With no configured CCE gate,
the documented free-substrate posture applies. Thus contributor review
sequencing and review-result content remain distinct from consuming-repository
integration authority: review sequencing establishes evidence provenance, while
only the configured CCE decision (when present) establishes policy posture.

Post-terminal findings capture preserves that separation. The process-local run
record owns the observed child outcome. Optional receipt, log, provenance, or
terminal-artifact publication is best-effort audit work and cannot replace,
withdraw, or reclassify that outcome. Monitoring never edits a receipt, selects
a repair mode, reconstructs an old handle, or respawns a completed reviewer.

- [Launch and admission](mcp-dispatch-launch-and-admission.md) — supported
  families, launch and monitoring, the canonical initiative gate, orphaned and
  ahead slice tips, and declared unit dependencies.
- [Managed run lifecycle](mcp-dispatch-managed-run-lifecycle.md) — durable
  managed-run process identity, subject-addressed restart convergence, and
  process-local monitoring versus restart-stable receipt authority.
- [Terminal review](mcp-dispatch-terminal-review.md) — the authenticated
  per-attempt terminal review contract, active managed composition,
  spawned-server lifecycle, post-spawn conduit failure, cleanup-only terminal
  failure, plural exact-slice review evidence, the exact-slice review-surface
  state budget, and bounded postcheck diagnostics.
- [Slice integration](mcp-dispatch-slice-integration.md) — empty and no-op slice
  deliveries, zero-delta lifecycle recovery, and managed worker completion and
  post-commit structured evidence.
- [Monitoring and ownership](mcp-dispatch-monitoring-and-ownership.md) —
  monitor-route terminality, the wiki-MCP boundary, and trusted operation
  ownership.

## Integration diagnostics and recovery ownership

The integration boundary has one source of truth for each concern. The
runtime-blocker registry at
`packages/wiki-core/data/runtime-blocker-codes.v1.json` is the public
coordinator recovery taxonomy. It describes the bounded recovery categories
consumers may receive; it is not a second integration classifier. The launcher
integration logic in
`packages/agent-launch-cli/src/lib/workspace-agent-dispatch-backend-integration.mjs`
is the typed diagnostic owner: it classifies mechanical failures and explicit
CCE outcomes and carries advisory review facts without turning them into local
refusals. The wiki-MCP route in
`packages/wiki-mcp/src/lib/dispatch-tools/committed-slice-integration-route.mjs`
is an explicit projector of that typed result. It accepts only registered
codes and never infers a recovery limb by substring matching a reason or
diagnostic message.

Across those boundaries, exact mechanical integration facts, preserved
advisory review evidence, and an explicit configured CCE decision remain
separate. A mechanically sound free/local operation is not refused because a
terminal-only review receipt is invalid, missing, plural, or otherwise
unconsumable. Such evidence remains available for recovery owned by
`work record`. Only a mechanical failure or an explicit configured CCE denial can
refuse the integration operation on these limbs; workflow recommendations and
review sequencing do not supply runtime authority.

`AGENTS.md` remains the `agent-chassis` contributor policy, including
its implementation-review-before-integration sequencing. That policy is not
shipped consuming-repository authority. Rejected `decision` is not adopted and
must not be cited as a product/runtime authority or refusal source.

## Standalone frozen findings acceptance contract

Canonical route classification must both qualify standalone findings authority
and remain authoritative when confinement and MCP transport consume it. The
route owner is the sole semantic classifier. It mints one authenticated result
binding the exact selected unit, launch subject, technical role, standalone
purpose, and frozen-contract digest; it retains no run or attempt ownership.
Lifecycle authenticates it, then mints `run_id`; the process-local run context
and registry own the exact attempt. Downstream lifecycle, Codex, Claude, stdio,
credential, and wiki-MCP
boundaries authenticate the carried result and their own exact trust-boundary
facts. They do not reconstruct managed status from `role === "reviewer"`, add a
redteam exception, or mint replacement route authority.

A canonical findings-only slice with `review_purpose: "standalone"` and an
empty `write_scope` uses
`workspace-agent-frozen-standalone-findings-acceptance-contract.v1`. This
launcher-owned discriminator is neither the terminal whole-WK contract nor the
exact implementation-slice contract, and those routes do not accept it. The
launcher binds only the observed repository, WK, initiative, selected unit and
findings shape, canonical parent and selected-unit contracts, one resolved
source ref/commit, the resulting immutable snapshot commit/tree, and canonical
source digest. Both embedded contracts, every member of the complete selected
controlled-contract generation, and the complete envelope are retained and
digest-authenticated.

Explicit standalone technical redteam retains technical identity `redteam` and,
only through that exact authenticated admission, receives managed frozen-query
transport. Explicit reviewer and omitted-purpose reviewer compatibility are
unchanged. Terminal whole-WK and launcher-owned exact-slice review remain their
existing reviewer-owned routes. Resolution preserves
legacy strings, structured validation, mixed stored order, and advisory prose.
Omitted-purpose redteam refuses before frozen authority, managed-run creation,
conduit construction, or spawn with
`frozen_standalone_findings_contract_invalid`, `contract_side: "selected_unit"`,
`mismatch_class: "findings_shape_mismatch"`, and
`authority_limb: "mechanical_failure"`. The same mechanical authentication
boundary rejects absent, substituted, wrong-unit, wrong-subject, role-only,
omitted-purpose, mismatched-purpose, and unauthenticated-artifact carriers.
Per-attempt wrong-run rejection belongs to the process-local run registry. Raw
contracts, digests, paths, Git output, and throwable prose are not projected.

Findings remain advisory only. The admission grants execution and return of
advisory findings, never mutation, result authority, lifecycle authority, or a
caller-selectable reviewer mode. Technical redteam cannot substitute for a CCE
reviewer-mode action, and authority never transfers between standalone,
terminal whole-WK, exact-slice, or CCE routes.

For a standalone slice, authentication of the canonical parent establishes only
the parent WK's bytes, identity, digest, and renderable inherited review
material. It does not require the parent acceptance contract to have reached
implementation maturity. A parent with nonempty canonical criteria and an
intentionally empty validation array is valid draft review material; the
selected standalone slice still requires complete, well-formed criteria and
validation. Malformed parent material, moved or substituted identity, incomplete
selected-slice acceptance, role/scope mismatch, and caller-supplied authority
remain mechanical refusals. A bare-WK findings action has no selected child to
own the executable contract, so the parent is the selected unit and its complete
acceptance remains mandatory.

The admitted role/subject population is derived from canonical work kinds,
review-purpose classification, technical role, and authenticated effective
scope: standalone reviewer slice, standalone redteam slice, exact
implementation-slice reviewer, bare-WK reviewer, and bare-WK redteam. Purpose
labels do not create additional findings lifecycle subtypes. A redteam request
whose selected implementation slice has nonempty effective write scope refuses
at `technical_role_selected_unit_admission` as a mechanical
`technical_role_selected_unit_incompatible` role-policy violation. Review-target
resolution and frozen-contract construction have not run at that point and are
not reported as the cause.

## Immutable advisory-review target

Findings-only review is one read-only advisory operation. The coordination
`subject` remains a canonical WK or `work record`. A canonical slice, a
terminal whole-WK candidate selected through that canonical subject, or an
explicit `{ diff_base_sha, reviewed_sha }` locator pair on the same request is
normalized before execution to the same internal target:

```json
{
  "repository": "...",
  "diff_base_sha": "...",
  "reviewed_sha": "...",
  "reviewed_tree": "...",
  "private_snapshot": "..."
}
```

Selector form is erased after normalization. It cannot choose a different
lifecycle, execution route, retry mechanism, result contract, or provenance
requirement. The launcher materializes a private detached snapshot and proves
that its commit and tree are exactly the normalized reviewed commit and tree.
The snapshot is read-only review input; no selector grants repository mutation,
WK mutation, integration, forge, completion, or findings-veto authority.

A bare commit SHA is never an accepted coordination subject. If a reviewer call
places a commit-shaped value in `subject`, the mechanical refusal preserves it
only as a non-authoritative observed caller value and carries a bounded
`same_tool_correction`: keep the canonical WK or review slice in `subject`, and
add complete `diff_base_sha` and `reviewed_sha` fields to that same
`workspace_agent_dispatch` request. The server cannot derive a missing canonical
subject from the SHA, so it publishes no guessed executable continuation. The
review route itself remains supported by the same registered dispatcher; no
external reviewer, shell command, wrapper, alternate transport, terminal
candidate, ref creation, attestation append, or provenance repair is required.

For an operator-authorized direct-to-main review, the exact scoped implementation
candidate must be committed first. The coordinator then supplies its canonical
subject and complete landed SHA pair to `workspace_agent_dispatch`. Terminal
candidate status/advance and forge handoff are not part of that route, and the
reviewer remains read-only and creates no Git objects.

An explicit SHA range is an ordinary review input, not an authority carrier. Both
fields must be supplied together as full object IDs. The resolver proves that
both objects are commits in the repository, the base is an ancestor of the
reviewed commit, the range is nonempty where required, the reviewed tree is
readable, and the private snapshot contains exactly those reviewed bytes.
Malformed, incomplete, missing-object, reversed, or disjoint ranges fail only
the current call with a caller-correctable result. They create no persistent
recovery state, mutate no WK, and do not prevent a valid independent call.

Canonical slice and terminal whole-WK selectors obtain the same base and reviewed
commit from their canonical subjects and then enter this same normalization and
materialization path. Review status is not review admission, and review results
do not admit or refuse implementation, integration, publication, or completion.
Clean, findings-bearing, invalid, absent, and execution-failed results remain
distinct advisory evidence for coordinator judgment while carrying identical
mechanical lifecycle posture.

Historical work records may still contain `admission_review_target_unit`. The
schema accepts a string solely for backward-compatible parsing; production
readiness, routing, target resolution, snapshot or prompt construction, result
validation, status, receipt, provenance, and recovery never read or branch on
it. It is not an execution or provenance prerequisite, and missing or stale
metadata never requires retroactive repair. `depends_on` retains only its
ordinary coordination and predecessor-lineage meaning, including for a reviewer
unit that challenges an earlier review or redteam result.

## Operator frozen-contract diagnostic protocol

This section is the normative owner of
`workspace_frozen_review_contract_query`. Findings clients do not receive or call
this operation. They read the exact assigned unit's canonical WK JSON inside the
already-bound immutable snapshot; that selected unit's acceptance criteria and
validation are their acceptance source. The query remains an operator-only,
read-only, fail-closed diagnostic for exact launcher-frozen acceptance bytes. It
is not findings acceptance transport or a launch prerequisite, grants no review,
dispatch, lifecycle, candidate, integration, or completion authority, and has no
inline-contract, live-record, or mutable-current-record fallback.

The trusted-contract owner in `backend-review-identity.mjs` mints all supported
managed reviewer contracts: standalone findings
(`workspace-agent-frozen-standalone-findings-acceptance-contract.v1`), exact-slice
findings
(`workspace-agent-frozen-slice-level-findings-only-acceptance-contract.v1`), and
terminal whole-WK findings
(`workspace-agent-frozen-findings-only-acceptance-contract.v1`). One snapshot and
conduit path consumes those discriminators without reimplementing their grammar,
identity fields, role compatibility, selected-unit resolution, or lifecycle
policy. A standalone contract remains standalone; transport never converts it
into exact-slice or terminal authority.

Diagnostic authorization requires two independent launcher-owned facts. First, the conduit
publishes the backend-minted contract's exact canonical parent and selected-unit
bytes as one digest-named private artifact. Second, the host server accepts only
the exact current-run binding for the assigned subject, technical role, launch
ref, run id, and retry id. The environment tuple and workspace path are lookup
coordinates, never authority. A missing, pending, retired, unreadable,
role-mismatched, subject-mismatched, or tuple-mismatched binding cannot authorize
artifact content. Diagnostic failure has no effect on the findings client or on
the admissibility of a later independent action.

The request is closed to optional `target` and `cursor`. With neither, the query
returns an identity/count/digest index bounded to 4,096 UTF-8 bytes. `target` is
exactly `acceptance_criteria` or `acceptance_validation`; targeted pages preserve
complete parent-before-selected-unit order and source indices, report
`total`/`returned`/`omitted`, and are bounded to 16,384 UTF-8 bytes including the
emitted `next_cursor`. Page admission shrinks the page until the exact response
fits. Refusal for page size is permitted only when the single item at the current
target-relative offset cannot be represented; that refusal reports the offset and
the projected item's UTF-8 byte size without returning contract content.

Cursors are canonical, unpadded base64url encodings owned by
`controlled-contract-authoring-projections.mjs`. Strict decoding rejects empty,
malformed, padded, standard-base64, noncanonical JSON/base64url, extra-keyed,
stale, cross-target, and cross-artifact values instead of normalizing them.
Every accepted cursor binds the exact artifact digest, target, and next offset.

Every content refusal uses code `frozen_review_contract_query_refused`, severity
`blocking`, message `frozen review contract query refused: {reason_code}`, and
payload schema `frozen-review-contract-query-refusal.v1`. Tool visibility remains
owned by `session-role-tool-access.json`: only the operator profile may see the
operation; reviewer, redteam, worker, and orchestrator profiles do not. Visibility
is discovery metadata, not authorization; an operator without both launcher-owned
bindings receives only the same content-free refusal. The closed request schema,
artifact and cursor authentication, typed refusals, and content-free failure
behavior remain unchanged.

## Supported families

Canonical text: [Launch and admission › Supported
families](mcp-dispatch-launch-and-admission.md#supported-families).

## Reviewer and standalone redteam transport matrix

Completion transport is runtime-bound and not interchangeable, and the closure a
reviewer freezes before spawn is a property of that transport, not of the launcher
family. The matrix is derived from the authoritative exported model registry in
`packages/agent-launch-cli/src/lib/agent-launch-model-registry.mjs`; there is no
separate Codex/Claude/Agy list anywhere in the reviewer lifecycle.

| Transport | Frozen before spawn | Supported continuation |
| --- | --- | --- |
| `managed_terminal_result` | authenticated repository, role, purpose, subject, reviewed and base identity, selected controlled generation | `workspace_agent_run_status` |
| `standalone_submit_for_review` | authenticated repository, role, purpose, subject | `workspace_submit_for_review` |

Every registry member reaches the same typed decision for a given transport: a
model's app, backend, profile, or default effort changes nothing in the closure
plan. Adding or removing a registry entry therefore changes the covered matrix
automatically.

A standalone technical redteam carries only its runtime-owned facts. A plan that
carries a managed controlled generation is a planning defect and is refused before
spawn with the exact correctable field under
`agent_launch.reviewer_closure_plan.incomplete.v1`. The same refusal names any
managed-transport freeze that is missing.

## Launch and monitoring

Canonical text: [Launch and admission › Launch and
monitoring](mcp-dispatch-launch-and-admission.md#launch-and-monitoring).

### Controlled-contract generation is an implementation pre-execution gate

For a nonempty-write-scope implementation action, the launcher resolves the
immutable controlled-contract generation exactly once before persistent-WK
lifecycle allocation or adoption.
After allocation or adoption, work record binds, persists, and verifies that exact
generation before WK-record snapshotting, implementation pending identity,
worktree binding, slice allocation, scope freeze, command construction,
executor invocation, or worker execution binding. The flow
resolves the full canonical same-WK population, validates it through the
controlled-contract package, binds it to the initiative-qualified moving WK tip
while preserving the lifecycle's fixed base, and atomically persists the exact
generation under the decision expected-old CAS and winner-observation rules.

The call chain is asynchronous end to end: its result is awaited and its typed
failure propagates through the existing provisioning refusal boundary. It has no
unawaited promise, synchronous local admission-policy copy, subprocess fallback,
polling shim, caller-selected authority, or cardinality branch. A successful
controlled-contract ref transition is durable accumulated WK state and is not a
slice-allocation compensation target. The later canonical-record snapshot is
the only compensable ref advance; it is omitted whenever the exact snapshot tree
already equals the newly bound tip. When neither gate moves the ref — an
observed generation already exact at the bound tip, and a canonical record whose
bytes the bound tip's tree already carries — the persistent WK tip does not
advance, so the WK binding's moving `wk_tip_sha` equals its fixed `base_sha` and
the slice is cut from that same commit. The physical WK proof requires the fixed
base to be a retained ancestor of the moving tip, which that equality satisfies;
a moving tip strictly ahead of the fork is a consequence of real accumulated
state, never a precondition of dispatch. Any subsequent snapshot commits on the
moving tip, and slice allocation binds only after both gates succeed. Contract
revisions may create unlimited intermediate commits from successive accumulated
WK tips while preserving delivery paths; terminal whole-WK candidate
construction performs the later deterministic squash from the fixed lifecycle
base.

The frozen work record result is shared rather than reconstructed. work record's
readiness-shape module alone projects its bounded public envelope, and the
registered public route carries that exact projection from readiness through
accepted launch for DRY reviewer, DEC reviewer, redteam, reviewer-role
challenge, and worker. Findings roles continue from WK settlement into their
own review-dispatch lineage; worker is the only role that continues into scope
freeze, worktree reconciliation, and exact-slice authority. The envelope is
redacted and grants no persistence, repair, confinement, or spawn authority.

An absent persistent ref is ordinary first-use state: the same owner allocates
or adopts it, verifies the manifest-selected generation, snapshots the
canonical WK, and only then binds the run. Allocation and generation-persistence
CAS loss accept only exact equivalent winners. Restart cuts after each durable
effect re-observe it, and authenticated WK-tip movement invalidates all
tip-bound transition projections until a new work record owner settlement is
observed. Stale plans and partial ref/worktree observations converge to the
same canonical identities or refuse without repair writes, cleanup
interference, identity substitution, confinement widening, or a duplicate
spawn. There is no manual ref creation, direct persistence, second allocator,
second persistence owner, recovery registry, new lock, or new retry loop; the
existing work record serialization boundary is unchanged.

`classifyControlledContractRepositoryPath`, owned by
`packages/wiki-core/src/lib/controlled-contract-tool-shared.mjs`, is the single
repository-path classification owner for this transition and its integration
consumers. Only its `active_member` result at a flat `wiki/contracts/` path enters
the stored carrier population. Recognized basenames at other nested paths,
canonical generation archive/source paths, and unsupported flat suffixes are
accumulated nonmembers. Consumers do not recover membership, activity, or
authority from diagnostic reasons, same-WK hints, or their own suffix or path
grammars.

The prior stored active population authenticates as either empty or as the
complete population returned by that classifier. A nonempty population is
validated with the attachment generation descriptor validator, so a prior and
current generation may have different identities and member counts. Accumulated
nonmembers remain byte-for-byte repository state outside generation equality,
generation receipts, applicability, and the prior/current structural-diff
allowlist. This boundary does not establish semantic independence or current
applicability for an unsupported artifact; those remain governed by the current
contract lifecycle under decision.

The transition mechanically refuses malformed or non-ordinary flat active
entries, an incomplete or unauthenticated nonempty active population, corrupt or
contradictory stored state, and required Git or package failures. Archive/source
or other nested layout alone is not an active-state refusal. These are decision
mechanical conditions supporting decision's empty-or-complete replacement rule,
not an admissibility judgment or broader execution authority.

### A required generation and a verified receipt are mechanical pre-execution conditions

A canonical record whose launcher-authenticated proof posture reads
`classification: "standard"` and `controlled_contract.required: true` is in the
mechanical required-generation population. For that population, resolving no
generation is a typed pre-execution refusal
(`agent_launch.worktree_provisioning_dispatch.controlled_contract_generation_required_absent.v1`)
rather than a no-op: managed implementation dispatch refuses before WK-tip
rebind, record snapshotting, slice allocation, attempt recording, executor
invocation, child creation, and worker-visible composition. A documentation-only
or explicitly exempt record keeps its recorded exemption and is never promoted
into the population. The record that decides this is read from the launcher-owned
repository path alone; an absent, non-regular, or malformed record refuses with
`agent_launch.worktree_provisioning_dispatch.controlled_contract_record_unreadable.v1`
rather than being treated as unrequired.

Every persistence return crosses the primitive-owned verifier. Managed dispatch
passes whatever the persistence operation returns — the default implementation
and any launcher-test-injected implementation alike — through
`admitVerifiedReceipt` in
`packages/agent-launch-cli/src/lib/controlled-carrier-attachment-primitive.mjs`,
which is the single owner of the
`controlled-contract-generation-persistence-receipt.v1` grammar and of
authoritative-generation verification. It checks the complete receipt against
the launcher-bound generation and re-reads the exact carrier bytes from the
object graph the authoritative WK ref actually reaches; the verifier is not
itself injectable, so no dependency override, caller request, prompt,
environment value, accepted dispatch response, or worker result can mint,
replace, select, or waive the required generation or its receipt. Only after
admission does the WK tip rebind to the receipt's `final_tip`, and the existing
exact persistent-ref/worktree/binding coherence proof then runs under the per-WK
lock, so ref movement between admission and that proof refuses.

A successfully persisted generation stays on the WK ref. When a later
provisioning stage refuses, the generation-persistence commit is intentionally
retained: it establishes the complete current canonical generation the ref is
required to carry, and compensation rolls back only slice resources, owned
record-snapshot advances, and attempt bindings.

These are mechanical execution conditions and nothing more. They are distinct
from proof readiness, from CCE policy, from the exceptional direct recovery
persistence route, and from any post-run inference about what a worker did.
Persistence timing itself is not restated here: see [MCP integration ›
Controlled-contract generation-persistence
lifecycle](mcp-integration.md#controlled-contract-generation-persistence-lifecycle).

### The canonical initiative and parent review status gate dispatch

Canonical text: [Launch and admission › The canonical initiative and parent
review status gate dispatch](mcp-dispatch-launch-and-admission.md#the-canonical-initiative-and-parent-review-status-gate-dispatch).

## Orphaned and ahead slice tips refuse before mutation

Canonical text: [Launch and admission › Orphaned and ahead slice tips refuse
before
mutation](mcp-dispatch-launch-and-admission.md#orphaned-and-ahead-slice-tips-refuse-before-mutation).

### Declared unit dependencies are authenticated conjunctively

Canonical text: [Launch and admission › Declared unit dependencies are
authenticated
conjunctively](mcp-dispatch-launch-and-admission.md#declared-unit-dependencies-are-authenticated-conjunctively).

## Durable managed-run process identity

Canonical text: [Managed run lifecycle › Durable managed-run process
identity](mcp-dispatch-managed-run-lifecycle.md#durable-managed-run-process-identity).

### Subject-addressed restart convergence

Canonical text: [Managed run lifecycle › Subject-addressed restart
convergence](mcp-dispatch-managed-run-lifecycle.md#subject-addressed-restart-convergence).

### Process-local monitoring versus restart-stable receipt authority

Canonical text: [Managed run lifecycle › Process-local monitoring versus
restart-stable receipt
authority](mcp-dispatch-managed-run-lifecycle.md#process-local-monitoring-versus-restart-stable-receipt-authority).

## The authenticated per-attempt terminal review contract

Canonical text: [Terminal review › The authenticated per-attempt terminal review
contract](mcp-dispatch-terminal-review.md#the-authenticated-per-attempt-terminal-review-contract).

## Active managed composition precedes dispatch and child creation

Canonical text: [Terminal review › Active managed composition precedes dispatch
and child
creation](mcp-dispatch-terminal-review.md#active-managed-composition-precedes-dispatch-and-child-creation).

## Lifecycle compatibility precedes confined child spawn or MCP forwarding

Canonical text: [Terminal review › Lifecycle compatibility precedes confined
child spawn or MCP
forwarding](mcp-dispatch-terminal-review.md#lifecycle-compatibility-precedes-confined-child-spawn-or-mcp-forwarding).

## Post-spawn conduit failure is a terminal run outcome

Canonical text: [Terminal review › Post-spawn conduit failure is a terminal run
outcome](mcp-dispatch-terminal-review.md#post-spawn-conduit-failure-is-a-terminal-run-outcome).

## Cleanup-only terminal failure and reviewer-verdict validity

Canonical text: [Terminal review › Cleanup-only terminal failure and
reviewer-verdict
validity](mcp-dispatch-terminal-review.md#cleanup-only-terminal-failure-and-reviewer-verdict-validity).

## Plural exact-slice review evidence

Canonical text: [Terminal review › Plural exact-slice review
evidence](mcp-dispatch-terminal-review.md#plural-exact-slice-review-evidence).

## Exact-slice review-surface state budget

Canonical text: [Terminal review › Exact-slice review-surface state
budget](mcp-dispatch-terminal-review.md#exact-slice-review-surface-state-budget).

### Bounded postcheck mismatch diagnostics

Canonical text: [Terminal review › Bounded postcheck mismatch
diagnostics](mcp-dispatch-terminal-review.md#bounded-postcheck-mismatch-diagnostics).

## Empty and no-op slice deliveries

Canonical text: [Slice integration › Empty and no-op slice
deliveries](mcp-dispatch-slice-integration.md#empty-and-no-op-slice-deliveries).

### Zero-delta lifecycle recovery

Canonical text: [Slice integration › Zero-delta lifecycle
recovery](mcp-dispatch-slice-integration.md#zero-delta-lifecycle-recovery).

## Managed worker completion and post-commit structured evidence

Canonical text: [Slice integration › Managed worker completion and post-commit
structured
evidence](mcp-dispatch-slice-integration.md#managed-worker-completion-and-post-commit-structured-evidence).

## Monitor-route terminality and lifecycle side effects

Canonical text: [Monitoring and ownership › Monitor-route terminality and
lifecycle side
effects](mcp-dispatch-monitoring-and-ownership.md#monitor-route-terminality-and-lifecycle-side-effects).

## Wiki-MCP boundary

Canonical text: [Monitoring and ownership › Wiki-MCP
boundary](mcp-dispatch-monitoring-and-ownership.md#wiki-mcp-boundary).

## Trusted operation ownership

Canonical text: [Monitoring and ownership › Trusted operation
ownership](mcp-dispatch-monitoring-and-ownership.md#trusted-operation-ownership).

## Server readiness and process-invariant fail-stop

The wiki-MCP server's readiness is **the shutdown controller's phase, and
nothing else**: the server is ready exactly while
`createStdioShutdownController`'s `phase === "running"`. `packages/wiki-mcp/src/server.mjs`
is the single composition root that builds the one production
`createDiagnosticSink` and the one `createStdioShutdownController` and injects
both into `installProcessErrorGuards`. Both factories already existed; nothing in
production constructed them, so the process guards had no terminal path and
simply logged that they were keeping the process alive.

**Handler-scoped throws are unchanged and stay contained.** A tool handler that
throws is caught by the registered MCP operation boundary, returned as an error
result, and the transport stays open. Only a PROCESS-LEVEL invariant escape —
`uncaughtException` or `unhandledRejection`, which fire only when an error
escaped every registered owner — enters the fail-stop path.

On such an escape the guard performs exactly this sequence:

1. **Emit** the attributable terminal diagnostic through the single production
   sink while it is still active.
2. **Preserve the boolean publication outcome.** A sink that is already
   unavailable returns `false`; that `false` is recorded and reported on the
   structured log entry as `diagnostic_published`, never silently treated as a
   successful publication.
3. **Disable diagnostics.** Disabled is terminal — a later escape does not
   resurrect the sink, and reports its own publication as unavailable.
4. **Call `requestShutdown(1)`.**

`requestShutdown(1)` moves the controller's phase out of `running`
**synchronously**, and that phase change *is* the readiness revocation. It then
invokes the server cleanup hook — `server.close()`, registered through
`setServerCloseHook` — so the server stops accepting work, and the controller's
existing `closeTimeoutMs` drain of at most two seconds is the accepted fail-stop
window before its closure-private `terminateOnce` owner performs the single
terminal action. Fail-stop proceeds whether or not the diagnostic could be
published.

Every server shutdown endpoint routes through that one controller. The
launcher-readiness writer's `onFailure` and `onCleanupTimeout` request shutdown
instead of closing the server and setting an exit code themselves, and the
separate `stdin` end listener that used to close the server in parallel with the
controller's own stdin listeners is gone: the controller already observes stdin
`end`/`close`/`error` and stdout `close`/`error`, and the cleanup hook is what it
runs for all of them. The server creates no exit path, cleanup timer, readiness
oracle, supervisor, signal policy, launcher outcome, or attribution vocabulary of
its own, and `terminateOnce` is never exported.

`packages/agent-launch-cli/src/lib/launch-isolation-spawn.mjs` remains the sole
owner of launcher supervision, client readiness, termination attribution, and the
outcome record. This contract changes what the SERVER does when its own
invariants escape; the launcher classifies the resulting termination exactly as
it already did, and that module is unmodified.

## Already-integrated restart finalization and cross-backend integration continuation

This section owns how a committed exact-slice delivery either crosses the trusted
integration boundary for the first time or is proven to have already crossed it.
It builds on [Slice integration › Zero-delta lifecycle
recovery](mcp-dispatch-slice-integration.md#zero-delta-lifecycle-recovery), which
owns durable integration-result reconstruction, and on [Managed run lifecycle ›
Process-local monitoring versus restart-stable receipt
authority](mcp-dispatch-managed-run-lifecycle.md#process-local-monitoring-versus-restart-stable-receipt-authority),
which owns the process-local/durable split. Four runtime cases are distinct and
are never interchangeable.

### Fresh integration

A newly reviewed committed delivery crosses the boundary normally. The
coordinator-owned integration request resolves the canonical integration unit,
asks the durable zero-delta recovery question first, and only when that answers
"nothing is integrated" admits the exact committed target, resolves the
configured CCE policy boundary (or the explicit free-substrate posture), and
invokes the integration primitive. That primitive owns the expected-old WK-ref
compare-and-swap and the compound canonical-record CAS. Concurrent requests for
one exact target converge on a single in-flight attempt and its retained result.

The trusted-runtime managed-worker integration path reaches the same primitive
through the writable host boundary and adds two steps of its own: the
fresh-integration slice-base admission, evaluated before any mutation, and its
managed-worker exact-slice cleanup, performed after a successful fresh
integration. Both belong to that path alone — a successful direct coordinator
integration request does not itself reap a managed worker's retained checkout,
and no already-integrated recovery path performs either step. Fresh integration
is not the recovery of an integration already proven complete, and neither
substitutes for the other.

All live committed-slice history decisions use the authorization core's single
`boundedWkLifecycleObservation`. The immutable observation is bound to canonical
repository, initiative and WK identity, exact WK tip, the launcher-owned fixed WK
fork, the complete selected canonical contract generation, and the canonical
record source digest. Complete contract generation is authority-bearing contract
identity; record digest is coordination identity only and never substitutes for
it. The marker and zero-delta projections traverse no history of their own, and
backend provisioning consumes the same marker projection for replay-equivalent
dependency evidence.

Reuse ends with the exact operation phase. Delivery, a concurrency-loser
reauthentication, durable recovery, later fresh integration, each record-CAS
attempt, and each new integration transaction all construct distinct
observations; WK-tip, fixed-fork, contract-generation, or record-digest movement
also invalidates the phase. Delivery and recovery retain
`ZERO_DELTA_EVIDENCE_INDETERMINATE`, final-sibling indeterminacy remains
incomplete/`false`, and provisioning retains `admitted: false` with
`replay_marker_indeterminate`. These are mechanical decision boundaries. The
fixed fork is the sole history floor, and successful work is proportional only
to post-fork commits plus relevant candidates—not pre-fork repository age or the
number of completed siblings. See [Committed-slice integration](mcp-dispatch-slice-integration.md#one-fixed-fork-post-fork-observation-serves-every-live-consumer).

### Already-integrated monitor restart recovery

When process-local monitor state is gone, launcher-owned durable evidence can
still prove that the exact delivery already integrated. Recovery authenticates
the exact retained worker tuple (run id, launch/monitor ref, retry id, and the
unique launcher-owned slice and WK binding pair), the canonical subject, the
exact slice ref and its retained delivery, the durable integration marker or
zero-delta evidence commit, the current WK ref and tip, and the canonical
post-integration lifecycle state of the slice and its parent.

Once proved, recovery never replays integration, never advances the slice or WK
ref, never rewrites the canonical record or any launcher binding, and never
launches a replacement worker or reviewer. The only boundary it may enter is the
authenticated, idempotent cleanup-confirmation boundary, whose whole job is to
re-prove the read-only recovered result against the live repository — exact slice
and WK refs, canonical commit ids, the current WK tip against the proven marker
state, the retained delivery, and retention of the launch-frozen fixed fork in
that tip — and then report the exact-slice checkout disposition. Its only
filesystem access is a single non-following `lstat`, so it is idempotent across
concurrent observers and any number of further restarts. The closed disposition
vocabulary is `not_required` (checkout still present) and `confirmed_released`
(checkout absent, the expected terminal outcome of the clause 5(a) reap), both
reported with `cleanup_only: true` and never with an integration-time reap. An
integration-time disposition on this branch is a replay and refuses with
`agent_launch.slice_lifecycle.recovered_integration_replayed.v1`; a checkout that
cannot be observed at all (a permission or I/O fault, never `ENOENT`) refuses with
`agent_launch.slice_integration.integrated_cleanup_uncertain.v1` rather than
laundering uncertainty into success.

The authenticated `integrated_state` discriminator decides what happens next, and
it is the only fact that has read canonical parent posture together with tip
ownership. `non_final` finalizes the exact-slice lifecycle without resolving a
terminal whole-WK review unit: no review unit is resolved, no candidate is
prepared, no review context is bound, and nothing is launched. `final` retains the
exact terminal whole-WK review contract and continues toward candidate
construction. **Exact-tip equality alone grants no terminal authority** — a
recovered result with a null review target whose marker is the current WK tip is
equally the shape of an ordinary non-final slice on a WK with outstanding
implementation slices. A discriminator that is absent at that junction,
unrecognized, `final` without current-tip ownership, or `non_final` while carrying
a whole-WK review target refuses with
`agent_launch.slice_lifecycle.recovered_integrated_state_invalid.v1` (reasons
`absent_integrated_state`, `unrecognized_integrated_state`,
`final_without_current_wk_tip_ownership`, `non_final_with_whole_wk_review_target`).

### Known-run cross-backend continuation

After Backend A completes integration, Backend B may continue an existing known
monitor only by reconstructing the complete durable continuation authority. That
authority is a join, and every element is required: the canonical repository and
subject; the exact worker run id, launch/monitor ref, and retry identity from the
unique launcher-owned binding pair; work record's unique zero-delta integration
evidence; the exact V3 exact-slice review receipt; the reviewed delivery and its
authenticated delivery base; the integration base and integration result; the
exact slice and WK refs with their live tips; and the current canonical
post-integration contract. The resulting authority is branded with a
non-enumerable module-local symbol, so no caller-shaped object, monitor handle,
status projection, or receipt can impersonate it, and the lifecycle rechecks exact
target equality when it installs it — a mismatch refuses with
`agent_launch.slice_lifecycle.integration_continuation_mismatch.v1`. A consumed
continuation installs the completed integration result directly; no host adapter,
fresh admission, cleanup-only re-entry, or ref-mutating operation runs.

Process-local continuation maps are an optimization only. They are consulted
first when a frozen review context for the exact target exists, they must
authenticate the same exact worker tuple (subject, run id, monitor handle) before
their retained result is used, and they are never restart authority.

Reconciliation against canonical state is doubled. The accepted V3 receipt's
frozen contract is reconciled with current canonical state before the live-ref and
confirming-evidence reads, and again after them, and the immutable evidence
classifier is re-run and required to agree field for field. Authored canonical
movement or ref movement inside that lookup window therefore refuses instead of
being branded as the completed continuation. Movement later in the cycle remains
covered by the terminal-review live-contract checks and the final pre-spawn
verification.

### Cold unknown-handle continuation

When Backend B does not know the monitor handle process-locally, the registered
unknown-handle recovery path may recover the original durable run and authenticate
the same complete continuation during the pre-integration phase, before the
cleanup-only confirmation. The recovery route receives the same launcher-owned
continuation resolver an ordinary known monitor receives; the reconstructed status
is a selector and cross-check, never authority.

A genuinely unknown handle with no mechanically recoverable durable run and no
such authority remains `monitor_handle_unknown`. That answer is correct, not
degraded. A recovery that instead failed for a specific reason reports that cause
rather than being laundered into the handle-level refusal. The vanished handle,
caller input, canonical status, the parent review unit, prose, `agent_notes`, and a
review receipt by itself are never continuation authority on their own.

### Fail-closed continuation refusals

Missing, malformed, stale, superseded, duplicate, contradictory, ambiguous,
repair-required, and mixed-time evidence all refuse without mutation and without
replaying integration. Continuation refusals carry the stable code
`agent_launch.slice_integration.continuation_authority_refused.v1` with a closed
reason, including:

- `warm_worker_tuple_mismatch` — a process-local completed integration exists but
  the presented worker tuple is not the one that produced it;
- `worker_status_selector_mismatch`, `durable_worker_binding_invalid`,
  `durable_worker_tuple_mismatch`, `durable_worker_ref_mismatch` — the durable
  binding pair is unresolvable or does not name the exact run, retry, unit, or
  refs;
- `exact_v3_review_receipt_unavailable`, `exact_v3_review_receipt_missing`,
  `exact_v3_review_receipt_ambiguous` — the receipt store is unusable, or the
  complete exact-target V3 match count is not exactly one;
- `reviewed_delivery_base_mismatch` — the authenticated delivery base disagrees
  with the binding's frozen base;
- `canonical_record_contract_disagreement`,
  `canonical_record_identity_disagreement`, `canonical_record_corrective_state`,
  `canonical_record_lifecycle_state_disagreement` — the frozen receipt contract
  and current canonical record do not describe the same unit, posture, or
  lifecycle state;
- `canonical_record_repair_required` — continuation is read-only and refuses
  rather than performing a canonical record write;
- `live_slice_ref_unavailable`, `live_wk_ref_unavailable`, `live_ref_disagreement`,
  `continuation_authority_changed_during_lookup` — a live ref is unreadable, or
  refs or evidence moved during the joined lookup.

Not every refusal is operator-repairable. A refusal here is not an instruction to
delete evidence, rewrite refs, edit statuses, retry integration, or rematerialize
historical authority; a unit whose authority genuinely never existed stays refused
until legitimate authority exists.

### Authority-limb refusal result

An operation covered by the work record authority-separation contract that refuses
locally returns exactly four top-level fields:

```json
{
  "code": "mechanical_failure",
  "severity": "blocking",
  "message": "operation refused: authority_limb={authority_limb}; next_action={next_action}",
  "payload": {
    "schema_version": "typed-refusal-payload-authority-limb-and-next-action-v1",
    "authority_limb": "mechanical_failure",
    "next_action": "<exact executable coordinator action>"
  }
}
```

`code` and `payload.authority_limb` use the same closed two-value enum:
`mechanical_failure` or `exact_returned_policy`. `severity` is exactly
`blocking`, and `message` uses exactly the template shown above. The payload's
`next_action` names the executable coordinator action for that exact refusal;
it is not a generic operator-recovery placeholder. Review presence, absence,
status, findings, or reviewer output is neither enum member and cannot be
encoded as an authority limb.

### Terminal review target versus terminal candidate

The frozen `B..W` whole-WK review target is the terminal review **target**. It is
not terminal candidate `C`. Authenticated continuation precedes deterministic
candidate construction and never replaces it: candidate construction still creates
and verifies exactly one `C` whose sole parent is `B` and for which
`tree(C) === tree(W)`, and the findings-only review runs `B..C` from the private
detached checkout. Continuation evidence cannot substitute for candidate
authority, and a `final` continuation authorizes reaching candidate construction,
not skipping it.

### work record prerequisite

Zero-delta recovery depends on work record's unique, mechanically recoverable exact
integration evidence. Multiple complete matches always refuse. Zero complete
matches are answered against the retained delivery first: a delivery that is not
a genuine zero-delta child recovers nothing rather than refusing, and continues
on the ordinary fresh admission path. For a genuine zero-delta child, zero
matches refuse whenever canonical lifecycle state would require that evidence — a
done or cancelled slice, or a parent in `review` or `done` — and every other
status is inadmissible; only a slice in `review` under a preterminal parent means
nothing was recovered and proceeds to fresh admission. work record consumes that
evidence and does not synthesize, repair, or rematerialize missing historical
evidence; caller assertions, status edits, prose, retries, and ref rewriting
never stand in for it. It does not restate or repair work record's producer
invariants, and symbolic-ref remediation is owned elsewhere.

## Dispatch-readiness generated write surface

Graph-index refresh may use the fixed eight exclusively claimed candidate names
`.index.json.build-lock.json.slot-00.candidate` through
`.index.json.build-lock.json.slot-07.candidate`. An existing persistent shared lock
prevents candidate attempts; slot exhaustion falls back to an independent
atomic build. Candidate files are retained but never reused or authoritative.

## Findings-role completion credential authority

Completion transport is runtime-bound and launcher-owned. The launch lifecycle
classifies it once through `classifyLauncherFindingsCompletionTransport`
(`workspace-agent-role-contract.mjs`, the sole semantic route classifier) from
the launcher-minted canonical-repository signal, mints exactly one
`launcher-stdio-mcp-completion-credential.v2` credential from that result, and
carries it to the family executor as an internal planning carrier. Prompt text,
caller input, child output, reviewer-selected modes, and ambient environment
never participate.

v2 is the only accepted schema. Its frozen envelope is exactly `schema_version`,
`completion_transport`, `canonical_repository`, `assigned_unit`, and the
launcher-derived `technical_role`. `technical_role` binds the credential to the
role the launcher actually admitted, so a reviewer, redteam, exact-slice, and
terminal whole-WK route sharing a repository, unit, and transport can no longer
be silently interchanged. An unsupported schema — including an authentic
four-field v1 envelope — is classified before the v2 field inventory is applied
and fails as `credential_schema_mismatch`, never `credential_malformed`.

`stdio-mcp-conduit-core.mjs` is the sole minter, sole authenticator, and sole
refusal owner. `mintStdioMcpCompletionCredential` and
`authenticateStdioMcpCompletionCredential` are distinct exported operations; a
facade that aliased one to the other would re-derive a credential from facts
already trusted and authenticate nothing. Claude and Codex modules are
mechanical consumers: they choose the expected facts their route completes
against, delegate authentication, and project only the authenticated
credential's own fields into the conduit input.

Every credential failure — absence, malformed input or unusable schema version,
unsupported schema, and transport, canonical-repository, assigned-unit, or
technical-role mismatch — is a pre-spawn `stdio_mcp_conduit_input_invalid`
refusal that names the exact failed fact as a stable `mismatch_class` and states
its supported recovery. It happens before the conduit is constructed, so no
child, transport, or host server exists, and it is never relabelled as an absent
or unconfigured family backend.

Credential authentication grants no completion, write, integration, or checkout
authority. It only proves that the transported projection matches the run the
launcher admitted; completion transport itself remains runtime-bound, and a role
may use only the transport its runtime exposes.

Coverage is proved as one table over the registered family inventory
(`STDIO_MCP_CONDUIT_ALLOWED_FAMILIES`) and the registered findings routes —
standalone reviewer, exact-slice reviewer, redteam, terminal whole-WK reviewer —
giving eight Claude/Codex rows, each entering its family's real production
boundary. The table binds the `work record` finding
`work record-S020-R1-F001`: deleting a family executor's credential forwarding must
surface as `credential_absent` with zero conduit calls. A newly supported family
or registered findings route must add explicit credential-forwarding coverage or
the table fails. Detailed mechanism lives in
[Agent-launch confinement and MCP conduit](agent-launch-confinement-mcp-conduit.md).

## Unified post-worker lifecycle authority

`runPostWorkerSliceLifecycleBody` is the sole semantic composer after a worker
terminates. It decides phase, terminality, continuation, `next_action`, recovery
action, and whether finalized delivery still has cleanup pending. Collaborators
authenticate facts or execute closed mechanical operations; they do not derive a
second semantic result.

The composer accepts integration authority only from an exact free-substrate
`not_gated` boundary, an exact ratified and attested CCE decision for every
configured gate, or an exact authenticated operator authorization bound to the
action, subject, current controlled generation, and scope. Generic operator
configuration, paid-tier status, historical lifecycle state, review status, and
review merits grant no capability. Launcher-local `policy_only` reviewerless
completion is not supported.

Reviewer results are plural, immutable, exact-target advisory history. Clean and
findings-bearing results expose the same integration and publication operations;
findings may require disposition, but neither findings nor their disposition grant
or veto those operations. Terminal reviewer history is projected before current
applicability is assessed, so an applicability conflict cannot erase completed
history, invalidate an integrated delivery, or authorize a replacement reviewer.

## Advisory review evidence and lifecycle posture

A completed findings-only action records an occurred review even when no
historical target annotation, clean attestation, receipt, or provenance record is
available. Those records may remain useful descriptive evidence, but none is a
prerequisite for recognizing the occurrence or for a later lifecycle operation.
No missing metadata triggers replay, replacement, settlement, election,
recovery, or retroactive repair.

Review outcomes remain plural and distinguishable. Clean, severe, malformed,
absent, and execution-failed outcomes are preserved for coordinator judgment and
disposition. They do not mechanically change WK or slice status, admit or refuse
implementation, integration, forge, or completion, authorize another review, or
invalidate an independently completed review occurrence. The lifecycle posture
is therefore identical across result shapes; only the advisory evidence differs.

## Crash-durable state substrate

work record promotes one shared crash-durable publication-and-lock substrate into
`packages/wiki-core/src/lib/crash-durable-state.mjs` and routes the authoritative
launcher stores through it. The substrate is a mechanical filesystem helper: it
owns one immutable transition plan, one state machine, a closed fault-boundary
vocabulary, and two thin interpreters (sync and async) over that same plan. It
owns no persisted meaning — bytes, paths, filenames, schemas, conflict rules,
receipt and identity semantics, and retry policy all remain with the calling
store.

**Publication.** One closed protocol: create a same-directory private path
exclusively, write the complete caller-owned bytes, fsync the file, atomically
rename onto the target, fsync the parent directory. No authoritative target is
modified in place, so a torn private tail cannot corrupt the prior durable
result. A logical append is the same protocol applied to prior-plus-new bytes;
physical in-place append is not used because it cannot satisfy the crash
invariant, while append ordering and resulting bytes are preserved.

**Preserved authoritative payloads.** Every authoritative store keeps its
established path, filename derivation, mode, schema, serialized bytes, and
successful read result. The canonical work record still takes the process umask
rather than the substrate default, and the differential corpus in
`tests/unit/crash-durable-state-compat.test.mjs` is what holds that line.

**Liveness.** `packages/agent-launch-cli/src/lib/worktree-lease.mjs` is the SOLE
launcher process-identity and live/dead/indeterminate oracle for in-scope
durable-state abandonment. Identity is the non-reusable `(pid, starttime,
boot_id)` triple. Bare `process.kill(pid, 0)`, elapsed wall-clock age, ownerless
state, and unlink-by-path recovery are removed: none of them is proof of death,
and PID reuse cannot establish it. Missing, malformed, unavailable, and
indeterminate evidence all fail closed and never authorize reclamation.
`tests/integration/crash-durable-state-liveness.test.mjs` enforces this as a
deny-by-default inventory keyed on exact source identities.

**Token-lock artifact migration.** Lock artifacts are the one limb explicitly
authorized to change shape. They migrate from legacy regular files and ownerless
directories to a token-owned directory carrying an immutable owner entry with the
exact owner token and the persisted non-reusable claimant identity. Retirement is
two transitions: the single-winner claim renames the owner entry to a
claimant-token marker, and only the subsequent rename of the whole still-nonempty
canonical directory to a unique token-bound sibling tombstone frees the canonical
name. Cleanup addresses only that tombstone. Legacy shapes are recognized
deterministically and are never inherited or reclaimed. Note that POSIX `rename`
replaces an existing EMPTY directory, so every migrated acquirer fails closed on
any pre-existing state at the canonical name rather than silently adopting a
legacy ownerless lock.

The repository-wide work-record lock is token-owned and reclaims ONLY on proof of
death. Its acquirer first captures a non-reusable process identity — the triple
`(pid, starttime, boot_id)`, where `starttime` is field 22 of `/proc/<pid>/stat`
and a changed `boot_id` means the machine rebooted — and persists it as the lock's
`owner_identity` in the immutable owner entry. The owner token embeds the same
triple, so the retirement marker and tombstone bound to a token also carry their
claimant's identity in their own names. Both are minted once and are immutable for
the lifetime of that ownership generation.

That capture-and-compare mechanism lives in
`packages/wiki-core/src/lib/process-identity.mjs`, which is the single `/proc`
parser in the repository. `worktree-lease.mjs` delegates its identity and liveness
primitives to it and remains the sole launcher-facing liveness ORACLE — the place
where launcher abandonment policy is decided. Because `agent-launch-cli` already
depends on `wiki-core`, this adds no package, no dependency edge, and no cycle,
and `wiki-core` still never imports `agent-launch-cli`.

**Dead-verdict authority.** A holder is retired only when all of the following
hold: the on-disk shape is token-owned; the persisted `owner_identity` parses as a
non-reusable triple; `assessProcessLiveness` returns `dead` for exactly that
triple; and the substrate's `decideRetirement` agrees, which additionally refuses
to let a token retire its own lock and refuses when the persisted identity moved
between being judged and being acted on. A `dead` verdict comes only from positive
evidence — a changed `boot_id`, an absent `/proc/<pid>` while `/proc` is readable,
or a `starttime` mismatch proving the pid was recycled. Retirement remains
single-winner and token-owned: the canonical name is freed only by the existing
whole-directory tombstone transition, and cleanup addresses only the claimant's own
tombstone, never the canonical path.

**Indeterminate behavior.** Elapsed time, file age, path existence, ownerless
state, malformed state, a bare pid, PID-namespace incomparability, missing or
unparseable identity evidence, an unsupported platform, and permission refusal are
all INDETERMINATE, never dead. `process.kill(pid, 0)` is not a death proof and is
used nowhere on this path. Live and indeterminate holders stay occupied, every
legacy regular-file, ownerless-directory, and malformed shape is still recognized
deterministically and never adopted or unlinked by path, and exhaustion still
raises the stable `work_record_write_lock_unavailable` operator-recovery
diagnostic. That diagnostic now also carries `liveness_reason`, naming why death
could not be proven, which is the fact an operator needs before removing a lock by
hand.

**Claimant transfer.** A claimant that dies between renaming the owner entry and
moving the canonical directory leaves the directory present but empty plus a
sibling marker naming it. The next contender completes that interrupted retirement
ONLY after the crashed claimant's persisted non-reusable identity is
authoritatively dead; this is not ownerless-directory adoption, and an empty
canonical directory with no provably dead claimant marker is still failed closed.

**Supported-platform posture.** The mechanism requires a readable Linux `/proc`.
Where a non-reusable identity cannot be captured, acquisition FAILS CLOSED with the
typed `work_record_write_lock_identity_unavailable` diagnostic rather than silently
downgrading to a reusable pid or a wall-clock lease, because an unsound identity
would make every later death verdict unsound.

**Operator recovery when proof is unavailable.** When the lock is held by an
identity this store cannot judge — a pre-repair lock carrying a legacy
`owner_identity`, a legacy regular-file lock, an ownerless or malformed directory,
or a host without `/proc` — no automatic recovery is possible by design. The
operator reads `lock_state` and `liveness_reason` from the diagnostic, confirms no
live writer remains, and removes the lock path by hand. That manual step is the
only supported route for those states, and it is deliberately not automated.

**Reaper-audit envelope.** `.agent-launch/worktree-reaper-audit/reaper-audit.jsonl`
stays path- and byte-compatible JSONL, but each logical append is a serialized
copy-on-write replacement of the full image, which makes every append O(n) in
current image bytes. The supported envelope is 16 MiB. Truncation and rotation are
forbidden: an append that would cross the envelope fails closed and the complete
prior image is preserved for the operator.

**Accepted limitation.** Whole-checkout deletion is out of scope and unproven. No
in-tree mechanism claims to survive or detect `git clean -xd`, deletion of the
primary checkout, or loss of its filesystem. Any such guarantee would require a
separately authorized external preservation anchor, which this work does not add.
## Immutable findings snapshots (decision, work record)

Every authenticated findings-only action whose effective `write_scope` is empty
uses the launcher-owned immutable snapshot path, including standalone findings,
exact-slice review, and terminal whole-WK review. The owner resolves an
authenticated source once, atomically captures the canonical record, every
selected carrier manifest, descriptor, and complete generation, verifies their
final byte digests, and materializes one detached commit/tree. It never allocates,
adopts, reads, persists, or advances a persistent WK lifecycle. Only nonempty
implementation scope retains WK allocation, controlled-generation persistence,
and ref compare-and-swap.

Every action authenticates its own selected snapshot record and generation;
mutable `main` cannot upgrade or veto an already-started action. The registered
mechanical failures are
`agent_launch.findings_snapshot.canonical_unit_mutation_authority_invalid.v1`,
`agent_launch.findings_snapshot.review_source_unresolvable.v1`,
`agent_launch.findings_snapshot.materialization_failed.v1`, and
`agent_launch.findings_snapshot.controlled_contract_generation_required_absent.v1`;
exact-range normalization additionally owns
`agent_launch.review_target_resolution.failed.v1`.
They have no findings-action recovery route and are never projected as
`managed_lifecycle_required`.

For a canonical design review, Git still owns repository code/object identity:
the detached checkout is created from the selected commit and contains no ambient
dirty or untracked files. Before execution, the snapshot owner captures the current
canonical WK bytes plus exactly the controlled-contract/proof carriers selected by
the canonical carrier-set resolver and projects only those captured files over their
canonical paths in the action-private checkout. The projection is immutable for the
action and does not require those design files to be committed. Direct filesystem
reads, the frozen acceptance contract, and `workspace_read_page` therefore observe
the same captured generation; the prompt points both Codex and Claude at that frozen
read route. A later host edit cannot move an active action, while a fresh dispatch
captures the later bytes. Missing, malformed, or capture-time-moved selected input
refuses before conduit construction or spawn. Explicit SHA-range implementation
review and terminal-candidate materialization do not use this design overlay.

Immutable findings dependency projection is launcher-owned execution substrate.
Fresh standalone and normalized commit-range materialization uses the same optional
selector as exact-slice and terminal findings and binds a selected projection read-only
at the exact snapshot `node_modules`. Each fresh action independently authenticates
selection, enumerated unavailability, projection identity, installation digest,
retained root, mount destination, and frozen binds. None of those fields selects,
resumes, satisfies, suppresses, or vetoes another action. Receipts may record this
evidence for audit but are not launch prerequisites or continuation authority.

Standalone snapshot execution also binds the package-owned controlled-contract
validator-cache root read-only at the snapshot package's deterministic
`.cache/controlled-contract/validators` location. The existing launcher pre-spawn
warm remains the sole publisher. Before composing that bind, the launcher runs the
package-owned verify path, requires the package-derived root and current toolchain
identity, rejects redirected, non-owned, escaping, or path-substituted backing, and
creates only empty launcher-owned mountpoint ancestors in the detached checkout.
The confined reviewer receives no cache write authority. The snapshot package then
selects and digest-verifies its own exact retained identity from that root, so an
older immutable snapshot can use the artifact published for its bytes while absent,
stale, or unsafe backing still fails closed without a caller root, environment
redirect, fallback cache, dependency install, or canonical-state write. This bind is
execution substrate only: it does not change snapshot commit/tree identity,
controlled-generation identity, dependency-projection evidence, findings authority,
or action identity. Exact-slice and terminal-review launch plans keep their
existing cache and confinement behavior.

### Independent advisory findings attempts

Every accepted findings dispatch mints a fresh `run_id` and `monitor_handle`,
registers them in the owning process before returning an accepted envelope, and
attempts exactly one confined advisory launch. Identical source, contract,
generation, role, purpose, and request bytes still create independent attempts.
An earlier action's receipt, result, failure, metadata, process identity, or
liveness cannot select, resume, replace, retire, suppress, satisfy, veto, or
mechanically refuse the new action.

Status and wait observe the process-local run registry. Once the owning backend
process no longer retains a findings run, its old handle may truthfully be
unknown; retained logs may still be exposed as logs, but no receipt or terminal
artifact reconstructs a current run. A later dispatch always performs a fresh
source authentication, snapshot materialization, execution-substrate
verification, registration, and launch.

Migration-review acknowledgement is historical coordination data, not findings
admission authority. Otherwise-identical acknowledged and unacknowledged
reviewer or redteam units therefore reach the same empty-scope findings route.
The canonical record and source generation still authenticate normally, and the
implementation-worker migration policy remains on the nonempty-scope lifecycle.

### Cross-action findings nonauthority

Findings state is never implementation authority. Receipts, results, provenance,
roles, snapshots, materialization paths, runs, monitors, failures, terminal
projections, retained contexts, lineage, and audit bytes produced by a findings
action cannot admit, suppress, rank, coalesce, replay, replace, retire, recover,
reopen, supersede, resume, seed readiness, supply continuation proof, or refuse a
later findings or implementation action. In particular,
`trusted_corrective_findings_context`, `launcher_exact_review_receipt`, and
`corrective_continuation_proof` are not launcher or worker contract fields.

A nonempty-scope implementation action derives authority only from its current
authenticated write scope, canonical implementation unit, controlled generation,
accumulated implementation tip, launcher-owned delivery binding, and Git ancestry.
An existing slice tip is reusable only when those current implementation facts
authenticate the exact linear launcher delivery chain and retained private
worktree. Findings evidence is neither consulted nor carried to the executor.
Absent, successful, failed, malformed, missing, plural, reordered, superseded, and
legacy terminal-projection findings shapes therefore produce the same admission,
allocation, readiness, executor input, and launch outcome.

Process loss does not turn findings audit evidence into recovery authority. An old
findings handle may return `monitor_handle_unknown`; reissuing dispatch creates and
registers a new independent action. Existing implementation receipt, integration,
CAS, reservation, retirement, and already-integrated cleanup behavior remains owned
by the implementation lifecycle and its current authenticated bindings, never by a
findings receipt or result.

Findings receipts, logs, and outcome artifacts are optional audit evidence.
Their absence or write failure cannot suppress the current run outcome and cannot
affect a later dispatch. They grant no mutation, dispatch, retry, integration,
completion, acceptance, or veto authority. The receipt-store functionality still
owned by implementation and integration consumers remains unchanged.


# MCP dispatch runtime contract

`workspace_agent_dispatch` and its monitor routes are backed by one
launcher-owned in-process runtime. The runtime freezes the selected family,
role, work record or slice, managed worktree binding, read and write authority,
model registration adapter, host wiki-MCP server, named-FIFO conduit, and
lifecycle owner before spawning the role.

## Canonical document map

This page is the canonical entry page for the MCP dispatch runtime contract. Its
normative text is organized across five focused canonical documents. Every
section heading that this page previously carried is retained below as a
compatibility landing point linking to the canonical location of that section.
Two sections are carried canonically on this page rather than on a focused
document: already-integrated restart finalization and cross-backend integration
continuation, and the dispatch-readiness generated write surface.

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
  state budget, and safe postcheck diagnostics.
- [Slice integration](mcp-dispatch-slice-integration.md) — empty and no-op slice
  deliveries, zero-delta lifecycle recovery, and managed worker completion and
  post-commit structured evidence.
- [Monitoring and ownership](mcp-dispatch-monitoring-and-ownership.md) —
  monitor-route terminality, the wiki-MCP boundary, and trusted operation
  ownership.

## Supported families

Canonical text: [Launch and admission › Supported
families](mcp-dispatch-launch-and-admission.md#supported-families).

## Launch and monitoring

Canonical text: [Launch and admission › Launch and
monitoring](mcp-dispatch-launch-and-admission.md#launch-and-monitoring).

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

### Safe postcheck mismatch diagnostics

Canonical text: [Terminal review › Safe postcheck mismatch
diagnostics](mcp-dispatch-terminal-review.md#safe-postcheck-mismatch-diagnostics).

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
fresh-integration slice-base admission, evaluated before any mutation, and the
decision clause 5(a) exact-slice reap, performed after a successful fresh
integration. Both belong to that path alone — a successful direct coordinator
integration request does not itself reap a managed worker's retained checkout,
and no already-integrated recovery path performs either step. Fresh integration
is not the recovery of an integration already proven complete, and neither
substitutes for the other.

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

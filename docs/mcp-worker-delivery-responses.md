# Worker delivery responses

`workspace_deliver_work({})` commits and delivers only the authenticated managed
worker's assignment. Call it after implementing and checking the assigned
behavior, before any separate Git commit. Its existing launcher authentication,
strict request selection, completion arbitration, containment, publication, review
transition, compensation, checkout and receipt owners enforce delivery.
Availability grants no additional authority. Current restrictions on managed
implementation dispatch remain in force.

The live worker answer is distinct from the internal transaction frame and
historical result observations. A successful response contains `outcome:
"delivered"`, the instruction to emit `agent-role-result.v1` diagnostic evidence
in the launcher's required format and terminate, and no further calls. A
successful zero-delta delivery has the same terminal behavior. A successful
repeat adds `acknowledgment: "already_delivered"`: it recovered the retained
delivery and did not commit later edits. Diagnostic
evidence and process termination create no delivery, integration or canonical
completion authority. Delivery executes no tests or proofs.

Failure answers state the subject, deciding stage, specific diagnostics and
material independent effects. A known selected commit identifies surviving
partial delivery; its base binding stays with the authenticated coordinator
reader. Healthy measurements, Git plumbing, receipt
authentication, storage and transport bookkeeping are absent from the worker
answer. No optional reader is required to complete a successful delivery or to
discover the deciding failure.

Scope refusals name the offending paths and path-kind restrictions. A candidate
object can exist even though publication and review were not attempted. The
worker corrects only authorized accidental changes and rechecks affected
behavior before choosing the returned delivery request. A genuine missing or
contradictory assignment prerequisite instead requires an authored
`request_assignment_change` handoff, when its completion owner permits it. No
testimony or scope-widening authority is inferred from a refusal. Accepted
assignment change immediately ends the worker with no final report or later
call. Foreign request fields are never silently discarded to select delivery.

A failed materialization, scope check or publication can permit focused
correction when the transaction owner establishes no publication and no review
attempt. An exact reverse CAS after a review refusal also permits correction
only when the exact unit's status writer confirms no canonical write. The
server releases only this invocation's completion claim through the existing
completion owner. This is not completion, cancellation or assignment revision.
Created or uncertain immutable object effects remain reported separately.

After that release is established, the worker receives a conditional empty
delivery request: correct the specific cause within existing authority and
recheck affected behavior before choosing it. A genuine assignment gap can
instead use `request_assignment_change` with caller-authored testimony; no
handoff fields or choices are invented. Missing testimony establishes no
acceptance. Both completion alternatives use the same authenticated binding.

Unknown publication, an unconfirmed canonical write, failed compensation,
pre-existing delivery and completed delivery keep their completion protection.
A release failure preserves both the transaction cause and release failure.
When the retained original binds that invocation's exact intent and establishes
the required non-publication or compensation facts, the worker receives
`workspace_deliver_work({reconcile: {ref_id}})` with an issued selection. After
the reported release cause is corrected within existing authority, this call
authenticates that exact original and reconciles through the completion owner
under its existing partition lock. Clearing a lock alone establishes no release
authority. The request executes no materialization, publication, review
submission, checkout finalization or receipt publication. A failed transaction
never becomes a successful receipt.

Successful reconciliation reports `outcome: "completion_restored"`, preserving
the historical transaction's specific cause, object identity and effects. It
returns the conditional empty delivery request after correcting the original
cause, or permits a genuine caller-authored assignment-change choice. It does
not report delivered work or require a final result. Repeating that exact
reconciliation is idempotent while no competing completion or terminal state
has intervened. A persistent partition contention reports the current failure
and returns only the same conditional reconciliation; neither completion
alternative can proceed before reconciliation succeeds.

An ordinary delivery retry or a refused authored assignment-change request can
select the same authenticated failed-release original without replaying effects.
These observations do not release the claim. Missing, ambiguous, unavailable or
unproven transaction evidence stops recovery, as do owner/binding mismatch,
integrity refusal, a competing completion and terminal state. Originals without
an explicit invocation-intent binding cannot authorize release. Other journal
failures retain their specific cause and uncertainty without a blind retry.
An unknown candidate object alone does not imply unknown publication or review.

A pending worker checkout leaves the commit and review submission intact. After
the specific cause is corrected within the worker's authority, the returned
empty request recovers the retained delivery's checkout and any receipt residue
without another commit, ref movement or review submission. A superseded checkout
has no same-delivery checkout repair. Receipt-publication failure also preserves
commit and review; the worker answer is partial and identifies the remaining
receipt publication and any pending checkout. Its returned request recovers the
retained delivery, including an append that succeeded before its acknowledgment
failed. It is not a request to redeliver changed work.

Original serialization or retention failure preserves settled effects but gives
no blind delivery retry. An unavailable recovery inventory reports prior effects
as unresolved, separately stating that this invocation started no new commit
transaction. It cannot revoke an earlier acknowledgment or prove no delivery.
Consumed completion, a terminal attempt, and an unresolved delivery intent have
specific stopping instructions; no worker-created successor, authority refresh,
filesystem rescue, integrity check or manual ref repair is supplied. Where no
callable recovery exists, the worker reports the exact limitation without
claiming `completed`.

Completion stopping instructions come only from the binding resolver's explicit
failed-operation cause. A code quoted in testimony, nested diagnostic content or
another failed phase cannot establish accepted handoff, prior delivery intent or
terminal status. The native completion cause replaces its duplicate guard
wrapper; journal records and intent identifiers remain internal.

A retained `superseded` checkout stays partial. Even an unsolicited repeat
does not invoke finalization again or create a checkout-retry original. Receipt
publication, if outstanding, can still recover independently; it does not make
the superseded checkout complete.

The coordinator obtains delivery references through authenticated exact-attempt
`get_run_result` observation. A returned integration request is a separate
coordinator choice governed by its existing review and integration owners. The
worker answer supplies no integration operation. Historical result reads execute
no delivery or repair; a SHA, subject, worker final report or run-result reference
cannot replace an authenticated delivery reference.

Recovery receipts linked by authenticated continuation describe one logical
delivery. Observation returns its current account, with no extra choice for
each checkout retry. Distinct unlinked deliveries stay choices identified by
their known commit, changed paths and checkout state; neither receipt order nor
equal commits elects or merges them. A missing, conflicting or branching recovery
binding stops selection with its specific cause.

A historical read preserves its selected outcome and effects. Before offering
recovery, it checks that delivery's authenticated current account. Completed
recovery is never offered again; a still-pending current remainder can supply
its existing supported recovery. If current evidence is unavailable, historical
effects stand and no delivery replay is offered. Coordinator integration, when
eligible, names the current account. These reads perform no delivery,
integration or repair and supply no worker termination instruction.

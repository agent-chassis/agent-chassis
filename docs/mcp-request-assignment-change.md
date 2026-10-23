# Worker assignment-change responses

`request_assignment_change` requests correction of missing or contradictory
required assignment source, configuration, context, access, authority or
instructions. It does not revise the assignment. Ordinary failing tests and
recoverable input mistakes do not themselves establish an assignment blocker.
The worker supplies the closed testimony object documented in
[the operation reference](mcp-operation-reference.md#worker-assignment-change-requests).
For access gaps it names each necessary path, read or write access, and why.

`completed_work` and `remaining_work` contain the handoff, including partial
work and unfinished validation. Acceptance leaves the call pending while the
launcher ends the worker. There is no accepted response, final report, later
worker turn or subsequent tool call. The request's typed empty strings and
arrays remain valid but do not establish complete testimony.

Refusals return the affected assignment when authenticated, the specific cause,
actual effects, supported correction and `next_calls`. They expose neither
completion records nor credentials, storage metadata or captured server stacks.
Malformed requests identify rejected constraints and missing caller choices;
correction guidance names work testimony only when that testimony needs correction.
The tool never invents assignment facts or work testimony to construct a retry,
or silently removes another-assignment selection to make a request executable.

`accepted:false` means this invocation did not accept a new assignment change.
It does not establish unused completion authority. A changed request after an
earlier acceptance also carries `prior_acceptance:true`; the original handoff
stands and the worker has no next action. Identical repetition keeps the first
acceptance and its terminal behavior without another completion event.

An unacknowledged completion publication returns `accepted:null`, the specific
failure, and `get_run_result({assigned:true})` for inspection. Implementation,
delivery and request retries must wait while acceptance is unresolved. Missing
authentication, binding, termination or retention is
identified by its specific cause and affected assignment; these responses do not invent
an external repair or grant access. A known earlier acceptance stays binding
even if a later operation fails. Accepted handoff does not prove termination.
An otherwise authenticated, exactly bound worker can report unavailable frozen
content. The server requires the session's single current-unit assignment pin
and its configured digest-named artifact location. A read failing with `ENOENT`,
`EACCES` or `EPERM` retains the exact caller testimony and specific read failure,
with assignment content explicitly unavailable. The trusted digest pin remains
the completion binding; it is not evidence that absent bytes were read or verified.
No content is invented, substituted from live state or automatically repaired.
Invalid immutable evidence, an unpinned/malformed location, a mismatched
presentation and other I/O failures still refuse. These states do not become
ordinary absence. All credential, exact run/source binding, competing completion
and launcher termination checks still apply. Internal ownership and capability
identifiers are not agent recovery actions.

If delivery already owns completion, a recoverable receipt returns only its
submission and checkout effects. An already complete delivery needs no repeated
call: finish its required final report and terminate. An unfinished checkout
includes its specific operation diagnosis and `workspace_deliver_work({})` to
recover that existing delivery after its cause is resolved. A superseded checkout
has no same-delivery retry. Commit-object, branch-ref and transaction bookkeeping
stay internal. No new commit or assignment-change request is implied.
When no receipt can be recovered, the response preserves the failed read and
uncertain effects and stops without a blind retry. A terminal attempt cannot accept a
first request and has no worker continuation.

A failed completion-claim release has a narrower recovery when an authenticated
retained transaction proves non-publication or exact compensation with no
canonical write, and names the exact active intent. The refusal reports its
known object/ref/review/checkout effects and release failure, with the issued
`workspace_deliver_work({reconcile:{ref_id}})` call. After that release cause is
corrected within existing authority, reconciliation releases only that claim
through the completion owner; it performs no delivery or review submission and
creates no successful delivery receipt. Successful reconciliation restores the
choice of completion. Preserve the authored handoff and request it again if the
assignment gap remains. Missing testimony grants no acceptance. Unknown effects,
failed compensation, missing evidence, foreign bindings, competing completion
and terminal attempts cannot use this recovery.

The coordinator follows the exact attempt observation selected by its launch or
previous observation, retrieves the handoff through returned result/detail
calls, and reads the current bound unit through `workspace_read_wiki` with
`reads:[{subject:unit,for_changes:[...required members]}]`. It uses
the ordered result for meaning and `contexts[unit].revision` with that
context's returned schema calls to correct the assignment through `save_record`.
A stale revision follows the save's returned current-context call; the original
handoff is not a source of current write authority. A successful correction can
finish without a reread or reassessment. The coordinator separately decides
supported continuation subject to repository policy. Saved corrections do not
update the worker's frozen assignment.
Partial work remains preserved. Neither acceptance nor a saved correction
authorizes release, cleanup, integration, publication or successor execution.
An assigned worker observing known acceptance gets the stop instruction and no
handoff or wait call. The coordinator retains its handoff navigation. Optional
assignment detail delivers the frozen guidance once, without its digest, encoded
copy or authentication metadata; reading it executes nothing.
For a handoff accepted with unavailable content, the coordinator receives the
specific failure immediately beside the requested correction and completed/
remaining work. There is no required detail read for the same failure and no
claim to know the missing guidance. Retained reads preserve this original
unavailable extent even if the artifact later becomes readable.

When the missing instruction is an authored parent decision, the coordinator can
save an immutable entry on the owning record, select its required version through
the returned entry navigation, and attach that material reference to the selected
assignment at its current revision. Only the selected material enters the frozen
guidance; unrelated parent entries do not. A later parent edit does not change a
running assignment or its selected material version. Missing or altered references
and stale revisions must be corrected before the dependent save. The existing
material-source scope guards still apply.

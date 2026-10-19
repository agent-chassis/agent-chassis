# MCP dispatch monitoring and ownership

`get_run_result` observes a known subject and optional exact attempt, a worker's
assigned durable attempt, or one authenticated retained/recorded original. It
shares the production `createPreparedWorkspaceAgentDispatchBackend` instance with
`start_agent` and explicit `integrate_work`. It creates no second lifecycle owner.

## Pure observation

A default `{subject,attempt_id?}` performs one immediate live observation.
`timeout_ms` selects a bounded wait within the existing monitor-call deadline
owner's limits: an integer from 1 through 1200000 milliseconds (twenty minutes).
A value outside that range is refused, never clamped, and a shorter explicit wait
is honored as asked. The wait is the backend's existing loop at its five-second
interval. It returns as soon as the attempt is terminal and producer publication
has settled, with the same success, failure and unavailable-result facts an
immediate read reports, so a completed attempt is seen within about one
interval. An elapsed wait is not cancellation and performs no producer
settlement, canonical write, Git mutation, integration, launch or rerun. If the
same call remains pending in the client, continue that call identity rather than
starting another one. A later call is a separate observation, never approval.

The launcher's supervisor, not a read, moves a worker attempt's runtime status
from `launching` to `running`: one turn after supervision attaches it confirms a
child that has a process id and no recorded exit or spawn error, and the launch
owner applies that to the attempt record. The transition probes and captures
nothing, is never inferred from proof receipts, elapsed time or worker output,
and never follows a terminal status or an observed child termination.

The producer settles a terminal child and captures the public original once
independently of result polling. Original capture is a terminal producer action;
it is never requested by a read. Producer pending covers settlement and original
capture and durable original binding continuously, including when child status is
already terminal. Repeated completion notifications share one capture and binding. `original_publication` distinguishes
pending, captured, failed, not configured and unavailable originals; journal
`result_publication` retains its separate durable-result meaning. Immediate and
successful bounded waits preserve the same original locator and publication facts.
A captured managed-worker original is bound only after its locator
is durably attached to the exact recorded result. Binding failure reports stage
`original_binding` and its actual publisher refusal or cause while preserving
the captured original for live and held-locator reads. Observation retries neither
capture nor binding.
Start and child completion do not integrate a
delivery. Only explicit `integrate_work` selects the authenticated delivery and
invokes its existing effect owners. Saving a disposition records advisory input
without requesting integration.

The default result contains the selected subject/attempt and known role, status
and terminal facts. It reports `producer_pending` when publication is pending,
`timed_out` for a bounded wait, actual execution/publication failures, and the
issued original and direct `final_result` read when available. Healthy lifecycle
and publication bookkeeping, character counts, schema summaries and repeated
no-effect flags stay internal. Accepted
nonterminal or original-publication-pending observations return an executable
`get_run_result` call pinned to the server-selected subject and attempt. For a
worker attempt that call carries `timeout_ms:1200000`, selected by the server, so
following it unchanged waits for the attempt instead of polling it; a caller's own
timeout is never replayed. A review attempt's call and a worker's
`{assigned:true}` call carry no timeout and stay immediate reads. Available
originals take precedence. Refusals and failed publication offer no observation
call, and no wait, as a publication repair.

Worker process completion, saved final-response availability (`original`), and
authenticated delivery (`delivery`) are independent
facts. A successful receipt-population read explicitly reports `state:"absent"`
when empty. For a completed worker this means the worker ended without an
authenticated delivery and nothing is available to integrate, even when the
process succeeded and its final response is readable. A failed or unavailable
receipt read preserves its cause and cannot establish absence. Accepted
assignment-change completion remains its own intentional outcome; reviewer and
redteam results do not require worker delivery.

Once producer publication settles, a coordinator observing a terminal worker
without delivery is offered the existing read-only
`start_agent({subject,preview:true})` assessment. Preview assesses saved
readiness and leaves execution admission unchecked; it neither retires the
attempt nor establishes retry eligibility. A separate, explicit replacement
`start_agent({subject})` request reaches the existing managed-attempt admission
owner: it can retire a proven-dead attempt only after authenticating its binding
and proving the slice ref equals its bound base, then applies normal launch
admission. Live, uncertain, committed or unreadable prior attempts remain subject
to that owner's refusals. Receipt absence and process success alone authorize no
retry. There is no public retirement-only correction here, and another
observation is not a repair. Reading final-response detail remains available
independently and performs no lifecycle action.

The calling client's own tool-request deadline bounds a wait independently of the
server. A client that abandons the request sooner ends only its own call: the
attempt and its producer continue, and a later read observes them. The
launcher's Codex registration allows the `wiki` server 1260 seconds per tool
request; see [client registrations](agent-launch-mcp-conduit-lifecycle.md#client-registrations).
Complete child text is reached through the issued result selection; internal
journal carriers are never public. No field invents result durability, cleanup,
success or proof credit. Reads execute, integrate and retain nothing without
repeating those assertions in every successful response.

## Selection and authority

The closed observation forms are `{subject,attempt_id?,timeout_ms?}` for an
authenticated orchestrator and `{assigned:true}` for a managed worker. Exact
attempt lookup checks subject and caller identity. Subject-only selection retains
the backend owner's ambiguity rules; attempts are not guessed or silently sorted.
The host repository and trusted session identity bind every read; public inputs
never supply repo, run authority, a launcher tuple or arbitrary filesystem paths.

A worker's assigned read authenticates its launcher slice binding and reads the
existing attempt journal. Live worker waits classify that same durable attempt
before waiting, preserving journal faults and tuple contradictions. A released
attempt cannot wait. A cold durable observation cannot perform a live wait.
A wait returned earlier may be followed after its attempt was released or its
serving process restarted. It is still refused, as `released_attempt_cannot_wait`
or `durable_observation_cannot_wait`, and that refusal carries one executable
`get_run_result` call for the same authenticated subject and exact attempt with
no timeout. The wait is never converted into a read on the caller's behalf, and
the call never names a newer attempt. A wrong caller, subject or attempt, an
ambiguous selection and unreadable evidence keep their own refusals and are
offered no such call.
Reviewer sessions have result-original access within their native execution
entitlement, not orchestrator live-run observation. Redteam sessions have no
result or execution tool.

## Retained and recorded results

`{result:{ref_id},proof?,detail?}` authenticates the stored original before
choosing its incumbent producer owner. Native, standalone proof, delivery,
integration and observation originals retain their existing producer identities.
For a retained run observation, `{result}` delivers its public `final_result`
directly, rather than another summary and a required self-read. A completed
selected member has no next call to reread itself. Attempt ambiguity returns
one exact read per choice with the known role/state, retaining the existing
live and durable election rules. No selected attempt is replaced by a newer one.
The public common reader changes no stored binding or schema identity. Optional
proof selection names an exact subject or authored source tuple. Non-proof
originals reject proof selectors. Detail is the delivery/observation owner's
selected material, not an execution selector or a generic spill read.
Selectable members are public result meaning (`final_result`, delivery `outcome`,
integration `result`, or assignment-change `request`/`assignment`), never stored
identity, binding, phase or transport members. Delivery and integration reads
reuse their owners' public effect and failure projections rather than returning
the underlying transaction carrier. A coordinator's delivery read carries no
worker termination instruction. Successful delivery reads need no self-read;
partial worker outcomes retain their exact remaining-effect recovery.

Result-owned continuations are admitted against the receiving session's actual
registered request contracts. An unavailable continuation is a specific
limitation beside the still-valid result. Offered integration, readiness preview
and candidate verification calls confer no execution authority.

`{assigned:true,recorded_invocation:{invocation_id},proof?}` reads an authenticated
managed worker's own recorded proof invocation through the existing journal and
cache owner. It preserves that invocation's original source and result selection.
An invocation identity grants no execution, lifecycle or cross-attempt authority.

The original source is authenticated by repository, producer route, subject and
session identity. Native answers retain their 1,024 UTF-8 byte response contract.
Other summaries use the shared selected-response delivery class. Complete selected
semantic material uses the authenticated selected-full response class; agents
receive structured values or plain Unicode text, not raw logs, base64 or a byte
integrity/reassembly task. See [selected responses](mcp-selected-response-details.md).

## Restart and unavailable facts

After restart an authenticated orchestrator selects a managed worker with the
existing `{subject}` or `{subject,attempt_id}` inputs. The attempt journal's
`run_original_recorded` event supplies the same retained locator and semantic
member calls as the producer observation. The retained owner verifies repository,
launcher authority and unit; the carrier must name that exact subject and run.
Historical failures remain selectable after source movement and later success;
multiple attempts require the existing explicit selector. Assigned worker
metadata exposes no orchestrator observation locator.

A completed reviewer or redteam run is selected with the same inputs. After a
successful capture its completion producer publishes one review-original
binding: the subject, the run id, the role and the retained locator, and no
review text. The binding is observation-only. It is chained in a review-only
partition of the attempt journal root, under that owner's lock and durable
publication, and is not an attempt: it holds no reservation, tuple, lifecycle
state or release, and admission, election, recovery and the delivery-receipt
lookup never read it. Repeating an identical binding appends nothing; a
different binding for an attempt already bound is refused. When publication
fails, the captured original and the binding owner's actual cause stay on the
producer observation and no read retries it.

After restart the binding supplies the same retained locator and member calls.
The retained owner verifies repository, launcher authority and unit, and the
carrier must name that exact subject, run and role. Several bound reviews of one
subject require the explicit attempt; none is chosen as newest. A subject that
also holds worker attempts keeps its worker selection unchanged: subject-only
observation answers from the attempt journal, and a review there is selected by
its exact attempt. Live review status, findings resolution and a review whose
binding was never published remain process-local; a held locator still reads
such an original.

Retention and durable attempt linkage are separate facts. Retained bytes alone
do not establish that a fresh observer can discover their locator. At the crash
boundary where linkage is absent, an authenticated held locator can still read
the original while subject/attempt observation reports its missing locator.
Neither observation nor a detail read repairs that boundary, scans originals,
launches another attempt or integrates a delivery.

Live backend run observations and findings resolution remain process-local.
After restart, durable managed-worker observations read the existing
subject-partitioned attempt journal. A recorded result can be present even when
no retained original locator exists; the answer states
`durable_result_has_no_retained_original` instead of inventing an empty original
or capturing one during a read. A terminal live result whose producer original
is unavailable says `producer_original_unavailable`. Pending publication says
`producer_original_pending`; a child not yet terminal says `producer_not_terminal`.
A refused or failed lookup observed no producer and says `observation_unavailable`
beside its actual code or refusal; it offers no observe-again call.
Absent capture configuration says `producer_original_not_configured`. Capture
failure says `producer_original_capture_failed`, while completion settlement
failure says `producer_completion_failed`; the actual cause, stage and responsible
owner remain visible. Observations cannot retry either failure.

Known retained locators remain readable after restart for the same authenticated
owner. Missing files, corrupt bytes, contradictory bindings and foreign sources
preserve the selected-response owner's specific causes. Reads perform no cache
repair, source scan fallback, publication, identity retirement or retry. A
review without a published binding does not become discoverable because its
retained bytes or a historical audit receipt exist; no binding is reconstructed
from them. Audit evidence grants no continuation authority.

## Failure and effect ownership

The launcher owns child status, exit, capture, result publication and cleanup.
The journal owns recorded lifecycle and proof-verification populations. Native,
proof, delivery and integration owners own their result projections and
entitlement checks. Default answers retain specific semantic causes; complete
originals preserve source-selected material without exposing process logs.
Publication failure cannot undo a completed child. A failed integration fence
cannot erase a previously confirmed integration effect. Missing evidence remains
unknown or unavailable rather than confirmed absence.

Reading worker proof outcomes performs no verification. Explicit `verify_proof`
records one invocation and retains its result for the authenticated attempt;
settlement and observation add no proof success or completion gate. Retry is a
new explicit execution call with the original owner's checks and source identity.
A refused attempt selection selected no attempt: the refusal is the answer and
no `proof_verification` accompanies it. A failed journal or proof-population
read reports `proof_verification` unavailable with every cause fact its owner
recorded, never the journal events, attempts or store root it was read from.

An orchestrator observing a terminal worker attempt whose integration completed
is offered one optional, never recommended
`verify_proof({subject:<parent WK>,git_sha:<candidate>})` call when the terminal
candidate built from the exact WK tip that integration produced already exists
and its checkout verifies. The backend's read-only
`observeCompletedIntegrationCandidate` authenticates the exact attempt tuple and
its completed integration through the integration-continuation owner, then reads
the selected candidate through the terminal-candidate coordinator's lock-free
observer. The commit is that authenticated candidate, never the worker delivery,
the WK tip, a ref or the live checkout, and the call claims nothing about whether
the candidate is still current. `candidate_verification` reports `offered` with
the candidate, or `unavailable` with the refusing owner's cause; it is absent when
no integration completed, no candidate is selected, or the selected candidate
belongs to another tip. An unavailable candidate also carries the candidate
owner's authenticated typed failure as `cause.candidate_failure` when that owner
disclosed one. Observation acquires no WK exclusion, executes no proof,
and never integrates, advances a lifecycle, reconstructs, publishes or
materializes a candidate. A restarted server offers the same call from the
durable attempt tuple.

## Durable substrate and integration

The existing crash-durable substrate, launcher process identity records and
subject-partitioned attempt journal retain their ownership. Terminal original
capture adds no second store, reservation authority or lifecycle engine. Attempt
release, staleness, exact tuple validation and result-digest authentication are
unchanged. See [managed lifecycle](mcp-dispatch-managed-run-lifecycle.md).

Delivery publication and integration are separate. The exact retained delivery
supplies subject, commit, original base and launcher binding to `integrate_work`.
The existing integration primitive owns live ref fences, scope, Git CAS,
canonical record CAS, recovery and retirement. Dispositions are advisory context
for configured policy, not an approval token. See
[slice integration](mcp-dispatch-slice-integration.md).

## Observing assignment-change requests

`get_run_result` discovers accepted assignment-change requests through the
existing authenticated attempt journal. A live or unpublished attempt reports
pending termination; acceptance and elapsed time establish no termination
proof. After producer publication the compact summary and retained terminal
original identify `assignment_change_requested`. Exit and publication failures
remain separate facts. Request originals expose complete semantic members
through the existing selected-response reader, with exact request text and
frozen assignment bytes preserved. Reads never scan orphan originals for
acceptance, publish, settle, stop, release, revise assignments or start successors.

An identical request retry authenticates historical identity and reads the first
acceptance. A contrary delivery intent reports uncertainty and the delivery
transaction owner's recovery. When a committed retained delivery exists, only
its incumbent receipt/checkout recovery is offered; no second commit is run.
An intent with no retained delivery has no callable reconciliation here, and
blind retries are not recovery. A coordinator decides revisions separately,
starting with the returned `workspace_read_wiki({subject:<bound unit>})` call to
obtain current authoring revision and schema. A later launch is a distinct action.

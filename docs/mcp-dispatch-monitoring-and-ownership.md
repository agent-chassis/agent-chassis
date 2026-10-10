# MCP dispatch monitoring and ownership

`get_run_result` observes a known subject and optional exact attempt, a worker's
assigned durable attempt, or one authenticated retained/recorded original. It
shares the production `createPreparedWorkspaceAgentDispatchBackend` instance with
`start_agent` and explicit `integrate_work`. It creates no second lifecycle owner.

## Pure observation

A default `{subject,attempt_id?}` performs one immediate live observation.
`timeout_ms` selects a bounded wait within the existing monitor-call deadline
owner's limits. An elapsed wait is not cancellation and performs no producer
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
A captured managed-worker original reports `bound:true` only after its locator
is durably attached to the exact recorded result. Binding failure reports stage
`original_binding` and its actual publisher refusal or cause while preserving
the captured original for live and held-locator reads. Observation retries neither
capture nor binding.
Start and child completion do not integrate a
delivery. Only explicit `integrate_work` selects the authenticated delivery and
invokes its existing effect owners. Saving a disposition records advisory input
without requesting integration.

The default result contains actual attempt/status/terminal facts, producer
pending state, a compact final-result summary, publication state, recorded counts
when available, original availability and the exact selected detail call. Accepted
nonterminal or original-publication-pending observations return an executable
`get_run_result` call pinned to the server-selected subject and attempt, without
replaying a timeout. Available originals take precedence. Refusals and failed
publication offer no observation call as a publication repair.
Complete child text and internal journal carriers never appear in that summary.
No field invents result durability, cleanup, success or proof credit. The
`observation` facts report `executed:false`, `integrated:false`, `retained:false`.

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
Reviewer sessions have result-original access within their native execution
entitlement, not orchestrator live-run observation. Redteam sessions have no
result or execution tool.

## Retained and recorded results

`{result:{ref_id},proof?,detail?}` authenticates the stored original before
choosing its incumbent producer owner. Native, standalone proof, delivery,
integration and observation originals retain their existing producer identities.
The public common reader changes no stored binding or schema identity. Optional
proof selection names an exact subject or authored source tuple. Non-proof
originals reject proof selectors. Detail is the delivery/observation owner's
selected material, not an execution selector or a generic spill read.

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

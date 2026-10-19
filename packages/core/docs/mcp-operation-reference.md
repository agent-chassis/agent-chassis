# MCP Operation Reference

The server binds one trusted repository and one prepared launcher backend. Public
agent requests have no `repo` selector. `tools/list` advertises the session's
closed request schemas; the same registered owner contracts enforce them,
including cross-field constraints. A forbidden route is absent and non-callable.
Tool names are exact, with no aliases or deprecated forms.

## Operations

| Intent | First tool | Request boundary |
| --- | --- | --- |
| Saved work, reference material, frozen assignment | `workspace_read_wiki` | One of `subject`, `search`, `assignment:true`, or returned `reference`; semantic `select` only with that reference |
| Published code evidence | `query_code_index` | Existing published-index query and retained selection contract |
| Proof candidates and complete meaning | `workspace_find_proofs` | No arguments to browse the catalogue, then a returned retained selection; optionally a query or known proof identity |
| Allocate and author a new record | `workspace_create_record` | `kind`, `title`, kind-specific `initial?` |
| Save canonical changes | `save_record` | `unit`, current combined `revision`, closed `changes` |
| Assess saved design | `workspace_assess_contract` | `unit` and the owner's selected assessment input |
| Start or preview a canonical unit | `start_agent` | `subject`, optional configured selection; `preview:true` for action or role capabilities |
| Observe or read execution results | `get_run_result` | Subject/attempt, assigned observation, retained original, or assigned recorded invocation |
| Integrate a selected delivery | `integrate_work` | Exact returned `delivery:{ref_id}` |
| Native test execution | `workspace_run_test` | Assigned worker entrypoint/selection or nonworker literal harness; retained read/retry modes |
| Saved proof execution | `verify_proof` | `subject`, optional `source`, `branch` or `git_sha`, `environment`, `timeout` |
| Request an assignment revision and end the worker attempt | `request_assignment_change` | Closed testimony; authenticated current worker assignment only |
| Deliver a worker assignment | `workspace_deliver_work` | Empty object, launcher-authenticated assignment |
| Inspect a candidate | `workspace_inspect_candidate` | WK `subject` and owner's optional historical selection |
| Advance a candidate | `workspace_advance_candidate` | WK `subject` and exact immutable `version` |
| Publish an exact candidate | `workspace_publish_work` | WK `subject` only |
| Observe human landing | `workspace_check_landing` | WK `subject`, optional exact returned publication `selection` |

These seventeen tools replace the displaced shared agent families. The ordinary
help tree, intent router, generic spill reader, report routes and old family
entrypoints grant no indirect access. Independently preserved operator-only
operations remain filtered by the session’s role and configured capabilities.

## Role authority

Orchestrators have every task above except worker delivery and assignment-change requests. Workers have
`workspace_read_wiki`, `workspace_run_test`, `verify_proof`, `get_run_result` and
`workspace_deliver_work` and `request_assignment_change`. Reviewers have read, code-index when granted, proof
discovery, assessment, native tests, proof execution and common result reads.
Redteam sessions have read, code-index when granted, proof discovery and
assessment. Redteam sessions have no execution or result tools. Operator task
access excludes start, result, native execution, proof execution and delivery;
its independently preserved maintenance routes retain their authorization.

The launcher resolves role authority. A requested child role, repository field,
reference, version or subject never grants it. Workers read their frozen
assignment; findings sessions read their authenticated review source.

## Compact-first reads and authoring

`workspace_read_wiki({subject:"work record"})` returns compact context, the current
combined authoring revision and a resource reference. Follow one of its exact
selection calls to read fields, entries, populations, currentness or integrity
whole. `workspace_read_wiki({assignment:true})` selects a worker's authenticated
frozen assignment; it accepts no caller assignment identity. A reference selects
the resource the first answer returned, under the same source and role grants.
`workspace_read_wiki({subject:{record_kind:"work_item"}})` returns a record
kind's creation context before any record exists; its reference reads the
complete `initial` schema of the members a creation authors.
It never grants arbitrary filesystem access.

Search uses `search:{query,where?}` for ranked matches or
`search:{inventory:true,where?,query?}` for the complete filtered population.
The owner-derived `where` guidance is included in the tool declaration:

- `kind` is the search content category: `issues` for work items, `decisions`,
  `initiatives`, `sources`, `areas`, `docs`, `wiki` for top-level wiki pages,
  or an enabled extension namespace such as `people`. Creation's `work_item`
  is not a search category. Extension categories remain open.
- `type`, `status`, `priority`, `owner`, `area` and `initiative` match record
  metadata exactly, ignoring case. When `owner` is absent, `owner` matches any
  member of `owners`. For example, `where:{kind:"issues",status:"todo"}`.
- `retrieval_role` and `topic` match members of the resolved role and topic
  lists, for example `record` and `tooling`.
- `canonicality`, `maintenance_mode`, `knowledge_role`, `evidence_stage`,
  `retrieval_visibility`, `lifecycle` and `sensitivity` match resolved facets,
  for example `canonical`, `curated`, `reference`, `primary`, `support`,
  `active` and `normal`, respectively. These examples add no filter validation.

Omitting a filter or supplying `""` leaves that field unconstrained. Whitespace
is not trimmed: `" "` is a literal value. Values are lowercased during
normalization except `initiative`, which is preserved; comparisons ignore case.
Omitted or empty `retrieval_visibility` still excludes suppressed sources;
explicit `retrieval_visibility:"suppressed"` selects them. Null is not an
accepted MCP filter value. Filtering changes neither the configured source
population nor its role grants.

Selecting an entry returns its complete body, exact `entry_id`/`version_id` and
an owner-issued immutable `reference` string. Attach that string unchanged with
`save_record({unit,revision,changes:{material_refs:[{ref:reference}]}})`.
The reference pins that returned version even after a later append. The
context's `{ref_id}` locator cannot serve as an assignment material
reference; assignment preparation rechecks source visibility independently.

Create a work item with `{kind:"work_item",title}`; creation publishes through
the existing allocator/store and then reports maintenance separately. A refusal
after publication does not undo or hide the birth. Follow the emitted
`workspace_read_wiki` call unchanged: work items, decisions and initiatives use
the allocated canonical ID as `subject`; sources and areas use their Markdown
document path. JSON storage paths are not reader subjects. Save with
`{unit,revision,changes}`. Changes include semantic
requirements, obligations, cases, record fields, entries, dispositions and
explicit completion under their native owners. Caller-local keys are resolved
by the save owner; callers do not join digests or construct carriers. A stale
revision refuses rather than rebasing, and malformed input causes no publication.
The combined transaction preserves native atomicity and certainty facts.
Original create/save responses are selected through their returned
`workspace_read_wiki` references without another mutation.

`workspace_assess_contract` evaluates authored validity, currentness and route
facts without executing proofs. Validation is distinct from coverage and runtime
success. Saving a disposition records advisory judgment; it never requests
integration. See [persistence](work-record-persistence.md) and
[controlled contracts](mcp-controlled-contract-operations.md).

## Proof-intent discovery

Call `workspace_find_proofs` with no arguments first: it returns the complete
catalogue, every proof name with its short description, or a bounded summary
with the exact call to that complete list. Neither a listed description nor a
lexical match establishes that a proof applies. With an optional `query` it
returns complete lexical matches grouped by tier, or a
bounded summary with the exact call to that complete index. Follow the returned
selection for a candidate's complete assertion, exclusions, capability and
applicable authoring facts. A lexical tier is no semantic eligibility verdict:
assess plausible candidates across tiers and abstain when evidence is absent,
incomplete or ambiguous. A provider-only query may match nothing. Query provider
recognition, listed family support, authored target validity and actual runtime
availability are distinct facts. Discovery executes no provider and re-ranks no
retained selection. Movement during fresh acquisition refuses instead of mixing
catalogues and supplies its supported refresh route. Authenticated retained reads
return the original historical content, explicitly reporting changed or unavailable
currentness; they never claim it describes the current source.
When a retained discovery answer's current-source inspection fails, its
`source.currentness` is `unavailable` and `source.inspection_failure` preserves
the inspection code, message and details, including filesystem causes such as
`EISDIR`. This observation is separate from the retained answer's readability;
it supplies no new current-source assertion or historical-source policy.

## Start, result and explicit integration

`start_agent({subject})` resolves the saved assignment, configured model,
readiness, authority and provisioning through the existing launch pipeline.
Managed worker implementation selects an exact slice, for example
`{subject:"WK-0001#SLICE-001"}`. Selected preview and actual start use the same
configured routing restriction; applicable findings roles retain parent targets.
Complete `diff_base_sha`/`reviewed_sha` pairs select findings material; workers
cannot supply them. Action previews need a subject; subject-free capability
previews need `preview:true` and `role`. Previews do not spawn. A reviewer
preview lists the `structured_dispatch` capability only while it blocks, with
its blocker, cause, gate outcome and recovery; an empty list is not launch
permission. Checked target
eligibility and authored readiness leave execution admission unchecked. Missing-base
correction names the root unit, combined revision and required branch choice;
no main/master branch is guessed. After the choice, save it through the returned
correction contract, then retry the same subject.
Read guidance carries executable current arguments. Slice authoring, branch
choice and proof mappings require caller-authored input through `save_record`;
an authoring template is not a complete executable correction.

An accepted start reports actual child-start evidence and an attempt identity.
Its `get_run_result` call is checked against the actual serving consumer
contract. Start, child completion, result observation, bounded waits and saved
dispositions do not integrate work. The producer settles and captures its
terminal original independently of reads.

`get_run_result` selects one observation or original:

- `{subject,attempt_id?,timeout_ms?}` observes an orchestrator's selected run.
- `{assigned:true}` reads a worker's own durable attempt.
- `{result:{ref_id},proof?,detail?}` reads one authenticated original.
- `{assigned:true,recorded_invocation:{invocation_id},proof?}` reads a worker's
  original recorded proof invocation.

An authenticated coordinator follows ordinary observation's
`proof_verification.detail_call` to
`{subject,attempt_id,detail:{member:"proof_verifications"}}`. This returns one
complete inventory of the selected journal prefix. Each row supplies an exact
`{subject,attempt_id,recorded_invocation:{invocation_id},proof?}` read of that
original. Its summary supplies the complete outcome call with
`detail:{member:"outcome"}` and applicable proof diagnosis calls. A complete
outcome also supplies diagnoses for proof rows omitted by a bounded summary.
The invocation selector comes from inventory, and every call remains pinned to
that attempt and original. An outcome selection excludes `proof`.

Reviewers may read their own standalone proof outcomes and selected diagnoses
within the exact authenticated findings action that executed them. Retention binds
the launcher's assigned unit, run and immutable review-source identity; another
action, matching subject or guessed locator grants no read. Orchestrator and
worker result routes retain their existing scope; redteam gains no execution or
result access. This grants neither predecessor-review access nor whole-WK proof
execution.

A retained proof selector is one exact subject or authored source tuple. Detail
selects delivery, integration or observation material through the shared
selected-response owner. Default answers are bounded summaries, not complete
internal carriers. Every read authenticates source, repository and role before
selection. Missing/corrupt originals, cold advisory state and unavailable durable
locators remain explicit failures or unavailable facts. Nothing reruns, settles,
retains, repairs canonical state or integrates during a read. A known original
remains readable after restart for its authenticated owner. Cold durable worker
observations read the journal; cold state cannot perform a live wait.

If a subordinate delivery receipt cannot be authenticated or read,
`get_run_result` refuses with `delivery_receipt_unreadable`, naming the requested
subject, selected attempt, failed receipt locator and its position. It preserves
the delivery reader's specific cause inside that observation refusal. The
failure is not a caller request for a ranged read, and no successful prefix of
the receipt population establishes delivery or integration. The response states
the unchanged execution, integration and retention effects and stops the
dependent step without inventing a repair call.

Only `integrate_work({delivery})` explicitly requests integration of the exact
authenticated delivery. The delivery owner supplies subject, commit, base and
attempt binding; callers supply no replacement authority. Integration fences
moving/stale/foreign deliveries, uses saved dispositions as advisory input and
preserves configured policy and native Git/record CAS. Repeats and cold recovery
retain confirmed effects and original causes. Original reads perform no recovery.
An unavailable launcher session returns the session owner's specific code and
message, unchanged effects and an explicit stopping point before any delivery
read, result retention or integration attempt. Request arguments cannot create
or replace the launcher session.

Integration continuations, including original reads, wrong-producer corrections,
partial-completion retries and conditional verification, are published only
when the current role permits the operation and its actual serving registration
accepts the exact arguments. Unavailable continuations are stated as limitations;
they do not erase confirmed integration or retained-original facts. An operator
session receives no `get_run_result` or `verify_proof` call without their existing
grants. A registered `integrate_work` recovery call can remain available when a
dependent reader or verifier is unavailable.
See [slice integration](mcp-dispatch-slice-integration.md).

When `start_agent` refuses because the subject's committed delivery is not yet
integrated, the refusal leads with `recovery`: the launcher's instruction to
integrate the existing delivery before starting another worker and to continue
the outstanding repair in a follow-up slice afterwards, the refused subject and
known attempt, and the two existing steps in order. No replacement worker
started and nothing was integrated. The first step is the offered
`get_run_result({subject,attempt_id?})` read, which acquires the delivery
locator and leaves the blocker in force. The second names `integrate_work`,
which needs that returned locator; a subject, commit SHA or final-result locator
is not one, and the refusal supplies none. A coordinator's observation that
authenticated exactly one delivery then offers `integrate_work({delivery})` with
that exact locator beside the delivery read and reports `integration`; an
unreadable or ambiguous locator, or an unserved read or integration route, is
stated as its specific limitation. Returning a call never executes it, and an
unchanged `start_agent` retry is never offered as recovery.

## Native and proof execution

`workspace_run_test` preserves native execution and the total 1,024 UTF-8 byte
response exception. Its schema rejects supplied `repo`, even when it matches
the host. Execution, retry seeds and retained reads bind that same unique host
repository. Orchestrators explicitly select source; workers/reviewers use
launcher-authenticated source. Foreign retained references cannot redirect it.
A test result grants no proof credit. See
[native testing](local-test-runtime-setup.md#the-workspace_run_test-route).

`verify_proof` is execution-only. Retained/recorded reads go to `get_run_result`;
execution selectors never become read aliases. Results preserve the selected
population, actual attempted execution, capability limitations, failures and
source identities. A successful process exit alone is no proof success.
See [test-proof runtime identity](test-proof-runtime-identity.md) and
[test-proof results](test-proof-results.md).

## Candidate, publication and completion

Inspection is pure observation. Advancement explicitly changes one selected
immutable candidate version and performs no review, proof or publication.
Publication uses the configured local, plain Git or hosted destination; no origin
or GitHub prerequisite is imposed on a local route. It neither merges nor marks
the canonical work done. Landing observation is separate, authenticates the
selected publication and distinguishes awaiting human landing, landed,
contradictory and unavailable. Original candidate/publication/landing responses
are read through returned `workspace_read_wiki` references. Their producer
identities remain unchanged in retained bindings.

For the forge route, the coordinator records applicable closure evidence and
calls `workspace_publish_work` after the required review and disposition, then
uses `workspace_check_landing` to observe landing. Publication carries the
runtime-prepared closeout and completion commits. The completed status remains
branch-local until confirmed merge makes the merged work record canonical.
Advisory review results do not grant lifecycle authority. See
[terminal review](mcp-dispatch-terminal-review.md).

## Response and failure boundaries

Responses carry exact next calls admitted by the serving schema and role.
`workspace_read_wiki` uses `next_calls` for concrete continuations. Choice
populations may instead share `selections` and an explicit `selection_context`
call template with common bindings; the same navigation is not published twice.
See the owning [wiki reader contract](workspace-read-wiki.md).
Complete entry inventories retain every member, order and version. Work context
reports small literal prose and truthful extents; its recommendation adds granted
information beyond prose already delivered. Initiative action selections return
the exact selected unit's facts and refuse missing or foreign identities.
Invalid obligation-coverage carriers retain their native
`acceptance_coverage_canonical_source_invalid` cause, subject, schema errors and
diagnostics. No correction call is advertised when the serving schema provides
none; reads do not repair canonical sources.
Refusals preserve deciding cause, subject, actual effects and supported recovery;
a missing recovery remains explicit. Selected full reads are delivered through
the shared authenticated response class. Callers receive semantic structured
values and plain Unicode text, never raw logs, public base64 or integrity and
reassembly jobs. The native output exception is limited to the native tool.
See [selected-response details](mcp-selected-response-details.md).

## Local advisory feedback

During work, all managed roles can use `workspace_record_feedback` for confusion, limitations and model token waste. Direct workers use `wiki feedback add --stdin --new-session|--session <id> --json`, without MCP. Feedback appends only repository-local runtime state and grants no canonical or lifecycle authority. See [Local agent feedback](agent-feedback.md) for sessions, carrier capacities, package provenance, and errors.

## Worker assignment-change requests

`request_assignment_change` takes the required closed object
`{assignment_fact:{kind:"missing"|"contradictory",statement:string},evidence:[{description:string,references:string[]}],prevents:string,requested_change:string,completed_work:string[],remaining_work:string[]}`.
Workers use it when required source, configuration, context, authority or
instructions are inaccessible, missing or contradictory. Do not replace missing
required context with a workaround in an accessible file. Include the missing
context, evidence, what is prevented and the requested correction; completed and
remaining work are the handoff even before implementation is complete. Acceptance
immediately ends the worker and preserves partial work; the coordinator decides
revisions. Ordinary failing tests and recoverable tool refusals alone do not
establish an assignment gap.
Source-snapshot symlink recovery uses this route when the authenticated worker
cannot change the affected path. It supplies known refusal evidence and a
schema-validated call with explicitly incomplete work testimony; the worker must
supply its own `completed_work` and `remaining_work` before choosing to submit.
Verification and recorded reads never submit it automatically. Missing route,
authenticated binding, frozen assignment or unused completion authority is named
as a capability limitation, with no uncallable request or unchanged retry.

Empty typed testimony is accepted as incomplete testimony. References are inert
evidence descriptions. The request cannot supply repository, unit, attempt,
retry, worktree, scope or approval authority.

Acceptance retains the exact request and frozen assignment through the existing
retained-original owner, then links them under the attempt journal's partition
lock. That link consumes only this attempt's completion authority. Repeated identical requests retain one acceptance; different content conflicts.
The accepted worker call remains pending under launcher shutdown, so the worker
has no retry or next call. Delivery
claims its informational intent through the same owner before materialization,
so the two completion alternatives cannot both obtain authority.

Before acceptance the host requires the private launcher terminal capability
for the authenticated attempt. Missing capability is a zero-acceptance refusal.
After durable acceptance the trusted host sends an assignment-change terminal
event over that private lifecycle pipe. The shared isolated-launch owner sends
SIGKILL immediately to its already-owned confined worker; the namespace boundary
also stops native descendants. The accepted call never returns ordinary success.
`completed_work` and `remaining_work` are the handoff: there is no final report,
additional model turn, polling or subsequent tool execution. Refusals leave the
worker able to continue. Acceptance proves no death; failed channel writes or
signal delivery retain the request and consumed authority with the actual cause.
Cleanup follows real process termination, not journal publication. No OS-atomic
cancellation of actions already running is promised. Ordinary failing tests and recoverable refusals
keep their ordinary recovery. The request edits no canonical assignment or status
and grants no integration, proof, publication or successor authority.

`get_run_result` returns pending termination while no terminal result has been
published, then the semantic outcome `assignment_change_requested` after producer
settlement. Process status, exit facts and genuine publication failures remain
separate. Follow the returned original/member calls for complete request and
assignment detail. The coordinator reads current authoring state with
`workspace_read_wiki({subject:<bound unit>})`, explicitly authors any revision
with `save_record`, and decides any subsequent start separately.

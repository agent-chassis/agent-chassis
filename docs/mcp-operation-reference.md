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
| Native test execution | `workspace_run_test` | File/runner and native execution selectors, or native owner's read/retry/continue modes |
| Saved proof execution | `verify_proof` | `subject`, optional `source`, `branch` or `git_sha`, `environment`, `timeout` |
| Deliver a worker assignment | `workspace_deliver_work` | Empty object, launcher-authenticated assignment |
| Inspect a candidate | `workspace_inspect_candidate` | WK `subject` and owner's optional historical selection |
| Advance a candidate | `workspace_advance_candidate` | WK `subject` and exact immutable `version` |
| Publish an exact candidate | `workspace_publish_work` | WK `subject` only |
| Observe human landing | `workspace_check_landing` | WK `subject`, optional exact returned publication `selection` |

These sixteen tools replace the displaced shared agent families. The ordinary
help tree, intent router, generic spill reader, report routes and old family
entrypoints grant no indirect access. Independently preserved operator-only
operations remain role/tier filtered. Paid code-index access is configured
separately from the free substrate.

## Role authority

Orchestrators have every task above except worker delivery. Workers have
`workspace_read_wiki`, `workspace_run_test`, `verify_proof`, `get_run_result` and
`workspace_deliver_work`. Reviewers have read, code-index when granted, proof
discovery, assessment, native tests, proof execution and common result reads.
Redteam sessions have read, code-index when granted, proof discovery and
assessment. Redteam sessions have no execution or result tools. Operator task
access excludes start, result, native execution, proof execution and delivery;
its independently preserved maintenance routes remain available by tier.

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
It never grants arbitrary filesystem access.

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
retained selection. Source movement refuses instead of mixing catalogues.

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

A retained proof selector is one exact subject or authored source tuple. Detail
selects delivery, integration or observation material through the shared
selected-response owner. Default answers are bounded summaries, not complete
internal carriers. Every read authenticates source, repository and role before
selection. Missing/corrupt originals, cold advisory state and unavailable durable
locators remain explicit failures or unavailable facts. Nothing reruns, settles,
retains, repairs canonical state or integrates during a read. A known original
remains readable after restart for its authenticated owner. Cold durable worker
observations read the journal; cold state cannot perform a live wait.

Only `integrate_work({delivery})` explicitly requests integration of the exact
authenticated delivery. The delivery owner supplies subject, commit, base and
attempt binding; callers supply no replacement authority. Integration fences
moving/stale/foreign deliveries, uses saved dispositions as advisory input and
preserves configured policy and native Git/record CAS. Repeats and cold recovery
retain confirmed effects and original causes. Original reads perform no recovery.
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
See [test-proof runtime identity](test-proof-runtime-identity.md).

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

Completion is an explicit `save_record` change with native checks and receipt
semantics, after the applicable publication and landing facts. Advisory review
results do not grant lifecycle authority. See
[terminal review](mcp-dispatch-terminal-review.md).

## Response and failure boundaries

Responses carry exact next calls admitted by the serving schema and role.
`workspace_read_wiki` publishes selection navigation only in `next_calls`.
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


# MCP dispatch monitoring and ownership

Part of the [MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md),
which remains the canonical entry page. This page carries the canonical text for
monitor-route terminality, the wiki-MCP boundary, and trusted operation
ownership. The dispatch-readiness generated write surface keeps its canonical
text on the entry page; see the pointer at the end of this page.

Sibling pages: [launch and admission](mcp-dispatch-launch-and-admission.md),
[managed run lifecycle](mcp-dispatch-managed-run-lifecycle.md),
[terminal review](mcp-dispatch-terminal-review.md),
[slice integration](mcp-dispatch-slice-integration.md).

## Subject-addressed observation and lifecycle side effects

The status route is not read-only for a managed exact-slice worker run. The
post-worker lifecycle is driven by observation: each immediate or bounded
`workspace_agent_run_status` call on such a run advances the same lifecycle,
which requests canonical committed-slice integration for a committed delivery,
performs later canonical lifecycle writes, and mutates integration refs through
the trusted runtime. It prepares no review surface and dispatches no review. It neither mints nor repairs the commit-time
implementation-to-review transition. Historical-attempt and detail reads are
pure observation; ordinary current-attempt status may be state-advancing.

Its closed request is
`{repo?, subject, attempt_id?, timeout_ms?, include_final_result?, detail?}`.
The canonical dispatch subject parser owns `subject`. `attempt_id` is an existing
backend run id used only to disambiguate a caller-visible retained attempt; it
grants no authority. Omitted timeout performs one immediate observation. An
explicit timeout is an integer from 1 through 300000 milliseconds and returns
`settled:false` on expiry without cancelling or changing the run. The retired
public list and wait operations, global filters, obsolete status parameters, and
handle-only continuations are not accepted compatibility surfaces.

`detail` is `{kind:"failure_history",cursor?,limit?}`,
`{kind:"attempts",cursor?,limit?}`, or
`{kind:"proof_verification",cursor?,limit?,invocation_id?}`. The default limit is
20 and the accepted range is 1 through 100. Detail plus timeout refuses before
effects, and `invocation_id` refuses when combined with `cursor` or `limit`.
Detail reads are snapshot-paged from the immutable journal prefix and never
advance lifecycle state. Cursors bind repository, subject, attempt, detail kind,
prefix, and offset.

### Recorded explicit proof verification

Each `workspace_verify_proof` call made by an authenticated managed worker is
retained for that worker's attempt. The recorded facts include:

- the call's result or modeled refusal, including timeout and cancellation;
- the original launcher binding identity and the retained dispatch tuple;
- the requested selection;
- the tested source snapshot, contract generation and case revisions.

Accepted-status observation of a managed worker slice carries a compact
`proof_verification` fact:

- `recorded` with exact outcome and status counts, a callable detail read, and
  one `last_recorded_invocation` selected by greatest journal sequence inside
  the selected attempt and observed snapshot;
- `none_recorded`, which means no explicit call is recorded and is not a pass;
- `unavailable` with a code when the journal cannot be read or selected. It is
  never reported as an empty record.

`detail: {kind:"proof_verification"}` lists every recorded call with its
server-minted `invocation_id`. Adding that `invocation_id` reads the one
recorded call:

- An aggregate comes back as a fresh evidence reference readable through
  `workspace_read_mcp_content_reference` in the observing session.
- A modeled refusal comes back inline.
- Corrupt or missing cached bytes refuse with
  `verify_proof_cache.record_corrupt.v1` or
  `verify_proof_cache.record_unavailable.v1`.

The last-invocation observation carries the exact invocation, event and record
identity; requested and assigned unit; outcome, status and reason; selected
proof count (including zero, or `null` when unavailable); and the verifier's
compact original tested-source identity or `null`. It omits source case arrays
and links to the exact invocation detail. It is the last recorded observation,
not a current-delivery verdict: a source snapshot or proof-run candidate is not
replaced by a delivery commit, repeated selected counts are not summed, and a
successful selected proof is not whole-contract acceptance. Its coverage is
`requested_selection_only` and `grants_authority` is always false.

When several obligations explicitly share one verification and saved case, one
explicit invocation executes that case once and evaluates a separate result for
every selected obligation relationship. The retained aggregate preserves all
relationship identities, denominators, diagnostics, selected-unit identity,
case revision, proof-run candidate and source snapshot. A conflict confined to
one relationship does not erase a valid sibling; a shared-definition conflict
names every affected participant and its original reason. Listing status or
reading invocation detail only returns the journaled aggregate and never starts
another execution.

The retained-record reader is a read-only leaf over the authenticated primary
workspace and the verification descriptor already selected by the attempt
journal. Loading that reader or the proof-verification detail projection does
not load proof authoring, candidate preparation, runtime-authority minting,
provider execution or recording entrypoints. The caller cannot supply a durable
state root. The invocation path remains the sole owner of authentication,
execution, result persistence and later journal publication.

An unavailable observation keeps its compact state and code, plus the complete
diagnostic from the failed journal observation with the operation, stage,
subject and attempt identity. The ordinary response boundary delivers that
diagnostic inline or through its existing content-reference spill path. An
invocation-detail delivery failure similarly preserves the failed persistence
result and invocation identity, and advertises no evidence reference when no
readable reference was created. Unknown producer codes do not remove the
captured message, stack, path, metadata or nested cause.

Observation, restart and lifecycle settlement never execute, repeat or schedule
verification. A recorded result covers only its requested selection. It is
worker evidence, not independent verification, and it grants no review,
admission, integration or completion authority. The retention mechanics are in
[MCP Operation Reference](mcp-operation-reference.md#recorded-managed-worker-proof-verification).

### Findings run observation is process-local

Every accepted reviewer or redteam call registers its fresh run and monitor in
the current backend before the accepted live handle is returned. Status
may observe that exact action while the process owns it. They do not read a
receipt to select a result, elect a replacement, resume execution, repair
settlement, or reconstruct another action.

After process restart an old findings handle may truthfully return unknown. A
later dispatch is always a new independently authenticated action even when its
subject, source, generation, role, and request are identical. Prior runs,
receipts, results, failures, roles, or metadata cannot satisfy, suppress, veto,
replace, resume, or refuse it.

Logs, receipts, outcomes, and provenance may be retained as optional audit
evidence for the action that produced them. Audit capture or append failure has
no dispatch authority and cannot prevent another call. This process-local rule
does not alter managed implementation-worker monitoring, integration settlement,
or their implementation-owned recovery paths.

Public terminality therefore splits in two. `terminal` is true only when the
complete managed run is finalized — the child terminated and its post-worker
lifecycle reached the `finalized` phase. `child_terminal` reports only that the
dispatched child process ended, and can never make an unresolved
pre-integration run look final. Child completion evidence
(`status`, `exit`, `final_result`, `review_result`) describes the child and does
not contradict `terminal:false`.

Everything below is monitoring vocabulary only: it grants no authority and does
not change review, integration, or candidate semantics. When no managed
post-worker lifecycle applies at all — a reviewer, a redteam session, a
non-slice subject — `terminal` equals `child_terminal` and no
`lifecycle_resolution` is returned.

### Field meanings for a child-succeeded, lifecycle-unresolved run

| Field | Meaning |
| --- | --- |
| `status` | the **child's** lifecycle vocabulary, unchanged (`succeeded` here means the child succeeded) |
| `child_terminal` | `true` |
| `terminal` | `false` |
| `settled` | whether this observation call settled before its explicit bound; it is separate from child/run terminality |
| `exit`, `final_result`/`final_result_summary`, `review_result` | **child** completion evidence; none of it contradicts `terminal:false` |
| `updated_at` | backend-reported update time for the **child** run; lifecycle progress does not advance it |
| `next_action` | `retry_wait_or_check_status` — observe the same subject and optional attempt again; never relaunch. Every unresolved managed state can advance through observation |

Unresolved runs also carry a `lifecycle_resolution` projection
(`workspace-agent-run-lifecycle-resolution.v1`) with `resolved:false`, the exact
lifecycle `phase`, `integration_complete:false`, the latest retained typed
failure, the bounded retained-failure list, bounded/saturating attempt metadata,
and an actionable lifecycle `next_action`
(`resolve_lifecycle_failure_then_retry_run_status`,
`retry_run_status_after_exact_slice_commit`, or `retry_wait_or_check_status`).
`integration_complete:false` holds in *every* unresolved projection whatever
intermediate Git state a diagnostic envelope reports: an unresolved run never
claims integration and never authorizes review, integration, retirement,
candidate construction, or publication.

The managed post-worker lifecycle has no review boundary. Observation of a
terminal worker with a committed delivery requests integration itself (see
[post-worker delivery without built-in review](mcp-dispatch-managed-run-lifecycle.md#post-worker-delivery-without-built-in-review)),
so no response carries a reviewer-dispatch request, a slice-review surface, or a
closeout continuation that asks for integration or review. The closeout
continuation is published only after an explicitly dispatched terminal findings
action, from current terminal-candidate publication state. Constructing it reads
no historical findings result, receipt, or provenance; dispatches no reviewer;
integrates nothing; and does not recover, replay, or replace any action.

Reviewer and redteam results are text-first. The complete captured text returned
by the original run remains usable if a restart later makes its process-local
monitor unknown. That condition requires no evidence append, provenance repair,
reauthentication, retry, replacement, or operator recovery and does not affect
ordinary coordinator disposition or closure. Schema diagnostics affect only
formal metadata derived in the original result; they never change text usability
or automatic lifecycle posture. Ordinary reviews report
`formal_attestation.requested:false`. When the canonical selected result contract
is `schema_constrained`, the original settlement derives and durably publishes the
existing formal attestation or reports its precise unavailability; monitoring
never offers a second append or repair route.

### Full final-result and compact advisory reference contract

Every object-shaped `final_result` published by `workspace_agent_dispatch` or by
the complete mode of `workspace_agent_run_status` uses
`workspace-agent-public-final-result.v1`.
When the internal source has its own `schema_version`, the public result retains
it as `source_schema_version`. Null, absent, and other nonobject result states
keep their existing representation.

The public projection considers only these own string-valued members, in order:

1. `final_result.full_response.text`
2. `final_result.advisory_review.advisory_output.text`
3. `final_result.findings.text`
4. `final_result.no_findings.text`

The first occurrence of each distinct JavaScript string stays at its original
member. A later exactly equal string is replaced at its parent by
`text_reference:{member,reason:"duplicate_text"}`, where `member` is the full
dotted path to the retained string. References are direct: they never point to
another reference and require no additional retrieval call. Equality performs
no trimming, Unicode normalization, coercion, parsing, or hash-only comparison.
An empty string is eligible; missing, null, and non-string values remain
unchanged. Text nested elsewhere, including structured finding text, is not
examined.

`text_projection` reports `source_text_count`, `distinct_text_count`, and
`omitted_text_count` over those four slots. For example, this abbreviated
result retains two distinct strings from three source strings:

```json
{
  "final_result": {
    "schema_version": "workspace-agent-public-final-result.v1",
    "source_schema_version": "workspace-agent-dispatch-final-result.v1",
    "full_response": { "text": "same" },
    "advisory_review": {
      "advisory_output": {
        "text_reference": {
          "member": "final_result.full_response.text",
          "reason": "duplicate_text"
        }
      }
    },
    "findings": { "text": "different" },
    "text_projection": {
      "source_text_count": 3,
      "distinct_text_count": 2,
      "omitted_text_count": 1
    }
  }
}
```

Status remains compact by default. `include_final_result:true` requests the
complete public result; compact mode instead returns
`final_result_summary`. A compact advisory output keeps its existing
`content_reference` descriptor and `complete_mode:{include_final_result:true}`.
Its `member` names the actual retained string in the requested complete result,
which may be `full_response.text` when the advisory text is an equal later
occurrence. This compact descriptor is not a full-result `text_reference`.

Projection changes neither advisory usability nor lifecycle, enforcement,
provenance, digest, or formal-attestation facts. It does not authenticate or
recompute evidence, mutate internal settled results, perform I/O, or make
backend calls. If the shared MCP response-size boundary spills a complete
logical response, `workspace_read_mcp_content_reference` still reconstructs
those already-projected JSON bytes exactly; transport spill references are
separate from both reference forms above.

For a managed worker, synchronous terminal capture precedes the journal
publication await. The complete normalized report, original response,
provenance, and write-scope evidence are published once per attempt before the
result enters post-worker settlement or status claims crash durability. An
identical replay is a no-op and conflicting bytes refuse. Publication failure is
explicit and leaves the captured hot bytes available for retry; cold observation
with no committed report returns report unavailable rather than fabricating
completion. Immediate and bounded observations report the same durability facts,
so neither feeds an unpublished report into post-worker settlement.

A transient lifecycle failure is retained on the run's checkpoint, so it does
not disappear from the projection on a later poll that happens to succeed into
another unresolved phase. Retained-failure storage is a fixed-size ring
(currently five entries): beyond the bound the oldest entries are evicted and
the latest failure is always kept, so polling cannot build an unbounded in-memory
preview. One lifecycle attempt is one recorded failure however many callers
observed or abandoned it. The ring is only a cache: exact totals and complete
history beyond five entries derive from committed `lifecycle_failure_recorded`
journal events, each bound to the invocation id minted at the shared seam.

Once the lifecycle is finalized status replays a byte-stable terminal
projection: `lifecycle_resolution` becomes the constant
`{resolved:true, phase:"finalized"}` with no per-attempt state, and
`slice_lifecycle` replays the same memoized finalized result. **A finalized
projection is the only stable terminal result**: every other projection is
provisional and may change on the next call.

### Terminal-candidate authored contracts are published as identity

A fresh final integration whose canonical record designates a terminal review
unit prepares a terminal publication candidate, and that candidate's frozen
review unit holds two whole authored documents: `canonical_parent_wk_contract`
(the canonicalized parent work record, including its acceptance, scopes,
sections and **every sibling slice**) and `review_unit_contract` (the designated
review slice). Both are backend authentication evidence, not run-observation
state, and neither was ever governed by `include_final_result`.

`slice_lifecycle.terminal_candidate.review_unit` therefore publishes their
**identity plus the read that reproduces them**, on every value of
`include_final_result`:

```json
{
  "record_id": "work record",
  "slice_id": "SLICE-001",
  "subject": "work record",
  "contract_source": "exact_candidate_tree",
  "authored_contracts": {
    "schema_version": "workspace-agent-run-status-authored-contract-projection.v1",
    "projection_scope": "terminal_candidate_review_unit_authored_contracts",
    "reason": "authored_contract_body_is_not_run_observation_state",
    "grants_authority": false,
    "evidence_class": "historical_attempt_snapshot",
    "current_record_read_is_equivalent": false,
    "source_member_count": 2,
    "returned_member_count": 0,
    "omitted_member_count": 2,
    "omitted": [
      {
        "member": "canonical_parent_wk_contract",
        "document": "canonical_parent_work_record_including_every_sibling_slice",
        "digest": "sha256:...",
        "utf8_bytes": 52091
      }
    ],
    "retrieval": {
      "state": "retained",
      "source_schema_version": "selected-response-source.v1",
      "ref_id": "resp-...",
      "sha256": "...",
      "binding": {
        "route": "workspace_agent_run_status",
        "repository": "agent-chassis",
        "unit": "work record",
        "observation_identity": {
          "attempt_id": "...", "monitor_handle": "...", "subject": "work record",
          "candidate": "...", "candidate_ref": "...", "base": "...", "wk_tip": "...",
          "candidate_schema_version": "terminal-wk-candidate.v3", "candidate_version": 1
        }
      },
      "carrier_members": ["canonical_parent_wk_contract", "review_unit_contract"],
      "reconstruction": ["…"],
      "retained_source_read": {
        "tool": "workspace_read_mcp_content_reference",
        "arguments": { "ref_id": "resp-...", "offset": 0 }
      }
    },
    "current_candidate_status_observation": {
      "answers": "whether the live canonical contract still agrees with the current candidate",
      "binds_historical_candidate": false,
      "reconstructs_omitted_members": false,
      "call": {
        "tool": "workspace_terminal_review_candidate_status",
        "arguments": { "repo": "agent-chassis", "wk_id": "work record" }
      }
    }
  }
}
```

Each omitted member keeps a `sha256` digest of the exact omitted UTF-8 bytes and
that byte count, so its identity stays verifiable and a consumer can tell whether
two observations saw the same frozen document.

#### Retrieving the omitted documents

The observation retains the two strings **verbatim** through the incumbent
[selected-response source](mcp-selected-response-details.md#retained-source)
transport: one `selected-response-source.v1` envelope whose `carrier` holds them
under their own member names, and whose `binding` pins the server-resolved
repository, the observed unit, and the exact attempt and candidate this
observation saw. `retrieval.retained_source_read` is that envelope's first byte
range through `workspace_read_mcp_content_reference`; following its own
`next_offset` until it is null, base64-decoding **each page separately**,
concatenating the decoded bytes in page order, verifying `sha256` over them and
parsing the result yields `carrier.<member>` byte-for-byte, Unicode included.
Each page is encoded on its own, so a non-final page whose byte length is not a
multiple of three carries its own padding: joining the encoded strings and
decoding once corrupts the source. `retrieval.reconstruction` states these steps
in the response. The call names no `length`:
the reader applies its own per-call bound and reports `total_bytes` and
`max_length` on its first page, so how many ranges the source takes comes from
that owner rather than from a second copy of its configuration. Each omitted
row's `utf8_bytes` already says what the document itself costs.

Retrieval reads only those retained bytes. It re-reads no canonical record and
resolves no candidate, so a later candidate, a re-authored record or a moved WK
tip cannot be substituted for them: a later observation retains its own source
and the earlier locator keeps answering with the earlier bytes. A retained
artifact is an ignored transport file, not canonical evidence, review material
or lifecycle authority, and it carries only the durability the response-spill
state directory already provides — no restart guarantee is added. A missing,
evicted or corrupt reference produces that reader's own registered refusal
(`mcp_response.content_reference_ranged_read_unavailable.v1`), never a
substitution from current state, and the published `sha256` makes tampering
detectable by the caller.

One observed state retains one artifact: retention is memoized per registration
on the repository, unit, attempt, candidate and the digests of the two strings,
so repeat and concurrent observation of a finalized attempt reuse the same
locator instead of minting a spill file per call. When retention is
unavailable — no source was retained, or the spill failed — `retrieval.state` is
`unavailable` with the failing code, and no current read is offered in its place.

`current_candidate_status_observation` answers a **different** question, against
**current** state: whether the live canonical contract still agrees with the
current candidate. It carries its repository explicitly, and
`binds_historical_candidate` and `reconstructs_omitted_members` are both `false`
— a WK-id lookup neither pins the historical candidate nor reproduces the omitted
bytes. `current_record_read_is_equivalent` is `false` for the same reason:
reading the canonical record gives the repository's current contract, not the
snapshot the candidate tree froze.

This is a two-member replacement by exact name. Every other member of the review
unit, the candidate, and the lifecycle envelope — including members added later —
is published unchanged; nothing is recursively stripped and no unknown field is
suppressed. The projection itself is pure: retention is performed at the status
publication seam and handed to it as a value, so a finalized lifecycle still
replays byte-stable.

### The integration receipt publishes the written record as identity

Canonical committed-slice integration completes its record transition through a
compound record CAS, and that writer's result carries the **whole canonical work
record it just published**. The integration result publishes that result verbatim
as `integration.transition`, so `slice_lifecycle.integration.transition.record`
echoed the entire authored WK — every sibling slice's acceptance criteria and
scopes, every coordination entry, and the authored
`proof_posture.classification_rationale` — on every settled observation of that
run, at whatever size the record had grown to.

That body is authored content, not integration-receipt state. The receipt keeps
saying what the transition **did**; `integration.transition.written_record`
replaces the body with the record's identity and the read that reproduces it:

```json
{
  "valid": true,
  "written": true,
  "written_record": {
    "schema_version": "workspace-agent-run-status-integration-receipt-projection.v1",
    "projection_scope": "integration_transition_written_record",
    "reason": "authored_record_body_is_not_integration_receipt_state",
    "grants_authority": false,
    "evidence_class": "historical_attempt_snapshot",
    "current_record_read_is_equivalent": false,
    "omitted": {
      "member": "record",
      "document": "canonical_work_record_written_by_this_integration_transition",
      "carrier_member": "integration_transition_record",
      "record_id": "work record",
      "record_schema_version": "work-record.v1",
      "record_status": "review",
      "slice_count": 4,
      "digest": "sha256:...",
      "utf8_bytes": 34619
    },
    "retrieval": { "state": "retained", "…": "as above" }
  }
}
```

`record_status` is the effect this receipt is a receipt of: the parent status the
write published. `record_id`, `record_schema_version` and `slice_count` identify
what was written, and `digest`/`utf8_bytes` describe the exact omitted UTF-8
bytes — the serialization retained under
`carrier.integration_transition_record`, which `JSON.parse` returns to the
written record structurally unchanged. Every other integration fact a consumer
verifies delivery with — `integrated`, `slice_sha`, `wk_sha`, `review_target`,
`slice_ref`/`wk_ref`, the lifecycle phase, dependency evidence, readiness
decision code, worktree paths, proof gaps, failure codes and `next_action` — is
untouched.

This is a **one-member replacement by exact name** on a different branch from the
terminal-candidate contracts above; neither projection covers the other, and a
transition that carries no record (an already-consistent no-op, a recovered
zero-delta replay, or a per-slice status write) is published exactly as it
arrived, with no projection limb invented for it. A `record` member that is not
an object is likewise published unchanged.

One observation retains **one** artifact for both branches: when an envelope
omits the two frozen contracts and the written record, all three travel in the
same `selected-response-source.v1` carrier under their own member names, and
each limb publishes its own complete retrieval so either can be acted on without
reading the other. `retrieval.carrier_members` lists every member the artifact
holds. Repeat and concurrent observation of one finalized attempt reuse that
locator rather than minting a spill file per call, and observation adds no
lifecycle attempt, integration effect or verification.

Retrieval reads only those retained bytes, so a later slice integration, a
re-authored record or a moved WK tip cannot be substituted for them:
`current_record_read_is_equivalent` is `false` because reading the canonical
record today gives the repository's current contract, not the snapshot this
transition wrote. When retention is unavailable, `retrieval.state` is
`unavailable` with the failing code and no current read is offered in its place.

Measured over a reproduced four-slice record, the default settled response falls
from 149,328 to 17,464 complete-frame bytes (88.3%); over the same fixture with
63KB of additional unrelated authored text it falls from 485,520 to 17,468
(96.4%) — the default answer does not scale with authored text at all. The cost
is moved, not removed: a caller that asks for the complete omitted record pays
for it through the ranged reader, in base64 across two channels.

The original live worker monitor recognizes the coordinator's completed
integration by the immutable delivery identity shared by review and integration
admission. Review admission still binds the retained slice worktree, while the
coordinator integration admission deliberately omits it; their worktree-specific
`committed_target_digest` values therefore remain distinct and retain their
existing authentication meanings. That path difference does not strand the
original monitor or send it through cold recovery. After the exact integration
settles, concurrent status calls coalesce on the same continuation and
finalize without repeating integration or dispatching a reviewer. If a prior
pre-integration attempt failed before retaining that review context, the same
live backend instead joins its launcher-owned completed-delivery index to the
original monitor's retained run, handle, retry, base, scope, and ref identity.
Only a matching successful integration supersedes the provisional failure;
unmatched, in-flight, refused, and post-restart observations retain their existing
unresolved or durable-recovery behavior.

### What bounded `workspace_agent_run_status` waits for

An explicit `timeout_ms` bounds the **whole call**. The route waits for the child, and then
keeps waiting on the same deadline for the
managed lifecycle to finalize. It does not return the moment the child exits, so
the ordinary repeated bounded-status pattern cannot become an
immediate-retry spin. Three outcomes:

| Outcome | Response |
| --- | --- |
| Managed run finalized | `terminal:true`, `settled:true` |
| Window expired, nothing in flight | `settled:false` for the same subject and optional attempt id, with `child_terminal` reporting which wait ran out (`false` — the child was still running; `true` — the child finished and its lifecycle did not resolve in time) and a `lifecycle_resolution` when one applies |
| Window expired with an attempt still running | `settled:false` and `lifecycle_resolution.advance_in_flight:true`. Nothing was cancelled; see the next section |

A harness or client may background the still-running tool call when its own
foreground display or wait bound expires. That is not a server response and is
not the `settled:false` outcome above. Continue or resume the same pending
call/task identity until it actually returns; do not submit another status
request merely because the original call was backgrounded. After a response has
actually returned `settled:false`, a later status call uses the same subject and
optional attempt id under the timeout and cancellation rules below. This
distinction does not assume a particular harness duration or create a new
transport.

A run not yet integrated is polled within the window exactly as a still-running
child is, and remains bounded by `timeout_ms` rather than being retried after the
response. `settled:false` is never a failed child or a failed run: call status
again with the same subject and optional attempt id and do not relaunch.

### One lifecycle attempt per explicit request

One explicit `workspace_agent_run_status` request starts or joins **at most one**
lifecycle attempt. Concurrent observers share the one in-flight attempt, a caller
that stops waiting at its deadline neither cancels nor replaces it, and a request
that already had its attempt never joins a replacement another caller started.

When that attempt fails, the request's automatic polling ends and the response
carries the retained failure. A bounded request therefore produces one invocation
and one failure event, not one per polling interval. Progress comes from the
coordinator making another explicit request, which carries its own bound.

A later explicit request decides whether to attempt again from the failure's own
class, published on `lifecycle_resolution.retry_assessment`:

| `failure_class` | Decision |
| --- | --- |
| `deterministic` | The producing owner supplied an explicit correction condition. It is re-checked through that same owner. Unchanged relevant inputs return the retained failure with no integration attempt and no duplicate failure event; changed inputs permit one fresh, fully authenticated attempt |
| `unknown` | The cause and its correction condition are unknown to this runtime. Automatic retries stop, and a later explicit request makes one fresh, fully authenticated attempt |

Today the only deterministic class is the committed-slice admission owner's
`trusted_commit_scope_mismatch`, whose correction condition is a change in the
inputs its shared scope interpretation consumes: the subject, the effective
canonical write scope, the authenticated diff base, that base's root tree — the
object membership is resolved against, reported so the compared inputs describe
the resolution rather than implying it — or the reviewed SHA. The re-check
re-derives all of them through that same owner, membership included. A familiar
error code alone never makes a failure deterministic.

`retry_assessment` is advisory reporting. It carries `grants_authority: false`,
it is never derived from published error text, a diagnostic projection, a journal
observation, or a caller-authored object, and it never predicts that an attempt
will succeed: a permitted attempt re-runs every binding, commit-chain, scope,
generation, CAS, and configured-CCE check, and may refuse again. An assessment
that cannot be completed is reported as uncertainty (`decision:
"correction_unknown"` with its captured cause) and permits the one bounded
attempt; it latches nothing, so a later request assesses again. Restart clears
the process-local facts and is not evidence of correction: the first request
after a restart makes one attempt that re-authenticates from scratch.

Failure history and the other `detail` pages stay read-only, and the counts they
report track real attempts: a retained failure returned without a new attempt
adds no event and does not advance `failure_attempts`.

## Monitor calls are bounded; lifecycle attempts are not interrupted

For an already registered managed attempt, both immediate and bounded status bound the whole
call, and the bound covers the backend status read, post-worker lifecycle
advancement, and the advisory closeout continuation while the one underlying
lifecycle task continues without cancellation. Cold-restart unknown-handle
recovery is different: the route applies its remaining deadline when it awaits
recovery work that has yielded, but recovery's synchronous filesystem and Git
probes run before a JavaScript timer can settle and cannot be preempted by that
timer. Those probes therefore have no hard wall-clock preemption guarantee and
remain outside the registered-attempt boundedness claim.
An explicit `timeout_ms` is an integer in [1, 300000] and is refused rather
than clamped. When omitted, status performs one immediate observation under the
same server-owned mechanical budget. The accepted range and budget have one code owner,
`packages/wiki-mcp/src/lib/dispatch-monitor-call-deadline.mjs`, alongside the
deadline primitive itself, so the two routes cannot come to enforce different
windows while both descriptions still advertise one. The backend
child wait receives the caller's bounds verbatim and answers a still-running
child without changing its state; the whole-call stop sits
just outside that window, so it catches only a backend that does not honor its
own bound.

The bound is a bound on *waiting*, never on the work. A post-worker lifecycle
attempt — host-delegated integration, slice-review preparation, terminal
candidate materialization — routinely outlives any window a coordinator would
pass, and it owns canonical status writes and trusted-runtime ref mutation, so
interrupting one mid-flight is precisely what must never happen. When the
deadline expires with an attempt still running, the route stops awaiting it and
publishes an unresolved projection carrying `advance_in_flight:true` with
`next_action: "retry_wait_or_check_status"`. The attempt continues, the run is
untouched, and the correct response is another status call on the same subject
and optional attempt id.

Exactly one lifecycle attempt is in flight per run, and one explicit request
starts or joins at most one of them. Concurrent and repeated monitor calls
coalesce onto it, and it retires itself when it settles rather
than being retired by whichever caller happened to be listening — so a caller
that stops waiting (a cancelled or abandoned RPC) cannot cause a second
concurrent attempt, and cannot leave later observation blocked behind the first.
Status therefore never duplicates, cancels, or relaunches a dispatched worker,
and the exact-run authority of the attempt itself is unchanged.

The normal registered-attempt exact-slice preparation path resolves only its
single slice-tip commit fact and two tree facts in closed Node children. The
child accepts the two fixed operation kinds
`resolve_commit` and `resolve_tree`; the existing lifecycle bindings continue to
own fixed Git argv, OID validation, and typed error normalization. Preparation,
canonical transitions, context binding, reviewer launch, checkpoints, stores,
failure recording, retry control, and every Git/ref mutation remain in the
wiki-MCP parent. A monitor deadline stops awaiting this non-cancellable child;
it neither signals the child nor starts another lifecycle attempt.

and connector Node executable into the client's bubblewrap namespace. Each
## Wiki-MCP boundary

See [MCP integration](mcp-integration.md#transport). Each authenticated MCP
command invocation gets its own host wiki-MCP process. The
client completes initialize plus tools/list against the exact role tool profile.
The wiki-MCP server and its dependencies remain on the host.

Candidate validation is launcher-owned and executes inside a findings-only
reviewer bwrap composition. Its child process starts from an empty,
fixed, secret-free environment with fresh private `HOME`, `XDG_CONFIG_HOME`, and
`TMPDIR`. When a dependency projection is available it sees ordinary project
dependencies through a read-only mount, and workspace links resolve against the
exact reviewed checkout rather than another worktree. No
dependency installation or copying occurs, and no wiki-MCP package,
interpreter tree, server, broker, listener, or transport is added to the
candidate checkout or bubblewrap namespace.

Project dependencies and project-test execution are optional capabilities of the
terminal cycle. Missing, stale, incompatible, or entirely absent project
dependencies affect only whether declared project tests can execute; they never
refuse exact terminal reviewer launch, lifecycle continuation, or forge handoff.
There is no candidate-versus-installed-dependency comparison anywhere in candidate
validity: no manifest byte equality, no lockfile equality, no workspace-manifest
equality, no install-marker equality or freshness, no dependency-root freshness, and
no requirement that a projection or a project-test command be available. A candidate
whose `package.json`, lockfile, or workspace manifest differs from the landing
checkout is the ordinary result of a WK that touched dependencies, and it is exactly
as valid as one that matches. A declared validation target that is absent from the
candidate, or not a runnable Node file, is recorded as unavailable on the advisory
evidence rather than refused. Reviewer launch with no dependency projection binds no
dependency source at all and never substitutes the mutable landing checkout's
`node_modules`; lifecycle continuation likewise requires no validation evidence, no
successful project test, and no installed dependency tree. Under `decision` and
`decision` this layer renders no admissibility, eligibility, readiness,
review-required, test-required, quality, mergeability, or publication judgment, and
the configured CCE contract is unchanged by any of the above.

When a projection *is* selected, its mount validity is mechanical and mandatory.
Reviewer dependency projections are immutable, physically
verified, atomically published, and restart-safe. Their identity binds the
normalized projection base and exact reviewed checkout to a digest of the complete
projected dependency-entry plan — the exact set of sources the mount exposes, which
names a mount rather than judging dependency compatibility. Construction occurs in a
private sibling
directory; the launcher rechecks the entry plan, makes the projection
read-only, syncs its metadata and directory, then publishes it by atomic rename.
Concurrent builders either publish that same content-addressed generation or
verify and reuse the winner.

Directory presence alone is never projection authority. Every reuse verifies
the closed identity metadata, exact entry set, entry types and link targets,
read-only modes, and a fresh installation snapshot. A legacy stale directory is
ignored, an interrupted private build is never mounted, and an invalid partial
published generation is atomically quarantined and rebuilt without deleting
canonical dependencies or other valid generations. If installation state moves
during construction or verification, the launcher retries against the new
digest; when it cannot obtain a stable snapshot, or the dependency path is
redirected or unavailable, no projection is selected and the cycle proceeds without
a dependency mount. Omitting an invalid or unstable projection preserves the
documented optional-mount semantics. Immediately
before every spawn, a selected mount's exact source path, real path, read-only mode,
and closed identity metadata are rechecked against the recorded projection identity;
a swapped, writable, or redirected mount refuses.

The same selector and integrity owner applies independently to every immutable
findings checkout: standalone canonical snapshots, launcher-normalized canonical
delivery ranges, exact-slice findings, and terminal findings. Public SHA scalar
locators are refusal-only and never select a checkout. Each action
records its own `workspace-agent-findings-dependency-projection-evidence.v1`
execution fact and re-verifies the selected or unselected state, enumerated
unavailability reason, projection and installation digests, retained root, exact
mount destination, and frozen read-only bind plan. Another action's dependency
evidence cannot select, satisfy, suppress, resume, or refuse the current call.

A selected projection is mounted read-only at the exact `<candidate-checkout>/node_modules`
path. Because that checkout is read-only inside the reviewer sandbox, the shared
launch planner materializes exactly that empty untracked mountpoint before
confinement, pins its path, directory type, and filesystem identity, and
re-checks them immediately before spawn for both Codex and Claude. A symlinked,
redirected, non-directory, non-empty, tracked, preexisting-untrusted, type- or
identity-swapped destination, or a writable/runtime bind overlapping the
checkout, mountpoint, or dependency source, refuses before spawn. The mountpoint
is the only permitted checkout addition, and it is created only when a projection was
actually selected; the candidate commit, tree, tracked
state, refs, index, Git metadata, and projected dependency contents remain
byte-identical, and neither the checkout nor the dependency source is made
writable. With no projection selected the checkout gains no addition at all.

## Trusted operation ownership

| Operation | Owner |
| --- | --- |
| `start_launch` | launcher runtime, in-process |
| `probe_run` | launcher runtime, in-process |
| `provision_worktree` | launcher runtime, in-process |
| `prepare_slice_review_surface` | launcher runtime, in-process |
| `integrate_slice` | launcher runtime, in-process |
| `prepare_terminal_candidate` | launcher runtime, in-process |
| `validate_terminal_candidate` | launcher runtime, host-side and in-process |
| `bind_terminal_candidate_review` | launcher runtime, in-process |
| `commit_slice` | host wiki-MCP server, in-process and closed-input |
| `wk_forge_handoff` | launcher-owned host executor, invoked in-process |

Every failure is returned in the structured dispatch or runtime-blocker
taxonomy. There is no compatibility route to another process boundary.

`wk_forge_handoff` receives only backend-resolved current candidate state: the
current candidate, its exact authenticated version or controlled generation, its
base, current forge facts, and any applicable authenticated CCE decision.
Findings receipts, results, and provenance are neither eligibility inputs nor
forge inputs. Clean output does not authorize publication, findings do not veto
it, and absent, severe, invalid, failed, or missing historical output cannot
change eligibility or the complete forge request. Retained review evidence may
remain optional audit data after the mutation boundary. The orchestrator request
is also non-authorizing. CCE alone
decides a configured organization-policy gate bound to exact `C/B/W`; missing,
unavailable, malformed, unratified, denied, or target-mismatched CCE evidence
fails closed. Paid-tier presence alone configures no gate. With no configured
gate, decision free-substrate publication proceeds with an explicit non-audit
posture. The host publishes exact `C` against the configured base branch without
merge-base calculation, merge-tree, commit-tree, replay, rebase, squash, amend, or
other reconstruction; it does not require `C`'s parent to equal the current
base-branch tip and does not preflight or locally resolve merge conflicts. The
exact remote candidate branch is observed around publication as forge transport
integrity. Movement of the current landing after `C` was constructed neither
changes `C`'s frozen base parent `B` nor blocks publication; git/forge and the
configured merge actor own merge readiness, so a conflicting or unmergeable PR is
still a successfully handed-off exact candidate. Absent candidate
branches may be created, exact branches reused, and differing branch targets are
reported as transport disagreement. Handoff observes the exact
repository/base/head proposal set and creates at most one pull request when none
exists, recovering a single exact open or already-merged proposal without
duplication; an ambiguous, identity-mismatched, closed-unmerged, or unobservable
proposal state refuses. Mergeability is never a local veto — an exact open but
conflicting or unmergeable proposal is still a successful handoff — and merging,
approval, rebasing, branch updating, and conflict resolution remain with the
configured forge and human merge actor. The
operation does not merge.

Loss of process memory, a monitor handle, or a prior in-memory binding does not
invalidate the terminal cycle. On restart, trusted runtime first reads exactly the
fixed `refs/agent-launch/terminal-current-v2/<WK>` ref. When present, it
mechanically verifies the target. Immutable `C` metadata binds repository
identity, the base `B`, `W`, the canonical contract digest, expected tree, and
sole parent. Recovery hashes the complete deterministic commit bytes in the
repository object format and compares that identity with the current-ref target
while `W` remains unchanged. Current landing movement is not candidate movement
and is never consulted: frozen `B` comes from `C`'s verified sole parent (the
candidate's `Base:` metadata line), never from current landing or a computed merge
base. Present-ref recovery does not invoke `commit-tree`, create an object, move a
ref, or compare current WK status, dependencies, or record bytes with the frozen
contract. A v1 candidate — whose message marker and landing parent differ — fails
the v2 metadata reader and is never recovered as a valid v2 candidate.

An absent fixed current ref means no candidate is currently published for this WK.
It does not mean the WK has no durable identity. The launcher mints
`refs/agent-launch/wk-forks/<initiative>/<WK>` when the persistent WK is allocated
and never moves it, and `refs/heads/wk/<initiative>/<WK>` accumulates the WK. When
BOTH survive, cold recovery RECONSTRUCTS the exact candidate the launcher owes,
from durable authority alone: `B` comes only from the fork ref and `W` only from
the WK ref, each observed as one exact direct commit-valued ref. A symbolic ref,
peeling or revision-expression resolution, an ambiguous or malformed observation,
a non-commit, zero-width, or wrong-width target, a Git fault, and movement or
deletion of either ref all refuse. `merge-base --is-ancestor` may PROVE the
observed `B` is an ancestor of `W`; it never selects one. Current landing, a
merge-base selection, the reflog, caller input, monitor memory, historical
candidate refs, and prior process state never participate, and when either durable
ref is absent there is nothing to reconstruct from and recovery keeps its stable
`terminal_candidate_recovery_current_ref_absent` verdict rather than guessing a
base. This is deterministic reconstruction of an exact candidate, not an operator,
manual, or out-of-band publication route.

The designated `terminal_whole_wk` review unit is coordination authority and may
have been added to the canonical record AFTER `W`, so a reconstruction resolves the
initiative and that unit from the CURRENT canonical validated work record and never
requires the unit — or the work-record blob itself — to exist in `tree(W)`. Product
identity is unchanged: `tree(C) === tree(W)` and `C`'s sole parent is `B`.

A reconstructed candidate is an explicitly versioned
`agent_launch.terminal_wk_candidate.v3` object. The established v2 `Contract:`
meaning — the digest of the record blob inside the candidate's own tree — is not
reinterpreted; a v3 candidate instead names its binding in its own immutable
`Review-Unit:` and `Review-Contract:` fields, which bind the addressed review unit
and that unit's authored review contract. The two metadata blocks are mutually
exclusive, so an already-valid v2 candidate keeps its bytes, its version, and its
read-only recovery, and no candidate is ever read under the other version's
meaning. A v3 recovery re-observes both durable refs, and refuses when the
canonical record designates a different terminal review unit than `C` committed
to; the bound contract digest stays immutable historical evidence and is not
re-compared against live coordination state, so the authenticated `todo -> review`
movement of the bound unit still recovers.

Publication uses one `git --no-replace-objects update-ref --no-deref --stdin`
transaction: it verifies the captured durable bindings and then either creates the
fixed ref with `create <fixed> <C>` when it was absent or advances it with
`update <fixed> <C> <expected-old>` when it existed. Repository identity, both
durable refs, `tree(W)`, and the projected review contract are re-authenticated
immediately before publication. A reconstructed candidate uses the create form,
so a byte-identical concurrent winner for the same complete tuple converges and any
different winner refuses without being clobbered. An object created before a lost
or refused CAS is left unreachable and inert; a refusal moves no ref, mutates no
lifecycle or WK state, and creates no reviewer, executor, run, or monitor identity.

The review unit a reconstruction returns carries its honest provenance,
`contract_source: "canonical_current_record"`, because it was projected from the
current canonical record rather than from the candidate's own tree. Forge handoff
consumes only the exact candidate binding and materialization, so a reconstructed
candidate is publishable. Terminal REVIEWER admission also accepts that
provenance, and the permission comes from the ALREADY-AUTHENTICATED binding, never
from the unit: such a unit is admitted only when the candidate binding is a frozen
v3 binding carrying both immutable `Review-Unit:`/`Review-Contract:` values, and
the unit's subject, record, and slice reproduce that binding's review subject. It
is not historical evidence and none is fabricated for it, so the attempt is
authenticated against LIVE canonical coordination alone, with no lifecycle delta,
at both routing and the synchronous pre-spawn recheck. Everything else still fails
closed pre-spawn with `historical_review_evidence_is_not_launcher_owned`, leaving
`C` intact: a `review_unit` whose contracts are not launcher-owned strings, and any
candidate without that v3 binding — including every v2 candidate, whose evidence
must still be stamped `exact_candidate_tree`.

The hot post-worker lifecycle, which holds the WK identity binding's `base_sha`,
remains the constructor of a new candidate during the normal cycle: it freezes `B`
and `W`, deterministically constructs `C`, and creates or advances the fixed ref
with expected-old CAS (covering the first candidate cycle and the
restart-before-CAS path). Legacy per-candidate refs are never read, enumerated,
counted, ranked, validated, migrated, preserved, or interpreted. Any number may
remain physically present without affecting construction, review, restart, or
publication.

Construction snapshots the fixed ref's exact old value before materializing `C`,
then publishes through one `git --no-replace-objects update-ref --no-deref
--stdin` transaction. The transaction verifies the captured durable `W` binding
(`verify <wk_ref> <W>`; v3 also verifies the captured base binding) and publishes
the fixed ref in the matching form: when the candidate ref was absent, `create
<fixed> <C>`; when it existed, `update <fixed> <C> <expected-old>`. Same-input
races converge on the same deterministic object; different-input races have one
CAS winner. A crash before CAS leaves only an inert object, and a crash after CAS
is recovered from the fixed ref. If `W` advances, the next cycle constructs a new
candidate, CAS-replaces the fixed ref, and binds validation and review to that new
SHA. Evidence for the prior SHA remains advisory and does not carry forward.

The fixed ref selects the exact commit an operation addresses; it is not an
authorization state. Ref membership, candidate history, review output, validation
results, WK or slice status, dependency state, landing movement, and forge state
are not local admission or veto authority. CCE alone owns configured policy, and
the configured forge and human merge actor own proposal and merge state.

The same role-neutral reconstruction is terminal-reviewer restart admission.
Before selecting any generic findings-only route, the backend resolves the one
canonical `terminal_whole_wk` contract unit. An existing in-memory context is
used only while its exact candidate, checkout, and canonical contract still verify,
and while any mount it selected retains its pinned read-only identity. Dependency
state is not re-derived and compared against the frozen context: a dependency tree
that moved, went stale, or disappeared since the context was frozen cannot
invalidate the exact candidate or refuse reviewer launch. If that context is
absent or invalid, launcher-owned recovery re-verifies the durable
`repository/unit/C/B/W/ref/tree/sole-parent/checkout` binding from the
existing candidate, reruns the canonical validation targets through whatever
projection is available (or none), and binds the reviewer to the private detached
candidate checkout with
`B..C` as its only review range and no repository write authority. A normally
absent fixed ref is the reconstruction trigger here as well, not a fail-closed
condition: this route runs exactly the role-neutral recovery above, so it
reconstructs `C` from the two durable refs, publishes it with the create-form CAS,
and re-enters the same present-ref recovery tail, making a first cold admission and
every later one mechanically identical. It still refuses when a durable ref, the
canonical review contract, or the publication itself does not authenticate; the hot
lifecycle remains the constructor during the normal cycle.

Parent WK status does not select candidate identity, recovery authority, the
reviewer checkout, or fallback behavior. Missing process memory never permits a
canonical terminal reviewer to use `main_repo` or generic `start_launch`; any
missing, ambiguous, or disagreeing required Git fact other than normal current-ref
absence is a typed technical refusal before spawn. A genuinely standalone findings-only review unit with no terminal
candidate contract remains on its distinct ordinary route, but its launcher-minted
dispatch/attempt identity, v4 receipt, terminal settlement, and cold monitoring are
owned by the same durable receipt lifecycle. Terminal reviewer and
redteam attempts remain plural and advisory: concurrent or historical attempts,
findings, and result history neither reserve the candidate nor affect recovery
admission.

## Dispatch-readiness generated write surface

Canonical text stays on the entry page: [MCP dispatch runtime contract ›
Dispatch-readiness generated write
surface](mcp-dispatch-runtime-contract.md#dispatch-readiness-generated-write-surface).
It is not restated here, so there is exactly one copy of it on this page set.

## Hot and cold projection convergence

For managed workers, immediate status, bounded status, and cold restart recovery consume the
same composed lifecycle result. They publish the same proven-death and no-commit
retirement facts, integration continuation, controlled generation, terminal
result, receipt history, cleanup-pending state, and `next_action` for the same
exact attempt. Observation calls do not spend a retry budget and do not replay
integration; concurrent status observers share the same in-flight lifecycle or
cold recovery proof. A bounded observation may still expire honestly while that one
proof continues.

### Recovered run status ownership

`classifyWorkspaceAgentResultMode` is the sole owner of a terminal child's
result-mode classification. Cold recovery consumes it and never reclassifies:
the recovered child status is derived from the `result_mode` fact already bound
inside the retained, digest-bound result, never asserted as a literal and never
inferred from the existence of a report. The result-mode-to-status vocabulary is
owned by the neutral `agent-launch-core` dispatch-runtime leaf, which cannot
import the launcher CLI; the recovered-status envelope for the cold seam is
constructed by exactly one owner inside that seam.

That constructor distinguishes two inputs that must never be confused. A
synthetic lifecycle control is a status this seam fabricates to drive an owner
that keys on a status value — the already-integrated replay's `succeeded` exists
only to satisfy the succeeded-only post-worker gate for a slice that is already
integrated, and is not worker-terminal authority. A derived child outcome is the
launcher's own classification. A control is never derived from an outcome, and a
derived outcome is never accepted where a control is required.

Absent or unreadable outcome facts project a typed unavailable child outcome
with a capability-shaped reason (`outcome_facts_unobserved`,
`outcome_facts_unreadable`), never success and never proven death; the complete
mapping, the projected lifecycle facts for a non-success outcome, and the
invariant that no child-influenced mode discriminates success from failure are
stated in [managed-run lifecycle › Recovered child status derives from the
retained result](mcp-dispatch-managed-run-lifecycle.md#recovered-child-status-derives-from-the-retained-result).

## Findings audit evidence has no continuation authority

Findings receipts, logs, outcomes, and provenance are optional action-local audit
evidence. An audit posture may describe capture success or failure for its own
action, but it never changes terminality, selects a result, reconstructs a handle,
or publishes a retry/replacement continuation. Audit capture failure cannot block
a later dispatch. Managed implementation-worker reconciliation remains governed
by its separate implementation-owned lifecycle and durable state.

## Crash-durable state substrate

Monitor-driven lifecycle state and durable observation and recovery records depend
on the shared [crash-durable state substrate](mcp-dispatch-runtime-contract.md#crash-durable-state-substrate),
while their existing authority owners remain unchanged.

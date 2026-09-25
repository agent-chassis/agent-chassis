
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

In default status `last_recorded_invocation` is compact: its `invocation_id`,
`sequence`, `outcome`, `status`, `reason_code`, `result_digest`,
`coverage_scope`, `detail_call`, the tested source's `selected_unit`,
`source_snapshot_digest` and `contract_generation`, and an `outcome` built from
the recorder's retained summary. `outcome` has the `status`, `proof_counts`,
diagnostic counts and codes, and, in the recorder's order, the rows that fit a
1024-byte budget (at least one). Each row keeps its status, execution and
selected-test status, declared target, mutation outcome, capability limitations,
obligations and reason key. `reasons` keeps each referenced reason's stable code.
Rows not carried are counted in `proofs_omitted`. Recovery text, proof and test
identifiers and the complete tested-source binding are read through the
invocation's `detail_call`. `include_final_result:true` publishes the whole
recorded `outcome_summary`.

`detail: {kind:"proof_verification"}` lists every recorded call with its
server-minted `invocation_id`. Adding that `invocation_id` reads the one
recorded call:

- An aggregate comes back with one evidence locator, `detail.evidence`: a
  fresh evidence reference readable through
  `workspace_read_mcp_content_reference` in the observing session.
  `detail.evidence_retrieval` beside it names the first read and the reader's
  page protocol
  ([Oversized MCP Response References](mcp-repository-model.md#oversized-mcp-response-references))
  followed by UTF-8 JSON decoding, with the expected byte count, `sha256` and
  `result_digest`. `detail.outcome_summary`
  (`workspace-verify-proof-outcome-summary.v1`) is the selected outcome
  re-projected from that exact retained aggregate by the direct verifier's own
  outcome core and bounded by the ordinary delivery budget; it carries no
  evidence locator of its own. The direct `workspace_verify_proof` summary is
  unchanged.
- A modeled refusal comes back inline.
- `detail.summary.last_recorded_invocation` omits the latest invocation's
  recorded `outcome_summary`, since the detail already carries the selected
  outcome. When the latest invocation is a different `invocation_id` from the
  selected one, it adds that invocation's exact `detail_call`; when it is the
  same invocation it names no self-read. Invocations are distinguished by
  identity alone, never merged because their reasons or results match.
- Corrupt or missing cached bytes refuse with
  `verify_proof_cache.record_corrupt.v1` or
  `verify_proof_cache.record_unavailable.v1`.

Every current aggregate journal record carries the `outcome_summary` object its
recorder derived. An aggregate record whose `verification.outcome_summary` is
missing, or is not a non-null, non-array object, is not a current record: the
ordinary observation, the paged detail and the selected detail refuse it with
`proof_verification_record_invalid`, naming the field, `missing` or
`invalid_type`, and the invocation, through their existing unavailable
transports. It is not omitted, relabelled, rebuilt from its evidence or
migrated, and its retained bytes are not deleted. A modeled refusal record has
no summary requirement.

The last-invocation observation carries the exact invocation, event and record
identity and result digest; requested and assigned unit; outcome, status and
reason; selected proof count (including zero, or `null` when unavailable); and
the verifier's compact original tested-source identity or `null`. It omits
source case arrays and links to the exact invocation detail.

For an aggregate, it also carries the `outcome_summary` the recorder derived
once from the same public result the caller received, with the same row
meaning as the direct verifier: `proven`, `unproven` or `not_executable`
statuses and counts, each proof's selected test identity, observed
`selected_status` (including `skipped` and `not_observed`), execution status,
mutation evidence and limitation codes, obligation relationships, the actual
diagnostic codes and any producer-supplied recovery. Its canonical JSON UTF-8
size is bounded by a 4,096-byte performance budget: whole rows beyond it are
omitted with exact `proofs_omitted` and `proofs_omitted_by_status` counts, no
string is shortened, and the complete evidence remains available through the
detail call. Counts denominate proof rows and obligation relationships, never
native executions. Ordinary polling reads that recorded field only; it loads
no evidence and imports no execution machinery. A modeled refusal has no
proof-row summary: its outcome, reason code, source and record identity are the
facts, and its detail returns the complete original refusal.
Recorded statuses are historical facts: status counts over a history may mix
labels recorded under earlier vocabularies, and nothing is relabelled. It is the last recorded observation,
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
| `next_action` | `retry_wait_or_check_status` — observe the same subject and optional attempt again; never relaunch — for in-flight, publication-retry and other unresolved states without a retained failure. A retained failure instead publishes the one next step its `retry_assessment` implies, identical to `lifecycle_resolution.next_action` (see [Retained failures](#retained-failures-and-retry-eligibility)) |

Unresolved runs also carry a `lifecycle_resolution` projection
(`workspace-agent-run-lifecycle-resolution.v1`) with `resolved:false`, the exact
lifecycle `phase`, `integration_complete:false`, the latest retained typed
failure, the bounded retained-failure list (its count and history call in the
compact default answer), bounded/saturating attempt metadata,
and an actionable lifecycle `next_action`
(`resolve_lifecycle_failure_then_retry_run_status`,
`repair_retry_assessment_then_check_status`, `escalate_missing_retry_capability`,
`delivery_requires_new_generation_work`,
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
`final_result_summary`, the compact lifecycle view described below, and the
compact proof and lifecycle-resolution facts. A compact advisory output keeps its existing
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

### The compact default status answer

A default status answer (`include_final_result` omitted or `false`) is a
complete answer a coordinator can act on: run identity and terminality, the
recorded verification outcome with its scope and limitations, delivery,
integration and terminal-candidate identities, cleanup, and the next action or
the stop condition (`terminal:true`). The test contract keeps the whole
serialized default result, every channel included, within 8,192 UTF-8 bytes,
and it does not grow with authored bodies, descriptor inventories, diagnostic
depth, worker text or materialization paths.

`slice_lifecycle` is a closed, named view
(`view: "workspace-agent-run-status-compact-lifecycle.v1"`) of the complete
lifecycle envelope. It is not a recursive strip, and every fact it shows keeps
its path:

- every scalar member of the envelope and of `integration`, so a newly added
  scalar lifecycle fact is published rather than suppressed;
- `cleanup` and `failure_cause` unchanged, and the scalar members of
  `integration.review_target`, `integration.transition`,
  `integration.record_reconciliation` and `integration.cleanup`;
- the terminal candidate's identity: `canonical_wk_id`, `base_ref`, `base`,
  `wk_ref`, `wk_tip`, `candidate`, `candidate_tree`, `candidate_ref`,
  `version_identity` and `version_ref` from its binding,
  `materialization_verified`, and the designated `review_unit`'s `record_id`,
  `slice_id` and `subject`, or `null`.

`omitted_members` names every member not shown in full, such as `evidence`,
`integration.boundary_authorization`, `integration.transition.written_record`,
`terminal_candidate.binding` and `terminal_candidate.materialization`.
`complete.call` is the same observation with `include_final_result:true`, which
publishes the complete envelope, including the document projections below.

`lifecycle_resolution` keeps the latest retained failure, the attempt counts,
the retry assessment's decision facts and the next action. It replaces the
retained-failure ring with `retained_failure_count` and a
`failure_history_call` to the failure-history detail. The retry assessment's
whole probe diagnostic (`assessment_evidence`) stays in the complete result. The
required correction is published once, as the top-level `required_correction`.
`lifecycle_resolution.omitted_members` names each of these members. The complete
result keeps all of them and mirrors the correction on `lifecycle_resolution`.

### Terminal-candidate authored contracts are published as identity

A fresh final integration whose canonical record designates a terminal review
unit prepares a terminal publication candidate, and that candidate's frozen
review unit holds two whole authored documents: `canonical_parent_wk_contract`
(the canonicalized parent work record, including its acceptance, scopes,
sections and **every sibling slice**) and `review_unit_contract` (the designated
review slice). Both are backend authentication evidence, not run-observation
state, and neither was ever governed by `include_final_result`.

`slice_lifecycle.terminal_candidate.review_unit` therefore publishes their
**identity plus the read that reproduces them** in the complete result. The
compact default answer names `terminal_candidate.review_unit` as omitted and
publishes neither body:

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
          "candidate_schema_version": "terminal-wk-candidate.v3", "candidate_version": null
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
concatenating the decoded bytes in page order, verifying their byte count and
`sha256`, and parsing the result yields `carrier.<member>` byte-for-byte, Unicode included.
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

### The terminal candidate's controlled generation is published as a summary

A terminal candidate's `binding.controlled_generation` is the observed
controlled-contract generation: every carrier descriptor and manifest descriptor
together with its bytes in base64. It is authentication material, not run
observation state, and a consumer measured about 37KB of base64 there in one
terminal status. It is carried whether or not the candidate has a review unit,
and `include_final_result` has never governed it.

`slice_lifecycle.terminal_candidate.binding` therefore publishes
`controlled_generation_summary` in place of `controlled_generation` in the
complete result; the compact default answer names the binding as omitted. The distinct name keeps a display summary from
being mistaken for the authenticated generation:

```json
{
  "controlled_generation_summary": {
    "schema_version": "workspace-agent-run-status-controlled-generation-projection.v1",
    "projection_scope": "terminal_candidate_controlled_generation",
    "reason": "controlled_generation_carrier_bytes_are_not_run_observation_state",
    "grants_authority": false,
    "evidence_class": "historical_attempt_snapshot",
    "current_record_read_is_equivalent": false,
    "source_schema_version": "controlled-contract-authenticated-generation.v1",
    "identity_source": {
      "path": "terminal_candidate.binding.version_decision.controlled_generation",
      "present": true
    },
    "source_facts": {
      "repository": "/srv/workspaces/agent-chassis",
      "record_source_digest": "sha256:...",
      "wk_tip_sha": "..."
    },
    "descriptor_count": 6,
    "manifest_descriptor_count": 1,
    "omitted": {
      "member": "controlled_generation",
      "carrier_member": "terminal_candidate_controlled_generation",
      "digest": "sha256:...",
      "utf8_bytes": 36984
    },
    "retrieval": { "state": "retained", "…": "as above" }
  }
}
```

The summary does not restate the generation's identity.
`binding.version_decision.controlled_generation` already carries the identity
produced by the owning wiki-core projection: `wk_id`, `generation_digest`, the
producer's declared `count`, `manifest_identity`, and each descriptor's path and
content digest. That member is published unchanged and `identity_source` names
it; `present` is `false` only when the observed decision does not carry it. The
summary adds only what that identity lacks: the observed `repository`,
`record_source_digest` and `wk_tip_sha`, copied exactly and never resolved from
current state. `source_facts.repository` is the generation's observed absolute
repository root. It is a different fact from `retrieval.binding.repository`,
which is the workspace alias the retained read is bound to. `descriptor_count` and `manifest_descriptor_count` are the actual
inventory lengths. They are reported beside the declared count and never
reconciled with it. The replayed generation is not re-authenticated or
re-projected.

The summary lists no descriptor, path or byte, so its size depends on neither
body size nor descriptor count. The unchanged version-decision identity still
lists one path and digest per descriptor, so the complete status result still
grows with descriptor count. Only the carrier bodies are removed from it. The
compact default answer publishes neither and does not grow with descriptors.

`omitted.digest` and `omitted.utf8_bytes` describe the exact `JSON.stringify`
serialization of the observed generation object. That text is retained as
`carrier.terminal_candidate_controlled_generation` in the same
`selected-response-source.v1` envelope as the other omitted documents.
Following `retrieval.retained_source_read` as described above, then
`JSON.parse` of that carrier member, returns the exact historical generation:
every member, descriptor order, path association, manifest descriptor, digest
and base64 string. The guarantee covers the carried bytes, not the whitespace of
whatever file the generation was first read from. A changed generation under
the same candidate has a different digest, so it is retained as distinct
content. The earlier locator keeps returning the earlier generation.

A candidate binding with no generation object is published exactly as it
arrived, with no placeholder summary. A `controlled_generation` member that is
not a serializable object is also published unchanged. When retention is
unavailable, `retrieval.state` is `unavailable` with the failing code. No read is
invented, no current record or candidate is offered in its place, and the bodies
are not published inline instead. Every other binding, candidate and lifecycle
fact is published unchanged. That includes delivery, WK, candidate, base and
version identities, integration and reconciliation facts, proof observations and
gaps, failure causes and `next_action`.

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

One observation retains **one** artifact for every branch: when an envelope
omits the two frozen contracts, the candidate's controlled generation and the
written record, all four travel in the same `selected-response-source.v1`
carrier under their own member names, and
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

### Retained failures and retry eligibility

A later explicit request never treats a failure to assess as permission. For a
retained **pre-integration** failure, another attempt is eligible only when one of
two facts is established, and everything else withholds:

1. **Authenticated completion.** Before it reads the durable failure history or
   assesses anything, the route asks the backend's own continuation owner
   (`resolveCommittedSliceIntegrationContinuation`, live and durable) whether this
   exact delivery is already integrated — on a fresh checkpoint too. Concurrent
   first observers share that one observation. It does not depend on retry facts,
   the history or the assessor, so an unreadable history or a broken assessor
   never hides an integrated delivery; an unreadable history beside a completion
   is still reported on `failure_history_durability`, never as durable success. A
   completion whose canonical record is not yet reconciled is a completion: it
   carries `record_reconciliation: pending` (or `blocked`), and the lifecycle
   entry that consumes it reconciles only the record through the writable
   integration owner. That entry never integrates again. A completion lookup that
   fails is not permission: without a completion, the gate below applies.
2. **A producer-verified relevant correction.** Only a failure whose producing
   owner supplied a correction condition is re-checked, through that same owner.
   A `relevant_inputs_changed` answer permits one fresh attempt.

`lifecycle_resolution.retry_assessment` publishes the decision with
`grants_authority: false`. A withheld request integrates nothing, writes no failure
event, returns the original retained failure unchanged, and ends its automatic
polling; `attempt_withheld: true` marks it. Each withheld decision maps to exactly
one `next_action`, published on both `lifecycle_resolution.next_action` and the
response's top-level `next_action`:

| `decision` | Meaning | `next_action` |
| --- | --- | --- |
| `relevant_inputs_unchanged` | The producer's inputs are unchanged, so a re-run would refuse identically | `resolve_lifecycle_failure_then_retry_run_status` |
| `delivery_outside_allocated_scope` | The canonical scope changed, but the delivery touches paths outside the scope the attempt was allocated (`offending_paths`, `allocated_write_scope`). A revised contract is new-generation work (decision), never integration of this delivery | `delivery_requires_new_generation_work` |
| `correction_condition_unavailable` | The failure's producer supplied no correction condition (`failure_class: no_producer_correction_condition`). Its cause and complete evidence stay on `latest_failure` and the complete result's `slice_lifecycle`; no owner can establish its correction | `escalate_missing_retry_capability` |
| `completion_observation_failed` | The completion owner refused or threw. Its original evidence is on `assessment_evidence`; this is not evidence that the delivery is absent | `repair_retry_assessment_then_check_status` |
| `correction_assessment_unavailable`, `correction_assessment_failed`, `correction_assessment_malformed`, `correction_unknown` | The assessor is absent, threw, returned a value outside its own decision shape, or could not decide. `boundary` names the operation and owner; `assessment_evidence` carries the thrown value or malformed answer unredacted | `repair_retry_assessment_then_check_status` |
| `current_refusal_rederived`, `historical_correction_unestablished` | After a restart (below) | `escalate_missing_retry_capability` |
| `failure_history_unavailable` | The attempt's durable failure history could not be read, so whether it already failed is unknown | `repair_retry_assessment_then_check_status` |

Nothing latches: every later explicit request reassesses, sharing one in-flight
assessment across concurrent observers. Repairing the assessor alone is not a
correction — it then reports `relevant_inputs_unchanged` until the producer's own
inputs change. Eligibility never predicts success: a permitted attempt re-runs
every binding, commit-chain, scope, generation, CAS and configured-CCE check and
may refuse again. A failure after integration is not governed by this gate; a
later request re-enters only the failed post-integration step
(`post_integration_step_reentered_on_a_later_explicit_request`) and never
integrates. Outstanding record reconciliation is such a step: its failure keeps
`integrated: true`, the exact integration with its `record_reconciliation`
substate and original evidence, and the closed cause
`canonical_record_reconciliation_pending` or `canonical_record_reconciliation_blocked`;
the next explicit request retries only the metadata write, once per request.

The committed-slice admission owner supplies a correction condition for
`trusted_commit_scope_mismatch`: a change in the inputs its shared scope
interpretation consumes — the subject, the effective canonical write scope, the
authenticated diff base, that base's root tree, or the reviewed SHA. A changed
write scope corrects the refusal only when every delivered path lies inside the
scope the attempt was allocated in its launcher-owned binding pair, judged by the
admission owner's own membership interpretation; a delivery that was in scope,
narrowed away and restored is corrected, a widening around an unallocated
delivery is not. The explicit-base merge-tree owner supplies a correction
condition when command status, the exact unknown-option diagnostic, and
recognizable merge-tree usage positively establish that the required Git
capability is absent. Its correction condition is a changed capability result from
a bounded, non-mutating help probe through the same trusted asynchronous Git
runner. The probe bounds its execution time and output, and its process owner waits
for terminal child cleanup after a timeout. Timeout, signal, spawn failure, and
indeterminate output are uncertainty rather than evidence of capability presence or
absence, and withhold. Arbitrary text, exit 129 alone, another nonzero result, and
serialized diagnostics cannot establish that condition; a familiar error code alone
never supplies a correction condition.

Capability assessment is shared independently of any observer's wait. Each
observer awaits that same retained assessment only within its remaining request
deadline. An observer that expires returns unsettled without cancelling,
replacing, or duplicating the assessment; concurrent and later observers rejoin
it.

The retry facts and assessments are never derived from published error text, a
diagnostic projection, a journal observation, or a caller-authored object.

### Retained failures after a restart

Retry facts are process-local. A fresh checkpoint therefore proves neither that
no earlier attempt failed nor that one was corrected. Before this process's first
attempt for a run, the route reads the attempt's durable failure history once. A
failure recorded against the exact attempt is adopted as the retained failure and
returned as the original failure; the journal may withhold, and never grants.
Completion was already observed before that read, as above; absent a completion
the request asks the backend's
read-only `rederiveManagedLifecycleRefusal`, which re-runs the canonical unit and
committed-slice admission that integration runs first (Git reads and merge-tree
only; no ref, record, worktree or integration effect):

- `current_refusal_rederived` — the producer refuses now; its reason and evidence
  are published.
- `historical_correction_unestablished` — the current admission passes, but a
  passing current check does not prove the historical failure was corrected. The
  assessment names the missing evidence (the producer-owned correction facts) and
  their owner (committed-slice integration retry facts, retained in process
  memory only).

Neither decision attempts integration, and no integration is used as a probe.
The recovery that remains is an independently authorized completion — for example
the coordinator's own registered integration of the exact delivery — which the
next observation recognizes and consumes without integrating again.

Evidence limit: a failure whose journal publication was still pending when the
process stopped (`failure_history_durability: unavailable`) is not visible after
the restart, and the next request makes an attempt. That attempt is not reported
as a proven first attempt. A backend with no attempt journal has no durable
history to read.

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

The terminal candidate is publication material. A reconstruction takes the
initiative from the canonical validated work record and no review unit or review
contract as input: the reconstructed object is the one
`agent_launch.terminal_wk_candidate.v2` format, whose `Contract:` field is the
digest of the record blob inside the candidate's own tree, so it is byte-identical
to the candidate hot construction derives from the same `B`, `W` and generation.
Product identity is `tree(C) === tree(W)` with sole parent `B`. A candidate whose
commit carries no single `Contract:` binding is not a candidate. An unreadable
canonical record refuses with
`terminal_candidate_recovery_canonical_record_unavailable` and is never treated as
absence. The designated `terminal_whole_wk` review unit, which may have been added
to the canonical record after `W`, neither authorizes nor changes the candidate.

Publication uses one `git --no-replace-objects update-ref --no-deref --stdin`
transaction: it verifies the captured durable bindings and then either creates the
fixed ref with `create <fixed> <C>` when it was absent or advances it with
`update <fixed> <C> <expected-old>` when it existed. Repository identity, both
durable refs and `tree(W)` are re-authenticated immediately before publication. A reconstructed candidate uses the create form,
so a byte-identical concurrent winner for the same complete tuple converges and any
different winner refuses without being clobbered. An object created before a lost
or refused CAS is left unreachable and inert; a refusal moves no ref, mutates no
lifecycle or WK state, and creates no reviewer, executor, run, or monitor identity.

Review is an independent consumer of the exact candidate. Recovery attaches an
optional, non-authorizing `review_unit` projection for it: the unit the candidate's
own record blob designates, stamped `exact_candidate_tree`, or else the unit the
current canonical record designates, stamped `contract_source:
"canonical_current_record"`, or `null`. The projection never refuses or changes
candidate recovery. Forge handoff consumes only the exact candidate binding and its
squashed candidate worktree. Terminal REVIEWER admission accepts a
`canonical_current_record` unit as carrying no historical evidence — none is
fabricated for it — so the attempt is authenticated against LIVE canonical
coordination alone, with no lifecycle delta, at both routing and the synchronous
pre-spawn recheck. A `review_unit` whose contracts are not launcher-owned strings,
or whose provenance is neither stamp, still fails closed pre-spawn with
`historical_review_evidence_is_not_launcher_owned`, leaving `C` intact.

The hot post-worker lifecycle, which holds the WK identity binding's `base_sha`,
remains the constructor of a new candidate during the normal cycle, at every fresh
final integration whether or not the record designates a terminal review unit: it freezes `B`
and `W`, deterministically constructs `C`, and creates or advances the fixed ref
with expected-old CAS (covering the first candidate cycle and the
restart-before-CAS path). Legacy per-candidate refs are never read, enumerated,
counted, ranked, validated, migrated, preserved, or interpreted. Any number may
remain physically present without affecting construction, review, restart, or
publication.

Construction snapshots the fixed ref's exact old value before materializing `C`,
then publishes through one `git --no-replace-objects update-ref --no-deref
--stdin` transaction. The transaction verifies the captured durable `W` binding
(`verify <wk_ref> <W>`; a reconstruction also verifies the captured fork binding) and publishes
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

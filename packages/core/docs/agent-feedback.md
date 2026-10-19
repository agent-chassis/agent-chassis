# Local agent feedback

Report useful factual confusion, limitations or model input/output waste encountered during authorized work. Feedback is advisory: it grants no investigation, source access, canonical finding or lifecycle authority, and never gates unrelated work. Do not guess causes, include full prompts/transcripts, report every routine corrected error, or create a feedback retry loop.

## Submit and continue

Managed operator, orchestrator, worker, reviewer and redteam sessions use `workspace_record_feedback`. Choose exactly one session selector: `new_session:true` when no handle is available, otherwise the exact returned `session_id`. Reuse that handle across observations, compaction and resume; it is not a client/thread/process identity. The server fixes the repository; caller repository, path, target, role and version overrides refuse.

```json
{"new_session":true,"report":{"category":"confusion","observation":"The offered choices did not explain their difference.","location":"tool response, exchange 4","attempted_action":"Choose the requested detail"}}
```

Success returns `saved:true`, a `session_id` for later observations and a `feedback_id` for an optional related observation. No next call is required. Continue the original work; retaining the small handles does not require retaining previous reports or submitting another one. Later submissions replace `new_session` with `session_id` and supply their own complete report. There is no edit, history or feedback lookup route.

## Choose the report

Every report needs `category` and nonblank `observation`, `location`, `attempted_action`:

- `confusion`: describe what was unclear.
- `limitation`: describe the capability that was unavailable.
- `token_waste`: describe excessive model input/output, with nonblank `reason` and `direction:input|output|both`. Consumed responses are input; generated requests/answers are output. Counts and suggested reductions are optional.

Optional text fields are `expected`, `recovery`, `suggested_reduction` and `reason`; empty text is allowed except the required token-waste reason. Optional `evidence_refs` are at most 20 inert nonblank strings of at most 1,024 UTF-8 bytes each; they are not fetched. Optional `related_feedback_id` names an existing returned `fbo_` UUID from this repository, including another feedback session.

Optional `numeric_evidence` is one object with finite nonnegative `value`, `unit:tokens|bytes`, nonblank `source`, and `scope:exchange|turn|session`. It is agent-reported evidence, not authenticated measurement. Do not invent counts, convert bytes to tokens or attribute session totals to one call.

Unknown fields and malformed values refuse. Text is preserved without redaction or silent truncation. Parsed report JSON alone accepts at most 16 KiB, measured as UTF-8 bytes of `JSON.stringify(report)`; whitespace minification does not reduce that size.

## Correct or stop

A refusal names the specific problem and known effect. Schema and report mistakes use the same feedback constraints; invalid enum/type values are not echoed. Evidence mistakes identify the offending index. Session and related-feedback IDs must be strings, not arrays containing an ID. Correct only with known facts and caller choices, preserving session and relation intent. An unknown session needs a known same-repository handle or an explicit new-session choice. For an unknown related observation, supply a known valid identity; omit the relation only if you explicitly intend an independent observation. Otherwise stop reporting.

Unavailable or busy feedback storage does not block unrelated work. Follow a supported correction only when useful; do not poll, automatically retry, reset storage or submit a recovery probe. A startup repository-binding failure remains unavailable in that server; no agent rebind/restart call exists.

`not_committed` means no committed observation. `committed` with `saved:true` and a cleanup failure means the append stands: do not resubmit it. `possibly_committed`, or a lost acknowledgment, means persistence is uncertain. Retain available tentative IDs without treating them as proof. There is no supported lookup to resolve that uncertainty; do not resubmit the observation to check. Continue the original work.

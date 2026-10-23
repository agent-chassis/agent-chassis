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

A refusal names the specific problem and known effect. Field validation collects independently knowable faults in `invalid_fields`, each with an authored `path` and its `constraint`. Paths contain field names and array indices relative to the submission; `[]` names the submission itself. Correct the listed faults together when the facts and caller choices are known. A malformed container is identified once; its children cannot be checked until it is an object. Category-dependent requirements are checked only for the supplied category. A lone report-size failure retains its actual bytes and limit; a size fault is listed with other faults when they coexist.

Schema and report mistakes use the same feedback constraints; invalid enum/type values are not echoed. Evidence mistakes identify the offending index. Session and related-feedback IDs must be strings, not arrays containing an ID. Correct only with known facts and caller choices, preserving session and relation intent. An unknown session needs a known same-repository handle or an explicit new-session choice. For an unknown related observation, supply a known valid identity; omit the relation only if you explicitly intend an independent observation. Otherwise stop reporting.

Unavailable or busy feedback storage does not block unrelated work. Follow a supported correction only when useful; do not poll, automatically retry, reset storage or submit a recovery probe. A startup repository-binding failure remains unavailable in that server; no agent rebind/restart call exists.

`not_committed` means no committed observation. `committed` with `saved:true` and a cleanup failure means the append stands: do not resubmit it. `possibly_committed`, or a lost acknowledgment, means persistence is uncertain. Retain available tentative IDs without treating them as proof. There is no supported lookup to resolve that uncertainty; do not resubmit the observation to check. Continue the original work.

## Implementation responsibilities

These bindings describe the feedback boundary. They document responsibility and
interface intent; source/index observations establish the implementation links
separately. They do not assign the whole enclosing code cluster to feedback.

<!-- architecture:components tool=workspace_record_feedback -->

| Component | Responsibility | Guidance |
| --- | --- | --- |
| `packages/wiki-core/src/lib/agent-feedback-schema.mjs` | Validates payload fields and session-selector syntax. Evidence references are inert strings checked for shape and size; they are never fetched or resolved. | [Report constraints](#choose-the-report) |
| `packages/wiki-core/src/operations/agent-feedback.mjs` | Coordinates submission validation and persistence, and constructs refusal guidance requiring the caller to preserve session and relation intent. | [Correction rules](#correct-or-stop) |
| `packages/wiki-mcp/src/lib/feedback-tools.mjs` | Exposes feedback results through MCP and offers permitted read-only guidance; it does not construct a replacement submission. | [Correction rules](#correct-or-stop) |
| `packages/wiki-core/src/lib/agent-feedback-store.mjs` | Checks existing session and related-feedback identities against storage and appends observations. It does not resolve evidence-reference strings. | [Session selection](#submit-and-continue) |

### Submission and correction handoffs

<!-- architecture:handoffs tool=workspace_record_feedback -->

| Consumer | Producer | Handoff | Guidance |
| --- | --- | --- | --- |
| `packages/wiki-mcp/src/lib/feedback-tools.mjs` | `packages/wiki-core/src/lib/agent-feedback-schema.mjs` | MCP reruns the shared submission validator to obtain every independently knowable input fault with its authored path and constraint. Invalid evidence entries identify the offending index; correction must preserve the caller's session choice. | [Correction rules](#correct-or-stop) |
| `packages/wiki-mcp/src/lib/feedback-tools.mjs` | `packages/wiki-core/src/operations/agent-feedback.mjs` | The operation records submissions and formats feedback refusals. MCP presents those results and may add a permitted documentation read; guidance reads submit nothing. | [Correction rules](#correct-or-stop) |
| `packages/wiki-core/src/operations/agent-feedback.mjs` | `packages/wiki-core/src/lib/agent-feedback-schema.mjs` | Submission validation returns the preserved session choice and validated report, or a feedback error. Shape-valid evidence strings are not storage identities. | [Report constraints](#choose-the-report) |
| `packages/wiki-core/src/operations/agent-feedback.mjs` | `packages/wiki-core/src/lib/agent-feedback-store.mjs` | The store consumes the validated submission, checks existing session and related-feedback identities, and returns receipt IDs or a failure with its persistence effect. A new session requires the caller's explicit choice. | [Session selection](#submit-and-continue) |

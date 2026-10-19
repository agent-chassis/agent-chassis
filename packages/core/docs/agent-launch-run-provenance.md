
# Agent Run Provenance and Inspection

> Part of the [Agent Launch & Direct-Dispatch Reference](agent-launch-quickstart.md).

This page documents the `agent-run-provenance.v1` envelope that every direct role-wrapper run and reviewed launcher run should produce, its required and optional fields, digest/sensitivity/retention rules, and the repo-local provenance inspection command.

## Agent Run Provenance

Every direct role-wrapper run and reviewed launcher run should produce a local
`agent-run-provenance.v1` envelope. The envelope is runtime provenance, not
canonical wiki state. It records what the launcher observed and controlled:
inputs, authority, process status, artifacts, output, validation, and digests.
It does not require or imply access to hidden model reasoning. If an agent
runtime exposes an event stream, model-visible transcript, tool-call log, or
reasoning summary, the launcher may capture it as an artifact reference; if the
runtime does not expose that data, the provenance record must state that it was
unavailable rather than fabricating it.

Required envelope fields:

- `schema_version`: `agent-run-provenance.v1`
- `run_id`, `started_at`, `completed_at`, and terminal `status`
- `repo`, `subject`, `role`, `wk_id` or `in_id` when applicable, and launcher
  entrypoint
- selected agent, profile, model identifier when known, and redacted argv
- canonical source context digests: WK JSON digest, prompt/input digest,
  handoff/input-manifest digest for reviewed launches, and graph/dispatch-readiness
  evidence digest when present
- control context: write roots or sandbox summary, role metadata, trusted WK
  binding, dispatch-readiness result, and local policy decisions
  when available
- runtime context: cwd category, environment allowlist digest, timeout,
  heartbeat timeline, pid/pgid when applicable, exit status, and signal or
  timeout disposition
- artifact references with path, byte count, SHA-256 digest, media kind, and
  sensitivity class for final response, stdout/stderr logs, transcript or event
  stream when available, validation output, and diff/changed-path summaries
- validation claims with command, status, policy dispatch-readiness result when
  available, and output artifact reference

Optional fields:

- `tool_events` for runtimes that expose structured tool-call or shell events
- `model_transcript` for runtimes that expose a model-visible transcript
- `reasoning_summary` only when the runtime or agent explicitly emits one
- `diff_summary`, `changed_paths`, `graph_impact_pre_edit`, and
  `graph_impact_post_diff`
- `cleanup` metadata describing retained, exported, or removed artifacts

Digest and canonicalization rules:

- JSON provenance envelopes use SHA-256 over RFC 8785 JCS canonical JSON.
- Artifact digests use SHA-256 over exact bytes after any documented
  normalization.
- Redacted exports must carry both the exported artifact digest and the source
  artifact digest when the source digest can be disclosed safely.

Sensitivity and retention:

- Provenance artifacts live under launcher-owned runtime storage such as
  `.agent-runs/` or the direct-wrapper run directory. They must not be committed
  or treated as canonical wiki records.
- Full transcripts, stdout/stderr logs, tool event streams, and environment
  summaries are sensitive runtime artifacts by default.
- Environment capture is allowlist-only. Secrets and full inherited
  environments must not be stored.
- Cleanup may remove old runtime artifacts, but terminal provenance envelopes
  should retain enough digests and status data to audit a closed WK without
  keeping the full transcript indefinitely.

WK closure should cite provenance without embedding the transcript. A closure
may record `run_id`, provenance path or exported bundle path, terminal status,
artifact digest, validation commands, and a short durable synthesis. It should
not paste full stdout/stderr logs, raw transcripts, or tool streams into the WK
record.

Active-run inspection is allowed for orchestration and debugging. An
orchestrator may inspect current heartbeat, terminal status, response bytes
written so far, stderr tails, and provenance metadata while a run is active.
Those observations are runtime evidence only. Durable conclusions must still be
promoted into the WK, initiative, decision, or docs after the run completes.

The stdio MCP transcript session also derives a local
`controlled-authoring-journey-measurement.v2` summary at capture completion.
It pairs request and result IDs and retains successful, refused, failed, retried,
and unmatched calls in the denominator. Invalid frames, duplicate IDs, orphaned
observations, unobserved required phases, and mixed run/source identities make
the capture explicitly incomplete. When per-call observations exist, the
summary records phase and elapsed milliseconds; otherwise timing is explicitly
unavailable.

The summary separates observed facts from classification and attribution.
Ordinary semantic upsert and remove calls are authoring; snapshot, cursor,
collection, or field-path selectors are retrieval; workspace tool catalog operations are
discovery; and remaining calls are preparation. Canonical request equality and
canonical semantic-response equality are counted independently; a retry is
reported only when an observation binds it to an earlier request ID. A refusal or
failure is not assigned to the caller: responsibility remains `unknown` unless
a separate observation supplies both an attribution and supporting evidence.
Raw identifiable frames remain in the private transcript files, outside the
summary and outside admission metrics.

Transport bytes are retained only as bytes. Model-visible tokens are populated
only from an observable client projection carrying the client, model, tokenizer,
and projection identities and the observed input/output counts. Absence is a
recorded measurement gap, not a byte-based estimate or a launch blocker.

The shared `agent-launch-core` provenance construction owner validates and
serializes both reviewed-launch and direct-capture facts. Reviewed-launch
observation ends at `launchReview` finalization, while direct role capture
observes the child, heartbeat, and artifact facts and passes the complete
fact set to that owner; neither path hand-builds a second envelope contract.

Reviewed launcher runs already produce `metadata/state.json`,
`metadata/meta.json`, `metadata/review.json`, `metadata/input-manifest.json`,
and `response.md`. Those files are the reviewed-launcher projection of
`agent-run-provenance.v1`; a future implementation should either write an
explicit `metadata/provenance.json` or make `meta.json` a documented compatible
projection. Direct role wrappers should converge on the same envelope rather
than inventing a separate log format.

## Dispatch Enforcement Provenance

A structured dispatch run also carries `structured-dispatch-provenance.v1` on its
terminal `final_result.provenance`, exposed only with
`include_final_result:true`. `verbose` is not part of the closed run-status
request; see [monitoring and ownership](mcp-dispatch-monitoring-and-ownership.md).
Two blocks inside it record the run's containment posture:

- `enforcement` — the posture itself: `enforced`, `isolation_backend`,
  `command_surface`, `reason`.
- `enforcement_provenance` (`structured-dispatch-enforcement-provenance.v1`) —
  **where that posture came from**: `authority`, `disposition`,
  `enforcement_posture`, `backend_availability`, `refusal`.

This is **result provenance only**. It reports what the launcher observed; it
does not participate in bwrap planning, scope projection, conduit setup, spawn,
or the fail-open/refusal branches, and changing it cannot change how a run is
contained.

### The launcher-observed confined run

When the launcher built the containment plan, asserted the backend, and observed
the isolated spawn return a live child, that observation *is* the enforced
verdict (see the enforcement model's backend-selection rule). Such a run
publishes:

| Field | Value |
| --- | --- |
| `enforcement.enforced` | `true` |
| `enforcement.isolation_backend` | `"bwrap"` |
| `enforcement.reason` | `"sandboxed"` |
| `enforcement_provenance.authority` | `"launcher_owned"` |
| `enforcement_provenance.disposition` | `"enforced_backend"` |

`backend_availability` records the observed backend facts; `refusal` is `null`.

### Attribution: `authority` is earned, not assumed

`enforcement_provenance.authority` describes **the source of the posture**, and
is `"launcher_owned"` **only** when that posture was carried on a valid
launcher-branded source — one the launcher minted itself from a real sandbox
decision or from its own confirmed isolated spawn. The brand is private and
identity-based, so it survives neither serialization nor reconstruction.

Everything else is published **unattributed**, with `authority: null`:

- an **absent** source;
- a **malformed** source, including one that is structurally perfect but was
  never minted by the launcher — validation happens *before* branding, so
  invalid input produces no branded source at all rather than a branded
  fail-honest one;
- any **unbranded** source, including one **supplied by the caller** or **by the
  dispatched child**.

None of these can claim enforcement. An unattributed source always loses
enforcement authority: the published posture is `enforced: false` and
`isolation_backend: "none"`, with `authority: null`. Every enforced/`sandboxed`
claim is dropped, and so is every launcher-owned paid-posture reason — a
no-paid-key fallback, an operator opt-out, or an enforcement-required refusal
asserted by an unbranded source is rewritten to `reason: "refused"`. A child or
caller therefore cannot manufacture containment, or a launcher-owned posture
narrative, it did not receive.

What an unbranded source *can* still influence is the narrower unenforced
vocabulary. A caller-permissible unenforced `reason` is read from it and stays
visible, and because `disposition` is derived from the resulting posture, that
reason's paired unenforced disposition stays visible too — an unbranded source
asserting `reason: "operator_opt_in_no_backend"`, for example, publishes
`disposition: "unenforced_no_backend"` rather than `"refused"`. This is not an
authority leak: the run is still reported as unenforced with `authority: null`.

Consumers must therefore inspect `authority` first. A disposition other than
`"refused"` is **not** evidence that the launcher attributed the posture; only
`authority: "launcher_owned"` is. `authority: null` is a visible, auditable
signal that the launcher is not vouching for the posture rather than a silent
absence.

### An accepted managed run never publishes `refused`

`disposition: "refused"` describes the **launch**, not the child's output. Only a
genuine refusal — a launch that never ran under the backend — publishes
`"refused"`. The unenforced fall-back dispositions
(`no_paid_key_unenforced_fallback`, `paid_key_operator_opt_out_unenforced`,
`unenforced_no_backend`) and the enforcement-required refusal
(`paid_key_enforcement_required_refusal`) keep their existing meanings.

Missing child output does not change that, but the two ways a run can end
without a usable answer publish different envelopes:

- A **child- or executor-produced `missing_result` envelope** — the child ran
  under the backend and the family executor built the terminal envelope from it
  (unavailable, unreadable, non-text, or empty final message). Branded
  provenance is already attached to that envelope, so a run the launcher
  accepted and ran under the containment backend still publishes
  `disposition: "enforced_backend"`. An empty or `missing_result` payload is a
  result-quality fact, not a containment fact.
- A **launcher-synthesized envelope** — `probe_terminal_without_final_result`,
  built when there is no executor
  final-result object to carry provenance at all. It may contain no
  `provenance`, and therefore no `enforcement_provenance`, block whatsoever.

Absence of `enforcement_provenance` is **not** `disposition: "refused"`, and it
does not prove the run was unenforced. A consumer cannot infer containment — in
either direction — from a synthesized envelope that lacks provenance. That is
still fail-honest: the launcher makes no containment claim it cannot support,
rather than publishing a posture nobody observed.

### One rule for both families

Codex and Claude use the **same** launcher-owned authority rule, the same
branded-source requirement, and the same disposition vocabulary. Neither family
has a private path to `authority: "launcher_owned"`, and the posture is
preserved unchanged across final-result normalization and the dispatch backend's
provenance re-home, which re-stamps authoritative run identity from its own run
record rather than trusting the executor payload.

## Native Usage Numerical Contract

`packages/agent-launch-core/src/lib/agent-run-usage.mjs` is the single
family-neutral owner of native usage arithmetic. It is an internal calculation
module, not a package export; its only callers are the capture boundary and the
run aggregation described under [Native Usage Capture](#native-usage-capture).
It takes accounting facts a caller has already extracted, performs no I/O,
keeps no state between calls, and does not authenticate the identities it is
given.

Every result quantity has one shape, `{ value, observed, status }`:

| `status` | `value` | `observed` |
| --- | --- | --- |
| `complete` | the quantity for the whole population and interval | same as `value` |
| `partial` | `null` | the attributable portion that was observed |
| `unavailable` | `null` | `null` |

An observed zero is `complete` with `value: 0`. A missing value is never zero,
and no quantity is estimated from bytes, model names, timestamps, or prices.
Each result carries `causes`, a list of `{ code, quantity, identity, detail }`
naming the concrete reason and the affected identity and quantity.

Identities are five opaque strings compared by exact equality:
`invocation_id`, `session_id`, `source_id`, `population_id`, `interval_id`.
A source declares its semantics as data: `input_semantics` (`exclusive` or
`inclusive`), `counter_kind` (`cumulative` or `incremental`), and
`descendant_coverage` (`root_only`, `inclusive`, or `unknown`).

### `normalizeTokenUsage({ input_semantics, counters, identity })`

`counters` has five nullable slots: `input`, `cache_read`, `cache_creation`,
`output`, `reasoning_output`. A token value must be a safe nonnegative integer;
strings, fractions, negatives, and unsafe integers are rejected with
`invalid_token_value`, never coerced, clamped, or rounded. The result is
`{ tokens, causes }`, where `tokens` has uniform meanings whatever the source:

- `input` includes both cache categories. Exclusive input adds `cache_read` and
  `cache_creation`, and all three must be observed (`missing_category`
  otherwise). Inclusive input is used as reported and cache is not added again.
- `output` includes reasoning; `reasoning_output` is reported and never added.
- `total` is `input + output`.

A cache sum above inclusive input, or reasoning above output, yields
`subset_exceeds_parent` and makes the inconsistent quantities unavailable. A sum
outside the safe integer range yields `unsafe_sum`.

### `reconcileInvocationUsage(stream)`

Reconciles one invocation's observations from one source and population. The
result is `{ identity, descendant_coverage, tokens, cost, peak_context,
session_cumulative, causes }`.

A cumulative stream supplies ordered `snapshots` and a `baseline`. The latest
snapshot minus the baseline is the invocation quantity; successive snapshots are
never added, and an identical repeated snapshot changes nothing. The baseline is
either a start snapshot bound to the same session, source, population, and
interval, or a `fresh_session` baseline with `session_created: true` for that
session. `session_cumulative` carries the latest snapshot, labeled as session
lifetime rather than invocation usage, so it survives an invocation quantity
that cannot be completed; it is `null` when the latest sequence itself is
disputed. An incomplete identity (`missing_identity`) or an unrecognized
`input_semantics` or `counter_kind` (`invalid_source_declaration`) makes every
quantity unavailable. An unrecognized `descendant_coverage` reports the same
cause, is treated as `unknown`, and keeps the quantities.

Rollback is detected on the reported counters and cost, not on derived values.
A counter that decreases makes every quantity computed from it unavailable —
exclusive `input` from any of its three parts, `total` from `input` or
`output` — even when the derived value itself rose; unrelated quantities are
kept.

The stream-level causes `missing_snapshot`, `missing_snapshot_order`,
`population_changed`, `overlapping_interval`, and inexact segment bounds or a
snapshot outside every segment make every invocation quantity unavailable,
cost included. Two different snapshots at one
sequence do the same, with one exception: when they report identical cost and
differ only in token counters, the token quantities are unavailable and cost is
still reconciled against its baseline.

| Cause | Condition |
| --- | --- |
| `missing_snapshot`, `missing_snapshot_order` | no snapshot in the interval, or a snapshot without an integer sequence |
| `missing_baseline` | no baseline, the baseline lacks that quantity, or a `reset` baseline supplied without segments |
| `unproven_fresh_session` | zero baseline without new-session evidence for this session |
| `baseline_identity_mismatch` | baseline bound to another session, source, population, or interval |
| `conflicting_snapshot` | two different snapshots share one sequence |
| `population_changed` | a snapshot or event belongs to another session, source, or population |
| `rollback` | a quantity decreases without a supplied reset boundary |
| `overlapping_interval`, `reset_boundary_ambiguous` | reset segments overlap, lack exact bounds or observed boundaries, or leave a snapshot outside every segment |

Observed resets are supplied as `segments` with exact `first_sequence` and
`last_sequence` bounds and their own baselines; nonoverlapping segments are
reconciled independently and added. A zero `reset` baseline
(`boundary_observed: true`) is valid only as a segment's baseline.

An incremental stream supplies `events`. Each `event_id` is added once; an
identical repeat is ignored. `missing_event_identity`, `conflicting_event`, a
reported entry in `gaps` (`observed_gap`), or the absence of an observed
`interval_complete: true` fact (`interval_completion_unobserved`) leaves
`value` null and keeps the uniquely identified sum as `observed`. With no
countable event, a completed interval yields zero tokens and an unavailable
cost, and an incomplete or unattributable one yields nothing but unavailable
quantities.

`cost` is `{ amount, currency, source, kind: "native_estimate" }`. It is always a
labeled native estimate, never billed spend, and is reconciled against the
baseline independently of tokens. A source that reports no cost has an
unavailable `amount`; nothing prices it. `invalid_cost` covers negative,
non-finite, or unlabeled amounts, and `inconsistent_cost_label` covers mixed
currencies or sources.

`peak_context` is the largest normalized `input` among the single-request
observations in `requests.observations`. It is `complete` only with
`requests.coverage_complete: true` and every request identified and valid;
otherwise the observed maximum is `partial`, and without request-level
observations it is `unavailable`. It is never a sum or a cumulative snapshot.
Its own causes are `request_coverage_incomplete`, `missing_request_identity`,
and `conflicting_request`; a request reports counter causes only for the
counters its input is computed from. Which requests belong to the invocation
is the caller's fact and is not checked.

### `combinePopulationUsage({ root, members, expected_native_children })`

Combines one root result with `native_descendant` and `managed_invocation`
members and returns the same quantities plus `contributors`, each with a
`disposition` of `counted`, `included_in_root`, `duplicate`, or `unresolved`.

- An `inclusive` root already contains its native descendants; they are not
  added.
- A `root_only` root adds a native descendant only with `disjoint_proven: true`
  and a `root_population_id` equal to the root population
  (`unproven_disjoint_child` otherwise). `disjoint_proven` is the caller's
  assertion, not checked here, that the member is disjoint from the root and
  from every other counted member. Every identity listed in
  `expected_native_children` must be resolved (`unresolved_expected_child`).
- An `unknown` root, or a counted member that itself declares `unknown`
  coverage, yields `unknown_descendant_coverage` naming that population.
- A managed invocation has a different `invocation_id` and is always counted as
  its own population, never dropped as a native duplicate. A member whose
  relation and invocation identity disagree yields `unbound_contributor`.
- The same identity supplied twice counts once; differing copies yield
  `conflicting_contributor`.

Whenever coverage is unresolved the complete values are null and the counted
portion stays in `observed`. Token and cost amounts are added; a counted member
without cost makes the tree cost `partial`. `peak_context` is the maximum across
counted members.

## Model-Free Native Usage Fixtures

`tests/helpers/role-guide-compaction-native.mjs` provides two local model
endpoints for native-client tests: `startCodexModelEndpoint` (Responses) and
`startClaudeModelEndpoint` (Messages). Each listens on `127.0.0.1` under a
caller-supplied test-resource scope, records every model request routed to it
in `requests`, and reaches no model. Both take one optional synchronous callback,
`usage(entry, phase)`, that decides exactly what usage the endpoint sends.

`entry` is the recorded request: its endpoint-local zero-based `index`, the
parsed `body`, the extracted `text`, its `kind`, and for Codex the `answered`
flag. The callback must treat it as read-only; `index` orders requests at one
endpoint and is not a native session identity. The callback runs once per
usage carrier, in this order, before any response byte is sent:

| Family | Request | `phase` | Carrier written |
| --- | --- | --- | --- |
| Codex | every answered request | `response.completed` | `response.completed.response.usage` |
| Claude | non-streaming | `message` | `usage` of the message body |
| Claude | streaming | `message_start`, then `message_delta` | `message_start.message.usage`, then `message_delta.usage` |

Each return is copied when it is made, so a callback that reuses and later
mutates one object cannot change an earlier carrier:

- `undefined` omits the `usage` field;
- `null` writes `usage: null`;
- a plain object is written as given, with every nested null, boolean, string,
  finite number, array, and plain object preserved.

The endpoint does not validate, derive, or sum counters. Empty objects, zeros,
negative or inconsistent numbers, strings in counter fields, and unknown fields
pass through unchanged. Without a callback, Codex reports
`{ input_tokens: 10, output_tokens: 1, total_tokens: 11, input_tokens_details: null, output_tokens_details: null }`
and Claude reports
`{ input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }`
on every carrier.

Routing, the `reject` callback, and Claude's required-model check come first:
a request answered with 404, a rejection status, or a missing-model error never
calls `usage`, and neither does a Claude `count_tokens` request, which always
answers `{ input_tokens: 10 }`.

Failures are explicit. A `usage` option that is supplied but is not a function,
or the removed Claude `inputTokens` option, rejects the start call with
`TypeError` before a listener exists. During a request, the first failing phase
answers HTTP 500 with exactly
`{ error: { code, family, request_index, phase, cause } }` and no success
event:

| `code` | Condition |
| --- | --- |
| `fixture_usage_callback_failed` | the callback threw |
| `fixture_usage_invalid` | the return was a root array or primitive, a Promise or other non-plain object, or contained a cycle, a non-finite number, a BigInt, a function, a symbol, `undefined`, an accessor, an array hole, or a custom-prototype instance |

`cause` names the exception or the offending type and path, never the request
body or the returned values. The failed request stays in `requests`, Codex
leaves its `answered` flag false, the callback is not retried, and the next
request is answered normally under the next index.

These values are whatever the test supplied. They show what an installed client
does with a given usage payload; they are not evidence of real token
consumption, cache reuse, billing, or of the usage a live service would report.

## Fresh Headless Native Usage Qualification

`tests/integration/native-usage-headless-qualification.test.mjs` records what
the installed clients report about token usage in one fresh headless session.
Each session runs the real client against a local model-free endpoint with a
disposable home, the neutral model key `fixture-model-a`, and one short prompt
answered by one model request.

The test runs whichever client releases are installed and gates on behavior:
the flags it passes are still listed by the executable's own help, and every
counter, zero, omission, session and output expectation below holds. It names
no release. The release each executable and each session reports is recorded
with the run as evidence of what ran, and a record's client version is checked
against what the same session reported, never against a number in the test. A
new client release is therefore not a failure; a release that changes one of
these behaviors is, at the assertion for that behavior. The versions in this
document are the releases that were installed when each fact was first
observed.

| Client | Release first observed with | Invoked mode |
| --- | --- | --- |
| Codex | `codex-cli 0.161.0` | `codex -a never exec --json -o <file> --ignore-user-config --ignore-rules --skip-git-repo-check -C <dir> -s read-only`, with a local Responses provider and `-m` |
| Claude | `2.1.296 (Claude Code)` | `claude -p <prompt> --output-format stream-json --verbose --model <key> --no-session-persistence` |

### Codex

The session identity is `thread_id` on the first event, `thread.started`. The
only usage carrier is `usage` on the one `turn.completed` event. The final text
is the `agent_message` item and, independently, the `-o` file.

| Sent in `response.completed.response.usage` | Reported in `turn.completed.usage` |
| --- | --- |
| `input_tokens` | `input_tokens`, unchanged |
| `input_tokens_details.cached_tokens` | `cached_input_tokens`, unchanged |
| `output_tokens` | `output_tokens`, unchanged |
| `output_tokens_details.reasoning_tokens` | `reasoning_output_tokens`, unchanged |
| `total_tokens` | not reported |
| nothing | `cache_write_input_tokens: 0` |

The cached and reasoning counts are reported beside the input and output counts
they were sent inside; nothing is added to or subtracted from either. No cost
is reported. `cache_write_input_tokens` was 0 in every session and no supplied
field was shown to set it.

### Claude

The session identity is `session_id`, first on the `system`/`init` event and
repeated on every event. The stream is `system`/`init`, one `assistant` event,
one `system`/`informational` event, and the terminal `result` event, whose
`result` field carries the final text. Usage has three carriers:

| Carrier | Content |
| --- | --- |
| `assistant` event, `message.usage` | the `message_start` usage, unchanged, including its starting `output_tokens` |
| `result.usage` | `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, and `output_tokens`, each the last value either carrier supplied, plus client-added fields |
| `result.modelUsage[<model>]` | the same four counters as `inputTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens`, and `outputTokens`, plus `costUSD` |

A `message_delta` that carries only `output_tokens` leaves the three input
counters at their `message_start` values. A `message_delta` that also carries
them replaces them. The carriers are never added together, and the three input
categories stay separate.

`result.total_cost_usd` equals `modelUsage[<model>].costUSD`. It is the client's
own estimate, reported with `costBasis: "unknown"` for a model key it does not
recognize. It is not a billed amount and not a figure derived here.

### Zero and omitted usage

| Source sent | Codex `turn.completed.usage` | Claude `assistant` `message.usage` | Claude `result.usage`, `modelUsage`, cost |
| --- | --- | --- | --- |
| every counter 0 | every counter 0 | every counter 0 | every counter 0, cost 0 |
| no usage on any carrier | every counter 0 | field absent | every counter 0, cost 0 |

Both clients complete the session normally when usage is omitted. In its
`exec --json` output stream, Codex has no carrier that distinguishes an
unreported count from zero. Claude distinguishes
them only on the `assistant` event; its terminal result does not. A zero at
either terminal carrier is therefore not proof that the source reported zero.

### Evidence limits

Every counter above was supplied by the test, so none of this is evidence of
real consumption, cache reuse, or billing. This test inspects only each client's
standard output and the Codex `-o` file; what was established from session
records, resumed sessions, schema-constrained output, and native subagents is
under [Native Usage Capture](#native-usage-capture). This
qualification covers one fresh
headless session with one model request and a text reply. It does not cover
resumed sessions, counter resets, native subagents, tool turns, schema-
constrained output, interactive sessions, hooks, isolation backends, or any
launcher route, and it establishes no capture or retention behaviour.

## Native Usage JSONL Decoder

`packages/agent-launch-core/src/lib/native-usage-jsonl.mjs` is the single owner
of byte framing and JSON decoding for native usage JSONL streams. It is
internal, not a package export; the capture boundary under
[Native Usage Capture](#native-usage-capture) is its caller. It frames and
decodes only.
It does not validate native event shapes, interpret or normalize counters, or
know any client family or model name.

`createNativeUsageJsonlDecoder({ onRecord, onDiagnostic })` returns
`{ push, finish, getState }`. The options must be a plain or null-prototype
object with exactly those two own data properties, both functions. Each decoder
is independent and wholly synchronous: it performs no I/O, starts no timer or
promise, and never awaits or reads a callback's return value. The caller owns
the source and its lifetime.

### Framing

`push(chunk)` takes a `Buffer` or `Uint8Array` and consumes only that view's
bytes. LF ends a physical line. One CR directly before the LF is not part of
the payload but counts toward the byte limit. Lines are numbered from 1 and the
number advances at every LF. A line whose payload is empty is skipped; any
other line is decoded as strict UTF-8 and parsed with `JSON.parse`, and
produces exactly one callback:

| Outcome | Callback |
| --- | --- |
| a JSON value of any root type | `onRecord({ line, value })` |
| bytes that are not valid UTF-8 | `onDiagnostic({ code: "invalid_utf8", line })` |
| text that is not JSON, including whitespace alone or a leading byte-order mark | `onDiagnostic({ code: "invalid_json", line })` |

A rejected line never reaches `onRecord`, and later lines are still decoded.
`value` can contain source content; it is transient input for the caller.

### Line limit

`NATIVE_USAGE_JSONL_MAX_LINE_BYTES` is 1048576. A line may hold that many bytes
before its LF. The first byte beyond it produces one
`{ code: "line_too_large", line }`, at once and without waiting for an LF. The
rest of that line is skipped through its LF without being decoded, and the next
line is processed normally.

The limit is per line; there is no stream-wide quota, so a long stream or a
huge chunk cannot suppress a later record. The decoder keeps at most one
unfinished line in storage it owns, so a caller may reuse or change its buffer
once `push` returns. It keeps no transcript, backlog, or diagnostic history.

### Completion

`finish(complete)` takes a boolean the caller observed and settles the decoder:

- `finish(true)`: the source was fully drained. An unterminated final line
  within the limit is decoded under the same rules.
- `finish(false)`: the source was interrupted. An unterminated line within the
  limit is dropped with `truncated_record`, and `source_incomplete` is always
  reported, at the current line, even when nothing was pending.

A final line that already overflowed stays skipped and is not diagnosed again.
Records delimited before the end are kept in both cases.

`finish` returns, and `getState()` reports at any time, a frozen object with
exactly `state`, `complete`, `records`, `diagnostics`, `pendingBytes`, and
`discarding`. `state` is `open`, `finished`, or `failed`. `complete` is `null`
while open and `true` only after `finish(true)` with no diagnostic. It
describes framing only: a complete empty stream shows neither zero usage nor
complete usage. Calling `finish` again with the same boolean returns the same
object and calls nothing; the other boolean is refused.

### Failures

Diagnostics carry exactly `code` and `line`. Neither they, the state, nor any
error the decoder raises contain source bytes, text, or parser messages.

Invalid arguments are refused before any effect, with a `code` on the error:

| `code` | Raised when |
| --- | --- |
| `native_usage_jsonl_invalid_options`, `_invalid_on_record`, `_invalid_on_diagnostic` | the options or a callback are not as specified (`TypeError`) |
| `native_usage_jsonl_invalid_chunk` | `push` is given anything but a `Buffer` or `Uint8Array` (`TypeError`) |
| `native_usage_jsonl_invalid_completion` | `finish` is given anything but a boolean (`TypeError`) |
| `native_usage_jsonl_finished` | `push` follows `finish` |
| `native_usage_jsonl_finish_conflict` | `finish` is repeated with the other boolean |
| `native_usage_jsonl_failed` | `push` follows a callback failure |
| `native_usage_jsonl_reentrant_call` | `push` or `finish` is called from inside a callback |

A value thrown by either callback is rethrown unchanged. The decoder then
fails: it drops its pending bytes, delivers nothing further from that call or
any later one, and retries nothing. `finish` on a failed decoder returns one
stable summary with `complete: false`. `getState` may be called from inside a
callback. A callback that catches a re-entrant refusal lets the outer call
continue; one that lets it escape fails the decoder like any other throw.

## Native Usage Capture

Headless launches capture the usage the native client itself reports and retain
it as launcher runtime metadata. Collection does not depend on any benchmark
consumer: an ordinary launch produces the same record.

### Routes

| Route | Captured | Source |
| --- | --- | --- |
| Dispatched Claude roles (worker, reviewer, redteam) | yes | output stream, in the shared launch supervisor |
| Headless Claude orchestrators | yes | output stream, in the shared orchestrator supervisor |
| Dispatched Codex roles | yes | hook-bound session record, checkpointed after every turn and settled by the shared launch supervisor |
| Codex orchestrators, headless and interactive | yes | hook-bound session record, settled by the Codex role command after the child ends |
| A dispatched role whose confined spawn fails after its plan was composed | refused | a role that carries the required MCP conduit is not launched unenforced: the failure is `agent_launch.isolation.bwrap_spawn_failed.v1` with `unenforced_fallback_permitted: false`, no client runs and no contributor is recorded |
| The direct `agent-launch worker` command for a launch that resolves to Codex | retired | the command refuses with `codex_direct_worker_retired` before any client is started: there is no launch, and no contributor is recorded. Codex workers are dispatched roles (`start_agent`) |
| A Codex launch that runs unconfined (operator direct mode, a plain spawn of the role command, the dispatched role's early unenforced launch) | yes | the same record; the unconfined argv carries the usage hook alone, never the role-guide hook |
| Interactive Claude orchestrators | yes | hook-bound session record, settled by the orchestrator launch after the session ends. The launcher refuses a Claude orchestrator it cannot confine before starting a client, so there is no unconfined session to capture |
| Temporal job wrapper, live model command | yes | Claude: output stream; Codex `exec`: hook-bound session record. Records stay in the job's output directory |
| Reviewed launches (`launchReview`) | not applicable | the route is deactivated |

A route marked "no" produces no complete record. It is never reported as
covered, and a run that includes one cannot have a complete total.

### Mechanism

`@agent-chassis/agent-launch-core` exports the two entry points a launch site
uses: `native-usage-records.mjs` for clients whose output streams carry their
usage (Claude, OpenCode and Agy), and `native-usage-codex-session.mjs` for Codex. The stream
steps are:

1. `prepareNativeUsageLaunch` runs before spawn. It mints a fresh
   `invocation_id` for this launch, switches the argv to the client's
   machine-readable output mode, and returns the launch tap. It never refuses a
   launch: an argv it cannot switch is returned unchanged with no tap. Only an
   argv whose output format is absent or explicitly `text`, as
   `--output-format text` or `--output-format=text`, is switched. An argv that
   selects any other format, or selects a format more than once, keeps exactly
   the argv and output its caller asked for, with `usage_output_mode_unsupported`.
2. The site pipes the client's stdout to the tap. The tap decodes it with the
   [JSONL decoder](#native-usage-jsonl-decoder), and the Claude adapter
   (`native-usage-adapters.mjs`, the stream adapter registry) turns each event
   into readable text and accounting facts.
3. The site's existing text sink receives only the readable projection, so the
   family result parser and the logs see text, never a protocol envelope.
4. After the client's exit is observed and before the launch releases what it
   held, the tap settles once, builds one `agent-run-usage-record.v1` through
   the [numerical contract](#native-usage-numerical-contract), and writes it.

| Family | Output mode | Final answer carrier | Readable projection |
| --- | --- | --- | --- |
| Codex | text mode, unchanged (see below) | `--output-last-message`, unchanged | none: stdout and stderr are the client's own |
| Claude | `--print --output-format stream-json --verbose` | the `result` event's text | that text and a newline, exactly what text mode prints |

Schema enforcement is unchanged. Codex `--output-schema` still constrains the
model request and the constrained answer still reaches `--output-last-message`.
Claude `--json-schema` yields the same structured answer on the `result` event
that text mode prints.

### Codex: the hook-bound session record

Codex prints its readable activity (the session header, hook status, commands)
only in text mode, and `exec --json` does not carry those lines. Codex launches
therefore stay in text mode: argv, stdout, stderr and `--output-last-message`
are exactly what they are without capture.

`native-usage-codex-session.mjs` reads the usage from the session's own rollout
record instead. The confined plan composes one launcher-trusted `SessionStart`
hook beside the role-guide hook, as its own group with its own trust key. Its
only action is to append the hook input, one line per session the process
starts, to a file in the launch's own runtime directory. That input carries the session identity, the exact path of the
session record, and whether the session was started (`startup`) or resumed. It
carries no conversation text, the hook returns nothing, and it asks the model
for nothing.

After the client has ended, the launcher reads the record at exactly that path.
The home is the one the client itself uses: `CODEX_HOME` when the launch names
one, otherwise `.codex` under `HOME`, which is where an orchestrator runs.
The path is used only when it is a regular file named
`rollout-*-<session id>.jsonl` inside that home's `sessions`,
wherever its directories resolve, and its `session_meta` names the same
session; a link to another record, another session's path, or another home is
refused with `session_record_not_bound`. Nothing is chosen by recency, by
scanning a home or session tree, or from the text the client prints.

| Rollout fact | Use |
| --- | --- |
| `token_count` with `info.total_token_usage` | one cumulative report: input (containing cached input), cached input, output, reasoning output |
| `token_count` with `info: null` | the source reported no usage for that request: `source_usage_absent` |
| `info.last_token_usage.input_tokens` | one request's input, for the observed peak |
| `task_started` without a later `task_complete` | the turn did not finish: `terminal_usage_missing` |
| hook `source` | `startup` charges from zero; `resume` charges only what follows the retained record of the same session |

Established with `codex-cli 0.161.0`, fresh and resumed, for concurrent sessions
of one model, with schema-constrained output, and through the production
confined plan, through a compaction, and interactively.

- **Compaction.** The session's totals stay cumulative through a compaction:
  the compaction request's own usage is in the total, and a report the client
  repeats carries the same total, so the last report is the session's usage.
- **A session replaced in one process.** An interactive `/new` starts another
  session, and the hook fires again with `startup`. Every binding of the
  process is kept, in order. The first session is the launch's own record; each
  further session is its own contributor `<invocation_id>.s<n>`, with its own
  launch entry and record, so nothing is dropped or counted twice.
- **Interactive sessions are never complete.** An interactive client also makes
  requests that no session reports (it titles its threads). Their records are
  `partial` with `auxiliary_requests_unreported`; a headless `exec` session was
  observed to make none.
- **The binding file** is rewritten at settlement to the session identity,
  record path and start source only.
- **Interruption.** A client killed outright before its session reported
  anything is bound to its session and has no usage: the record is
  `unavailable` and keeps the exit signal. A session record that ends after a
  whole report but before the end of its task yields `partial` quantities with
  `terminal_usage_missing`; that last whole report stays the baseline of a
  later launch that resumes the session.
- **Repeated settlement** of one launch reads the reduced binding file and
  retains the same record: one file, no further contributor.

A client that emits no event of its own protocol never entered the
machine-readable mode (it failed at startup, for example). Its stdout is then
treated as the plain text it is and handled exactly as without capture; its
usage is unavailable.

### Record

Records live in `usage/` under the launcher runtime-state directory of the
orchestrator's repository, outside the repository and outside every client
home. A dispatched role resolves the same directory as its orchestrator. A
later launch never overwrites an earlier launch's files.

| File | Written | Content |
| --- | --- | --- |
| `<invocation_id>.launch.json` | when a launch site holds the spawned child | the launcher identity of an expected contributor (`agent-run-usage-launch.v1`) |
| `<invocation_id>.checkpoint.json` | while the client runs, each time its usage source has reported; removed once the record is retained | what the source has reported so far ([checkpoints](#checkpoints)) |
| `<invocation_id>.usage.json` | once, after the client's exit is observed | the settled usage record |
| `run-total.json` | after every registration, checkpoint and settlement | the launcher's current run total |

A launch is registered when its runner holds a child, and not before. A launch
that fails before any child exists (the run log cannot be opened, the confined
spawn throws) leaves no launch entry and no record. A child whose start then
fails asynchronously was held: whether a client ran is unknown, and the launch
stays an expected contributor.

An orchestrator launch also leaves `native-usage.json` in its own runtime
directory, naming this records directory and its `run-total.json`. The pointer
names the task the launch began, so it is left even when the orchestrator's own
capture could not be prepared: what its dispatches retain is still found, and
the total then has no orchestrator entry.

| Field | Content |
| --- | --- |
| `invocation_id`, `attempt_id`, `run_id`, `parent_invocation_id`, `repo`, `subject`, `role`, `route`, `mode` | launcher-owned identities; a dispatched role carries its dispatch `run_id`, and fields a route does not supply are null. Nothing the client reports can replace one |
| `family`, `client_version`, `native_session_id` | the family, the version the client reported when it reports one, and its session or thread identity |
| `source` | the adapter's declared semantics and `usage_presence` |
| `resumed` | the launcher's own fact about whether it resumed a native session |
| `status` | `complete`, `partial`, or `unavailable`, following `tokens.total` |
| `tokens`, `cost`, `peak_context` | quantities in the numerical contract's `{ value, observed, status }` shape |
| `end_snapshot` | the session's last cumulative report, the baseline for a later resume |
| `stream`, `exit` | decoder counts, whether the stream was drained and reached a terminal event, and the exit observed |
| `causes` | `{ code, quantity, detail }` for everything that kept a quantity from being complete |

The record holds numbers, identities, coverage and structural causes only. It
never holds prompts, replies, tool bodies, environment values, credentials or
transcript text. Token counts are client-reported usage, not an invoice.

### Semantics established with the installed clients

These were first observed with Codex `codex-cli 0.161.0` and Claude Code
`2.1.296`, against local model-free endpoints, and are asserted as behavior on
whichever releases are installed.

| Fact | Codex | Claude |
| --- | --- | --- |
| Source | the session record's `token_count` reports | the `result` event's `modelUsage` and `total_cost_usd` |
| Input semantics | inclusive: input contains cached input | exclusive: uncached input, cache reads and cache writes are separate |
| Resumed session | the thread's lifetime total is reported again | `modelUsage` and cost are lifetime totals; `result.usage` covers only the latest turn |
| Native descendants | one thread's own requests | `modelUsage` includes native subagents; `result.usage` does not |
| Cost | none | the client's own estimate |
| Source reported no usage | the session record has `token_count` with `info: null` (the `exec --json` stream would report zeros) | the `assistant` event carries no `usage` |

Consequences in the record:

- A resumed session is charged its increment only. The baseline is the retained
  record of the same native session and source. Without one the quantities are
  unavailable with `missing_baseline`; the lifetime total is never charged to
  one launch.
- A fresh session starts from zero only because the launcher started it fresh.
- A headless Claude launch runs in the launcher's permission posture
  (`--permission-mode default` with a settings allow list). In that posture,
  with an allowed tool call, a tool call the settings do not grant, and no tool
  call, every request the installed client made to the model source was in its
  terminal aggregate, and it made no request outside its turns. That is the
  evidence a complete headless Claude record rests on. It does not cover a
  headless launch in another permission mode: the interactive client's
  permission classifier makes requests no total reports, and the launcher
  starts no headless client in a mode that uses it.
- For Claude the terminal aggregate is used alone. Per-message usage is never
  added to it, and several `result` events in one process are successive
  reports of one total.
- `source_usage_absent` and `source_usage_presence_unverified` keep a zero that
  the source did not demonstrably report from being a complete zero.
- `peak_context` is never complete: which requests a client makes beyond the
  ones it reports is not established. The observed maximum is `partial`.
- A stream that was truncated, undrained, damaged or without a terminal event
  yields `partial` or `unavailable` quantities with `stream_incomplete` or
  `terminal_usage_missing`; observed numbers are kept as `observed`.

### OpenCode and Agy benchmark launches

The headless OpenCode **1.19.3** (`run --format json`) and Agy **1.4.0**
(`--print --output-format stream-json`) adapters use this same accounting path.
`native-usage-step-adapters.mjs` selects native facts; the shared capture and
numerical kernel own normalization and arithmetic. The orchestrator begins its
task before creating its MCP conduit, so every launcher-dispatched worker,
reviewer and redteam joins the same task. Each started attempt registers even
when it fails, is cancelled, or never reports usage. A retry is another
contributor; settlement and replay of one invocation never add it again.

| Native source | Interpretation |
| --- | --- |
| OpenCode `step_finish.part`, keyed by part ID and bound to its session and message | Disjoint request reports. `tokens.input`, `cache.read`, and `cache.write` are separate input categories; `tokens.output` excludes `tokens.reasoning`. Normalize output as their sum and keep reasoning separately. |
| OpenCode `part.cost` | Sum the unique steps' client estimates, retaining USD and `opencode.step_finish.cost` provenance. Missing cost stays unavailable. |
| Agy `step_update.step_update.usage`, keyed by conversation and step index | Latest per-step observations, including checkpoint steps. Repeated updates replace that step; they are never added as new requests. Before a result, these remain partial observations. |
| Agy `result.result.usage` | Cumulative session counters replace the per-step observations. Input combines `input_tokens` and `cache_read_tokens`; `output_tokens` already includes `thinking_tokens`. No cache-write or monetary cost counter is reported by this protocol: those quantities remain unavailable. |

The OpenCode mapping was checked against the installed 1.19.3 package's native
`Session.getUsage` implementation and CLI event emitter: the emitter filters
parts to the current session, and a resumed `run` emits only the new invocation's
steps. Its invocation interval starts from zero even on resume; the record still
retains the launcher's actual `resumed` fact. No lifetime baseline is inferred
from its message or session aggregates and no descendant database is added.

The native serve/API owner prepares the same accounting tap with
`prepareNativeUsageLaunch({ family: "opencode", usageTransport: "opencode_api",
args, workspaceDir, env, identity, resumed })` from the exported
`native-usage-records.mjs` entry point. The real service argv is returned unchanged.
Pass the returned `tap` as the shared supervisor's `stdoutTap`, then:

1. Call `tap.bindNativeSession(session.id, { clientVersion: health.version })`
   after validating the native health response and created session, before
   observing parts. Omit the version option if no native version was observed.
2. Call `tap.observeNativePart(part)` for each native `step-start` or `step-finish`
   part from that invocation's API events or complete message-part inventory.
   Repeated part IDs are counted once; conflicting parts or session identities
   make usage incomplete. Text/tool bodies and message/session token aggregates
   are not accounting inputs. On resume, feed only the new invocation's parts.
3. Call `tap.endNativeUsage({ complete })` before the supervisor settles usage.
   `complete: true` requires the owner's complete inventory/stream of the
   invocation's native parts. A final response containing only its last
   message's parts does not prove that earlier tool-call requests were captured.
   Missing, failed, or cancelled collection uses `complete: false`; reported
   observations are retained as partial. Collect before terminating the native
   service when possible, including the API-error path.

The supervisor owns registration, exit, settlement and retention for this tap
exactly as for stdout clients. API mode ignores readiness stdout and preserves
it for the existing result parser. Ordinary `tap.end({ drained: true })` cannot
establish API source completeness. Without explicit source completion, even a
native stop part remains partial. No new harness parser, arithmetic owner or
output schema is introduced. This interface does not itself start an API
subscription or fetch a session inventory: those belong to the native service
owner. Its wiring is separate from the stream adapter's accounting contract.

Agy's [headless protocol](https://antigravity.google/docs/cli/headless) documents
per-step usage and cumulative session results; the [1.4.0 release changelog](https://github.com/google-antigravity/antigravity-cli/blob/1.4.0/CHANGELOG.md)
identifies the supported release. Resumes subtract only the retained same-session,
same-source baseline. Interrupted per-step observations extend that baseline;
a later cumulative result replaces them. Without a bound baseline, resumed
quantities stay unavailable. A terminal error or cancellation can still carry
complete usage; without terminal usage, observations stay partial. Child
conversation identifiers and tool result bodies are never additional usage
reports. These adapters describe root-session reports, not inclusive descendant
aggregates; separately dispatched clients are separately registered populations.

Both supervisors tap stdout before bounded result capture, checkpoint observations,
and settle after exit and stream drainage, independent of result parsing success.
They preserve these clients' native protocol for existing completion parsers.
Malformed events, conflicting identities, conflicting repeated OpenCode parts,
missing fields, and capture limits prevent complete totals. Missing counters never
become zero. The record's client version remains null when the stream reports none;
the version pins above describe the qualified format rather than invented runtime
version evidence. API captures can retain the validated native health version. Interactive TTY sessions have no stream capture in these adapters.

The AgentChassis benchmark exporter continues to follow `native-usage.json` to
`run-total.json`; it has no OpenCode or Agy parser. Trial metadata retains coverage,
partial observations, cache writes, reasoning and cost provenance. Numeric trial
fields are populated only for complete quantities. Retained `runtime/native-usage/`
artifacts carry the same launch entries, usage records and totals, including failed
attempts. Model-free tests exercise framing, repeated and cumulative reports,
resumes across tasks, failures, missing contributors, protocol preservation and
agreement between retained totals and the trial projection. They do not qualify
live providers, billing, unreported auxiliary requests or interactive usage.

### Checkpoints

A usage record is written once, after the client has ended. Until then a
checkpoint (`agent-run-usage-checkpoint.v1`, `native-usage-checkpoints.mjs`)
keeps what the launch's usage source has already reported, so a launcher that
dies before settlement leaves more than a launch entry.

- A checkpoint is always `pending`. Its quantities carry what was observed so
  far and no value, so none is ever `complete`; it has no end snapshot, so it is
  never the start baseline of a launch that resumes the session.
- It exists only after the source has reported a cumulative counter. A launch
  whose source has reported nothing has no checkpoint and stays `unavailable`;
  a reported zero is a checkpoint that observed zero. Nothing is derived from
  per-message usage to stand in for a total the source has not written.
- It holds the launcher's identities, the native session identity, the source
  semantics, quantities and cause codes: no prompt, reply, tool body, path or
  environment value.
- Its file is named by the launcher's own invocation identity in the launcher's
  own records directory. A checkpoint that names another invocation, or a
  records directory reached through a symbolic link, is refused.
- Each invocation has one writer with a bounded queue: one write in flight and
  one waiting, a newer checkpoint replacing the one waiting. Settlement closes
  the writer, waits for the write in flight, writes the record, and removes the
  checkpoint once the record is retained. No checkpoint is written after
  settlement, and a record that could not be retained leaves the last
  checkpoint in place.
- A checkpoint that cannot be written changes nothing else.

| Route | When a checkpoint is written |
| --- | --- |
| Claude output stream | when the `result` event arrives on the stream, before the client exits |
| Codex session record: dispatched roles (confined, and the early unenforced launch), the Codex role command (orchestrators, unconfined launches) and the Temporal wrapper | after every turn: a second launcher-trusted hook, on the client's `Stop` event, signals the launcher, which reads on in the session's record from where it last stopped |
| Claude session record (interactive orchestrators) | when a session ends: the same signal on the client's `SessionEnd` event |

The signal hook discards its input, which can carry the turn's last message,
appends one byte to `<invocation_id>.usage-signal` beside the binding file, and
prints nothing. The launcher watches that one file from the moment it holds the
child until settlement; signals that arrive during a read are folded into one
further read, no timer is involved, and no record is reread from its start.

Established with the installed clients against local endpoints:

- `codex-cli 0.161.0` runs `Stop` when a turn ends, in `exec` and
  interactively, and the rollout record already holds that turn's
  `token_count` reports then. A `Stop` handler is trusted under the event label
  `stop`, and its trust identity has no matcher.
- Claude Code `2.1.296` runs `Stop` when a turn ends, but its session record
  holds no `cost-state` then, and the turn's own entries may not be written
  yet. An open Claude session therefore has no checkpoint.
- Claude Code `2.1.296` has written the session's `cost-state` when
  `SessionEnd` runs as the client exits. At `/clear` it runs `SessionEnd`, and
  the next session's `SessionStart`, before it writes the ended session's
  `cost-state`. A session `/clear` ended is therefore checkpointed when a later
  session ends, and the last session between its end and settlement.

### Failures

Capture never changes a run's exit, signal, final result or exception. A record
that cannot be written is reported by the settlement as not retained, with
`usage_records_dir_not_owned`, `usage_record_write_failed` or
`usage_records_dir_unresolved`; a records directory reached through a symbolic
link is refused. A headless orchestrator's session record carries
`native_usage` with the invocation, the record's status, its path, and the
retention cause when nothing was retained.

### Run totals

The expected contributors of a run are the launcher's own launch entries, never
the set of records that happen to exist. An entry with a settled record is
`launched`; an entry without one is `unknown`, because the launcher started a
client and never settled its usage. A failed attempt and its retry are two
entries. A launch that never reached a child has no entry and adds nothing. A
record no entry accounts for is reported as `unlisted` and is not a member.

`aggregateRetainedRunUsage(dir)` combines them through the numerical contract.
Complete totals require a complete record for every expected launch; otherwise
the complete values are null, the counted portion stays `observed`, and
`coverage` states how many contributors were expected, complete, partial and
unavailable. A repeated record counts once, and an unreadable entry or record
leaves the total incomplete.

An `unknown` contributor that left a [checkpoint](#checkpoints) is counted as
`partial` with `contributor_usage_pending`: what it observed joins the observed
portion, its outcome stays unknown, and the total is never complete. A
contributor with a settled record ignores any checkpoint beside it.

### Claude: the hook-bound session record for interactive sessions

An interactive Claude session has no output stream to tap.
`native-usage-claude-session.mjs` reads its usage from the session record
instead, through the same owner as Codex (`native-usage-session-binding.mjs`:
one `SessionStart` hook that appends its input to a file in the launch's
runtime directory, the allowlisted binding file, one contributor per session,
and settlement after the client has ended). The hook is a settings fragment
composed into the confined settings beside the role-guide hook; the unconfined
settings stay hook-free.

These hold for Claude Code `2.1.296`, driven interactively in a terminal
against a local endpoint:

- The client writes a `cost-state` entry to the session record when a session
  ends. Its `modelUsage` and `totalCostUSD` are that session's cumulative total
  over its turns and the titling requests that have no message entry.
- That total does not include every request the client makes. With a tool call
  pending, the client's own permission classifier made ten requests to the
  model source, and none of them was in the session total. These records are
  therefore never complete: `partial` with `auxiliary_requests_unreported`.
- The total starts from zero for each session. `/clear` ends the session and
  starts another with its own record; the hook fires again with `clear`, and
  the next session is the contributor `<invocation_id>.s<n>`.
- An `assistant` entry carries the usage the source reported for that message,
  which is how a reported zero is told from an unreported count.
- The record path is used only when it is the regular file
  `<config dir>/projects/.../<session id>.jsonl` and its entries name that
  session; anything else is `session_record_not_bound`.
- A session that ended without a `cost-state` entry has no total:
  `terminal_usage_missing`.

Whether the session total includes the session's native subagents was not
established: against a local model source the client's permission classifier
blocked the delegation, and that boundary was left in place. The source's
`descendant_coverage` is `unknown`.

### Tasks

A task is one root launch and the launches made on its behalf. Each task has
its own directory `<records root>/<task id>/`, where the task id is the root
launch's `invocation_id`; `task.json` in it names the task and its repository.
Two orchestrator launches in one repository, repeated or concurrent, are two
tasks with two directories and two totals.

- An orchestrator launch begins its task before it starts anything, and sets
  two launcher-owned carriers in its own process: `AGENT_LAUNCH_USAGE_TASK_DIR`
  and `AGENT_LAUNCH_USAGE_PARENT_INVOCATION_ID`.
- The launcher forwards those carriers to the host processes it starts for that
  launch. A role dispatched from them joins exactly that task, with the root
  launch as its `parent_invocation_id`.
- A carrier joins a task only when it names a real directory, not a link, that
  holds its own valid `task.json`. Anything else joins nothing: the launch
  roots its own task. A dispatch request cannot supply a task, an
  `invocation_id` or a parent.
- A launch outside any orchestrator roots its own task.
- A resumed session's earlier launch may be in another task. The baseline is
  looked up by family, native session and source across the tasks of the
  records root.

A dispatched role's launch entry and record carry its dispatch run identity as
both `run_id` and `attempt_id`.

`run-total.json` is rewritten after every registration and settlement, by
whichever process made it. A reader must not take it as current on its own:
the total lists the launches it covered, and the exporter compares that list
with the launch entries and records then in the task directory. A total that
does not cover exactly those entries, or that predates a record, is withdrawn
to `partial` with `run_total_stale`.

### Temporal job wrapper

The wrapper's live model command goes through the same core owner
(`agent-job-wrapper-usage.mjs`). Claude's argv is switched to the stream mode
and the wrapper reads the final text from stdout as before. The command runner
hands each stdout chunk to the capture as it arrives. Once the stream is the
client's protocol the runner keeps none of it, so a long stream is not held
until the command ends; what the capture holds is one unfinished line and the
final text. Output that is not the protocol stays the runner's plain stdout,
and stderr, the exit and the signal are the runner's own. A Codex `exec` argv
gets the usage hook and its turn-end signal hook directly after `exec` and is
otherwise unchanged. Records
are kept under `<output dir>/launcher-state/usage/`, and
`<output dir>/native-usage.json` names the job's records and total. The result
envelope does not carry usage.

Capture needs the output directory to exist, an argv with a headless mode, and
for Codex a client home; otherwise the command runs exactly as built and the
cause is returned.

Membership follows the command's own lifecycle, which the wrapper's command
runner owns:

- The pointer is written before the command is started.
- The runner reports the moment the operating system started the process. The
  launch entry is registered then, so while the command runs the job's records
  already name one contributor whose usage is pending and whose total is not
  complete. A wrapper interrupted at that point leaves that entry behind.
- A command the runner proves was never started (no process, a start error) has
  no entry and is not a contributor.
- A runner that fails without an outcome leaves it unknown whether a client
  ran: the launch stays an expected contributor, what it left is settled and
  never called complete, and the runner's own error is raised unchanged.
- A command the runner stops (its timeout, a signal) keeps its return value.
  Its record holds what the client had reported and is never complete.

The records and the pointer live in the output directory, which the job mounts
as one volume in both the model step and the finalizer. That volume goes with
the pod, so what is retained is carried in the job's result artifact.

#### Retained accounting

Before it publishes the job's result ConfigMap, the wrapper reads the job's
accounting from the output directory and adds it as a third data key,
`native-usage.json`, beside `response.md` and `status.json`. `status.json` is
exactly what it is without it, and the status envelope gains no field.

`native-usage.json` is one `agent-job-native-usage.v1` object:

| Field | Meaning |
| --- | --- |
| `task` | the handoff's `initiative_id`, `wk_id`, `attempt_id` and `dispatch_idempotency_key` |
| `job` | the Kubernetes `job_name`, `namespace` and `job_uid` |
| `state` | `retained`, `absent` or `unavailable` |
| `cause` | why the state is not `retained`, otherwise null |
| `total` | the launcher's run total for the job's task, from the shared arithmetic owner |
| `records` | at most 32 contributors, reduced to accounting and identity fields |
| `records_truncated` | more contributors existed than are listed |
| `grants_authority` | always `false` |

- **`absent`** means no model command was captured: there is no pointer
  (`usage_not_captured`) or no output directory (`usage_output_dir_unavailable`).
- **`unavailable`** means accounting existed and could not be carried: the
  pointer is unreadable, names records outside the job's own output directory
  (`usage_records_not_in_output`), or the artifact would exceed its bound
  (`usage_metadata_too_large`). No total is carried and none is invented.
- **Pending and partial evidence is kept as such.** A contributor that was
  started and never settled is counted in `total.coverage.unknown_outcome`, and
  a stopped client's record is carried with its own status and causes. The
  total is `complete` only when every expected contributor is.
- **Bound.** The serialized artifact is at most 65536 bytes. Contributors are
  dropped before the total.
- **Identity.** A retry is another job, with its own result artifact and its
  own accounting. The artifact names the attempt and job it accounts for.
- **No authority.** The artifact carries no path, prompt, output, environment
  or credential, and is never an input to the job's result, trust or path
  decisions. A job's outcome is the same whether or not it could be carried.

`loadKubernetesJobNativeUsage`, a function of the worker's Kubernetes activities
owner, reads it back from the same ConfigMap and under the same ownership check
as the status, so it is available after the pod is gone. It is a callable
capability only: it is not one of the workflow's named activities, no workflow
invokes it, and nothing reports a job's accounting automatically. It returns `retained` with the artifact, `absent` when
the result artifact carries no accounting, or `invalid` with the fields that
do not match when the artifact is not this job's or is not a current
accounting artifact. Retention ends when the result ConfigMap is deleted. The
launch-core modules the wrapper loads are part of the wrapper implementation
digest. Those modules load only each other and Node's own modules, so the
worker image needs the core package's files and no installed dependency of it.

## Inspect Run Provenance

Use the repo-local inspection command to read a direct-wrapper run directory
or a provenance artifact path:

```bash
npm run agent-launch -- provenance .agent-runs/runs/work-graph record/RUN-.../
npm run agent-launch -- provenance .agent-runs/runs/work-graph record/RUN-.../metadata/provenance.json --json
```

To inspect bounded runtime tails, add `--tail-lines`:

```bash
npm run agent-launch -- provenance .agent-runs/runs/work-graph record/RUN-.../ --tail-lines 20
npm run agent-launch -- provenance .agent-runs/runs/work-graph record/RUN-.../metadata/provenance.json --json --tail-lines 20
```

Text mode prints the terminal status, run id, role, subject, started and
completed timestamps, artifact paths and digests, validation summaries,
heartbeat freshness when available, and bounded response/stdout/stderr tail
sections when requested. JSON mode emits a machine-readable object with `ok`,
`diagnostics`, and `provenance` for orchestrator monitoring; when
`--tail-lines` is set, the provenance payload includes explicit per-artifact
tail snapshots instead of a live log stream.

This is runtime evidence only. Even after inspection, the result is not
canonical wiki state. If the inspection changes what you know about a run,
promote the durable conclusion into WK closure notes, IN notes, docs, or a
decision record.

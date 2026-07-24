
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

Reviewed launcher runs already produce `metadata/state.json`,
`metadata/meta.json`, `metadata/review.json`, `metadata/input-manifest.json`,
and `response.md`. Those files are the reviewed-launcher projection of
`agent-run-provenance.v1`; a future implementation should either write an
explicit `metadata/provenance.json` or make `meta.json` a documented compatible
projection. Direct role wrappers should converge on the same envelope rather
than inventing a separate log format.

## Dispatch Enforcement Provenance

A structured dispatch run also carries `structured-dispatch-provenance.v1` on its
terminal `final_result.provenance`, exposed only under
`include_final_result`/`verbose`. Two blocks inside it record the run's
containment posture:

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
- A **launcher-synthesized envelope** — `executor_terminal_without_final_result`
  or `probe_terminal_without_final_result`, built when there is no executor
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


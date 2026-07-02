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


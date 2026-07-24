
# MCP Operation Reference

> **This is reference material.** For first setup, start with
> [docs/quickstart.md](quickstart.md) and read the integration contract in
> [docs/mcp-integration.md](mcp-integration.md). This page is the per-operation
> reference for the MCP tools and their CLI fallbacks.

This document lists each MCP operation and CLI fallback, together with the
shared contract-edit and graph-impact behavioral contracts. It was extracted
from [docs/mcp-integration.md](mcp-integration.md) so the integration page can
stay a focused MCP setup and mental-model entry point.

## Operations

- `bootstrap_repo` creates required local wiki surfaces in the consuming repo
- `sync_contract` copies shared templates, creates missing shared core files, and updates local contract metadata
- `allocate_id` reserves the next local identifier for a type and updates `wiki/.id-state.json`
- `create_record` writes a record into the consuming repo and consumes the next outstanding reservation for that type when one exists
- CLI `read` reads a full markdown page by repo-relative path through the shared read core
- CLI `get-record` reads a canonical wiki record by durable ID through the shared read core
- `workspace_read_page` reads a Markdown page, canonical `wiki/work-records/WK-####.json` work record, or per-WK `wiki/work-records/evidence/WK-####.graph.json` graph-evidence sidecar from a configured repo alias; JSON work-record reads return a `json-work-record` envelope with the parsed record, and graph-sidecar reads return a compact-by-default `graph-evidence-sidecar` envelope (replay/debug data, not dispatch-control input). Large unscoped expensive reads pass through the compact-first read gate (see [Compact-first work-record reads](#compact-first-work-record-reads)).
- `workspace_get_record` reads a canonical wiki record from a configured repo alias by durable ID; `WK-*` IDs return canonical JSON directly even when generated Markdown views are missing. Large unscoped expensive reads pass through the compact-first read gate (see [Compact-first work-record reads](#compact-first-work-record-reads)).
- `workspace_create_record` is the agent-safe MCP create route; it delegates to the shared allocator/template path in a configured repo alias and never accepts a caller-supplied filesystem root
- `lint_repo` checks the consuming repo against the shared contract, including allocator continuity for allocated record types
- `generate_views` writes the standard non-canonical `catalog`, `now`, `inbox`, `backlog`, and `archive` views plus an auxiliary summary into the consuming repo
- `generate_and_lint` runs `generate_views` followed by `lint_repo`
- `build_search_index` builds the shared lexical search index for canonical docs/wiki pages
- `workspace_build_search_index` builds the shared lexical search index for a configured repo alias
- `workspace_search_repo` queries a configured repo alias with shared filters; it is read-only and never creates or refreshes `.cache/wiki-search/index.json` when `reindex` is unset or `false`. When the on-disk index is missing or unreadable on a read-only cache, the tool returns a structured `search_index_diagnostic.v1` envelope (codes `search_index_missing`, `search_index_read_failed`, `search_index_write_unavailable`) that directs the caller to the explicit `workspace_build_search_index` (or CLI `wiki build-search-index`) capability. A stale on-disk index is still consumed for read-only search and is rebuilt in memory without rewriting the cache (`indexState: rebuilt_in_memory`). Only the explicit build surfaces, or `workspace_search_repo` invoked with `reindex: true`, write the cache. Compact/default results carry only the triage `metadata` fields needed to choose a page to open (`type`, `status`, `priority`, `owner`, `area`, `initiative`) alongside top-level `relativePath`, `id`, `title`, `heading`, `preview`, and `score`; the duplicate `metadata.id` is omitted because the top-level `id` is authoritative. Pass `verbose: true` to restore the retrieval/governance facets (`canonicality`, `maintenance_mode`, `knowledge_role`, `evidence_stage`, `retrieval_visibility`, `lifecycle`, `sensitivity`, `retrieval_role`, `topics`) plus the full index/filter diagnostics. All facets remain available as `workspace_search_repo` filter inputs regardless of projection mode. The legacy `search_repo` route shares the same projection and accepts the same `verbose` opt-in.
- `workspace_code_index_status` reports read-only repo code index status for a configured repo alias without building or rebuilding
- `workspace_code_index_build` explicitly builds the repo code index for a configured repo alias, writing generated artifacts only to an ignored cache path
- `workspace_code_index_rebuild` explicitly rebuilds the repo code index for a configured repo alias, writing generated artifacts only to an ignored cache path
- `workspace_code_index_impact_paths` reports read-only path impact context for configured repo alias paths.
- `workspace_code_index_graph_impact_paths` reports read-only graph-backed impact context for configured repo alias paths; graph evidence is derived, non-canonical code index evidence. Output is compact by default (a single bounded `graph_impact_summary`, a persistable `graph_impact_summary_ref`, the `verbose: false` marker, and compact `dirty_state`/`staleness` scalars); pass `verbose: true` only for debugging to add the expanded `graph_impact` alias, the full input/validated/invalid path arrays, validation hints, raw `graph_state`, and the raw envelope (`graph_impact_raw`)
- `workspace_code_index_graph_impact_diff` reports read-only graph-backed impact context for caller-supplied parsed/raw diff input or explicit live-git diff input; graph evidence is derived, non-canonical code index evidence. Output is compact by default like `graph_impact_paths`; pass `verbose: true` only for debugging to add the expanded `graph_impact` alias, the full path and diff-record arrays (input/validated/invalid paths, parsed/validated/invalid diff records, affected/old/new paths), validation hints, raw `graph_state`, and the raw envelope (`graph_impact_raw`)
- `workspace_code_index_context_for_path` reports read-only scoped implementation context for one configured repo alias path. Default output is compact for sub-threshold files (`<=1200` LOC): routing signals only, including counts, bounded `top_canonical_refs` without `match_explanations`, `top_related_code_paths`, `top_likely_tests`, a minimal context pointer, and `next_action`. Files over the 1200 LOC code-index response-size guard return a compact degraded result instead. This inventory/context guard is unrelated to worker-admission policy and confers no admission verdict. Pass `verbose: true` to restore full context for either tier, including all `canonical_refs` with `match_explanations`, `source_entries`, `derived_evidence`, and artifact/cache path metadata. Legacy aliases `sidecar_context_for_path` and `workspace_sidecar_context_for_path` should not be used for the compact/verbose contract unless their tool descriptions explicitly advertise matching `verbose` support.
- `workspace_tools_list` lists the repository-local tool-discovery envelope as a compact daily-use catalog scan. Default output is bounded to the first 20 compact entries (`tool_name`, `display_name`, `kind`, `entrypoint`, `task_ids`, `runtime_posture`, `recommended_route`, `priority`); pass `task_id`, `tool_name`, or `limit` to narrow the scan. Use `workspace_tools_describe` for targeted per-tool detail and `workspace_tools_query` for known `task_id`/`tool_name` lookups. Read-only.
- `workspace_tools_describe` describes the repository-local tool-discovery envelope for targeted per-tool inspection. Default output is compact (same compact entry fields as `workspace_tools_list`) and bounded to 20 entries; pass `task_id`, `tool_name`, or `limit` to target a narrow set, and `verbose: true` for full catalog entries including `display_name`, `install_state`, `side_effects`, `authority`, `docs_refs`, `source_files`, and `notes`. Read-only.
- `workspace_tools_query` queries the repository-local tool-discovery envelope by `task_id` or `tool_name`; output matches the compact entry shape. Read-only.
- `workspace_work_record_validate` validates a canonical JSON work record by ID in a configured repo alias; read-only and never writes generated views, caches, or records
- `workspace_work_record_refresh_admission_metrics` is the agent-safe MCP route for refreshing worker-admission metric evidence on a `WK-####` record or `WK-####[#slice]` unit. It resolves only configured workspace repositories, accepts an optional `expected_source_digest` for stale-source protection, and writes refreshed `worker-admission-derived-evidence.v1` through the validated work-record path. It does not accept caller-supplied filesystem roots, shell output, inline environment policy, wrapper transport, temp worktrees, or graph-impact side channels as trusted inputs. Side effects: `workspace_write`, `record_write`. CLI fallback: `npm run wiki -- work-records refresh-admission-metrics --id <WK-ID|WK-ID#slice> --json`
- `workspace_work_record_refresh_target_resolution_evidence` is the agent-safe MCP route for refreshing target-resolution evidence on a `WK-####` record or `WK-####[#slice]` unit. It resolves only configured workspace repositories, accepts an optional `expected_source_digest` for stale-source protection, and writes refreshed target-resolution derived evidence through the validated work-record path. Resolves missing `missing_target_resolution_evidence` dispatch-readiness blockers. It does not accept caller-supplied filesystem roots, shell output, or graph-impact side channels as trusted inputs. Side effects: `workspace_write`, `record_write`. CLI fallback: `npm run wiki -- work-records refresh-admission-metrics --id <WK-ID|WK-ID#slice> --json`
- `workspace_validate_dispatch` evaluates dispatch readiness for a `WK-####` or `WK-#####slice` unit in a configured repo alias and returns the structured dispatch-readiness envelope. When required graph impact is missing or stale it runs the canonical current-HEAD resolver once and may write only the ignored code-index graph artifact, a sibling atomic temporary file, the advisory build-lock file, and eight exclusively claimed candidate slots named `.index.json.build-lock.json.slot-00.candidate` through `.index.json.build-lock.json.slot-07.candidate`. Candidates are attempted only during the initial absent-lock race, are retained but never reused or authoritative, and an existing persistent shared lock prevents additional candidates; exhaustion falls back to an independent atomic build. Concurrent refreshes coalesce only inside one process and only between equivalent base builds, gated by a process-local active-build registry rather than by the persistent lock: a follower resolves only on its captured leader's successful atomic publication and returns exactly those bytes, so a pre-existing artifact never satisfies a follower and a failed leader never becomes a coalesced result. SCIP builds never coalesce, and cross-process callers always perform an independent atomic build — the lock is bounded advisory residue, never liveness or correctness authority. It never mutates canonical WK/graph-evidence/admission evidence, lifecycle or `.agent-runs` state, dispatch/backend state, or result evidence, and never launches an agent. A bounded resolver failure remains a structural refusal: verbose readiness includes the safe `graph_impact_failure` envelope (preserving codes such as `graph_head_moved_unstable`), while compact output includes `graph_impact_failure_code` and its safe remediation as `next_action`; raw causes are not exposed. Use `dispatch_role: "read_only"` for a read-only role gate or `mode: "report-only"` for the non-strict report mode. The retired `allow_graph_index_write` option is rejected at both wrapper and exported-library boundaries regardless of value, as is every other unknown option.
- `workspace_run_validation` is an orchestrator/operator route for declared Node test validation without raw shell or raw exec. Managed implementation workers do not receive it; their only wiki-MCP capability is closed-input commit delivery. Side effect: `process_spawn`. Caller input is exactly `{ unit, target }` for the fixed enum command `node_test`; the handler loads the canonical work record/slice for `unit` itself and selects `target` solely from that unit's `sections.structured_validation.allowed[]` entries with command `node_test`. It then runs `node --check <target>` and, only if check passes, `node --test <target>` using argv arrays with `shell:false`. Node binary, cwd, env, per-step timeout, and per-stream output cap are internal server constants; caller-supplied privilege-shaped fields (`snapshot`, `authority`, `runtime_policy`/`env`, `node_binary`, `cwd`/`workspaceRoot`, `timeout`, `outputCap`, `source_digest`, `args`, and equivalents) are rejected. `target` must be repo-relative, canonical, existing, `.js`/`.mjs`, contained under the configured workspace repo, and not a symlink escape. Returns structured per-step evidence (step, normalized argv, exit code, bounded stdout/stderr, timeout/truncation state, ok); `node --test` is reported as skipped when `node --check` fails. Its evidence is command-surface validation, not a Chassis Control Engine enforcement attestation, and arbitrary-command/npm-script/cross-repo validation is out of scope for this surface.
- `workspace_work_record_set_status` writes a narrow trusted status update to a work-record or slice in a configured repo alias; it accepts `unit` plus `status`, reuses the canonical work-record edit substrate, and rejects arbitrary JSON patching or direct field-path edits. When the write moves the unit to `review` or `done`, the response carries an advisory post-write `closeout_lint` summary: `ok`/`valid`, `warning_count`, `error_count`, bounded `top_findings`, `generated_views`, and `next_action`, plus a top-level `cleanly_closeable` flag. The lint runs `generate_and_lint` first so generated views are refreshed before linting. This is advisory, not a hard refusal — the status write still succeeds — but if lint is red (`closeout_lint.ok:false`) the unit is **not** cleanly closeable until lint is fixed or a specific pre-existing lint blocker is recorded. Other status transitions report `closeout_lint.applicable:false`. Side effects: `workspace_write`, `record_write`. CLI fallback: `npm run wiki -- work-records set-status --unit <WK-ID|WK-ID#slice> --status <status>`
- `workspace_work_record_set_task` writes a narrow trusted task-completion update to a work-record or slice in a configured repo alias; it accepts `unit` plus exact task `text` or zero-based `index`, reuses the canonical work-record edit substrate, and rejects arbitrary JSON patching or direct field-path edits. Side effects: `workspace_write`, `record_write`. CLI fallback: `npm run wiki -- work-records set-task --unit <WK-ID|WK-ID#slice> --text <exact task>`, or `--index <n>` for a zero-based task position
- `workspace_work_record_set_closure` writes a structured closure patch (`summary`, `validation`, `follow_ups`) to a work-record or slice in a configured repo alias; refuses if a supplied `expected_source_digest` no longer matches the on-disk record. After a successful closure write the response carries the same advisory `closeout_lint` summary as `set_status`: `ok`/`valid`, `warning_count`, `error_count`, bounded `top_findings`, `generated_views`, `next_action`, and a top-level `cleanly_closeable` flag, after running `generate_and_lint` to refresh generated views. It is advisory (the closure still persists) but a red lint means the unit is not cleanly closeable until the lint failure is fixed or recorded as a pre-existing blocker. Side effects: `workspace_write`, `record_write`
- `workspace_work_record_upsert_slice` creates or updates a tracker-local slice on a `WK-####` in a configured repo alias. Takes the target record in `unit` (WK-####) and the slice body in `slice` (its `id` selects the slice). Validates the edited record against work-record.v1 before writing and refuses invalid edits. Accepts an optional `expected_source_digest` for stale-source protection. Output is compact by default; pass `verbose: true` only for debugging to include the full updated record. Side effects: `workspace_write`, `record_write`. CLI fallback (operator-shell only): `npm run wiki -- work-records upsert-slice --id <WK-ID> --slice-json '<json>' [--expected-source-digest <digest>] --json`
- `workspace_work_record_ready_slice` atomically creates or updates one complete, independently executable tracker-local slice contract. Its one strict schema exposes only the fields in `ready-slice-contract.v1`; it has no opaque slice payload, arbitrary patch, caller-selected write authority, or CLI fallback. It performs at most one canonical contract write and returns the closed `ready-slice-structural-readiness.v1` projection after a successful write or no-op. It is installed and supported in the free/local tier for orchestrator and operator sessions only. Side effects: `workspace_write`, `record_write`.
- `workspace_work_record_delete_slice` removes a tracker-local slice from a `WK-####` in a configured repo alias. Accepts a slice-scoped `unit` (WK-#####slice-id) or an explicit `slice_id`. Validates the edited record against work-record.v1 before writing. Accepts an optional `expected_source_digest` for stale-source protection. Output is compact by default; pass `verbose: true` only for debugging to include the full updated record. Side effects: `workspace_write`, `record_write`. CLI fallback (operator-shell only): `npm run wiki -- work-records delete-slice --id <WK-ID> --slice-id <slice-id> [--expected-source-digest <digest>] --json`
- `workspace_work_record_set_list_field` sets one controlled list-valued contract field (`read_scope`, `docs`, `repo_paths`, `write_scope`, `depends_on`, `related`, `blocks` at record scope; `read_scope`, `docs`, `repo_paths`, `write_scope`, `depends_on` at slice scope) on a `WK-####` in a configured repo alias. `read_scope` is the canonical read-first reference list; `docs` is accepted as a backward-compatible alias and is folded into `read_scope` on write. The `unit` selects record vs. slice scope. Validates against work-record.v1 before writing. Accepts an optional `expected_source_digest` for stale-source protection. Output is compact by default. Side effects: `workspace_write`, `record_write`. CLI fallback (operator-shell only): `npm run wiki -- work-records set-list-field --id <WK-ID> --field <field> --values-json '<json-array>' [--expected-source-digest <digest>] --json`
- `workspace_work_record_set_acceptance` sets `acceptance.criteria` and/or `acceptance.validation` at record or slice scope on a `WK-####` in a configured repo alias. The `unit` selects record vs. slice scope. It is the only contract setter with the closed invalid-base repair path described below; all other setters remain fail-closed on an invalid base. The strict input schema exposes only the named acceptance arrays and ordinary routing/concurrency/debug fields, never arbitrary JSON edits or caller-controlled repair authority. Accepts an optional `expected_source_digest` for stale-source protection. Output is compact by default and preserves diagnostic order and codes subject to the diagnostic bounds described below. Side effects: `workspace_write`, `record_write`. CLI fallback (operator-shell only): `npm run wiki -- work-records set-acceptance --id <WK-ID> [--criteria-json '<json-array>'] [--validation-json '<json-array>'] [--expected-source-digest <digest>] --json`
- `workspace_work_record_shape_review_unit` shapes a `WK-####` or tracker-local slice into a findings-only review unit: sets `work_kind` to `"review"`, forces `write_scope` to `[]`, and points `dispatch_intent.intended_agent_role` at `"reviewer"`. Validates against work-record.v1 before writing. Accepts an optional `expected_source_digest` for stale-source protection. Output is compact by default. Side effects: `workspace_write`, `record_write`. CLI fallback (operator-shell only): `npm run wiki -- work-records shape-review-unit --id <WK-ID> [--expected-source-digest <digest>] --json`
- `workspace_record_graph_impact_evidence` persists structured graph-impact evidence onto a work-record or slice in a configured repo alias. The `graph_impact` payload may be the full structured envelope returned by `workspace_code_index_graph_impact_paths` or `workspace_code_index_graph_impact_diff`, or a provenance-bound compact summary/ref derived from that envelope; the tool rejects caller-supplied filesystem roots, shell command output, and unbound handoff prose as trusted inputs and validates the persisted entry against the canonical work-record schema before writing. Side effects: `workspace_write`, `record_write`. This is the only agent-safe persistence route for graph-impact evidence — there is no shell/CLI fallback for trusted-evidence persistence, and the compatibility boundary with the full envelope remains intact. Output is compact by default (status, `written`, `selected_unit`, `source_digest`, `valid`, bounded `diagnostics`, and the bounded summary/ref); pass `verbose: true` only for debugging to include the raw `graph_state` and the full refreshed derived evidence. `verbose` never relaxes the trusted-evidence binding the route requires
- `workspace_generate_and_lint` runs `generate_views` followed by `lint_repo` for a configured repo alias; write-capable for the generated wiki views surface and generated package README projections. Use after structural wiki changes. Accepts an optional `max_findings` integer (see `workspace_lint_repo` below) that controls how many lint findings the response returns after generation
- `workspace_lint_repo` validates a configured repo alias against the shared wiki contract; read-only and never writes generated views, caches, or records. Use `workspace_generate_and_lint` when the generated views must be refreshed before linting. Accepts an optional `max_findings` integer: omit it for the bounded compact default, pass `0` for counts/summary only, or pass a positive integer (no hard upper bound) to retrieve up to that many findings for a lint-repair session. Every response carries `finding_count_total`, `findings_returned`, `findings_truncated`, and `max_findings` alongside the backward-compatible `ok`/`valid`/`warning_count`/`error_count` fields; when findings are truncated, `next_action` tells callers to rerun with a higher `max_findings`. Large `max_findings` values are intentional for repair sessions but can produce large MCP responses. Work-record lint authority is the canonical `wiki/work-records/WK-####.json` layer: legacy `wiki/issues/WK-####.md` pages are historical/migration inputs, and package source templates under `packages/wiki-core/templates/**` are package inputs. Neither legacy issue pages nor package templates are linted as canonical work records.
- `workspace_docs_policy_validate` validates `AGENTS.md` and configured durable docs for agent-facing non-MCP role-dispatch drift. Sections classified as operator/internal by heading are audience-scoped and do not automatically fail; paragraph-level operator qualifiers such as "human/operator", "operator-only", "launcher-owned", "deactivated", "refusal-only", and "fail-closed" let specific paragraphs reference wrapper commands without firing drift diagnostics. Inputs: optional `repo` alias, optional `paths` array (defaults to `AGENTS.md`, `packages/wiki-core/templates/AGENTS.md.boilerplate.md`, `docs/mcp-integration.md`, `docs/tool-discovery.md`, `docs/agent-launch-quickstart.md`). Read-only; returns the `docs-policy.v1` envelope with `files_scanned`, ranked `diagnostics`, and a `summary` by code/level/file. CLI fallback: `npm run wiki -- docs-policy validate --json`
- `workspace_agent_dispatch` is the MCP-only agent dispatch transport for `worker`, `reviewer`, and `redteam` role calls. It refuses caller-supplied identity carriers, enforces the subject-role matrix (worker/reviewer -> WK or WK slice; redteam -> WK, WK slice, or IN), validates readiness through the structured dispatch-readiness gate, enforces reviewer findings-only `write_scope: []` during dispatch-readiness, and — when the launcher-owned launch backend is configured on the server process — calls `createWorkspaceAgentDispatchBackend(...).startLaunch(...)` to start a real launcher-controlled run before returning a server-minted opaque `monitor_handle` plus `run_id`. Stdio MCP is a same-user local transport, not an authentication boundary; dispatch is controlled by tool exposure plus work-record dispatch-readiness, not by a launcher-to-MCP registration prelude. The `backend_unavailable` blocker is reserved for the genuinely unconfigured case (no launcher-owned launch executor wired into the MCP server process); a configured backend reaches the readiness tail and starts a run. There is no shell/wrapper fallback, no inline env policy, no temp worktree, no bwrap widening, and no graph-impact side channel; missing structured transport is reported with the `missing_structured_transport` code. Side effects: `process_spawn`
  Findings-only review is plural. Every valid reviewer or policy-allowed redteam call against the same canonical committed target is independently admissible, including while another review is active or after any terminal history. Each launch has a distinct run id, monitor handle, execution state, and append-only exact-target receipt. Workers and reviewers are expected to run concurrently; collision safety comes from attempt isolation and exact ref/status compare-and-swap rather than a singleton or consumed-subject lifecycle.
  The normal agent input is `{ role, subject }`. Omitted typed `app`/`model` values are forwarded to the launcher backend, which re-reads the role model from repo-root `agent-launch.toml` on every dispatch and derives app/backend through the neutral model registry. Typed `app` and `model` are explicit per-dispatch overrides only. Missing, malformed, or unknown role configuration refuses actionably with no family fallback; prompt/request/argv/environment/claimed identity never become selection authority. Config edits apply on the next dispatch, while loaded launcher/MCP code changes require restarting the owning server or launcher session. Operator CLI examples may still use explicit `--app` where that separate CLI contract requires it.
- `workspace_agent_run_status` queries the status of a `workspace_agent_dispatch` run by its server-minted `monitor_handle`. Caller-supplied identity carriers are refused. When the launch backend is wired, the tool resolves the handle through `backend.getRunStatus(...)` and reports the controlled lifecycle vocabulary `launching`, `running`, `succeeded`, `failed`, or `cancelled` (the `pending_launch` state no longer exists). Terminal successful runs may include `final_result` with `kind: "findings"`, `kind: "no_findings"`, or `kind: "missing_result"`. `kind` is classification metadata only: consumers that need the agent's full final response must read `final_result.full_response.text` when present. For `findings` and valid `no_findings` results, `full_response` preserves the captured final response text plus `format` and `source`; for `missing_result`, `full_response` is `null` and `missing_result` explains why capture failed. Valid `no_findings` payloads keep the compatibility `reason` field and may also carry `text` and `source`; malformed or missing final-result payloads must degrade to stable `missing_result` diagnostics rather than silently returning an empty classification. Compact terminal responses include a bounded `final_result_summary.structured_role_result` projection when structured role-result evidence is present; `valid:false` is surfaced explicitly with diagnostic counts/codes while the run can still be `succeeded` and the full prose remains behind `verbose:true` or `include_final_result:true`. In the free/local tier this `structured_role_result.valid:false` is EXPECTED: under `decision` free-tier reviewer/redteam/worker output is prose-only and non-attesting, so it is not a failed child run, a failed dispatch, or missing findings. A schema-valid structured role result is a CCE capability enabled only by a configured CCE key. Exact-slice review receipts are retained independently per run and exact target. Status recovery never consumes the target, blocks another review dispatch, calls integration, or converts any review result into admission or veto authority. Fabricated handles, cross-subject reuse, caller/session mismatch, and replay refuse with the `monitor_handle_unknown`, `monitor_handle_subject_mismatch`, `monitor_handle_caller_mismatch`, or `monitor_handle_replay` codes. **Not read-only for a managed exact-slice worker run**: polling a terminal managed worker may prepare and freeze its slice-review surface, but it parks until the separate coordinator integration continuation completes. Side effects: `workspace_write`, `record_write`. See [Managed-run terminal semantics](#managed-run-terminal-semantics).
- `workspace_integrate_committed_slice` is the separate orchestrator continuation for exact committed-slice integration. Input is closed to a repository alias, canonical `WK-####\\#SLICE-###` subject, and optional per-comment `accept`/`reject`/`defer` dispositions. Those dispositions are advisory request facts, not authorization. Refs, SHAs, receipts, review results, liveness claims, policy verdicts, CCE decisions/attestations, and other authority carriers are rejected. The server re-derives the exact target and calls the configured CCE policy capability. A configured gate fails closed on missing, unavailable, malformed, unratified, denied, or target-mismatched evidence; no configured gate follows decision free-substrate behavior and reports non-audit posture. Paid-tier presence by itself implies no policy. Integration remains CAS-safe, idempotent, and exactly once. Side effects: `workspace_write`, `record_write`.
- `workspace_agent_run_wait` blocks until a `workspace_agent_dispatch` run reaches a terminal state or a caller-specified timeout expires, returning a single response per tool call so coordinators do not need to poll across turns. Schema version `workspace-agent-run-wait.v1`. Input: `monitor_handle` (required), optional `subject`, optional `timeout_ms` (integer [1, 300000], default 60000), optional `poll_interval_ms` (integer [500, 60000], default 5000), optional `verbose`, optional `include_final_result`. Out-of-range or non-integer values for `timeout_ms`/`poll_interval_ms` are refused with `validation_failure` and explicit detail; no silent clamping. Terminal response: `accepted:true`, `timed_out:false`, `terminal:true` — meaning the *complete managed run* is finalized, not merely that the child exited — compact by default (bounded `final_result_summary`, including bounded `structured_role_result` validity/diagnostics when present); pass `verbose:true` or `include_final_result:true` for the full `final_result` envelope. `terminal` stays `false` after child success while the managed post-worker lifecycle is unresolved: the route then either waits within its window or, when the lifecycle is blocked on a caller action, returns promptly with that exact `next_action` (see [Managed-run terminal semantics](#managed-run-terminal-semantics)). Timeout response: `accepted:true`, `timed_out:true`, `terminal:false`, current status fields, `child_terminal` identifying which wait expired, `next_action`, and a `lifecycle_resolution` when one applies. Mid-wait backend refusal: `accepted:false` surfaced immediately (same refusal envelope as `workspace_agent_run_status`). Shares all identity-carrier refusals, workspace resolution, caller-session binding, and subject mismatch checks with `workspace_agent_run_status`. The wait loop is deadline-based: each sleep is capped to remaining timeout to prevent oversleep. Concurrent waits on the same handle are allowed and independent. As with `workspace_agent_run_status`, a free/local terminal success carrying `structured_role_result.valid:false` is expected `decision` prose-only behavior, not a terminal run failure. **Not read-only for a managed exact-slice worker run**: exactly as with `workspace_agent_run_status`, polling may prepare and freeze the slice-review surface, but it parks until the separate coordinator integration continuation completes. Side effects: `workspace_write`, `record_write`. See [Managed-run terminal semantics](#managed-run-terminal-semantics).
- `workspace_wk_forge_handoff` is the orchestrator/operator-only exact terminal-candidate publication route. Its request carries only `assigned_unit` plus an optional workspace alias; the request is not authorization. The launcher-owned host executor derives exact `C/L/W`, candidate materialization, candidate-bound record digest, repository, remote, base, branch, pull-request identity, and credentials. Reviewer/redteam results remain exact-candidate-bound advisory evidence: clean output cannot authorize, findings cannot veto, and missing or mixed results decide nothing. CCE alone decides any configured organization-policy gate; configured missing, unavailable, malformed, unratified, denied, or target-mismatched evidence fails closed. Paid tier alone configures no gate. No configured gate follows decision free-substrate behavior and reports a non-audit posture. On restart, loss of monitor state or a prior binding is harmless: the server reads only the fixed current-candidate ref. A present target is mechanically recovered from immutable C; an absent ref triggers deterministic construction from current `L/W/B` and the contract stored in W, then absent-ref expected-old CAS and exact validation. Legacy candidate refs remain unread. Later landing-ref movement does not invalidate review or block publication of unchanged C; the configured merge actor and CCE policy own merge readiness. The exact candidate is published by absent-ref CAS; exact branches and pull requests recover without duplication. Missing, ambiguous, moved, or inconsistent required Git/object/record/remote facts other than normal current-ref absence refuse. No Git, policy, reviewer, or forge authority is accepted from caller input, and credentials or raw process output never enter results. Denied to worker/reviewer/redteam.
- `workspace_work_record_summary` returns a compact `work-record-summary.v1` envelope for a `WK-####` record or `WK-####[#slice]` unit in a configured repo alias. Read-only; returns dependencies (`depends_on`, `blocks`, `related`), `write_scope`, `acceptance` (criteria + validation), `slices` (id/status/owner/write_scope/acceptance/dispatch_intent per slice), `validation`, `owners`, `review_state` (required, status, blocked), and `blockers` (open/accepted escalations and `depends_on` references). Inputs: optional `repo` alias plus one of `id`, `unit`, or `path`. Large unscoped expensive summaries pass through the compact-first read gate (see [Compact-first work-record reads](#compact-first-work-record-reads)). CLI fallback: `npm run wiki -- work-records summary --unit <WK-ID|WK-ID#slice> --json`

Findings-only reviewer status/wait responses may include bounded
`validation_evidence` bound to reviewer run id, subject, exact reviewed SHA, and
diff-base SHA. Passing and failing entries are advisory and carry
`integration_effect: "none"`.

`workspace_agent_run_status` and `workspace_agent_run_wait` monitor an accepted
dispatch by its non-empty server-minted `monitor_handle`; an optional subject
must match. A committed implementation slice already in canonical `review` does
not recover its worker run. Dispatch its findings-only reviewer directly with
`workspace_agent_dispatch(role="reviewer", subject="work record")`.
Launcher-owned admission freezes the exact committed slice target and grants the
reviewer empty mutation authority. Worker run identity authenticated delivery;
canonical committed-target state authenticates reviewer admission. Any number of
reviews may be dispatched; their independently retained results form a plural
exact-target evidence set. Findings and clean output are both advisory evidence.
Neither independently vetoes nor admits integration; the coordinator or configured
CCE owns that policy decision.

Receipt-backed exact-slice monitor recovery serializes readers with publishers.
Final and non-final already-integrated recovery independently validates the frozen
contract, exact permitted canonical lifecycle transition, integration marker,
retained refs, WK target, and object-store commits; it does not require the current
record to retain the pre-integration active/review shape. Enforced-CCE evaluation loads all applicable persisted receipts against the frozen
contract, runs, identity, and SHAs; it never uses only the latest receipt, and old
compatibility fields carry no authority. `policy_only` fabricates no audit acceptance,
and no public request carries review authority. Claude exact-slice review exposes its credential
read-only and no writable host mount, and sandbox-construction failure refuses
without an unenforced fallback. Sidecar enforcement
consumes the tier frozen at launcher plan registration rather than mutable
planning-environment API-key state.

## Managed-run terminal semantics

`workspace_agent_run_status` and `workspace_agent_run_wait` project one shared
managed-run terminality contract; the two routes cannot disagree.

Neither route is read-only for a managed exact-slice worker run. Polling a
terminal managed worker advances its launcher-owned post-worker lifecycle, and
that lifecycle may prepare review state, integrate the accepted slice, update
Git refs, and update canonical slice/work-record status. Treat both routes as
state-advancing calls, not as pure reads.

A terminal child therefore does **not** imply `terminal:true`. Three facts are
reported separately and must not be conflated:

- `terminal` — the **complete managed run** is finalized. For a managed
  exact-slice worker this means the child terminated *and* its post-worker
  lifecycle reached the `finalized` phase.
- `child_terminal` — only that the dispatched **child process** reached a
  terminal state. It never makes an unresolved pre-integration or
  awaiting-review run appear final.
- When no managed post-worker lifecycle applies (a reviewer, a redteam session,
  a non-slice subject), `terminal` equals `child_terminal` and no
  `lifecycle_resolution` is returned.

For a child-succeeded but lifecycle-unresolved run the public meaning is fixed:

| Field | Meaning |
| --- | --- |
| `status` | the **child's** lifecycle vocabulary, unchanged (`succeeded` here means the child succeeded) |
| `child_terminal` | `true` |
| `terminal` | `false` |
| `timed_out` (`run_wait`) | `false` — the wait returned because the *child* became terminal, not because the managed run finished |
| `exit`, `final_result`/`final_result_summary`, `review_result` | **child** completion evidence; none of it contradicts `terminal:false` |
| `updated_at` | backend-reported update time for the **child** run; lifecycle progress does not advance it |
| `next_action` | the lifecycle's own action when the run is blocked on something **you** must do (`complete_slice_review_then_retry_run_status`), otherwise `retry_wait_or_check_status` — poll again on the same `monitor_handle`; never relaunch |

Unresolved runs also carry a `lifecycle_resolution` projection
(`workspace-agent-run-lifecycle-resolution.v1`) with `resolved:false`, the exact
lifecycle `phase`, `integration_complete:false`, the latest retained typed
failure, the bounded retained-failure list, bounded/saturating attempt metadata,
and an actionable lifecycle `next_action`
(`complete_slice_review_then_retry_run_status`,
`resolve_lifecycle_failure_then_retry_run_status`,
`retry_run_status_after_exact_slice_commit`, or `retry_wait_or_check_status`).
A transient lifecycle failure is retained on the run's checkpoint, so it does
not disappear from the projection on a later poll that happens to succeed into
another unresolved phase. Retained-failure storage is a fixed-size ring
(currently five entries): beyond the bound the oldest entries are evicted, the
latest failure is always kept, and the projected attempt count saturates rather
than growing, so polling cannot build an unbounded in-memory history.

Once the lifecycle is finalized both routes replay a byte-stable terminal
projection: `lifecycle_resolution` becomes the constant
`{resolved:true, phase:"finalized"}` with no per-attempt state, and
`slice_lifecycle` replays the same memoized finalized result. **A finalized
projection is the only stable terminal result**: every other projection is
provisional and may change on the next call.

### What `workspace_agent_run_wait` waits for

`timeout_ms` bounds the **whole call**. The route waits for the child, and then
keeps waiting — on the same deadline and the same `poll_interval_ms` — for the
managed lifecycle to finalize. It does not return the moment the child exits, so
the ordinary `while (!terminal) run_wait(...)` pattern cannot become an
immediate-retry spin. Three outcomes:

| Outcome | Response |
| --- | --- |
| Managed run finalized | `terminal:true`, `timed_out:false` |
| Lifecycle blocked on a caller action | returns **promptly** with `terminal:false`, `timed_out:false`, `child_terminal:true`, and `next_action` set to that exact lifecycle action (`complete_slice_review_then_retry_run_status`). Further waiting could never clear it — a parked exact-slice review advances only when a separate findings-only reviewer returns a verdict — so the window is not consumed and the action is never flattened to the generic retry string |
| Window expired | `timed_out:true` on the same `monitor_handle`, with `child_terminal` reporting which wait ran out (`false` — the child was still running; `true` — the child finished and its lifecycle did not resolve in time) and a `lifecycle_resolution` when one applies |

A lifecycle that can still advance on its own — a failed invocation that may
clear on retry, a run not yet integrated — is polled within the window exactly
as a still-running child is, so retries are spaced by `poll_interval_ms` and
bounded by `timeout_ms` rather than issued immediately. `timed_out:true` is
never a failed child or a failed run: call either route again with the same
`monitor_handle` and do not relaunch.

## Compact-first work-record reads

`workspace_work_record_summary`, `workspace_get_record`, and
`workspace_read_page` share one compact-first read gate. A large unscoped work
record returns a compact projection by default; the expensive options
(`verbose`, `include_full_summary`, `include_record`, `include_body`,
`include_raw`) are gated on that large-record surface so a single call cannot
dump the whole record.

The gate exposes two independent routes off that surface:

- **`accept_full_read: true`** is the explicit full-read route. It must be
  literal `true`, and it is the one and only way to authorize a large unscoped
  full read. Its behavior is unchanged by any acknowledgment.
- **`compact_read_token`** is a plain compatibility acknowledgment that records
  that the caller already saw the compact-first result for this exact unit. It is
  a single bounded base64url JSON segment carrying exactly `schema_version`
  (`work-record-compact-read-ack.v1`), `tool_family`, `workspace_repo`,
  `record_id`, `selector`, `source_digest`, `issued_at_ms`, and `expires_at_ms`,
  with a fixed 900000 ms (`expires_at_ms - issued_at_ms`) lifetime.

The acknowledgment is **stale-read and explicit-user-intent bookkeeping only**.
It is **not** authentication, authorization, an authenticity proof, or evidence
of server issuance — it carries no signature, MAC, or secret, and any caller can
mint one. The gate refuses a malformed, wrong-schema, cross-tool,
cross-workspace, cross-record, wrong-selector, stale-`source_digest`,
future-issued, expired, or overlong acknowledgment with the corresponding
`compact_read_token_*` reason code, but a **valid** acknowledgment still never
widens an unselected large read into a full read: all three handlers return
`compact_read_selected_detail_required`, make zero expensive-reader calls, and
disclose no full, sibling, raw, or sidecar content. To read detail, scope to a
specific `selected_slice`/`selected_record`, or use `accept_full_read: true`.

## Atomic ready-slice contract

`workspace_work_record_ready_slice` accepts one strict whole object. `repo` is
the optional workspace-alias transport selector; it is not part of the
persisted contract. Unknown properties are rejected at every depth before the
handler runs.

### Selector and control fields

| Field | Exact type | Create | Update and semantics |
| --- | --- | --- | --- |
| `unit` | `^WK-[0-9]{4}$` | Required parent address. | Required parent address. Slice addresses refuse; the server owns selected-slice allocation/lookup. |
| `slice_id` | `^SLICE-[0-9]{3}$` or omitted | Must be omitted; the next unused ordinal is allocated. | Required and must select exactly one existing slice. Caller-selected new or semantic ids refuse. |
| `expected_source_digest` | optional `^sha256:[0-9a-f]{64}$` | Optional authored-source stale-read guard. | Same. Omission still uses the operation-loaded authored digest for load-to-write CAS. |
| `shaping_mode` | `implementation`, `reviewer`, or `redteam` | Defaults to `implementation`. | Omission preserves an already-consistent implementation/review/redteam work-kind/role tuple. Any other effective kind requires explicit shaping. |
| `review_purpose` | `standalone` or `terminal_whole_wk` | Defaults to `standalone` for reviewer shaping. | Valid only for reviewer-shaped findings-only slices; structural and non-authorizing. |
| `attestation_action` | `preserve_or_refuse` or `invalidate_for_review` | Defaults to `preserve_or_refuse`; invalidation refuses. | Defaults to `preserve_or_refuse`. Invalidation is valid only for a behavior-changing implementation edit with exactly one active selected-unit/current-digest compact carry. |
| `verbose` | optional boolean | Defaults to `false`. | Defaults to `false`; it grants no write authority and does not widen the closed success projection. |

Shaping is authoritative. `implementation` fixes
`work_kind:implementation`, role `worker`, `target_unit:slice`, and requires
non-empty effective `write_scope` and `expected_edit_targets`. `reviewer` fixes
`work_kind:review`, role `reviewer`, `target_unit:slice`, and `write_scope:[]`.
`redteam` does the same with `work_kind:redteam` and role `redteam`. Findings-only
targets, when present, are an inspection-only plan. Contradictory caller-supplied
work kind, role, target unit, write scope, target operations, or attestation
action refuses.

### Slice payload fields

The payload is a strict partial replacement object: every omitted field on
update preserves its exact persisted value, including authored empty arrays
and unrelated `sections` siblings; every supplied field replaces that whole
field after normalization. There is no nested merge or patch.

| Field | Exact type | Create | Update |
| --- | --- | --- | --- |
| `title` | trimmed non-empty string | Required. | Preserve when omitted. |
| `status` | `inbox`, `todo`, `active`, `review`, `done`, `blocked`, `parked`, or `cancelled` | Defaults to `todo`. | Preserve when omitted. |
| `work_kind` | `implementation`, `review`, or `redteam` | Derived from shaping. | Preserved when shaping is omitted; otherwise derived. A supplied value must match shaping. |
| `priority` | `low`, `medium`, `high`, or `critical` | Defaults to `medium`. | Preserve when omitted. |
| `owner` | trimmed non-empty string | Defaults to `unassigned`. | Preserve when omitted. |
| `depends_on` | array of non-empty unit-reference strings | Defaults to `[]`. | Preserve when omitted; supplied `[]` replaces the field. |
| `read_scope` | non-empty array of non-empty repository/wiki reference strings | Required and non-empty; `docs` is not accepted. | Preserve when omitted; supplied `[]` refuses structural completion. |
| `repo_paths` | non-empty array of repository-relative POSIX paths | Required and non-empty. | Preserve when omitted; supplied `[]` refuses structural completion. |
| `write_scope` | array of repository-relative POSIX paths | Required and non-empty for implementation; defaults to `[]` for findings-only. | Preserve for unshaped implementation updates; findings-only shaping produces `[]`; implementation cannot be empty. |
| `dispatch_intent` | strict complete `{intended_agent_role,target_unit,requires_graph_impact,requires_escalation}` | Role/target derive from shaping; both booleans default `false`. | Omission preserves booleans and, absent shaping, the consistent tuple. A supplied object is complete; `target_unit` is `slice`, role is `worker`, `reviewer`, or `redteam` according to shaping. |
| `acceptance` | strict complete `{criteria,validation}` | Required with both arrays non-empty. | Preserve when omitted; supplied object replaces both arrays. |
| `expected_edit_targets` | array of strict complete target objects | Required and non-empty for implementation; defaults to `[]` for findings-only. | Preserve when omitted; supplied `[]` is authoritative when compatible with shaping. |
| `expected_changed_line_budget` | non-negative integer or `null` | Defaults to `null`. | Preserve when omitted; `null` clears it. |
| `agent_notes` | string or array of strings | Omitted by default. | Preserve when omitted; `""` and `[]` are authored replacements. Arrays join with LF and the resulting UTF-8 value is limited to 8192 bytes. Only `sections.agent_notes` changes. |

Repository paths are trimmed and stored as canonical relative POSIX paths after
removing one leading `./`. Absolute paths, drive paths, `~`, backslashes, NUL,
empty segments, and `.` or `..` segments refuse.

An acceptance criterion is either a trimmed non-empty string or the strict
object `{text,verification_method?,evidence_target?,facet_provenance?}`. `text`
is required/non-null/non-empty. `verification_method` is omitted, `null`, or one
of `inspection`, `analysis`, `demonstration`, `test_execution`, `audit`,
`proof`. `evidence_target` is omitted, `null`, or an authored string.
Acceptance provenance is a strict partial object over `text`,
`verification_method`, and `evidence_target`.

Each expected target is the strict object
`{path,name,kind,operation,activity_kind?,artifact_kind?,granularity?,optional?,facet_provenance?}`.
`path` and `name` are required/non-null/non-empty. `kind` is `function`,
`method`, `class`, `module`, `export`, `test_case`, `schema_field`,
`docs_section`, `config_key`, or `other`; `operation` is `create`, `modify`,
`delete`, or `inspect`. `activity_kind` is omitted/`null` or
`requirements_analysis`, `design_contract`, `implementation_new`,
`implementation_modify`, `implementation_remove`,
`verification_test_authoring`, `verification_test_modification`,
`validation_runtime_check`, `documentation`, `migration_contract`,
`coordination_record`, or `configuration`. `artifact_kind` is omitted/`null` or
`production_code_module`, `production_code_export`, `unit_test`,
`integration_test`, `operational_test`, `property_test`, `regression_test`,
`fixture_corpus`, `cli_entrypoint`, `launcher_wrapper`, `mcp_tool_surface`,
`schema_contract`, `policy_rule`, `protocol_doc`, `reference_doc`,
`wiki_record_canonical`, `wiki_projection_generated`, or `build_or_config`.
`granularity` is omitted/`null` or `file`, `module`, `function`, `method`,
`class`, `export`, `test_case`, `schema_field`, `docs_section`, `config_key`, or
`record`. `optional`, when present, is boolean and never defaults. Target
provenance is strict partial over `path`, `name`, `kind`, `operation`,
`activity_kind`, `artifact_kind`, `granularity`, and `optional`.

Every provenance value is `null` or one of `authored_record`,
`derived_normalizer`, `derived_code_graph`, `derived_diff`,
`derived_policy_pack`, `unavailable`, `not_applicable`; omission stays absent.
Unknown provenance keys refuse. Every allowed target provenance facet,
including `kind`, participates in the selected-unit reviewed digest.

### Atomicity, attestations, and digests

The core constructs and validates one complete prospective record and performs
at most one canonical write. Under the existing single store lock it compares
the authored source digest first, then the server-private full-persistence-
snapshot digest (which includes `derived_evidence` and projections), before one
canonical replacement. Authored drift returns `stale_source_digest`;
source-stable derived/projection drift returns
`stale_persistence_snapshot_digest`. A no-op performs no transaction. The
private snapshot digest is never accepted from or returned to the caller.

Attestation checks bind only the selected unit and its current reviewed-unit
digest. An unchanged digest preserves the compact carry byte-for-byte. A
behavior-changing implementation edit with an active current carry refuses
unless `invalidate_for_review` is explicitly valid; valid invalidation removes
exactly that one canonical compact reference, preserves sibling/historical
entries, and never fabricates review completion. Ready-slice publishes,
rewrites, deletes, restores, or cleans no admission sidecar and supplies no
sidecar mutation to the store transaction.

The returned `source_digest` is the persisted authored whole-record identity.
`reviewed_unit_digest` is the persisted selected-unit review identity. They are
different roles; neither is the private full-snapshot CAS identity.

### Closed structural-readiness response

After a successful write or no-op, the route reloads the persisted record and
uses only it, the selected unit, and the core result to return
`ready-slice-structural-readiness.v1`:

`{schema_version,selected_unit:{kind,address,record_id,slice_id},contract_persisted,written,no_op,source_digest,reviewed_unit_digest,structurally_complete,checks,blockers}`.
`contract_persisted` is `true`; `no_op` is the inverse of `written`. Normal
`checks` contains exactly these nine ordered checks and paths:

1. `title_nonempty` / `title`
2. `read_scope_nonempty` / `read_scope`
3. `repo_paths_nonempty` / `repo_paths`
4. `acceptance_criteria_nonempty` / `acceptance.criteria`
5. `acceptance_validation_nonempty` / `acceptance.validation`
6. `shaping_tuple_consistent` / `dispatch_intent`
7. `implementation_write_scope_nonempty` / `write_scope`
8. `implementation_expected_edit_targets_nonempty` / `expected_edit_targets`
9. `findings_only_write_scope_empty` / `write_scope`

Statuses are the closed set `ready`, `missing`, `empty`, `mismatch`,
`not_applicable`, `error`. The last three checks apply respectively to
implementation, implementation, and review/redteam; the other shaping gets
`not_applicable`. Every applicable non-ready check produces exactly one ordered
`{code:"work_record_readiness_failure",check,status,path}` blocker.
`structurally_complete` is true only when every applicable check is ready.
This is structural reporting only: it calls no dispatch/dependency evaluator,
graph operation, admission/target-resolution materializer, Node Engine/local
admissibility evaluator, attestation completion/carry persistence, lifecycle
policy, launch, provisioning, or backend selector.

A pre-write core refusal is returned as that typed refusal with
`contract_persisted:false`, `written:false`, and `no_op:false`; no readiness
projection is fabricated. If reload or pure projection fails after a successful
write/no-op, persistence is not rolled back and no second mutation occurs. The
response stays `contract_persisted:true`, keeps the persisted whole-record and
reviewed-unit digests and actual written/no-op pair, and closes to one check and
blocker: `projection_internal`, status `error`, path `null`. Exception text and
reader payload are not exposed.

Ready-slice prepares the authored contract. It is intentionally separate from
the two-call launch flow's second operation, `workspace_agent_dispatch`.
work record dispatch-owned derivation supplies recoverable evidence and authoritative
Node Engine/pre-provisioning checks; ready-slice does not derive or persist that
material and makes no dispatchability claim.

## Contract-edit compact default, verbose opt-in, stale-source protection, and validate-before-write

The contract-edit MCP routes (`workspace_work_record_upsert_slice`,
`workspace_work_record_delete_slice`, `workspace_work_record_set_list_field`,
`workspace_work_record_set_acceptance`, and `workspace_work_record_shape_review_unit`)
share a common behavioral contract:

**Compact default and verbose opt-in.** Output is compact by default. A compact
response carries the operation status, the selected unit, the source digest,
whether the write succeeded, and bounded diagnostics — without dumping the full
updated record body. Compact responses preserve diagnostic order and codes, but
diagnostic count and fields may be bounded. `diagnostics_truncation` reports any
compaction, and `detail_available` identifies verbose retrieval. Pass
`verbose: true` to return the complete core diagnostics. Responses requiring no
truncation retain their existing shape. The compact default is the normal agent
path.

**Validate-before-write.** Every contract-edit operation validates the
prospective updated record against work-record.v1 before writing. An edit that
would produce an invalid record is refused with structured diagnostics and
`ok: false`; the on-disk record is never mutated unless the result passes
full schema validation. This means agents can call these routes without
building their own pre-validation step.

**Stale-source protection.** Each route accepts an optional
`expected_source_digest` parameter as caller-side stale-read protection. When
supplied, it binds the write to the caller's previously observed source digest;
the tool refuses the write if the current on-disk source record no longer
matches. When omitted, the server still passes the digest loaded during the
operation to the validated writer, preserving atomic load-to-write CAS
protection against concurrent-edit clobber. Omission does not mean writing
without a freshness check.

**Closed invalid-base `set_acceptance` repair.** An invalid base does not grant
general edit authority. Only `workspace_work_record_set_acceptance` may enter
the repair path, and only for a structurally parsed `work-record.v1` work item
whose enumerable persisted shape is already canonical. A legacy `docs` alias,
or any other shape that persistence would normalize outside the selected
acceptance path and explicitly enumerated server-managed fields, is refused.
Every error diagnostic on the base must be confined to the selected record or
slice `acceptance` subtree. Missing, duplicate, or otherwise ambiguous slice
selection, malformed JSON, unsupported schema or record kind, and unrelated
invalidity remain refusals.

For object-shaped acceptance, an omitted `criteria` or `validation` argument
preserves that existing sibling exactly. Missing or non-object acceptance may
be repaired only by supplying both arrays as an explicit whole-acceptance
replacement; a partial request is refused. Before persistence, the server
applies the canonical persistence-normalization model and guards the complete
diff: only caller-named acceptance paths and exactly enumerated server-managed
updated/provenance paths may change. The current persistence seam enumerates
only `updated` and does not mint or rewrite a provenance path. It then runs full
schema and contract-policy validation over the complete prospective record and
attempts one CAS-protected write using the source digest loaded during the
operation. A supplied `expected_source_digest` additionally binds the repair to
the caller's previously observed source digest and refuses without mutation if
stale; omitting it does not disable the operation's load-to-write CAS protection.

Repair refusals remain typed public results with `ok: false`, `valid: false`,
`written: false`, and the compact core `diagnostics` projection described above;
the MCP route does not translate them into success, absence, or fallback. Stable
repair-boundary codes include
`invalid_json`, `slice_not_found`, `acceptance_repair_ambiguous_slice`,
`acceptance_repair_non_canonical_record`,
`acceptance_repair_invalidity_outside_target`,
`acceptance_repair_requires_whole_replacement`,
`acceptance_repair_diff_guard_failed`, and `stale_source_digest`. Full
prospective validation may also return the underlying schema or contract-policy
diagnostics that must be resolved before retrying.

**Review-unit shaping.** `workspace_work_record_shape_review_unit` is a
composite contract-edit operation: it sets `work_kind` to `"review"`, forces
`write_scope` to `[]`, and points `dispatch_intent.intended_agent_role` at
`"reviewer"` in a single validated write. The resulting unit satisfies the
`reviewer_write_scope_nonempty` dispatch-readiness requirement for `workspace_agent_dispatch`
with `role: reviewer`. Agents creating review slices should use this route
rather than assembling the three field edits manually.

**CLI fallback scope.** The CLI forms (`npm run wiki -- work-records upsert-slice`,
`delete-slice`, `set-list-field`, `set-acceptance`, `shape-review-unit`) are
operator-shell fallbacks only. They are not agent dispatch transports when the
MCP surface is available. Agents must use the MCP routes above and report a
`missing_structured_transport` blocker if those routes are unavailable rather
than falling through to the CLI commands.

## Graph-impact compact default and verbose opt-in

Graph-impact MCP routes are compact by default. `workspace_code_index_graph_impact_paths`,
`workspace_code_index_graph_impact_diff`, and `workspace_record_graph_impact_evidence`
each accept an optional `verbose` boolean that defaults to `false`; omitting it or
passing `false` is the normal agent path. A compact response carries a single
bounded `graph_impact_summary` object, a `graph_impact_summary_ref`, the
`verbose: false` marker, and small status scalars (`dirty_state`, `staleness`,
and — for persistence — `record_id`, `selected_unit`, `source_digest`, `valid`,
`written`, and bounded `diagnostics`). The compact default never spreads the
summary at the top level, repeats it under a `graph_impact` alias, or includes raw
`graph_nodes`, `graph_edges`, full `canonical_refs`, `structural_impacts`, the raw
envelope, full refreshed derived evidence, or worker-admission feature vectors.

For sidecar-shaped graph-impact results (those with a `schema_version` field, as
returned by `workspace_code_index_graph_impact_paths` and
`workspace_code_index_graph_impact_diff`), the compact `graph_impact_summary_ref`
is **lightweight**: it carries a content-addressed `raw_evidence_digest`, top-level
`input_paths`, and `validated_paths`, but does not embed a full copy of
`graph_impact_summary`. Pass both the returned `graph_impact_summary` and the
lightweight `graph_impact_summary_ref` to `workspace_record_graph_impact_evidence`;
the route binds them together internally. Routine evidence recording does **not**
require `verbose:true`, raw graph nodes or edges, a full canonical ref, shell
output, temp files, or a verbose raw envelope.

`verbose: true` is an explicit debugging opt-in, not the normal agent path. It adds
the expanded `graph_impact` alias, the full input/validated/invalid path arrays,
validation hints, diff records, raw `graph_state`, the raw envelope
(`graph_impact_raw`), and — for persistence — the full refreshed derived evidence.
It does not change graph-impact dispatch-readiness policy or relax provenance/binding
checks: the bounded `graph_impact_summary` and `graph_impact_summary_ref` are
identical under both modes, and `verbose` is never a bypass for the trusted-evidence
binding required by `workspace_record_graph_impact_evidence`.

The full envelope remains machine evidence for dispatch-readiness and persistence;
worker-facing launch/readiness packets, review handoffs, and other agent-facing
summaries should expose the bounded summary/ref shape instead of raw graph nodes,
edges, or oversized path payloads.
The summary keeps canonical refs separate from derived CLI/MCP/code surface,
likely-test, docs-contract, missing-update, state, and warning-count evidence.
When graph extraction can name a specific CLI command or MCP tool, summary
surface entries include targeting metadata so agents can validate the named
handler/tool family instead of treating every command or tool in a large
surface file as equally relevant. Broad inferred docs and test reminders are
planning checks, not mandatory updates; the `must_update` bucket can remain
empty until graph evidence marks a specific item as required.
`action_items.check_this` is ranked for the current query focus, and direct
named graph-impact CLI command or MCP tool validation actions rank ahead of
broad inferred docs/test reminders when both are present. Repeated docs, test,
or protocol checks can be grouped by target path with additive `input_paths`,
`target_paths`, and `count` metadata. This compact grouping applies to both
path and diff graph-impact summaries and is an agent-planning convenience, not
a stronger call-graph precision claim.

When using `bootstrap_repo` or `sync_contract`, agents should also supply:

- `profile: "standard"` or `profile: "research"`
- `extensionNamespaces: [...]` when the repo has declared repo-local typed namespaces

When using `lint_repo` or `generate_views` before local metadata exists, agents may also supply:

- `profile: "standard"` or `profile: "research"`
- `extensionNamespaces: [...]`

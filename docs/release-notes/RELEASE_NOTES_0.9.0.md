# AgentChassis 0.9.0

AgentChassis 0.9.0 adds Vertex AI inference for Codex, Go and Rust code
indexing, criterion-level acceptance coverage and local `forge-merge` landing,
and tightens several MCP inputs.

**Release date:** 2026-10-02

| Package | Version |
| --- | --- |
| `@agent-chassis/core` | 0.9.0 |
| `@agent-chassis/agent-launch-cli` | 0.9.0 |
| `@agent-chassis/agent-launch-core` | 0.9.0 |
| `@agent-chassis/wiki-core` | 0.9.0 |
| `@agent-chassis/wiki-cli` | 0.9.0 |
| `@agent-chassis/wiki-mcp` | 0.9.0 |
| `@agent-chassis/controlled-contract` | 0.9.0 |

## Highlights

- **Vertex AI inference via a local LiteLLM gateway.** Codex can drive
  `vertex-claude-opus-5-5` and `vertex-claude-sonnet-5-5` on Vertex AI. Set
  `[models."<id>"] use_litellm = true` and `[vertexai] credentials_file` in
  `agent-launch.toml`; launch, resume and managed dispatch follow the model's
  route. First use needs host CPython 3.12 with `pip` (or an offline
  wheelhouse) and starts one shared gateway; only it reads the Google key.
  See the Vertex AI inference how-to linked from the README.
- **Local and Git landing.** `agent-launch forge-merge --checkout <path>`
  fast-forwards a base-branch checkout without pushing; hosted handoffs still
  merge their pull request. A repeated handoff refreshes the same publication,
  and refusals name who must fix them.
- **Go and Rust in the code index.** Imports resolve for Go and Rust, indexed
  with `scip-go` and `rust-analyzer` per `go.mod` or `Cargo.toml`. Status
  reports changed toolchain or dependency inputs and providers not installed.
  A failed graph-impact check no longer blocks dispatch.
- **Compact code-index answers.** Context, impact and navigation tools answer
  compactly, with `next_calls` selecting rows or source lines from the retained
  original; `verbose` is removed. Save an impact answer as evidence by passing
  its `selected_detail.source` as `graph_impact_source`.
- **Acceptance-criterion coverage.** Obligations declare the criteria they
  cover (`acceptance_criteria`) or opt out (`proof_opt_out`); readiness reports
  uncovered criteria, and new work records start with no acceptance criteria.
- **Reworked coverage query and proof validation.** The obligation-coverage
  query returns a compact default, `view: "complete"` and bounded `detail`
  pages, reads one obligation by `obligation_id`, and drops `cursor`.
  `workspace_validate_proof` returns a compact issue index.
- **Per-file scopes.** Every `read_scope`, `repo_paths` and `write_scope` entry
  must name one file, including files a worker will create; globs, directories
  and the repository root are refused.
- **User requirements and batch reads.** Work records gain an optional
  `sections.user_requirements` field, and record, page and summary reads accept
  `members` (up to 16 selections per call).
- **Self-serve managed workers.** Workers read their frozen assignment with
  `workspace_read_page { assignment: true }` and their own unit's contract.
  Prompts point to role guides by path; the direct-worker guide is removed.
- **Readable proof results.** `workspace_verify_proof` reads a settled `result`
  or `recorded_invocation` without re-running, gives each failed proof a detail
  call with error, location and trace, and reports per-attempt timing. Run
  status offers to save reviewer and redteam findings onto the work record.
- **Session roles, tool names and telemetry.** `WIKI_MCP_TOOL_PROFILE` accepts
  only `operator`, `orchestrator`, `worker`, `reviewer` or `redteam`.
  `assign_work_record_to_initiative` is now
  `workspace_assign_work_record_to_initiative` (old calls still route), results
  add a JSON text copy, and anonymous metrics add a per-call trajectory record.
- **Test-runtime setup.** The runtime configuration accepts hand-authored
  `test_entrypoints`, which saves preserve, and toolchain lookup separates a
  missing executable from an unreadable one, naming the path.

## Upgrading

Upgrade all seven `@agent-chassis` packages to 0.9.0 together, then restart
MCP servers and launcher sessions. Before resuming work:

- Replace `WIKI_MCP_TOOL_PROFILE=full` or `agent-safe` with a session role.
- Re-read records before writing: source digests are now 16-hex tokens, and
  `sha256:` digests are refused.
- Drop `verbose` from code-index, `set_status` and `set_closure` calls, and
  `cursor` from coverage-query and proof-validation calls.
- Rewrite glob or directory scope entries as explicit file lists.
- Stop referring to the removed `direct-worker` role guide.
- Vertex AI routing is opt-in; without `use_litellm` nothing is installed.

## Fixed

- Case-bound proofs no longer report false "ambiguous" or "disagreement"
  results when sibling verifications are linked.
- A malformed `repo` alias returns a typed refusal instead of throwing.
- Initiative-assignment `next_calls` now name the registered tool.
- `@agent-chassis/controlled-contract` imports outside a Git repository.
- Results that fail their output-schema check are normalized, not raw errors.

Internal module refactors; public import surfaces preserved.

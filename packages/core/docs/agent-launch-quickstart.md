
# Agent Launch & Direct-Dispatch Reference

> **This is reference material.** For first setup, start with
> [docs/quickstart.md](quickstart.md). This page is the deeper launcher and
> direct-dispatch contract.

This page is the launcher and direct-dispatch contract: role-launch configuration, the dispatch envelope, and the isolation contract. For first setup, use [docs/quickstart.md](quickstart.md).

## 1. Initialize Local Launcher Config

The operator-owned launcher registry written by `init-config`, the workspace-local
launcher state it creates, the Claude read-only argv defaults, and the
consuming-repo role-guard adoption contract are documented in
[agent-launch-local-config.md](agent-launch-local-config.md).

## 2. Use Direct WK Dispatch

### Canonical Operator Command Surface

The **authoritative and preferred** operator path for worker, reviewer, and
redteam launches is the canonical `agent-launch` subcommand. Role defaults come from `agent-launch.toml`; `--app` and `--model`
are optional explicit overrides:

```bash
agent-launch worker   --app <app> <unit>   # dispatch a worker
agent-launch review   --app <app> <unit>   # dispatch a findings-only reviewer
agent-launch redteam  --app <app> <unit>   # dispatch a findings-only redteam
```

Where `<app>` is `codex` or `claude` for supported launches and `<unit>` is a
`WK-####[#slice]` address (or `IN-####` for initiative-scoped redteam). Agy has
no supported confined launcher adapter and fails closed; do not select it for a
worker, reviewer, redteam, or orchestrator launch.

Examples:

```bash
agent-launch worker   --app claude <WK-ID#slice>
agent-launch worker   --app codex  <WK-ID#slice> --dry-run-json   # plan only
agent-launch review   --app codex  <WK-ID>
agent-launch redteam  --app codex  <IN-ID>
```

The direct live Codex worker route is retired. `agent-launch worker` for a
launch that resolves to Codex (by `--app codex`, by a Codex profile such as
`--spark`, or by its model) refuses before any client is started, with
`codex_direct_worker_retired`, and records no usage contributor. A Codex
implementation worker is started through the managed `start_agent` tool of an
orchestrator session (`agent-launch orchestrator <IN-####>`). `--dry-run-json`
still plans the launch, and live Claude workers are unaffected.

Old per-family wrapper scripts (`codex-worker`, `claude-review`, and the rest)
are no longer shipped. If you are migrating operator scripts that call them, see
the migration table in
[agent-launch-operator-entrypoints.md](agent-launch-operator-entrypoints.md),
which maps each old wrapper name to its supported `agent-launch` command. That
page is operator reference only; agents dispatch through `start_agent` in a
managed orchestrator session and report an unavailable capability if absent.

### Managed agent dispatch

Agents start work with `start_agent` and observe the exact returned attempt with
`get_run_result`. The production composition exposes neither
`workspace_agent_dispatch` nor `workspace_agent_run_status`; historical names
are not aliases. `tools/list` and the selected contracts returned by
`workspace_read_wiki` describe the actual session surface. The
[MCP operation reference](mcp-operation-reference.md) owns the exact inventory.

Managed implementation selects an explicitly authored canonical slice, for
example `start_agent({subject:"WK-0001#SLICE-001"})`. It does not select a sole
slice or manufacture one from a bare WK. Author the slice's assignment through
root `save_record`, using its fresh combined revision and the complete
`ready_slices` input contract. Select the root's `base_branch` explicitly before
first allocation; the launcher never guesses it from `HEAD` or branch inventory.
Scope entries name exact repository-relative files, including new files.
Directories and globs do not grant managed implementation scope.

The root WK must carry an explicit proof posture: required controlled acceptance
or an author-chosen whole-work exemption. When acceptance is required, the
selected slice needs its own complete current obligations; the parent's
population does not supply them. See the
host-selected guide and authoring vignette named at startup, and [launch and admission](mcp-dispatch-launch-and-admission.md).
Authored contract assessment and `start_agent` preview execute no implementation
proof and grant no launch permission. Dispatch runs its own readiness checks;
a separate validation call is not a prerequisite.

### Conduct, runtime gates and review

Repository instructions bind coordinator conduct: prepare complete assignments,
perform the required design reviews, plan discriminating evidence, and disposition
findings before the next authorized action. These instructions do not establish
new runtime gates. Local refusals rest on mechanical failure; configured CCE
policy owns action admissibility, sequencing and review requirements. A missing
execution binding differs from missing required semantic meaning, and no passing
design assessment proves delivered behavior.

Use `start_agent` with the findings role and authenticated subject or complete
`diff_base_sha`/`reviewed_sha` pair the review requires. Findings roles remain
read-only. The free reviewer has a fixed neutral contract; standalone redteam
requires an authenticated canonical unit explicitly requiring that adversarial
work. Review findings are advisory: clean output, agreement and saved disposition
neither authorize nor veto the next action.

Completion and result observation do not integrate. The coordinator explicitly
calls `integrate_work` with the authenticated delivery reference, after applying
repository policy and any configured CCE decision. Integration repeats exact
source/ref/base/currentness fences. Candidate inspection, advancement,
publication and human landing observation are separate operations; publication
neither merges nor completes work. The current contracts live in
[slice integration](mcp-dispatch-slice-integration.md) and
[terminal review](mcp-dispatch-terminal-review.md).

### Transport and confinement

Managed Codex and Claude clients use a launcher-pinned stdio connector over a
private Unix-domain socket admission service. Each admitted connection receives
one launcher-owned host wiki-MCP process, its role/tier surface and readiness
observer. Server code and dependencies stay on the host. Named FIFOs, HTTP/SSE,
caller-selected endpoints and operator-shell role commands are not this transport.
See [MCP conduit lifecycle](agent-launch-mcp-conduit-lifecycle.md).

Claude managed implementation workers see exactly frozen `R union W` repository
files and have exact `W` writable mounts. They use `Bash` for in-place edits;
rename-based native editing must not widen managed mounts to parent directories.
A required namespace or conduit that cannot be constructed refuses before spawn.
The general no-key unenforced posture supplies no plain-launch alternative for
that managed composition. Findings roles have full repository reads and no
repository writes. See [Enforcement model](enforcement-model.md).

Startup and post-compaction prompts provide package-owned role guidance.
The authoring vignette's package copy is byte-identical to its canonical doc;
session grants determine which operations are available. See
[Role guide after compaction](agent-launch-confinement-mcp-conduit.md#role-guide-after-compaction).

### Confined source access and host wiki-MCP

The launcher-owned repository namespace, shared host wiki-MCP socket conduit, and
unsupported Agy posture are documented in
[agent-launch-confinement-mcp-conduit.md](agent-launch-confinement-mcp-conduit.md)
and [agent-launch-mcp-conduit-lifecycle.md](agent-launch-mcp-conduit-lifecycle.md).

### New-directory write scopes

How the launcher resolves and pre-creates a declared `write_scope` entry that does
not yet exist on disk, the `bubblewrap` isolation that owns the real write
boundary, and the `prepared_new_write_roots` dry-run surface are documented in
[agent-launch-write-scope-preparation.md](agent-launch-write-scope-preparation.md).

### Family runtime state

The per-family launcher runtime-state facts for supported Codex and Claude, plus
the explicit unsupported Agy posture,
the four runtime-state classes, and the state-class summary table are
documented in
[agent-launch-family-runtime-state.md](agent-launch-family-runtime-state.md).

### Local test runtimes

Launcher-owned native proof attempts (`verify_proof`) consume only
the runtimes an operator installed and detection recorded in
`.agent-launch/test-runtimes/readiness.json` of the repository that owns the
worktrees. Ordinary `agent-chassis setup` detects them as its last step,
inventorying every environment the repository declares and saving the
toolchain locations it found in `agent-chassis-runtime.json`; `agent-chassis
setup --test-runtimes` reruns that step. Nothing is installed at setup,
dispatch or test time; a missing or stale record is reported as an environment failure
naming that bare command, which inventories the repository again. See
[local-test-runtime-setup.md](local-test-runtime-setup.md).

Explicit bootstrap and non-dry runtime setup install and repair root ignore
rules for `/.agent-launch/`, `/agent-chassis-runtime.json`,
`/wiki/.wiki-mcp.json`, and only the AgentChassis cache directories
`/.cache/repo-code-index/`, `/.cache/wiki-search/`,
`/.cache/controlled-contract/assessments/`,
`/.cache/controlled-contract/validators/`, and `/.cache/test-proof-native/`.
The shared updater preserves existing `.gitignore` content and reports
read/write failures. It leaves unrelated consumer caches visible and already
tracked state tracked. Package postinstall only prints setup guidance.

### Agent run provenance and inspection

The `agent-run-provenance.v1` envelope, its field model, digest and
retention rules, and the repo-local provenance inspection command are
documented in
[agent-launch-run-provenance.md](agent-launch-run-provenance.md).

### Host wiki-MCP conduit diagnostics

The per-role host wiki-MCP conduit, its typed `stdio_mcp_*` failure taxonomy, the
orchestrator `session.json` diagnostic fields, and the operator recovery route for
a consumed or failed conduit are documented in
[agent-launch-conduit-diagnostics.md](agent-launch-conduit-diagnostics.md).

### Restart recovery of a committed worker

Observe the original subject and returned attempt with `get_run_result`; do not
infer process death from a bare PID or relaunch an unresolved attempt. The
launcher authenticates durable attempt identity and Git delivery independently.
A missing durable report remains unavailable rather than being fabricated from
receipts. Historical results and reads grant no new lifecycle authority.

Use `start_agent` for the required findings review of an authenticated committed
delivery, and `integrate_work` for its later explicit integration. The owning
[managed-run lifecycle](mcp-dispatch-managed-run-lifecycle.md) describes reserved,
live, dead, partial and mismatched attempt handling and supported recovery.

### Operator Follow-Up After Review

Follow-up implementation after a worker result must go through a WK-first
structured dispatch path with canonical `write_scope` and the normal
findings-only review step. Do not use direct shell model launchers for
post-review edits.

Orchestrator guidance is generated from two canonical templates with common prose and internal whole-line selection blocks. One generation owner emits eight neutral artifact paths under `role-guides/orchestrator/01` through `/04`, selected by registered tier and controlled-acceptance opt-out publication. It fills `{{authoring_vignette_path}}` with the vignette in each generated guide's own profile. The host resolves canonical workspace configuration before rendering either family’s startup or resume instructions. A confirmed absent key and a configuration failure are distinct; failure supplies no successful guide profile. Package document reads use the selected advertised package reference and its returned text selection, never consumer `docs/` copies. Build checks validate templates and generated bytes before documentation copying and snapshot scrubbing; final manifests bind the resulting packaged bytes.

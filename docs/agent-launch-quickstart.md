
# Agent Launch & Direct-Dispatch Reference

> **This is reference material.** For first setup, start with
> [docs/quickstart.md](quickstart.md). This page is the deeper launcher and
> direct-dispatch contract.

This page is the launcher and direct-dispatch contract: role-launch configuration, the dispatch envelope, and the isolation contract. For first setup, use [docs/quickstart.md](quickstart.md).

## 1. Initialize Local Launcher Config

Write the default operator-owned launcher registry:

```bash
npm run agent-launch -- init-config
```

This creates the workspace-local launcher state under the active workspace
(the repository carrying the canonical `wiki/` + `docs/` markers):

- `<workspace>/.agent-launch/launchers.v1.json`
- `<workspace>/.agent-launch/role-guard-secret.key`
- `<workspace>/.agent-launch/role-guard-nonces/`

Launcher authority state is workspace-local (not a machine-global `~/.config`
location) so it persists across launcher/session restarts in runtimes where
the user `HOME` is ephemeral but the workspace persists. The `.agent-launch/`
directory is git-ignored. Resolution never consults `HOME`, `XDG_CONFIG_HOME`,
or `XDG_STATE_HOME`; the active workspace is the trusted launcher/MCP-supplied
workspace dir, or the repo root discovered from the process working directory.

The default profiles target:

- `claude` using the workstation-authenticated CLI plus prompt content over argv and stdout capture
- `codex exec` using prompt content over argv plus `-o <response_path>`

If an existing operator config still uses `["claude", "--bare"]`, rerun:

```bash
npm run agent-launch -- init-config --force
```

or update `base_argv` manually to `["claude"]`.

### Policy profiles and dispatch-readiness thresholds (optional)

Two optional launcher policy inputs — the Chassis Control Engine
org policy profile and the local source-available dispatch-readiness
policy-pack override — are documented in
[agent-launch-policy-profiles.md](agent-launch-policy-profiles.md).
Threshold verdicts are Chassis Control Engine-owned on the CCE path; after
decision the local/free path measures and forwards carrier facts but renders no
local admissibility threshold judgment. The source-available local policy-pack
override is retained only as inert config/evidence hygiene.

### Claude read-only argv

Redteam and code-review runs use the registry's `read_only.argv_suffix`. For
Claude, the default is:

```json
["--permission-mode", "default", "--disallowedTools", "Edit Write NotebookEdit Bash"]
```

Earlier defaults used `["--permission-mode", "plan"]`, but Claude Code's plan mode submits its final content through the `ExitPlanMode` tool call. In non-interactive `--print` + `--output-format text` mode that tool call is not streamed to stdout, so the launcher would capture an empty response and silently mark the run `completed`. The launcher now fails closed on empty response bodies regardless, but operators should still move off `plan` to get useful findings output. If your existing operator config still uses `plan`, rerun `init-config --force` or update `read_only.argv_suffix` manually.

### Consuming repo role guard adoption

The shared role guard is adopted by each consuming repository; the launcher
package supplies the evaluator, config schema, CLI contract, and launcher-owned
role metadata, while the consuming repo supplies policy and hook installation.

A consuming repo:

- add a repo-owned `.agent-role-guard.json` policy file using the schema and
  launcher contract shipped with `agent-launch`
- update its `AGENTS.md` to describe `AGENT_ROLE`, `AGENT_WK`,
  `AGENT_OPERATOR_WRITE_SCOPE`, and the repo's worker `write_scope` rules
- require implementation `WK-*` records to carry exact `write_scope`
  frontmatter before workers modify files
- wire only adapter surfaces that can present a concrete candidate action to
  the guard, such as path lists, structured diffs, or raw argv with explicit
  provenance
- document every unimplemented adapter surface as unguarded

The role-guard CLI surface exposes check commands; repo hooks and
wrappers should invoke the relevant check command at the point where they
observe the candidate action:

- `agent-launch role-guard check-write` for explicit path lists
- `agent-launch role-guard check-diff` for structured create, modify, delete,
  rename, and copy payloads
- `agent-launch role-guard check-command` for raw argv command checks

Those checks must receive the repo root, config path, candidate action payload,
and explicit provenance for role, WK, operator write scope, and trusted context.
Ambient shell variables are transport only; they do not grant authority unless
the caller supplies an accepted trust source. Generic Codex and Claude hook
coverage is not provided by the shared tool until a consuming repo installs a
supported adapter with a documented payload and provenance row.

## 2. Use Direct WK Dispatch

### Canonical Operator Command Surface

The **authoritative and preferred** operator path for worker, reviewer, and
redteam launches is the canonical `agent-launch` subcommand with an explicit
`--app` flag:

```bash
agent-launch worker   --app <app> <unit>   # dispatch a worker
agent-launch review   --app <app> <unit>   # dispatch a findings-only reviewer
agent-launch redteam  --app <app> <unit>   # dispatch a findings-only redteam
```

Where `<app>` is `codex` or `claude` for supported launches and `<unit>` is a
`WK-####[#slice]` address (or `IN-####` for initiative-scoped redteam). AGY is
roadmap/WIP in the public enforcement model; keep any AGY usage to planning or
experimental dry-run validation until a support WK promotes it.

Examples:

```bash
agent-launch worker   --app codex  <WK-ID#slice>
agent-launch worker   --app claude <WK-ID#slice>
agent-launch review   --app codex  <WK-ID>
agent-launch redteam  --app codex  <IN-ID>
agent-launch worker   --app codex  --spark <WK-ID>  # Spark profile
```

Old per-family wrapper scripts (`codex-worker`, `claude-review`, and the rest)
are no longer shipped. If you are migrating operator scripts that call them, see
the migration table in
[agent-launch-operator-entrypoints.md](agent-launch-operator-entrypoints.md),
which maps each old wrapper name to its supported `agent-launch` command. That
page is operator reference only; agents dispatch through
`workspace_agent_dispatch` and report `missing_structured_transport` if that
route is unavailable.

### Internal compatibility agent-role command

`agent-launch agent-role` is an internal compatibility/helper surface retained
for dry-run and legacy planning code. It is not the supported public operator
dispatch path. Operators should use
`agent-launch worker|review|redteam --app <family> <unit>` for direct role
smokes, and agents must use structured MCP dispatch.

```bash
agent-launch agent-role <role> <family> <unit-address>
```

Compatibility dry run:

```bash
npm run agent-launch -- agent-role worker claude <WK-ID> --dry-run-json
```

The `--dry-run-json` output exposes the compatibility request and decision plan,
including `agent.family`, `role`, `profile`, `model_hint`, `unit_address`,
`read_scope`, `write_scope`, `validation_policy`, `environment_policy`, and
`provenance_destination`.

A filesystem-MCP `agent-role` launch is gated and fails closed: it produces an
accepted plan only when launched with a verified launcher/MCP context — a
launcher-minted operator registry, verifier capability, single-use nonce, signed
backend handshake, scoped tool surface, and role-guard secret all present and
consistent. Authority is never reconstructed from ambient `process.env`,
alternate `HOME`/`XDG_CONFIG_HOME`, `--operator-config`, env files, or
request-derived JSON; any such shortcut is refused before worker-controlled state
is touched. The launcher-owned provenance, nonce/replay, and fail-closed
principles behind this gate are documented in
[enforcement-model.md](enforcement-model.md).

The supported Claude role paths are `agent-launch worker|review|redteam --app
claude <unit>`. `codex-role` and `agent-role` remain internal
compatibility/helper surfaces referenced by dry-run and legacy planning code, not
the operator dispatch contract: operators use `agent-launch ... --app <family>`
for direct role smokes, and agents use structured MCP dispatch.

### Dispatch Identity Control

`workspace_agent_dispatch` is the MCP-only agent dispatch
transport for `worker`, `reviewer`, and `redteam` calls. Stdio MCP is a
same-user local transport, not an authentication boundary. Dispatch is controlled
by the tool being exposed in the current session plus the structured
work-record dispatch-readiness checks.

The normal agent call shape is `{ role, subject }`. When typed `app` and
`model` are omitted, the launcher re-reads the selected role's model from the
workspace-root `agent-launch.toml` for that dispatch, then derives app/backend
through the neutral model registry. Typed `app` and `model` remain explicit
per-dispatch overrides only. Missing, malformed, or unknown role config refuses
with a role-specific diagnostic that names the operator-owned config to fix;
there is no family fallback and caller prompt/request/argv/environment/identity
cannot select the runtime. Editing `agent-launch.toml` affects the next dispatch
without a restart. Updating loaded launcher or MCP code still requires restarting
the owning MCP server or launcher session.

With a launch executor configured on the MCP server process, dispatch-readiness
hands off to the launcher-side run-lifecycle backend, which mints `wkdb_`-prefixed
run ids and `wkmh_`-prefixed monitor handles and reports lifecycle state through
`workspace_agent_run_status` using the controlled vocabulary `launching`,
`running`, `succeeded`, `failed`, or `cancelled`. The `backend_unavailable`
blocker is reserved for the unconfigured case (no launch executor wired into the
server process); it is not the normal posture when a launch executor is
configured.

Ambient `AGENT_ROLE`, `AGENT_WK`, and `AGENT_OPERATOR_WRITE_SCOPE` env
values, request payload role fields, prompt text role claims, argv role
claims, and a caller-asserted `claimed_identity.role` field are not role
identity sources; the dispatch surface refuses them with the stable refusal code
`agent_dispatch_identity.caller_supplied_role.v1` (and carrier-specific
variants documented in
[docs/mcp-integration.md](mcp-integration.md)).
Codex and Claude worker wrappers continue to treat their ambient env as
transport-only; they consume role identity from launcher-minted role-guard
context envelopes, not from inherited shell state.

`workspace_agent_dispatch` enforces the subject-role matrix
(`worker` / `reviewer` -> `WK-####` or `WK-####slice`; `redteam` -> `WK-####`,
`WK-####slice`, or `IN-####`) and returns a server-minted opaque
`monitor_handle` plus `run_id`. Status queries go through
`workspace_agent_run_status`; fabricated, cross-subject, replayed, or
unauthorized-caller handles refuse with the `monitor_handle_*` code
family. Reviewer dispatch enforces findings-only `write_scope: []` during MCP
dispatch-readiness and refuses non-empty scopes with `role_policy_violation`
plus diagnostic context `reason: reviewer_write_scope_nonempty`. There is no
`fixup` role on `workspace_agent_dispatch`; post-review fixes use normal
worker slices or follow-up WKs.

For `reviewer_write_scope_nonempty`, do not retry as a worker, switch roles,
refresh graph impact, broaden filesystem access, or use an operator wrapper
as a workaround. The selected subject has writable implementation scope, so it
is the wrong subject for a reviewer. The coordinator should create or select a
separate findings-only review unit with `work_kind: review`, `write_scope: []`,
`repo_paths` listing the implementation files to inspect, `depends_on` pointing
at the implementation unit, and findings-only acceptance criteria. Dispatch the
reviewer against that review unit through `workspace_agent_dispatch`.

Orchestrator launch and resume (`agent-launch orchestrator` and
`agent-launch resume`) remain human/operator-only entrypoints; agent dispatch
refuses orchestrator launch attempts from any role kind other than
`human_operator` with the refusal code
`agent_dispatch_identity.orchestrator_not_operator.v1`.

Reviewer review uses `workspace_agent_dispatch --role reviewer`. If that route
is unavailable in the current session, an implementation WK or slice covered by
the bootstrap exception records findings-only review evidence there and reports its bootstrap
state with one of `bootstrap_exception_active`, `bootstrap_review_missing`,
`bootstrap_exception_consumed`, or `graph_impact_persistence_unavailable`.
Graph-impact evidence may be queried through MCP today, but when WK evidence
persistence is required and `workspace_record_graph_impact_evidence`
is unavailable, agents must report
`graph_impact_persistence_unavailable` rather than fall back to shell/CLI
persistence.

#### Runtime blocker taxonomy and coordinator preflight

A schema-backed runtime blocker taxonomy is published at
`packages/wiki-core/data/runtime-blocker-codes.v1.json`, exposed through
`workspace_runtime_blocker_taxonomy`. The taxonomy is the canonical code set
for dispatch readiness, launcher diagnostics, and preflight blockers. The
bootstrap-state codes (`bootstrap_exception_active`,
`bootstrap_review_missing`, `bootstrap_exception_consumed`,
`graph_impact_persistence_unavailable`) are a strict subset of the
taxonomy; dispatch readiness must select codes from this taxonomy
rather than inventing dispatch-specific ad hoc strings.

The taxonomy distinguishes role policy from runtime filesystem/transport
failures. A fully read-only repository mount surfaces as `read_only_mount`
in the `filesystem` category, never as `role_policy_violation`. Even when
orchestrator role policy already restricts writes to docs/ and wiki/, a
failed write to one of those permitted surfaces is still a filesystem fact
and is reported with the filesystem code so the operator can investigate the
mount or sandbox profile rather than rewriting WK acceptance to absorb the
runtime failure. Graph-impact degraded outcomes are deterministic and
documented in the taxonomy's `graph_impact_state_map`: unavailable/errors
map to the blocking `graph_impact_unavailable`; stale or rebuild-required
without a usable dirty overlay map to the blocking
`graph_impact_rebuild_required` (operator refresh — no rebuild in a dirty
worktree); and a dirty worktree with a usable overlay maps to the
non-blocking `graph_impact_degraded_overlay` so the overlay evidence is
recorded alongside canonical authority.

`workspace_coordination_preflight` composes the preflight envelope a
coordinator should consult before dispatching. It reports the role,
caller/session role, subject, allowed durable write surfaces (`docs/`,
`wiki/`, and the wiki subsurfaces), implementation/test edit prohibition,
repo mount writability, docs/ and wiki/ writability, available structured
dispatch and review routes, and any active runtime blocker codes from the
taxonomy. Caller-supplied identity carriers (request payload,
prompt text, ambient env, argv, and `claimed_identity.role`) are refused
with the refusal code at the MCP boundary. Coordinators that
discover a blocking preflight entry must stop and report the stable code
rather than implement inline, fall back to shell, or rewrite the WK to
absorb the runtime failure.

The same envelope publishes `capabilities`, with nine independently sourced
planes: `structured_dispatch`, `native_edit`, `repository_read_boundary`,
`commit`, `managed_worktree_provisioning`, `slice_to_wk_integration`,
`wk_context_review`, `validation_ownership`, and
`automatic_main_promotion`. Each plane reports availability, its server-owned
source, freshness, blockers, and a structured recovery route. A missing,
unknown, or stale fact is unavailable; a plane never inherits availability
from another plane.

In the current release, structured dispatch, native edit, coordinator-owned
validation, and the Phase 1 local single-repository lifecycle are available
when their production composition is installed. That installed composition
provides the repository read boundary, managed worktree provisioning,
closed-input commit, slice-to-WK integration, and frozen whole-WK context
review. Automatic main promotion remains unavailable. Managed lifecycle
refusals use `managed_lifecycle_required`; provisioning refusals use
`managed_worktree_provisioning_unavailable`. Recovery rechecks the server-owned
facts through `workspace_coordination_preflight`. Free/local and paid/CCE
responses keep the same plane meanings and differ only in their enforcement
metadata.

The current Phase 1 flow is: commit the slice, freeze and review its exact SHA,
automatically integrate it into the WK, run a findings-only review of the frozen
whole-WK context, then return the result to
the orchestrator for disposition. Findings do not trigger an automatic Git
mutation or promotion to main.

On enforced CCE (`paid_cce`), exact Proof A is required before integration. On
free/local, review remains mandatory policy and may be run/reported, but missing
review evidence does not park lifecycle progress and no Proof A is minted. The
tier is frozen into the launcher-owned sidecar descriptor at plan registration;
later changes to the broker planning environment or API-key presence cannot
upgrade or downgrade that run's enforcement mode.

Launcher runtime persists exact-review state as immutable, synchronously durable
receipt events under a cross-process lock; exact replay is idempotent and selector
conflicts refuse rather than overwrite state. Readers take the same lock as
publishers, a live or stalled owner is never displaced, and first creation syncs
the receipt directory and its parent. After backend/MCP restart, recovery
re-resolves the frozen contract, retained identity, refs, marker, and objects
before minting or resolving the existing Proof A. Final and non-final
already-integrated results are recovered independently from the obsolete
pre-integration `active + slice review` shape. On `enforced_cce`, both backend and
broker independently re-read persisted historical Proof A, validate it against the
receipt-frozen contract, structured result, runs, SHAs, and exact identity, and fail
closed before recovered success when that proof is missing or mismatched. The
broker passes reconstructed acceptance to the existing Proof A gate before initial
integration; no proof field crosses its closed request. `policy_only` neither
requires nor fabricates Proof A or audit acceptance.

There is no operator `integrate-slice` command, raw-Git recovery, manual proof
injection, or caller-carried review authority. Exact-slice reviewers are admitted
only from backend-owned frozen context and remain read-only in both Codex and Claude
execution. For Claude exact-slice review, the credential leaf is a read-only bind
and the final bwrap plan has no writable host root or file. Sandbox construction is
mandatory for both direct and broker Claude composition: failure refuses before
spawn, and an exact reviewer can never use the ordinary unenforced plain-launch
fallback. There is no manual proof injection. `review_purpose` is
structural and non-authorizing. Exact-bound
`changes_requested` findings are rendered into the next same-slice Codex or Claude
worker prompt as non-authorizing corrective context; they do not relaunch work,
grant acceptance, or change read/write scope.

### Agent Dispatch Boundary

`workspace_agent_dispatch` and `workspace_agent_run_status` are
the only agent dispatch and monitor transports. Package-owned role wrappers
are not agent dispatch transports. Agents must not invoke them to start
WK-first implementation, review, or redteam work. If `workspace_agent_dispatch`
is missing or reports unavailable transport, the correct result is the
`missing_structured_transport` blocker, not CLI fallback.

Operator shells may still use wrapper commands for local debugging only when a
separate operator instruction explicitly asks for that action. Such use does
not establish agent-facing dispatch posture and must not be recorded as proof
that structured agent dispatch works.

#### Stdio Dispatch Boundary

Configured stdio MCP dispatch is a same-user local
tool call. A dispatch attempt should reach the structured dispatch-readiness
checks without a launcher registration prelude. Dispatch-readiness wires
to the launcher-owned launch backend so that a dispatchable subject reaches
the backend's `startLaunch(...)` rather than fail-closing at the readiness
tail. If a future deployment needs authenticated cross-session or multi-user
dispatch, it must use a different transport or launcher-owned broker
design; do not recreate authentication with a first-line stdio prelude,
shell helper, inline env policy, Codex `CODEX_HOME` config rewrite, an
auth prelude, a registration frame, or a per-connection identity registry.

This does not authorize non-MCP dispatch. Agents still use
`workspace_agent_dispatch`; they must not switch to non-MCP operator-shell
wrapper commands, broaden bwrap mounts, supply inline `VAR=value`
environment, repoint `HOME` or `XDG_*` roots, open a temp worktree, or use
graph-impact persistence as a launch side channel.

### Host write-authority localhost sidecar endpoint contract

The launcher-owned host-write-authority dispatch sidecar transport
contract — endpoint ownership, the loopback-only and
kernel-assigned-port invariants, dead-sidecar recovery, the structured
`backend_unavailable` blocker, and the redaction surface — is documented in
[agent-launch-host-write-authority-sidecar.md](agent-launch-host-write-authority-sidecar.md).

### Claude role paths

The supported Claude role paths are:

- `agent-launch worker --app claude <unit>`
- `agent-launch review --app claude <unit>`
- `agent-launch redteam --app claude <unit-or-IN>`

Reviewer and redteam launches are findings-only by role contract. Any internal
compatibility path that still constructs an `agent-role` request fails closed
unless invoked with a verified launcher/MCP context, and never derives backend
identity, scope, handshake, or launch authority from the ambient shell
environment, alternate `HOME`/`XDG_CONFIG_HOME`, `--operator-config`, or
env-carried payloads.

### Compatibility read-only role dispatch addresses

Compatibility `codex-role` and `agent-role` read-only planning helpers accept
the same v1 unit address grammar as canonical worker dispatch, but they are not
the public operator dispatch contract. Use
`agent-launch review|redteam --app <family> <unit>` for supported operator
smokes and `workspace_agent_dispatch` for agent dispatch.

- a whole work item: `WK-####`
- a tracker-local slice: a `WK-####` address with a `#slice` suffix
- redteam may also target an initiative: `IN-####`

When the address resolves to a WK record (with or without a slice), the
read-only role consults the canonical dispatch-readiness pipeline before
launching. This read-only readiness check is not the same as implementation
worker dispatchability: review and redteam targets may be non-implementation
units, and the launcher must not refuse them solely because a worker would have
returned `not_implementation`.

Read-only readiness still fails closed for canonical record problems such as
missing JSON, missing slice, invalid record shape, unresolved or blocked
dependency evidence under the active profile, required missing graph-impact
evidence, or required missing/stale preparation-audit evidence. A
`blocked_dependency` readiness — for example a slice that depends on another
slice whose status is `blocked` or whose address cannot be resolved against
canonical WK JSON — refuses the launch with shared dependency evidence drawn
from `dispatch_readiness_dependencies` and the
`dispatch_readiness_preparation_audit` envelope.

If a read-only WK/slice target requires graph-impact evidence, wrappers may
transport a runtime graph envelope through the same file-backed bridge used by
worker planning, but that file path is not authority. Launch proceeds only after
the shared dispatch evaluator accepts the parsed graph evidence for the
selected read-only unit. Redteam targets that name an initiative (`IN-####`)
have no canonical JSON record to consult and remain on the legacy non-gated
path.

The canonical field model for work records lives in the `work-record.v1` JSON
schema and the `workRecordAuthority` stanza of
`packages/wiki-core/contract/manifest.json`; the public wiki contract summary is
in `packages/wiki-core/contract/schema.md`.
This quickstart only documents the operator-facing dispatch address form.

### Filesystem-MCP worker backends and source substrate

The filesystem-MCP worker backend request/decision/handshake contract,
the launcher-owned Codex worker source substrate
(host-write-authority / outer bwrap), and the AGY roadmap/WIP
filesystem-MCP environment policy are documented in
[agent-launch-filesystem-mcp-backends.md](agent-launch-filesystem-mcp-backends.md).

### New-directory write scopes

A WK may legitimately declare a `write_scope` entry that does not yet exist on
disk, for example a brand-new tool subtree such as
`tools/in0012-swebench-smoke` or a versioned subtree such as
`tools/example.v1`. The codex worker launcher resolves the declared scope to
its target directory (the entry itself for directory-shaped scopes, the parent
directory for file-shaped scopes) and pre-creates only the exact authorized
missing subtree before the Codex sandbox starts.

On Codex CLI 0.131, the active launch mechanism is `-s workspace-write` plus
explicit `--add-dir <absolute-directory>` entries for each declared writable
root. The older `permissions.worker_scope.filesystem` / `:project_roots`
config is not the active enforcement path because Codex 0.131 no longer
recognizes that per-entry read/write table. This restores worker writability,
but it degrades enforcement granularity: `workspace-write` makes the whole
`-C <repo>` workspace writable, while `--add-dir` records the declared writable
directory intent and can extend the writable set with additional directories.
The launcher therefore cannot enforce file-level write_scope through
the Codex CLI alone.

Launcher-owned `bubblewrap` isolation replaces that degraded boundary. Local
role launches require a usable `bwrap` binary; missing or unusable `bwrap` is a
launch refusal, not a reason to fall back to repo-wide `workspace-write`.

Human/operator orchestrator entrypoints are the exception authorized by
decision. When `bubblewrap` is unavailable or unsupported, an operator shell
orchestrator launch may use an explicit direct mode only if the launcher emits a
loud warning and dry-run JSON records that OS-level bwrap isolation is
unavailable. Direct mode is not sandboxed write-scope enforcement: normal host
OS permissions apply. Structured worker, reviewer, and redteam dispatch remains
fail-closed unless a later decision explicitly changes that posture.

Bubblewrap-isolated orchestrators receive one additional read-only repository-data
mount: the launcher derives the owning repository's managed-worktree root as
`<dirname(real repository)>/.agent-worktrees/<basename(real repository)>` and
binds exactly that directory. The mount does not expose sibling repositories'
managed worktrees and does not grant mutation authority. It exists only so
orchestrators can inspect their own managed worktrees and obtain truthful Git
diagnostics; host/broker evidence remains authoritative for lifecycle and
exact-SHA integration decisions. An already-running orchestrator must be
restarted to receive this mount. Operator direct mode has no bwrap namespace and
therefore receives no additional bind.

For a user-local Ubuntu amd64 install without changing system packages, the
operator bootstrap recipe is:

```bash
cd /tmp
curl -LO http://security.ubuntu.com/ubuntu/pool/main/b/bubblewrap/bubblewrap_0.9.0-1ubuntu0.1_amd64.deb
dpkg-deb -x bubblewrap_0.9.0-1ubuntu0.1_amd64.deb extracted/
mkdir -p ~/.local/bin
cp extracted/usr/bin/bwrap ~/.local/bin/
export PATH="$HOME/.local/bin:$PATH"
bwrap --version
```

This recipe only installs the `bwrap` executable into the operator's
`~/.local/bin`. The launcher implementation remains responsible for checking
availability, refusing when the isolation backend cannot be used, and enforcing
the role-specific writable roots.

Codex launches under this isolation still need configured MCP servers to be
reachable. The launcher reads Codex `config.toml` from the active `CODEX_HOME`
or `$HOME/.codex`, discovers configured `mcp_servers`, and exposes only the
required MCP command/package roots and `WIKI_MCP_REPOS` repository roots as
read-only binds. Malformed MCP repo config or configured repo paths that cannot
be resolved fail closed. The MCP preservation path must not bind broad writable
`$HOME`, broad writable `.config`, broad writable `.local`, or repo-wide write
access as a shortcut.

Classification of nonexistent `write_scope` entries does not rely on a single
heuristic. When the entry exists on disk, the launcher uses the actual
filesystem state. When the entry does not exist, the launcher treats it as a
file-shaped scope if any of the following applies, otherwise as a new
directory:

- the trailing path segment matches a curated allowlist of well-known file
  extensions (for example `.md`, `.json`, `.mjs`, `.py`, `.sh`)
- the trailing path segment matches a curated allowlist of well-known
  extensionless filenames (for example `Dockerfile`, `Makefile`,
  `CODEOWNERS`, `LICENSE`, `README`, `CHANGELOG`)
- the trailing path segment is a single-dot dotfile (a basename that starts
  with `.` and contains no further dot, for example `.gitignore`, `.env`,
  `.npmrc`)
- the entry is a launcher wrapper path under
  `packages/agent-launch-cli/bin/`, which is treated as a file-shaped scope for
  classification and directory pre-creation; Codex receives only directory
  `--add-dir` entries because Codex 0.131 documents `--add-dir` as a directory
  argument

Versioned or otherwise dotted directory names such as `tools/example.v1` do
not match any file rule and are therefore prepared as the exact authorized
subtree, while file-shaped entries such as `tools/example.v1/config.json`,
`Dockerfile`, and `.gitignore` continue to prepare only the file parent (or
no new directory at all when the parent already exists). The launcher never
materializes a file-shaped scope on disk; only the parent directory may be
created.

Globbed scope entries (anything containing `*`, `?`, `[`, `]`, `{`, or `}`),
the repo root (`.`), and entries that would resolve outside the repo are never
pre-created. The repo root remains read-only unless the WK explicitly declares
it as a write scope.

The dry-run plan exposes the prepared write roots in
`prepared_new_write_roots`, so operators can confirm which subtrees would be
created before launch:

```bash
npm run agent-launch -- worker --app codex <WK-ID#slice> --dry-run-json
```

The output includes one entry per authorized missing directory, with the
declared `scope_entry` and the resolved `directory` that the launcher would
create. Dry-run planning never writes to disk.

### Family runtime state

The per-family launcher runtime-state facts (Codex, Claude, and AGY),
the four runtime-state classes, and the state-class summary table are
documented in
[agent-launch-family-runtime-state.md](agent-launch-family-runtime-state.md).

### Agent run provenance and inspection

The `agent-run-provenance.v1` envelope, its field model, digest and
retention rules, and the repo-local provenance inspection command are
documented in
[agent-launch-run-provenance.md](agent-launch-run-provenance.md).

### Staged wiki-MCP runtime diagnostics (work record / decision)

A managed confined role (implementation worker, or a confined findings-only
reviewer/redteam) does not run the wiki-MCP server from the live development
checkout. The launcher stages a runtime built from one committed Git revision of
the repository that owns the resolved server entrypoint, in a launcher-owned
directory outside the repository and outside every managed task worktree, and
mounts it read-only. The staged directory is keyed by a digest over the commit and
every member's mode, object id, and path, so an identical request reuses an
existing complete snapshot and a different revision gets its own directory.

Two operator-recoverable blockers are published in the canonical runtime-blocker
taxonomy (`workspace_runtime_blocker_taxonomy` describes both):

- `managed_wiki_mcp_runtime_snapshot_incomplete` — the committed snapshot could not
  be built or verified. Common causes: the runtime source repository has no
  committed `HEAD`; a member is missing, non-regular (a symlink or submodule), or
  its Git object is unreadable; a committed importer's target is not tracked at
  that revision or reaches a workspace package outside the four-package superset;
  or the staged directory is partial, corrupt, or conflicts with the requested
  `(commit, digest)` tuple. The refusal carries a bounded, repository-relative
  member diagnostic naming the offending paths.
- `managed_wiki_mcp_runtime_dependency_unavailable` — the owning repository's
  canonical `node_modules` installation is missing, redirected, lacks npm's
  installed-tree marker, is missing or redirects an expected `@agent-chassis`
  workspace alias, or does not satisfy a dependency the snapshot's committed
  manifests declare.

Operator recovery, in order of likelihood:

1. **Commit the launcher runtime change.** An uncommitted edit to the launcher's
   own runtime source is deliberately INELIGIBLE — that is the guarantee, not a
   bug. Working-tree churn on the launcher checkout never enters a runtime and
   never invalidates one already selected, so a dirty checkout is not an outage;
   but a change you expect to see in-namespace must be committed first.
2. **Repair the dependency installation** (`npm install` in the owning
   repository) when the dependency blocker names a missing alias or dependency.
3. **Remove a conflicting staged directory.** The staged root is disposable cache:
   deleting the reported directory makes the next dispatch restage it. Prefer this
   over editing anything inside it — staged trees are verified against the
   manifest, so hand-edits refuse rather than take effect.

Never work around either blocker by widening the role's repository visibility or
by launching the role without its wiki-MCP server: that server is the worker's
sole delivery authority and the reviewer's/redteam's sole findings authority, so
the launch fails closed by design.

A third failure shape reaches operators through the same
`managed_wiki_mcp_runtime_snapshot_incomplete` code: the in-namespace MCP
preflight. Every managed confined role plan runs a bounded real `initialize` +
`tools/list` against the staged runtime inside that role's FINAL bwrap mount
topology before the plan is returned, so an initialize error, a `tools/list`
error, a timeout, a premature exit, or a tool-surface mismatch REFUSES the launch
rather than spawning a model against a server that cannot serve its authority.
The refusal detail names `preflight_failure` (`timeout`, `exited`,
`initialize_error`, `tools_list_error`, `spawn_error`), the `preflight_binding`,
and a tail of the real stderr.

The most common operator-visible cause is a runtime home that is not
launcher-owned — for example `CODEX_HOME`/`CODEX_ORCH_RUNTIME_DIR` pointing
inside the role's own read-only worktree bind, which bwrap cannot create
(`bwrap: Can't mkdir parents for ...: Read-only file system`). Point those at a
launcher-owned directory outside the worktree.

Note on what the preflight proves: the STAGED RUNTIME is complete, starts in the
role's real namespace, and exposes exactly that role's policy-derived tool
surface. It does NOT prove that the later Codex-owned MCP client instance
initialized. If a role starts and then reports no wiki tools, that is a
client-side readiness question, not a staged-runtime question; an actual-client
mandatory-readiness protocol is separate follow-on work.

### Operator Follow-Up After Review

Follow-up implementation after a worker result must go through a WK-first
structured dispatch path with canonical `write_scope` and the normal
findings-only review step. Do not use direct shell model launchers for
post-review edits.

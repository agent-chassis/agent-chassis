# Filesystem-MCP Worker Backends and Source Substrate

> Part of the [Agent Launch & Direct-Dispatch Reference](agent-launch-quickstart.md).

This page documents the filesystem-MCP worker backend request/decision/handshake contract, the launcher-owned Codex worker source substrate (host-write-authority / outer bwrap), and the roadmap/WIP Agy filesystem-MCP environment policy.

## Operator Filesystem-MCP worker backends

The `filesystem_mcp.apply_from_scratch` surface here is the SLICE-003 advertised child-surface contract for file-level worker writes. It names the boundary the launcher exposes and keeps generated-view validation aligned; it does not mean scratch minting, binding, or in-place apply runtime behavior is already fully implemented before SLICE-004 and SLICE-005 land.

Claude role launches use the canonical shared launcher commands
(`agent-launch worker|review|redteam --app claude <subject>`) and a structured
backend request, not deprecated family-named wrapper files and not an
unrestricted shell. Agy follows the same shared-launcher future shape in
planning and experimental validation only (`--app agy` dry-run/planning
records); it is roadmap/WIP, not a current supported role-launch path. The v1
target backend is filesystem MCP: the launcher supplies the selected WK unit,
role, profile, read scope, write scope, validation command policy, and
provenance destination as structured input, and the backend exposes only scoped
file and validation tools to the child agent.

The authority-bearing version of that launch path is launcher/MCP-owned. Direct
shell wrapper execution cannot satisfy it by constructing a private operator
registry, redirecting config lookup through `HOME`, passing `--operator-config`,
or injecting environment variables. Those inputs are attacker-controlled from
the perspective of a worker subprocess and must be negative-test fixtures, not
fallback setup procedures.

When this backend is selected, worker/review/redteam agents should not receive
raw `exec_command` or equivalent arbitrary shell access. The coordinator or
operator may still use shell access to maintain the repository, but a launched
worker-family child should interact with the repo through the filesystem-MCP
tool surface so declared `read_scope` and `write_scope` can be enforced.

The structured request inputs for that backend are `agent.family`, `role`,
`profile`, `model_hint`, `unit_address`, `read_scope`, `write_scope`,
`validation_policy`, `environment_policy`, and `provenance_destination`.

The backend request should carry at least:

- `schema_version`: `agent-backend-request.v1`
- `backend_kind`: `filesystem_mcp`
- `role`: `worker`, `reviewer`, or `redteam`
- `agent.family`: `codex`, `claude`, or roadmap/WIP `agy`
- `agent.profile`: selected launcher/model profile
- `agent.model_hint`: optional model hint selected by profile or caller
- `unit_address`: repo-qualified WK or slice address
- `subject`: normalized repo-qualified WK or slice address
- `profile`: selected launcher/model profile
- `read_scope` and `write_scope`: normalized repo-relative path lists derived
  from the canonical work record and dispatch-readiness gates
- `validation_policy`: structured argv commands or named validation profiles;
  shell strings are not the dispatch-control surface
- `environment_policy`: closed or allowlisted environment keys supplied by the
  launcher
- `provenance_destination`: launcher-owned path or handle for response and
  run provenance

The backend response should carry at least:

- `schema_version`: `agent-backend-decision.v1`
- `backend_kind`, `backend_id`, and `backend_version`
- `mode`: `local`, `advisory`, or `enforced`
- `allowed`: boolean
- `decision_code`: stable namespaced code
- `reason` and `remediation`
- `run_id` when a launch is accepted
- `provenance`: input digest, selected profile/model, scope digest, and backend
  health evidence

Before a filesystem-MCP backend can return an allowed launch decision, it must
complete a real backend handshake. The launcher issues an
`agent-backend-handshake.v1` challenge that names the requested backend kind,
required role, requested read/write capabilities, raw-exec posture, validation
transport, provenance sink, normalized scope digest, and a fresh challenge
nonce. The backend response must echo the challenge nonce and report:

- `schema_version`: `agent-backend-handshake-result.v1`
- `backend_kind`: `filesystem_mcp`
- `backend_id` and `backend_version`
- `status`: `available` or a stable unavailable/misconfigured status
- `mode`: `enforced` for normal worker-family launch
- `raw_exec_enabled`: `false`
- `tool_surface`: the scoped tools the child will receive
- `scope_binding`: whether the backend will enforce the supplied read/write
  scope digest
- `validation_transport`: `argv`, named profile, or unsupported
- `provenance_sink`: launcher-owned response/provenance destination support
- `handshake_digest` and `expires_at`

An `agent-backend-decision.v1` with `allowed: true` for `filesystem_mcp` must
include the accepted handshake digest and must be refused if the handshake is
missing, expired, for a different backend/profile/scope digest, or reports raw
exec enabled. This handshake is the proof that scoped filesystem-MCP enforcement
is active only when the handshake result is produced by a verifier/backend
boundary that the request-building wrapper cannot self-mint. Same-process
wrapper-issued JSON, a digest derived only from request bytes and wrapper-known
constants, or an inherited path to a prewritten handshake file is advisory
metadata, not enforcement proof, and must not produce an enforced
`agent_backend.filesystem_mcp.allowed.v1` decision.

The accepted child tool surface must be the scoped filesystem-MCP surface named
by the verified backend. A launch that hands the child stock model tools such as
`Edit`, `Write`, or `Bash(...)` as the write/read boundary has not enforced
filesystem-MCP scoping, even if the request and decision JSON contain matching
scope digests. Reviewer and redteam launches must be read-only in both the
backend request and the actual child tool surface.

For file-level worker writes, the launcher also advertises a scoped
`filesystem_mcp.apply_from_scratch` child-surface contract from SLICE-003.
That contract describes the advertised surface only; the scratch minting,
binding, and in-place apply runtime behavior land in later slices.

To make the verified surface real for a worker-family child, the launcher
registry entry may pin an optional `child_mount` for a `filesystem_mcp_backends`
backend: `{ transport: "stdio", command, args, env? }`. This is the concrete
launcher-owned MCP server the child actually connects to, and is distinct from
`endpoint` (the one-shot handshake prover). When present, the launcher mounts it
into the child as the `mcp_servers.filesystem_mcp` server (for the Codex family,
as `-c mcp_servers.filesystem_mcp.command/args/env` overrides), and binds the
running server to the verified scope by passing
`AGENT_LAUNCH_SOURCE_TOOL_SURFACE_DIGEST`,
`AGENT_LAUNCH_SOURCE_TOOL_SURFACE_HANDSHAKE_DIGEST`, and
`AGENT_LAUNCH_SOURCE_TOOL_SURFACE_RAW_EXEC=false` through the server `env`. The
launcher never sources this mount from inherited env, argv, prompt text, or the
work record; only the registry-pinned `child_mount` (the same launcher-owned
authority as `endpoint`/`mode`) is honored. When an enforced filesystem-MCP
backend is configured but has no `child_mount`, the verified surface is
descriptor-only and not mountable, so a source-edit worker launch fails closed
before spawn rather than launching a child that lacks real scoped source tools.
For the Codex family, when no enforced filesystem-MCP backend is configured at
all (no `filesystem_mcp_backends` section, or an advisory default), dispatch
instead routes to the deployed host-write-authority / outer-bwrap source
substrate; see the "Codex worker source substrate" section below.

Backend identity, endpoint, mode, profile support, and handshake-source
selection are launcher authority. They must come from launcher-owned operator
configuration or another trusted launcher-owned source. Inherited shell
environment can carry ordinary process inputs, but inherited
`*_FILESYSTEM_MCP_*` values must not grant backend availability, select the
backend endpoint, or choose an accepted handshake result.

When a filesystem-MCP launch participates in role-guard enforcement, the launch
must mint or reference a role-guard launcher-context envelope that binds the
backend handshake digest, role, WK or slice address, repo root, config path, run
id, and guarded action payload. Ambient `AGENT_ROLE` and `AGENT_WK` are transport
only; they are not sufficient authority for a PreToolUse or equivalent
per-action guard.

Backend-unavailable conditions must fail before model launch when detectable.
Direct CLI socket/API startup failures such as `FailedToOpenSocket` are
backend-unavailable failures, not worker input failures. The normal remediation
is to restore the filesystem-MCP backend or use a supported non-Claude path;
direct Claude CLI retry is not the default worker-family recovery path.

`claude doctor`, `agy --version`, or another direct CLI probe may be a
temporary local diagnostic while the backend is being built, but it is not the
architecture. It must not be treated as proof that filesystem scope enforcement
is active, must not produce `agent_backend.filesystem_mcp.allowed.v1`, and must
not be used as the handshake digest for a filesystem-MCP launch.

## Codex worker source substrate

The filesystem-MCP `child_mount` path above is the **configured enforced**
source boundary. It is the opt-in enforcement layer used only when an enforced
`filesystem_mcp_backends` backend is actually configured and proven. It is
**not** the prerequisite for deployed Codex worker dispatch, and filesystem-MCP
backend configuration is not a precondition for launching a Codex worker.

The deployed Codex worker source substrate is launcher-owned
**host-write-authority / outer bwrap** — the in-process bwrap launch path, or
the host-write-authority sidecar broker when an orchestrator sidecar is running.
This is the current Codex launcher-owned source authority under decision's
single launcher pipeline: the shared launcher owns the isolation, write-scope,
and final-result policy, while the Codex family adapter supplies only harness
facts (private `CODEX_HOME`, CLI argv, `--output-last-message`, and the rest).
It is the deployed substrate — not a legacy, alternate, or fallback path.

The launcher selects between these two source surfaces from launcher-owned
registry state, conservatively:

- **No enforced filesystem-MCP backend configured** — the operator registry has
  no `filesystem_mcp_backends` section, or the resolved default backend is in
  advisory mode. The real preparer emits the explicit launcher-issued marker
  `workspace-agent-dispatch-source-tool-surface-not-configured.v1`. The shared
  dispatch backend, the Codex in-process executor, and the host-write-authority
  broker all recognize that marker and route the Codex worker to the deployed
  host-write-authority / outer-bwrap substrate, where the launcher derives the
  worker's writable roots and exact file binds from the selected WK `write_scope`
  (the outer-bwrap write/read authority). Filesystem-MCP backend configuration is
  **not** treated as a launch precondition here.
- **An enforced filesystem-MCP backend is configured** — the launcher stays on
  the prove-or-fail-closed path. It must prove scope binding, scope-digest
  parity, raw-exec-disabled, and a mountable `child_mount` before spawn, or it
  refuses with `source_surface_not_proven` before launching the child. This
  includes an enforced backend configured **without** a `child_mount`: the
  verified surface is descriptor-only and not mountable, so the Codex
  source-edit worker fails closed before spawn rather than launching a child
  without real scoped source tools. A misconfigured backend, an unprovable or
  unbound proof, and a null/absent surface all fail closed the same way.
  Fall-through requires the explicit not-configured marker, never a missing or
  malformed field.

The not-configured marker is a **routing fact only**. It records that no
enforced filesystem-MCP backend is configured, so dispatch routes to the
deployed substrate; it is never accepted filesystem-MCP authority. It grants no
scoped tool surface, mounts nothing, and cannot stand in for a proven
`child_mount`. The launcher never synthesizes a `child_mount`, fabricates a
registry backend, or otherwise manufactures filesystem-MCP enforcement from the
marker.

This separation does not weaken decision or the launch prohibitions. There is
one shared launcher pipeline with thin family adapters; the deployed substrate
is not a per-family wrapper, raw shell, `Bash`, `exec_command`, stock
`Edit`/`Write`/`Bash` write boundary, temp worktree, broad repo-wide write, or
fake registry authority. Reviewer and redteam launches stay read-only on both
source surfaces.

**initiative filesystem-MCP is the optional/future configured enforcement layer**,
not a prerequisite for Codex worker dispatch. Operators do not need to build
initiative to recover or run Codex worker dispatch: the deployed
host-write-authority / outer-bwrap substrate is present and is the Codex source
authority whenever no enforced filesystem-MCP backend is configured. initiative
only adds the configured `child_mount` enforcement path above when an operator
actually configures and proves an enforced `filesystem_mcp_backends` backend.

## Agy roadmap/WIP filesystem-MCP environment policy

AGY is roadmap/WIP and not officially supported as a current worker-family
launch path. The planned shared-launcher shape uses the same filesystem-MCP
backend request/decision contract as Claude for planning and experimental
validation. In that future shape, the launcher builds an
`agent-backend-request.v1` for `agent.family: agy` and passes the selected role,
profile, read scope, write scope, validation policy, and provenance sink through
that structured backend path rather than through a raw Agy CLI shell dispatch.

Planned Agy backend requests must carry an explicit environment policy. The
launcher permits only profile-declared inputs for the selected Agy profile, such
as `AGY_API_KEY`, `AGY_MODEL`, and any Agy-specific variables that the profile
documents as supported for experimental validation. Any other inherited shell
environment is omitted or refused rather than passed through by default.

The quickstart should describe the allowed variable names and profile shape,
not secret values. Secrets belong in the operator's environment or secret
store, not in the work record or launcher docs.

Operator/debug examples for wrapper syntax are intentionally omitted from this
agent-facing quickstart. Agent dispatch uses `workspace_agent_dispatch`; if
that tool is unavailable, report `missing_structured_transport`.


# MCP integration

The launcher owns one host-side `@agent-chassis/wiki-mcp` process for each
confined Claude or Codex dispatch. The model sandbox never contains a Node
interpreter, package tree, dependency installation, or wiki-MCP runtime.

## Result channels

For a non-spilled tool result, `structuredContent` is the sole complete
machine-readable payload. The text block in `content` is only a useful
descriptor of where that payload is available and is capped at 512 UTF-8 bytes;
it never contains a second JSON serialization or payload preview. Structured
error envelopes follow the same rule and retain `isError: true`. An
unstructured thrown error has no machine envelope, so its redacted message
remains in the bounded text descriptor.

The inline byte gate counts the structured payload once plus bounded MCP frame
overhead. A payload that fits that single-copy envelope remains inline; a larger
payload keeps the existing file-backed spill descriptor, content reference,
ranged continuation, refusal, and error-envelope contracts.

## Transport

The only model-to-server transport is transparent stdio over one launcher-minted
named-FIFO pair. The launcher creates exactly two mode-0600 FIFOs in a fresh
mode-0700 directory outside repositories and worktrees. It verifies ownership,
type, mode, directory membership, object identity, and dispatch association,
then holds Linux `O_PATH|O_NOFOLLOW` references. Bubblewrap binds those two
objects read-only at fixed launcher paths in the role's one namespace.

The client registration is frozen by family:

- Claude receives launcher-authored `--mcp-config` plus
  `--strict-mcp-config` and the role-derived `mcp__wiki__*` allowlist.
- Codex receives only launcher-authored `mcp_servers.wiki` command and args
  overrides in an isolated runtime home.

Both registrations run the same pinned base-system copy relay. The relay opens
the fixed bound FIFO paths; it does not inherit conduit descriptors. The host
wiki-MCP process directly owns the opposite FIFO ends. There is no listener,
endpoint discovery, proxy, intermediary, credential, or alternative transport.

The server reports its exact registered tool surface on a launcher-only pipe.
The real client must then complete MCP `initialize`, send `initialized`, and
request `tools/list`. Only after the client has opened both bound objects does
the launcher close anchors and unlink both FIFO names. Timeout, early EOF,
client/relay/server exit, type or identity mismatch, tool-surface mismatch,
cancellation, cleanup failure, and reaping failure are typed and fail closed.

Lifecycle compatibility is established by the host wiki-MCP process that was
actually spawned. Its initial launcher-only
`wiki-mcp-launcher-readiness.v2` registration includes
`lifecycle_protocol_generation: stdio-mcp-conduit-lifecycle-vocabulary.v1`,
loaded from that process's conduit contract. The long-lived launcher compares
the announcement with its own loaded generation before the family executor can
spawn a confined worker, reviewer, redteam, or orchestrator. No request field,
environment value, filesystem fingerprint, backend generation, or historical
state supplies the comparison.

Only equality permits initialize and exact `tools/list`. Old, missing,
malformed, unknown, or incompatible generation evidence returns the existing
`operator_recovery_needed` blocker and bounded coherent-build/restart detail.
It authenticates no delivery, creates no review or integration transition, and
opens no retry or fallback. A legacy consumer may instead return its existing
unknown-lifecycle readiness blocker for the v2 registration, still before child
spawn.

After registration, the launcher enforces a single-generation phase machine:
await server registration/generation, server compatible, await initialize,
await exact `tools/list`, ready, client closed, and terminal (or failed).
Duplicates, close-before-readiness, evidence after close, unknown schemas, and
impossible transitions preserve the first typed failure and use the same
exactly-once cleanup settlement.

The public dispatch-facing taxonomy is producer-complete. Construction and
binding failures use `stdio_mcp_conduit_input_invalid`,
`stdio_mcp_conduit_family_unsupported`,
`stdio_mcp_conduit_private_root_unavailable`,
`stdio_mcp_conduit_directory_invalid`,
`stdio_mcp_conduit_fifo_create_failed`, `stdio_mcp_conduit_fifo_invalid`,
`stdio_mcp_conduit_fifo_identity_mismatch`,
`stdio_mcp_conduit_binding_consumed`, and
`stdio_mcp_conduit_stdio_shape_unsupported`.

Host-server failures use `stdio_mcp_host_server_unavailable`,
`stdio_mcp_host_server_start_failed`,
`stdio_mcp_host_server_readiness_failed`,
`stdio_mcp_host_server_startup_timeout`, and
`stdio_mcp_conduit_server_exit`. Exact role/tool verification uses
`stdio_mcp_tool_surface_mismatch` and
`stdio_mcp_client_tool_surface_mismatch`. Client lifecycle failures use
`stdio_mcp_client_readiness_failed`,
`stdio_mcp_client_readiness_timeout`, and
`stdio_mcp_client_relay_restarted`.

Namespace and teardown failures use
`stdio_mcp_conduit_requires_bubblewrap`, `stdio_mcp_conduit_cancelled`,
`stdio_mcp_conduit_cleanup_failed`, `stdio_mcp_conduit_reap_failed`, and the
family-neutral terminal projection `stdio_mcp_cleanup_failed`. Every code is
registered in `packages/wiki-core/data/runtime-blocker-codes.v1.json`, has a
production producer, and is a blocking dispatch-facing failure.

## Role authority

Tool authority comes from the launcher-resolved role profile, never prompt,
repository settings, user settings, environment, arbitrary argv, or caller MCP
configuration. Workers receive only the closed-input `commit` capability.
Reviewers and redteam are findings-only and have empty write scope.
Orchestrators receive the coordinator tool profile. Agy is unsupported for this
confinement contract and is refused before launch.

The frozen per-run binding covers family, assigned unit, role profile, worktree
identity, R union W visibility, write authority, host-server process, both FIFO
objects, exact relay registration, and lifecycle owner. A binding is immutable
and cannot be reconstructed or replayed across runs or families.

## Trusted mutations

Launcher/runtime code performs `start_launch`, `probe_run`,
`provision_worktree`, `prepare_slice_review_surface`, and `integrate_slice`
in-process. The host wiki-MCP server performs `commit_slice` in-process using
the existing closed-input, server-resolved, object-first and compare-and-swap
pipeline. Its worker tool accepts no path, ref, branch, message, author, writer,
shell, Git API, or repository selection. The orchestrator-only
`wk_forge_handoff` tool invokes the launcher-owned host executor in-process.

An exact-slice submission may deliver the authenticated base tree unchanged. In
that case `commit_slice` performs the canonical implementation-to-review
transition without publishing a meaningless suffix commit, and integration
records the lifecycle result without moving the WK ref. Integration replays
non-empty deliveries from immutable commit objects and never depends on mutable
retained-checkout cleanliness. Parent-WK review state and slice dependency state
are policy facts for the configured CCE boundary, not local chassis vetoes.
After a successful integration, current-slice cleanup uses the launcher-proven
path/ref binding and tolerates checkout dirt; a cleanup failure is reported as a
separate post-integration outcome and does not undo or relabel the integration.

When no trusted conduit plan is supplied, the generic bubblewrap planner and
spawn primitive retain their ordinary behavior.

## Prospective work-record preflight

`workspace_preflight_dispatch` is the read-only companion to
`workspace_validate_dispatch`. It accepts a proposed, unpersisted work-record
or slice body and returns the same readiness projection that
`workspace_validate_dispatch` returns for a persisted record. This lets an
author inspect the proposed contract before writing it, instead of persisting,
being refused, rewriting, and re-persisting one revision at a time.

This exists because admission reports one control at a time. A proposal that
trips several constraints is refused once per constraint: after the first is
cleared, the next becomes visible. While shaping this work record, a slice was
first refused for `write_scope_total_loc`; only after that was cleared did
`write_scope_count` surface behind it. The preflight exposes that sequence
before any canonical write, so authors can see the projection in advance.

The route is non-mutating with respect to canonical records and admission
sidecars. It may write only the git-ignored code-index derived cache authorized
by accepted decision section 5: the artifact and its directory, the lease
directory, and the lock, candidate-slot, lease, heartbeat, publication, and
release files. Those files may be produced on any `index_action` rebuild
verdict, not only when HEAD is stale.

The route reports whatever admission returns and defines none of it: it sets no
thresholds, verdicts, or remedy selection, and does not duplicate admission
policy. Admission remains the authority for the projection and its refusal
reason.

## Tool input schema publication

Every MCP tool registers through the single `createRegisterTool` boundary in
`packages/wiki-mcp/src/lib/register-tool.mjs`. The SDK publishes a tool's
`inputSchema` on `tools/list` only when it recognizes an object schema — through
a zod v3 `.shape` or a zod v4 `_zod.def.type === "object"`. A zod v3 `ZodEffects`
— what `.refine()` or `.superRefine()` on a `z.object()` produces — exposes
neither, so the SDK substitutes an empty `{ "type": "object", "properties": {} }`
sentinel that carries no `$schema` key. The affected tool then advertises "no
arguments" even though the SDK's own `validateToolInput` falls back to the full
schema and still enforces every field and refinement at call time. It is a
publication-only defect: the advertised contract says "no arguments" while the
enforced contract is the full strict object plus its cross-field guards.

The boundary repairs this centrally, without editing any tool: when a tool's
`inputSchema` is a `ZodEffects` that, after unwrapping any chained effects, wraps
a `ZodObject`, `createRegisterTool` registers that inner `ZodObject` with the SDK
so its properties, `$schema`, and `additionalProperties: false` (from `.strict()`)
convert and publish, and re-runs the full effects schema inside the wrapped
handler before delegating so every refinement still rejects exactly the inputs it
rejected before (the offending field is still identified; only the rejection layer
may move from schema to handler). Plain `ZodObject`, raw-shape, and genuine
no-argument (`z.object({})`) inputSchemas are untouched, and because the fix is at
the shared boundary a future tool authored with `.refine()` / `.superRefine()` is
normalized automatically. Tool authors may therefore use refinements freely. The
`$schema`-absent empty-object sentinel on `tools/list` is the symptom to watch
for; `tests/mcp-startup-regression.test.mjs` fails on any argument-accepting tool
that publishes it.

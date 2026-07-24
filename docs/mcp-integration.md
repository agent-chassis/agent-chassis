
# MCP integration

The launcher owns one host-side `@agent-chassis/wiki-mcp` process for each
confined Claude or Codex dispatch. The model sandbox never contains a Node
interpreter, package tree, dependency installation, or wiki-MCP runtime.

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

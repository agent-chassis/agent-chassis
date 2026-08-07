# Host wiki-MCP Conduit Diagnostics

> Part of the [Agent Launch & Direct-Dispatch Reference](agent-launch-quickstart.md).

This page documents the per-role host wiki-MCP conduit, its typed `stdio_mcp_*`
failure taxonomy, the orchestrator session diagnostic fields, and the operator
recovery route for a consumed or failed conduit. The conduit contract itself is
in [mcp-integration.md](mcp-integration.md).

Every confined Codex or Claude role receives exactly one launcher-owned host
wiki-MCP server through two named FIFOs bound into the final bubblewrap namespace.
The server and its dependencies remain on the host; the sandbox contains only the
two fixed relay paths and the pinned base-system copy relay. The launcher verifies
the exact role-derived tool list after the real client completes MCP `initialize`
and `tools/list`, then unlinks the FIFO names.

Conduit construction, host-server startup, client readiness, namespace, and
cleanup failures use the producer-complete public `stdio_mcp_*` taxonomy
documented in [MCP integration](mcp-integration.md#transport). These
failures never degrade to an optional MCP server. Failures found before spawn or
readiness refuse model work; failures found after readiness resolve the separate
always-live conduit failure channel, trigger bounded exactly-once teardown, and
publish a typed terminal outcome. Interactive orchestrator server loss is
failure-shaped while the orchestrator process remains live, even when client
transport close was observed first. Only launcher-observed orchestrator process
terminality authorizes expected interactive cleanup; one-shot worker, reviewer,
and redteam expected drain remains successful.

Orchestrator `session.json` records a bounded `stdio_mcp_reason` and
`stdio_mcp_detail` before terminal publication. The detail identifies readiness,
mid-session server loss, relay restart, cleanup, or reaping using launcher-owned
tokens only; it contains no prompt, credentials, environment, raw process
output, prose, or stack trace. If this diagnostic cannot be persisted, the
launcher fails closed with `stdio_mcp_session_diagnostic_persistence_failed`.

Recovery for a consumed or failed conduit is to end the affected session, repair
the named host-server, bubblewrap, cleanup, or persistence prerequisite indicated
by the typed phase, and restart or resume through the normal launcher entrypoint.
A consumed per-dispatch FIFO stream is never refreshed, reconnected, or reused.
Do not increase `startup_timeout_sec` for post-readiness loss: that budget governs
only initialize plus `tools/list` and cannot restore a conduit that already
failed. Never widen repository visibility or add another transport.

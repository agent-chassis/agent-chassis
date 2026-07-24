
# Agent-launch confinement and MCP conduit

Confined implementation and findings roles use bubblewrap for repository
visibility and mutation enforcement. For a managed worker, the visible
repository namespace is exactly the frozen union of canonical `read_scope`,
`repo_paths`, and `write_scope`; mutation is possible exactly within
`write_scope`. A full host checkout never broadens this namespace.

The wiki tool surface is not a filesystem backend and does not widen repository
visibility. The launcher starts exactly one host wiki-MCP process per dispatch
and connects it to Claude or Codex through the named-FIFO stdio conduit described
in [MCP integration](mcp-integration.md). No wiki-MCP executable, interpreter,
package, dependency tree, or runtime directory is mounted into the sandbox.

The launcher creates exactly two mode-0600 FIFO objects in a private mode-0700
directory outside repositories and worktrees, holds O_PATH references to those
exact objects, and binds them at fixed relay paths in the dispatch bubblewrap
namespace. The client registration invokes the single pinned copy-only relay.
The FIFO names are unlinked after the bound endpoints are safely open. Readiness
requires a real MCP `initialize` followed by `tools/list` matching the exact
launcher-derived role profile.

Conduit creation, validation, readiness, failure mapping, and teardown are one
family-neutral implementation. Claude and Codex differ only in the frozen
client registration projection described below.

Claude and Codex receive only launcher-generated client registrations. Claude
uses `--mcp-config`, `--strict-mcp-config`, and the role-specific tool allowlist.
Codex receives one exact top-level `mcp_servers` override containing only the
`wiki` relay. Repository settings, user settings, prompt text, ambient
environment, and caller configuration cannot add, replace, or retarget the
server. Agy has no supported confined registration adapter and fails closed.

Trusted writes remain inside their owning host process. The launcher runtime
owns launch, probe, worktree provisioning, review-surface preparation, and slice
integration. The host wiki-MCP server owns the closed-input commit capability.
The orchestrator-only forge tool invokes the existing launcher-owned host
executor in-process. There is no broker, endpoint, socket transport,
general-filesystem transport, in-sandbox MCP runtime, or compatibility fallback.

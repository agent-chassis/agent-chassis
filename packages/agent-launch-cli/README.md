# @agent-chassis/agent-launch-cli
<!-- Generated file — edit the source area record and regenerate; do not edit by hand. -->

`packages/agent-launch-cli` is the internal launcher engine installed through
`@agent-chassis/core`. It exports no npm command. Core alone owns the public
`agent-launch` forwarding bin; human/operator launch, resume, dispatch, setup,
and cleanup actions go through that command. Agents do not invoke this operator entrypoint. The package
composes the `agent-launch-core` substrate with the `wiki-core` and `wiki-mcp`
surfaces a launched session needs. Confined Claude and Codex roles use a launcher-pinned stdio connector over a
private Unix-domain socket admission service. Each admitted connection receives
one launcher-owned host wiki-MCP process; server code and dependencies stay on
the host. Named-FIFO relays are not supported.

## Entry Points

Entry points:
- `packages/core/bin/agent-launch` — the sole public launcher command; binds core documentation for managed commands.
- `packages/agent-launch-cli/src/index.mjs` — internal engine imported by core.
- Historical family-named files, including `codex-orch`, `claude-orch`, and
  `*-resume` forms, are not retained under `packages/agent-launch-cli/bin/`
  and are not installed public/operator entrypoints.
- `packages/agent-launch-cli/config/` — launcher config assets.

Human / operator entrypoints here are operator actions; an agent in a worker or coordinator
session does not invoke them.

## Package Role

Install `@agent-chassis/core` for supported consumer use. Individual surface packages are internal dependencies.

## Related Docs

- [Package Install](../../docs/package-install.md)
- [agent-launch-quickstart.md](../../docs/agent-launch-quickstart.md)
- [agent-launch-confinement-mcp-conduit.md](../../docs/agent-launch-confinement-mcp-conduit.md)
- [enforcement-model.md](../../docs/enforcement-model.md)

# @agent-chassis/agent-launch-cli
<!-- Generated file — edit the source area record and regenerate; do not edit by hand. -->

`packages/agent-launch-cli` is the consolidated launcher CLI package. Its
published `package.json` `bin` surface installs only `agent-launch`;
human/operator launch, resume, dispatch, setup, and cleanup actions go through
that command. Agents do not invoke this operator entrypoint. The package
composes the `agent-launch-core` substrate with the `wiki-core` and `wiki-mcp`
surfaces a launched session needs. Confined role launches use one launcher-owned
host wiki-MCP process through the shared named-FIFO stdio conduit.

## Entry Points

Entry points:
- `packages/agent-launch-cli/src/index.mjs` — the `agent-launch` command bin.
- Historical family-named files, including `codex-orch`, `claude-orch`, and
  `*-resume` forms, are not retained under `packages/agent-launch-cli/bin/`
  unless they are explicitly declared in `package.json` `bin`; they are not
  installed public/operator entrypoints for the published package.
- `packages/agent-launch-cli/config/` — launcher config assets.

Human / operator entrypoints here are operator actions; an agent in a worker or coordinator
session does not invoke them.

## Package Role

This package is installed through `@agent-chassis/core` for normal use. It remains available as a granular package for consumers that need direct package control.

## Related Docs

- [Package Install](../../docs/package-install.md)
- [agent-launch-quickstart.md](../../docs/agent-launch-quickstart.md)
- [agent-launch-confinement-mcp-conduit.md](../../docs/agent-launch-confinement-mcp-conduit.md)
- [enforcement-model.md](../../docs/enforcement-model.md)

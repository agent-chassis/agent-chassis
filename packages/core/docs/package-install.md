
# Package Install

For the normal first-time setup path, start with **[docs/quickstart.md](quickstart.md)**.
It covers package access, installing `@agent-chassis/core`, bootstrap, building
the code index, MCP wiring, and orchestrators in order.

This page keeps the package detail that the quickstart does not spell out: the
package roles and the recommended local npm scripts. For install forms and CI
notes, see [docs/local-package-install.md](local-package-install.md).

## Runtime Prerequisite

Installed `@agent-chassis/*` packages support Node.js 22 or newer. Configure the
runtime before installing or invoking `wiki`, `wiki-mcp`, or `agent-launch`.

## Package Access

Packages are published to the public npm registry under the `@agent-chassis`
scope. No scope registry mapping, `.npmrc`, or authentication is required to
install them: a plain `npm install` resolves them from the default registry.

Publishing (maintainers only) uses standard public-npm auth (`npm login`, or a
registry.npmjs.org automation token) and publishes each scoped package with
`npm publish --access public`. No private registry mapping or token is involved.

## The Core Package

```bash
npm install --save-dev @agent-chassis/core
```

`@agent-chassis/core` is the normal public install package. It installs every
binary you need and pulls in the underlying surfaces:

- `@agent-chassis/wiki-cli` provides the `wiki` binary for bootstrap,
  validation, lint, generated views, the code index, and local wiki operations.
- `@agent-chassis/wiki-mcp` provides the `wiki-mcp` stdio MCP server that agents
  call for structured wiki, work-record, dispatch-readiness, code-index, and
  tool-discovery operations.
- `@agent-chassis/agent-launch-cli` provides the `agent-launch` operator
  entrypoint, including `agent-launch orchestrator`, `agent-launch resume`, and
  `agent-launch orchestrator list`.

These in turn pull in their shared `@agent-chassis/*` dependencies
(`@agent-chassis/wiki-core` and `@agent-chassis/agent-launch-core`) from the same
registry.

If you would rather pin the surfaces individually, you can install them directly
instead of the bundle:

```bash
npm install --save-dev @agent-chassis/wiki-cli @agent-chassis/wiki-mcp @agent-chassis/agent-launch-cli
```

`wiki-mcp` is a stdio server: when launched by an MCP client it starts and waits
for JSON-RPC frames on stdin/stdout. It is launched by the client, not run by
hand.

## Recommended Local Scripts

After installing, a minimal pair of `package.json` scripts is handy for invoking
the binaries through npm:

```json
{
  "scripts": {
    "wiki": "wiki",
    "agent-launch": "agent-launch"
  }
}
```

## Reference

- [docs/quickstart.md](quickstart.md) — the normal first-time setup path.
- [docs/local-package-install.md](local-package-install.md) — registry setup,
  install forms, and CI usage.
- [docs/mcp-integration.md](mcp-integration.md) — MCP client configuration.

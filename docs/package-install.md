
# Package Install

For the normal first-time setup path, start with **[docs/quickstart.md](quickstart.md)**.
It covers package access, installing `@agent-chassis/core`, bootstrap, building
the code index, MCP wiring, and orchestrators in order.

This page keeps the package detail that the quickstart does not spell out: the
package roles and the recommended local npm scripts. For install forms and CI
notes, see [docs/local-package-install.md](local-package-install.md).

## Runtime Prerequisite

Installed `@agent-chassis/*` packages require Node.js 24.20.0 or newer. Configure the
runtime before installing or invoking `wiki`, `wiki-mcp`, or `agent-launch`.

Managed slice integration also requires the Git executable that the serving
`wiki-mcp` process selects from its own environment to support
`git merge-tree --write-tree --merge-base`. Installing these packages does not
install or upgrade Git, and there is no fallback. A run refused for this reports
the prerequisite as `required_correction` on its status response; correct the
serving runtime's Git installation or executable selection, then observe the same
run again. See
[explicit-base merge-tree](mcp-dispatch-slice-integration.md) for the
installed-runtime check.

Git introduced `git merge-tree --merge-base` in 2.40.0 (see the
[Git 2.40.0 release notes](https://github.com/git/git/blob/v2.40.0/Documentation/RelNotes/2.40.0.txt)),
so the supported minimum for this capability is Git 2.40. No other documented
requirement sets a higher Git minimum. The version is guidance only: the
launcher checks the executable itself, asking the selected `git` for its
`merge-tree` usage, and a Git that does not advertise the option is refused
whatever version it reports. Distribution packages can lag this minimum. Debian
12, for example, ships Git 2.39.5 and has no newer backport.

Updating or reinstalling the npm packages never upgrades Git, and neither does
syncing package files into an existing installation. Git comes from the host,
image or container that runs `wiki-mcp`. Which `git` runs is decided by the
`PATH` the serving process inherited when it started, so installing a newer Git
somewhere else on the machine does not help. Put it on that `PATH`, ahead of the
old one. A long-running server looks `git` up on its own `PATH` again for every
call. It never picks up a changed `PATH`, so a directory that was not on that
`PATH` when it started stays invisible to it.

The initiative DeepSWE prepared image meets this with a harness-owned Git, which is
separate from the task's own Git. It is built from one checksum-pinned upstream
release (currently 2.55.0, newer than the supported minimum) into
`/opt/agent-chassis/git`, and the harness launch scripts put it on the launcher's
`PATH`. See the [initiative DeepSWE smoke](benchmark-runs/initiative/deepswe-smoke/README.md#retained-containers-and-git)
for the checks and for recovering a container that predates it.

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
(`@agent-chassis/wiki-core`, `@agent-chassis/agent-launch-core`, and
`@agent-chassis/controlled-contract`) from the same registry. Wiki-core uses
controlled-contract at runtime, so installing `@agent-chassis/core` or a surface
that depends on wiki-core installs it transitively.

Package consumers that use controlled-contract exports, schemas, or CLIs
directly can install its independently versioned public package explicitly:

```bash
npm install --save-dev @agent-chassis/controlled-contract
```

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

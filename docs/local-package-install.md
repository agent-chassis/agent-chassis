
# Local Package Install

This document describes how a consuming repository installs the shared
AgentChassis tooling from a package registry and runs the one-line bootstrap.

The tooling is published as scoped npm packages under the `@agent-chassis`
scope. The supported operational install for a consuming repo is the
`@agent-chassis/core` package, which installs every binary and pulls in the
underlying surfaces:

- `@agent-chassis/wiki-cli`, which exposes the `wiki` binary.
- `@agent-chassis/wiki-mcp`, which exposes the `wiki-mcp` MCP stdio server.
- `@agent-chassis/agent-launch-cli`, which exposes the human/operator launcher
  entrypoint `agent-launch`, including orchestrator launch, resume, and list
  subcommands.

Those packages in turn pull in their shared `@agent-chassis/*` dependencies
(`@agent-chassis/wiki-core` and `@agent-chassis/agent-launch-core`) from the
same registry. A repo that prefers to pin the surfaces separately can install
the three top-level packages directly instead of `@agent-chassis/core`.

## Package Distribution

Packages are published to the public npm registry (`registry.npmjs.org`) under
the `@agent-chassis` scope. No scope registry mapping, `.npmrc`, or
authentication is required to install them: a plain `npm install` resolves them
from the default registry. The older "local `file:` checkout" model is retired.

## Registry And Auth Setup

None. Because the packages are public on the default npm registry, a consuming
repo needs no `@agent-chassis` scope mapping, no committed or user `.npmrc`, and
no auth token to install them. Run the install commands below directly.

Publishing (maintainers only) uses standard public-npm auth — `npm login`, or a
`registry.npmjs.org` automation token in the operator's user npm config — and
publishes each scoped package with `npm publish --access public`. No private
registry mapping or token is involved.

## Install Forms

Choose the form that matches how the consuming repo or operator works. The
repo-local devDependency install is the supported operational path.

### 1. Bootstrap-only zero-install with `npx`

For a one-off bootstrap on any repo, no install or `package.json` is needed —
`npx` fetches and runs the CLI directly:

```bash
npx -p @agent-chassis/wiki-cli wiki bootstrap --profile <profile>
```

This can seed a fresh repository. The published bin is
named `wiki`, which does not match the package name, so the canonical zero-install
form must name the package with `-p @agent-chassis/wiki-cli` and the bin `wiki`
explicitly. The bare `npx @agent-chassis/wiki-cli <subcommand>` form is not a
reliable installed-binary invocation and should not be used. Because the package
is public on the default registry, `npx` fetches it with no registry or auth
configuration.

This zero-install form is not the complete operational setup: it does not pin
the local `wiki-mcp` server or launcher entrypoints in the consuming repo's
lockfile. Install `@agent-chassis/core` before wiring MCP clients or running
orchestrators.

When `--repo` is omitted, bootstrap defaults the repo identifier to the target
directory basename. Pass `--repo <id>` only when you want an explicit override.

### 2. Repo-local devDependency (recommended for repos with a `package.json`)

For a repo that wants the tooling pinned in its lockfile and available to npm
scripts and CI, install the core package as a dev dependency:

```bash
npm install --save-dev @agent-chassis/core
```

The `@agent-chassis/core` postinstall hook prints terse first-run setup
guidance only. It does not run bootstrap, copy templates, write config, launch
agents, or otherwise mutate the repo during package install.

After install, run the explicit setup command from the consumer repo root:

```sh
npx agent-chassis setup
```

The setup command runs bootstrap, guides launcher template selection for the
detected Claude or Codex CLI, copies `agent-launch.toml` only when absent, runs
`npx agent-launch init-config`, and prints the next code-index and orchestrator
commands. It intentionally does not copy `AGENTS.md`; review
`wiki/templates/AGENTS.md.boilerplate.md` and adapt it into the repo root
because the operating contract is repo-specific.

To pin the underlying surfaces individually instead, install
`@agent-chassis/wiki-cli @agent-chassis/wiki-mcp @agent-chassis/agent-launch-cli`.

Then invoke the installed binary through `npx` or an npm script:

```bash
npx wiki bootstrap --profile standard
```

Recommended `package.json` scripts:

```json
{
  "scripts": {
    "wiki": "wiki",
    "wiki:mcp": "wiki-mcp",
    "agent-launch": "agent-launch",
    "wiki:bootstrap": "wiki bootstrap --profile standard",
    "wiki:lint": "wiki lint",
    "wiki:sync-check": "wiki sync-contract --check",
    "wiki:generate": "wiki generate",
    "wiki:build-search-index": "wiki build-search-index",
    "wiki:search": "wiki search"
  }
}
```

The `wiki-mcp` binary is a stdio MCP server. It starts and waits for JSON-RPC
frames from the MCP client; a command such as `npx wiki-mcp --help` is not a
valid health check.

### 3. Global install (for operators who want a bare `wiki` binary)

For an operator who wants the binaries on `PATH` across repos without a
per-repo devDependency:

```bash
npm install -g @agent-chassis/core
```

After this, `wiki`, `wiki-mcp`, and `agent-launch` resolve globally:

```bash
wiki bootstrap --profile <profile>
```

A global install pins one version for the operator; prefer the devDependency
form (2) when a repo needs a version recorded in its lockfile.

## What Bootstrap Does

Bootstrap is **static seeding only**, run once by an operator from the new repo
root. In one command it:

1. Seeds the wiki core surfaces when missing (`wiki/schema.md`,
   `wiki/conventions.md`, `wiki/index.md`, `wiki/catalog.md`, and the owned
   `IN-0001` adoption initiative), syncs the record templates plus the
   `wiki/templates/AGENTS.md.boilerplate.md` install helper for the operator's
   first-run `AGENTS.md` setup,
   seeds `docs/adoption.md` (the operator adoption guide) from a package template
   when missing — preserving a customized copy on rerun — and resyncs
   `wiki/.wiki-contract.json` while preserving local `vocab.topics.local` and
   `inference.paths` entries.
2. Generates the repo-local `wiki/.wiki-mcp.json` workspace declaration (schema
   `wiki-mcp-workspace.v1`) recording the repo alias and resolved root. This is a
   generated, gitignored local artifact — bootstrap regenerates it (root
   refreshed, operator alias preserved) on every run and never commits it.
3. Creates the local cache directories (`.cache/wiki-search/`,
   `.cache/repo-code-index/`) and adds idempotent `.gitignore` entries for them
   and for `wiki/.wiki-mcp.json`.
4. Builds the initial lexical search index at `.cache/wiki-search/index.json`.

For a research-corpus repo with extension namespaces:

```bash
npx wiki bootstrap --profile research --extensions organizations,people,themes,signals
```

Bootstrap is idempotent and non-overwriting: rerunning it preserves `IN-0001`,
seeded work records, and any repo-specific edits, and only fills in missing
bootstrap surfaces.

This is the single standard bootstrap path for a consuming repo: it makes the
lexical search index usable immediately, while the graph-backed code-index
sidecar build remains a separate follow-up step after the worktree is clean
again.

### Seed-Only Boundary

Bootstrap does **not**:

- create `AGENTS.md` (repo-local operating authority; adapt the bootstrap-seeded
  `wiki/templates/AGENTS.md.boilerplate.md` helper template and commit it
  yourself),
- write global MCP client config (bootstrap does generate the gitignored
  repo-local `wiki/.wiki-mcp.json` declaration — alias plus resolved root — but
  it does not edit `~/.codex/config.toml` or any global MCP client settings; see
  the MCP configuration pointer below),
- build the graph-backed code-index sidecar — after bootstrap has written its
  repo files, make the worktree clean again (for example by committing those
  changes) before running `wiki code-index build`; until then,
  `workspace_code_index_status` reports `staleness: missing`,
- run any readiness, dispatch, graph-impact, or coordination-preflight check
  against the target repo.

After seeding, the target repo owns running every adoption check itself from its
own context. The seeded `IN-0001` enumerates that adoption backlog. See
[docs/adoption.md](adoption.md) for the full seeded checklist and required next
steps.

## MCP Configuration

Point the MCP client at the installed `wiki-mcp` binary (or its module entry,
`node_modules/@agent-chassis/wiki-mcp/src/server.mjs`) inside the consuming repo.
This is a spawned-per-session `stdio` process — no port, no daemon, no hosted
service; the client launches it on demand.

The full client configuration shape, the workspace-alias precedence rules
(`WIKI_MCP_WORKSPACE_ALIAS`, `wiki/.wiki-mcp.json`, basename fallback,
`WIKI_MCP_REPOS`), the `wiki-mcp-workspace.v1` repo-local declaration, and the
fail-closed rules live in [docs/mcp-integration.md](mcp-integration.md). This
page only covers installing the tooling.

For supported environment and `.env` configuration keys (hosted-service,
role-selection, and MCP server keys), see [docs/env-reference.md](env-reference.md).

## CI Usage

In each consuming repo, run at minimum:

```bash
npm run wiki:sync-check
npm run wiki:lint
```

Optionally refresh the generated views and search index after wiki content
changes:

```bash
npm run wiki:generate
npm run wiki:build-search-index
```

`bootstrap` creates the initial search index on first setup;
`build-search-index` refreshes it when wiki content changes. The shared search
path is lexical-first and does not require embedding-model dependencies in
consuming repos.

## Updating Shared Tooling

To pick up a new release of the shared tooling, bump the dependency range (or
reinstall the global) and reinstall:

```bash
npm install
```

For a global install, rerun `npm install -g @agent-chassis/core`
to move to a newer published version. Zero-install
`npx -p @agent-chassis/wiki-cli@latest wiki ...` resolves the most recent
published CLI for bootstrap-only use.

## Agent Role Commands

For operator-facing launcher entrypoints and role routing, see
[docs/agent-launch-quickstart.md](agent-launch-quickstart.md). This local-install
page only covers installing the shared tooling and pointing the MCP client at it.

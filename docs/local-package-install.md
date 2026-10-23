
# Local Package Install

This page covers installation options and CI usage. Start with the
[README installation steps](../README.md#install) for setup through the first
session. See [adoption and reruns](adoption.md) for existing guidance and state.

## Runtime Prerequisite

Install and select Node.js 24.20.0 or newer before installing or invoking any
`@agent-chassis/*` package.

The tooling is published as scoped npm packages under the `@agent-chassis`
scope. The supported operational install for a consuming repo is the
`@agent-chassis/core` package, which installs every binary and pulls in the
underlying surfaces:

- `@agent-chassis/wiki-cli`, which exposes the `wiki` binary.
- `@agent-chassis/wiki-mcp`, which exposes the `wiki-mcp` MCP stdio server.
- `@agent-chassis/agent-launch-cli`, the internal engine for the core-owned
  `agent-launch` entrypoint, including orchestrator launch, resume, and list
  subcommands. Only core exports the `agent-launch` npm bin.

Those packages in turn pull in their shared `@agent-chassis/*` dependencies
(`@agent-chassis/wiki-core`, `@agent-chassis/agent-launch-core`, and
`@agent-chassis/controlled-contract`) from the same registry. Controlled-contract
is installed transitively through wiki-core (and therefore through core). Individual surface packages are internal dependencies; core is the supported
operational installation.

Consumers importing controlled-contract directly should declare it directly:

```bash
npm install --save-dev @agent-chassis/controlled-contract
```

## Package Distribution

Packages are published to the public npm registry (`registry.npmjs.org`) under
the `@agent-chassis` scope. No scope registry mapping, `.npmrc`, or
authentication is required to install them: a plain `npm install` resolves them
from the default registry. The older "local `file:` checkout" model is retired.

## Registry And Auth Setup

Public packages install from the default npm registry without scope mapping,
private credentials or a CCE SDK. The free installation includes neither the
private provider nor its SDK. Shared compilation, ordinary authoring, readback,
assessment and mechanical tooling remain available without them.

Publishing (maintainers only) uses standard public-npm authentication and the
existing verified-archive release route.

### Private CCE installation

Install `@agent-chassis/cce` explicitly in the same serving installation to
supply paid capabilities. Its runtime SDK dependency belongs exclusively to
that private package. Obtain private installation inputs from their owner;
public package installation never fetches them. Installing those bytes grants
no CCE entitlement. See [paid capability recovery](paid-library-composition.md)
for missing-provider and dependency diagnostics and required restart.

Maintainer paid witnesses may use an explicitly supplied SDK tarball. The local
installation helper validates its real identity, exact version and bytes, then
stages it outside the public snapshot and installs it only with selected private
fixtures. Public snapshots and archives contain no private SDK input. This local
route establishes neither private registry availability nor redistribution
permission.

## Install Forms

Choose the form that matches how the consuming repo or operator works. The
repo-local devDependency install is the supported operational path.

### 1. Bootstrap-only zero-install with `npx`

For a one-off bootstrap on any repo, no install or `package.json` is needed —
`npx` fetches and runs the CLI directly:

```bash
npx -p @agent-chassis/core wiki bootstrap --profile <profile>
```

This can seed a fresh repository. The published bin is
named `wiki`, which does not match the package name, so the canonical zero-install
form must name the package with `-p @agent-chassis/core` and the bin `wiki`
explicitly. The bare `npx @agent-chassis/core <subcommand>` form is not a
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
detected Claude, Codex, OpenCode or Agy CLI, copies `agent-launch.toml` only when absent, runs
`npx agent-launch init-config`, and prints the remaining commands. It never
creates, reads, modifies, or deletes root `AGENTS.md` or `CLAUDE.md`. Follow the
[README guidance steps](../README.md#install) before staging: preserve existing
instructions, add only missing AgentChassis guidance, and add the Claude include
only if it is missing. See [adoption and reruns](adoption.md) for details.

Select explicitly with `--agent claude`, `--agent codex`, `--agent opencode` or
`--agent agy`. One detected CLI selects automatically; several prompt on a TTY.
Without a TTY, absent or ambiguous detection prints explicit choices and skips
the TOML copy. Explicit selection skips harness probes. `--dry-run` creates no
TOML; an existing file, including mixed-family roles, is preserved byte-for-byte.

The package ships all four templates. Registered examples are `opus` (Claude),
`gpt-5.6-sol` (Codex), `google-vertex/gemini-3.8-flash` (OpenCode, `medium`), and
`gemini-3.8-flash-low` (Agy, `low`). OpenCode and Agy templates enable
`high_priority_role_guide = true` for all four roles.

OpenCode needs `rg` on `PATH` and direct Vertex authentication via
`GOOGLE_APPLICATION_CREDENTIALS` in the launch environment, pointing at an
existing service-account JSON file with `project_id`. TOML
`[vertexai] credentials_file` alone does not configure that route. Agy needs its
installed, authenticated native `agy` CLI. OpenCode still refuses
schema-constrained workers (`opencode_native_schema_unavailable`); setup support
does not establish complete paid-CCE worker support.

Ordinary setup always calls `init-config`; the existing owner refuses an already
present registry. Setup does not force, reset or merge it. Keep it and use
`npx agent-chassis setup --test-runtimes` for the runtime step; TOML preservation
does not imply a successful full rerun.

Explicit setup installs and repairs root `.gitignore` rules for AgentChassis
local state: `/.agent-launch/`, `/agent-chassis-runtime.json`,
`/wiki/.wiki-mcp.json`, and these specific cache directories:

- `/.cache/repo-code-index/` (code-index sidecar)
- `/.cache/wiki-search/` (lexical search index)
- `/.cache/controlled-contract/assessments/` (assessment artifacts)
- `/.cache/controlled-contract/validators/` (compiled validators)
- `/.cache/test-proof-native/` (native proof compiler caches)

Bootstrap and `agent-chassis setup --test-runtimes` use the same updater.
Reruns restore missing rules, preserve existing content, and avoid duplicate
rules. Read or write failures fail setup with the `.gitignore` path and cause;
`--dry-run` writes no rules. Setup does not blanket-ignore `.cache/`, delete
state, or remove already tracked files from Git. Other consumer cache files
remain visible. Package manifests, lockfiles, and `node_modules` remain under
the consumer's own tracking policy. Package installation alone only prints
guidance and installs no ignore rules.

For standalone bootstrap or an intentional rerun, invoke the installed binary
through `npx` or an npm script:

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

Bootstrap is **static seeding only**. An operator can run it from a new or
existing repository root, including on reruns. In one command it:

1. Seeds the wiki core surfaces when missing (`wiki/schema.md`,
   `wiki/conventions.md`, `wiki/index.md`, `wiki/catalog.md`, and an in-progress
   `IN-0001` first-work placeholder as canonical
   `wiki/initiatives/IN-0001.json` with generated
   `wiki/initiatives/IN-0001.md`), syncs the record templates plus the
   `wiki/templates/AGENTS.md.boilerplate.md` guidance helper, and
   resyncs `wiki/.wiki-contract.json` while
   preserving local `vocab.topics.local` and `inference.paths` entries.
2. Generates the repo-local `wiki/.wiki-mcp.json` workspace declaration (schema
   `wiki-mcp-workspace.v1`) recording the repo alias and resolved root. This is a
   generated, gitignored local artifact — bootstrap regenerates it (root
   refreshed, operator alias preserved) on every run and never commits it.
3. Creates the local cache directories (`.cache/wiki-search/`,
   `.cache/repo-code-index/`) and installs the local-state `.gitignore` rules
   listed above, including launcher and runtime configuration state.
4. Builds the initial lexical search index at `.cache/wiki-search/index.json`.

For a research-corpus repo with extension namespaces:

```bash
npx wiki bootstrap --profile research --extensions organizations,people,themes,signals
```

This is the single standard bootstrap path for a consuming repo: it makes the
lexical search index usable immediately, while the graph-backed code-index
sidecar build remains a separate follow-up step after the worktree is clean
again.

### Seed-Only Boundary

Bootstrap does **not**:

- create, read, modify, or delete root `AGENTS.md` or `CLAUDE.md`,
- seed `WK-0001` or any adoption lifecycle,
- write global MCP client config (bootstrap does generate the gitignored
  repo-local `wiki/.wiki-mcp.json` declaration — alias plus resolved root — but
  it does not edit `~/.codex/config.toml` or any global MCP client settings; see
  the MCP configuration pointer below),
- build the graph-backed code-index sidecar — after bootstrap has written its
  repo files, make the worktree clean again (for example by committing those
  changes) before running `wiki code-index build`; until then,
  `query_code_index` with `status: true` reports `staleness: missing`,
- run adoption verification or any readiness, dispatch, graph-impact, or coordination-preflight check
  against the target repo.

After completing root guidance and launcher setup, follow the
[README](../README.md#install) to start your first session. New and existing
repositories use the same setup path; see [adoption and reruns](adoption.md)
for preserved state and refreshed files.

Setup does not automatically merge guidance or migrate arbitrary obsolete
AgentChassis state. Bootstrap preserves a valid canonical `IN-0001.json`, but
refuses an invalid record or an `IN-0001.md` projection without canonical JSON.
Follow the reported correction and the [migration policy](versioning.md#migration-expectations).

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
`npx -p @agent-chassis/core@latest wiki ...` resolves the most recent
published core package for bootstrap-only use.

## Agent Role Commands

For operator-facing launcher entrypoints and role routing, see
[docs/agent-launch-quickstart.md](agent-launch-quickstart.md). This local-install
page only covers installing the shared tooling and pointing the MCP client at it.

## Refreshing a repository checkout launcher link

After updating an existing workspace checkout that previously installed the
internal CLI's bin, refresh npm's link to core without running lifecycle scripts:

```bash
npm rebuild --workspace packages/core --ignore-scripts --offline --no-audit --no-fund
readlink -f node_modules/.bin/agent-launch
npx --no-install agent-launch --help
```

The resolved path must be this checkout's `packages/core/bin/agent-launch`.
This refresh uses the existing workspace installation and does not restore the
removed internal wrapper. A fresh consumer installation or `npm ci` creates the
core-owned link directly. Keep using `npx agent-launch` for operator commands;
the repository's `npm run agent-launch` script also enters the same core wrapper.

## Public artifact verification

The public snapshot and archive preparation inspect every emitted file, package
manifest and supported source map before use. Private source and documents are
checked even under renamed paths, in concatenated output, in generated copies,
and in inline or indexed source maps. Ordinary public availability and recovery
references remain usable. Malformed maps, escaping links, unreadable inputs and
unsupported source-bearing encodings cannot establish a verified artifact.

Content checks cover raw and scrub-normalized modules, complete documents and
substantive document passages. They do not establish detection of arbitrary
semantic rewriting or obfuscation. Installed checks must also inspect the actual
transitive package tree and execute the free consumer. Private local SDK composition provides paid-only evidence; it is never a free installation prerequisite.

Release preparation and local snapshot packing share one actual-archive verifier.
`--prepare` writes the snapshot, archives and report without publishing. Archive
destinations must be empty; existing contents are preserved and refused. For
`make pack-local-snapshot` or `make install-local-consumer`, set
`TARBALL_DIR=<new empty directory>`. For `tools/agent-chassis-release.mjs`, pass
`--tarball-dir=<new empty directory>`. To rerun the full `make release-preflight`,
select a fresh `SNAPSHOT_DIR`; its archive destination is derived from that path.
All seven archives must verify before publication begins; publication uses those
archive paths with lifecycle scripts disabled and rechecks each archive's digest
immediately before use. Changed or missing bytes stop the affected publication.
A later failure reports attempted and successful publications and unknown
registry effects; there is no automatic rollback or retry.

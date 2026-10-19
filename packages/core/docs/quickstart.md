# Quickstart

Start with the [README installation steps](../README.md#install). They cover
installation through the first interactive session. This guide explains setup,
model selection, and the execution prerequisites in more detail. It applies to
new and existing repositories; see [adoption and reruns](adoption.md) for
preserved state and migration limits.

## Prerequisites

- **Installation:** Node.js 24.20.0 or newer and npm. Run setup from a Git
  repository root. See [package installation](package-install.md).
- **Agent sessions:** an installed, authenticated Claude, Codex, OpenCode or Agy CLI with access
  to the models selected in `agent-launch.toml`.
- **Managed execution and setup's test-runtime probes:** a supported Linux
  isolation environment with usable `bwrap` (bubblewrap). Installing npm
  packages and running static bootstrap do not need it. See
  [sandbox prerequisites](#sandbox-prerequisite-bubblewrap).
- **Managed integration:** the Git executable used by the serving `wiki-mcp`
  process must support `git merge-tree --write-tree --merge-base` (Git 2.40 or
  newer). npm does not install or upgrade Git. See
  [the serving Git prerequisite](package-install.md#runtime-prerequisite) for
  executable selection and recovery.

## 1. Package access

Packages are published to the public npm registry under the `@agent-chassis`
scope. No scope registry mapping, `.npmrc`, or authentication is required — a
plain `npm install` resolves them from the default registry.

## 2. Install AgentChassis

From your repo root, install `@agent-chassis/core` as a dev dependency so it is
pinned in your lockfile and available to npm scripts and CI:

```bash
npm install --save-dev @agent-chassis/core
```

`@agent-chassis/core` is the normal public install package. It pulls in the
underlying surfaces and installs all the binaries you need:

- the `wiki` binary (bootstrap, validation, lint, generated views, code index,
  search), from `@agent-chassis/wiki-cli`.
- the `wiki-mcp` stdio MCP server that agents call for structured wiki,
  work-record, assessment and selected input-contract operations,
  from `@agent-chassis/wiki-mcp`.
- the `agent-launch` operator entrypoint for worker/review/redteam dispatch and
  orchestrator launch/resume (orchestrators are human/operator-launched), through the core-owned wrapper over
  `@agent-chassis/agent-launch-cli`. Core alone exports the `agent-launch` npm
  bin; the internal engine has no competing bin. The installed command enters
  `@agent-chassis/core/bin/agent-launch` and preserves its package-document
  composition for managed commands.

Wiki-core also installs the public, independently versioned
`@agent-chassis/controlled-contract` runtime transitively. If your code imports
that package or its exported schemas directly, declare it explicitly with
`npm install --save-dev @agent-chassis/controlled-contract`.

Individual surface packages are internal dependencies. Install core for supported
consumer operations; the separate controlled-contract library API remains
available to direct importers.

### Postinstall first-run guidance

When npm permits install hooks, `@agent-chassis/core` runs a postinstall guidance hook that
points at the explicit first-run setup command. It does not create files, run
bootstrap, write `agent-launch.toml`, run `agent-launch init-config`, build the
code index, launch an orchestrator, mutate MCP/client configuration, or fail the
install when detection cannot complete. An npm install-script policy may skip
this guidance hook; explicit setup below remains the first-run action.

After install, run the setup command from your consumer repo root:

```sh
npx agent-chassis setup
```

The setup command runs bootstrap, prompts or selects the launcher template for a
detected Claude, Codex, OpenCode or Agy CLI, copies `agent-launch.toml` only when it is absent,
initializes the launcher registry, detects local test runtimes as its last step,
and prints the remaining commands. Setup
never creates, reads, modifies, or deletes root `AGENTS.md` or `CLAUDE.md`.

Supported explicit choices are `--agent claude`, `--agent codex`,
`--agent opencode` and `--agent agy`. An explicit choice skips harness detection;
a single detected CLI is selected automatically. Several detected CLIs prompt
interactively; without a TTY, ambiguous or absent detection prints the explicit
choices and skips the TOML copy. `--dry-run` creates no TOML. Existing TOML,
including mixed-family roles, is preserved byte-for-byte.

OpenCode requires `rg` on `PATH` and direct Vertex authentication. Set
`GOOGLE_APPLICATION_CREDENTIALS` in the launch environment to an existing
service-account JSON file with `project_id`; OpenCode preflight consumes it.
TOML `[vertexai] credentials_file` alone does not configure this authentication
route. Agy requires its installed, authenticated native `agy` CLI.

Setup support does not change runtime qualification: OpenCode refuses
schema-constrained workers with `opencode_native_schema_unavailable`, so this
is not complete paid-CCE worker support. See [family runtime state](agent-launch-family-runtime-state.md).

Ordinary setup always calls `init-config`, whose owner refuses an existing
registry. Keep that configuration; setup does not force, reset or merge it.
Use `npx agent-chassis setup --test-runtimes` to finish or repeat the runtime step.
A preserved TOML does not establish full rerun success.

Complete root guidance manually before committing:

- Open `wiki/templates/AGENTS.md.boilerplate.md`. If root `AGENTS.md` is absent,
  create it from the template. Otherwise, add only missing AgentChassis guidance,
  keep existing content, and reconcile conflicting rules. Do not append the
  whole template again on reruns.
- For Claude, add `@AGENTS.md` on its own line in root `CLAUDE.md` only if that
  include is missing. Create the file if needed and keep all existing instructions.

Setup checks installed dependencies; it does not install them. Exit status `3`
means the earlier steps succeeded but test runtimes are unavailable or unresolved.
Follow the reported correction and rerun `npx agent-chassis setup --test-runtimes`.
A zero exit status also covers repositories with no test project; it does not
by itself prove runtime readiness. See [local runtime setup](local-test-runtime-setup.md).

## 3. Bootstrap the repo

```bash
npx wiki bootstrap --profile standard
```

Ordinary setup already runs bootstrap. Run this command separately only for
standalone bootstrap or an intentional rerun. It is
static seeding only — it writes local files and never calls a model, dispatches
an agent, or reaches an external service.

### What bootstrap creates

- `wiki/schema.md`, `wiki/conventions.md`, `wiki/index.md`, and the generated
  wiki views — your consumer-owned wiki contract surfaces.
- `wiki/initiatives/IN-0001.json` — the canonical `initiative.v1` in-progress
  placeholder for the first real work.
- `wiki/initiatives/IN-0001.md` — the generated Markdown projection of that JSON record.
- `wiki/templates/AGENTS.md.boilerplate.md` — directly appendable repository-policy
  starter. Generic role guides ship in `@agent-chassis/agent-launch-core` and
  reach sessions through launcher startup prompts.
- `wiki/.wiki-contract.json` — local contract metadata (your `vocab.topics.local`
  and `inference.paths` entries are preserved across reruns).
- `wiki/.wiki-mcp.json` — a gitignored local workspace declaration recording your
  repo alias and resolved root.
- `.cache/wiki-search/index.json` — the initial lexical search index.
- Root `.gitignore` entries for the generated caches and local-only artifacts.

Fresh bootstrap creates no `WK-0001` and leaves that identifier allocator-
eligible for the first real work record. It does **not** create root guidance
files, write global MCP client config, build the code index, or run an adoption
gate. See [adoption and reruns](adoption.md) for existing-state behavior.

Bootstrap reruns preserve valid operator-authored canonical state in
`IN-0001.json` and regenerate `IN-0001.md` from it. A projection-only legacy
initiative is refused with structured migration guidance rather than accepted
as canonical input.

## 4. Review and commit setup

After completing root guidance, review the resulting files:

```bash
git status --short
git diff
```

Stage only the setup files you intend to track, including your package manifest
and lockfile, wiki surfaces, root guidance, `.gitignore`, and `agent-launch.toml`.
Then commit:

```bash
git commit -m "set up AgentChassis"
```

Local runtime configuration, readiness history, and caches remain ignored. See
[local runtime setup](local-test-runtime-setup.md) for the exact rules.

A code index is not a free-tier authoring prerequisite. The agent-facing
`query_code_index` operation is paid-only. An operator may explicitly prepare the
committed-source index for index-dependent use:

```bash
npx wiki code-index build --json
```

Commit the intended source first: the index describes a captured committed tree,
not uncommitted edits. Index availability, coverage and freshness are separate
facts; building it grants no paid tool access or dispatch authority.

## 5. Wire an MCP client

For a standalone client, configure the installed core-owned `wiki-mcp` binary.
The client starts the stdio server and exchanges JSON-RPC over stdin/stdout;
starting it in a shell is not a health check. A standalone operator server does
not provide an orchestrator's managed dispatch backend.

Managed Codex and Claude sessions receive their wiki client registration from the
launcher. Their stdio connector reaches a launcher-owned host server through a
private Unix-domain socket; server code and dependencies remain on the host.
This is local transport, not HTTP/SSE or a shared daemon. See
[MCP integration](mcp-integration.md) and
[conduit lifecycle](agent-launch-mcp-conduit-lifecycle.md).

## 6. Configure role launch defaults

Role launch selection is model-first. Put each role's default model in the
committed repo config file, `agent-launch.toml`; the launcher derives the app
and backend from the neutral model registry. Do not set a parallel `<ROLE>_APP`
selector for normal operation.

```toml
[roles.orchestrator]
model = "gpt-5.5"
effort = "high"

[roles.worker]
model = "gpt-5.5"

[roles.reviewer]
model = "opus"

[roles.redteam]
model = "opus"
effort = "medium"
```

Each `[roles.<role>]` table must declare `model`. It may also declare `effort`
as `low`, `medium`, `high`, `xhigh`, or `max`. The config file is non-secret and
safe to commit. Keep `.env` only for secrets such as
`NODE_ENGINE_API_KEY`; role app, model, and effort defaults no longer belong
there.

Four templates ship under `@agent-chassis/core/templates/`:
`agent-launch.claude.toml`, `agent-launch.codex.toml`,
`agent-launch.opencode.toml` and `agent-launch.agy.toml`. Setup copies the chosen
package-local template to `agent-launch.toml` only when absent. The launcher
reads that active file, without auto-reading the templates.

| Family | Registered model example | Template effort |
| --- | --- | --- |
| Claude | `opus` | `medium` worker; `high` other roles |
| Codex | `gpt-5.6-sol` | `medium` worker (`gpt-5.6-luna`); `high` other roles |
| OpenCode | `google-vertex/gemini-3.8-flash` | `medium` all roles |
| Agy | `gemini-3.8-flash-low` | `low` all roles |

The OpenCode and Agy templates set `high_priority_role_guide = true` for every
role. Keep that setting for roles using those families, including mixed-family
configurations.

With no override, a role uses its default model from `agent-launch.toml`.
`--model` requires a registered model name: `gpt-5.6-sol` selects Codex, `opus`
selects Claude, `google-vertex/gemini-3.8-flash` selects OpenCode, and
`gemini-3.8-flash-low` selects Agy. App names such as `claude` are not model names, and the registry
supplies no app-default model. Unknown models refuse before spawn and list the
registered names. See the [operator reference](agent-launch-operator-entrypoints.md)
for advanced configuration and diagnostics.

Reasoning effort is role-neutral and resolved with this precedence:
`--effort`, then the role's `agent-launch.toml` value, then the registry default
for the selected model. The resolved value is recorded as launch configuration;
family-specific application is described in the
[operator reference](agent-launch-operator-entrypoints.md). In particular Codex
receives its reasoning-effort config override; this is not a guarantee about
the model's actual reasoning.

## 7. Drive orchestrators (operator step)

Orchestrator launch and resume are human/operator entrypoints — agents do not
launch them. With the packages installed, the repo bootstrapped, root
guidance completed and launcher config initialized, you (the operator) drive
work through orchestrators from your repo root:

```bash
# Start the first real work from committed first-run setup.
npx agent-launch orchestrator IN-0001

# Optional overrides still resolve through launcher model selection.
npx agent-launch orchestrator IN-0001 --model gpt-5.5
npx agent-launch orchestrator IN-0001 --model opus
npx agent-launch orchestrator IN-0001 --model gpt-5.5 --effort xhigh

# Resume an existing orchestrator session.
npx agent-launch resume IN-0001 --model gpt-5.5
npx agent-launch resume IN-0001 --model opus

# List orchestrator runtime records.
npx agent-launch orchestrator list --json
```

Orchestrator commands are **interactive**. They stay attached to your terminal
and remain running for the duration of the session; they are not fire-and-forget
background jobs. Attached does not mean hands-on, though: once launched, an
orchestrator routinely runs on its own for hours, dispatching and reviewing
successive units of work, and the attached session is there so you can watch
progress and step in — not because it needs constant input. The operator uses
the IN-0001 placeholder to define the first real work; the first allocated work
record may then be `WK-0001`.

### Sandbox prerequisite (bubblewrap)

Managed Codex and Claude sessions require a usable isolation backend and the
launcher-owned host MCP conduit. On supported Linux hosts, install bubblewrap
and ensure the launcher can create its required namespaces and mounts. A binary
on `PATH` alone does not establish usability; a missing required namespace or
conduit refuses launch. See [launcher setup](agent-launch-quickstart.md) and
[conduit diagnostics](agent-launch-conduit-diagnostics.md) for recovery.

An operator orchestrator can start without `bwrap` in direct mode, with a warning
that isolation is off. That does not make managed dispatch available. Local use
does not require a CCE key; removing a key or requesting an unenforced launch
does not provide missing execution capabilities. See the
[enforcement model](enforcement-model.md).

## 8. Prepare local test runtimes before execution

`verify_proof` runs saved native proofs for Node's test runner, Jest, Vitest,
Mocha, AVA, Deno, lib0/testing, pytest, stestr, go test and cargo test.
`workspace_run_test` runs selected ordinary tests. Both use an authenticated
host test capability with the host user's permissions, without bubblewrap.
Agent-session containment does not confine test side effects or network access.
Proof stages that transform source use temporary copies; ordinary tests use the
selected checkout and preserve its existing changes. This explicit host-test
exception does not apply to agent sessions or setup probes. See
[test execution](test-proof-execution.md).

Ordinary `agent-chassis setup` (step 2) already does this as its last step: it
inventories every test environment this repository's own manifests declare
(npm packages with their workspace members, Python projects, Go modules, Cargo
and Deno projects, in every language at once), locates each needed toolchain on
`PATH`, saves those locations in `agent-chassis-runtime.json`, and publishes
`.agent-launch/test-runtimes/readiness.json` with one ID per environment
(for example `npm@.` or `python@services/api`). Several environments and
runners are never a question; it asks only where a toolchain is installed when
`PATH` has none, and prints the exact option to pass when it has no terminal to
ask in.

To rerun only that step, run it from the repository root:

```sh
npx agent-chassis setup --test-runtimes
```

In that form setup finds the toolchains (Node, Python, Go, Rust/Cargo, Deno)
and each environment's dependencies that you installed, validates them against
the repository's pins and lockfiles, verifies them inside the sandbox and
publishes the same readiness record. It installs nothing: install or repair
what it reports missing with the ecosystem's own tools (for example `npm ci`,
`go mod download`) and rerun it. `--runner <name>[@<project>]` detects exactly
the named runners' environments instead; add `--dry-run` to see the inventory
and detection first. Rerun setup after changing a lockfile, toolchain pin,
installed dependencies or project layout; attempts report a stale-input
environment failure with this exact command until you do. See
[docs/local-test-runtime-setup.md](local-test-runtime-setup.md) for every
option and failure code.

## Where to go next

- Read the host-selected guide and authoring vignette named in the orchestrator startup instructions.
- [docs/package-install.md](package-install.md) — package and runtime detail.
- [docs/mcp-integration.md](mcp-integration.md) — MCP client wiring (reference).
- [docs/tool-discovery.md](tool-discovery.md) — which tools agents can call.
- [docs/work-record-ontology.md](work-record-ontology.md) — work-record schema
  and field semantics.

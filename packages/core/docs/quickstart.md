
# Quickstart

This is the canonical setup path for standing up AgentChassis in a repo. It
walks through the same install steps as the [README](../README.md), with a
little more explanation of what each step does.

By the end you will have: the `@agent-chassis/core` package installed, your wiki
contract surfaces seeded, a built code index, an MCP client able to launch the
`wiki-mcp` server, role-launch defaults in committed config, and the ability to
drive orchestrators.

## Prerequisites

- A normal Git repository.
- Node.js and npm.
- For scope-enforced agent dispatch: a supported isolation backend. On Linux,
  the recommended enforced backend is a usable `bwrap` (bubblewrap) binary on
  your `PATH`. This is needed only once you start dispatching role work (step
  7), not for install or bootstrap. See
  [Sandbox prerequisite](#sandbox-prerequisite-bubblewrap) below.

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
  work-record, dispatch-readiness, code-index, and tool-discovery operations,
  from `@agent-chassis/wiki-mcp`.
- the `agent-launch` operator entrypoint for worker/review/redteam dispatch and
  orchestrator launch/resume (orchestrators are human/operator-launched), from
  `@agent-chassis/agent-launch-cli`.

If you prefer to pin the underlying packages individually, you can install
`@agent-chassis/wiki-cli`, `@agent-chassis/wiki-mcp`, and
`@agent-chassis/agent-launch-cli` directly instead; see
[docs/package-install.md](package-install.md).

## 3. Bootstrap the repo

```bash
npx wiki bootstrap
```

Bootstrap is run once, from your repo root, after installing the packages. It is
static seeding only — it writes local files and never calls a model, dispatches
an agent, or reaches an external service.

### What bootstrap creates

- `wiki/schema.md`, `wiki/conventions.md`, `wiki/index.md`, and the generated
  wiki views — your consumer-owned wiki contract surfaces.
- `wiki/initiatives/IN-0001.md` — the owned adoption initiative.
- `wiki/work-records/WK-0001.json` — the adoption tracker.
- `wiki/templates/AGENTS.md.boilerplate.md` — a helper template you adapt into
  your repo's own root `AGENTS.md`.
- `docs/adoption.md` — a repo-adapted operator adoption guide (a customized copy
  is preserved on rerun).
- `wiki/.wiki-contract.json` — local contract metadata (your `vocab.topics.local`
  and `inference.paths` entries are preserved across reruns).
- `wiki/.wiki-mcp.json` — a gitignored local workspace declaration recording your
  repo alias and resolved root.
- `.cache/wiki-search/index.json` — the initial lexical search index.
- Root `.gitignore` entries for the generated caches and local-only artifacts.

Bootstrap is idempotent and non-overwriting: rerunning it preserves `IN-0001`,
seeded records, and any repo-specific edits, and only fills in missing surfaces.

Bootstrap does **not** create your root `AGENTS.md` (you adapt the seeded
boilerplate), does **not** write global MCP client config, and does **not** build
the code index — that is the next step.

## 4. Build the code index

```bash
npx wiki code-index build --json
```

The code index is **required for normal operation**, not optional. Normal
readiness, dispatch review, graph-impact queries, and review tooling depend on
it. Until it is built, `code-index status` reports `staleness: missing` and
dispatch/graph-impact routes degrade.

Run this after bootstrap, once the worktree is clean again — for example, after
committing the bootstrap output:

```bash
git add wiki docs/adoption.md .gitignore
git commit -m "bootstrap AgentChassis wiki adoption"
npx wiki code-index build --json
```

Also commit the install-step changes you intend to track, such as
`package.json` and `package-lock.json`.

## 5. Wire an MCP client

`wiki-mcp` is a stdio MCP server. You do **not** run it by hand: an MCP-capable
client launches it per session, speaks JSON-RPC over stdin/stdout, and
terminates it when the session ends. It binds no port and runs no daemon.
Because it waits on stdin, do not try to "health check" it by running it
directly in a shell — it will simply block.

Point your MCP client at the installed binary inside your repo. See
[docs/mcp-integration.md](mcp-integration.md) for the full client configuration
shape, workspace-alias precedence, and the agent-facing tool surface.

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

Two preset files ship as committed reasonable defaults:
`agent-launch.claude.toml` and `agent-launch.codex.toml`. They are examples to
copy from, not active secondary config files. To use one, copy it to
`agent-launch.toml`; alternatively, edit `agent-launch.toml` directly. The
launcher reads `agent-launch.toml` and does not auto-read the preset files or
choose a privileged family.

Legacy `.env` role keys are deprecation probes only. If `<ROLE>_APP`,
`<ROLE>_MODEL`, or `<ROLE>_EFFORT` is present, the launcher uses the value for a
diagnostic consistency check rather than as the source of truth. A legacy value
that disagrees with `agent-launch.toml` refuses before spawn with an actionable
error naming the stale key.

The resolver is mechanical and shared by role dispatch, MCP dispatch, and
orchestrator launch. With no override, the role uses its default model from
`agent-launch.toml`. An override token that is an app name selects that app's
registry-declared default model, so "run with claude" means the Claude app
default. An override token that is a model name selects that model and derives
the app, so "run with opus" derives Claude. Unknown apps or models refuse before
spawn and list the known app and model tokens.

Reasoning effort is role-neutral and resolved with this precedence:
`--effort`, then the role's `agent-launch.toml` value, then the registry default
for the selected model. The resolved value is recorded as launch configuration;
it is not yet applied to model thinking output.

## 7. Drive orchestrators (operator step)

Orchestrator launch and resume are human/operator entrypoints — agents do not
launch them. With the packages installed and the repo bootstrapped, you (the
operator) drive work through orchestrators from your repo root:

```bash
# Start an initiative orchestrator. The model or app override decides the app.
npx agent-launch orchestrator IN-0001 --model gpt-5.5
npx agent-launch orchestrator IN-0001 --model opus
npx agent-launch orchestrator IN-0001 --model claude
npx agent-launch orchestrator IN-0001 --model gpt-5.5 --effort xhigh

# Resume an existing orchestrator session.
npx agent-launch resume IN-0001 --model gpt-5.5
npx agent-launch resume IN-0001 --model opus

# List orchestrator runtime records.
npx agent-launch orchestrator list --json
```

The family-named orchestrator forms (`codex-orch`, `claude-orch`, their resume
variants, and the old `codex-orch-list`/`codex-orch-xhigh` forms) are removed
from the installed public/operator command surface: they are not `PATH` commands
and are not package `bin` entries. They are also removed from package source:
the family-named orchestrator forms are no longer kept as source or reference
files. Use the consolidated `agent-launch orchestrator`, `agent-launch resume`,
and `agent-launch orchestrator list` entrypoints with `--model` and `--effort`;
app selection is derived from the model registry instead of the command name.
`--model` accepts the same mechanical override token as dispatch: an app name
uses that app's registry default model, and a model name selects that exact
model.

Orchestrator commands are **interactive**. They stay attached to your terminal
and remain running for the duration of the session; they are not fire-and-forget
background jobs. Attached does not mean hands-on, though: once launched, an
orchestrator routinely runs on its own for hours, dispatching and reviewing
successive units of work, and the attached session is there so you can watch
progress and step in — not because it needs constant input. The orchestrator
drives `WK-0001` and dispatches scoped worker, reviewer, and redteam work — you
should not run individual slices by hand.

### Sandbox prerequisite (bubblewrap)

Structured worker, reviewer, and redteam dispatch is admitted from
launcher-owned backend selection and enforcement facts. When a supported and
enabled isolation backend is active for the launch, the run is recorded as
enforced with that backend. On Linux, the recommended enforced backend is
bubblewrap (`bwrap`); install a usable `bwrap` on your `PATH` for real
scope-enforced dispatch.

If no supported or enabled isolation backend is available for a structured role
launch, what happens depends on whether a Chassis Control Engine (CCE) key is
configured — this is the "can enforce" vs. "must enforce" split described in
[Enforcement posture](../README.md#enforcement-posture):

- **No CCE key:** dispatch may run **unenforced** as best-effort local
  execution. It is not silently degraded — the run is recorded honestly as
  `enforced: false` with `isolation_backend: none` and a loud warning, and
  admission gates that require enforcement can refuse it.
- **CCE key configured:** enforcement is required, so dispatch **refuses** unless
  the operator sets the explicit unsandboxed opt-out for that launch or launcher
  configuration. An opt-out run is still recorded as `enforced: false` with
  `isolation_backend: none`, tagged as an operator opt-out rather than a no-key
  fallback.

Either way, an unenforced run gives no containment guarantee; install a
supported backend such as Linux `bwrap` for real scope enforcement.

You do not need a CCE key for local AgentChassis use. A CCE key enables the
governed posture for private-beta users. Request access:
https://forms.gle/YBJc1TnxoEPea3kx6

The orchestrator process itself can still start when `bwrap` is unavailable, but
only in an unsandboxed **direct mode** that prints a loud warning that OS-level
isolation is off (the decision operator exception). Direct mode is not equivalent
to sandboxed scope enforcement; install `bwrap` for real isolation.

For the `bwrap` install recipe and the full isolation contract, see
[docs/agent-launch-quickstart.md](agent-launch-quickstart.md).

## Where to go next

- [docs/package-install.md](package-install.md) — package and auth detail.
- [docs/mcp-integration.md](mcp-integration.md) — MCP client wiring (reference).
- [docs/tool-discovery.md](tool-discovery.md) — which tools agents can call.
- [docs/work-record-ontology.md](work-record-ontology.md) — work-record schema
  and field semantics.

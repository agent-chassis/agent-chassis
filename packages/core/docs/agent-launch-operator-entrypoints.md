
# Agent Launch Operator Entrypoints

This page is the operator reference for the `agent-chassis` launcher: the
supported `agent-launch` role commands, the installed package `bin` entries, the
operator setup/cleanup and orchestrator entrypoints, and a migration note for
operators carrying old per-family wrapper scripts.

These are operator-shell commands for local debug and direct role smokes. **They
are not agent dispatch transport.** An agent session that needs to dispatch a
worker, reviewer, or redteam role uses structured MCP dispatch
(`workspace_agent_dispatch`) and reports the structured-transport blocker
(`missing_structured_transport`) if that route is unavailable.

For the short operator overview, see
[agent-launch-quickstart.md](./agent-launch-quickstart.md).

## Supported operator dispatch surface

The supported operator path for worker, reviewer, and redteam launches is the
`agent-launch` subcommand with an explicit `--app` flag:

```bash
agent-launch worker   --app <app> <unit>   # dispatch a worker
agent-launch review   --app <app> <unit>   # dispatch a findings-only reviewer
agent-launch redteam  --app <app> <unit>   # dispatch a findings-only redteam
```

`<app>` is `codex` or `claude` for supported launches, and `<unit>` is a
`WK-####[#slice]` address (or `IN-####` for an initiative-scoped redteam). AGY is
a roadmap/WIP family: keep AGY usage to planning or `--dry-run-json` validation,
not hardened support. Gemini has no supported operator path. `--spark` selects
the Codex Spark profile; `--dry-run-json` emits the structured plan without
launching.

```bash
agent-launch worker   --app codex  <WK-ID#slice>
agent-launch worker   --app claude <WK-ID#slice>
agent-launch worker   --app agy    <WK-ID#slice> --dry-run-json
agent-launch review   --app codex  <WK-ID>
agent-launch redteam  --app codex  initiative
agent-launch worker   --app codex  --spark WK-0001
```

## Migrating from old family-named wrapper scripts

Earlier launcher versions exposed per-family wrapper scripts (`codex-worker`,
`claude-review`, and similar). Those wrappers are no longer shipped: they are
absent from the `agent-launch-cli` package source and `package.json` `bin`, and
are not installed commands. If you have old operator scripts that call them,
replace each with the supported `agent-launch` command below.

| Old wrapper name | Supported operator command |
| --- | --- |
| `codex-worker` | `agent-launch worker --app codex <unit>` |
| `codex-worker-spark` | `agent-launch worker --app codex --spark <unit>` |
| `codex-worker-fast` | refusal-only — the Codex fast profile refuses before model launch (`agent-launch worker --app codex --fast` also refuses) |
| `codex-review` | `agent-launch review --app codex <unit>` |
| `codex-redteam` | `agent-launch redteam --app codex <unit-or-IN>` |
| `claude-worker` | `agent-launch worker --app claude <unit>` |
| `claude-review` | `agent-launch review --app claude <unit>` |
| `claude-redteam` | `agent-launch redteam --app claude <unit-or-IN>` |
| `agy-*` | roadmap/WIP — planning / `--dry-run-json` only |
| `gemini-*` | unsupported — no operator path |

## Package bin entries (operator install state)

The only commands declared in `packages/agent-launch-cli/package.json` `bin`
that resolve on the operator `PATH` after install are the launcher
infrastructure entrypoints below. No per-family worker/reviewer/redteam role
wrapper and no family-named orchestrator wrapper is declared in `bin`.

Installed operator commands:

- `agent-launch` — launcher operational entrypoint (setup, cleanup, dry-run
  planning, the canonical `worker`/`review`/`redteam --app <family>` role
  commands, and the model-driven `orchestrator`/`resume` operator commands).
- `agent-launch-filesystem-mcp-backend` — supporting filesystem-MCP backend
  endpoint; launcher infrastructure, not a model role.

No per-family worker/reviewer/redteam role wrapper, family-named orchestrator
wrapper, or other historical script is installed outside that `bin` map.

## Operator setup and cleanup

The `agent-launch` command is the operator operational entrypoint for setup and
cleanup. These are operator-shell forms; they are not dispatch transport and
must not be invoked from inside an agent session as a substitute for structured
MCP dispatch.

- `npm run agent-launch -- init-config` writes the default operator registry
  (first-time setup only; use `--force` only when intentionally replacing a
  stale local launcher config).
- `npm run agent-launch -- cleanup` removes stale local launch artifacts under
  `.agent-runs/` (local runtime state only; never committed).

## Operator orchestrator entrypoints

`agent-launch orchestrator`, `agent-launch resume`, and
`agent-launch orchestrator list` are the human/operator-only orchestrator
entrypoints, not worker/reviewer/redteam role paths. `agent-launch orchestrator`
and `agent-launch resume` read `--model` or `ORCHESTRATOR_MODEL`, derive the
app/family from the model registry, and accept `--effort xhigh` for the Codex
`orchestrator_xhigh` backend profile. `agent-launch orchestrator list` is the
read-only listing companion and supports `--json`. Agents must not launch
orchestrator sessions; structured agent dispatch refuses orchestrator launch
attempts from any role kind other than `human_operator` with the refusal code
`agent_dispatch_identity.orchestrator_not_operator.v1`.

## Non-role operator surfaces

`agent-launch` and `agent-launch-filesystem-mcp-backend` are the installed
launcher CLI and the supporting filesystem-MCP backend endpoint — launcher
infrastructure, not a model role. `codex-role` and `agent-role` remain internal
compatibility/helper surfaces referenced by dry-run and legacy planning code;
they are not the operator dispatch contract. For direct role smokes, operators
use `agent-launch ... --app <family>`; agents use structured MCP dispatch.

## Agent dispatch authority

The operator commands on this page are for local debugging. They are not agent
dispatch authority: WK-first implementation, review, and redteam work goes
through `workspace_agent_dispatch`, and an agent reports the
structured-transport blocker if that route is unavailable. Operator-shell use of
a command for local debugging does not establish agent-facing dispatch posture.

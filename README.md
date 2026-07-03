# AgentChassis

AgentChassis is an operating substrate for long-running coding agents where
orchestrators plan, dispatch, monitor, and close work, but are restricted from
**implementing work directly.**

An orchestrator plans an initiative, turns it into scoped work records,
dispatches workers against those records, and reviews results against written
acceptance criteria. Because implementation must pass through that loop, the
repo accumulates a durable knowledge graph as a byproduct of normal execution:
contracts, scopes, validation, reviews, decisions, provenance, and closure state.

AgentChassis turns agent work into durable engineering state: agents work from
scoped contracts instead of chat history; interrupted work resumes from the
record alone; reviewers check the diff against written acceptance criteria;
parallel agents stay on non-overlapping surfaces; every contract, decision,
review, and run becomes part of a durable linked record of the repo's
engineering knowledge.

The free local tier gives you the working system: structured wiki, scoped work
records, digest-bound review records, dispatch-readiness checks, structured-run
admissibility, honest enforcement-state provenance, graph-backed repo context,
an MCP server agents call, and an operator launcher for orchestrators. Role
dispatch is enforced when a supported isolation backend is active and runs with
honest provenance when it is not; a configured CCE key decides whether an
unenforced run is allowed to proceed — see [Enforcement posture](#enforcement-posture).
Install the core npm package from the public npm registry (no `.npmrc` or auth
required), bootstrap once, build the code index, and drive orchestrators from
your repo.

The hosted **Chassis Control Engine** adds the governance layer for teams that
need policy outside the repo itself: remote admission, authorization, and signed
run attestation for agent work that must be allowed by org policy before it
runs.

## Why this exists

Long-running AI coding agents drift away from declared scope on multi-file work
([Evaluating Goal Drift in Language Model Agents, 2025](https://arxiv.org/abs/2505.02709)),
degrade as context grows
([Coding Agents are Effective Long-Context Processors, 2026](https://arxiv.org/abs/2603.20432)),
and still resolve fewer than half of long-horizon software-engineering tasks
([SWE-Bench Pro, 2025](https://arxiv.org/abs/2509.16941)).

Better prompts do not close that gap. Agent execution is non-deterministic and
path-dependent, so what an agent actually does at runtime cannot be fully
governed at design time by prompts or static access controls. Runtime-governance
research points to the same answer: enforce constraints on the execution path
itself, with pre-action gates and runtime monitors, rather than relying on
instructions or after-the-fact checks
([Runtime Governance for AI Agents: Policies on Paths, 2026](https://arxiv.org/abs/2603.16586);
[MI9: Runtime Governance for Agentic AI, 2025](https://arxiv.org/abs/2508.03858);
[SARC: Governance-by-Architecture, 2026](https://arxiv.org/abs/2605.07728)).

AgentChassis applies that principle to coding work: every unit has a written,
canonical contract; execution is contained to the declared scope; and the result
is reviewed against the contract. If work doesn't have a well-formed contract, 
it is rejected before any code is written. Unsupervised execution needs a boundary
regardless of how capable the model is.

## The core idea

AgentChassis makes disciplined agent work the default path.

The orchestrator is not a privileged coding agent. It does not edit product code
or improvise implementation from chat. Its job is to create and maintain the
work graph: split initiatives into scoped units, dispatch the right role, monitor
runs, record evidence, and route follow-up work.

That constraint is the product. It forces work to become explicit before it is
executed, reviewable before it is closed, and durable after the session ends.

## Enforcement posture

AgentChassis keeps two questions separate:

- **Can it enforce?** Backend availability decides whether AgentChassis can
  enforce scope locally. When a supported isolation backend (Linux `bwrap`
  today) is active, worker, reviewer, and redteam runs are contained to their
  declared write scope and recorded as `enforced=true`.
- **Must it enforce?** A configured Chassis Control Engine (CCE) key decides
  whether AgentChassis is allowed to continue when enforcement is unavailable.
  The CCE key does not add sandboxing capability — it selects the governed
  posture. Local/free use never requires a CCE key.

| Mode | No usable backend | Backend available |
| --- | --- | --- |
| **No CCE key** | Best-effort local execution: dispatch may run **unenforced**, recorded loudly as `enforced=false`, `isolation_backend=none`. | Enforced; `enforced=true`. |
| **CCE key configured** | Enforcement is required, so dispatch **refuses** unless the operator sets the explicit unsandboxed opt-out; either way provenance records `enforced=false`. | Enforced; `enforced=true`. |

Every run records whether it was enforced and which backend, if any, was used.
Free/local mode never claims containment it does not have, and a CCE-key run
never silently degrades to unenforced. This is structured admissibility and
honest provenance, not a guarantee that a hostile or compromised agent is
harmless — see [docs/enforcement-model.md](docs/enforcement-model.md) for the
threat-model limits.

## Advantages of AgentChassis

- **A self-documenting execution loop.** Every implementation starts from a
  work record and ends in review/closure evidence, so the system builds the
  repo’s operational memory while work happens.
- **Orchestrators that coordinate instead of coding inline.** Planning,
  dispatch, review, and follow-up are separated from implementation, which keeps
  long-running sessions from becoming unreviewable chat-driven edits.
- **Parallel work with explicit ownership.** Units carry declared write scope,
  dependencies, validation, and review state, making concurrent agent work
  inspectable instead of implicit.
- **Unattended runs with explicit enforcement state.** Each contract declares
  its write scope, and supported worker, reviewer, and redteam launches enforce
  that scope when an isolation backend such as Linux `bwrap` is active. Every run
  records whether it was enforced and which backend, if any, was used, and every
  diff is reviewed against the contract before it lands. See
  [Enforcement posture](#enforcement-posture) for how backend availability and
  the CCE key interact, and [docs/enforcement-model.md](docs/enforcement-model.md)
  for the threat-model limits.
- **Malformed contracts refused before any model call.** A contract missing scope,
  acceptance, or validation is rejected at dispatch — a model-free, deterministic check
  that runs in milliseconds.
- **Parallel agents without collisions.** Disjoint write scopes let several
  agents work independent contracts on non-overlapping surfaces at the same
  time.
- **Reviews bounded by the spec.** The contract is the written spec and the diff
  is the result; reviewers verify the diff against the contract's scope and
  acceptance criteria instead of guessing at intent.
- **Work that survives stalls.** A failed or aborted run carries its full
  definition in the contract, so another agent or a human can pick it up from
  the record alone.
- **Institutional memory and change control by construction.** Every contract,
  decision, and run lands in the linked wiki, and the separation of design,
  execution, and review — each recorded and bound to a content digest —
  gives you an audit trail by default.
- **Agent-first interface.** Agents work through a structured MCP tool surface
  with built-in tool discovery, choosing tools from typed contracts instead of
  guessing from filenames or prose. The CLI is an operator fallback, not the
  primary path.
- **Model- and vendor-neutral.** One contract and one launcher drive multiple
  agent families (Codex, Claude, and more), so the substrate isn't tied to a
  single model or provider.

## Install and set up

First-time setup starts with the package install, then follows the detected
setup option printed by npm. For command details, see
[docs/quickstart.md](docs/quickstart.md).

### 1. Install AgentChassis

From your repo root:

Installed `@agent-chassis/*` package usage supports Node.js 22 or newer. Run the
install, bootstrap, wiki MCP, and agent-launch commands with a Node 22+ runtime.

```bash
npm install --save-dev @agent-chassis/core
```

`@agent-chassis/core` is the normal public install package. It provides the
`wiki` binary for bootstrap, validation, lint, generated views, and the code
index; the `wiki-mcp` stdio MCP server agents call for structured repo/wiki
operations; and the `agent-launch` human/operator entrypoint.

The package postinstall hook performs best-effort detection for supported local
agent CLIs (`claude` and `codex`) and prints only the matching setup choices. It
is guidance only: it does not run bootstrap, copy templates, create or modify
`AGENTS.md` or `agent-launch.toml`, initialize launcher config, build the code
index, launch an orchestrator, alter repo or client configuration, or fail
installation when detection fails.

### 2. Run first-time setup

Run the setup command from your repo root:

```sh
npx agent-chassis setup
```

The setup command runs bootstrap, asks for or detects the local agent family,
copies the matching launcher template when `agent-launch.toml` is absent, runs
`agent-launch init-config`, and prints the next code-index and orchestrator
commands. It does not copy `AGENTS.md`; review
`wiki/templates/AGENTS.md.boilerplate.md` and adapt it into this repo's root
operating contract before committing setup.

Bootstrap seeds the local wiki contract surfaces, the owned `IN-0001` adoption
initiative, the `WK-0001` adoption tracker, local cache directories, `.gitignore`
entries, the gitignored `wiki/.wiki-mcp.json` workspace declaration, and the
initial lexical search index. It is idempotent: rerunning preserves your edits
and only fills in missing surfaces. Bootstrap and postinstall do not execute
the setup commands: the operator creates or adapts `AGENTS.md`, copies or
reviews `agent-launch.toml`, and runs `agent-launch init-config` before the
first orchestrator launch. `agent-launch init-config` provisions the launcher
registry and role-guard secret that role dispatch requires.

The code index is required for normal operation. Normal readiness, dispatch
review, graph-impact, and review tooling depend on it. Build it after reviewing
and committing the bootstrap output. Root `AGENTS.md` and `agent-launch.toml`
are operator first-run prerequisites for `agent-launch orchestrator IN-0001`;
they are not worker-owned `WK-0001` setup slices. The first orchestrator launch
omits `--app`; family selection comes from the copied `agent-launch.toml` role
model unless an operator explicitly overrides it outside this setup flow. For
enforced Linux dispatch, put `bwrap` on your PATH. Whether a run without a usable
backend proceeds unenforced or refuses depends on whether a CCE key is configured
— see [Enforcement posture](#enforcement-posture),
[docs/quickstart.md](docs/quickstart.md), and
[docs/enforcement-model.md](docs/enforcement-model.md).

## Day-to-day operator commands

Run these from your repo root after installing `@agent-chassis/core`. These are
human/operator entrypoints — agents do not launch orchestrators. Orchestrator
commands are **interactive** and stay attached to your terminal until you end the
session — they are not background jobs. Attached does not mean hands-on: once
launched, an orchestrator routinely runs on its own for hours, and the attached
session is there so you can watch progress and step in, not because it needs
constant input.

```bash
# Start an initiative orchestrator (interactive; stays attached).
npx agent-launch orchestrator IN-0001 --model gpt-5.5
npx agent-launch orchestrator IN-0001 --model opus

# Resume an existing orchestrator session (interactive; stays attached).
npx agent-launch resume IN-0001 --model gpt-5.5
npx agent-launch resume IN-0001 --model opus

# List orchestrator runtime records.
npx agent-launch orchestrator list --json
```

## What AgentChassis provides

- wiki contract schemas, conventions, templates, and allocator-backed work
  records
- the `wiki` CLI for bootstrap, validation, lint, search, generated views, code
  index, and local wiki operations
- the `wiki-mcp` stdio MCP server for structured repo/wiki access,
  work-record operations, dispatch-readiness, tool discovery, code-index, and
  graph-impact queries
- the `agent-launch` operator entrypoint for orchestrator launch/resume/list and
  launcher-controlled worker, reviewer, and redteam sessions
- local execution control: write-scope derivation, backend-enforced sandboxing
  when available, CCE-key-driven enforcement requirements, explicit
  unsandboxed opt-out for CCE-key local runs, launcher environment policy,
  review handoffs, and runtime records

## What your repo keeps

- product source code
- repo-specific docs
- local `wiki/` work records, initiatives, decisions, and sources
- local schema extensions and repo policy
- package installation and MCP client configuration

## Distribution

AgentChassis is a public, source-available project (Elastic License 2.0).
The `@agent-chassis/*` packages are published to the public npm registry under
the `@agent-chassis` scope and install with a plain `npm install` (no `.npmrc`
or auth required). Package-specific README roadmaps are generated from canonical
work records and remain the active per-package roadmap source of truth.

## Roadmap

For live package detail, use the package READMEs generated from canonical work
records. Current release themes:

- macOS sandbox parity for filesystem-layer containment on non-Linux
  hosts.
- LLM-readable diagnostics and refusal messages that name the violated contract
  and the next action.
- drift-resistant tool-discovery and configurable local dispatch-readiness
  controls.
- hosted Chassis Control Engine admission and signed attestation for the private
  beta path.
- temporal-backed orchestration for managed parallelism, retries, cancellation,
  and recovery.

## Hosted tier (private beta)

The source-available AgentChassis tier runs locally without an account, API key,
or network service. It owns the workflow substrate: work records,
dispatch-readiness checks, structured-run admissibility, enforcement-state
provenance, review records, and repo-local policy. Local sandbox enforcement is
used when a supported backend is active; see
[Enforcement posture](#enforcement-posture) for how a configured CCE key governs
unenforced runs.

The **Chassis Control Engine** is the hosted governance tier. It makes remote
admission decisions against configurable org policy and returns signed run
attestations for approved agent work. The Chassis Control Engine is in private
beta. Teams that want remote admission, org policy, and signed attestation can
request access: https://forms.gle/YBJc1TnxoEPea3kx6

## License

Source-available under the Elastic License 2.0 — see [LICENSE](LICENSE).

## Documentation

Canonical, durable documentation lives under [`docs/`](docs/); per-package
roadmaps are generated into each package README.

### Getting started

- [docs/quickstart.md](docs/quickstart.md) — first setup walkthrough and the
  role-dispatch enforcement and opt-in posture.
- [docs/package-install.md](docs/package-install.md) — package roles and install detail
- [docs/local-package-install.md](docs/local-package-install.md) — installing
  the packages from a local build.
- [docs/adoption.md](docs/adoption.md) — adopting the contract in a new or
  existing repo.

### Operating and enforcement model

- [docs/operating-model.md](docs/operating-model.md) — the shared-substrate vs.
  local-repo boundary, and why this repo exists.
- [docs/enforcement-model.md](docs/enforcement-model.md) — the two-product
  enforcement posture, backend-enforced vs. unenforced run provenance, and the
  rationale behind it.
- [docs/versioning.md](docs/versioning.md) — the version stability contract.

### Agent interface

- [docs/mcp-integration.md](docs/mcp-integration.md) — wiring an MCP client over
  stdio.
- [docs/mcp-operation-reference.md](docs/mcp-operation-reference.md) — reference
  for the MCP operations agents call.
- [docs/tool-discovery.md](docs/tool-discovery.md) — how agents discover tools
  and the tool-authority vocabulary.

### Launcher and dispatch

- [docs/agent-launch-quickstart.md](docs/agent-launch-quickstart.md) — launcher
  and role-dispatch reference.
- [docs/agent-launch-operator-entrypoints.md](docs/agent-launch-operator-entrypoints.md)
  — operator entrypoints, with migration notes for retired wrapper scripts.

### Records and coordination reference

- [docs/work-record-ontology.md](docs/work-record-ontology.md) — work-record
  schema and field semantics.
- [docs/initiative-status.md](docs/initiative-status.md) — the coordinator
  triage lens over initiatives.
- [docs/areas.md](docs/areas.md) — area-based wiki structure.
- [docs/consumer-owned-docs.md](docs/consumer-owned-docs.md) — docs owned by the
  consuming repo.
- [docs/wiki-contract-metadata.md](docs/wiki-contract-metadata.md) — the
  `wiki/.wiki-contract.json` schema.

**Agents / agentic tools:** start at [docs/README-agents.md](docs/README-agents.md) for the retrieval order, rationale, and live per-package roadmaps.

## Further reading

- **Drift, context, and long-horizon limits:** [Evaluating Goal Drift in Language Model Agents, 2025](https://arxiv.org/abs/2505.02709), [Coding Agents are Effective Long-Context Processors, 2026](https://arxiv.org/abs/2603.20432), [SWE-Bench Pro, 2025](https://arxiv.org/abs/2509.16941)
- **Runtime governance:** [Runtime Governance for AI Agents: Policies on Paths, 2026](https://arxiv.org/abs/2603.16586), [MI9: Runtime Governance for Agentic AI, 2025](https://arxiv.org/abs/2508.03858), [SARC: Governance-by-Architecture, 2026](https://arxiv.org/abs/2605.07728)

# AgentChassis

**AgentChassis wraps an engineering process around the coding agents you already
use.** You keep Codex or Claude. What changes is everything around them: each
unit of work is written down as a contract *before* an agent implements it —
what the work is, which files it may read, which files it may change, what
success means, and how to check it — and a separate agent reviews the result
against that same contract.

Those contracts, the review findings, and the record of what actually ran stay
in your repository after the agent sessions end. Work that spans hours, many
files, or several agents no longer depends on one chat session remembering the
plan.

AgentChassis is not a coding agent and ships no model of its own.

## Who it's for

Engineers and teams already using Codex or Claude for nontrivial repository
work, who have hit the point where longer-running, multi-step, or parallel agent
work needs more coordination than a prompt and an unrestricted checkout.

It is deliberately not aimed at the five-minute, single-file, closely watched
edit. A single-shot coding assistant handles that fine, and AgentChassis would
only add setup. It earns that setup when work runs long, touches many files,
runs unattended, or runs several agents at once.

## What changes compared with using Codex or Claude directly

Four things move out of the model session and into the repository: **intent**
becomes durable, **scope** becomes declared, **implementation and review**
become separate roles, and **coordination evidence** is retained.

| Using a coding agent directly | With AgentChassis |
| --- | --- |
| Intent lives in the prompt and the evolving chat context | Intent is written into a repository-local contract before implementation |
| One session plans, implements, and decides it is done | Defining, implementing, and reviewing are separate roles with different authority |
| The agent works with whatever repository access its client gives it | Each unit declares what it may read and change; managed runs can be confined to that on a supported backend |
| A reviewer has to reconstruct what was meant | Review compares the exact change against the contract that predates it |
| Resuming means rebuilding lost context | The contract, findings, and run record outlive the session |
| Parallel work is coordinated informally | Declared scopes divide the files up front, and launcher-managed runs on a supported backend hold agents to that division |

Declared write scopes are how concurrent work is divided: each unit states which
files it owns before anything runs. On its own that is coordination, and it
binds only agents that respect it. It becomes enforcement on a
launcher-dispatched managed run with a supported containment backend, where an
agent cannot write outside its declared scope at all. Neither the coordination
nor the enforcement makes two independent changes semantically compatible with
each other — that is still a design and review question.

## Example: one bounded change

> **Illustrative only.** The walkthrough below is written by hand to show the
> shape of the workflow. No demo repository, fixture, or recording ships with
> AgentChassis today.

Say the request is:

> Add request-body validation to `POST /users`, with tests, without touching the
> other routes.

**1. The request becomes a written contract.** Before any implementation agent
starts, the work is written down. In plain terms:

```text
Work        Add request-body validation to POST /users

May read    src/users/**
            tests/users/**

May change  src/users/validation.ts
            tests/users/validation.test.ts

Success     - a request with an invalid email returns 400
            - requests that were valid before still succeed
            - no route other than POST /users changes behavior

Validate    run the declared user-route test target
```

That is a readable rendering. On disk the unit is a structured record with a
schema, an allocated identifier, and machine-checkable fields; see
[docs/work-record-ontology.md](docs/work-record-ontology.md) for the real shape.

**2. A readiness check runs before any model does.** AgentChassis checks the
unit structurally and against configured policy: is there a declared write
scope, are there acceptance criteria, is there something to validate against. A
malformed unit is refused deterministically, before an implementation model is
launched. This establishes structural and policy readiness only — it is not a
judgment that the task is correct, safe, complete, or permitted to land.

**3. A separate agent implements it.** The unit is the implementation agent's
contract; alongside it the agent receives its role instructions and the
repository context the unit declares. It does not inherit the conversation that
produced the unit, and it is given no repository context the unit did not
declare. On a launcher-dispatched managed run with a supported
containment backend active — Linux `bwrap` today — its repository visibility is
exactly the declared read and write paths, and it can write only the declared
write scope. Where no supported backend is in use, the run is recorded as
unenforced rather than represented as confined.

**4. A separate agent reviews the exact result.** The reviewer inspects the
committed change against that same contract and returns findings, ordered by
severity. It is a findings-only role: it does not edit the change and it does
not approve it. Findings are advisory evidence. Integrating the change,
admission through the hosted control plane, and publishing a pull request are
separate authorities, decided outside the review.

**5. The evidence stays in the repository.** The contract, its closure record,
the review findings, and the provenance of what ran — including whether the run
was enforced and on which backend — remain after every agent session has ended.

## The rule underneath it

**The agent that defines the work cannot implement it.**

Once the loop above is clear, so is the reason for the rule. If one agent may
define the work, do the work, and decide the work is finished, then scope,
success, and completion are all just that agent's opinion at the end of a long
session. Splitting those authorities is what makes the contract worth writing
and the review worth reading.

## Current status

AgentChassis is on the 0.6.x line and its interfaces are still moving.

- **License:** source-available under the Elastic License 2.0 — see
  [LICENSE](LICENSE).
- **Distribution:** the `@agent-chassis/*` packages are published to the public
  npm registry and install with a plain `npm install` — no `.npmrc`, scope
  mapping, or authentication.
- **Runtime:** Node.js 22 or newer.
- **Agent families:** Codex and Claude are the documented supported launcher
  families.
- **Filesystem containment:** Linux `bwrap` is the current backend, and
  containment applies to launcher-dispatched managed worker, reviewer, and
  redteam runs. Other execution is recorded as unenforced, never as confined.
- **Hosted governance:** the Chassis Control Engine is in private beta. Local
  use never requires it.
- **Migration tooling:** contract versioning is defined, but explicit migration
  commands are not implemented yet — see
  [docs/versioning.md](docs/versioning.md).

## Install

You need a Git repository, Node.js 22 or newer, and a local Codex or Claude
install. This fresh-install path assumes the repository has no existing root
agent guidance or AgentChassis adoption state; existing-repository adoption is
separate. From your repo root:

```bash
npm install --save-dev @agent-chassis/core
npx agent-chassis setup
```

`@agent-chassis/core` is the normal public install package. It provides the
`wiki` binary for bootstrap, validation, lint, generated views, and the code
index; the `wiki-mcp` stdio MCP server that agents call for structured
repository and coordination operations; and the `agent-launch` operator
entrypoint.

The package install only detects supported local agent CLIs and prints guidance;
it does not mutate repository or client configuration. `setup` runs bootstrap,
asks for or detects the local agent family, copies a launcher config template
when none is present, initializes launcher config, and prints the remaining
commands. It does not launch anything or create, read, modify, or delete root
`AGENTS.md` or `CLAUDE.md`. Run its two operator-owned guidance commands before
staging:

```sh
cat wiki/templates/AGENTS.md.boilerplate.md >> AGENTS.md
printf '@AGENTS.md\n' > CLAUDE.md
```

Fresh bootstrap seeds the wiki contract surfaces, an in-progress `IN-0001`
placeholder for the repository's first real work, local caches, the workspace
declaration, and the initial lexical search index. It creates no `WK-0001`; that
identifier remains available for the first allocator-backed work record. The
fresh path has no adoption-verification gate, AGENTS-authoring worker,
customization review, or other adoption lifecycle.

The code index is required for normal operation. Build it after committing the
bootstrap output and both operator-created guidance files. The first
orchestrator launch omits `--app`; family selection comes from
`agent-launch.toml` unless an operator explicitly overrides it.

The full first-run path — bootstrap detail, the required code index, MCP client
wiring, role model configuration, and the sandbox prerequisite — is in
[docs/quickstart.md](docs/quickstart.md).

## Running work

Orchestrator sessions are human/operator entrypoints; agents do not launch or
resume them. They are interactive and stay attached to your terminal, though
attached does not mean hands-on — an orchestrator routinely runs on its own for
hours, and the session is there so you can watch and step in.

```bash
npx agent-launch orchestrator IN-0001 --model opus
```

Model and effort selection, resume, run listing, and the rest of the launcher
surface are in
[docs/agent-launch-operator-entrypoints.md](docs/agent-launch-operator-entrypoints.md).

## Enforcement posture

Whether a managed run is actually contained turns on two separate questions.

- **Can it enforce?** When a supported isolation backend is active for the
  launch — Linux `bwrap` today — a launcher-dispatched worker, reviewer, or
  redteam run is contained to its declared scope and recorded as enforced.
- **Must it enforce?** A configured Chassis Control Engine key selects the
  enforcement-required posture. Without one, local use may proceed unenforced
  when no backend is usable. With one, dispatch refuses unless the operator sets
  an explicit opt-out. The key adds no sandboxing capability; it selects the
  posture.

Every run records whether it was enforced and which backend, if any, was used. A
run that was not enforced is recorded loudly as unenforced and is never
presented, labelled, or attested as confined.

This is contract enforcement and honest provenance, not a security guarantee.
The threat model is explicitly not hostile-agent security: the local mechanisms
keep an *honest* agent inside the lane its contract declared, and someone who
already holds your shell, filesystem, and credentials can defeat all of them.
[docs/enforcement-model.md](docs/enforcement-model.md) states the boundaries and
their limits.

## Local and hosted governance

Everything above is AgentChassis's local coordination and enforcement layer: it
runs on your machine and needs no AgentChassis account, API key, or hosted
service. The coding agents it drives are unchanged — Codex and Claude keep
whatever provider account and network access they already require.

The hosted **Chassis Control Engine** is a separate, private-beta layer for
teams that need central admission and audit across many repositories: it decides
whether a given piece of agent work may run at all, and returns a signed
attestation when it grants one. Signed attestation belongs to that hosted layer
alone — the local tier records enforcement state honestly but mints no signed
claim of its own. Request access: https://forms.gle/YBJc1TnxoEPea3kx6

## What stays in your repository

- product source code and repo-specific docs
- work records, initiatives, decisions, and sources under `wiki/`
- local schema extensions and repository policy
- package installation and MCP client configuration

## Why this exists

Long-horizon agent work is still hard, and not for the reason people usually
reach for. Evaluated language-model agents drift from the objective they were
assigned when they run long under competing pressures
([Evaluating Goal Drift in Language Model Agents, 2025](https://arxiv.org/abs/2505.02709)),
and on SWE-Bench Pro's long-horizon software-engineering tasks the evaluated
models stayed below 45% Pass@1
([SWE-Bench Pro, 2025](https://arxiv.org/abs/2509.16941)). Raw context length is
not the whole story: coding agents can mitigate ordinary long-context
limitations through tools and filesystem interaction
([Coding Agents are Effective Long-Context Processors, 2026](https://arxiv.org/abs/2603.20432)).
Holding an agent to a stated objective over a long run is the part that does not
come for free.

Better prompts do not close that gap. Agent execution is non-deterministic and
path-dependent, so what an agent does at runtime cannot be fully governed at
design time by instructions or static access controls. Runtime-governance
research points at the same answer: constrain the execution path itself, with
checks before the action and monitors during it, rather than relying on
after-the-fact review
([Runtime Governance for AI Agents: Policies on Paths, 2026](https://arxiv.org/abs/2603.16586);
[MI9: Runtime Governance for Agentic AI, 2025](https://arxiv.org/abs/2508.03858);
[SARC: Governance-by-Architecture, 2026](https://arxiv.org/abs/2605.07728)).

AgentChassis applies that to coding work: every unit has a written contract,
managed execution is contained to the scope that contract declared where a
supported backend allows it, and the result is reviewed against the contract.

## License

Source-available under the Elastic License 2.0 — see [LICENSE](LICENSE).

## Documentation

Canonical documentation lives in [`docs/`](docs/), indexed by
[docs/index.md](docs/index.md).

- **Set up:** [docs/quickstart.md](docs/quickstart.md) ·
  [docs/package-install.md](docs/package-install.md) ·
  [docs/adoption.md](docs/adoption.md)
- **Understand the model:**
  [docs/operating-model.md](docs/operating-model.md) ·
  [docs/enforcement-model.md](docs/enforcement-model.md) ·
  [docs/work-record-ontology.md](docs/work-record-ontology.md)
- **Operate:**
  [docs/agent-launch-quickstart.md](docs/agent-launch-quickstart.md) ·
  [docs/agent-launch-operator-entrypoints.md](docs/agent-launch-operator-entrypoints.md)
- **Agent interface:** [docs/mcp-integration.md](docs/mcp-integration.md) ·
  [docs/tool-discovery.md](docs/tool-discovery.md) ·
  [docs/mcp-operation-reference.md](docs/mcp-operation-reference.md)
- **Stability:** [docs/versioning.md](docs/versioning.md)

Agents and agentic tools start at
[docs/README-agents.md](docs/README-agents.md) for the retrieval order, repo
map, and live per-package roadmaps.

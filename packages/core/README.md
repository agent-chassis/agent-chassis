# AgentChassis

[![npm version](https://img.shields.io/npm/v/@agent-chassis/core)](https://www.npmjs.com/package/@agent-chassis/core)
[![Node.js 24.20.0 or newer](https://img.shields.io/badge/Node.js-24.20.0%2B-339933)](docs/package-install.md#runtime-prerequisite)
[![License: Elastic 2.0](https://img.shields.io/badge/License-Elastic_2.0-blue)](LICENSE)

**AgentChassis wraps an engineering process around the coding agents you already
use.** You keep Codex or Claude. AgentChassis adds written work contracts,
scoped execution, separate implementation and review, and a durable record of
the outcome.

When work spans hours, many files, or several agents, the plan needs to survive
the session that created it. AgentChassis keeps intent, decisions, and progress
in your repository so the next agent or engineer can pick up the work with its
context intact.

## Who it's for

Engineers and teams using coding agents for substantial repository work:
features, refactors, and changes that need several steps or contributors. It is
most useful when coordinating the work starts to demand as much attention as
writing the code. For a quick, closely watched edit, the setup may add little
value.

## How it works

You describe the objective to an orchestrator. It develops a plan, records the
design and decisions, and divides implementation into bounded units of work.
Each unit has a contract: what to change, which files the worker may read and
write, what success means, and how to validate it.

Workers implement those contracts. Separate reviewers examine the changes
against the intended result. The orchestrator coordinates dependencies, decides
how to address review findings, and records validation, completion, and remaining
work. Review findings inform those decisions; they do not themselves approve a
change or authorize it to land.

The repository holds the shared context: durable documentation under `docs/`
and work records, initiatives, and decisions under `wiki/`. This gives ongoing
work continuity across agent sessions and gives people a record they can inspect.

### A simple example

Suppose you ask:

> Add request-body validation to `POST /users`, with tests, without changing
> the other routes.

The orchestrator records a contract covering the users route and its tests:
invalid email addresses must return `400`, valid requests must still succeed,
and other routes must retain their behavior. A worker implements the change
and runs the declared checks. A separate reviewer checks the result against
that contract, and the orchestrator coordinates any required corrections.

The contract, review findings, and recorded outcome remain available after the
sessions end. This illustrative example shows the basic loop; larger changes
use multiple units with their own scopes and dependencies.

## Local use and hosted governance

AgentChassis runs locally without an AgentChassis account or hosted service.
Codex and Claude retain their own provider requirements.

On supported Linux managed runs, `bwrap` enforces declared repository read and
write boundaries. Runs without containment are explicitly recorded as
unenforced. Scope enforcement does not establish that a change is correct or
provide a hostile-agent security guarantee. See the
[enforcement model](docs/enforcement-model.md) for the exact boundaries.

The optional **Chassis Control Engine**, in private beta, adds central admission
policy and signed attestations for teams working across repositories.
[Request beta access](https://forms.gle/YBJc1TnxoEPea3kx6).

## Get started

You need a Git repository, Node.js 24.20.0 or newer, and a local Codex or Claude
installation. Begin with the **[quickstart](docs/quickstart.md)** for package
installation, repository setup, and your first orchestrator session.

Interfaces are still evolving. The documented setup path assumes no existing
root agent guidance or AgentChassis adoption state; adoption of repositories
with that existing state is deferred. macOS filesystem containment and explicit
contract migration commands are not yet supported. See
[adoption](docs/adoption.md) and [versioning](docs/versioning.md) for details.

## Learn more

- [Operating model](docs/operating-model.md) — how repository knowledge and work
  coordination fit together.
- [Operator guide](docs/agent-launch-operator-entrypoints.md) — launch, resume,
  and inspect sessions.
- [MCP integration](docs/mcp-integration.md) — connect agents to the structured
  repository tools.
- [Documentation index](docs/index.md) — the complete reference.

Agents start at [the agent guide](docs/README-agents.md) for retrieval order and
package roadmaps.

Source-available under the [Elastic License 2.0](LICENSE).

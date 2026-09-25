# AgentChassis 0.8.1

AgentChassis 0.8.1 improves prepared test environments, proof results, and managed work handoff.

**Released:** 2026-09-25

| Package | Version |
| --- | --- |
| `@agent-chassis/core` | 0.8.1 |
| `@agent-chassis/wiki-cli` | 0.8.1 |
| `@agent-chassis/wiki-core` | 0.8.1 |
| `@agent-chassis/wiki-mcp` | 0.8.1 |
| `@agent-chassis/agent-launch-cli` | 0.8.1 |
| `@agent-chassis/agent-launch-core` | 0.8.1 |
| `@agent-chassis/controlled-contract` | 0.8.1 |

## Highlights

- **Setup discovers the repository's test environments.** It inventories npm,
  Python, Go, Cargo, and Deno projects together, including workspace members and
  declared runners. It detects installed toolchains and dependencies and reports
  what needs repair without installing them.
- **Managed coding workers use prepared environments.** Workers receive the
  detected tools and dependencies for projects inside their declared scope.
  Missing or stale preparation and out-of-scope project inputs are reported
  before an affected worker starts.
- **Proof execution selects an exact environment.** Native tests route to the
  prepared environment that owns each target. A caller may name one environment
  for the full selection; an incompatible choice reports the affected proofs and
  valid choices without silently filtering the selection.
- **Test validity distinguishes limitations from counterevidence.** The current
  test-validity definition is 11.0.0. An unavailable mutation is reported as a
  capability limitation; an observed surviving mutation is counterevidence.
  Incomplete or unevaluable supported evidence remains not executable.
- **Proof results show the observed test and mutation outcomes.** New results use
  `proven`, `unproven`, and `not_executable`, with the selected test's status,
  mutation outcome, limitations, and actual diagnostic reasons available in
  compact summaries and retained detail.
- **Proof authoring separates meaning from execution readiness.** Source
  inspection can complete an authored verification claim without an executable
  proof route. Missing catalog support stays visible as route readiness rather
  than becoming an authored gap; invalid authored meaning still fails validation.
- **Proof discovery is easier to navigate.** Ranked search and catalogue pages
  carry exact counts and continuations, while detailed assertions and parameters
  remain available through selected reads. Wide results preserve a path to every
  omitted match or field.
- **Managed starts make their prerequisites explicit.** A first managed start
  requires a selected root base branch and a slice's own obligation bindings.
  Dispatch performs readiness itself; a separate validation call is optional.
  Refusals identify the exact record or slice to correct.
- **A completed work candidate can use more handoff destinations.** The same
  authenticated candidate supports local handoff, delivery to a selected Git
  remote, or hosted publication. Candidate construction is independent of
  whether the workflow selects a terminal review; landing status reports what
  happened without merging or completing work on its own.
- **Run status is smaller and more actionable.** Default status keeps the run,
  delivery, integration, candidate, proof outcome, and next action in a bounded
  answer. Complete historical evidence remains available through explicit
  detail reads, including after a server restart.
- **Role guidance ships with the packages.** Launcher startup prompts deliver
  package-owned guidance for the selected agent role, while a repository's
  generated agent file stays focused on local policy.

Internal module refactors; public import surfaces preserved.

## Upgrading

- Upgrade all seven `@agent-chassis` packages together to 0.8.1; internal
  dependency and peer ranges now target `^0.8.1`.
- Node.js 24.20.0 or newer remains required. Managed slice integration also
  needs Git with explicit-base `merge-tree` support (Git 2.40 or newer) in the
  serving process's environment.
- Run `agent-chassis setup --test-runtimes` after installing or repairing your
  project's tools and dependencies. Setup now detects and validates them; it
  does not install them. Refresh preparation after dependency or project changes.
- Refresh saved selections pinned to the retired test-validity 10.0.0 definition
  to select 11.0.0 explicitly. New proof results use the statuses above; retained
  historical results keep the statuses they recorded.
- Remove authored `gap` annotations and express inspection through the
  `inspection` verification method. Select a root base branch and author each
  managed slice's own obligation bindings before its first dispatch.

## Fixed

- An integration that already advanced Git now remains visible when its
  work-record update needs repair; later observation reconciles that record
  without applying the delivery a second time.
- Native proof observation better attributes selected-test failures across
  subtests, steps, repeated runs, and runner lifecycle hooks.
- Proof validation retains authored status and counts when an independent
  executable-map or diagnostic owner fails, instead of losing the semantic
  answer.
- Native proof failures preserve the actual execution stage, provider,
  selected-test observation, and actionable cause in their result and detail.
- Oversized proof and tool responses retain verifiable paths to omitted detail.

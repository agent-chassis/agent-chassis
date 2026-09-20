# AgentChassis 0.8.0

AgentChassis 0.8.0 expands native proof execution, repository code intelligence,
durable work material, and managed-run recovery while tightening supported contracts.

**Released:** 2026-09-20

| Package | Version |
| --- | --- |
| `@agent-chassis/core` | 0.8.0 |
| `@agent-chassis/wiki-cli` | 0.8.0 |
| `@agent-chassis/wiki-core` | 0.8.0 |
| `@agent-chassis/wiki-mcp` | 0.8.0 |
| `@agent-chassis/agent-launch-cli` | 0.8.0 |
| `@agent-chassis/agent-launch-core` | 0.8.0 |
| `@agent-chassis/controlled-contract` | 0.8.0 |

## Highlights

- **Native proof execution covers more test ecosystems.** Saved proofs can now run
  against Jest, Vitest, Mocha, AVA, Deno, lib0/testing, pytest, stestr, Go test,
  Cargo test, and Node's test runner through provider-owned observation.
- **Test runtimes are prepared before managed execution.** Setup can select test
  projects and toolchains, prepare lockfile-pinned dependencies, verify them inside
  the sandbox, and publish readiness without installing at dispatch time.
- **Proof packs have explicit parameter contracts.** Current profiles publish
  parameter schemas, evaluation-input templates, documentation, and exact digest
  bindings so required inputs are visible before a proof is saved or executed.
- **Saved proof meaning and execution stay bound together.** A test-execution claim
  and its definition are one publishable unit; verification retains the source,
  candidate, executed and skipped population, and provider result.
- **Repository code questions gain SCIP navigation.** The code index provisions
  applicable TypeScript and Python providers and adds definitions, references,
  callers, and callees with committed source and explicit freshness state.
- **Work records can retain reusable material.** Records and slices own versioned
  text entries, reference immutable versions from assignments, and retrieve or
  search bounded ranges without copying large bodies into every task.
- **Canonical reads and edits are more precise.** Selected fields, paged members,
  text references, task updates, and prose edits carry source digests and exact
  recovery calls instead of silently omitting required content.
- **Tool discovery is bounded and progressive.** Compact listings, recommendations,
  descriptor fragments, and paged guidance expose callable next steps while keeping
  large schemas available on demand.
- **Managed runs have stronger identity and recovery.** Dispatch binds explicit
  slices, worktrees, process identities, frozen assignments, and commits; monitoring
  can recover durable reports and proof-verification journals after restarts.
- **Completion and publication use exact candidates.** Closeout reports checks that
  actually ran, while terminal candidate construction, conditional review, and forge
  handoff preserve reviewed bytes without implying merge authority.
- **The supported contract surface is current-only.** Experimental carrier,
  migration, compatibility-capture, and projected-selection APIs are removed; stable
  v1 authoring and current proof-pack identities reject obsolete or mixed inputs.
- **JUnit report parsing is available as a package API.** Agent-launch core exposes
  an asynchronous JUnit/XUnit XML parser with a documented result shape and typed
  parse errors.

Internal module refactors; public import surfaces preserved except for the explicitly
removed obsolete contract and compatibility surfaces described above.

## Upgrading

- Upgrade all seven `@agent-chassis` packages together to 0.8.0; internal dependency
  and peer ranges now target `^0.8.0`.
- Node.js 24.20.0 or newer is required. Upgrade before installing or invoking 0.8.0.
- Rerun setup to prepare local test runtimes before native-proof verification and
  whenever a selected lockfile or toolchain pin changes.
- Replace experimental contract families, migration helpers, compatibility capture,
  integration-prefix compatibility, projected selection, and other removed legacy
  APIs with stable v1 and current proof-pack surfaces. No adapter is provided.
- Managed implementation dispatch requires an explicit existing slice address; a
  bare work record does not launch as an implicit slice.

## Fixed

- Proof discovery and bounded reads retain complete match, omission, source, and
  continuation metadata through compaction and pagination.
- Restart recovery exposes a final report only when the complete result was durably
  recorded; partial receipts are not reconstructed into success.
- Worktree provisioning and cleanup preserve exact ownership and process identity,
  reducing stale reservations and ambiguous retries after interruptions.
- Proof failures distinguish missing runtimes, stale dependencies, unsupported
  native instrumentation, and provider errors.
- Bootstrap reruns preserve canonical initiative state and regenerate its projection;
  projection-only legacy state is refused with migration guidance.
- MCP spill and continuation paths disclose persistence, truncation, and stale-source
  failures instead of returning incomplete successful reads.

AgentChassis 0.12.0 adds typed behavioral specifications, explicit assignment correction, broader agent support, and code indexing of the working checkout, while tightening the limits of proof claims.

### Controlled specifications and proof meaning

Specifications can define typed values and constrain operation arguments, results, state snapshots, events, and timing. Structured records, lists, maps, arithmetic, conditional expressions, and scoped iteration make output shapes and relationships expressible without naming an implementation symbol. Definitions carry no normative force by themselves. Generated CEL preserves distinctions such as absent versus null and integer versus floating-point values; incomplete definitions or unsupported lowering withhold complete compilation. Compilation does not execute the specification or establish that runtime observations are complete.

Authoring and reading now expose focused requirement rows, verification meanings, and definition dependencies. Selected schemas include recursive value shapes, and save receipts preserve the issued identities needed for dependent edits. Source-passage repairs and quantified-definition corrections retain the authored meaning and provenance rather than reconstructing associations from row order.

Test-validity advances to **12.0.0**, with a dedicated definition for authenticated execution of a selected native test. It preserves the authored requirement, verification, and falsification meanings without imposing an unrelated graph pattern. Passing execution, mutation detection, and traversal evidence do not establish assertion-to-requirement adequacy or earn requirement-satisfaction credit.

Generic assessment now reports unsupported source-backed guarantees with zero credit where it only matches declarations. This affects capture-dependent claims including behavioral preservation, provenance, pagination, policy checks, and integration-prefix census. Other assessments continue, but declaration matches cannot complete those guarantees. The separate supplied-report checker now names its bounded comparison of populations, counts, and one selected value pair; it does not establish full-report equality or general behavioral equivalence.

Lossless projection and cross-representation parity advance to **5.0.0**. Parity explicitly concerns declared populations and a selected value pair, excluding actual report comparison. Retired proof selections are refused; owners must explicitly select current definitions and address their changed contracts. Saved pins are not automatically upgraded.

### Assignment correction and delivery

Workers can hand back a missing or contradictory assignment through an explicit correction request. Once accepted, the launcher ends that worker attempt and preserves its partial work and completed/remaining-work testimony. The coordinator can correct the assignment and separately authorize continuation; editing the canonical record does not alter a running worker's frozen instructions or scope.

Launch preparation checks assignment inputs before allocation and settles failures against the exact attempt, preserving concurrent work. Delivery inspection, integration, and result observation expose their distinct outcomes; reading a result no longer retries integration recovery. Lost creation or save acknowledgments can be inspected through retained operation outcomes without replaying the mutation or guessing issued identities.

### Native tests and runtime setup

Ordinary test execution now runs literal repository commands. Worker commands and their listed definition files are frozen with the assignment; other execution roles supply an explicit command and working directory. Eligible failures can compare the same command against an authorized baseline, including an exact immediate-parent checkout when needed. A matching baseline failure does not establish that the failure predates the task.

Runtime setup selects environments from repository test evidence while respecting explicit choices and native project layouts. Failure answers prioritize the selected test's captured cause and useful corrections, keeping failed execution distinct from timeout, interruption, unavailable comparison, and uncertain completion. Ordinary test success grants no controlled proof credit.

### Code indexing

Indexing now uses the working checkout, including admitted edits and untracked source, rather than requiring committed snapshot bytes. Queries use the last usable publication while refresh runs separately. Source reads verify content against the indexed descriptor, so changed text is reported as unavailable for that indexed location instead of being attributed to old occurrences. Unverified freshness and incomplete semantic coverage remain explicit.

The index updates one SQLite database transactionally with WAL readers, replacing full-database publication copies. A provider-qualified definition lookup selects relevant documents before decoding their payloads. Nested TypeScript/JavaScript configurations and references share native indexing work; Python project discovery respects native package boundaries, and Rust uses private Cargo configuration scratch without rewriting checkout lockfiles. Missing project inputs or toolchains retain qualified coverage alongside usable siblings. Impact results drop basename and directory guesses in favor of evidenced relationships.

### Agents, setup, and guidance

OpenCode and Agy gain managed execution adapters, orchestrator start and exact-session resume, packaged setup templates, and native usage capture. Their adapters compose the shared assignment, role, conduit, isolation, and result owners. Native model, result-mode, credential-refresh, and long-session qualifications remain client-specific; adding a setup template does not establish every execution mode.

Orchestrator guides and authoring examples are generated for the serving host's capability profile, with configurable high-priority role-guide delivery. Task answers emphasize useful outcomes and selected semantic detail, with nested authoring schemas available when needed. Setup preserves existing agent guidance and launcher configuration and adds targeted ignores for host-local runtime state. Agents can also record local advisory feedback about confusion, unavailable capability, and input/output waste without making feedback a prerequisite for their work.

### Release metadata

- Date: 2026-10-19
- Public Git tag: `0.12.0`
- All seven packages at `0.12.0`: `@agent-chassis/controlled-contract`, `@agent-chassis/wiki-core`, `@agent-chassis/agent-launch-core`, `@agent-chassis/wiki-cli`, `@agent-chassis/agent-launch-cli`, `@agent-chassis/wiki-mcp`, and `@agent-chassis/core`.

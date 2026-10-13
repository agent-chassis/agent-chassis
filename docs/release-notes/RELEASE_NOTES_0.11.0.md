AgentChassis 0.11.0 expands controlled specification authoring, regression verification, and execution across repository dependency layouts.

### Controlled specifications

Requirement authoring now saves batches of named entities, statements, closed memberships, collections, and unresolved meaning. The compiler derives canonical constraints, readable descriptions, and CEL predicates from the saved grammar. Referenced objects resolve through specification definitions or explicit code references; missing definitions and unfinished statements keep the specification incomplete. Compilation and retirement require the serving host's paid tier, and authoring executes neither CEL nor proofs.

Requirements can retain links to exact passages of the work item's user requirements, with stale links reported after the source changes. Selected reads preserve the definition and permission context needed to interpret the assigned requirements. Authoring schemas and guidance are available by job and selected member, reducing the material needed for a focused edit.

Proof declinations, grammar exceptions, and whole-unit controlled-acceptance exemptions now use a separate deliberate exception request with an authored rationale. Ordinary edits no longer carry those decisions. Exceptions remain visible in assessment, grant no proof credit, and do not establish eligibility or completeness.

The grammar accepts `MUST`, `MUST_NOT`, and `MAY`; unsupported behavioral relations are refused with their available choices. The forbidden-operation noninvocation proof advances to 5.0.0 and tests calls by the declared subject within its context against a complete forbidden-operation population. Saved 4.0.0 selections require explicit refresh; the changed guarantee does not establish unmodeled dynamic calls or production call-graph discovery.

### Tests and execution

- Slices can declare regression test files that verification runs beside their saved proofs. Results are retained separately: a regression failure can prevent a satisfied aggregate, while a passing regression grants no controlled proof credit.
- Ordinary test requests accept one glob matching several files. Retained results provide bounded outcome, failure, stdout, and stderr views, with individual failed results selectable directly. Refusals distinguish request corrections from repairs to missing toolchains or dependencies.
- Dependency handling preserves npm and pnpm workspace layouts, member-local module trees, and declared local package links. Python discovery recognizes `setup.py`, `setup.cfg`, and `requirements/test.txt`; Go execution respects `go.work`; Deno setup respects configured or disabled locks. Setup detects installed environments without installing dependencies or toolchains.
- Native proof observation consumes events incrementally and aggregates function reach observations, while preserving attempt authentication and lifecycle checks. Loader and source-copy fixes cover framework observers and dependency mappings in transformed proof copies.
- Public snapshot test selection retains the classifier's own regression suite, and the packaged documentation index drops a link to unshipped maintainer tooling.

### Indexing and publication

Code indexing can publish partial Go and Rust coverage when dependencies are unavailable, carrying the limitations into queries so an unresolved answer is not an authoritative no-match. Go indexing selects the installed toolchain required by the project, and TypeScript indexing includes installed packages needed by its committed configuration chain.

Publication persists newly saved proof-authoring sources before selecting its candidate and can refresh the existing handoff after that candidate changes. Repeated publication and integration recovery preserve the recorded delivery and publication identities. Launcher fixes also align Codex usage capture with its client home and configure stream retries for routed LiteLLM clients.

### Release metadata

- Date: 2026-10-13
- Public Git tag: `0.11.0`
- All seven packages: `@agent-chassis/controlled-contract`, `@agent-chassis/wiki-core`, `@agent-chassis/agent-launch-core`, `@agent-chassis/wiki-cli`, `@agent-chassis/agent-launch-cli`, `@agent-chassis/wiki-mcp`, and `@agent-chassis/core` at `0.11.0`.

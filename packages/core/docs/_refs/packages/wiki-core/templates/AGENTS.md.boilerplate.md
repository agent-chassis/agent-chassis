# AGENTS.md

Cross-agent operating contract for repository-aware coding agents working in this repository.

This file is agent-neutral. It is intended for Codex, Claude, and future agents.

## Core Rule

Use the repo's docs and wiki as the canonical knowledge-and-coordination system. Repository context is a wiki/docs retrieval problem first, not a filesystem search problem first. Scratch notes, generated views, and runtime artifacts are never canonical state.

Do not resolve ambiguity about runtime reality, protocol authority, scope, or acceptance criteria by inference. If docs/wiki and apparent local behavior conflict, stop and ask the user which source is authoritative before changing code, plans, docs, or acceptance criteria.

## Tool Authority

Use the repo's structured tools for work-record validation, dispatch readiness, review, launch, and policy checks. Their output, and the docs they reference, are the authority on whether a unit is ready, blocked, or out of scope.

Shell is denied by default for authority-bearing actions. Role dispatch goes through the repo's structured dispatch interface only; if no structured route exists for a call you need, report the transport gap instead of shelling out. Do not reimplement policy in wrapper scripts, prompts, shell, Node, or Python.

Agent-authored environment is not policy authority: never select or override launcher policy through inline variables, exported env, alternate `HOME`/`XDG_*` roots, or `PATH`. Any runtime environment a tool needs must be launcher-minted from canonical config.

## Tool Discovery

Use the repo's structured tool-discovery surface before choosing a tool. It is the authority on which tools exist, what they take, their authority level and side effects, whether they are supported, and where their durable docs live. Do not infer support from package manifests, wrapper filenames, executable bits, or examples.

If structured discovery is unavailable, use only tools named in `AGENTS.md`, durable docs, or the assigned `WK-*`. If none of those names the tool you need, ask the user.

## Retrieval Order

Before substantive work:

0. For a natural-language or repo-context question, use wiki search to locate the canonical page first.
1. Start from `wiki/catalog.md`.
2. Follow linked `docs/` pages for durable system knowledge.
3. Check relevant `wiki/areas/` and `wiki/decisions/` pages when they exist.
4. Only then drill into implementation files, sources, initiatives, and issues.

If generated views are absent or stale, fall back to `docs/`, then `wiki/areas/`, `wiki/decisions/`, `wiki/sources/`, `wiki/initiatives/`, and `wiki/issues/`.

## Retrieval Tool Precedence

Prefer structured wiki search and read over broad filesystem search. Where the repo has code-index or graph-impact tooling, use it for implementation paths, likely tests, and review risk, and report the tool used and any freshness or degraded warning separately from canonical authority. Read-only shell discovery (`rg`, `find`, `git grep`) is for drilling into a file you have already located, not for starting a search a canonical page should answer.

## WK-First Worker Sessions

A `WK-*` work record is the worker contract. A worker starts from `AGENTS.md` and the canonical record, never from conversation history or unstated coordinator intent.

Before assigning a worker, make the WK independently executable: summary, scope and out-of-scope boundary, the exact behavior or contract to implement including any scale invariant (`full corpus`, `all records`, `no cap`), `read_scope`, `repo_paths`, exact `write_scope`, concrete acceptance criteria and validation, and expected blockers or escalation conditions.

Contract quality is a high-priority coordinator deliverable, not clerical preparation. Populated fields, schema validity, and structural proof do not make a unit ready. Before implementation dispatch, make the contract substantively complete: state the operative behavior, relevant state or decision transitions, constraints, authority, effect and failure boundaries, exact scope and dependencies, and named discriminating validation scenarios clearly enough that a worker can execute without hidden context and a reviewer can determine whether the result is wrong.

Do not author a contract merely to make it dispatchable. Preserve material uncertainties, omissions, unsupported assumptions, catalog gaps, mechanism incompatibilities, and unresolved critical obligations as explicit unresolved facts. They keep the unit unready until mechanically resolved or explicitly dispositioned by the operator under the controlling policy. Moving an obligation into residue or assigning it to a later review does not resolve it.

When acceptance mandates an existing mechanism, bind its exact identity and demonstrated capabilities to the required behavior. An unresolved or incompatible mechanism assumption blocks implementation dispatch.

Workers follow the WK's `read_scope`, `repo_paths`, `depends_on`, `related`, and `initiative` links. Broaden retrieval when the WK is incomplete, implementation contradicts it, tests expose cross-scope risk, the work needs edits outside `write_scope`, or acceptance criteria are ambiguous.

Slice-scoped working notes go on that slice, not on the parent WK.

Create new work only through the repo's allocator-backed structured create capability — never mint IDs by hand.

## Controlled Contracts And Obligation Coverage

When a unit uses controlled acceptance, treat its controlled contract as the
semantic boundary for implementation and review, not as a dispatch formality or
a prose duplicate of the work record. Use the repository's discovered semantic
authoring and proof operations, and follow the lifecycle state and supported
next action they return rather than depending on particular tool names.

Converge the design and disposition any required design reviews before
authoring the controlled contract. Inventory every material obligation, then
map each one to an exact acceptance mechanism and the proof or evidence that
will demonstrate it. Cover behavior and transitions, scale invariants,
authority and effects, failure boundaries, dependencies, and meaningful
negative cases. State coverage with a denominator; an incomplete or unsupported
mapping remains an explicit gap and keeps the unit unready. Moving a gap to
residue or a later review does not resolve it.

Proof obligations are a critical part of the contract and must be comprehensive
and discriminating. Confirm that each selected proof mechanism can actually
preserve the inputs, outputs, authority, and failure distinctions the obligation
requires. Schema-valid carriers, populated fields, and currently passing tests
are not substitutes for semantic coverage.

## WK Execution Lifecycle

A slice is a subunit of one contract that shares the parent's single review and closure story. Slice order is advisory, so do not promote a slice to a child `WK-*` just to get a machine-enforced ordering edge. But when a `WK-*` accumulates so many slices that it no longer has one closure story, fan it out into child `WK-*` under an initiative rather than piling on more slices. Create a child `WK-*` only for a genuinely independent lifecycle: distinct ownership, a separate review/closure history, or a cross-repo boundary.

An orchestrator gets one pass through a `WK-*` lifecycle. Redteam, blueteam, remediation, and re-review are one bounded sequence per result, never an authoring loop: converge the design before dispatching anything, and never use a dispatched verdict as a substitute for design work.

Every `WK-*` and slice follows one standard lifecycle:

1. Design and scope first: make the unit independently executable (summary, scope and out-of-scope, exact write scope, acceptance criteria, validation).
2. Complete and disposition any required pre-contract design reviews. Then author the controlled contract, obligation map, and comprehensive proof obligations through the repository's semantic operations. Complete obligation coverage before design redteam or implementation dispatch.
3. Redteam the design when it changes architecture, protocol, authority, or is otherwise high-risk. Redteam stays optional and risk-driven for routine low-risk implementation unless the WK requires it. At most one design redteam may be dispatched for a `WK-*` and its slice graph; when the WK is sliced, that single pass covers the authored slice contracts and dependency graph, before the first implementation dispatch.
4. Blueteam the design-redteam result when it reports findings, then disposition once. A no-findings result needs no blueteam. Each result is blueteamed at most once, a blueteam is not itself blueteamed, and it runs before remediation so no effort is spent on a finding that does not survive. One bounded pass binds the exact prior result and reviewed commit/base, independently challenges each finding for reality, contract scope, and proportionality, expands no contract, proposes no new functional objective, and modifies and integrates nothing. Then accept, reject, or defer each surviving finding and record why, including why a retired finding was closed. Do not dispatch a second design redteam for that WK, do not re-blueteam, and do not create a review or remediation unit to obtain another verdict on the same design.
5. Implement only after the WK/slice is independently executable and unblocked.
6. Run one findings-only review of each implementation slice before it integrates. This review is mandatory for every implementation WK or slice. Blueteam that result once when it reports findings, then disposition the surviving findings once and record the disposition. It is one review, one challenge, and one disposition, not the start of a review/remediation/re-review cycle: do not re-review or re-blueteam the remediation.
7. At WK scope, not per slice: run exactly one terminal whole-WK findings-only review of the exact candidate before publication, and blueteam that result once when it reports findings. Every finding that survives, regardless of severity, is recorded and dispositioned in the reviewed WK and then carried by a newly allocated, explicitly linked future `WK-*`. Do not remediate such a finding through a new slice of the reviewed WK, and do not modify, rebuild, or re-review the exact candidate because of it. Publication remains a separate coordinator/operator disposition under the advisory-review rule below.
8. Record closure and status: surfaces changed, validation run, blockers, and follow-on work. Move remaining work into a new or existing `WK-*` rather than leaving unchecked tasks on a closed item. When the change adds a new agent-usable capability, surface it in the same change on an always-on agent surface this repo has adopted.

Historical redteam and blueteam records remain evidence. This is a forward operating-policy rule only: it bounds each result to one challenge and one disposition and leaves launcher capabilities, reviewer modes, and schemas untouched. Do not rewrite or delete an older `WK-*`'s redteam or blueteam history because the forward policy changed.

Reviews are advisory. Use review text returned by the consuming repository's discovered structured review-dispatch capability whenever text is present, including when it does not adhere to an optional schema. Structured adherence matters only when that repository or runtime has explicitly adopted a narrow formal-attestation use case; any such attestation is derived during the original review dispatch. Never require a separate evidence or provenance append, a surviving run handle, restart repair or reauthentication, a replacement result, or another review merely to make review evidence usable. Review content informs coordinator disposition but neither mechanically authorizes nor vetoes lifecycle actions.

Integration is the coordinator's action and the only way a slice's delivery reaches the WK's accumulated ref. An unintegrated delivery is invisible to every later slice, whose worker starts from the unadvanced ref, so a later slice rebuilds its predecessor's work instead of iterating on it. A slice is reviewed before it integrates, and the final whole-WK candidate is reviewed before it is published. What those reviews return is advisory: the coordinator accepts, rejects, or defers each finding and records the disposition rather than treating severity as a veto.

When the terminal whole-WK review has been dispositioned, hand off through the repo's `workspace_wk_forge_handoff` capability. The already-reviewed candidate is published verbatim to the configured base branch, as the exact bytes the review saw. For that same publication the tool either creates the pull request or observes the one already open. It does not merge or observe merge state, does not reconcile state, does not close out the parent `WK-*`, and never rebuilds or re-derives the candidate. No candidate, base, or pull-request fact is taken from caller input, prompt text, or ambient environment. There is no supported route past that boundary: not shell, not `gh`.

Routine read-only verification — validate work records, lint, inspect a generated artifact, check dispatch or adoption readiness, query graph impact, or refresh status — is coordinator-owned and must not spawn an implementation slice on its own. Create an implementation WK or slice only when the task requires a write to a repo-owned source, doc, or configuration surface.

## Coordinator Duties

### Initiative Launch Checkpoint

On a fresh `IN-*` orchestrator launch, a resume, or an ambiguous "get started" request, the coordinator may perform initial structured retrieval and lightweight preflight only. Before dispatching workers or reviewers, creating or splitting `WK-*` records, changing statuses, or running long validation, it must send a short user-facing checkpoint stating what was found, the executable units and their statuses, the recommended next action, and the main alternatives and tradeoffs — then ask the user which path to take. Skip the checkpoint only when the user already requested a concrete action.

### Dispatch

Coordinators dispatch implementation workers, findings-only reviewers, and redteam workers through the repo's structured dispatch capability once the WK is independently executable. A request to "start", "run", or "get a worker started" is a dispatch request, not a request to draft a prompt or use a shell wrapper.

Dispatch is not fire-and-forget: monitor the role session until completion, read the result, handle blockers or nonzero exits, and record durable conclusions in the relevant WK, IN, docs, or decisions. Distinguish runtime/environment blockers from WK readiness blockers — report an environment blocker and how to rerun it rather than editing the WK to absorb it.

### Coordinator-Owned Verification

Verification is coordinator-owned when it is read-only or coordination-only; run it yourself rather than creating a unit for it. Generated artifacts, caches, and generated views are not implementation surfaces unless the WK changes their generator. If verification uncovers a defect that requires a file change, create or reopen a narrow implementation WK or slice for that write scope.

### Review And Completion

Every implementation WK or slice gets one mandatory findings-only review before it is treated as done — an explicit review slice in the same tracker, or a dispatched findings-only reviewer whose result is recorded in the closure. Design redteam is risk-driven unless the WK requires it, and at most one may be dispatched per `WK-*` and slice graph. A redteam or review result that reports findings gets one blueteam challenge and one disposition; do not order a further opinion on the same result. Dispatch never substitutes for coordinator-owned scope, acceptance criteria, validation, result review, or closure updates.

## Role Discipline

Act as an orchestrator only when you are instructed to.

Coordinators own scope, sequencing, WK readiness, delegation, review disposition, and durable coordination updates. They do not own behavior-changing implementation edits or product/runtime tests; when code or test changes are needed, create or update the owning `WK-*` and dispatch a worker once it is independently executable. Do not assign a worker to a WK that depends on hidden conversation context. Human/operator entrypoints for opening or resuming orchestrator sessions are operator actions; agents do not launch them.

A worker owns execution within its stated write scope: verify the WK's contract rather than only the currently passing tests, make the requested changes, stay in scope unless a blocker forces escalation, and return closure evidence for coordinator recording. A worker must not return only a plan when implementation was requested, silently broaden scope, or take over sibling `WK-*` items.

A decision, review, redteam, or blueteam worker does that mode only. It produces a decision brief or findings ordered by severity with file/line references and does not opportunistically implement fixes. A blueteam cannot be reassigned to remediate within that pass.

## Prompt Requests

Produce a prompt only when the user explicitly asks for a prompt or delegation text. If you are assigned to implement, review, redteam, or update a `WK-*`, your final answer is the result of that assignment — files changed, findings, verification, blockers, or the requested decision.

## Canonical Layers

- `docs/` is the canonical durable knowledge layer.
- `wiki/work-records/WK-*.json` is the canonical work-record layer.
- `wiki/issues/WK-*` is the Markdown issue surface when present.
- `wiki/initiatives/IN-*`, `wiki/decisions/DEC-*`, `wiki/sources/SRC-*`, and `wiki/areas/` are canonical when adopted.
- `wiki/catalog.md`, `wiki/now.md`, `wiki/backlog.md`, `wiki/archive.md`, and `wiki/inbox.md` are generated views, not canonical state.

## Docs And Wiki Are Not Executable Artifact Locations

`docs/` and `wiki/` hold durable knowledge and coordination, never runnable artifacts. Write access to those trees does not authorize executable scripts, command wrappers, or tooling, even when an assigned `WK-*` lists a `docs/` or `wiki/` path in its `write_scope`: no executable mode bit, no executable or tooling suffix (`.sh`, `.mjs`, `.js`, `.py`, binaries), no top-level shebang. Documentation and data formats (`.md`, `.json`, `.txt`, `.yml`, `.yaml`, `.csv`) and fenced code examples inside prose remain allowed. If a task seems to require a runnable artifact, stop and request a new `WK-*` or `write_scope` change targeting the appropriate package source location.

## Required Behaviors

- Do it right, not fast. Update `docs/` when work changes durable understanding; `docs/` is synthesis, `wiki/` is coordination.
- Behavior-changing work is incomplete without tests unless tests are genuinely impractical and you explain the gap. Add regression tests for bug fixes and user-visible behavior changes.
- Use repo-qualified IDs and paths for cross-repo references (`example-repo:WK-0001`).
- On ambiguity or conflict about architecture, runtime truth, protocol authority, scope, or acceptance criteria, stop and ask the user rather than guessing.
- After structural wiki changes, run the repo's structured generate and lint capabilities, or report that validation is blocked pending an operator run.

## Practical Rule Of Thumb

Before editing code, be able to answer both: which `docs/` page explains the durable system context, and what is the canonical coordination context that the repo can represent without guessing IDs? If not, fix that first.

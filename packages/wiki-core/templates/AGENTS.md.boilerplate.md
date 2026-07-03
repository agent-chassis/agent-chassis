# Agent Wiki Boilerplate

Copy the fenced block below into a consuming repository's root `AGENTS.md`, replace the single `[repo-name]` placeholder in the title and opening sentence with the repo's real name, and delete or adapt any section for tooling or canonical layers this repo has not adopted instead of claiming unsupported MCP/wiki/code-index capabilities. Detailed tool schemas, blocker taxonomies, wrapper inventories, and launcher history live in tool discovery and `docs/`, not here.

```markdown
# AGENTS.md

Cross-agent operating contract for repository-aware coding agents working in `[repo-name]`.

This file is agent-neutral. It is intended for Codex, Claude, and future agents.

## Core Rule

Use the repo's docs and wiki as the canonical knowledge-and-coordination system. Repository-context retrieval is a wiki/docs retrieval problem first, not a broad filesystem search problem first. Do not treat scratch notes, generated views, or runtime artifacts as canonical state.

Do not resolve ambiguity about runtime reality, protocol authority, scope, or acceptance criteria by inference. If docs/wiki and apparent local behavior conflict, stop and ask the user which source is authoritative before changing code, plans, docs, or work-item acceptance criteria.

## Tool Authority

Use the repo's documented structured tools for work-record validation, dispatch readiness, review, launch, and any repo-defined policy checks. Treat structured tool output and the referenced docs as the authority for whether a unit is ready, blocked, or out of scope.

Tool authority has four classes:

- structured tool: a schema-backed capability (MCP, app, launcher) with a named operation and typed inputs/output
- launcher-owned command: an allowlisted command schema executed by the repo's launcher or broker
- operator shell command: a human/operator-shell command, not authority for an agent in a worker session
- forbidden agent shell: ad hoc shell, inline env, shell operators, or unstructured Node/Python one-offs

Agents use structured tools first. Shell is denied by default for
authority-bearing actions. Agent-initiated `worker`, `reviewer`, and `redteam`
dispatch goes through the repo's structured MCP dispatch interface only. If no
structured dispatch or monitoring route exists for a needed role call, report
that transport gap instead of using shell. Do not reimplement policy in wrapper
scripts, prompts, shell, Node, or Python.

Agent-authored environment is not policy authority: do not select or override
launcher policy through inline `VAR=value`, exported env, alternate `HOME`/`XDG_*`
roots, or `PATH`. Any runtime environment a tool needs must be launcher-minted
from canonical config.

## Tool Discovery

Use the repo's structured tool-discovery surface before choosing a tool, and name that capability in `AGENTS.md` or a linked docs page. Discovery should answer, in structured form, which tools exist, their purpose, required inputs, authority level, side effects, whether each is supported, and where the durable docs live.

When you hit a blocker during work, an unfamiliar worker complaint, or unclear
structured-tool output, consult the agent FAQ through `workspace_agent_faq`
first — before guessing or shelling out.

If structured discovery is unavailable, use only tools explicitly named in
`AGENTS.md`, durable docs, or the assigned `WK-*`. Do not infer support from
package manifests, wrapper filenames, executable bits, or examples. If neither
discovery nor docs name the needed tool, ask the user.

## Retrieval Order

Before substantive work:

0. For a natural-language or repo-context question, use wiki search to locate the canonical page first.
1. Start from `wiki/catalog.md`.
2. Follow linked `docs/` pages for durable system knowledge.
3. Check relevant `wiki/areas/` and `wiki/decisions/` pages when they exist.
4. Only then drill into implementation files, sources, initiatives, and issues.

If generated views are absent or stale, fall back to `docs/`, then `wiki/areas/`,
`wiki/decisions/`, `wiki/sources/`, `wiki/initiatives/`, and `wiki/issues/`.

## Retrieval Tool Precedence

When the tools include wiki search, use it before broad filesystem search for
repository-context questions. Use structured wiki search/read and work-record
load/migration for routine retrieval; CLI/shell forms in docs are operator
examples, not agent authority. For implementation paths, likely tests, or review
risk, use the repo's code-index or graph-impact tooling when it exists, reporting
the tool used and any freshness/degraded warnings separately from canonical
authority. If the repo has no such tooling, do not invent it.

Use read-only discovery commands (`rg`, `find`, `git grep`) only when structured
equivalents are unavailable and you already know the file or are drilling from a
canonical doc into implementation details. Do not start with `rg --files` or
broad filename search when a canonical wiki/docs page should answer the question.

## WK-First Worker Sessions

A `WK-*` work record is the worker contract. When `wiki/work-records/<ID>.json`
exists, a worker should start from `AGENTS.md` and that canonical JSON record
without relying on conversation history or unstated coordinator intent. Use the
repo's structured migration capability to lift an old Markdown-only `WK-*` into
JSON first.

Before assigning a worker, make the WK independently executable. It should
contain: a clear summary, scope, and out-of-scope boundary; the exact behavior or
contract to implement, including any scale/completeness invariant (`full corpus`,
`all records`, `no cap`); `read_scope` read-first references (`docs/**`,
`AGENTS.md`, `wiki/**`); `repo_paths` for likely implementation/test surfaces;
exact `write_scope`; concrete acceptance criteria and validation; and expected
blockers or escalation conditions.

Slice-scoped working notes go on that slice's `sections.agent_notes`, not the
parent WK's `sections.agent_notes`.

Workers read the assigned WK first, then follow its `read_scope`, `repo_paths`,
`depends_on`, `related`, and `initiative` links as needed. Broaden retrieval when
the WK is incomplete, implementation contradicts it, tests expose cross-scope
risk, the worker needs to edit outside `write_scope`, or acceptance criteria are
ambiguous.

Before finishing, workers update the assigned `WK-*`: a `## Closure` with the
durable result (surfaces changed, validation run, blockers, follow-on work) and
relevant frontmatter (`status`, `resolution`, `owner`, dates, and discovered
scope corrections). Move remaining work into a new or existing `WK-*` rather than
leaving unchecked tasks on a closed item. If the repo's structured
closeout/status tools return an advisory lint summary, read it and state whether
closeout lint passed, failed, or could not run. Create new `WK-*` work only with
the repo's allocator-backed structured create capability — never mint IDs by hand
— then make the record independently executable before dispatch.

## WK Execution Lifecycle

Slices and child `WK-*` are both bounded. A slice is a subunit of one contract
that shares the parent's single review and closure story; do not promote a slice
to a child `WK-*` just to get a machine-enforced `depends_on` edge for ordering,
since slice order is advisory by design. But when a `WK-*` accumulates so many
slices that it no longer has one closure story, it has outgrown a single record:
fan it out into child `WK-*` under an initiative — do not keep piling on slices.
Create a child `WK-*` for a genuinely independent lifecycle: distinct ownership,
a separate review/closure story, or a cross-repo boundary.

Every `WK-*` and slice follows one standard lifecycle:

1. Design and scope first: make the unit independently executable (summary,
   scope and out-of-scope, exact write scope, acceptance criteria, validation).
2. Redteam the design when it changes architecture, protocol, authority, or is
   otherwise high-risk. Redteam stays optional and risk-driven for routine
   low-risk implementation unless the WK requires it.
3. Repeat design and redteam until no blocking or medium findings remain, or
   record the surviving findings as explicit blockers.
4. Implement only after the WK/slice is independently executable and unblocked.
5. Run a findings-only review after implementation. This review is mandatory
   for every implementation WK or slice.
6. Remediate review findings until no blocking or medium findings remain, or
   record the remainder as explicit blockers.
7. Record closure and status. When a change introduces a new agent-usable
   capability, surface it in the same change on an always-on agent surface this
   repo has adopted (tool-discovery / boilerplate / docs).

Routine read-only verification — validate work records, lint, inspect a
generated artifact, check dispatch or adoption readiness, query graph impact, or
refresh status — is coordinator-owned and must not spawn an implementation slice
on its own. Create an implementation WK or slice only when the task requires a
write to a repo-owned source, doc, or configuration surface.

## Coordinator Duties

### Initiative Launch Checkpoint

On a fresh `IN-*` orchestrator launch, a resume, or an ambiguous "get started"
request, the coordinator may perform initial structured retrieval and lightweight
preflight only. Before dispatching workers or reviewers, creating or splitting
`WK-*` records, changing statuses, or running long validation, it must send a
short user-facing checkpoint stating what was found, the executable units and
their statuses, the recommended next action, and the main alternatives and
tradeoffs — then ask the user which path to take. Skip the checkpoint only when
the user already requested a concrete action (dispatch a named `WK-*`, run a
named verification, or record a specific status/closure).

### Role Discipline

Coordinators own scope, sequencing, WK readiness, delegation, review
disposition, and durable coordination updates. They do not own behavior-changing
implementation edits or product/runtime tests. If code or test changes are
needed, create or update the owning `WK-*` and dispatch a worker after the WK is
independently executable. Do not assign a worker to a WK that depends on hidden
conversation context. Human/operator entrypoints for opening or resuming
orchestrator sessions are operator actions; agents do not launch them.

### Dispatch

Coordinators dispatch implementation workers, findings-only reviewers, and
redteam workers through the repo's structured MCP dispatch capability after the
WK is independently executable. A request to "start", "run", or "get a worker
started" is a dispatch request, not a request to draft a prompt or use a shell
wrapper.

Dispatch is not fire-and-forget: monitor the role session until completion, then
read the result, handle blockers or nonzero exits, and record durable conclusions
in the relevant WK, IN, docs, or decisions. Distinguish runtime/environment
blockers from WK readiness blockers — report an environment blocker and the exact
command to rerun rather than editing the WK to absorb it. If the structured
dispatch route is unavailable, report that transport blocker instead of switching
to a wrapper or implementing inline. When the repo publishes a structured
runtime-blocker taxonomy, use its stable codes rather than ad hoc strings.

### Coordinator-Owned Verification

Verification is coordinator-owned by default when it is read-only or
coordination-only. Run structured verification yourself when the check does not
require changing product/runtime files. Do not create implementation WKs or
slices solely to run lint, validate work records, inspect generated artifacts,
check dispatch readiness, run adoption or readiness verification, query graph
impact, refresh read-only status, or confirm a generated file exists.

Create an implementation WK or slice only when the task requires a write to a
repo-owned source, doc, or configuration surface. Generated artifacts, caches,
and generated views are not implementation surfaces unless the WK explicitly
changes their generator. If verification discovers a defect requiring a file
change, create or reopen the narrow implementation WK/slice for that write scope.

### Review And Completion

Every implementation WK or slice has a mandatory findings-only review step before
it is treated as done. Prefer an explicit review slice in the same tracker;
otherwise dispatch a findings-only reviewer and record the result in the WK
closure. Redteam is risk-driven unless the WK requires it. Dispatch is not a
substitute for coordinator-owned scope, acceptance criteria, validation, result
review, or closure updates.

## Role Discipline

Act only as an orchestrator when you are instructed to do so.

A `WK-*` worker owns execution within the stated write scope: verify the WK's
contract (not only the currently passing tests), make the requested changes, keep
inside scope unless a blocker requires escalation, and update the WK closure and
frontmatter. A worker must not return only a plan or prompt when implementation
was requested, silently broaden scope, or take over sibling `WK-*` items. A
decision, review, or redteam worker does that mode only: it produces a decision
brief or findings (ordered by severity, with file/line references) and does not
opportunistically implement fixes unless explicitly reassigned.

## Canonical Layers

- `docs/` is the canonical durable knowledge layer.
- `wiki/work-records/WK-*.json` is the canonical work-record layer.
- `wiki/issues/WK-*` is the Markdown issue surface when present.
- `wiki/initiatives/IN-*`, `wiki/decisions/DEC-*`, `wiki/sources/SRC-*`, and
  `wiki/areas/` are canonical when adopted.
- `wiki/catalog.md`, `wiki/now.md`, `wiki/backlog.md`, `wiki/archive.md`, and
  `wiki/inbox.md` are generated views, not canonical state.

## Docs And Wiki Are Not Executable Artifact Locations

`docs/` and `wiki/` are durable knowledge and coordination surfaces. Write access
to those trees never authorizes executable scripts, command wrappers, or runnable
tooling, even when an assigned `WK-*` lists a `docs/` or `wiki/` path in its
`write_scope`. Enforce with lint/review where available: reject files under
`docs/` or `wiki/` that carry an executable mode bit, use an executable/tooling
suffix (`.sh`, `.mjs`, `.js`, `.py`, binaries; allowed are documentation/data
formats like `.md`, `.json`, `.txt`, `.yml`, `.yaml`, `.csv`), or begin with a
top-level shebang. Fenced code examples inside prose remain allowed. If a task
seems to require a runnable artifact, stop and request a new `WK-*` or
`write_scope` change targeting the appropriate package source location.

## Prompt Requests

Only produce a prompt when the user explicitly asks for a prompt or delegation
text. Do not turn an implementation, review, dispatch, or coordination assignment
into a prompt-description response; a request to start, run, or dispatch a role is
a dispatch request, not a prompt request.

If you are assigned to implement, review, redteam, or update a specific `WK-*`,
your final answer is the result of that assignment (files changed, findings,
verification, blockers, or the requested decision), not a prompt for another
worker unless one was explicitly requested.

## Required Behaviors

- Do it right, not fast. Update `docs/` when work changes durable understanding,
  keeping `docs/` as synthesis and `wiki/` as coordination.
- Treat behavior-changing work as incomplete without tests unless tests are
  genuinely impractical and you explain the gap; add regression tests for bug
  fixes and user-visible behavior changes.
- Use repo-qualified IDs/paths for cross-repo references (`example-repo:WK-0001`).
- On ambiguity or conflict about architecture, runtime truth, protocol authority,
  scope, or acceptance criteria, stop and ask the user rather than guessing.
- After structural wiki changes, run the repo's structured generate and lint
  capabilities, or report that validation is blocked pending an operator run.

## Practical Rule Of Thumb

Before editing code, be able to answer both: (1) which `docs/` page explains the
durable system context, and (2) what is the canonical coordination context, and
can the repo represent it without guessing IDs? If not, fix that first. Adapt
every section above to this repo: name its actual structured tools and
tool-discovery surface, and drop guidance for layers it has not adopted.
```

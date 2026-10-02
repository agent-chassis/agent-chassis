
# Operating Model

This repository exists to make a shared wiki operating model portable across many codebases without centralizing the actual content.

## Compatibility posture: current contracts only

This repository does not provide legacy or backward-compatibility support by
default. The supported product and repository contract is the current contract.
Agents and maintainers must not add, preserve, or extend compatibility behavior
merely because an older format, entrypoint, field, fixture, caller, or workflow
exists.

Compatibility behavior includes aliases, shims, adapters, dual reads or writes,
fallback parsing or lookup, deprecated entrypoints, legacy data migration,
transition windows, and tests whose purpose is to keep an obsolete contract
working. Existing implementation, tests, documentation, historical usage, or
generated artifacts do not by themselves make such behavior supported.

An exception requires an accepted canonical `DEC-*` that identifies the exact
compatibility surface and scope. The decision must state the consumers and old
contract being supported, why current-contract migration is insufficient, the
required tests, the owner, and the removal condition or review date. A proposed,
rejected, superseded, or expired decision grants no compatibility authority.

Without that accepted decision, changes use the current contract directly,
remove obsolete compatibility behavior when it is in scope, and update or
delete expectations that require the old behavior. Historical records remain
historical evidence; their existence does not create a runtime or tooling
support obligation.

## Scope doctrine: no additional security profile

AgentChassis does not define an additional security profile for agents. It aims
not to worsen the security characteristics of the equivalent unmanaged-agent
setup. Confinement, role-scoped tools, session ownership, redaction, and bounded
projections exist for scope adherence, mechanical validity, cross-session
noninterference, and efficient routing—not confidentiality, least privilege,
adversarial resistance, or harm prevention. Incidental security benefits are not
product guarantees.

Read the rest of this document and the [Enforcement Model](enforcement-model.md)
through that doctrine:

- `write_scope`, repository projection, and launcher confinement keep an agent
  within the role and repository scope declared for the operation. They do not
  judge whether the declared operation is prudent or safe.
- role-scoped tool exposure tells each agent which operations belong to its role
  and avoids irrelevant tool descriptions and tokens. It is a routing and scope
  control, not a least-access or least-privilege design.
- MCP session ownership prevents agents from crossing or overwriting one
  another's active sessions and tool calls. It is not a claim about hostile
  callers, principal authentication, or forgery resistance.
- freshness, digest, CAS, schema, and fail-closed checks preserve mechanical or
  policy validity. Here, "fail closed" means that an operation does not continue
  without the facts it requires; it does not mean the result is security-safe.
- response projections provide the task-relevant information needed to continue
  work while avoiding duplication and transport waste. Information is not
  omitted on need-to-know, minimum-disclosure, confidentiality, or
  abundance-of-caution grounds.
- agents receive the credentials and writable runtime state their CLIs require
  to work consistently. AgentChassis defines no separate credential-handling or
  credential-leak-prevention guarantee.

Scope adherence does not make in-scope authority harmless. For example, an
orchestrator can expose a production-database deletion function within an
operation's write scope and a worker can invoke it. Confinement may keep that
worker within the declared operation while doing nothing to make the operation
itself safe.

Exact mechanical descriptions remain important: documentation may say which
paths are visible or writable, which values a response serializes, how external
authentication works, or why a launch refuses. Those facts describe current
operation, not an additional security posture.

## Model Boundary

Shared here:

- contract definitions
- template definitions
- allocator behavior
- lint and generation baselines
- taxonomy, query, and lint semantics for the shared core
- bootstrap and sync tooling
- agent-facing MCP tools/resources backed by the same shared core behavior

Owned locally in each consuming repository:

- `docs/` when the repo profile uses it
- `wiki/schema.md`
- `wiki/conventions.md`
- `wiki/index.md`
- all local wiki records
- all local synthesized outputs
- repo-local governance, migration, and extension-schema docs

See [docs/consumer-owned-docs.md](consumer-owned-docs.md) for how those local docs should be used without forking the shared contract.

## Canonical Surfaces In Consuming Repositories

Every participating repository should expose:

- `wiki/schema.md`
- `wiki/conventions.md`
- `wiki/catalog.md` as the generated retrieval entrypoint
- `wiki/now.md`
- `wiki/inbox.md`
- `wiki/backlog.md`
- `wiki/archive.md`
- `wiki/index.md`
- `wiki/work-records/` for current and migrated canonical `WK-*` JSON records
- `wiki/issues/` as the legacy Markdown issue/projection compatibility surface
- `wiki/initiatives/`
- `wiki/decisions/`
- `wiki/sources/`
- `wiki/areas/`
- `wiki/templates/`

In addition:

- `docs/` is required for the `standard` profile
- `docs/` is optional for the `research` profile
- repos may declare extension namespaces beyond the shared core

These surfaces are the shared minimum. Repositories can add more local surfaces, but should not fork the meaning of the shared ones.

## Why This Repo Exists

Without a shared source of truth, repositories drift in:

- file naming
- identifier allocation
- template shape
- lint expectations
- generated output semantics

The goal of this repository is to centralize the machinery that prevents that drift while keeping content ownership local.

## Canonical vs Generated

The model is one canonical source with derived projections, not many sources kept
in sync. One layer is authoritative: the authored canonical records under
`wiki/` and the durable synthesis in `docs/`. Current and migrated `WK-*` work
records are canonical JSON records under `wiki/work-records/`; `wiki/issues/`
is a legacy Markdown issue surface, generated/projection surface, or
compatibility surface when a repository keeps it. Everything else — Markdown
projections, generated views, sidecars, derived evidence, caches — is computed
from canon and holds no independent authority. When a derived surface disagrees
with canon, canon wins and the surface is regenerated; a stale view is a
regeneration task, never a competing truth. The recurring cost of this shape is
derivation freshness: ordinary, tracked maintenance.

Canonical local state:

- JSON work records under `wiki/work-records/`
- authored Markdown records under the canonical core `wiki/` surfaces other
  than the legacy/projection `wiki/issues/` surface
- durable synthesized knowledge in `docs/` when the repo profile uses it
- declared extension pages in repo-local namespaces

Non-canonical derived state:

- `wiki/issues/` Markdown work-record projections and compatibility records
  for current or migrated JSON-backed work
- `wiki/catalog.md`
- `wiki/now.md`
- `wiki/inbox.md`
- `wiki/backlog.md`
- `wiki/archive.md`
- summary views under `wiki/generated/`
- rollups
- dashboards produced from canonical files

Generated views must remain reproducible artifacts.

Operational rule:

- do not treat generated views as current unless they were just regenerated or lint reports no stale generated-view findings
- when in doubt, read canonical pages directly

## JSON-Backed Initiatives And Decisions

Initiatives (`IN-*`) and decisions (`DEC-*`) are canonical JSON records, matching
the `WK-*` work-record shape. Each `wiki/initiatives/IN-####.json` and
`wiki/decisions/DEC-####.json` is the authored source of truth; the co-located
`IN-####.md` / `DEC-####.md` is a generated Markdown projection with no
independent authority. The kind-record store keeps the two in lockstep: it
validates the JSON against the per-kind schema (`decision.v1` / `initiative.v1`)
and regenerates the `.md` in the same write, so a hand edit to the projection is
never canonical and is overwritten on the next regeneration. This is the same
canonical-vs-generated rule described above, applied to the initiative and
decision surfaces.

Agents mutate these records through schema-aware structured routes, never by
editing the Markdown or the JSON on disk directly. Direct filesystem edits to
`wiki/initiatives/` and `wiki/decisions/` are not the agent authoring path.

Reads follow the same authority boundary. A registered `IN-####` or `DEC-####`
identity resolves through the kind-record store to its canonical JSON record,
and a path read admits only the exact canonical JSON path classified by that
store. Explicit Markdown reads remain available as projection reads, but an ID
or canonical-path read never falls back to that projection. Missing, unreadable,
invalid, or identity-mismatched canonical JSON is returned with the store's
mechanical validity and diagnostic evidence instead of a successful projection.

### Decision Authority Lifecycle

A decision carries a `status` with two authority states:

- `proposed` — a non-binding draft. Consumers must not treat a `proposed`
  decision as authority.
- `accepted` — a ratified, binding decision.

Agents own the proposed lane. The structured decision routes let an agent
create a decision as `proposed`, amend a `proposed` decision, and reject a
`proposed` decision. Those routes cannot set `status`, cannot move a decision
into or out of `accepted`, and do not expose ratify or unratify operations for
any MCP role.

Ratification is a human operator action. The human `wiki decision ratify` CLI
is the only surface for the `proposed → accepted` transition, and the human
`wiki decision unratify` CLI is the only surface for reopening an accepted
decision. Both transitions record operator-resolved identity and provenance.
An accepted decision must be unratified by a human operator before agents can
amend it through the proposed-only routes. This separation is an exposure and
authority boundary; shared persistence primitives do not grant agents the
human-only lifecycle transitions.

## Cross-Repo Referencing

Cross-repo references should never rely on local clone layout or implicit context.

Use:

- `org/repo:WK-0001`
- `org/repo/wiki/decisions/decision-some-decision.md`

Do not use:

- `WK-0001` alone in a multi-repo context
- relative filesystem paths that break outside one checkout

## Anti-Drift Strategy

Anti-drift is a tooling problem. The shared tooling stack should enforce:

- bootstrap
- template sync
- identifier allocation
- allocator state management in `wiki/.id-state.json`
- linting
- non-canonical generation
- profile-aware durable knowledge rules
- declared extension namespace presence

Current shared lint covers:

- canonical surface and metadata presence
- allocator state continuity against canonical allocated records
- duplicate ID detection across core record types
- dependency and related-ID validation
- docs-link existence plus non-mutating wiki/source backlink checks with exact required comments in findings
- closed issue rejection when unchecked checklist items remain
- generated-view drift warnings
- stale `write_scope` path warnings

Shared lint is a document-formation gate, not a worker-execution policy engine.
It may verify that work records, reports, validation-command claims, and
admission artifacts are present and structurally valid. It must not become the
place where this repository decides whether a worker run, command claim,
worktree checkout, path write, or report is policy-admissible. Those decisions
belong behind a worker-admission adapter so the local reference implementation
can later be replaced by a Chassis Control Engine/domain-pack backend without changing
callers.

The worker-admission adapter consumes normalized evidence supplied by the
repository adapter. Portfolio-specific details such as WK ids, wiki paths,
Markdown compatibility, graph-impact retrieval, and closure/report locations
are normalized before policy evaluation. The policy backend should not crawl the
live wiki, infer Markdown sections, or import agent-chassis parser
internals.

Structured role launch admissibility is backend-neutral. The launcher records
the launcher-owned CCE-key posture, backend selection, enablement, and
availability facts for the run; those facts decide whether a worker, reviewer,
or redteam launch is admissible as enforced, refused, or unenforced. Bubblewrap
is the current Linux backend id (`bwrap`), Seatbelt is the planned macOS backend
id (`seatbelt`), and `none` records an unenforced run.

The default local/free posture is driven by CCE-key presence, not by whether
bubblewrap or Seatbelt is installed. When no CCE key is configured, local/free
structured dispatch may run unenforced if no usable OS sandbox backend is
available.
Missing, unsupported, unavailable, broken, or unusable local sandbox backends do
not by themselves block useful local/free structured work, but the launcher must
record a loud warning and honest unenforced provenance.

When a CCE key is configured, enforcement is
required by default. A worker, reviewer, or redteam launch must use a working
enforcement backend or refuse before plain spawn unless the operator explicitly
opts out of enforcement for that launch or launcher configuration. That opt-out
is launcher/operator authority, not child-provided authority; with it set, the
CCE-key launch may run unenforced and must record opt-out provenance.

The recorded posture is provenance, not a security guarantee. Enforced launches
record `enforced: true` only after the selected backend actually starts the
role; local/free fallback and CCE-key explicit opt-out launches record
`enforced: false` and `isolation_backend: none`, with a reason distinguishing
no-CCE-key fallback from CCE-key opt-out and CCE-key enforcement-required
refusal. These fields make structure, admissibility, and honest downstream
gating visible. They must not be read as proof that the local launcher has
established host security, and they must not let generated docs, worker reports,
or dispatch artifacts present an unenforced run as sandboxed.

## Terminal whole-WK candidate

The terminal findings-only review is a review of the exact commit proposed for
publication, not a review of the accumulated WK branch followed by a later
squash. The launcher freezes canonical repository identity, the launcher-bound
base `B` of the persistent WK lifecycle (the fork point the WK branch was cut
from, carried on the WK identity binding), and the accumulated WK ref/tip `W`. It
creates the deterministic squash candidate `C` such that `tree(C) === tree(W)`
and `C`'s sole parent is `B`. Candidate construction never resolves, reads,
merges, or compares the current landing tip, and never invokes `merge-tree`:
`tree(C)` is resolved directly from `W` and `C` is created with `commit-tree`.
Current landing does not participate; git/forge owns landing merge readiness after
publication, so a product-path conflict between the current landing and `W` can
never block candidate construction. A content-addressed candidate ref is created
or recovered by compare-and-swap; the WK branch and its worktree remain unchanged.

The launcher materializes a distinct private mode-0700 full detached checkout
at `C`. Every declared whole-WK validation runs there before the findings-only
review, and that reviewer is bound to `C` with `B` as its diff base (`B..C`) and
`W` as the accumulated source identity. Validation receives an empty-baseline,
secret-free environment. Ordinary project dependencies are exposed only by a
launcher-created read-only sibling projection of the canonical repository
`node_modules`, pinned to its exact source identity for the life of the mount.
Dependencies are neither installed nor copied.

After immutable terminal-result and receipt settlement, the single
package-owned append operation records the completed terminal review in the
canonical WK ledger against exact `C` and `B`. Receipt settlement remains the
continuation authority; the ledger is audit evidence. Receipt-only partial
publication is repaired by authenticated settled replay of only the absent
byte-identical ledger effect. Candidate/base movement or conflicting identity
refuses, and neither publication nor replay modifies `C`.

Project dependencies and project-test execution are optional. Terminal review and
exact-candidate forge handoff proceed independently of whether they are available:
a candidate whose manifests, lockfile, or workspace manifest disagree with the
landing checkout's installed dependency root, an absent or stale dependency tree, a
missing install marker, an unbuildable projection, and a declared validation target
that is absent from `C` all change only what advisory evidence exists. None of them
invalidates `C`, refuses findings-only review, or blocks publication. Reviewer launch
without a projection binds no dependency source rather than falling back to the
mutable landing checkout. Four concerns stay separate and must not be collapsed: the
exact candidate mechanics below, optional project-test execution, configured CCE
policy at the publication boundary, and git/forge merge readiness. This layer defines
no local admissibility, eligibility, readiness, review-required, test-required,
quality, mergeability, or publication-policy threshold, and the existing CCE contract
is unchanged.

Candidate identity and its evidence remain exact: a change or uncertainty in
`W`, `C`, the candidate tree or parent, candidate ref, checkout, canonical contract,
reviewer identity, candidate branch, proposed change head, or the pinned identity of
a selected dependency mount invalidates the affected evidence and requires a new
candidate cycle. Movement of the current landing before or after candidate construction
does not modify `C` or its frozen base parent, does not invalidate completed
validation or review, and does not block publication — deterministic `C` depends
only on `B`, `W`, repository identity, and the canonical contract, never on the
current landing tip. Publication handoff publishes `C` byte-for-byte as the
proposed change head against the configured base branch and never rebases,
replays, squashes, amends, or reconstructs it before publication; it does not
require `C`'s parent to equal the current base-branch tip and does not preflight
or locally resolve merge conflicts. Git/forge and the configured merge actor own
merge readiness, so a conflicting or unmergeable PR is still a successfully
handed-off exact candidate. Only a change to `B`, `W`, `C`, the candidate tree or
parent, or the canonical contract yields a changed candidate that must be
validated and reviewed anew. Branch and proposed-change mutations are reobserved
and
accepted only when their exact repository/base/head/state is proven. This
mechanism creates no generic provenance, Proof A/Proof B, receipt, or
review-attestation authority.

### Operator forge merge

An operator may run `agent-launch forge-merge WK-#### [--checkout <path>]` once
the WK's canonical closeout is recorded. Review is an independent consumer and is
not a prerequisite. The CLI launcher mints the workspace binding from its
operator-resolved working directory before composing the operation. The command
accepts the WK id and, for a local or Git handoff only, an optional checkout
location. Its trusted composition binds the forge-handoff authority owner's
read-only existing-publication observer and the canonical work-record validator;
candidate, repository, branch, review, proposed change head, handoff
destination, configured base branch, and merge authority are never
caller-supplied, and the checkout location selects none of them.

The authenticated handoff's destination selects the landing. A hosted handoff
merges its exact pull request as described below. A local or Git handoff has no
proposal: the command, run by the human Git actor, stages the WK's matching
coordination files, applies the authenticated review-to-done change to a live
closeout record, and fast-forwards a base-branch checkout with an ordinary
`git merge --ff-only`, as described in
[Handoff destinations and landing observation](mcp-dispatch-terminal-review.md#handoff-destinations-and-landing-observation).
It never pushes. A local handoff succeeds only when the landing observer reports
it landed; for a Git handoff a local fast-forward is local completion and remote
landing is reported pending until the destination's base carries the handoff.

Before initial publication, forge handoff appends the two WK-only commits
(decision's closeout record `K` and the completion state `D`) to the unchanged
terminal candidate `C` and publishes `D` as the proposed change head on the forge
handoff branch, so the initially published pull request already carries the
owning WK at parent status `done`. That `done` is branch-local: the canonical
parent on the base branch stays in `review` until a confirmed merge. The chain is
prepared only while the handoff branch is absent; a repeated handoff recovers the
published chain and appends nothing, or, when the canonical record carries
permitted coordination changes, replaces that same publication with a rebuilt
`C -> K2 -> D2` under its expected old head (see
[Repeat handoff](mcp-dispatch-terminal-review.md#repeat-handoff-refreshes-the-same-publication)). Merge authenticates that existing
publication afresh in its own process: the handoff owner re-observes the exact
selected candidate, its version and its required squashed worktree from durable
authority, resolves the same repository/base/branch identity the publisher binds,
and authenticates the observed branch and single proposal head (the complete
authenticated closeout chain above `C`). It publishes nothing, creates no proposal,
reconstructs or advances no candidate, and moves no ref; a missing, ambiguous,
moved, foreign or tampered fact refuses with its owning cause before any merge
effect. The forge-merge operation then merges that exact pull-request head into
the configured base branch without adding commits. A remote conflict is a
refusal: the helper does not rebase, squash, force-update, resolve with a broad
theirs strategy, or create a post-merge main commit. After confirmed merge it
reconciles the local WK record. If merge succeeds but local reconciliation does
not, the result is typed partial success and a retry is safe: retry authenticates
the exact merged head before attempting only the remaining local reconciliation.
Before merging, the local review record must equal the published closeout record;
a disagreement returns the typed reconciliation failure without merging.

This authentication does not transfer ownership. work record owns candidate and
forge authority, work record owns landed-publication identity, work record owns recovery,
and forge owns merge readiness. Completed-review evidence stays advisory under
decision and decision and supplies no review-policy, findings-veto, completion,
or merge authority.

Forge merge enters the same durable exact-W controlled-generation exclusion as
candidate construction and forge handoff before resolving candidate publication
state. While holding that exclusion, it authenticates the complete current
manifest-selected generation directly from exact W through the controlled-generation
owner and compares that owner-minted identity exactly with the generation bound to
the terminal candidate. The exclusion remains held continuously through the
pull-request merge. A missing, malformed, stale, or mismatched generation
identity refuses before the remote merge; W equality, resolver metadata, caller
values, digests, and manifest-identity projections are not generation authority.
External merge failure releases the exclusion, and a later invocation reauthenticates the current generation before
performing supported retry or recovery.

Before either closeout commit is created, forge handoff authenticates the exact
closeout projection from `C` to the live canonical WK through the one closeout
owner (`authenticateWkCloseoutProjection`) that forge merge also uses.
The parent may hold any non-`done` status in `C` but must be `review` live; its
canonical `sections.closure` may be recorded; `updated` may move between
well-formed dates only together with a real closeout change; and at most one
implementation slice may move to `done` with its first canonical
`sections.closure`. No terminal-review unit, review completion, or review receipt
is required or fabricated: a review slice already in `C` may change status only,
and one canonical findings-only review slice may be added after `W`. The first
WK-only commit contains that authenticated live projection byte-for-byte, and
the completion commit changes only the parent status from `review` to `done`.
Agent notes, scope, acceptance, dependency declarations, unrelated slices,
additional closeouts, closure replacement or mutation, review-slice rewrites
beyond status, and non-implementation closeouts remain refusing drift; forge
observations and caller/environment input do not authorize it.

Current shared query/search covers:

- lexical retrieval over canonical docs and wiki pages
- structured filters for shared frontmatter fields
- authority-aware ranking from the local wiki/docs link graph
- exclusion of generated views from canonical search targets
- read-only repo code index impact/context queries that expose index staleness and keep canonical refs separate from derived code evidence

For agent-driven consumers, MCP is the preferred operational interface. Humans and CI can use the thin CLI wrapper over the same core behavior.

Humans still review content quality, but they should not be responsible for keeping the contract aligned by memory alone.

The allocator state is repo-local runtime state rather than durable content. It is lock-protected and shared by both the CLI and MCP interfaces. Reservations advance that state immediately, and record creation must consume the next outstanding reserved ID before allocating a fresh one.

## Interface Layering

Because agents are the main consumer of the wiki system, this repository treats MCP as a first-class interface:

- `packages/wiki-core/` contains the contract-aware implementation
- `packages/wiki-mcp/` exposes structured tools and resources for agents
- `packages/wiki-cli/` wraps the same core behavior for humans and CI

The shared logic must live in `wiki-core`, not in the CLI or the MCP server, so behavior does not fork by interface.

## MCP Deployment Model

The MCP layer is intended to run as a spawned-per-session local process over `stdio`.

That means:

- no hosted endpoint is required
- no port allocation is required
- no long-running service lifecycle is required
- MCP clients should launch the command directly when a session needs wiki functionality

For this repository, agents should think of MCP as command-line ingress to the shared wiki tooling, not as a network service.

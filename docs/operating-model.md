<!-- wiki: id=IN-0001 relation=tracks -->

# Operating Model

This repository exists to make a shared wiki operating model portable across many codebases without centralizing the actual content.

## Security scope

The local tooling in this repository is **correctness, provenance, and
honest-agent workflow machinery — not same-user security infrastructure**. Read
the rest of this document, and the enforcement model it feeds, through that
scope. Its local mechanisms exist to:

- **enforce product contracts** — `write_scope` confinement, dispatch-readiness
  shape checks, and the launcher's controlled-execution boundary keep an honest
  managed agent inside the lane its coordinator authored;
- **detect accidental drift and corruption** — CAS/digest integrity, sidecar
  fail-loud checks, declared-versus-landed verification, and freshness/expiry
  checks catch an unintended, stale, or corrupted change, not a forged one;
- **protect credentials from external disclosure** — the launcher masks its own
  secrets off the worker mount and redacts private carriers so a credential is
  not leaked outward through a run's inputs, outputs, or model egress;
- **constrain confined managed execution** — a managed worker sees exactly its
  `R ∪ W` namespace and mutates only `write_scope`, so its blast radius is
  bounded to what it was dispatched to touch.

It does **not** claim security against a **malicious same-user actor or a
compromised host process**. A party that already holds the operator's shell, host
filesystem, and credentials can defeat every local mechanism here; containing
that party is outside the mandate. The realistic baseline is *"the operator runs
the agent with full host privileges and no tooling at all,"* and the job is to be
honestly better than that baseline for an **honest** agent, not to make a hostile
one harmless.

This framing weakens no real boundary. External service authentication, the
Chassis Control Engine's signing authority as the sole minter of enforcement
authorization, kernel write confinement, CAS/digest integrity, and the
credential/private-carrier disclosure boundaries above all still hold exactly as
before; they are simply described as contract-enforcement, provenance, and
disclosure controls rather than as a same-user security guarantee. This mandate
was established by the work record audit; work record first applied it, making
target-resolution evidence advisory to dispatch rather than a file-type
permission.

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

### Decision Authority Lifecycle

A decision carries a `status`, and its authority follows the two-state lifecycle
fixed by `decision`:

- `proposed` — a non-binding draft. Consumers must not treat a `proposed`
  decision as authority.
- `accepted` — binding. In this free/local tier `accepted` is binding **on
  trust**: consumers accept it at face value.

The lifecycle is driven by a single agent-callable operation family, all
ungated and fail-open in the free tier, each call stamping provenance (who/when):

- `create` — mint a new decision as `proposed`.
- `amend` — edit a `proposed` decision in place. Amending an `accepted`
  decision is refused until it is returned to `proposed` via `unratify`.
- `ratify` — the `proposed → accepted` transition, a trusted status flip
  recorded honestly.
- `unratify` — the `accepted → proposed` transition, reopening a decision for
  amendment.

The free tier is intentionally ungated: any agent may draft and ratify
decisions, `ratify` is a trusted status flip, and there is no approver check.
The enforcement boundary against self-authorization lives in the paid CCE ratification
attestation (a signed approver-set predicate), which is out of scope here and
tracked separately (node-engine + `initiative`). This model deliberately does
**not** assert an operator-only ratification gate, a local approver check, or any
filesystem/admission lockdown of `wiki/decisions/`: `decision` retires local
lockdown, and neither the JSON record nor its projection encodes one. The JSON
migration preserves exactly today's Markdown `accepted` semantics and broadens no
authority.

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

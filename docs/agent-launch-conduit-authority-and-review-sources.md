# Conduit authority and review sources

This page describes what a conduit is authorized to carry and which source
bytes a confined role reads through it. The transport is in
[MCP conduit lifecycle](agent-launch-mcp-conduit-lifecycle.md), and confinement
is in
[Agent-launch confinement and MCP conduit](agent-launch-confinement-mcp-conduit.md).

## Conduit authority

The worktree identity and the R∪W authority a dispatch carries are not conduit
input fields. Raw caller-shaped `worktreeIdentity` / `writeAuthority` values are
refused. Family adapters resolve canonical carriers — the managed worktree
provisioning binding, the frozen worker scope authority, the commit tuple — and
a single shared launcher-owned composition boundary validates those carriers
against the assigned unit, family, role, workspace, scope sets, and cross-run
identity, then mints one branded, frozen authority object. The conduit accepts
only that object, and only when it was minted for exactly the family, role,
unit, and workspace being launched. Freezing a value never makes it launcher
authority; provenance does. The authority mode is derived from the role
(`assigned` for a managed worker, `read_only` for findings roles, `coordination`
for an orchestrator) and is never selectable by a caller or a call site.

Conduit creation, validation, readiness, authority composition, failure mapping,
and teardown are one family-neutral implementation. Claude and Codex differ only
in the frozen
[client registration projection](agent-launch-mcp-conduit-lifecycle.md#client-registrations).

## Frozen findings contract artifact

For a managed findings launch carrying a supported trusted contract, the
composition boundary first authenticates the exact canonical findings-route
admission against the assigned unit, subject, technical role, standalone
purpose, frozen-contract digest, and launcher run. Codex and Claude carry the
same admission object; neither derives managed transport from a role label.
Terminal whole-WK and exact-slice reviewer contracts retain their existing
reviewer-owned binding. The same boundary then publishes the contract's exact query projection as a
mode-0400 regular file beneath the conduit-owned mode-0700 private directory.
Only the host wiki-MCP server receives the launcher-minted path; the confined
child receives neither path nor bytes, and its namespace gains only the existing
admission endpoints. The server-side protocol, authenticated managed-run binding,
supported contract discriminators, pagination, cursor grammar, and content-free
refusal contract are normatively specified in [Frozen reviewer-query
protocol](mcp-dispatch-runtime-contract.md#frozen-reviewer-query-protocol).
This page owns only that artifact's private transport and cleanup.

The artifact participates in the conduit's single retained cleanup settlement.
Normal cleanup unlinks it before removing the private directory; a failed unlink
remains owned, is retried by settlement, and produces the existing typed cleanup
failure without suppressing cleanup of admission endpoints, host-server
generations, or other resources.

## Review checkout capture

Every reviewer and redteam dispatch reads from one action-private review
checkout, distinct from the canonical launcher/run-state root. The advisory
pipeline materializes the selected reviewed commit there, then captures the
canonical WK that carries the assignment, with its selected entry material and
controlled-contract inputs, and places those captured files at their normal
paths over the reviewed bytes. Capture applies to every advisory selector,
including an explicit-SHA or implementation-slice review whose assignment was
authored after the reviewed commit, so the captured WK may be newer than the
committed one. Dispatch never amends a commit or moves a candidate ref.

The captured controlled-contract inputs are the complete selected contract of
the WK that carries the assignment, so the reviewer never reconstructs missing
content, navigates storage internals or reads live files to complete it:

- for each focus that publishes a carrier-set manifest, the visible manifest,
  the manifest embedded in the generation directory it selects, and the
  manifest-selected members, each at the repository path it was read from
  (`wiki/contracts/.carrier-generations/<generation>/<filename>` for the
  embedded manifest and the members);
- the WK's flat parent and slice obligation-coverage sources
  (`wiki/contracts/<WK>[--unit-slice-NNN].obligation-coverage.json`), which carry
  its obligations, cases and associations, at their own paths;
- with no manifest published, every carrier and obligation source of the WK
  stored at the store root.

The carrier-set owner selects the manifests and their members, and the
attachment-generation owner resolves the complete population, including the
obligation sources. A member's logical `wiki/contracts/<filename>` identity is
never used as its destination when a manifest stores it in a generation
directory. The private checkout therefore holds the same manifest-to-member
relationship and the same authored sources as the canonical repository at
capture, over whatever older copies the reviewed commit holds, and the ordinary
readers resolve the capture-time contract and combined revision unchanged.
Capture adds no other generation and no store-root copy of a member.

Capture checks identity and integrity only: each selected file must be one
regular, contained, non-symlinked file whose bytes parse as a carrier and match
the digest its owner resolved, both when read and again before the launch
proceeds. A file that is missing, malformed or moving refuses the dispatch with
a `agent_launch.findings_design_capture.*` cause and launches nothing. Capture
does not judge semantic completeness, proof-plan freshness or execution
readiness, so a contract that is reviewable but not yet executable is captured
as authored. A captured generation member that is later missing from, or
changed in, the checkout refuses through the reader's own generation
diagnostics; no read recovers a captured input from the canonical repository or
from a store-root copy.

The advisory review input has two launcher-only preparation stages. The
pipeline prepares it from the review descriptor and private checkout; the
advisory process runner then mints the run and binds the prepared input to that
`run_id` before any family adapter sees it. A prepared input binds to exactly
one run: binding it again to the same run returns the same bound input, and
binding a prepared or bound input to a different run is refused. Both family
adapters forward that run-bound input unchanged to the shared authority, which
authenticates it with its own consumer for the exact role and unit, requires it
to be run-bound, requires its canonical repository to be the conduit workspace,
and derives the review-materialization root from its private checkout. An
unbranded, copied, or merely prepared input composes no review source. That
input is the only producer of the root. The host server keeps
`WIKI_MCP_WORKSPACE_DIR` bound to canonical launcher identity, but binds
`workspace_read_page`, summary and delegated entry reads, and their returned
continuations through the launcher-only `WIKI_MCP_REVIEW_MATERIALIZATION_DIR`
to that checkout. The variable is accepted only for reviewer/redteam profiles
and is never a caller or prompt selector. Consequently direct checkout reads and
MCP page reads share the same captured WK and selected controlled-contract/proof
bytes for the whole review, while completion and run identity continue to
authenticate against the canonical root. Coordinator and other sessions read the
live repository.

The host authenticates that source through one findings-source resolver,
shared by these ordinary reads and by
`workspace_controlled_contract_obligation_coverage_query`. The resolver
authenticates the presented session contract against the launcher-expected
contract through the session owner, requires exactly one
`advisory_review_source` binding, recomputes that binding from the host's own
startup facts, and requires the bound root to still be a directory. It reads no
frozen review artifact, worker run record, or live repository. Its refusals name
the deciding cause: `launcher_session_unauthenticated` (with the session
owner's refusal code, including a changed role or subject and another run's
contract), `advisory_review_source_binding_absent`,
`advisory_review_source_binding_duplicated`,
`advisory_review_source_binding_mismatch` (the host's repository or
materialization root is not the one the launcher bound, including a substituted
root or a retargeted symlink), `advisory_review_repository_unavailable`,
`review_materialization_unavailable` (not configured, not absolute, missing, or
not a directory, including a source removed by the launch's owned cleanup), and
`review_materialization_unreadable` (a filesystem failure, with its error
code). An ordinary read reports the cause in its
`workspace_read_review_source_unavailable` refusal; a root that fails the
reader's repository-alias check refuses, and a WK missing from the bound
checkout refuses as not found. None of these falls back to live WK state. A
reviewer or redteam profile with no launcher session state at all is not a
managed session and reads the configured workspace. The live metadata operations `workspace_work_record_validate` and
`workspace_record_staleness_check` stay outside this read binding and are not a
source oracle for captured reads.

## Work-record entry material

Frozen assignments may also select immutable work-record entry material. The
launcher resolves those refs only from the selected canonical source set,
checks the recipient's source visibility, and captures the complete
referenced WK closure through the same private snapshot owner. For a managed
worker, visibility is coverage by the frozen resolved read and write membership
at the scope-existence base, minus the launcher exclusions, through the same
containment predicate the scope tree owns. Each record source must be granted as
its own individual file (globs and directory grants are unsupported), and a
reference never grants source access by itself. Reviewer
findings capture keeps its own declared read/repository/write check.
Every reference must belong to the trusted repository identity bound to the
canonical repository. A reference or `record.repo` never supplies that identity.

Reviewer and redteam capture uses the workspace alias that the registered
`workspace_agent_dispatch` route resolved from the server's configured workspace
mappings. The wiki-MCP composition root supplies that same mapping and resolver
to the dispatch backend, which re-resolves the alias and accepts it only when its
configured directory canonicalizes to the backend's own main repository. The
advisory dispatch request carries no directory, and ambient environment or Codex
configuration is not consulted. Nonempty material with no composed binding or an
unconfigured alias refuses before launch with the resolver's
`work_record_material_repository_unavailable` diagnostic preserved in the
refusal detail, and an alias configured for another directory refuses as
`review_repository_binding_mismatch`.

Managed worker preparation consumes the alias and directory that the same route
resolved together for the launch, from any supported server attachment. The
managed provisioning wrapper replaces the executor workspace with the slice
worktree and forwards that resolved pair unchanged beside it. Brief preparation
accepts the alias only when the directory canonicalizes to the provisioned main
repository; no duplicate alias declaration, ambient environment, or Codex
configuration participates. Nonempty material with an absent, partial, or
foreign-root binding refuses with `work_record_material_repository_unavailable`.
A worker brief refusal reports the renderer's diagnostic code as its
`wrapper_gate_code` and carries the renderer diagnostics into the launch refusal
detail; `missing_agent_brief` remains only for a brief that is absent without a
renderer diagnostic. An unmanaged local worker resolves the alias that
launcher-owned configuration maps to its canonical read root
(`resolveLauncherConfiguredWorkspaceAlias`).

On every path a reference naming another repository remains denied even when its
record, entry, and version identifiers match.
Dispatches without entry material do not consume the identity. Ordered
identities, provenance, and text participate in the existing descriptor freeze.
There is no ambient-host fallback and the confined worker receives no new MCP
grant.

## Frozen worker assignment capture and authority

The launcher-frozen worker scope snapshot is the single authenticated carrier for
BOTH the namespace a managed worker receives and the task it receives. Alongside
the frozen scope authority, the freeze resolves the selected assignment material
through the shared entry-material resolver, using the repository identity the
dispatch route already resolved and a loader memoized over the captured record
population. The assignment's own record is served from the captured bytes, so a
later on-disk version cannot be bound after the freeze authenticated it; every
other declared source still loads canonically and keeps the resolver's existing
repository and declared-visibility checks. The resolver's diagnostics refuse the
freeze, and no worker is spawned.

Capture is not a capability. The material references remain identities: they
confer no additional read or write access, and the assignment they produce never
widens R union W, the mutation targets, the private-family exclusion at
`wiki/contracts`, or the worker MCP tool profile.

Authentication of the handoff is separate from scope authority and allocates no
lifecycle. The managed provisioning wrapper mints one frozen assignment bound to
the exact unit address, canonical source digest, run id, monitor handle, and
provisioned worktree, and registers it privately. A family adapter authenticates
that exact value before it prepares a launch. What crosses the boundary is
immutable presentation and identity only — the composed prompt, the launch
packet, the canonical summary and brief, and the resolved terminal-result mode.
The raw work record, the private controlled-proof carrier, and the launcher-
private provisioning ticket do not cross it, and a caller prompt, request field,
or environment value can neither create nor replace the value.

The client spawns with the assignment's startup text only. The authority mint
accepts the launcher-minted assignment as a private snapshot, refusing a value it
did not mint, one for another unit or canonical source, or one on a non-worker
conduit; its expected-authority check binds that exact snapshot digest. The
conduit publishes the snapshot as a digest-named, owner-only, read-only artifact
inside its private directory before readiness, through the same publisher and
cleanup settlement as the frozen review contract, and hands its path only to the
host wiki-MCP server environment. A publication failure refuses conduit
construction with `assignment_read_publication_failed` before any client exists.
The worker retrieves the guidance through its assignment-only
`workspace_read_wiki`; that route and its refusals are part of the delivery
path below. Managed guidance carries the selected task together with the
selected unit's authenticated readable and writable paths, frozen with the rest
of the assignment. Presenting those paths grants nothing: the frozen scope, its
exclusions and bindings stay in the launcher authority, the bubblewrap
namespace enforces filesystem access, and the worker tool profile enforces tool
access.

The complete delivery path, its content rules, its four stable transport
diagnostics, and the surviving non-presentation canonical reads are described in
[MCP dispatch launch and admission](mcp-dispatch-launch-and-admission.md#one-frozen-worker-assignment-for-every-managed-family).

## Trusted writes and terminal candidate validation

Trusted writes remain inside their owning host process. The launcher runtime
owns launch, probe, worktree provisioning, review-surface preparation, and slice
integration. The host wiki-MCP server owns the closed-input commit capability.
The orchestrator-only forge tool invokes the existing launcher-owned host
executor in-process. There is no broker, endpoint, socket transport,
general-filesystem transport, in-sandbox MCP runtime, or compatibility fallback.

Terminal candidate construction, checkout verification, reviewer dependency
projection, final-review binding, and forge publication are launcher-owned.
The launcher creates a separate private
mode-0700 full detached checkout at exact candidate `C`; it does not repurpose,
rewrite, or mount the WK worktree. Validation uses an empty-baseline child
environment inside a findings-only reviewer bwrap composition. Source, Git
metadata, and projected dependencies are read-only; temp/cache/output roots are
isolated and writable outside repository state. Workspace-package links are
rewritten to `C`, so a host `node_modules` link cannot redirect validation to
current main. The projection exposes ordinary project dependencies only: the
wiki-MCP server and its interpreter/package tree remain outside bubblewrap, and
no broker, listener, relay variant, mounted server runtime, dependency copy, or
package installation is introduced. Candidate authority is launcher-resolved
and never crosses the conduit as caller, prompt, environment, or model-output
authority.

The projection is bound read-only at the exact `<candidate-checkout>/node_modules`
path. Because the candidate checkout is mounted read-only, bwrap cannot create
that mountpoint under it, so the launcher creates exactly that one empty
untracked mountpoint directory before confinement, pins its canonical path,
directory type, and filesystem identity, and re-proves them at the final shared
pre-spawn boundary used by both Codex and Claude terminal findings launches. The
mountpoint is the sole permitted addition to the checkout; a symlinked,
redirected, non-directory, non-empty, tracked, preexisting-untrusted,
type-swapped, or identity-swapped destination, or any writable/runtime bind
overlapping the checkout, destination, or dependency source, fails closed before
spawn. The read-only dependency projection bind is the only bind emitted at that
destination — the candidate checkout and dependency source are never made
writable and no parent directory is bound — and the candidate commit `C`, tree,
tracked checkout bytes, HEAD, refs, index tree, Git metadata, and projected
dependency contents are preserved byte-for-byte.

Checkout verification accepts one other untracked root `node_modules`: the
dependency mapping a host test run published in that checkout (see
[Ordinary test runs](local-test-runtime-setup.md#ordinary-test-runs)). It is
accepted only when the mapping's owner verifies it, read-only, against the npm
installation selected for the repository; a link to anything else refuses as a
non-directory destination. The candidate's HEAD, tree, index and Git status
checks are unchanged, so a mapping Git reports as untracked still refuses.

Standalone and normalized immutable-range snapshot reviews bind no project
dependencies. A reviewer's tests and proofs run on the host
(`workspace_run_test`, `workspace_verify_proof`), where the shared test run maps
the selected installation into the snapshot it executes in, so the launch
selects no projection, creates no `node_modules` mountpoint in the snapshot and
retains no dependency evidence. The launch still binds the authenticated
compiled-validator cache read-only at the snapshot's
`.cache/controlled-contract/validators` and re-proves its backing when the
Codex or Claude plan is composed, at first launch and at replacement alike.
Whatever already occupies the snapshot's `node_modules` is left as found: the
launch neither adopts nor shadows it, and a host run that needs the selected
installation there reports the occupant as its own conflict. No dependency path
is writable to the reviewer.

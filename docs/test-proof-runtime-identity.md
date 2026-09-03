# Test-proof runtime identity

Production test-proof attempts accept one launcher-minted context. They do not
accept caller-provided identities, commands, executors, callbacks, inventories,
environments, artifacts, modules, falsifier populations, or source snapshots.
The context binds the following facts before any provider executes:

- the launcher-authenticated run, WK, selected unit, and attempt number;
- the exact same-WK canonical controlled-contract generation and selected root
  carrier content digest/schema;
- the verification claim and its package-validated test-proof binding;
- one native stable-v1 `runtime_test_identity.test_id` selected from the
  binding's declared current coverage population;
- the canonical node-test target and a deterministic command identity; and
- the exact repository source snapshot that providers execute.

The command identifier is `command-<hex>`, where `<hex>` is SHA-256 over the
newline-terminated canonical JSON value `{ "operation": "node_test",
"target": <normalized repository-relative target> }`. A caller cannot supply
either the identifier or target population.

The controlled-contract generation is
`sha256(JSON.stringify({schema_version:"controlled-contract-generation.v1",
wk_id,carriers}, null, 2) + "\n")`. `carriers` is the complete sorted population
of canonical same-WK carrier filenames and their byte SHA-256 digests, observed
twice without movement. The launcher verifies that every generation member has
the same byte digest in the authenticated source snapshot. This generation
digest is deliberately distinct from the selected contract carrier's content
digest.

For a published carrier-set manifest, wiki-core's canonical carrier-set owner
also binds each runtime-only member to the exact manifest-selected source
location, logical filename, storage mode, manifest generation, and authenticated
content digest. The launcher hashes that owner-selected member inside the same
current-worktree or immutable exact-commit candidate used for execution; it
does not reconstruct a root `wiki/contracts/<filename>` path. Legacy-root
members are accepted only when the same owner explicitly selected legacy-root
mode because no manifest fences the WK. These source-member facts are internal
runtime authority and are not part of the public generation digest or
`workspace_controlled_test_proof_query` response.

The source snapshot is
`workspace-agent-test-proof-source-snapshot.v1`. It hashes newline-terminated
canonical JSON containing the sorted recursive repository entries, entry kind,
mode, and file-byte SHA-256 digest. It also binds the launcher-selected read-only
dependency projection identity and installation digest, and the runner uses that
same frozen mount for every provider. Symlinks refuse because hashing a link name
would not authenticate the bytes an import executes. `.git`, `.agent-launch`, and
`node_modules` entries are excluded because they are launcher metadata or
launcher-selected runtime infrastructure rather than candidate source. The
launcher captures the snapshot before execution and recomputes it before and
after every attempt; movement refuses the attempt.

The attempt engine derives the complete falsifier population directly from the
package-validated binding, executes the unchanged candidate, every falsifier,
and the selected traversal provider (or the registry-authenticated unsupported
projection), then emits deterministic advisory evidence. Its semantic judgment
is always `not_performed_coordinator_owned`.

## Stable-v1 readiness lifecycle

`controlled-acceptance-contract.v1` is the sole current contract. Its
`controlled-contract-test-proof.v1` binding may carry the optional closed value
`runtime_test_identity: { test_id }`. Structural authoring may omit it. In
particular, a binding with `no_executed_coverage`, an empty item population, and
no selection remains valid authoring input. The authoring-state operation can
therefore be structurally `complete` while its nested, non-authorizing
`authoring_evidence.proof_execution_readiness` is `not_ready`.

The controlled-contract package is the single semantic owner of the current
test population. It projects preserved test IDs and replacement test IDs,
excludes removed IDs, sorts the result, and refuses duplicate identities. The
same package classifier keeps inventory and selection independent and returns
exactly one diagnostic reason:

- `missing_inventory`: the baseline is not
  `complete_executed_inventory`, or its current population is empty;
- `missing_selection`: a complete nonempty population has no
  `runtime_test_identity`;
- `invalid_selection`: the selected ID is not a member of that exact current
  population; or
- `ready`: the inventory is complete and the one selected ID is a member.

Selection never establishes inventory completeness. A ready multi-test or
nested-test binding selects one member for the runtime attempt identity while
runtime evidence retains every observed member for bounded audit. Semantic
proof attribution uses only that predeclared selected member; sibling results
and the whole-file exit code do not override its pass or failure. The launcher
does not derive a selection or fabricate an inventory from the selected ID.

The reporter and canonical discovery use one launcher-owned stable-identity
implementation. It normalizes an absolute path, file URL, or relative Node event
path to the same contained repository-relative file before hashing the relative
file, nesting depth, and exact test name. A top-level `test(...)` remains a
nesting-zero inventory member when it owns nested `t.test(...)` children; each
child has its own deeper identity and never substitutes for the parent. Two
tests with the same relative file, nesting depth, and name produce the same ID.
That collision refuses loudly; it is never deduplicated or resolved by event
order.

The launcher-confined provider runs exactly the declared file with Node test
isolation disabled inside the existing outer sandbox so the authenticated
reporter can observe inner `node:test` events. If the file terminates or
completes before the selected ID is observed,
`test_proof_selected_identity_not_observed` exposes minimal recovery facts: the
expected ID, bounded file-wrapper status/error codes and counts, and at most
eight deterministic candidates.
Each candidate contains only its stable ID, safe relative file, bounded name,
and nesting depth. The refusal never projects the reporter envelope, complete
inventory, output streams, process inputs, or provider payloads.
`test_proof_bound_identity_mismatch` remains reserved for a genuine mismatch
between the declared identity and the authenticated runtime binding.

The four classifier outcomes are diagnostic mechanical-operability facts, not
admissibility decisions. During authoring, missing inventory is advisory. At an
execution boundary, each nonready outcome is a decision mechanical failure:
without complete inventory the launcher would have to omit or invent the
population, without a selection it cannot mint one exact attempt identity, and
with an invalid selection it would bind evidence outside the declared
population. These failures carry `admissibility_effect: none`. They create no
decision or decision verdict, threshold, policy choice, or CCE/admissibility
remediation and grant no dispatch, review, integration, completion, publication,
certification, or CCE authority.

CCE remains the sole owner of action sequencing and admissibility. If CCE is
absent or unavailable, no local readiness result substitutes for it: a ready
binding grants no lifecycle action, and a nonready binding reports only the
mechanical inability to execute the proof correctly.

Bounded readiness projections include `candidate_total`, the returned and
omitted candidate counts, and a complete retrieval call to
`workspace_controlled_test_proof_query` with the exact verification identity.
Recovery authors complete observed inventory or one selected population member
through `workspace_controlled_test_proof_patch`. That write creates a next
carrier generation. It cannot repair an already-minted immutable candidate;
execution requires a newly minted candidate bound to that next generation and
its own source snapshot.

The execution routes apply the same facts at different boundaries:

- `workspace_verify_proof` gates the complete proof population selected by one
  canonical subject before any attempt-context minting or provider spawn. One
  nonready proof refuses the whole population with bounded per-proof diagnostics
  and no receipt.
- `workspace_controlled_contract_runtime_prove` gates every exact integrated
  test-execution binding before executing any provider. Because its result is
  one indivisible complete receipt population, one nonready member refuses the
  whole attempt and no partial population is minted.
- `workspace_worker_run_declared_test` may return its already-completed ordinary
  validation with `proof_execution_readiness: not_ready` and no proof evidence
  when classification fails before proof starts. Once proof execution starts,
  an incomplete enrichment remains fail-closed as
  `TEST_PROOF_RECEIPT_INCOMPLETE`; no partial proof claim is returned.

## Launcher common-proof receipt identity

Durable test-verification, write-confinement, and behavioral-preservation owner
projections are published into the single work record launcher store as immutable
lifecycle-specific records. Public selection is keyed only by the complete
`wiki-core-common-proof-capture-receipt-identity.v1`; a launcher-owned identity
head names the exact current immutable selector and content identity. Publication
makes the immutable record durable first and advances the head last under the
existing store lock. Replay must be byte-identical, and any replacement must
compare-and-swap the exact expected prior selector. Restart selection revalidates
the identity, selector, content digest, record layout, integrity, size bounds,
and currentness without scanning the record population or reconstructing
lifecycle state.

Behavioral preservation has one three-member visibility group: the pair receipt,
the baseline observable report, and the candidate observable report in their
declared side order. All three immutable records become durable before one group
head is advanced; partial groups, side swaps, inconsistent selectors, and
divergent replay refuse. A stale marker or cleanup can remove/tombstone a head
only while it still points to that exact stale selector, and cleanup never
retargets an identity to a different record.

## Current-contract boundary

Native stable-v1 carriers use `controlled-contract-test-proof.v1`. No alias,
shim, migration, dual read, fallback parser, deprecated entrypoint, or
experimental-v0.2/v0.3 selection behavior is part of this runtime contract.
Stable authoring validates the complete carrier,
resolves candidate, falsifier, and traversal providers through the single
package registry, and returns bounded diagnostics with the frozen incompatibility
precedence. Runtime evidence v2 binds the native carrier identity and refuses a
historical, partial, or incompatible carrier rather than upgrading it.

## Post-integration runtime proof

`workspace_controlled_contract_runtime_prove` is the coordinator-visible route
that produces this evidence after a managed delivery has already been
integrated. Its subject is one exact implementation slice, never a whole WK, and
every fact it binds is read from canonical state or a launcher-owned ref:

- the canonical integrated slice lifecycle
  (`resolveCanonicalIntegratedSliceState`), which classifies the slice as
  `final`, `non_final`, or `corrective` from work-record status fields, and
  carries the slice's canonical `integrated_delivery_sha` — the commit the
  integration CAS installed on the WK ref;
- reachability of that delivery commit from the observed WK tip
  (`merge-base --is-ancestor`), which is what proves the delivery actually
  landed. The status classification alone cannot: it reads no commit, so a slice
  a coordinator marked `done` without integrating it classifies identically to
  one that integrated. A slice carrying no `integrated_delivery_sha` — every
  slice integrated before the field existed — is refused under
  `agent_launch.integrated_test_proof.delivery_not_in_tip.v1` rather than
  proved against a tip its code may not be in;
- the launcher-owned fixed WK fork (`resolveFixedWkForkCommit`) and the durable
  WK ref `refs/heads/wk/<initiative>/<WK>`, observed as one exact direct
  commit-valued ref; and
- a new private mode-0700 full detached checkout materialized at exactly that
  tip, verified before use and again before teardown, and removed afterwards.
  The persistent WK worktree is never removed, re-created, attached, or
  otherwise mutated.

The `integrated_slice` runtime authority is minted from those three facts plus
the existing dependency and source-snapshot identity. Its run identity is
derived from the tip (`run-integrated-<tip>`) at attempt 1, so proving an
unchanged tip twice deterministically reuses the same identity; there is no
nonce and no freshness policy, because a repeated proof of unchanged source is
the same proof. The ref, tip, and private checkout are re-observed immediately
before and immediately after every provider attempt, alongside the source
snapshot the attempt engine already re-verifies; any movement invalidates the
whole attempt population rather than one receipt, and leaves no private checkout
behind.

Caller input is exactly `{repo?, unit, focus?}`. Lifecycle, Git, path, command,
environment, provider, receipt, witness, assessment, and authority fields are
refused by name rather than ignored. `focus` is refused as well: launcher proof
identity binds the exact same-WK ROOT controlled-contract generation, so a
focused carrier has no authenticated runtime identity to bind.

## Runtime assessment, and what it does not claim

The route hands the complete authenticated
`controlled-contract-test-proof-runtime-evidence.v2` receipt population to
`assessTestProofContract`'s direct runtime option. That owner binds the
population one-to-one to the contract's exact expected verification population
and derives the result directly from exact population equality, candidate
success, falsifier activation, and traversal proof. It returns
`controlled-contract-assessment.v3` with `assessment_scope` `runtime` and
`non_authoritative` authority.

Before the first provider executes, the route classifies every test-proof
binding from the exact integrated root carrier using the package-owned readiness
classifier described above. A nonready member refuses the indivisible runtime
attempt mechanically and produces no partial receipt population.

Everything else refuses with a typed `test_proof` diagnostic and produces no
assessment at all: an empty expected population, and missing, duplicate,
unexpected, mismatched, invalid, failed-candidate, newly-skipped,
inert-falsifier, and unproven-traversal populations. A runtime failure never
falls back to a planning assessment, and the runtime route never calls
`workspace_controlled_contract_assess`.

`workspace_controlled_contract_assess` remains the planning-only route: it reads
authored carriers, writes only its content-addressed assessment bundle
(`workspace_write`), executes nothing, and therefore cannot establish runtime
truth for a delivered implementation. The runtime route declares
`process_spawn` and performs no host workspace or Git write. It is not a proof-pack authoring,
selection, assessment, admission, or authority surface, and a proven runtime
result grants no admitted proof-pack, proof-applicability, admission,
certification, CCE, or dispatch outcome.
## Canonically selected post-delivery proof populations

`workspace_verify_proof` accepts one required canonical `subject`, optional
configured repository selection, and optional exact `git_sha` available only to
an authenticated orchestrator. `subject` may name a WK, slice, test proof, or
obligation. The server resolves that exact identity from the work record,
controlled contract, obligation coverage, and declared validation bindings; the
caller supplies no selector kind. WK selection includes every proof in the
generation, slice selection follows the slice's verification bindings, proof
selection names one exact proof, and obligation selection follows its controlled
`verifies` relationships. Relationships are never inferred from identifier
prefixes or carrier filenames.

Every selector produces the same stably ordered population and aggregate result
shape. Identical proofs execute once while every canonical proof-to-obligation
relationship remains explicit. Before any attempt context is minted or process
spawned, the complete population must have exact targets, provider and evaluator
bindings, proof-plan relationships, complete current inventories, and exactly
one selected stable runtime identity per proof. The package-owned stable-v1
classifier above is the sole readiness owner. One failure refuses the entire
population; there is no partial execution or retroactive sibling-test selection.
The internal resolver reads and validates the authenticated controlled-contract
carrier once and returns the complete schema-bounded binding population in
memory. It does not call or consume the transport-sized
`workspace_controlled_test_proof_query` projection. That public query keeps its
independent compact-response limit and `stable_test_proof_query_too_large`
refusal; the limit is not an execution-population limit.

When atomic preflight is blocked, each ready proof is reported as `ready` and
`not_started` with no contract-authoring recovery. Only nonready proofs carry
the package classifier's exact bounded inventory/selection reason and its
authoring recovery. Aggregate counts distinguish ready, nonready, and
execution-not-started proofs without attributing one proof's defect to its
ready siblings.

A nonzero Node exit is not by itself an execution refusal. When the selected
assertion ran and the launcher authenticated a complete structured reporter
population, its failing assertion is evidence and evaluates as `unsatisfied`.
Isolation or spawn failure, timeout, invalid or incomplete reporter structure,
provider inability, candidate movement, and missing or cross-bound receipts are
instead `not_executable` mechanical/protocol outcomes. Their bounded refusal
preserves the verify-proof wrapper and deepest stable cause plus safe stage/run
facts; raw output, absolute filesystem paths, commands, environment, and
provider objects remain private.

The controlled proof executor uses a fixed launcher-owned wall-clock budget
that permits a complete declared test module to settle before fd-3 reporter
assessment. Ordinary declared validation retains its separate shorter default.
Neither budget is caller-selectable, and a genuine over-budget provider run
remains a typed `not_executable` timeout.

The proof reporter writes to a launcher-owned protocol pipe separate from test
stdout/stderr. Candidate, falsifier, and traversal runs retain its one
authenticated JSON envelope byte-for-byte up to a
fixed 2 MiB protocol ceiling that is independent of the 262,144-byte diagnostic
output cap. The runner continues draining the pipe after that ceiling but discards
the partial envelope and returns
`test_proof_structured_events_oversized`; it never inserts a diagnostic elision
marker into bytes passed to the reporter parser. Ordinary validation and proof
diagnostics retain the existing bounded head/tail behavior.

`contract_generation` always means the `generation_digest` from the
package-owned `controlled-contract-generation.v1` projection over the complete
authenticated carrier population. The carrier-set manifest's `generation.id`
and `generation.path` select stored carrier bytes; they are a different identity
domain and are never substituted for or compared with `contract_generation`.
The contract carrier's own `content_digest` remains a separate authenticated
fact and is checked independently.

Attempt-context minting consumes the carrier-set owner's authenticated runtime
member projection. A missing or stale top-level carrier copy cannot satisfy,
override, or invalidate a manifest-selected member. If the selected member's
bytes differ inside the execution candidate, minting refuses with the bounded
carrier filename and owner-selected storage mode before the managed test runs.

Without `git_sha`, execution occurs directly in the configured repository
worktree. Its canonical path, registration, Git common directory, HEAD commit,
tree, clean/dirty fact, and bounded status identity are authenticated before and
after execution. A stable dirty worktree is allowed: dirtiness is a subject fact,
not a readiness gate. Movement still refuses, and the operation never cleans,
resets, stashes, commits, copies, or otherwise mutates the source.

An exact `git_sha` must be the configured repository's lowercase full-width
commit identity. The launcher resolves its commit and tree from Git object data,
then uses the same purpose-neutral immutable-candidate substrate as exact-commit
review to create and authenticate one private detached worktree under the
launcher-owned worktree root. Registered worktrees already at that commit are
irrelevant, including dirty ones. The shared lifecycle authenticates the
materialized commit/tree before execution and removes the worktree and candidate
directory afterward. Resolution, materialization, authentication, and cleanup
failures are typed and bounded; a cleanup failure retains the bounded primary
execution code and registration/residue facts.

`workspace-agent-test-proof-runtime-identity` mints one branded source authority
for the aggregate. Its subject binding records `existing_worktree` for
`current_main` or `immutable_exact_commit` for `exact_sha`, plus the exact commit,
tree, clean status, and authenticated candidate identity. Per-proof results
reference this common binding rather than acquiring sources independently.

The server derives test identity from exactly one matching canonical
`acceptance.validation[]` object shaped as
`{ operation: "node_test", target, verification_ids }` on the
launcher-selected implementation unit. The target is a lowercase-`.mjs`, POSIX repository-relative path
of at most 4,096 characters whose nonempty segments contain only ASCII letters,
digits, `_`, `.`, or `-`; `.` and `..` segments and an option-like leading `-`
are forbidden. Control characters, whitespace in the target, absolute or
backslash paths, traversal, empty segments, and non-`.mjs` suffixes are invalid.
Strings and `{ note, verification_ids }` objects are non-executable notes;
command objects and secondary structured-validation sections are rejected.

Wiki-core alone validates the declaration and joins verification identity to
target. Worker calls bind that join to the assigned
unit and launcher candidate; reviewer calls bind it through the frozen reviewed
unit and candidate. Duplicate verification bindings and stale, ambiguous, or
cross-bound reviewer bindings fail before execution. The existing
worker-declared-test, terminal-candidate, `workspace_run_validation`, dispatch,
selected-unit, and reviewer surfaces consume that same projection.

The shared semantic kernel authenticates complete
`controlled-contract-test-proof-runtime-evidence.v2` and projects execution
facts, including the declared test inventory. It does not judge satisfaction.
Historical proof instances that select exact 3.0.0 retain that evaluator's
original meaning. Corrected proof instances deliberately select exact 4.0.0,
whose `post_delivery` evaluator requires the declared, discovered, and executed
test inventories to be complete and exactly equal. No current/latest selection
or silent 3.0.0-to-4.0.0 upgrade exists. The pre-dispatch 2.0.0 pack and its
authored proof plans remain immutable and retain their original meaning.

The aggregate and each per-proof result are `satisfied`, `unsatisfied`, or
reason-coded `not_executable`.
Malformed, corrupt, stale, duplicate, cross-bound, inconsistent, or
digest-mismatched evidence produces a typed refusal. A canonical subject that
resolves to no proofs is `not_executable`; an empty population is never success.

After all relationships resolve, package readiness is checked for the entire
population before attempt-context minting and provider spawn. Readiness reasons
and the decision mechanical limb remain bounded per proof; this is not an
admissibility result.

Runtime binding authentication reports the failed invariant with bounded
expected and observed status, counts, verification identities, contract-content
digest, and canonical generation digest. Missing or invalid binding populations
point to `workspace_controlled_test_proof_query` and
`workspace_controlled_test_proof_patch`; a carrier-content contradiction points
to canonical carrier repair. Only an observed change between two canonical
generation reads recommends restarting after that generation stabilizes.

Results are advisory. They grant no dispatch, review, admission, integration,
completion, CCE, lifecycle, or policy authority. Complete evidence is not placed
in a universal ledger: copied response text and compact retained receipts have
no replay authority, and restart without the complete exact receipt population
is `not_executable`. A later run is a fresh proof instance.

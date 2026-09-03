# Test-proof runtime identity

Production test-proof attempts accept one launcher-minted context. They do not
accept caller-provided identities, commands, executors, callbacks, inventories,
environments, artifacts, modules, falsifier populations, or source snapshots.
The context binds the following facts before any provider executes:

- the launcher-authenticated run, WK, selected unit, and attempt number;
- the exact same-WK canonical controlled-contract generation and selected root
  carrier content digest/schema;
- the verification claim and its package-validated test-proof binding;
- one coordinator-authored `controlled-contract-runtime-test-selection.v1`
  stable SHA-256 `test_id` from the binding's declared current coverage population;
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

## Version compatibility

The exact runtime test choice is an additive, separately versioned field on the
v0.3 `test-proof-v1` binding. Existing v0.3 carriers without
`runtime_test_selection` remain valid for authoring, query, and assessment, but
cannot produce production runtime evidence. V0.2 behavior is unchanged. V0.2 to
v0.3 migration never invents a runtime test, provider, or boundary selection.
# Stable test-proof identity boundary

Native carriers use `controlled-contract-test-proof.v1` and do not carry
`runtime_test_selection`. Stable authoring validates the complete carrier,
resolves candidate, falsifier, and traversal providers through the single
package registry, and returns bounded diagnostics with the frozen incompatibility
precedence. Runtime evidence v2 binds the native carrier identity and does not
upgrade a historical or partial carrier.

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

Everything else refuses with a typed `test_proof` diagnostic and produces no
assessment at all: an empty expected population, and missing, duplicate,
unexpected, mismatched, invalid, failed-candidate, newly-skipped,
inert-falsifier, and unproven-traversal populations. A runtime failure never
falls back to a planning assessment, and the runtime route never calls
`workspace_controlled_contract_assess`.

`workspace_controlled_contract_assess` remains the planning-only route: it reads
authored carriers, writes only its content-addressed assessment bundle
(`workspace_write`), executes nothing, and therefore cannot establish runtime
truth for a delivered implementation. The runtime route declares both
`process_spawn` and `workspace_write`. Neither is a proof-pack authoring,
selection, assessment, admission, or authority surface, and a proven runtime
result grants no admitted proof-pack, proof-applicability, admission,
certification, CCE, or dispatch outcome.
## Per-obligation post-delivery verification

`workspace_verify_proof` implements v1 verification for one uniquely resolvable,
test-backed obligation. Its public input is required `obligation_id`, optional
configured repository selection, and an optional exact `git_sha` available only
to an authenticated orchestrator session. Managed workers and reviewers remain
bound to their launcher-selected candidates and cannot supply `git_sha`. No role
can select a target, command, environment, provider, evaluator, path, receipt,
policy, or authority.

For an orchestrator exact-commit request, the runtime accepts only the
configured repository's lowercase full object-width SHA, proves that the object
exists and is a commit, and binds both its commit and tree identities. It
materializes that commit in a private detached mode-0700 checkout and executes
only there. A missing object is `not_executable`; a non-commit object, movement,
identity mismatch, checkout escape, or cleanup failure is a typed refusal.

When `git_sha` is omitted, the runtime observes the configured worktree's HEAD
and tree (including an unborn HEAD), dirty status, and complete tracked and
untracked source bytes under the source-snapshot exclusions. It authenticates a
canonical snapshot digest, copies those exact bytes to a disposable private
candidate, and requires source and candidate snapshot equality. Clean and dirty
worktrees therefore execute outside the configured worktree. A dirty result is
proof only of that ephemeral byte snapshot; it is not proof of HEAD, a commit,
or deployed bytes. Source or candidate movement before or during execution
refuses, and the private candidate is removed after success or failure.

`workspace-agent-test-proof-runtime-identity` is the sole owner that mints the
branded orchestrator source and execution-candidate authorities. The complete
candidate identity records `git_commit` or `worktree_snapshot`, configured
repository, commit/tree/HEAD where applicable, dirty and snapshot status,
source-snapshot digest, selected unit, and runtime owner. The MCP result carries
that identity with the proof instance; callers cannot reconstruct or override
it.

The server derives test identity from exactly one matching canonical
`acceptance.validation[]` object shaped as `{ command, verification_ids }` on
the launcher-selected implementation unit. It accepts only
`node --test <one-target>` with exact single-space token separators and no
shell parsing. The target is a lowercase-`.mjs`, POSIX repository-relative path
of at most 4,096 characters whose nonempty segments contain only ASCII letters,
digits, `_`, `.`, or `-`; `.` and `..` segments and an option-like leading `-`
are forbidden. Flags, quoting, control characters, whitespace in the target,
multiple targets, absolute or backslash paths, traversal, empty segments,
non-`.mjs` suffixes, shell metacharacters, and every other command shape are
non-executable or typed-invalid and are never executed.

The canonical work-record vocabulary is unchanged: no target, candidate,
generation, or snapshot field is added. Wiki-core alone joins the verification
identity to the derived target. Worker calls bind that join to the assigned
unit and launcher candidate; reviewer calls bind it through the frozen reviewed
unit and candidate. Duplicate verification bindings and stale, ambiguous, or
cross-bound reviewer bindings fail before execution. The existing
worker-declared-test, terminal-candidate, and `workspace_run_validation`
declaration parsers are separate execution domains and are not generalized by
this join.

The shared semantic kernel authenticates complete
`controlled-contract-test-proof-runtime-evidence.v2` and projects execution
facts, including the declared test inventory. It does not judge satisfaction.
Historical proof instances that select exact 3.0.0 retain that evaluator's
original meaning. Corrected proof instances deliberately select exact 4.0.0,
whose `post_delivery` evaluator requires the declared, discovered, and executed
test inventories to be complete and exactly equal. No current/latest selection
or silent 3.0.0-to-4.0.0 upgrade exists. The pre-dispatch 2.0.0 pack and its
authored proof plans remain immutable and retain their original meaning.

The result is `satisfied`, `unsatisfied`, or reason-coded `not_executable`.
Malformed, corrupt, stale, duplicate, cross-bound, inconsistent, or
digest-mismatched evidence produces a typed refusal. The v1 route requires one
qualifying test-execution verification; zero or multiple qualifying
verifications are `not_executable`, not invalid contract authoring.

Results are advisory. They grant no dispatch, review, admission, integration,
completion, CCE, lifecycle, or policy authority. Complete evidence is not placed
in a universal ledger: copied response text and compact retained receipts have
no replay authority, and restart without the complete exact receipt population
is `not_executable`. A later run is a fresh proof instance.

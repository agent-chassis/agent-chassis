
# MCP dispatch terminal review

Part of the [MCP dispatch runtime contract](mcp-dispatch-runtime-contract.md),
which remains the canonical entry page. This page carries the canonical text for
terminal-candidate material selection and advisory review execution, the
authenticated controlled-generation envelope for terminal candidates, active
managed composition, spawned-server lifecycle, post-spawn conduit failure,
cleanup-only terminal failure, canonical `acceptance.validation` admission across
the findings-only surfaces, independent findings actions, the exact-slice
review-surface state budget, bounded postcheck diagnostics, and terminal-review
audit evidence.

Sibling pages: [launch and admission](mcp-dispatch-launch-and-admission.md),
[managed run lifecycle](mcp-dispatch-managed-run-lifecycle.md),
[slice integration](mcp-dispatch-slice-integration.md),
[monitoring and ownership](mcp-dispatch-monitoring-and-ownership.md).

## Common fixed-fork squash candidate, independent review and exact forge lifecycle

Every forge publication publishes the same thing, whichever delivery workflow the
repository selected.

- **One candidate.** For the selected integrated WK tip `W` and the fixed
  authenticated fork `B`, the existing trusted constructor builds the squash
  candidate `C` with `tree(C) = tree(W)` and sole parent `B`, and handoff
  publishes `C` unchanged. The current base tip is not a construction input.
  There is no direct-`W` alternative, no second constructor and no additional
  candidate store or ref family.
- **The candidate is publication material; review is an independent consumer.**
  Every fresh final integration constructs `C` and materializes its squashed
  candidate worktree, whether or not the canonical record designates a terminal
  review unit. No review unit, review contract, review evidence or retained
  reviewer context is an input to construction, reconstruction, recovery,
  materialization or publication, and the candidate bytes carry no review field.
  Publication requires the squashed candidate worktree bound to exactly `C`; its
  presence says nothing about whether a review ran. The candidate object binding,
  its tree and sole-parent topology, the worktree, the selected version and the
  controlled generation are authenticated on every publication, and the result
  carries no review-selection fact. A terminal review, when one is dispatched,
  consumes this same exact candidate.
- **A controlled contract is not a publication prerequisite.** A WK that has no
  controlled contract has no generation, and publication does not refuse it. The
  generation owner observes at exact `W` that no generation is current and that
  `tree(W)` holds no carrier or manifest of the WK, and that observation takes
  the generation's place in the candidate identity; the candidate's metadata
  block then carries no generation or carrier line. Nothing is authored for such
  a WK: no contract, generation, manifest, proof result or authentication receipt
  is created, and its proof posture is neither read as a permission nor changed.
  A recorded proof opt-out and no opt-out at all publish through the same path.
  Saved proof-authoring sources (`*.obligation-coverage.json`) are not carriers:
  with no controlled carrier and no manifest of the WK beside them, the live
  resolver and the exact-commit observer both select no generation, so a WK
  whose opt-out and `proof_opt_out` obligations were authored through
  `save_record` publishes and merges through this same path with its sources
  unchanged in the checkout and in the candidate tree. The live resolver still
  reads them: a malformed or unreadable one refuses with its own failure.
  Beside a manifest-selected generation they remain members of that generation,
  and a controlled carrier without its manifest still refuses.
  Missing proof credit and an unfinished or absent review do not refuse
  publication either, and the live record need not be in `review`: it is
  published with the parent status it actually holds, and no review transition is
  required or written. A record already `done` publishes too: the chain keeps
  its two commits and the completion truthfully changes nothing. What refuses is mechanical failure: an unreadable or
  malformed record or carrier, a generation `W` holds that the checkout no longer
  selects, a WK ref that moved off the selected candidate's own history, a moved
  ref, or a Git or forge fault. Each keeps its owner's own code and message.
- **Publication synchronizes canonical authored state first.** Under the existing
  same-WK authority exclusion, `workspace_publish_work({subject})` captures the
  complete orchestrator-maintained canonical WK and its required authored
  sources and persists them above the exact WK tip through the existing
  persistence owner. Record bytes are compared even when the generation is
  unchanged. A controlled generation, saved authoring sources without a
  generation, and a record with neither all use this path. Absence creates no
  generation, manifest, proof or review credit. Integrated implementation bytes
  are preserved. The live canonical record is unchanged.
  Publication then prepares and authenticates the candidate of that resulting
  exact tip, constructing an absent candidate or replacing an older selection
  on the same WK history. No separate sync, inspect or advance call is needed.
  Wrong identity, divergent history, source/ref movement and internal held-version
  mismatches still refuse. Inspection and historical reads remain read-only.
  Before the first mutation, the existing handoff observes confirmed landing;
  landed publication and unavailable landing observations retain their protection.
  Recovery may reclaim the deterministic absent checkout's stale Git registration
  without pruning unrelated worktrees. Existing checkouts must pass the normal
  binding and cleanliness checks. Configured CCE decisions remain controlling.
- **The fence holds before any external effect.** Repository, WK, fork, tip,
  candidate identity, tree, parent and controlled generation are rechecked under
  the existing exclusion before the branch or the proposal is touched. A moved or
  foreign input, an inconsistent candidate identity, tree or parent, or
  generation drift refuses with zero publication. Configured CCE denial is
  enacted; the absence of a configured decision is not a local denial.
- **Publication creates, observes or refreshes one publication and nothing
  more.** The result reports the exact candidate and proposal identity and the
  truthful effects. Repeating a handoff recovers the same proposal and the
  already-published closeout chain rather than opening a duplicate or appending
  closeout commits again; when the canonical record carries permitted
  coordination changes it replaces that same publication (see Repeat handoff
  below). A branch present at bytes outside the authenticated closeout chain
  refuses rather than being republished, and publication neither merges nor
  completes the WK on the base branch.
- **Closeout preserves the published bytes.** Before initial publication, both
  workflows keep `C` beneath exactly two WK-only commits carrying the actual
  applicable closure evidence under the parent status the live record actually
  holds, and then the parent's transition to `done`, so
  the initially published pull request already carries parent status `done`;
  that status is branch-local until a confirmed merge. A workflow without
  terminal review has no terminal-review record fabricated for it. Merge takes
  the exact authenticated pull-request head only on confirmed mergeability and
  adds no commits. It requires no lifecycle status of the local record; it
  requires that record to be exactly the published closeout record or, once the
  merge is confirmed, the published completion record, whatever status they
  hold, and an unmerged, unknown, moved or foreign state leaves the
  canonical parent exactly as it was. The confirmed merged base record is canonical, and a reconciliation
  failure is a typed partial success.

## Handoff destinations and landing observation

Handoff hands off the same authenticated candidate and closeout chain whatever
the destination; only the transport and its evidence differ. The destination is
resolved from the launcher-frozen main repository's Git configuration before
any effect, never from caller input.

- **Selection.** `agent-launch.handoffDestination` is the explicit selector:
  `local`, `git:<remote>` for plain Git delivery to that remote whatever its name
  or URL (including a local bare repository), or `hosted:<remote>` for hosted
  branch-and-proposal publication over that remote's canonical HTTPS identity.
  Without a selector, a repository with no remotes hands off locally, a
  repository with an `origin` remote publishes hosted through it, and any other
  remote set refuses `handoff_destination_unselected`: an absent `origin` is not
  the absence of remotes, and no destination is guessed. A multi-valued or
  malformed selector refuses. No origin, credential, GitHub URL or pull request is
  ever fabricated.
- **One failure, one cause.** A failed observation or delivery on the selected
  destination refuses with its original Git failure as evidence (`remote_invalid`
  for selection and remote identity, `git_failed` for local and Git transport)
  and never selects another destination; a failed hosted publication is never
  turned into a local success.
- **Who corrects a refusal.** Every forge and landing refusal is a
  `no_supported_route` carrier whose recovery names the responsible actor and the
  required condition where the refusal's own facts establish them: an absent
  handoff executor or landing observer is the operator's server composition
  (`missing_component` names it), a malformed `assigned_unit` is the caller's, a
  destination selector or remote URL configuration refusal
  (`handoff_destination_unselected`, `handoff_destination_selector_ambiguous`,
  `handoff_destination_selector_invalid`, `url_rewrite_configured`,
  `remote_fetch_url_not_unique`, `remote_push_url_not_unique`,
  `remote_push_url_diverges`, `remote_url_not_canonical_https`) is the operator's
  main-repository configuration, and an executor composed without its main
  repository or candidate resolver or observer is the launcher's. The landing
  observer distinguishes its own request defects the same way:
  `assigned_unit_invalid` (the caller's WK id; no other WK is guessed),
  `main_repository_missing` and `authenticated_handoff_observer_missing` (the
  launcher composition's, naming the `missing_component`). The executor and the
  observer state these on the refusal they make, and the route publishes them
  unchanged. Any other refusal (an unreadable remote, a Git transport failure, an
  eligibility or publication disagreement) publishes `responsible_actor: null`
  with the category and reason whose change is required, rather than a guessed
  owner; contradictory and unavailable landing observations keep their own
  causes and are not refusals.
- **The refusal detail is the producer's diagnosis.** A forge executor
  refusal's detail crosses exactly: no member is dropped for its name (`message`,
  `token` or any other), and no string, array, member list or depth is clipped.
  A value that is not plain data (an Error, a reference back into its own
  ancestry) crosses as its own diagnostic capture and is published as its cause
  chain. Raw process output (`stdout`, `stderr`, captured runs, stacks) is
  withheld by the shared dispatch failure projection and the complete original is
  retained once for the operator when the refusal occurs; a `recovery_detail`
  carried as ordinary data is published as data and grants nothing. No refusal offers a call, and handoff,
  merge and landing authority are unchanged. An unresolvable `repo` is the
  repository-resolution owner's `workspace_repo_resolution_invalid` refusal.
- **A candidate-resolution failure is published as the failure that was
  thrown.** The terminal-candidate coordinator forwards a construction or
  recovery exception unchanged: the value its owner threw is the value the
  publisher receives, with its own type, message, code, details and cause chain.
  Nothing is wrapped around it, no generic message or code stands in for it, and
  it is never classified as unknown. The refusal's `evidence.cause_chain` begins
  with that failure, each level carrying its name, message, code and structured
  details, and the complete capture (every property and trace) is retained for
  the operator and named by `retained_evidence`. A generation that the exact
  `W` holds but the checkout no longer selects therefore reaches the caller as the
  generation owner's `agent_launch.controlled_contract_generation.w_authentication_failed.v1`
  refusal with `details.condition: "exact_w_generation_unselected"`, the carrier
  and manifest counts it observed, and that owner's message. `stage`, the recovery verdict in `reason`, and
  `subject.assigned_unit` (the WK the call was made for) are the call's context
  beside the failure; they are never its identity. `recovery_detail` is present
  only when the coordinator recorded a typed candidate fact for that exact value,
  and is absent otherwise. A thrown value that carried no code is given none, and
  an absent fact stays absent. The recovery prerequisite names the failure in its
  owner's words. Reporting a failure authorizes nothing: it publishes nothing,
  authors no generation, changes no opt-out, selects no other WK and starts no
  recovery, and the retained original is read back without publishing again.
- **Every executor category has one public identity.** The seven executor
  categories map to registered cause-neutral identities (`request_invalid`,
  `remote_invalid`, `eligibility_refused`, `policy_boundary_refused`,
  `publication_disagreement`, `publication_indeterminate`,
  `git_transport_failed` under `agent_launch.wk_forge_handoff.*.v1`); the native
  category, reason, detail and effects cross beside the identity unchanged. An
  undeclared category is published as `unclassified` with
  `launcher_transition.backend_refusal_identity_unknown.v1` and its original
  captured. The policy-boundary identity is not an authenticated CCE deny, and
  neither a category nor a policy object copied into the detail grants authority.
- **A caller reads the complete diagnosis through the task.**
  `workspace_publish_work({subject})` answers within the configured inline
  admission bound with the producer's result, the blocker and the refusal
  carrier. The complete answer is saved once through the selected-response
  owner; when it fits the bound it is also the first answer. When it does not,
  the first answer keeps the failure identity, the affected WK and every
  diagnosis member that fits whole, smallest first (`effects`,
  `uncertain_effect`, `create_outcome`, native reasons), and leaves each larger
  member out whole: `delivery.omitted_diagnosis` names it, with its originating
  failure's name and code (and message when that fits) for a member that
  carries a cause chain, and `delivery.complete_diagnosis_delivered` is `false`.
  No member is kept or dropped for its name, and nothing is clipped, redacted,
  paged or spilled. `next_calls` carries the one `workspace_read_wiki` read of
  the saved source (`delivery.read_by` names the same call); following it
  returns the saved original whole, with the complete cause chain, after
  authenticating the session and the source, and publishes, mutates and observes
  nothing again. No caller opens a file, follows a path or checks a digest. Raw
  process output and traces are in neither answer; the complete capture stays
  with the operator-evidence owner named by `retained_evidence`. When the answer
  cannot be saved, `delivery.retained` is `false` and `delivery.failure` reports
  the actual storage failure (its operation, subject, code and cause, without
  its raw trace) beside the producer's result, identity and known and uncertain
  effects; no saved answer or read is offered and the publication is not
  repeated. Such an answer is bounded the same way and names the members it does
  not carry in `diagnosis_fields_not_delivered`. Those members are then not
  obtainable: the selected-response owner and the operator-evidence owner both
  store in the response state that failed, and no owner retains or serves the
  complete original under that obstruction. The route-level `error_log`,
  `error_log_failure` and `facts_not_inline` members belong to the lower-level
  forge handoff route projection, which the shipped server does not register;
  they are not part of the public task's answer.
- **A caught failure keeps its original.** Every executor catch that answers
  with a reason also carries the thrown value as its diagnostic capture
  (`evidence`, or `create_evidence` for a thrown pull-request create), with its
  native code, properties and nested causes, beside the `stage` or `phase` and the
  `subject` it concerned. Candidate authentication reports
  `terminal_candidate_binding_moved` only for a disagreement its owner observed
  and typed (a candidate binding mismatch, moved input or candidate ref, stale
  controlled generation, a materialization that disagrees, or a checkout binding
  check), with the observed facts under `observed`; any other authentication
  failure is `terminal_candidate_authentication_incomplete`. The generation owner's
  typed exact-W disagreement keeps its expected and actual tips. A thrown
  publication (`terminal_candidate_publication_threw`) reports the hosted effects
  known when it was thrown and names a mutation in flight as `uncertain_effect`;
  before those effects are tracked it states `effects_observed: false` rather than
  claiming none. A thrown create stays beside whatever its one re-observation
  found; an exact singleton after it is still a success, and nothing is retried.
  A thrown existing-publication observation
  (`existing_publication_observation_threw`), a controlled-contract authority
  failure (`controlled_contract_generation_authority_refused`) and an invalid
  authority context (`stage: "authority_context"`) keep theirs the same way. A
  mutation route retains the complete original once; a read observation retains
  no failure original and says so (`retained_evidence.reason:
  "observed_by_read"`). No correction owner is inferred for these failures.
- **A hosted forge command keeps its native outcome.** The `gh` runner returns
  the command's argv, exit status, signal and complete output, unsliced. A
  command that could not start carries the native spawn error and no output; one
  stopped by the existing output bound carries `capture_failure` and the bytes it
  returned, so the capture is reported incomplete rather than whole. Each of the
  seven hosted adapter operations (probe, remote-branch observation, branch
  publication, proposal listing, proposal creation, landed-proposal observation
  and exact-head ancestry) keeps a failed command's or an unreadable response's
  original as `evidence` beside its unchanged native reason, and a failed command
  is never reported as a malformed response. The original names the operation
  and holds the command result, with the native or parser error as its cause.
  Native output stays in the retained original: forge text is not reinterpreted
  as a cause, and when the forge supplied only a status and output, that is the
  whole diagnosis.
- **An unreadable proposal is not a disagreeing one.** A proposal property,
  response or iteration that throws refuses `publication_indeterminate` as
  `observed_pull_request_unreadable`, `pull_request_observation_unusable` or
  `pull_request_transport_failed`, with the `page`, `item`, `property` or `step`
  and the thrown value as caught (`null` and `undefined` included); the offending
  getter is not read again. Only a completed observation of a disagreeing
  repository, base, head, number, state or URL is
  `observed_pull_request_identity_mismatch`. Neither yields an authenticated
  proposal.
- **A mutation and its re-observation keep both answers.** A branch push or
  pull-request create whose own answer is not a confirmed success (thrown,
  `uncertain`, `lease_failed` or another returned value) keeps that answer's
  original (`publish_outcome` and `publish_evidence`, or `create_outcome`,
  `create_kind` and `create_evidence`) beside the one re-observation's facts and
  original (`observation`, `evidence`). Nothing is pushed or created again. When
  the re-observation confirms the exact effect, the result is the same success
  and carries the superseded answer as its `diagnostic` (reason
  `unconfirmed_mutation_answer_superseded_by_observation`), apart from its
  identity fields. A refresh update whose re-observation could not be made is
  indeterminate; only an observed other head or a deleted branch disagrees.
  Whatever refuses or throws later in the same publication -- the
  re-observation throwing, a boundary guard, a later proposal observation --
  carries each earlier unconfirmed answer's original under
  `attempted_mutations` (unless the refusal already carries it inline) beside
  its own cause, and names an effect not yet confirmed as `uncertain_effect`.
- **A probe that did not authenticate keeps its cause.** A
  `human_reconciliation_required` result carries `diagnostic` with the probe's
  `state`, native `reason` and command original, and an existing-publication
  read refusing `authenticated_forge_required_for_existing_publication` carries
  the same under `probe`. `workspace_publish_work` projects an accepted result's
  `diagnostic` exactly as a refusal's detail: bounded in the first answer, its
  complete original retained once and the saved answer read back whole, while
  the result's kind, identity and effects stay whole in both.
- **Local and Git material.** Local and Git handoff record the authenticated
  closeout head `D` in the product-owned ref
  `refs/agent-launch/wk-handoffs/<initiative>/<WK>/<C>/local` or
  `.../<C>/git/<remote>` in the main repository, written only under its expected
  old value (absent for a first handoff). The
  ref name retains the destination the candidate was handed to: when the
  current selection names a different destination, handoff and landing
  observation refuse `handoff_destination_changed` with no effect (observation
  reports `unavailable`) rather than re-reading or repeating the handoff under
  the new selection. Git delivery first pushes `D` to
  `refs/heads/handoff/wk/<initiative>/<WK>/<C>` at the selected remote's
  validated URL, with a lease on its expected old head (absent for a first
  handoff), so no remote-tracking ref moves; the handoff ref is written only once
  the destination branch is observed at the requested head, so a failed delivery
  leaves the ref where it was. A retry or a fresh process authenticates the same
  ref and appends no second chain. The result reports `transport`,
  `destination`, `handoff_ref`, the exact head, the base branch and the actual
  `effects`, and names the human landing action with `next_action`; it carries
  no repository coordinate, pull request or proposal authority. Handoff never
  moves a landing base, merges, or completes the WK.
- **Landing a local or Git handoff.** The human Git actor may land it with the
  explicit `agent-launch forge-merge WK-#### [--checkout <path>]`. There is no
  proposal: the command fast-forwards one checkout, by default the main
  repository's, with an ordinary `git merge --ff-only` to the exact
  authenticated head `D`. The checkout's HEAD must be the configured base branch.
  For a local handoff it must share the main repository's Git storage (the main
  checkout or a linked worktree). For a Git handoff, a separate clone is
  accepted only through a remote whose unique, unrewritten URL is the
  destination's, and `D` is fetched from the destination's handoff branch into
  its object store alone when absent. `--checkout` only locates the checkout; it
  never selects the handoff, its head, destination or base. Before merging, the
  command stages the coordination files Git would otherwise refuse to overwrite:
  the paths in both the authenticated controlled generation's population (the WK
  record, descriptors, selected carrier-set manifests and runtime-package
  members) and the structural diff from HEAD to `D`, when Git records their
  working content with `D`'s exact blob and mode and their index entry is
  absent, HEAD's or already `D`'s. Canonical JSON equality is not a match.
  Persisting a later generation keeps the earlier generations' runtime packages
  in the WK tree, so `D` can also carry those files. Such a path belongs to the
  population only when a commit of the authenticated WK ref's own history after
  the handoff's captured base selected that package through its visible
  carrier-set manifest and held it exactly as that manifest describes, and `D`
  holds that commit's exact blob and mode. A path under the generation-archive
  directory without such a persisted selection is not included.
  The one admitted difference is the handoff's own completion transition:
  after handoff the live WK record is ordinarily the closeout record `K`, with
  whatever parent status it actually held, and `D` changes only that status to
  `done`. No status is required of `K`. The result's `record_transition` reports
  the statuses the two records actually hold, and is `null` where `K` is already
  `done` and `D` holds the same record, so nothing is installed. When the closeout-chain
  owner authenticates this handoff's `C -> K -> D` chain and the working record,
  and any staged entry for it, hold `K`'s exact blob and mode, the command
  installs `D`'s exact record bytes and mode after every other selected path is
  validated, stages it and merges. Any other difference in the record, such as a
  later entry, title, scope, timestamp or attachment change, refuses.
  Preparation, the fast-forward and any restoration of that record hold the
  checkout's canonical WK writer lock, so an update by a writer that takes it is
  either observed by preparation, which then refuses, or made after the command
  is done with the record. An editor outside that lock is detected only by the
  command's observed-state checks.
  Differing working content or independently staged content refuses with its
  path, and unrelated working files and staging are never touched. When the
  refused path is the WK record in the main repository's own checkout, the
  refusal also carries `handoff_refresh`, the handoff owner's read-only refresh
  assessment of the canonical record against the authenticated publication. It
  applies the repeat handoff's own authentication, landing and permitted-change
  rules and builds, writes and publishes nothing. When the record carries a
  permitted change to an unlanded publication (for example a notes edit made
  after handoff), it reports `applicable: true` with the published head, and the
  refusal's `next_calls` holds the one recommended
  `workspace_publish_work({subject})` call that refreshes it, after
  which landing can be requested again. Its success predicate is
  `forge_handoff.live_record_published` `is_true`; the refusal's
  `observed_facts` carries that fact as `false`. A local or Git handoff result
  reports `live_record_published`: after its effects, whether the canonical
  record's authored content is the returned head's `K` (or its `D`), by the same
  comparison the refresh decision uses. When that cannot be observed, the result
  carries `live_record_published_unobserved` with the specific cause instead and
  no value. The registered handoff route publishes only an observed value, in its
  response's `observed_facts` under the same identity, so an unobserved fact
  never satisfies the predicate. The call is recovery guidance, not a
  promise of success: the repeat handoff rechecks everything before any effect.
  Otherwise `handoff_refresh` reports `applicable: false` with the owner's
  specific reason, such as a protected-field projection cause,
  `published_handoff_already_landed` or `live_record_matches_publication`, and no
  call is offered. Attachment conflicts, a missing record and other checkouts
  are not assessed. The merge itself never refreshes or publishes. The index is
  updated under Git's own `index.lock`. A failure after the record is installed,
  a diverged base, or any other Git refusal of the fast-forward keeps its cause
  and restores the prior record bytes and mode and the entries the command
  staged, only where they still hold what it wrote; a later independent file or
  staging change is reported as not restored, not overwritten. After a completed
  fast-forward nothing is restored, and a later landing-observation failure
  reports the completed movement. It never pushes, forces, resets, stashes,
  creates a merge commit or resolves a conflict. Landing is then read through the landing
  observer: a local handoff succeeds only when it reports `landed`. For a Git
  handoff the local fast-forward is local completion; unless the observer sees
  the destination's base carrying `D`, the result reports `remote_landing:
  "pending"` and carries no landed publication. A repeat after landing changes
  nothing.
- **One read-only landing observer.** `workspace_check_landing` and
  dependency provisioning consume the same observer. It re-authenticates the
  existing handoff through the handoff authority owner's read-only observer.
  Internally, `createWkLandingObserver` accepts `(wkId, selection?)`; omission
  resolves current once under the same WK exclusion. The closed publication
  selector names an immutable candidate version, exact head, destination and
  hosted proposal number. It locates evidence without granting authority or
  configuring a provider. Explicit reads authenticate the recorded generation
  and exact closeout chain through the existing owners. A displaced head is
  credited only after the landing owner proves its actual base ancestry (or
  exact merged proposal and bound ancestry); otherwise the requested selection
  remains an unauthenticated echo in an unavailable observation. Pending truth
  still requires the current candidate's materialization and generation checks.
  A fresh `workspace_check_landing` observation may save its answer through the
  selected-response owner for a later authenticated read; that is its only
  stored effect, and it publishes, merges and changes no canonical state.
  Reading an already saved answer returns it whole and observes nothing again.
  Repeated and cold reads reauthenticate durable facts, preserving object-cache
  acquisition even if later authentication fails. The handoff owner's
  `projectAuthenticatedWkPublicationSelection` derives the reusable selector
  only from an authenticated publication result. The observer
  reports `awaiting_human_landing`, `landed`, `contradictory` or `unavailable`,
  each with its original cause. Local and Git landing is read from the actual
  base history — the main repository's base branch, or the destination's, whose
  missing objects are fetched into the object store without moving any ref — and
  is `landed` only when the exact handed-off head is an ancestor of the observed
  base tip; the carrier is `git-landed-publication-identity.v1`. Hosted landing
  is the merged exact proposal and its bound ancestry, as the
  `forge-confirmed-landed-publication-identity.v1` carrier. A hosted landed
  observation or ancestry lookup that could not be made is `unavailable` with its
  reason (`authoritative_observation_failed` or `exact_head_ancestry_unobservable`)
  and original; only a completed comparison proving another history is
  contradictory. A Git destination
  branch that disappeared or moved without landing is contradictory. The observer
  never publishes, creates or merges a proposal, reconstructs or materializes a
  candidate, executes proofs, or reconciles the canonical record; explicit
  closure remains its own operation. Its one possible effect is that object
  acquisition, and every observation reports what it actually did in that
  invocation as `effects.object_cache_fetch`: `not_attempted` when no fetch
  started (a local or hosted observation, a destination base tip already in the
  object store, a destination base that is absent or could not be read, or a
  refusal before the base is read); `completed` when this invocation's fetch
  finished successfully, which a later missing tip, ancestry failure or
  destination-branch failure does not erase; `uncertain` when a fetch started
  and its command failed, so acquired objects may remain. The value is the fetch
  owner's own account of its attempt, never derived from the landing state or
  from which objects exist afterwards, and it describes one invocation: a later
  observation of the same landing reports `not_attempted` once the objects are
  local.
  The observer mints a reusable authenticated selector for default reads too,
  while the branded handoff is still available; unavailable explicit selections
  remain unauthenticated echoes. The existing runtime adapter forwards
  `{assigned_unit, selection?}` unchanged to this observer.

  `dispatch-tools/landing-status-route.mjs` also exports the registered
  `CHECK_LANDING_INPUT_SCHEMA`, `createCheckLandingTask`, `registerCheckLandingTool`
  and pure `buildCheckLandingRequest`. The closed request is
  `{subject: "WK-####", selection?: PublicationSelection}`. Its selector schema
  comes from the handoff owner's `createWkPublicationSelectionSchema(z)` and
  validator. The trusted host supplies `workspace: {repo, dir}`, the existing
  `wkLandingStatusAdapter`, session `env` and response-owner `responseEnv`.
  Internal calls enforce the incumbent orchestrator/operator entitlement before
  observation. Results identify the actual subject and session authority,
  current versus explicit request, selected identity, landing state, authority,
  base, carrier, acquisition effects and complete distilled cause, without a
  duplicate handoff binding. Missing corrections name their owning capability;
  a request builder remains explicitly non-callable until canonical eligibility
  and a serving request schema both exist.

  The task's internal `respond(request)` returns `{source, originalRequest,
  result}`. It retains the semantic carrier once through the unchanged selected
  response owner, bound to route, repository, WK, session authority and actual
  request/observation identities. `handler` and guarded `call` return that owner's
  selected-full result directly. Transport retention is reported separately as
  `delivery.transport_retention`; it is distinct from observer acquisition and
  creates no observer journal. Retention failure preserves the observed effects
  and original transport cause without re-observing. The internal
  `readOriginal({subject, source})` seam and `CHECK_LANDING_ORIGINAL_INPUT_SCHEMA`
  reauthenticate the session binding and return the retained semantic facts
  unchanged after process replacement, alongside the original source locator and
  supported `next_calls` for this read, without changing the saved carrier,
  invoking the observer or creating new retention. Optional trusted
  `ownerCall(locator)` and `ownerRequestSchema` bind the existing retention to its
  adopted semantic reader. This composition adds no public read fields or tool.
  Production registration, role grants, discovery, incumbent retirement and
  caller/continuation adoption remain a joint cutover; the incumbent landing
  route remains the registered owner until then.

## Terminal candidates select material, not review execution

A launcher-built terminal candidate contributes its already-selected immutable
material to the single advisory-review pipeline used by ordinary reviewer and
redteam dispatch. Terminal coordination continues to own candidate construction
and publication, but it owns no separate reviewer executor, run, monitor,
settlement, receipt, recovery, or replay path. The review action remains
read-only and action-local, and its output creates no lifecycle authority.

The managed post-worker lifecycle constructs and publishes the candidate after the
final implementation slice integrates, whether or not the canonical record
designates a `terminal_whole_wk` unit. It never dispatches the terminal reviewer:
terminal review runs only when a coordinator explicitly dispatches that unit. A
record that designates no such unit still gets the publication candidate, with
no terminal review unit or review result attached.

The advertised terminal reviewer call is subject-addressed:
`{role: "reviewer", subject}` for the canonical slice whose `review_purpose` is
`terminal_whole_wk`. Without an explicit `diff_base_sha`/`reviewed_sha` pair, the
pipeline asks the backend candidate owner for that subject's material. The owner
requires a published `refs/agent-launch/terminal-current-v2/<WK>` selection and
authenticates it for this action through the same cold recovery used by forge
publication. That recovery authenticates the current controlled generation at `W`,
recomputes the candidate identity from `B`, `W`, and that generation, and verifies
the candidate object and private checkout. Candidate preparation and cold recovery
perform authentication only: they do not execute product validation or proof
attempts. Any required verification is a separately authorized
`verify_proof` operation, and missing evidence remains missing rather
than triggering execution. Recovery then binds the review context against the
live canonical record. The selected `C` must
still be the published selection. The review
materializes `C` against `B` as material kind `launcher_terminal_candidate`.

Selection re-authenticates on every dispatch, so it behaves identically in a fresh
backend and after the worker identity is retired. A retained process-local
context or an earlier review action is not material authority. An unpublished
candidate refuses as `terminal_candidate_unpublished` without reconstruction. A
foreign, moved, stale-generation, or otherwise unauthenticated candidate refuses
with the recovery owner's verdict. Both refuse before reviewer execution as
`agent_launch.advisory_review.material_invalid.v1` with reason
`terminal_candidate_unavailable`, and never fall back to canonical design
material. The request cannot supply a candidate object: the registered
`start_agent` declares `terminal_candidate` and
`reviewer_launch_identity` only so it can refuse them as
`caller_supplied_identity` before admission, material selection, recovery, or
execution. Canonical WK and
non-terminal design subjects keep canonical design material, implementation
slices keep their retained delivery, and an explicit SHA pair keeps
`explicit_sha_range`.

## The authenticated controlled-generation envelope for terminal candidates

Terminal-candidate authority includes one owner-produced
`controlled-contract-authenticated-generation.v1` envelope. The envelope binds the
canonical repository and WK, the canonical record blob observed in exact `W`, the
exact direct `W` commit, the complete ordered carrier census and bytes, and the
complete ordered visible-manifest census and its deterministically derived identity.
The manifest resolver cannot produce this envelope or its identity: it supplies only
selection facts, while the launcher attachment primitive performs one asynchronous
exact-`W` observation and delegates construction to
`wiki-core`'s controlled-generation authentication owner. Both synchronous and
asynchronous injected Git runners cross that same awaited boundary.

Hot preparation, cold reconstruction, candidate advance, and forge handoff consume
that envelope unchanged. Where the WK has no controlled contract, preparation,
reconstruction, recovery and forge handoff consume the same owner's
`controlled-contract-generation-absence.v1` observation instead: the canonical
repository, the WK and the exact direct `W`, and nothing else. It is not an
envelope. It has no digest, count, manifest identity or descriptor, every
consumer that requires an authenticated generation refuses it, and only the
owner's own observation is accepted: an omitted, copied or look-alike value
refuses as an unauthenticated generation does. Terminal paths reject a null manifest identity, incomplete
or contradictory observations, a proper subset, and any resolver-, caller-, fixture-,
metadata-, or coordinator-supplied identity. Candidate CAS remains inside the shared
same-WK authority exclusion, and forge retains that exclusion through branch and
pull-request mutation, so generation-only, `W`-only, or simultaneous movement cannot
authorize a stale effect.

The current generation is authenticated by one owner in the attachment
primitive, `authenticateCurrentControlledContractGenerationAtW`, with the closed
request `{repoRoot, wkId, expectedWkTipSha?, expectedGeneration?}`. It always
resolves and binds the current complete generation, authenticates it at its exact
`W`, and returns that binding with the owner-minted envelope; no caller `W` or
envelope is ever authoritative. It has three forms. With no expectation it
observes what is current. With `expectedWkTipSha` it refuses a different live `W`
before authenticating anything, reporting the expected and actual tips. With
`expectedGeneration` as well, which requires the expected `W`, the supplied
envelope must itself be owner-minted for this repository, WK, and `W` and equal to
the envelope authenticated here. An expectation is present whenever its key is: a
supplied `null`, `undefined`, malformed, copied, or foreign value refuses and is
never read as omission. A missing current generation and a mismatched expected
`W` refuse with the exact-`W` authentication code and a `condition` of
`current_generation_absent` or `expected_w_mismatch`.
`authenticateCurrentControlledContractGenerationStateAtW` is the same owner with
the same request and the same checks for a consumer that needs the current state
rather than a generation. Where no generation is current it does not refuse: it
observes `tree(W)`, refuses with `condition: "exact_w_generation_unselected"`
when `W` holds a carrier or manifest of the WK, refuses when a generation
appears or `W` moves while it reads, and otherwise returns the absence
observation with a null binding. An `expectedGeneration` must then be that same
absence, and an absence expected of a WK that now has a generation refuses.
Terminal candidate preparation, recovery and read-only observation, forge
handoff and forge merge use this state form; forge handoff and forge merge use
it with both expectations, so a WK with no controlled contract is published and
merged through the same authentication as any other. Preparation, recovery and
handoff forward its refusals unchanged, and a merge refusal
(`controlled_generation_identity_unverified`) carries the owner's failure whole
as its `evidence`. For a local or Git handoff of such a WK the checkout's owned
coordination population is the WK record and the WK's saved proof-authoring
sources. Each source is prepared as any other owned path: one already holding
the published bytes is staged for the fast-forward, and one whose live bytes
differ refuses with `selected_path_content_differs` naming it, with the live
file left exactly as it is. Candidate status uses the observation form and
candidate advance the expected-`W` form, through this same owner rather than a
resolve, bind, and authenticate sequence of their own; status keeps
`candidate_identity_invalid_or_moved` for an absent generation, and advance keeps
its generation-absent and input-moved refusals. Advance calls the owner twice.
Its first call expects only the snapshot `W` and keeps the envelope returned. Its
final call, after derivation and immediately before publication, uses the form
with both expectations: the same `W` and that exact envelope. The owner alone
decides authenticity and equality, and the runtime compares no envelopes itself;
an absent generation and a moved `W` keep their own refusals there too, and any
other final refusal is
`agent_launch.terminal_candidate.advance_final_recheck_failed.v1` carrying the
owner's code as its cause. Nothing is published after a final refusal, and `W` is
not reselected, a changed generation is not adopted, and publication is not
retried. Advance reads the record blob in `W` with the repository object format
that the stale evaluation's read-only version authentication established, carried
only in the evaluator's private snapshot; a snapshot without it refuses at the
record read, and no format is inferred from an object id. The terminal-candidate
coordinator uses it the same way, inside the authority exclusion it already
holds: hot preparation with the integrated `W` as the expected `W`, and cold
recovery in the observation form. Nothing is derived, materialized, or published
after it refuses, and each refusal keeps that operation's own cause: only the
refusal the generation owner itself identifies as a current generation that is
not the one persisted in `W` is `controlled_generation_stale`, before and after
explicit candidate preparation alike. Every other refusal is forwarded as thrown
with its type, code, message, details and cause: a generation `W` holds that
nothing current selects, a mismatched expected `W`, a WK ref that moved or could
not be read during authentication, and a current generation that could not be
read. An absent generation
is not a refusal there. Publication alone answers a current generation the exact
`W` does not hold by persisting it and authenticating again; hot preparation,
cold recovery and read-only observation keep the refusal. This owner checks the current
generation's descriptor mechanics; the full historical validation described below
belongs to the exact-commit read and is not applied here.

The same manifest-aware generation selector can also read one exact immutable
commit instead of the live repository. The launcher's stored-tree observer pins
the commit and its tree, then supplies only that tree's contract-store entries and
ordinary (`100644`) blob bytes; `wiki-core` applies its whole-record manifest
fence, visible/embedded manifest agreement, selected-member census, duplicate
detection, proof-authoring sources, and association validation to that
observation, and returns the existing `controlled-contract-resolved-generation.v1`
selection facts. Every manifest, selected member, and association source comes
from the pinned tree: a missing, non-ordinary, contradictory, or unreadable member
refuses with the selector's own failure and the affected member, and nothing is
completed from the working directory. A source with no published manifest for the
record refuses; the legacy store-root population is read only from the live
repository. This is an internal source-selection input, not an MCP argument, and
it performs Git reads only.

The launcher attachment primitive exposes that read as one internal operation,
`authenticateControlledContractGenerationAtCommit`, with the closed input
`{repoRoot, wkId, commit}`. `commit` is one exact full nonzero commit identity; a
branch, tag, revision expression, abbreviated or tree identity, and any
caller-supplied binding, generation, observation, ref, or authority field refuse.
The operation resolves only the repository and Git-directory identity, selects and
observes that commit's generation, and returns the envelope the same
authentication owner constructs for it, naming that commit as `W`. It is not an
MCP route or a role grant, and the selector's and the authentication owner's
refusals pass through with their own code and details.

`authenticateControlledContractGenerationStateAtCommit` is the same operation,
with the same closed input, for a reader that needs what the commit held rather
than a generation. It observes that commit's contract store through the same
pinned source observation the selector reads. Where the store holds no carrier
and no carrier-set manifest of the WK, it returns the absence observation bound
to that commit; where it holds any, it authenticates the stored population
exactly as above. Absence is therefore established only from the exact commit:
a carrier without its published manifest, an incomplete manifest, a malformed
active path and a failed read all refuse with their owner's failure and are
never read as absence.

Authenticating a commit grants no current authority. The operation reads no live
WK record, carrier, manifest, or WK ref, creates no lifecycle binding, and says
only what that commit held, so it keeps returning an earlier generation after the
live `W`, generation, or files move or disappear. The exact-`W` authenticator for
candidate, advance, and forge effects still requires the live WK ref and the
current canonical generation, and refuses a binding whose `W` has moved.

One immutable candidate version is authenticated the same way, by the
terminal-candidate coordinator's internal `authenticateHistoricalTerminalCandidate`
with the closed input `{mainRepo, wkId, versionIdentity}`. `versionIdentity` is the
64-hex candidate-version identity, not a Git commit and not a currentness claim,
and it alone selects: only that version's immutable ref is derived and observed,
and an absent, symbolic, non-commit, or foreign selection refuses without falling
back to the current selection. Everything else is read from the selected version's
own objects. The WK record is the blob in the candidate's tree, identified by the
contract digest the candidate records; the base branch is the WK's captured base
naming the candidate's recorded `B`; the controlled-generation state is the one
its recorded `W` held, authenticated from that commit in the state form: the
generation it selected, or the absence of one where the WK had no controlled
contract, with or without a recorded proof opt-out. A candidate that records a
different state than its recorded `W` holds does not reproduce and refuses. The recovered-candidate
verifier then applies its usual checks (repository identity, sole parent `B`,
`B` an ancestor of `W`, `tree(C) = tree(W)`, and the deterministic commit bytes),
recomputes the version identity, requires it and the candidate to equal the
selection, and re-observes the selected ref before returning, so a ref deleted or
retargeted during the read refuses. The live WK ref, canonical record, and current
generation are not read, and the record's review designation and validation
declarations play no part. The operation performs Git reads only and returns the
verified candidate binding with its version identity and version ref.

The same read can instead be selected by the candidate the current-candidate ref
names, through the coordinator's internal
`authenticateObservedTerminalCandidateVersion` with the closed input
`{mainRepo, wkId, candidate}`. `candidate` is the exact full commit the caller
already observed as the current selection: an expectation, not an authority, a
version, a ref, or a permission. The fixed current-candidate ref must name exactly
that commit; an absent, symbolic, non-commit, or different selection refuses, and a
replacement candidate is never substituted. No version identity is supplied or
searched for: it is derived from the verified tuple, and the immutable version ref
it names must already exist and name this same candidate, so an unpublished or
conflicting version refuses and no ref is created or repaired. Both refs are
re-observed before returning. The read does not require the candidate's recorded
`W` to still be the live WK tip and never uses the current generation for it, so
it returns the same candidate, `W`, generation, and version identity after the
live `W` or generation has moved; whether that `W` is still current is the
current-state evaluator's comparison, not this operation's. The result has the
same meaning and shape as the version-selected read.

That binding is historical evidence, not authority. The candidate primitive
records which bindings it derived from its own exact-ref observation and
refuses them at candidate construction, candidate-object derivation, current
binding verification, and version publication, including while that version is
still the selected one. A copy of such a binding carries no such record: it is not
accepted as historical evidence, and as an ordinary binding it must pass the
current checks, including the live WK ref. Candidate bytes, the metadata block,
version identities, and immutable refs are unchanged.

The candidate primitive also projects the compact diagnostic identity of one
authenticated immutable version, through its internal
`projectTerminalWkCandidateVersion`. It takes one value: either an authentic
version decision whose immutable version ref names its candidate (a `selected`,
`recovery`, or `superseded` decision; `unpublished` and `conflict` refuse), or the
exact completed result of a version-selected or current-selected read. A copy, a
serialized result, a binding before or after its verification, a generation
envelope, and the projection itself all refuse as a binding mismatch. The
projection is exactly `version_identity`, `candidate`, `base`, `wk`, `tree`, and
`controlled_generation`, where `controlled_generation` holds only `wk_id`,
`generation_digest`, `count`, and `manifest_identity`, or is `null` for a
candidate whose WK has no controlled generation; it carries no refs, paths,
carrier descriptors, review facts, or currentness. It is a synchronous projection
of an observation the caller already authenticated: it reads nothing and renews
nothing, so later ref movement does not change what an earlier observation
projects, and a caller that needs fresh authority authenticates again. The
projection is data only and is accepted nowhere as a binding, a version decision,
or a generation envelope.

### Plural immutable candidate versions and current selection

Frozen means immutable per candidate version, not singleton per WK. The primitive
owner is
`packages/agent-launch-cli/src/lib/terminal-wk-candidate.mjs`. It alone defines the
canonical candidate-version tuple, serializes and digests its identity, derives its
refs, constructs and verifies candidate commits, and performs current-selection CAS.
The tuple binds the canonical repository and WK, exact `B`, exact `W`, authenticated
controlled-generation identity, `tree(W)`, candidate format, and deterministic
candidate `C`. No coordinator, runtime route, status projection, caller, metadata
field, or prose may reconstruct any part of that protocol.

The immutable version ref is
`refs/agent-launch/terminal-candidates-v1/<WK>/<version-identity>`. Its final component
is the lowercase SHA-256 digest of the canonical candidate-version tuple. The ref may
be created only as part of the owner-controlled publication transaction and must
resolve to the tuple's exact verified `C`; it is never updated or deleted. Exact
authenticated replay of the same tuple converges on the same identity, ref, and
candidate without mutation. A later authenticated `W` or controlled generation
produces a different identity, immutable ref, and candidate even when other inputs
remain equal.

`refs/agent-launch/terminal-current-v2/<WK>` remains one launcher-authenticated
selection pointer, not the candidate artifact or its history. The owner publishes a
new immutable version ref and advances current selection through one expected-old
transaction under the durable same-WK exclusion after rechecking `B`, `W`, generation,
tree, candidate, and both refs. Same-input contenders converge; a moved expected-old
or any contradictory winner refuses without rewriting either candidate. All prior
version refs remain addressable. A valid version whose ref is not selected is
`superseded`, not invalid, and its review evidence remains immutable evidence for that
version only.

The terminal-candidate coordinator owns hot preparation and cold reconstruction
sequencing under the exclusion. The terminal-candidate runtime owns public status and
explicit advance sequencing. Both consume the primitive owner and may add no local
tuple, ref, construction, verification, or CAS implementation. Hot retry, cold
recovery, status, reviewer material selection, and forge handoff resolve one
explicit candidate version and return consistent current or superseded state.

Forge mutation has no versionless compatibility path. Branch publication, pull-request
mutation, closeout, and merge require one launcher-authenticated selected version
decision and its immutable version ref and current-selection observation. Review
receipts, results, and findings are not forge prerequisites. A historical state without that version
decision remains readable through observation surfaces only and cannot authorize a
forge effect. Merge consumes an authenticated handoff result minted only by the
handoff authority owner: the result a handoff in the same process returned, or a
fresh read-only observation of the already-published identity
(`observeAuthenticatedWkForgeHandoff`, bound in production by
`createProductionForgeMergeDependencies`). The observation re-authenticates the
exact selected candidate, its version and its squashed worktree from durable
authority, the same repository/base/branch identity the publisher binds, and the
observed branch and single proposal head. It never republishes, creates a
proposal, reconstructs or advances a candidate, or moves a ref, and a serialized
prior response or caller-supplied identity is never adopted. Merge forwards its
own live exclusion context; the observer validates it and does not reacquire the
lock.

When forge cold recovery crosses into the terminal-candidate coordinator, the
exclusion owner passes an opaque callback-scoped context bound to that exact
repository and WK. The coordinator authenticates the context before recovery and
does not reacquire the non-reentrant lock. The context expires before the forge
callback returns; missing, copied, stale, or mismatched contexts refuse. Ordinary
recovery entrypoints receive no context and continue to acquire the durable lock.

That same context-bound recovery accepts an optional expected candidate-version
identity. It is an equality fence, not authority: the coordinator compares it with
the version the primitive owner derives from the candidate being recovered, under
the live context and before any selected effect. For a present candidate the
comparison follows authentication of the existing candidate and precedes
version-ref convergence and worktree materialization. For an absent current
selection it follows the deterministic derivation and precedes publication, so
only inert unreachable objects can exist when it refuses. A different version
refuses as `terminal_candidate_recovery_expected_version_mismatch`, leaving every
ref and worktree as it was; the matching version recovers the identical `C`.
Authority, base, WK-tip and generation refusals keep their own causes. A caller
that supplies no expectation gets unchanged recovery. The forge handoff publisher
forwards an expectation it is given, unchanged, through its publication-state
resolver to this fence inside its own exclusion. Neither derives or compares the
version; a refusal is the coordinator's own failure, rethrown before any closeout
or forge effect.

Each candidate `C` freezes `tree(W)`, so the work-record blob inside that version is
the WK-branch snapshot. Trusted integration may later move canonical status and
coordination fields without changing the version's `C/B/W`. The lifecycle-difference
decision records those facts without treating either the frozen snapshot or live
status as candidate or review authority.

The original `start_agent` review result is the complete review
observation. It returns the captured advisory text directly, a bounded schema
observation, and `formal_attestation`. Ordinary reviews report
`requested:false`. When the launcher-selected canonical result contract is
`schema_constrained`, settlement reports `requested:true` and derives and durably
publishes the existing formal attestation in that same call, or returns a precise
unavailable annotation. The text remains usable in either case. There is no
second review-evidence/provenance/attestation append, settlement replay,
historical monitor reauthentication, or post-restart repair.

Forge closeout authenticates candidate and publication mechanics only. One
closeout-chain owner (`authenticateWkCloseoutChain`, over the pure
`authenticateWkCloseoutProjection`) authenticates the `C -> K -> D` chain that
forge handoff prepares before publication and that handoff retry and forge merge
recognize; it requires no terminal-review unit, review completion, or
review-specific commit content. A closing implementation slice may carry the
`integrated_delivery_sha` the integration record write added: the commit the
integration installed on the WK ref, which after a replay is not the original
delivery. The projection admits that value only when it equals the expectation
its caller established for that slice from the integration authority's producer
proof (see Producer-authenticated integrated-delivery evidence below), bound to
`C`'s own record as the historical contract and to the candidate's own recorded
`W`: the proof's WK tip is that `W`, or, after publication preparation has synchronized the WK
branch above it, the exact delivery is literally included in that `W` and that
`W` is literally included in the proof's WK tip. A delivery only the newer tip
holds, and a WK history rewound or rewritten away from the recorded `W`,
authenticate nothing, and authenticating an earlier publication this way selects
no candidate and grants no write. That authenticated integration transition (slice
`done` with the installed commit) closes the slice on its own, so a new slice
closure is optional; a bare `done` with neither a first canonical closure nor an
authenticated delivery is not a closeout. The live field alone, a substituted
delivery SHA, or any other change to the slice refuses. Handoff preparation keeps the stable outer
`local_WK_not_authenticated_against_candidate` reason and carries the
projection's own `reason` (`integrated_delivery_unauthenticated`,
`unrelated_slice_drift`, ...) with its slice and expected/observed identities,
plus the integration authority's failure reason when it could not establish the
delivery, through the launcher refusal and the registered response under the
cause-neutral eligibility identity `agent_launch.wk_forge_handoff.eligibility_refused.v1`,
which has no supported route. Chain
authentication on retry, existing-publication observation and forge merge
re-establishes the same expectation from the candidate binding; without it the
chain is not authenticated. The producer proof needs the retained slice delivery
ref and the canonical record's recorded value; when either is gone the closeout
refuses rather than accepting the field.

### Historical closeout projection

The following rules describe the existing projection's authentication of
retained candidate/closeout differences. They are not a field allowlist for
ordinary saved canonical content: subject-only publication synchronizes that
whole record and required sources before preparing its candidate. Standalone
design review status, task edits, regression lists, titles and requirements
therefore need no additional closeout exception. No content grants proof,
test or review credit. Movement during a call retains the existing source,
identity, delivery and expected-old fences.

Every integrated delivery beyond the historical candidate record is
authenticated on its own. Any number of implementation slices `C` holds may close by their own
authenticated integration transition; one slice's expectation never admits
another slice's value, so swapped, substituted or unauthenticated deliveries
refuse `integrated_delivery_unauthenticated` with the slice they were claimed
on. At most one slice `C` holds may still close by its first closure with no
authenticated delivery. A slice shaped after the WK branch was cut is not in
`C`'s record at all. It is carried only as an implementation slice the
integration marked `done` with exactly the commit the same producer proof
establishes for it: the proof is asked for that case explicitly, admits it only
when `C`'s record holds no unit of that identity, and applies every repository
check unchanged (the retained slice delivery, the integration-written commit,
its literal inclusion in the recorded `W`). `C` says nothing else about such a
slice, so its other fields are published as the canonical record holds them.
Any other added slice refuses `slice_cardinality` with its `slice_id`: one that
was never integrated, is not `done`, or is not an implementation slice. The
slices `C` holds keep their order and every protection above, and a repeat
handoff keeps a slice the published `K` carried this way
(`published_closeout_drift` with field `status` when it is gone).

Canonical entries appended after `C` are closeout bookkeeping, not contract. An
entry created through the canonical entry writer on the parent or on a slice `C`
already holds (for example an outcome recording tests, review findings or a
reported proof failure) is carried into `K` as the live record holds it. The
projection admits it only when every entry `C` holds stays byte-identical and in
order (including its versions, `current_version` and any receipt), the appended
entries pass the canonical entry, population-identity and new-entry-form
validation, and nothing else changes; the server-managed `updated` date that
moves with the append is admitted with it. An entry's title, kind or prose grants
nothing. A new version of an entry `C` holds, a removed or reordered entry, or an
invalid appended entry refuses with `entry_history_drift` or
`entry_append_invalid`; an append beside any other change (acceptance, scope,
titles, dispatch intent, `sections.material_refs`, or any other authored field
outside the coordination notes below) refuses with that change's own reason. Removing or rewriting a
persisted entry is refused earlier by the canonical writer itself. Handoff
preparation, retry and existing-chain recognition, and forge merge reach the same
decision through the one projection owner, so the appended entry survives
publication and retry without rebuilding `C` or changing its tree.

Coordination notes are not contract either. `sections.agent_notes` on the
parent and on every slice `C` already holds (ordinary, closing or review
slices) may be replaced with a schema-shaped value, and a slice whose notes
moved may carry a moved well-formed `updated`. The projection compares every
other field with `C`'s notes and dates restored, so a notes-only slice edit is
never read as an additional slice closeout and notes beside a change to
requirements, acceptance, summary, tasks, scope, dispatch intent, material
selection or any other authored field refuse with that field's own reason. The
notes' text is not read, classified or fed into the frozen worker or reviewer
assignment.

The historical projection recognizes a completed task through the canonical
task planner's `mark_done` operation. It requires the same task at the same
index with only its status moved to `done`, plus the well-formed slice date
that the writer moves with it. Rewritten, reopened, added, removed or reordered
tasks remain drift when compared between a historical candidate and closeout.
Current publication synchronizes these saved changes into the new candidate
before closeout; it does not depend on this historical exception.

A parent section that differs from `C` in any other way refuses
`unrelated_sections_drift` and says exactly where. The projection cause carries
the `unit`, `fields` (every unsupported path: `sections.summary`,
`sections.scope.items`, `sections.tasks[2].text`, `sections.tasks[3]` for an
added task, `sections.closure` for a rewritten or non-canonical closure) and,
when a task completion was compared beside them, `permitted_task_completions`,
so a permitted completion is never mistaken for the cause and never conceals a
rewrite of the same task. Handoff preparation adds `sections_drift` beside the
projection: the `unit`, the `candidate` commit the comparison was made against,
the identity of the observed record (`observed_source_digest`) and
`differences`, one row per compared path with its `change` (`unsupported` or
`task_completion`), the `candidate_value` and the `observed_value` (`null` where
a side holds none). The paths stay in the first answer; when the compared values
do not fit it, `sections_drift` is the member the bounded answer names and its
one read returns whole, and that read publishes nothing. The registered response
keeps the refusal and offers one guidance read, `workspace_read_wiki({subject})`.

An ordinary slice that differs from `C` in a way the closeout cannot carry
refuses `unrelated_slice_drift` with the same exactness. The projection cause
carries the `slice_id`, a `cause`, `fields` (paths relative to the slice:
`write_scope`, `title`, `sections.summary`, `sections.tasks[0].text`) and any
`permitted_task_completions`; handoff preparation adds `slice_drift` beside it,
shaped as `sections_drift` is, with `unit` naming the slice. Each `differences`
row is `unsupported`, `task_completion`, `slice_closeout` (a member that by
itself has the shape of a slice closeout: `status` reaching `done`, a first
canonical `sections.closure`, the authenticated `integrated_delivery_sha`) or
`moved_date` (a well-formed `updated`), so the slice's own closeout is never
mistaken for the cause. `cause` is `unsupported_change` when `fields` names the
other differences; `another_slice_closes`, with `closing_slice_id`, when the
slice would be a second slice closing by its first closure with no
authenticated delivery; and `not_a_slice_closeout` when its
closeout members do not together form one (a bare `done`, or a closure without
`done`). In the last two `fields` names those members themselves. Only
`unsupported_change` offers the guidance read, of the slice unit
(`workspace_read_wiki({subject: "<WK>#<SLICE>"})`), with the same
coordinator-owned correction; the other two keep `no_supported_route` beside
their facts.

Review history is coordination, never a publication gate. The projection
matches review-consumer slices (`review_purpose: "terminal_whole_wk"`) by their
stable id, not by position or count, so any number of them may already be in
`C` or be added after it, interleaved with implementation slices. A review slice
`C` holds keeps its id, tag and every authored field; only its status (to any
canonical `WORK_RECORD_STATUS_VALUES` value) and a well-formed `updated` may move,
beside the entries and notes admitted above. A review slice `C` does not hold is
admitted in the canonical findings-only shape in any canonical status: an empty
`write_scope`, the reviewer role the findings semantics require for `review`
work, a slice target, and canonical identity, ownership, priority, scope and
acceptance fields. Neither the number of reviews nor whether any is `done`,
`cancelled` or still `active` grants or removes publication. A refusal carries
`review_consumer_slice_drift` with the `slice_id`, a `cause` and the offending
`fields`: `candidate_review_removed`, `candidate_review_changed` (for example
a rewritten title, acceptance or scope), `review_purpose_changed` (an
implementation slice relabeled as a review, or a review dropping its tag, which
never bypasses the implementation-slice comparison),
`non_canonical_review_addition` (for example a nonempty `write_scope` or a
worker role) or `duplicate_slice_id`. A repeat handoff keeps the review history
the published `K` carries under the same entry rules; a review added after `C`
that holds no entries may still be removed.

Terminal-review shaping after `C` may opt the parent into a completion policy.
Explicit review shaping through `save_record` writes the requested completion
policy on the parent beside the review slice it adds. The projection admits only the introduction: a parent
`completion_policy` absent from `C` may appear with a canonical value, and it
stays admitted when the review slice is later deleted. A policy `C` already
holds must stay exactly; removing or replacing it, or introducing a
non-canonical value, refuses `unrelated_record_drift` with
`field: "completion_policy"`, which the refusal carries through the registered
response. A repeat handoff also keeps a policy the published `K` carries
(`published_closeout_drift` with the same field). The introduction admits
nothing else: unrelated protected changes beside it refuse with their own
reason. Neither a review slice nor a policy is required for publication.

Other authored differences between a historical candidate and its closeout
refuse `unrelated_record_drift` with the exact paths. An
`acceptance.validation` difference retains its compared values and observed
source digest through the existing diagnosis owner. These historical
constraints authenticate existing chains; they do not require reverting a
newer canonical save before ordinary publication. Saved-result and guidance
reads perform no synchronization or publication.

## Publication synchronizes the canonical WK

The public `workspace_publish_work({subject})` request publishes current canonical
state. Under same-WK exclusion it synchronizes the whole canonical record and
required contract or saved proof-authoring sources through the persistence
owner's capture, restricted tree construction, verification and expected-tip
compare-and-swap. The record is compared independently of generation identity.
A record with no sources persists as a record-only change, with no manufactured
generation or generation receipt content.

The existing candidate owner then prepares the exact resulting WK tip. An older
selection can advance only along its authenticated WK history with the same
fork and identity. Valid durable WK/fork inputs can prepare an absent selection.
Publication needs no preliminary inspect, synchronization or advancement call.
The subject-only request has no expected reviewed-version argument and cannot
promise an atomic match to an earlier inspection or grant credit from it.
Internal expectedVersion fences retain their no-substitution behavior.

Before the first write, the handoff's existing landing observer protects a
confirmed landing and refuses an unavailable observation. Source capture and
expected-tip fences preserve competing writes. Configured CCE decisions still
apply. Inspection and historical authentication create nothing.

Publication continues through the existing closeout and transport owners:
`C -> K -> D` carries the synchronized record followed by branch-local `done`.
The live canonical record is unchanged, and integrated implementation bytes
are preserved. Synchronization creates no proof, test or review credit.
Known completed synchronization is reported beside an originating later failure;
record-only persistence is reported as `record`, never as a generation write.
A retry converges from those effects without duplicating publication.

## Repeat handoff refreshes the same publication

After a successful handoff, an ordinary WK edit can leave the published
closeout record stale. Repeating the same `workspace_publish_work` call, with
the same request, updates that one publication; there is no separate command,
editor hook or background publication, and normal editing is unchanged.

- **Observe before refreshing.** Publication authenticates the old publication
  from its own recorded candidate, synchronizes current canonical state and
  prepares the resulting candidate. The existing pre-write landing check runs
  before synchronization or candidate mutation. A landed publication is only
  observed; changed canonical content refuses `published_handoff_already_landed`.
  Closed-unmerged, ambiguous or head-disagreeing proposals retain their own causes.
- **Unchanged is a no-op.** When the canonical snapshot and its sources are
  unchanged, the same candidate and `C -> K -> D` chain are returned. Warm and
  fresh-process retries add no commits, ref updates, pushes or proposals.
- **Refresh uses the same destination.** A newer synchronized candidate uses
  the existing closeout builder and old-publication authentication. The same
  unlanded local ref, Git branch or hosted branch/proposal is refreshed under
  its existing identity and race protections. The canonical record is carried
  as a whole, without field-specific review-status or task-completion exceptions.
- **Expected-old replacement.** Local handoff compare-and-swaps the handoff ref
  from `D` to `D2`. Git delivery lease-updates the destination branch through its
  validated URL from `D`, re-observes it at `D2`, then compare-and-swaps the local
  handoff ref from its observed value. Hosted handoff lease-updates the same
  branch behind the same exact open proposal and re-observes that proposal at
  `D2`; no second proposal is created. The old head's landing and proposal state
  are rechecked immediately before the replacement, and the replacement runs under
  the canonical WK writer lock only while the live record still holds the exact
  bytes `K2` was built from (`local_WK_changed_before_publication` otherwise).
  An unexpected head is never overwritten, and nothing moves the base, merges or
  pushes the base. Effects report `closeout_chain: "replaced"` and
  `handoff_ref`/`destination_branch: "updated"`.
- **Partial failure stays truthful.** A failed, rejected or uncertain update is
  re-observed once and never retried blindly; a refusal after an effect carries
  its original cause, the expected, requested and observed heads and the actual
  `effects`. When a Git destination holds an authenticated `D2` whose `K2`
  preserves the local ref's `K` (an update whose local ref write failed), a
  later repeat treats `D2` as the current publication: with the live record still
  at `K2` it only repairs the local ref; after a further permitted edit it
  updates the destination from `D2` under its expected head and repairs the local
  ref from its observed value. A foreign head is never adopted.
- **Landing during a refresh is reported, not hidden.** A human can land `D`
  between the final check and the update; no cross-system atomicity is claimed.
  Hosted handoff then refuses `handoff_landed_during_refresh` with the landed
  head and the published replacement, and landing observation authenticates a
  single exact merged proposal's own head even when its branch now holds `D2`, so
  `D2` is never reported landed when only `D` landed. Local and Git handoff
  observe the replaced head's exact-head ancestry of the landing base once more
  after the replacement is published and, when it landed, refuse
  `handoff_landed_during_refresh` (stage `landing_base`) with the landed head,
  the published head and the effects that occurred; the replacement stays
  published and nothing is rolled back or merged. Landing observation otherwise
  remains exact-head ancestry of the current handed-off head.
- **Forge merge of a hosted handoff lands what landed.** When a single exact
  proposal is confirmed merged, forge merge takes that proposal's own head as
  the completion, authenticated above the same `C` by the closeout-chain owner,
  even when the branch now holds a newer refreshed `D2`; an open proposal still
  merges the observed branch head. A live record matching the landed `D` or its
  `K` reconciles or observes it as before. A live `K2` carrying newer changes
  refuses `local_reconciliation_failed` with the authenticated landed publication
  of `D`; the live record is left unchanged, its changes are neither discarded
  nor merged, and no further forge merge is requested.

Review
text informs coordinator disposition but review schema, receipts, provenance,
history, and formal-attestation availability grant no candidate or forge authority
and cannot veto publication. Formal attestations retain their narrow admission
consumer semantics. Historical `review_provenance` fields remain parseable archival
bytes only.

After a terminal findings action finishes, `get_run_result` may
carry the advisory `closeout_continuation` stage `forge_handoff_ready`. It is
projected from the backend terminal-candidate publication owner alone: the WK's
retained designated terminal review unit must equal the observed subject, and the
owner must re-verify the candidate objects, private checkout, and a `selected`
version decision. The projection names `workspace_publish_work
{assigned_unit}` as `current_safe_call` with `decision_required: true` and
`decision_reason: "terminal_review_disposition_outstanding"`, because the
coordinator dispositions the actual review response. Findings, run outcome, and
schema adherence neither produce nor suppress it. The first ordered step,
`terminal_whole_wk_review`, is `complete` only when the observed action's
launcher-bound material was exactly the current candidate `C` against its base `B`
and a review response was captured; an explicit SHA range on the same subject,
other material, or a failed action reports `not_established`. That label comes
from a bounded, non-serialized observation of the action's own retained review
input, is process-local like the run itself, and never gates or grants the forge
call. An unpublished, superseded,
foreign, or unauthenticated candidate, or a failed re-verification, projects no
forge call. The projection performs no handoff, recovery, or ref movement, and
forge authenticates its complete input again before any effect. work record retains candidate and forge ownership, work record retains landed
publication identity, work record retains recovery ownership, and forge remains the
sole merge-readiness boundary. Findings remain advisory under decision and
decision.

The terminal-review contract binding has one pure owner:
`packages/agent-launch-cli/src/lib/terminal-review-contract-binding.mjs`. It alone
defines, validates, canonically serializes, digests, and compares
`agent_launch.terminal_review_contract_binding.v1`, which identifies the designated
terminal-review unit for the review consumer. It is not part of any candidate and
no candidate construction, reconstruction, recovery or publication consumes it.
Forge's work-record closeout comparisons use wiki-core's canonical source digest,
whose projection excludes generated `derived_evidence` and `projections` but not
authored contract changes.

Historical frozen contracts and checkpoints are immutable evidence. They are never
rewritten, deleted to force recovery, or served as current review authority. The
launcher instead classifies the exact historical and live canonical bytes through
`agent_launch.terminal_review_lifecycle.invariant_bound_decision.v1`. A positive
decision means every authority-bearing byte stayed exact and every admitted
difference was either a non-authorizing coordination fact or carried exact
producer-authenticated evidence. It does not mean that a lifecycle order was
approved.

Parent, slice, and designated-review status values, server-managed `updated`, and
`sections.closure` are schema-owned coordination facts. Their canonical path, change
kind, and addressed unit remain visible in `non_authorizing_coordination_facts`, but
their order and content neither authorize nor veto candidate movement. Findings,
review result, challenge, disposition, and closure therefore cannot supply
terminal-candidate, delivery, dispatch, or policy authority. Lifecycle ordering that
matters to an organization is CCE policy; absence from a local transition allowlist
is not a mechanical refusal.

Parent and slice titles plus `sections.agent_notes` are authored contract
constituents. They are compared byte-for-byte and are never neutralized as
coordination prose. Moving any of them invalidates the prior execution generation,
candidate lifecycle decision, and forge evidence, so a later reviewer dispatch
refuses until a current candidate exists; the old immutable candidate remains
readable only as historical evidence.

Executable and dependency authority remains exact. The whole-byte comparison still
binds authored titles and agent notes, implementation and review acceptance,
`read_scope`, `repo_paths`, `write_scope`, expected targets, dispatch intent, work
kind, and the exact dependency declarations.
Repository identity, base `B`,
accumulated tip `W`, candidate-version identity, candidate `C`, immutable version ref,
current-selection ref, tree, sole parent, private checkout, and controlled generation
remain independently authenticated by their existing owners and are not reconstructed
by lifecycle normalization.

### Producer-authenticated integrated-delivery evidence

An `integrated_delivery_sha` difference is not authenticated by the live canonical
field, a SHA-shaped string, caller input, a copied object, or review output.
Advisory reviews produce no receipt and grant no delivery authority. The
integration authority owner authenticates the transition from implementation-owned
integration evidence written by
`packages/agent-launch-cli/src/lib/slice-integration-delivery.mjs` and re-reads
every fact on each decision. The proof binds:

- the exact repository and canonical WK ref;
- the addressed same-record implementation dependency and its canonical
  `/slices/<index>/integrated_delivery_sha` path, compared between the terminal
  lifecycle's historical parent contract and the live canonical projection;
- change kind `add` or `replace`, limited to historical absence or `null` becoming
  one exact integrated commit;
- the launcher delivery retained on the exact slice ref and its authenticated
  sole-parent base, matched to the integrated commit by identity, by exact
  message and delta for a replayed delivery, or by exact zero-delta evidence;
- reachability of the integrated commit from the exact current `W`, and a
  re-observation of `W`, the retained slice ref, and the live canonical projection;
- the producer module and proof schema, plus the failure consequence when any
  bound fact is unavailable or disagrees.

A copied or caller-shaped proof, an absent or moved retained slice delivery, a
foreign or already-integrated historical value, a delivery or base that does not
match the integrated commit, an integrated commit unreachable from current `W`, or
any fact that moves during authentication cannot authenticate the transition.

The positive decision reports `integrated_delivery: producer_authenticated` only
for that exact evidence. Without an authenticated transition, a delivery-field
difference refuses as `integrated_delivery_receipt_required`. Integration evidence
that fails authentication refuses as `integrated_delivery_receipt_unauthenticated`;
wrong dependency, path, and value bindings use
`integrated_delivery_dependency_identity_mismatch`,
`integrated_delivery_canonical_path_mismatch`, and
`integrated_delivery_transition_mismatch` respectively. More than one distinct
authenticated delivery identity refuses as
`integrated_delivery_producer_receipt_ambiguous`. Changed executable or dependency
authority refuses as `executable_or_dependency_authority_changed`, and other
unexplained authored bytes refuse as `canonical_authored_bytes_unauthenticated`.

Every refusal carries its named identity, authentication, integrity, or operability
invariant and the concrete consequence: candidate or delivery authority would be
unverifiable, or the addressed terminal-review operation could not execute. Input
identity/readability failures likewise remain typed. These causes do not invalidate
unchanged `C/B/W`; they prevent using unauthenticated differences as recovery
authority.

work record remains the sole owner of candidate-status `generationAuthentication`
registration. work record remains the sole owner of terminal-review target construction
and validation. work record tracks that decomposition. The lifecycle decision and
integrated-delivery proof create no substitute generation authority, target owner,
constructor, validator, registration route, candidate reset, or ref rewrite.

Candidate inspection and advance bind the single host-configured repository;
public requests reject `repo`. A reviewer continuation uses `start_agent` with
its canonical review subject and role, when the actual serving role and schema
admit it. A stale or absent candidate offers no reviewer dispatch. Candidate,
ref, CAS and authorization identities remain launcher-owned.

### Review-independent candidate status and advance

Candidate observations preserve the affected work-record path and originating
read or parse failure. An absent selected record, malformed JSON and a record
identifying different work remain distinct. A persistent WK ref that is
confirmed absent differs from a resolution failure with native Git or I/O
diagnosis. These observations perform no preparation, publication or repair.
Review incompatibility retains the specific missing or ambiguous authored
fields; it does not change the candidate's mechanical state.

`workspace_inspect_candidate` decides candidate state only from
durable candidate facts: the canonical WK identity, the authenticated exact-W
controlled generation, the durable candidate/fork/WK refs, the candidate's own
metadata and record blob, and its durable version refs. Review designation,
review-unit status, review results, review-contract identity, and retained
reviewer context never select or veto a state. The states are
`candidate_absent`, `candidate_identity_invalid_or_moved`, `candidate_stale_w`
(the only state that advertises advance), and `candidate_healthy` with a
`selected` `version_lifecycle`; an unselected durable version is
`candidate_identity_invalid_or_moved` with cause `candidate_version_<state>`.
Status is read-only. A healthy candidate at current `W` is authenticated through
the same read-only existing-candidate owner cold recovery uses
(`authenticateExistingTerminalCandidate`).

That candidate state is decided once, by one internal observation in the
candidate runtime, `observeTerminalCandidateFacts`, which the status evaluator
calls exactly once and then builds its response from. The observation takes only
the server-bound repository and WK; it reads no review designation, pages nothing,
advertises no call, takes no backend, and performs no construction, derivation,
or publication. It returns the state and its cause, the live `W` the
current-generation owner authenticated (never a candidate's own recorded `W`),
and, for a healthy or stale candidate only, the compact identity from
`projectTerminalWkCandidateVersion`: of the selected version decision when
healthy, and of the completed observed-version result when stale. Absent and
invalid candidates have no compact identity. The owner-produced observations it
made stay internal to the runtime and appear in no response. The status layer
alone adds the registered status projection, the version lifecycle, the advance
continuation with its private stale snapshot, and, after the candidate state is
decided, the advisory review projection and its paging. This is a single
observation: it does not retry and does not exclude later movement. When an
owner's exception is what made the state invalid, the observation keeps that
original error internally beside its other facts; a state no exception caused
keeps none, and status never serializes it.

A bounded current observation composes that one observation for candidate
inspection, in the internal `observeCurrentTerminalCandidate`; it is not
registered, and status and advance do not use it. It classifies once through
`observeTerminalCandidateFacts`, then, for a healthy, stale, or absent result,
reads the facts that result rested on again through their owners: the
current-candidate ref must still name the observed candidate (or still be
absent), a candidate's immutable version ref and fork ref must still name the
candidate and its base, and the current generation is authenticated again and
must have the same `W` and be equal, as a complete authenticated envelope, to the
one observed. A candidate's own recorded `W` and generation are not compared with
the live ones, so a stale candidate remains a valid observation. A successfully
observed difference is the candidate primitive's `input_moved` refusal naming the
field, the ref, and the expected and actual values. A read that fails is not
movement: a symbolic or non-commit ref, a Git failure, an absent generation, and a
generation that is not the one persisted in `W` keep their producer's failure and
stop.

Only that typed movement, whether met in the final recheck or caught inside the
observation itself, is corrected, and only once: every fact of the first attempt
is discarded and the same observation and recheck run again from nothing. There
is no third attempt, no wait, and no repair. An invalid state without typed
movement is returned as classified, with no recheck and no retry. The internal
result is `{observation, failure, automatic_correction}`. `observation` is the
verified observation or the actual invalid classification, and is null whenever
an attempt could not be verified, so an earlier healthy or stale answer never
accompanies a failure. `failure` is the actual error of the returned attempt.
`automatic_correction` is null without a retry and otherwise
`{kind: "reobserve_current_once", original_condition: {failure},
verified_outcome: {observation, failure}}`, keeping the first attempt's actual
movement beside the fresh attempt's actual outcome whether that fresh attempt
succeeds, is invalid, fails, or moves again. The final recheck is not a lock or an
atomic snapshot: the facts may move immediately afterwards, and every later
mutation authenticates for itself.

The internal `createCandidateInspectionTask` composes the closed inspection
request with that bounded observation and the historical authenticator; it is
registered by the production task composer. Its one schema accepts exactly
`{subject, version?}`: `subject` matches `^WK-[0-9]{4}$`, `version` is 64
lowercase hexadecimal characters, unknown keys refuse, and a `version` key that
is present but undefined refuses rather than reading as omitted. There is no
repository field; the repository and Git runner are host configuration captured
when the task is created. A malformed request refuses with the candidate
primitive's `invalid_argument` naming the rejected fields before anything is
observed. Without `version` the task delegates once to
`observeCurrentTerminalCandidate` and reports that observation's state, compact
identity and `{kind: "evaluated_current", observed_w}`, with the bounded
owner's actual failure and automatic correction; when no observation was
verified, state, candidate and currentness are null. A healthy current
observation is followed by the review comparison described below, whose facts
ride beside the candidate facts without changing them. With `version` it delegates
once to `authenticateHistoricalTerminalCandidate`, even when that version is the
selected one, and reports `historical_version` with the same compact identity
and `{kind: "historical_only"}`. A historical read consults no current
observation, live `W`, live generation, or live record, and a failed one keeps
its owner's error with no fallback to the current candidate or another version.

Inspection returns the selected subject, current or historical selection, state,
and the candidate identity needed for the caller's decision. A healthy result
can finish. Absent selection supplies no publication or preparation permission;
stale selection can offer the existing exact-version advancement call. Refusals
preserve their specific cause, subject, effects and uncertainty. Canonical record
absence, unreadability, malformed JSON and identity disagreement remain distinct,
with the original filesystem or parse cause preserved before generation checks.

The response publishes no successful-check inventories, derivation carriers or
automatic historical reread. Additional permitted diagnosis is available through
the returned authenticated `workspace_read_wiki({reference})` selection. The
production registrar routes that source to the inspector's `readOriginal`; it
authenticates repository, subject and session without inspecting again or
substituting current content. Whole semantic delivery uses the existing selected
response owner, including above ordinary admission bounds.

Inspection builds, selects and publishes nothing. It executes no proof, review,
integration, merge or completion action. Historical selection reads exactly the
requested immutable version and never falls back to current selection.

A stale candidate publishes an advance
call only when the real `advanceRequest({subject, version})` owner's tool has a
canonical callable identity and a matching registered request contract. The task
and registrar consume that builder by default, with the exact observed immutable
version and `{fact: "ok", operator: "is_true"}` predicate. Invalid supplied
specifications refuse rather than changing the owner request. The production corpus adopts `workspace_advance_candidate` with that same
closed owner request. Registration, central role grants and the actual serving
schema decide whether inspection may offer its exact selected-version call.
Canonical record identity disagreement names the failed record id/initiative
invariant and `canonical_record_identity_recovery`: generation authentication
has not run. Genuine generation failures keep `controlled_generation_recovery`.
When both permitted attempts encounter typed movement of the current selection,
recovery names `caller_retry` and a later same-subject current observation after
movement settles. Both failures retain their actual expected/observed identities;
no third attempt runs and no ref is restored. Missing or changed immutable
historical material keeps its exact version/material repair condition.
A corrected observation reports the original movement and the fresh attempt's
outcome as conditions, never as error objects. An observation that could not be
completed, including a failed historical read and a second failed attempt, is the
public mechanical refusal with the failure's own registered code where it has
one, the deciding facts, the same diagnostic under `carried`, and a
`no_supported_route` recovery stating what must hold before the same request is
repeated. The body's inline size is measured against the delivery bound and
reported beside it; a body over the bound is reported as needing complete
transport and is not shortened. A slice subject is rejected by the schema before
the handler runs; the correction names its parent WK, and the parent call is
published only once the inspection tool is a canonical route with a registered
request contract.

`workspace_inspect_candidate` is registered by `registerCandidateInspectionTool`
through the production task composer. Its closed schema and guarded owner perform
current/historical observation without mutation. The host supplies original
retention with the actual `workspace_read_wiki` owner call and serving schema.
Complete originals use the authenticated selected-full projection; reads perform
no current re-observation, recovery, capture or candidate advancement.

The delivery composition returns `{deliver, readOriginal}`. `deliver(prepared)`
retains exactly `prepared.body` once through `retainSelectedResponseSource`,
with producer route, repository, root WK, selection, actual compact candidate
identity and both divergence record digests. A supplied host owner call and
request schema pass unchanged to that retention: the existing owner validates
the pair and records the exact locator-bound call as protected selected access.
Incomplete or malformed configuration retains that owner's refusal. The host
receives the registrar's retained locator through `ownerCall`; it need not run a
second delivery to obtain original-read data. Omitted configuration keeps the
retention owner's default access behavior. Authority is independently resolved
through `resolveObligationCoverageQueryContext({env, workspace})`, binding the
existing server/session identity. It returns `{source, originalRequest, result}`:
`source` is the incumbent `{ref_id}` locator;
`candidateInspectionOriginalRequest(subject, source)` supplies the closed internal
read data; `result` is the exact `readSelectedResponseFull` result, including its
private delivery class. The registrar returns that result directly through the
response guard. Copying or spreading it forfeits complete delivery. Every genuine
divergence member and both record digests reach a private SDK or stdio client in
one structured result even above the ordinary inline bound.

`readOriginal({subject, source})` derives expected route, repository, unit and
session authority anew before the full reader authenticates retained bytes. It
accepts no expected authority from the locator or retained binding. Unresolved
session authority, mismatched binding, missing material and corrupt bytes keep
the existing owners' refusals before disclosure. A cold original read performs
no inspection, candidate reconstruction, current-record substitution or second
retention; the retained historical/current result remains itself after live W,
record and candidate movement. Retention is a transport effect separate from
the carrier's observation-only candidate/lifecycle facts.

Public semantic readback is an adoption boundary. `task-read-wiki.mjs` currently
routes retained producers other than itself to the closeout-receipt reader; that
branch cannot read an inspection original. The semantic read owner must select
this inspector-owned `readOriginal` seam and bind the original request to its
supported selector. The adopted host then supplies the concrete semantic
`ownerCall` and its authoritative `ownerRequestSchema` through the registrar
before exposing a read continuation. Private SDK and stdio fixtures bind their
own original-read tool with this pair, receive the locator from the registrar's
actual retention, and read that exact response after live movement and process
replacement. This composition advertises no
unsupported semantic read and alters no existing reader. Private source and
isolated installed-package journeys exercise local complete delivery, exact
historical authentication after movement/restart, original readback and refusal
boundaries. Public role denial, discovery, incumbent-route retirement and combined
recovery remain checks of the adopted server composition.

A selected candidate whose recorded `W` is no longer the live WK tip is
`candidate_stale_w` only after its immutable version authenticates through
`authenticateObservedTerminalCandidateVersion` for exactly that candidate. The
stale result then reports that version in its `candidate` projection:
`version_identity`, `immutable_version_ref`, `current_selection_ref`, and the
`current_selection_observation` naming the same candidate, beside the candidate's
own base and embedded `W` and the live `current_w`. Its `version_lifecycle` and
`review_consumer` stay `null`: the authentication says what the selected
candidate is, not that it is currently publishable. When that authentication
refuses, the state is `candidate_identity_invalid_or_moved` with the refusing
owner's own code as `cause`, no version fields, and no advance continuation; a
missing, conflicting, or symbolic immutable version ref, a candidate that is not
the deterministic candidate of its own tuple, an embedded generation that does
not authenticate, and a selection or version ref that moves during the read all
refuse this way. Status does not retry, repair a ref, or substitute a newer
candidate.

Stale classification therefore requires full historical generation
authentication of the candidate's embedded `W`, which validates the generation's
contract and associations. The exact-`W` authenticator used for the current
generation checks descriptor mechanics only, so a generation can authenticate as
current and still fail historical authentication. A candidate built over such a
generation is healthy while its `W` is current and, once `W` moves, is
`candidate_identity_invalid_or_moved` with cause
`controlled_contract_generation_invalid` rather than stale, and status offers it
no advance.

The independent review consumer is reported only as the advisory
`review_consumer` projection of a healthy candidate: `null` when no terminal
review unit is designated, otherwise its subject, a `lifecycle` of `admissible`,
`inadmissible` (for example `ambiguous_terminal_review_coordination`), or
`authored_contract_divergent`, and the paged `divergence` that `continuation`
addresses. That projection is computed after, and never feeds, candidate state.

The comparison behind that projection has one owner in the candidate runtime,
`observeTerminalReviewConsumer`, which returns complete facts: a `compatibility`
of `not_designated`, `compatible`, `incompatible`, or
`authored_contract_divergent`, the live review `subject` when one is designated,
the owner's `cause`, the actual refusal when one decided the answer, and, for a
divergence, every difference the lifecycle comparison produced, in its order,
with the digest of the candidate's own record and of the live record it
compared. It pages and clips nothing. The status projection maps those facts to
its `lifecycle` and pages the complete difference list 128 at a time. The
internal candidate inspection reads the same facts unpaged, and only for a
healthy current candidate: a stale, absent, invalid, or unverified observation
and every historical selection carry no review facts. A comparison that itself
throws is kept as a review fact with a null `compatibility` and the thrown
error, and leaves the candidate's state and identity as observed.

`workspace_advance_candidate({subject,version})` is the deployed boundary. Its
selected-version owner requires the exact lowercase 64-hex immutable version
returned by inspection. Missing, null or malformed versions refuse before
mutation. The private current-WK advance kernel remains an internal owner; it
is not another public request form and supplies no default caller version.

The pipeline consumes only the evaluator's private stale snapshot under the
same-WK exclusion. A status-shaped value carries no snapshot; no dependency can
adopt or mint one. For the selected-version boundary,
`authenticateHistoricalTerminalCandidate` authenticates the requested immutable
version inside that exclusion, and its candidate must equal the snapshot's
candidate. An authentic different version refuses with
`agent_launch.terminal_candidate.advance_input_moved.v1`, carrying the exact
expected and observed `{version_identity, candidate}` pairs. History supplies
only equality and diagnostic identity. Expected-old `C`, fixed `B`, target `W`,
object format and generation come from the current evaluator and their owners.
The target is captured once: movement refuses without reselection, repair or
retry. A selection that is not stale retains the exclusion owner's before- or
inside-exclusion refusal.

The existing generation, record, freeze, derive, final-recheck and atomic
publication owners run once. The candidate's tree equals the captured `W` tree
and its sole parent is fixed `B`. Publication keeps one transaction for the new
immutable version and current selection, fenced by fork and WK refs. Historical
versions survive. The selected result reports the exact requested selection,
authenticated source and advanced tuples from
`projectTerminalWkCandidateVersion` (`version_identity`, `candidate`, `base`,
`wk`, `tree`, `controlled_generation`), target `{wk, base}`, and native
`version_state` and `selection_state`. Controlled generation is diagnostic
identity, never a caller authority envelope.

`task-advance-candidate.mjs` exports the strict request owner,
`runAdvanceCandidateTask({mainRepo, request, backend, requestSchemaAuthority,
responseEnv, runGit, dependencies})`, and an uncalled adoption registrar
`registerCandidateAdvanceTool({registerTool, workspaceRepos,
resolveWorkspaceRepo, jsonContent, errorContent, dispatchBackend, responseEnv,
requestSchemaAuthority})`. Its intended name is `workspace_advance_candidate`;
its closed request is exactly `{subject, version}`, with a root `WK-####`
subject and required lowercase 64-hex version. Repo aliases, slice subjects,
refs, object IDs as selectors, paths, generation, policy, argv and other fields
refuse. The handler and request builder validate only own data fields, without
reading inherited values or invoking request getters. The repository is bound
by server composition through the existing resolver, never by the request. The registrar uses the real strict-validation
error and response owners. `MCP_WRITE_SEMANTICS.NONE` declares that no
field-replacement statement applies; the description explicitly names the Git
objects and ref mutation.

`advanceRequest({subject, version})` validates through the same owner and
returns `{tool, arguments, successPredicate}` with the exact supplied values.
Its predicate tests the actual result's `ok` fact: only `advanced` or
`converged` is successful. A request specification does not register a callable
route. The inspector consumes this specification by default; its
continuation builder still requires the canonical descriptor and actual serving
request-schema authority.

The task composes existing mechanical-refusal and continuation owners. Each
response carries one `next_calls` list. Current and exact new historical
inspection calls require the actual serving schema and canonical tool identity;
when either is unavailable, no call is invented. Observation obtains facts for
a later explicit decision and grants no replacement-selection mutation authority.
Refusal recovery and its call list are chosen together. Backend, canonical-root
and generation corrections keep their cause-specific actor, prerequisite and
correction, with no inspection repair call. Only a recovery requiring a fresh
selection observation may offer inspection as informational guidance with the
blocker unchanged, retaining the actual correction and explicit-version retry
condition; inspection repairs nothing. Invalid
requests use that same decision for both the mechanical refusal and the result
envelope, so offered calls never contradict `no_supported_route`.
Advancement returns the acknowledged exact selection change or authenticated
convergence, with the source and target needed to act. It publishes no repeated
candidate-derivation inventory or successful boundary checks. A successful action
can finish. A failure preserves its stage, deciding cause, known changes and
uncertain writes; completed derivation alone proves neither a ref write nor an
object's existence. An unacknowledged transaction is not replayed or rolled back.
The complete permitted diagnosis uses the returned authenticated semantic read,
without raw output, host-file rescue or repeated advancement. No local advance
gate is inferred from tier, availability, integration or forge policy.

Runtime failure membership is an owner-minted identity with unchanged own data.
Primitive failure membership requires the actual producing owner at the runtime
boundary and its captured failure projection, including genuine native Git
diagnosis. Native diagnosis registration alone is no alternate authentication
route. Producer identity is scoped to the concrete call that throws, and
its lookup requires the original prototype and unchanged own code, detail and
message. The task reuses that owner's captured projection. A prototype, code
or copied projection alone establishes neither membership nor effects. An
injected owner callback or a value thrown unchanged by an injected Git runner
cannot mint primitive membership. Copies, mutations,
getters, proxies and subclasses keep their captured diagnosis without an
invented owner classification. Refusals keep native causes, stages and ref
disagreements, distilled through the existing diagnostic owner. The complete
original is retained once by the existing operator-evidence owner; no raw
process output or stack is returned. If the response cannot fit inline, it offers the existing authenticated
semantic selection for the complete permitted diagnosis. No host-file or byte
reconstruction job crosses that boundary.

The production composer registers `workspace_advance_candidate` with actual
schema authority and orchestrator/operator grants. Worker/reviewer/redteam
sessions cannot call it. The returned inspector call uses its same serving
contract; there is no old advance alias. Private SDK tests establish owner
behavior, while actual production source/installed journeys establish exposure.

The per-WK exclusion locks the repository advance mutates. Advance passes its own
repository root to the backend's exclusion owner, which, after the advisory
evaluation reports a stale `W` and before it takes the durable lock, requires
that root and the backend's configured root each to be a nonempty string and
exactly equal. A missing, non-string, empty, or different root refuses with
`repository_root_unavailable`; neither root is defaulted from the other and a
mismatch is not normalized. Nothing is evaluated or continued inside the
exclusion after that refusal, so nothing is derived or published. On equality the
owner locks that configured root, and the authoritative re-evaluation and the
whole advance continuation run inside that one lock.

When the backend's advance exclusion refuses, the route returns
`agent_launch.terminal_candidate.exclusion_refused.v1` with the backend's closed
`reason`. The possible reasons are `invalid_arguments`, `candidate_not_stale_w`,
`repository_root_unavailable`, and `candidate_not_stale_w_inside_exclusion`.
For the two not-stale reasons, the public response is terminal: the selected
candidate is not stale, so nothing needs advancing and the refusal changed
nothing. Its recovery state is `no_supported_route`, and `next_calls` is empty;
no inspection or retry is required merely to reread that fact. The specific
exclusion reason and unchanged effects remain explicit. This terminal outcome
does not waive cause-specific correction or fresh-selection observation for
recoverable conditions. The other two reasons retain their cause-specific
correction and responsible actor, with no inspection repair call. The
authenticated reason comes from the backend owner's private identity lookup
(`projectTerminalCandidateExclusionRefusal`), not from the thrown value's `code`
or `reason`. A copied, inherited, or proxied refusal therefore publishes only
the four-field generic refusal. Advance is not a recovery route for absent,
invalid, or stale-generation candidates, and the exclusion, stale-W checks,
generation authentication, and candidate construction are unchanged.

### Direct-to-main review

An operator-authorized direct-to-main lifecycle does not use terminal-candidate
status, terminal-candidate advance, forge handoff, external review, or shell
review. The operator first commits the exact scoped implementation candidate.
The coordinator then calls the same registered `start_agent`
reviewer route with the canonical WK or review-slice `subject` and the landed
commit's complete `diff_base_sha` and `reviewed_sha`. The reviewer is read-only
and never creates Git objects.

### Terminal advisory review execution

Each terminal reviewer dispatch is one independent advisory action. An accepted
call resolves its material once through the published-candidate selection above,
materializes a fresh action-private read-only checkout of `C`, invokes the
selected family executor once with the launcher-built advisory review input, and
settles its own run and monitor. Another explicit dispatch repeats selection,
authentication, materialization, and execution. No earlier action, retained
context, or review result is reused, and status observations launch nothing.

The advisory review input carries role, subject, repository, `base_sha`,
`reviewed_sha`, reviewed tree, the private checkout root, the rendered review
brief with the parent and selected-unit contracts and acceptance, tool profile,
and any launcher-selected formal result contract. It carries no readiness, frozen
review target, dependency mount, per-attempt execution contract, or candidate
validation evidence. Existing explicit verification results retain their own
candidate, population, generation, provider, and attempt bindings; candidate
preparation and recovery neither produce nor replay them. They are not transported
to reviewers, and review output never becomes validation evidence.

Authentication precedes execution. Selection refuses before any run, monitor,
materialization, or executor call when publication, cold recovery,
controlled-generation authentication at `W`, the lifecycle-difference decision, or
selection agreement fails. A recovery failure is published as the failure that
was thrown: its own name, message, code, structured details and cause chain are
the refusal's `evidence.cause_chain`, first level first, and the complete
capture is retained for the operator. The recovery verdict in `reason` states
where recovery stopped and is context beside that failure. A typed candidate
fact (`recovery_code` and `recovery_detail`: a code such as `candidate_invalid`,
`input_moved`, or `controlled_generation_stale` when the current controlled
generation is not persisted in `W`, whose cause is the generation owner's
refusal) is published only when the coordinator recorded one for that exact
value under the production runner. Any other value, including an unrecognized
exception and every failure of an injected runner, publishes neither member;
nothing is classified as unknown and no message stands in for the failure's own.
The same holds after integration: a failed candidate preparation carries the
thrown value as its lifecycle evidence and a `candidate_failure` only for a typed
candidate error. The reviewed material is
the immutable selected `C`. Canonical movement after selection affects the next
dispatch, not the running action. There is no terminal-review spawn barrier,
retained per-attempt execution contract, or pre-spawn coordination refusal.

A selection refusal is not a candidate defect. Unchanged `C/B/W` remain valid, and
no ref, checkout, or historical contract is mutated. Standalone findings-only
reviewers and redteam units select their own material and reach none of this.

Empty write authority is also the lifecycle discriminator. Terminal, exact-slice,
standalone reviewer, and standalone redteam actions bind immutable findings
source snapshots and do not allocate, consult, or mutate persistent
implementation-WK lifecycle state; technical role remains a confinement and
transport fact only.

Candidate construction assumes the repository-wide
design-first work-record sequence (repository-only: `AGENTS.md`, "WK-First
Work"); terminal review
does not provide a local substitute for its semantic authoring or CCE-owned
sequencing.

## Active managed composition precedes dispatch and child creation

At managed-backend construction, the launcher mints one immutable, branded,
process-local composition object. It binds the exact resolved
`@agent-chassis/wiki-mcp/src/server.mjs` producer entrypoint, selected Node
executable, exact spawn primitive, producer-owned lifecycle descriptor,
consumer lifecycle descriptor, and `createStdioMcpConduit` constructor used by
both managed Claude and Codex family executors. The object is not public;
module-private brands identify it and a bounded accessor exposes only its
frozen compatibility fact and guarded conduit construction.

This fact authenticates the coherently loaded launcher/package composition; it
does not execute the selected server or attest arbitrary in-place source changes
within that backend generation. The spawned-server readiness exchange below is
the authority for what the separate server process actually executes. A partial
or hot deployment can therefore pass this early composition gate and still be
refused by the mandatory per-dispatch exchange.

The public fact is `stdio-mcp-conduit-composition-compatibility.v1` with exactly
six keys: `schema_version`, `backend_generation_id`,
`producer_protocol_generation`, `consumer_protocol_generation`,
`compatibility_state`, and `source`. `source` is
`launcher_active_composition`. `compatible` requires authenticated,
well-formed, supported, equal producer and consumer bindings; authenticated,
well-formed unequal or unsupported bindings are `incompatible`; unavailable,
unbound, unauthenticated, or malformed internal composition is `unknown`.
Missing, malformed, stale, and backend-generation-mismatched facts are gate
outcomes, not compatibility states.

The backend requires a current `compatible` fact before delegating any managed
worker, reviewer, or redteam role to a family executor, and the shared guarded
constructor checks it again before host-server creation. Route registration is
reported independently. Effective structured dispatch alone becomes
unavailable on any unresolved outcome; native edit, repository read boundary,
commit, managed worktree provisioning, slice-to-WK integration, WK-context
review, validation ownership, and automatic main promotion remain independent.
Public projections preserve the originating
`stdio_mcp_lifecycle_protocol_incompatible` identity and recovery to deploy one
coherent build and restart the long-lived backend. They do not replace that
modeled startup cause with `operator_recovery_needed`. No raw component identity is exposed,
and historical failures cannot poison a newly minted compatible generation.
The direct Claude orchestrator topology covered here is not outside this gate:
its fresh and resume launches take their conduit constructor from the same
launcher-minted composition authority, so the pre-spawn compatibility decision —
including the on-disk producer probe — precedes both host wiki-MCP server and
confined child creation. Other direct operator launches remain outside it.

## Lifecycle compatibility precedes confined child spawn or MCP forwarding

The launcher proves the active producer/consumer lifecycle contract before it
allows a confined client to exchange MCP bytes. Confined Claude and Codex both
use the decision local socket adapter. The managed composition gate probes the
on-disk producer before conduit construction; each authenticated connection
then supplies its own running server's registration evidence.

No host MCP server generation exists until an MCP command invocation
authenticates. Before confined-child spawn, the launcher proves that the private
listener is armed, the endpoint and token file are projected, the connector and
interpreter are descriptor-pinned, the
admission window is open, and exactly-once settlement supervision is installed.
After a connection authenticates, the launcher reserves and starts one host
wiki-MCP generation with its stdio mechanically wired, then verifies that
generation's `wiki-mcp-launcher-readiness.v2` registration. The connector is
still blocked from reading its stdin and the host does not read or forward
client MCP bytes. Only a matching, well-formed generation authorizes the fixed
admission acknowledgement; MCP forwarding begins after that acknowledgement.
Each later overlapping connection repeats the same per-generation check.

Listener or projection failure before confined-child spawn is the same
launch-admission refusal. Authentication rejection creates no
generation. A server spawn, registration, or readiness failure after
authentication but before acknowledgement closes that connection, reaps the
partial generation, and enters the post-spawn conduit-failure path below. It
never acknowledges the connector or forwards an MCP byte. If no usable required
wiki-MCP generation exists, the outer launch fails closed. Failure of a
replacement generation does not corrupt or automatically terminate a separate
healthy admitted generation; outer-session disposition follows the existing
required-MCP lifecycle policy.

The lifecycle generation is never supplied through a request, prompt, model
output, environment, backend registry entry, or retained run state, and no
historical compatibility latch exists.

## Post-spawn conduit failure is a terminal run outcome

A stdio-MCP conduit failure discovered AFTER a spawn was accepted is published as
a terminal run, never as a launch-admission refusal. Both supported families
attach one shared supervised-probe wrapper before any post-spawn readiness wait
can fail, and that wrapper projects the retained typed conduit error as a
canonical lifecycle probe result: status `failed`, terminal, carrying the known
child exit and final-result evidence plus the stable family-neutral conduit
blocker reason and its bounded detail. The blocker reason and detail are
preserved on the run's terminal missing-result envelope, so a run that died
because its required wiki-MCP conduit died is distinguishable from a run that
merely produced no report. Claude does not refuse admission after an accepted
spawn.

Client readiness and lifecycle failure are separate launcher settlements.
`clientReady` resolves once for the real initialize plus exact `tools/list`
exchange; it is never reused as post-readiness authority. A distinct, memoized,
always-live failure settlement remains pending after readiness and resolves once
with the first typed failure. Spawn supervision observes that settlement for the
whole confined process lifetime, starts the one bounded cleanup settlement
promptly, and retains later cleanup or reaping evidence additively. A relay
restart, malformed lifecycle event, later tool-surface mismatch, or host-server
loss therefore cannot disappear behind an already-resolved readiness promise.

Clean host-server exit after readiness remains expected drain for the one-shot
worker, reviewer, and redteam lifecycles. An interactive orchestrator requires
its wiki-MCP surface for the whole session: transport close alone never
authorizes success while the orchestrator process remains live, regardless of
whether client close or server exit is observed first. Expected interactive
cleanup requires the launcher to have observed the confined orchestrator process
itself become terminal. This classification uses only the launcher-validated role
and launcher-observed process lifecycle; prompt text, environment, caller input,
model output, client messages, and client-supplied policy are not classification
inputs.

For an orchestrator, the launcher persists `stdio_mcp_reason` and
`stdio_mcp_detail` in its launcher-owned `session.json` before publishing the
terminal state. This projection has an explicit closed schema: it records the typed
reason, phase (`readiness`, `mid_session_server_loss`, `relay_restart`,
`cleanup`, or `reaping`), launcher run id, and bounded cleanup resource/code
tokens only. By schema it does not serialize Error messages or causes, prompts, credentials,
environment, raw process output, arbitrary event detail, prose, or stack traces.
This is a stable lifecycle-result shape, not a least-disclosure or
confidentiality guarantee. The initiating failure remains primary. Failure to
persist this diagnostic refuses publication as
`stdio_mcp_session_diagnostic_persistence_failed`; terminal state is
not published as though the diagnostic had been saved.

Run-state polling fails closed on probe shape. A non-null probe result without a
normalizable run status — an admission-refusal envelope, a bare object, an array,
a scalar — is a lifecycle contract violation and terminalizes the run with a typed
`probe_result_status_invalid` missing result. It can never leave an accepted run
indefinitely `launching`, and it can never be silently discarded. Valid running
and terminal probes keep their existing semantics.

Conduit cleanup has one ownership path and one memoized settlement. Client
termination, admission shutdown, per-generation host-server reap, endpoint and
credential retirement, private-directory removal, and descriptor disposal settle
exactly once; child exit, cancellation, the executors, and the terminal probe
projection all await that same settlement,
and no terminal result is published before it completes. Concurrent status and
wait callers coalesce on it. A cleanup failure remains typed and terminal rather
than being masked or discarded.

That settlement exists from before the first resource is acquired, so a partial
create, a launch refusal, a cancellation, and a native non-conduit failure all
settle through the same owner. The originating failure is always preserved; the
cleanup failure is composed onto it additively, never in its place. The host
server's `error`, `close`, and `exit` events converge on one terminal finalizer,
a spawn that never produced a process is recorded as terminal instead of waited
for, and termination is a bounded TERM-to-KILL escalation against the live child
handle that returns only after actual process completion. That escalation is the
launcher terminating its own server, not the server being lost: the cleanup owner
marks the exact child before it signals, and the finalizer records no server-exit
failure for a termination carrying that mark, so tearing a healthy conduit down
cannot rewrite a successful run as a failed one. The mark is refused once the
child has already settled, so a host server that died on its own — before, during,
or without any cleanup — still produces its typed server-exit failure. A resource
whose early release fails stays owned and is retried by the settlement. The
launcher drains its own conduits' settlements on catchable `SIGINT`, `SIGTERM`,
and `SIGHUP` and then re-raises the signal; `SIGKILL` and a hard crash stay an
operator-recovery case, and no daemon, periodic reaper, broker, or cleanup
service is introduced.

## Cleanup-only terminal failure and reviewer-verdict validity

Aggregate run status and reviewer-verdict validity answer different questions and
are established separately.

The aggregate status reports what happened to the RUN. When the launcher's own
conduit cleanup fails, the run is published `failed` and keeps its typed cleanup
blocker and its cleanup residue. That is never laundered into a success, never
suppressed, and never redacted; it stays visible and operator-actionable on the
public envelope.

Reviewer-verdict validity is a separate fact, established from trusted structured
evidence plus the launcher's own cleanup-only evidence. The conduit's terminal
projection computes a frozen `cleanup_only` discriminator at the launcher
boundary and it is re-validated on read. It is true only when the primary typed
blocker is exactly the stable cleanup reason — readiness failure, abnormal server
exit, relay failure, and cancellation all outrank cleanup and can never present
as cleanup-only — AND the supervised child was observed to complete with exit
code `0` and no terminating signal. It is derived from structure only: never from
prose, stderr, substring matching, or the mere presence of a final result.

One shared launcher-owned predicate decides verdict eligibility for every
consumer, so every review-result projection of the run agrees. A reviewer verdict is usable when either the ordinary
succeeded-reviewer rules hold, or ALL of: the role is exactly `reviewer`; the run
is terminal with aggregate status `failed`; the run carries the validated
cleanup-only conduit disposition; the preserved child exit is code `0` with no
signal; and the preserved final result carries a schema-valid
`agent-role-result.v1` bound to that exact run's role and subject.

In the cleanup-only case the verdict remains available in that run's settled
advisory result while the aggregate run status stays `failed`. No receipt is
published. Each review is observed independently by run id and monitor handle. Clean and findings-bearing
output are advisory evidence only. Neither outcome consumes the target, prevents
another reviewer or policy-allowed redteam dispatch, or directly permits or
prevents a boundary mutation.

This exception is reviewer-only and does not make arbitrary failed worker or
reviewer output authoritative. A genuinely failed child, a nonzero exit or a
terminating signal, a readiness/server/relay failure, a cancellation, and a
malformed probe result remain distinct execution facts. When reviewer text was
captured, however, it remains usable advisory evidence even if the structured
payload is malformed, unbranded, bound to the wrong role or subject, or is prose
only. Those defects affect only optional schema observation and formal
attestation. These dispositions affect only that run's evidence and never change
whether another exact-target review may be dispatched.

## Canonical acceptance.validation admission across the findings-only surfaces

One wiki-core owner validates and projects every selected unit's complete
`acceptance.validation[]` declaration. The only executable entry is exactly
`{operation: "node_test", target, verification_ids}`; `target` is one
canonical repository-relative lowercase-`.mjs` test-module path and
`verification_ids` is an array of unique nonblank identities. Plain nonblank
strings and exact `{note, verification_ids}` objects are human instructions,
not execution authority. Command-bearing objects, unknown operations, extra
fields, duplicate executable bindings, invalid targets, and
`sections.structured_validation` are rejected.

The work-record schema, ready-slice projection, bounded selected-unit read,
dispatch/admission projection, findings-only classifier, and role-contract
renderer all consume that owner. The same projected operation, target, and
verification population also feeds terminal-candidate execution and
`verify_proof`; no public route executes a declared node_test target
directly. Consumers retain their own confinement and role
authority, but none parses command text, searches secondary sections, or
reconstructs target bindings.

Reviewer rendering preserves note order and emits executable entries as compact
JSON in `operation`, `target`, `verification_ids` order. Verification
identities are deterministically sorted by the shared projection. Composition ordering is unchanged on both surfaces: the parent WK's entries
precede the selected review unit's. On a slice-level standalone surface, the
parent is authenticated as immutable inherited review material rather than as
the executable selected unit. Its canonical nonempty criteria may intentionally
carry an empty validation array while still admitting the review; an exactly
empty `{criteria: [], validation: []}` parent contributes zero inherited
entries. The selected review slice's acceptance stays mandatory and complete.
The terminal whole-WK surface has no draft-parent exception: the parent is the
selected executable unit, so both sections stay mandatory and complete there.

A malformed section fails closed. The refusal names which side contributed it —
the parent or the selected review unit — alongside the canonical detail, so the
defect is attributable without re-inspecting either frozen contract. An
entry-level canonical rejection is reported as `acceptance_validation_invalid`; a
section that is not an array at all is reported against the acceptance-section
shape; and a canonically valid entry that the typed projection cannot faithfully
render carries its own distinct non-renderable detail, so "the schema rejects this
section" is never conflated with "this projection cannot render it". A canonical
field that is present is never described as missing.

Nothing here moves an authority boundary. The final prompt formatter, the
controlled-contract schemas and vocabulary, the reviewer result schema, target
binding, evidence authority, worker and reviewer confinement, lifecycle
transitions, dispatch and readiness authority, and integration policy are all
unchanged. The frozen contracts' identity checks, role behavior, and refusal codes
are likewise unchanged; the refusals merely carry better attribution. Findings-only
review stays advisory under `decision`.

## Independent findings actions

Public SHA spellings are ordinary locator syntax, not operator authentication.
The registered `start_agent` boundary accepts a complete
`{ diff_base_sha, reviewed_sha }` pair for reviewer and redteam calls and routes it
through the same normalizer used by canonical slice and terminal whole-WK
subjects. No special selection authority, carrier, attestation, receipt,
provenance identity, or persistent review identity is required.

A review target is normalized only after the resolver proves commit type,
base-to-reviewed ancestry, the required nonempty range, readable reviewed tree,
and exact private-snapshot bytes. Canonical selectors additionally prove their
canonical subject binding. The resolver keeps incomplete, malformed,
missing-object, reversed-range, disjoint-range, binding-mismatch, and moved-target
causes distinct and returns no immutable target on any failure.

Every valid reviewer or admitted redteam call against a canonical committed
target receives a distinct run, monitor, source carrier, execution state, and
private materialization. Active or historical actions never block another call.
Restart may make an old process-local handle unknown and never turns history into
an admission latch.

Logs, results, and provenance are optional action-local audit evidence; advisory
reviews publish no receipt. They may describe the exact subject, committed
SHA/tree, diff base, role, run, monitor, and terminal disposition, but no result
set or latest-result projection has dispatch, admission, completion, integration,
or veto authority.

Historical `admission_review_target_unit` metadata is not read by review
execution and is not an occurrence or provenance prerequisite. Its absence,
staleness, or mismatch never requires retroactive repair. Ordinary `depends_on`
lineage remains available for a reviewer unit that challenges a predecessor
review or redteam result.

Findings-only reviews are advisory, not admissions or vetoes. Clean and
findings-bearing results may coexist indefinitely, and reviewer disagreement remains
visible in the retained evidence set. Active, missing, or malformed review output
also carries no boundary authority and never blocks another review. The separate
trusted integration operation is exactly-once and CAS-protected; it consumes only
the configured CCE policy decision for that boundary, or an explicit decision
free-substrate/no-gate posture. Paid CCE availability does not itself configure a
gate or imply either authorization or denial.

Worker and reviewer concurrency is expected. Launcher-minted attempt identities and
isolated worktrees/runtime state distinguish attempts; short critical sections and
exact ref/status compare-and-swap protect shared mutations. Process identity supports
observation and cleanup only. It is never review authority or a historical
per-subject dispatch prohibition.

Terminal whole-WK findings use the same independent-action model. The current
call binds the designated review unit, the published terminal candidate and its
base, WK ref and SHA, canonical WK digest, and current controlled generation, and
reviews a fresh action-private checkout of that candidate. A fresh call for unchanged inputs still launches a new
action; no durable store recovers, resumes, replaces, or returns an earlier
action after the process-local registry is gone.

## Exact-slice review-surface state budget

No managed post-worker route invokes slice-review preparation; this section is
the contract of the preparation primitive for its direct callers.
Slice-review preparation freezes and re-proves a closed, authority-bound state
budget rather than a repository-global snapshot. Bound state is the worktree
identity digest, canonical worktree path, linked Git directory, resolved common
and object directories, object alternates, the target worktree's own
registration fields (path, HEAD, branch, and the absence of bare, detached,
locked, and prunable), the launcher-bound slice ref, the worktree's symbolic
HEAD and HEAD commit, the reviewed commit and tree, the bound base commit and
tree, the ordinary index, and the physical checkout. Any drift in that budget
fails closed before reviewer launch.

The bound-ref set is exactly the target worktree's slice ref and its HEAD.
In-progress sequencer pseudorefs — `MERGE_HEAD`, `CHERRY_PICK_HEAD`,
`REVERT_HEAD`, `REBASE_HEAD`, `BISECT_HEAD`, and `AUTO_MERGE` — are refused when
present, because a mid-operation worktree is not a stable review surface.
`ORIG_HEAD`, `FETCH_HEAD`, every repository ref outside the bound-ref set, and
the registration, HEAD, and branch of every non-target worktree are explicitly
unbound: concurrent unrelated ref churn and movement in another checked-out
worktree cannot invalidate an otherwise identical review surface.

Object identity is bound by resolved path, not only by readability. A
substituted object or common directory, or an added or changed alternates
entry, fails closed even when every required OID stays readable elsewhere, and a
missing or wrong-type reviewed or base commit or tree object always fails
closed.

### Full provisioning is authoritative and no sparse guard exists

The retained slice worktree is provisioned v2/full, and that provisioning is
authoritative for checkout density. Sparse checkout is unsupported for this
surface: it is not a configuration the review path tolerates, detects, or
compensates for.

Consequently, review preparation neither probes sparse configuration nor
enumerates the ordinary index population. It reads no `core.sparseCheckout`,
`core.sparseCheckoutCone`, or `index.sparse` value in any scope, and it runs no
`git ls-files --sparse --stage` or `git ls-files --sparse -v` scan.

Nothing replaced them. There is no sparse-disable pin, no compatibility probe,
no bounded or sampled rescan, no early-exit predicate, and no increase to the
Git output-capture limit. The removal is the fix, not a step toward a smaller
guard.

The scans were removed because they were population-wide: their cost and output
grew with the size of the repository rather than with the review surface they
claimed to prove. Past a large-enough tracked population the staged scan's output
exceeded the launcher's Git output capture, and preparation failed before the
findings-only reviewer could start — a delivery-blocking failure with no bearing
on whether the review surface was exact.

Removing them narrows no authority. The exact worktree, ref, HEAD, base, and
reviewed tuple, the object-store and sequencer checks, the physical
checkout-tree verification, the ordinary-index classification and
reconciliation, historical launcher-delivery recovery, arbitrary third-index
refusal, and the complete postcheck are all unchanged. The `ls-files` calls that
remain enumerate untracked content only, so they are bounded by worktree dirt
rather than by the tracked population.

The public failure projection keeps its `...failure_projection.v1` schema
version. Its `config_key` and `config_scope` detail fields are retained in place
and in order as constant nulls, so existing consumers keep the same shape; no
refusal can populate them any more.

### Bounded postcheck mismatch diagnostics

A state-budget refusal names which bound fact drifted. The dispatch surface
republishes that name, and nothing else, as an additive
`postcheck_mismatch_field` on the thrown-diagnostic envelope, so an operator can
distinguish a moved slice ref from a substituted object directory without host
log access.

The projection is an explicit field list owned by the dispatch surface, not a pass-through
of producer detail. It applies only to the exact
`agent_launch.slice_review_materialization.postcheck_failed.v1` code; the detail
must be an own, plain-object, exactly-one-key `{ field }` shape carrying a plain
data property whose string value is a member of the closed bound-field enum.
Arrays, null prototypes, class instances, accessors, non-enumerable properties,
additional string or symbol keys, nested values, unknown values, and every other
diagnostic code omit the field entirely. Sibling refusals under the same code may
carry `git status` porcelain and raw stderr internally, but those fields are not
members of this envelope schema. This is a response-contract fact, not a
confidentiality or minimum-disclosure guarantee. Existing envelopes are otherwise
unchanged.

The additive field is published by the `get_run_result` catch seam
through one re-gate against the frozen 15-member vocabulary, so a widened producer
cannot widen what is published. The managed post-worker lifecycle does not run
slice-review preparation and therefore never carries this field on
`slice_lifecycle`. Carrying the diagnostic never promotes a run, and a refusal is
never rewritten into success, finalization, or an automatic retry.

## Terminal-review audit evidence

A terminal whole-WK findings action is independent. Its log, result, and
provenance, when captured, are optional evidence about only that action, and it
publishes no receipt. Capture failure does not change the action's result and
cannot prevent a later terminal findings dispatch. No result or provenance record
elects, replays, resumes, replaces, or settles a later findings action.

Run and monitor observation is process-local. An old findings handle may
truthfully be unknown after restart; a new call launches from the current
launcher-authenticated terminal source selection. Terminal candidate
construction, candidate CAS, forge handoff, and implementation/integration
lifecycle behavior remain separately owned and unchanged.

Forge publication does not authenticate or consume the historical findings
receipt, result, or provenance. Its eligibility owner authenticates the current
candidate, exact candidate version or controlled generation, base, current forge
facts, and applicable CCE decision only. Those inputs and the eligibility answer
are identical for absent, clean, critical/blocking, schema-invalid, failed, or
missing historical findings evidence. Retained review evidence remains optional
audit data and cannot enter the forge request, repair a candidate, or veto or
authorize publication.

Terminal review publication separates review occurrence, actual advisory text,
optional schema observation, and optional formal attestation. Captured text is
available and usable in full-result mode even after schema nonadherence or a
nonzero execution; compact mode carries its supported content reference. Parser
diagnostics annotate the schema observation instead of classifying the review as
invalid. Only an explicit formal-attestation request consumes adherence. The
coordinator reads and dispositions the actual response normally.

## Terminal findings execution (decision, work record)

The findings execution action for a canonical terminal whole-WK review unit is an
empty-scope immutable snapshot action. It does not advance a persistent
terminal/WK lifecycle, move the WK ref, or publish a candidate. Its immutable
review source is the launcher-published terminal candidate selected as described
in [Terminal candidates select material](#terminal-candidates-select-material-not-review-execution).
The WK ref remains unchanged, and the call binds the candidate's authenticated
generation and bytes for that call alone.

Terminal-candidate construction and forge coordination remain implementation
lifecycle owners. They supply the selected candidate object but grant the
findings action no provisioning authority, and caller-supplied locators cannot
select a candidate.
Every accepted terminal findings call creates a fresh run, monitor, source
carrier, and private materialization. Prior runs, receipts, results, failures,
roles, or metadata cannot select, satisfy, suppress, resume, replace, veto, or
refuse another terminal findings call. Observation is process-local; an old
handle may be unknown after restart. Logs, results, and provenance are optional
action-local audit evidence, no receipt is published, and capture failure cannot
block a later dispatch. Implementation candidate construction, integration, CAS, and
forge behavior remain independently owned and unchanged.

## Registered publication task composition

`task-publish-work.mjs` exports `createPublishWorkTask({workspaceRepos,
wkForgeHandoffAdapter, resolveWorkspaceRepo?, env?, responseEnv?,
requestSchemaAuthority?})` and `registerPublishWorkTool({registerTool,
...composition})`. Importing the module registers nothing. The registrar binds
the task's closed `PUBLISH_WORK_INPUT_SCHEMA` and guarded call to the supplied
host registrar. The production server, descriptors and orchestrator/operator grants expose
`workspace_publish_work` through this composition.

The mutation request is exactly `{subject: "WK-####"}`. Unknown properties and
slice subjects refuse before publication. The session profile's central grant
for `workspace_publish_work` controls entitlement during preparation. The incumbent repository resolver is
called without a caller alias. The trusted host must supply the runtime's
`wkForgeHandoffAdapter` bound to that same session repository. One valid entitled
request delegates once with `{assigned_unit: subject}`, without a preliminary
candidate read or an expected version populated by the task.

The existing publisher, production publication-state resolver and coordinator
own current candidate authentication under the same live WK
exclusion. The resolver first synchronizes the canonical WK and required authored
sources, then prepares and authenticates the resulting exact candidate. It applies its authentication, closeout,
expected-old publication and live-record fences. Local, plain Git
and hosted outcomes, exact candidate and publication identities, destinations,
proposals, unchanged repeats, permitted notes refresh and partial effects remain
producer facts. A later explicit request resolves the current state again. The
task itself performs no integration, persistence, candidate selection, proof,
review, merge or canonical completion; a published branch-local done record
remains branch-local.

Exact-tree generation authentication follows the authoritative manifest into its
immutable carrier directory, using the same selector as live generation reads.
Flat carrier copies are not alternative publication inputs. Saved case and
obligation sources retain their canonical paths. Missing or altered selected
members refuse with their source cause; observing diagnoses constructs no
candidate and repeats no publication.

`createPublishWorkTask` returns `{name, config, inputSchema, handler, call,
readOriginal, repeatRequest}`. Its `workspace-publish-work.v1` response preserves
`subject` and the producer's accepted/result-kind distinction. An accepted
`handed_off` outcome confirms a handoff; an accepted reconciliation outcome does
not confirm publication. `observed_facts["publication.confirmed"]` is the fact
used by publication continuations, distinct from live-record currentness.
Role, repository-binding and missing-adapter refusals occur before invocation
and state that publication was not attempted. They do not claim that no earlier
publication exists, authorize a role grant or prescribe server setup commands.
Unavailable publication, observation or diagnosis states the caller's specific
limitation without naming internal components as missing capabilities.

A successful response contains the usable hosted proposal or local/Git handoff,
the exact landing head and destination material needed by a human, material
preparation changes when reported, and actual publication changes or an unchanged
acknowledgment. Human instructions refer to the handoff's head and destination
without repeating those values. Candidate/tree/ref derivation, successful-check inventories,
authentication and boundary-authorization receipts stay server-side, including
on optional reads. The server does not retain a clean acknowledgment merely to
advertise a duplicate read. Publication neither merges nor completes work.
Hosted acknowledgments omit Git landing metadata and fixed authority captions;
the proposal locator and exact observer call carry the usable handoff.

A refusal carries its cause once under `producer.refusal.detail`, with a compact
blocker identity/category and the existing mechanical recovery contract. Known
preparation changes, partial effects and uncertain operations survive. An adapter
throw states that publication effects were not observed; it is not proof of no
effect. A producer that supplies no effects account is also marked unobserved.
Large diagnosis collections are requested detail even when spare inline
capacity remains. The ceiling is not a target. The task retains the complete
semantic diagnosis through the existing selected-response owner and offers the
bound `workspace_read_wiki({reference})` call only when details were omitted.
That read authenticates role/repository/route/subject and replays no publisher,
candidate resolution or landing observation. Operator-only capture bookkeeping,
including failed raw-capture storage that leaves the semantic diagnosis complete,
stays private. Repeated
exception renderings and empty finding populations do not create extra meaning
or another read. Missing/corrupt/foreign sources refuse through the existing owner.

If the detail reader or retention is unavailable, fitting semantic diagnosis
remains inline and can finish without storage bookkeeping or a saved-answer read.
When needed diagnosis cannot fit, the result preserves actual known effects and
names the retention cause or unavailable reader and omitted diagnosis. It does
not replay, claim rollback or advertise a nonexistent reader. A failure building
the diagnosis call after retention likewise preserves the publication outcome
and identifies that navigation failure, separately from adapter or storage failure.

`buildPublishWorkRequest(subject, {requestSchemaAuthority?})` remains subject-only.
It requires canonical membership and a matching serving registration/schema
before emitting a callable request; otherwise it returns non-callable intended
request data. No expected candidate or destination is invented.

For `handed_off`, the runtime issues the authenticated exact publication selection
from the minted handoff. The task forwards it unchanged in the serving-schema
validated `workspace_check_landing({subject,selection})` call. Local/Git human
instructions carry this call once as `next_action.observe_with`; hosted results
carry it in `next_calls`. The selection in that call is the observation binding;
no duplicate availability assessment is returned. Non-handoff outcomes receive no success
observation call. A publication-only task can finish without observing landing.

A missing selection, unavailable observer registration/contract, or failed
continuation construction is reported separately under `landing_observation`,
with its specific missing capability or cause and stopping condition. A valid
issued selection is preserved when its observer is unavailable. This does not
erase the confirmed publication, imply an adapter failure or justify replaying
publication to recover observation. Only a throw from the adapter invocation is
reported as `publication_adapter_threw` with unobserved publication effects.

A subject-only landing request explicitly observes current publication status.
It cannot substitute for the returned exact publication call. Later publication
movement never retargets an exact request: that request authenticates its original
version/head/destination/proposal or refuses with the actual selected-publication
cause. Pending landing offers useful human action and optional later observation;
landed observation can finish. Saved observations remain historical evidence.

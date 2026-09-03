
# Controlled-contract Operations

This page is the durable operation reference for controlled-contract authoring,
proof planning, assessment, artifact reading, and recovery. The general MCP
operation inventory remains in
[MCP Operation Reference](mcp-operation-reference.md).

- `workspace_controlled_test_proof_authoring_describe({})` returns the package-
  derived v0.3 binding schema, vocabulary, compatibility identity, and limits.
- `workspace_controlled_test_proof_query({wk_id, focus?, verification_ids})`
  selects only the named verification bindings and returns the carrier digest;
  v0.2 returns `migration_required` without an implicit complete-carrier read.
- `workspace_controlled_test_proof_patch({wk_id, focus?,
  expected_content_digest, operations})` applies package-validated binding
  upserts/removals and persists only through digest CAS. Stale, unknown,
  cross-WK, tampered, mixed, and partial state fail closed.
- `workspace_controlled_verification_bundle_patch({wk_id, focus?,
  expected_content_digest, operations})` is the orchestrator/operator authoring
  route for an absent structured-validation graph. Each of at most 64 strict
  `upsert` or `remove` operations carries `verification_id` and the complete
  closed `controlled-contract-verification-bundle.v1` value. That schema version
  and its complete required-field population are owned by
  `packages/controlled-contract/lib/test-proof-contract-v1.mjs`; the MCP input
  schema, the authoring state's emitted template, and the checked-in discovery
  row all derive from that owner rather than restating the field list, and a
  registration parity test rejects a narrowed or widened copy. The server resolves
  the same-WK carrier and path, delegates whole-prospective validation and
  canonicalization to the package, and performs at most one digest-CAS write.
  Exact-present upsert is a no-op; partial presence, replacement, content
  mismatch, unsafe removal, unknown fields, and invalid complete prospective
  state return bounded typed JSON-pointer diagnostics.

The controlled-contract surface is repository-local. Authoring, proof, and
assessment operations call the public `@agent-chassis/controlled-contract`
library directly; whole-generation persistence additionally composes the
launcher-owned lifecycle binding and Git primitive. It accepts stable WK, focus,
profile, intent, digest, and artifact identities plus bounded JSON or scalar
input; it never accepts a caller path, root, cwd, environment, module,
executable, package/profile directory, catalog, output location, or artifact
URI.

- Complete controlled-contract and proof carriers, generation persistence, and assessment bundles are server-owned primitives. Assessment APIs encapsulate those sources for context control: registered assessment routes expose the complete task-relevant semantic result, not the source bytes. This is an API boundary, not a security or filesystem-confidentiality guarantee. Semantic authoring routes below remain the only registered mutation surface.
- `workspace_controlled_contract_carrier_create` is orchestrator/operator-only
  expected-absence creation for `contract`, `evaluation_input`, and
  `proof_plan_request`. It validates through the package boundary and returns
  only a compact digest receipt. Exact-pack evaluation-input creation accepts
  `profile_id` and `profile_version` and derives
  `WK-####.pack-sha256-<64-lowercase-hex>.evaluation-input.json`, or
  `WK-####-<focus>.pack-sha256-<64-lowercase-hex>.evaluation-input.json`.
  The digest is `sha256-canonical-json-v1` over the exact
  `{profile_id,profile_version}` object. The dot-separated namespace is
  disjoint from root/focus grammar. Evaluation inputs are package-validated
  against only the addressed pack before persistence. A selected-pack request
  input carries only exact profile identity; the adapter composes every binding
  server-side before validating the complete request.
- `workspace_controlled_contract_carrier_query` returns a 4,096-byte compact
  target-filtered index with digest-bound continuation, or a 16,384-byte
  selective projection for at most 64 returned stable IDs or binding roles.
  The limits apply to the final pretty-JSON MCP structured response after every
  semantic and integrity field is materialized. A selected node or index item
  that cannot fit causes a typed fail-loud response; it is never byte-cut or
  spilled. `proof_plan` query returns only absent/current/stale source-binding
  metadata and the exact digest required for rebuild, never the compiled body.
  Absent or stale plans return one bounded exact
  `workspace_controlled_proof_plan_build` next call. Missing pack input returns
  `source_binding_status: incomplete`, the complete missing count, and one
  deterministic
  `workspace_controlled_contract_authoring_describe({carrier_kind:
  "evaluation_input"})` next call; querying again after each recovery advances
  through the bounded missing population.
- `workspace_controlled_contract_carrier_patch` is orchestrator/operator-only
  typed upsert/removal for every mutable contract and evaluation-input family,
  requested intents, and selected packs. Selected-pack upserts receive the same
  server-derived evaluation-input composition as create. Exact-pack
  evaluation-input patch accepts the profile pair, resolves request-bound,
  existing-pack, then legacy identity, validates only that pack, and performs
  one expected-digest CAS write.
  Carrier-validation recovery is distinct from authoring-continuation recovery.
  When the rejected contract candidate contains a `test_execution` verification
  without its stable proof and package validation reports the nested
  `stable_test_proof_missing` diagnostic, the refusal may include one canonical
  `workspace_controlled_verification_bundle_patch` action under
  `warning.payload.details.replacement_call`. The action is derived only from
  that rejected candidate, preserves its caller-owned values unchanged, and is
  omitted when the candidate context is insufficient or the action remains
  above the 12,288-byte action limit after compatible-value trimming. Validation
  of already-persisted carriers is unchanged, including the existing
  `stable_test_proof_required` recovery through
  `workspace_controlled_test_proof_patch`.
- `workspace_controlled_contract_authoring_describe` returns a compact package-
  backed carrier index or one bounded target schema, identity rule, mutability,
  and minimal valid template without loading a complete schema into discovery.
  Omit `target` to receive the available targets and the root template; supply
  one target to receive only that carrier-specific section and item template.
  The live root object requires `carrier_kind` and publishes grouped target
  alternatives plus a carrier-to-target mapping derived from package-owned
  `CARRIER_TARGETS`. Invalid targets return bounded `carrier_kind`,
  `valid_targets`, and a safe `rejected_target`. Every template declares whether
  it is structural-only or directly accepted by the addressed operation. In
  particular, the root
  contract template is structural-only and points to
  `workspace_controlled_test_proof_authoring_describe` for the semantic
  verification continuation; it does not promise unchanged carrier-create
  success.
  The selected-pack description marks `evaluation_input_path` as server-derived,
  and its caller template omits that field.
- `workspace_controlled_contract_authoring_state` accepts `repo?`, `wk_id`,
  optional root-or-slug `focus`, and an optional server-issued `continuation`.
  It is read-only and returns only `stage`, selected resource identities,
  unresolved decision identities/count, optional reusable continuation, optional
  disclosed `authoring_evidence`, and exactly one `next_calls` entry or one
  `stop_condition`. `packages/wiki-core/src/lib/controlled-contract-authoring-state.mjs`
  is the sole owner of the stage vocabulary and of that
  exactly-one-next-action-or-stop invariant; projections transport and
  mechanically check it and never restate it. Every nonterminal state's single
  action is directly callable: its tool name, identity, digests, and every other
  server-known argument are already bound, and only genuine author semantics stay
  open, enumerated as `author_semantics` entries carrying the exact pointer, the
  target type, and the server-known compatible candidates with an exact omitted
  count. No action is null-filled and none carries an `executable: false` marker.
  `authoring_evidence` discloses residue, the selected-pack population, and the
  requested-intent count, so a `complete` stage is never read as "nothing is
  outstanding" while non-authorizing authoring evidence remains on the carriers.
  A regression away from `complete` names the changed input or the failed
  prerequisite in `unresolved_decisions`. It never returns complete
  carriers, unchanged nodes, satisfied-role detail, skeleton bodies, or
  compatible-candidate populations. Orchestrator, reviewer, redteam, and
  operator profiles may inspect it.
  Before proof-plan convergence it derives every structured acceptance
  `verification_id` with the same binding facts and stable proof evaluation used
  by strict dispatch. Inspection, analysis, or absent identities return
  `verification_graph_required` and one operation-ready
  `workspace_controlled_verification_bundle_patch` call whose bundle already
  binds the verification claim identity, the `verifies` attachment relation, the
  boundary and traversal target-type constraints, and the admitted
  provider/version identities. A valid `test_execution` claim with an absent or
  invalid proof returns `stable_test_proof_required` and one operation-ready
  `workspace_controlled_test_proof_patch` call. Generic carrier patch and
  operator recovery are not stable-proof recovery routes.
- `workspace_controlled_proof_authoring_skeleton` accepts `repo?`, `wk_id`,
  optional `focus`, exact `selected_pack {profile_id, profile_version}`,
  non-empty `requested_intents`, either caller-chosen `bindings` or a complete
  `evaluation_input`, and the optional `proposal_draft` issuance modifier. It is
  orchestrator/operator-only. `proposal_draft` carries only caller-authored
  `carrier_operations`; when it is present it accompanies `requested_intents` and
  exactly one of `bindings` or `evaluation_input`, and it is never a third
  alternative to them. The exact source declaration is server-owned and derived
  from authenticated canonical state after the public boundary. The strict public
  schema has no source-declaration field or alias. The public route translates
  the accepted snake_case request into the canonical internal shape once and the
  core operation decides issuance validity. The draft's sole member is optional
  at ingress, so a missing, mixed, contradictory, or partial issuance reaches
  that owner and refuses with one stable code —
  `controlled_contract_proposal_issuance_input_missing`,
  `controlled_contract_proposal_issuance_input_mixed`, or
  `controlled_contract_proposal_draft_partial` — naming the exact pointer and one
  executable `replacement_call`, which the issuance owner emits as the sole
  correction field. The MCP boundary transports that owner response unchanged;
  it has no correction-field-specific projection or filtering adapter. No
  correction asks an author to resupply semantics the server already holds.
  `requested_intents` stays required by the input
  schema itself, so its absence is a schema refusal rather than one of those
  codes. The server resolves the canonical contract and every exact
  evaluation-input basename; caller paths and authority carriers are not
  arguments. The projected proof-plan request COMPOSES the canonical
  selected-pack population: re-authoring a selected pack replaces exactly that
  entry, every other pack keeps its exact bound basename, and requested intents
  are the union. A basename another pack already binds, or a second version of a
  profile the request already selects, refuses with the exact identities named.
  The result contains the distinct evaluation-input and composed
  proof-plan-request skeleton, unresolved required roles, diagnostics, selected
  identities, `continuation_issued`, one `next_action`, and an opaque
  `continuation` only when a proposal was issued. `digests.continuation` is the
  package identity digest and is never a server continuation, which is why every
  result names its own next action. It is authoring output, not proof.
- `workspace_controlled_contract_authoring_continue` accepts `repo?`, `wk_id`,
  optional `focus`, the opaque `continuation`, and optional returned
  `expected_stage` (`evaluation_input_ready` or
  `proof_plan_request_ready`). The stage is an assertion, never resolution
  authority. The orchestrator/operator-only route validates the server-held
  package continuation against WK, focus, canonical contract digest, package
  identity, and current carriers before performing at most one expected-absence
  CAS write. It returns the next compact task state.
- `workspace_controlled_contract_proof_graph_continue` is the single
  orchestrator/operator proof-graph publication route. Its strict input object
  accepts exactly optional `repo`, required canonical `wk_id`, optional canonical
  root-or-slug `focus`, and one required server-issued `continuation` matching
  `^(?:sha256:)?[0-9a-f]{64}$`. It accepts no caller proposal or proposal draft;
  path, root, basename, ref, SHA, policy, authority, writer, environment, and
  persistence carriers are also forbidden. Reviewers and redteams retain the
  read-only `workspace_controlled_contract_authoring_state` inspection route but
  cannot invoke this mutation; workers receive neither route.

  The continuation owns the complete server-held proposal. Wiki-core exclusively
  resolves and validates repository/WK/focus identity, selected pack, proposal,
  proposal bounds, current carrier set, source lease, publication persistence,
  replay/recovery, refusal, and receipt semantics. The wiki-MCP adapter performs
  only the strict bounded argument parse, repository selection, exact camel-case
  forwarding, error-envelope transport, and compact JSON response transport. It
  does not reconstruct package policy, write carriers, spill an over-bound
  success, add a fallback, or define another refusal taxonomy.

  Before publication, `proof_graph_required` authoring state is projected only by
  `projectControlledContractAuthoringState`. Its UTF-8 JSON size is at most the
  existing `TASK_AUTHORING_LIMIT` of 4096 bytes; it carries only selected resource
  identities, the server-issued continuation, unresolved semantic identities,
  semantic pointers and their complete counts, and exactly one executable call
  back to this route. It never carries the proposal, complete carriers, or
  candidate populations. Overflow is
  `controlled_contract_authoring_projection_too_large`.

  Success returns
  `controlled-contract-proof-graph-publication.v1`: `publication` contains the
  canonical-authoring profile, WK/focus identity, generation and manifest
  digests, carrier count, proposal digest, and `written`/`no_op` outcome; the sole
  `next_call` re-enters `workspace_controlled_contract_authoring_state` with the
  resulting continuation. The compact UTF-8 JSON receipt is at most the existing
  `CONTROLLED_CONTRACT_PATCH_LIMITS.receipt_bytes` value of 8192 bytes. Overflow
  refuses as `controlled_contract_receipt_too_large` and is never converted into
  a partial or spilled success.

  Typed invalid-continuation refusals are
  `controlled_contract_authoring_continuation_invalid`, `_unknown`, `_tampered`,
  `_stale`, `_cross_wk`, `_cross_focus`, and `_carrier_conflict`. Proof-graph
  refusals are `controlled_contract_proof_graph_cross_carrier_identity_conflict`
  and `controlled_contract_proof_graph_bound_exceeded`;
  `controlled_contract_proof_graph_proposal_incomplete` is reachable only when
  server composition still reports unresolved semantic pointers. Receipt
  overflow uses the code above. Recoverable failures preserve wiki-core's exact
  `replacement_call`, including an updated continuation when the owner records
  unresolved semantic pointers. No route-local recovery code replaces it.
- `workspace_controlled_vocabulary_query` returns the package-owned bounded
  vocabulary projection.
- `workspace_controlled_proof_intents_discover` returns bounded lexical
  candidates from the package-owned intent catalog. An explicit positive
  `limit` applies in list and search modes; the MCP schema caps it at 28 while
  the package retains its independent 256-item policy. `limit:N` returns at
  most `N` intents and reports truthful catalog, evaluated, total-match,
  returned, omitted, truncated, and `result_limit` facts. Omitting both `query`
  and `limit` preserves complete-catalog list behavior under the existing byte
  ceiling. The controlled-contract package measures `query` as UTF-8 and owns
  the 1,024-byte maximum. The live schema projects that byte policy rather than
  applying a JavaScript-character limit. An oversized query returns
  `proof_intent_discovery_query_too_large`, bounded byte facts, and the
  package-produced executable smaller-query retry.
- `workspace_controlled_proof_packs_select` runs exact package selection for
  explicit intent IDs against a canonical contract, then applies the wiki-core
  task-scoped projection before MCP response shaping. This is an ergonomics and
  relevance rule, not a confidentiality or security posture. The public
  `controlled-contract-proof-pack-task-page.v2` workflow returns requested
  intent identities and definitions; package-ordered candidate identities and
  versions; distinctions; guarantees; required bindings and inputs;
  compatibility and applicability facts; explicit exclusions and unsupported
  outcomes; relevant proof obligations; and executable describe and binding-
  inspection calls. Reusable task and candidate-index context appears once per
  page. The package remains the selection and ordering owner; wiki-core does not
  copy its enums or candidate logic.

  MCP measures the complete two-channel result against the active response-
  transport ceiling. When the task context does not fit, a server-integrity-
  bound cursor advances through deterministic whole semantic items with exact
  total, returned, and remaining accounting. It never byte-cuts JSON, spills,
  emits a generic or nested content reference, or asks the caller to reconstruct
  omitted state. Cursor binding protects integrity and currentness; it is not
  authentication, authorization, confidentiality, admission, or CCE authority.
  Unrelated contract populations, unrelated packs, raw package results, paths,
  and raw carrier bytes remain absent because they are irrelevant or unsupported,
  not because the task-required semantic context is secret.
- `workspace_controlled_proof_pack_describe` returns a compact-first summary for
  one exact profile ID/version, with bounded paged pattern/section detail only
  when selected. An individually oversized detail entry receives an item-scoped
  reference and advances the digest-bound cursor by one.
- `workspace_controlled_proof_pack_bindings_inspect` is
  compact-first assistance over canonical contract and evaluation-input
  carriers. Compatible candidates appear only for selected roles/statuses and
  use deterministic continuation. `evaluation_focus` omitted/null/slug means
  absent/root/focused input. When an input is requested, the operation's exact
  profile pair addresses its request-bound, existing-pack, or legacy carrier;
  final JSON is at most 4,096/16,384 bytes, with
  item-scoped oversized-entry recovery. With omitted `evaluation_focus`, an
  otherwise valid absent selected-pack input also exposes one executable
  `workspace_controlled_proof_authoring_skeleton` `next_action`. The package
  supplies binding facts and complete canonical candidates, while
  `controlled-contract-authoring-state` remains the sole owner that turns
  those facts into the action; server-owned evaluation-input paths stay out of
  the public selected-pack argument and unresolved author choices remain
  explicit `author_semantics` holes.
- `workspace_controlled_proof_plan_build` is orchestrator/operator-only. It
  loads the canonical request and same-WK evaluation inputs server-side,
  validates the complete supplied binding population through the package's
  validation-only build path, and exact-CAS writes only the deterministic proof
  plan carrier. It always reloads the request, so a request-only change is
  deterministically recompiled and CAS-replaces the prior plan even when
  metadata did not classify that request change first.
- `workspace_controlled_contract_assess` assesses canonical contract and proof
  plan carriers and publishes the package-produced ignored content-addressed
  assessment bundle. Its registered response uses one wiki-MCP materializer to
  reserve `workspaceRepo`, `assessment_identity`, exact per-collection counts,
  total and omitted counts, and the supported query route before wiki-core
  selects summary rows. The 8,192-byte limit is a final delivery bound, not a
  producer-content cap. Compact omission always identifies typed continuation;
  invalid allowance, count, identity, currentness, or projection state fails
  loudly. The public proof collections are `per_pack_outcomes`, `diagnostics`,
  `proof_exclusions`, and `missing_inputs`. Their descriptor-owned fields omit
  raw source material and source-derived detail, result, population, and
  requirement digests while preserving exact semantic codes, identities,
  outcomes, totals, and the shared non-authorizing assessment value.
- `workspace_controlled_contract_integration_test_design_assess` is an
  experimental, read-only assessment of caller-authored integration-test design
  declarations. It is a separate operation from
  `workspace_controlled_contract_assess`; the latter keeps its existing
  proof-plan assessment meaning. The public request selects a canonical
  `WK-*` or `WK-*#SLICE-*` unit and carries only inline axis-applicability
  decisions, declared integration tests, declared scenarios, declared
  interactions, and review questions. Repository identity, work-record and
  carrier digests, generations, requirements, obligations, acceptance
  mappings, census members and counts, provider identities/currentness,
  outcomes, assessment state, and authority claims are resolved or rejected
  server-side, never trusted from the request.
- `workspace_controlled_contract_runtime_prove` is the post-integration
  counterpart, orchestrator/operator-only, declaring `process_spawn` and
  `workspace_write`. Its `unit` selects one exact integrated implementation
  slice (`WK-nnnn#SLICE-nnn`); a whole-WK subject refuses. It resolves the
  canonical integrated lifecycle and the launcher-owned fixed WK fork and
  ref/tip, materializes one private mode-0700 detached checkout at that exact
  tip, executes the slice's declared candidate, falsifier, and traversal
  population through the launcher provider boundary, validates every
  authenticated `controlled-contract-test-proof-runtime-evidence.v2` receipt,
  and returns `controlled-contract-assessment.v3` with `assessment_scope`
  `runtime` and `non_authoritative` authority. Caller-supplied lifecycle, Git,
  path, command, environment, provider, receipt, witness, assessment, and
  authority fields refuse rather than being overridden, and `focus` refuses
  because launcher proof identity binds the same-WK root generation. Any
  lifecycle, population, provider, receipt, or assessment failure returns a
  typed refusal with no planning assessment; it never calls
  `workspace_controlled_contract_assess`, and it is not a proof-pack authoring,
  selection, assessment, admission, or authority surface.
- `workspace_controlled_contract_assessment_query` and
  `workspace_controlled_contract_integration_test_design_query` page only
  descriptor-owned task-relevant semantic collections from the existing
  30-minute opaque snapshot registry. The 16,384-pretty-JSON-byte and 64-item
  limits are delivery bounds only. Complete rows remain in the snapshot: an
  oversized row returns its typed field inventory, nested arrays and objects
  continue as typed field projections through the same cursor owner, and an
  oversized scalar continues by authenticated UTF-8-byte `offset`/`length`
  ranges with an exact `total`. Authenticated cursors bind family, assessment
  identity, collection, exact row selector, field path when present, ordinal,
  ceilings, and expiry. Each page reports exact matched, returned, and omitted
  counts and the shared non-authorizing value. Unknown, expired, stale,
  cross-family, malformed, or count-inconsistent continuation fails loudly;
  no route spills, byte-cuts, ellipsizes, reruns to reconstruct, or exposes a
  raw carrier or content-reference envelope.
- `workspace_controlled_contract_private_scope_census` returns a
  deterministic, ID-ordered, digest-bound read-only census capped at the same
  16,384-byte/64-item page bounds. Its policy facts are possible CCE input, not
  local refusal authority.

Assessment and runtime proof answer different questions and neither substitutes
for the other. `workspace_controlled_contract_assess` is planning-only: it reads
authored carriers, writes its content-addressed bundle (`workspace_write`), and
executes nothing, so repeating it after a delivery lands re-reads the same
planning inputs and can never establish runtime truth.
`workspace_controlled_contract_runtime_prove` runs only after that delivery is
integrated, and what it returns is executed evidence rather than authority: it
grants no admission, certification, CCE, or dispatch outcome.

### Experimental integration-test design assessment

The integration-test design assessment composes the manifest-selected
controlled contract and proof plan with the canonical obligation source, the
current acceptance mappings, and registered server-owned census providers. The
initial complete provider population is exactly:

- registered controlled-contract route population;
- exact session-role/tool profiles for those routes;
- the five result-schema states (`pass`, `fail`, `incomplete`, `unevaluable`,
  `review_only`); and
- the manifest-selected declared-mutant population.

The ten assessment axes are registered routes, selector partitions, authority
producer/consumer edges, role/tool profiles, failure phases, result-schema
populations, persistent refs/state, concurrency/interleavings, declared
mutants, and prohibited stubs/shortcuts. An axis without a registered complete
and current provider remains explicitly unsupported, incomplete, unevaluable,
not applicable with the caller's rationale, or review-only; it cannot silently
pass. A stale or absent obligation source, stale acceptance mapping, or stale,
partial, ambiguous, unsupported, or absent provider likewise cannot produce
`pass`.

`fail` identifies a resolvable omission or contradiction in the authored
design. `incomplete` and `unevaluable` identify a canonical comparison that
could not be completed. `review_only` is a distinct non-pass terminal state.
Every result retains the exact required, declared, matched, missing, extra,
contradictory, unsupported, and omitted populations, their counts and
denominators, and the lossless requirement/obligation/scenario/population joins
server-side in deterministic order. Gap-first diagnostics and descriptor-owned
semantic pages are deterministic. A projection that cannot fit its declared
bound fails loudly and is never byte-cut, spilled, or reconstructed through a
secondary route.

This operation does not execute tests, inspect test source, consume traces,
coverage, launcher evidence, or persist authored declarations or assessment
state. Successes and refusals explicitly deny proof, requirement, admission,
dispatch, review, integration, publication, and completion authority. The
result is declared-design sufficiency evidence only; it does not establish
runtime test validity, implementation correctness, CI gating, or delivered
runtime truth.

Assessment authenticates a shipped
`controlled-contract-component-exclusion-applicability.v1` companion only as
part of the exact admitted-pack snapshot. Its projection binds the assessment
cycle, profile ID and version, profile and admission digests, contract and
evaluation-input source digests, companion digest, component selector,
evaluation stage, complete exclusion domain, and exact applicable subset. The
assessment neither authors this fact nor infers or interprets selector
compatibility.

An authenticated component whose `applicable_exclusion_ids` is `[]` is a
positive empty applicability claim over its declared complete
`exclusion_ids` domain. A missing companion is different: it produces no
authenticated applicability projection, never an inferred empty subset.
Legacy packs without the companion therefore fail closed at this boundary;
stale, reordered, substituted, copied, or spliced facts likewise produce no
authenticated projection. For the public controlled-contract concepts and
planning-authority boundary, see the
[MCP operation reference](mcp-operation-reference.md#controlled-contract-operations).

A new one-pack request adopts an already-created exact-pack carrier; otherwise
it retains the legacy root/focused basename. Extending a legacy one-pack request
preserves that binding and assigns only added packs disjoint per-pack basenames;
a new multi-pack request assigns every pack a disjoint basename. Request-bound
identity always wins for existing requests. Caller paths, basenames, aliases,
traversal, cross-WK/focus identities, duplicates, missing inputs, and sibling
roles never gain resolution authority and refuse before persistence or output.

## One proof-authoring lifecycle

Proof authoring has exactly one semantic owner and one publication route, and the
author supplies semantics exactly once.

This lifecycle begins only after inbox allocation and the design reviews in the
[design-first operating model](../AGENTS.md#wk-first-work). It is semantic
post-allocation authoring, never a raw contract/proof birth payload or a local
lifecycle-sequencing gate.

1. **Validated skeleton.** `workspace_controlled_proof_authoring_skeleton` builds
   the package-owned evaluation input and composed proof-plan request from one
   exact selected pack, explicit intents, and one semantic input — either
   `bindings` or a complete `evaluation_input`, never both. The validated
   skeleton bytes and their bound identity are the semantic owner; nothing
   downstream re-derives them or asks the author for them again.
2. **Server-completed proposal.** Issuance completes the proposal against every
   server-known target it resolved: the reference-binding population, the
   number-binding population, `evaluation_stage`, `requested_intents`, and the
   one selected pack this pass composed. An absent operation is filled from the
   skeleton; a declared operation carrying everything the server resolved is
   preserved verbatim, extra caller fields included; a declared operation that
   contradicts the skeleton fails closed at issuance, before any continuation
   identity, carrier byte, or generation exists. Completion never buys itself
   room inside the package-owned operation bound — the reported total counts the
   completed proposal, not the submitted draft. Contradictory spellings of one
   value — `evaluation_stage` alongside `evaluationStage` — refuse as
   `proof_authoring_evaluation_stage_conflict`, carrying both supplied values,
   `canonical_field`, and `supplied_aliases`, with no silent precedence and no
   normalization.
3. **One continuation.** Issuance mints exactly one server continuation. It is
   opaque, content-addressed over the completed proposal, and holds the bound
   skeleton identity, the selected pack, and the proposal. The exact source
   declaration is server-owned and derived from authenticated canonical state;
   the caller-authored draft is not what is bound.
   `digests.continuation` is the package identity digest and is never a server
   continuation.
4. **Server-derived source lease.** The expected-source population is verified
   against the canonical carrier set the server itself resolves under one source
   lease at continuation time. `evaluation_input` is resolved against the
   selected pack's own basename rather than the root basename, so a pass that
   authors a new pack expects it absent while a re-authoring pass expects the
   exact bound member. Stale continuation identity remains
   `controlled_contract_authoring_continuation_stale`. A canonical carrier that
   was expected absent but is created before continuation instead invalidates the
   source set and refuses as
   `controlled_contract_authoring_continuation_carrier_conflict`; that refusal is
   neither a valid publication transition nor a recovery hop. The source
   declaration and lease are authenticated server state; no caller-held
   declaration or lease exists.
5. **Publication.** `workspace_controlled_contract_proof_graph_continue`
   publishes the exact server-held carrier set atomically: one generation, one
   manifest, `written: true`, `no_op: false`, and one `next_call` back to
   `workspace_controlled_contract_authoring_state`. A composed request keeps
   every already-selected pack at its exact bound basename and adds this pass's
   pack at the exact server-minted `pack-sha256-*` basename; requested intents
   are the union. A between-effect failure publishes nothing and leaves neither
   transient residue nor an unreferenced generation.
6. **Replay.** Continuing again on the settled continuation is a durable no-op:
   `written: false`, `no_op: true`, the identical generation, the identical
   member digests, and no publisher effect reached at all. The consumed
   pre-publication continuation cannot re-enter the graph; it refuses as
   `controlled_contract_authoring_continuation_stale` and names the canonical
   stateless authoring-state recovery.

### Durable continuation owner

Proof-authoring continuations are repository-scoped runtime state. Wiki-core
resolves the repository first, then owns
`.agent-runs/controlled-contract-authoring-continuations/v1`; callers supply
only the opaque continuation identity and never supply a path, root, environment
variable, storage location, or persistence authority. This runtime directory is
separate from canonical carriers, carrier generations, work records, generated
wiki views, and committed artifacts. Repository cleanup owns it; carrier
publication and rollback never move its records into `wiki/`.

Issuance writes the complete content-addressed record to a same-directory
temporary file, synchronizes it, atomically renames it to its digest-owned name,
and synchronizes the directory before returning the identity. Continuation
updates use one repository-local, WK-scoped lock and one immutable transition
record containing the complete updated target. Equivalent issuance or updates
converge on identical bytes and identity. Conflicting concurrent updates select
one transition; every other attempt observes that stable outcome and refuses as
stale without a partial record.

Every load rejects symlinks, traversal, malformed JSON, an unexpected record
shape, an identity/content mismatch, a changed semantic owner, an invalid source
declaration, or an invalid proposal before deeply freezing the authenticated
record. Missing durable state remains unknown; there is no process-local cache
fallback and no test reseeding path. Permission, capacity (`ENOSPC`), file-sync,
atomic-rename, lock, and cleanup failures fail loudly as continuation persistence
errors. Failed operations clean only their own temporary record and lock; they
do not select a carrier generation and leave no temporary continuation, staging,
transient manifest, rollback artifact, or orphan carrier generation. A fresh
Node process therefore reopens only the server-resolved scratch repository and
can resolve, continue, settle, and replay the same opaque identity.

### Removed and confined public surface

- `expected_sources` is not a public `proposal_draft` field. The server derives
  the exact source declaration from authenticated canonical state and persists
  it behind the continuation boundary.
- The retired `corrected_call` field is not emitted by the owning source.
  `replacement_call` is the sole correction field, and its emitted arguments
  change the named deciding fact without restating component, suite, requested
  intents, selected packs, focus, or any server-derived source fact.
- Generic carrier create/patch and verification-bundle patch are not proof-
  authoring routes. A proof-authoring trace that reaches one has left the
  lifecycle, and the routing vocabulary names them as forbidden first tools.
- Re-entering `workspace_controlled_proof_intents_discover` from a bound
  continuation is a backward transition, not a recovery.
- `workspace_controlled_contract_authoring_continue` remains the task-directed
  carrier-authoring continuation. It is a different lifecycle, it is not the
  proof-graph publication route, and it is no longer reachable as a next-call
  family from the proof-skeleton routing intent.

### Direct settled state

After publication, valid root, focused, and existing-request continuations read
back directly from `workspace_controlled_contract_authoring_state` as
`proof_plan_ready`. No valid trace emits
`controlled_contract_authoring_continuation_carrier_conflict`, returns a
replacement call, or takes a recovery hop. Invalid continuation input retains
its typed refusal vocabulary. Publication and identical-generation replay keep
the atomic and no-op behavior above; the wiki-core authoring state machine alone
owns the settled-state decision.

## Assessment-first proof-plan recovery

Call `workspace_controlled_contract_assess` before attempting to build or read a
proof plan. Supply `{wk_id}` for the root carrier, or `{wk_id, focus}` with the
exact canonical lowercase focus slug for a focused carrier. The assessment
response distinguishes these state-directed cases:

- `controlled_contract_proof_plan_request_missing`: the request carrier is
  absent. Inspect its package-backed authoring contract with
  `workspace_controlled_contract_authoring_describe({carrier_kind:
  "proof_plan_request"})`.
- `controlled_contract_evaluation_input_missing`: a required evaluation-input
  carrier is absent. Inspect its package-backed authoring contract with
  `workspace_controlled_contract_authoring_describe({carrier_kind:
  "evaluation_input"})`.
- `controlled_contract_proof_plan_missing`: the proof-plan carrier is absent.
  Build it with `workspace_controlled_proof_plan_build({wk_id,
  expected_content_digest:null})` for root, or
  `workspace_controlled_proof_plan_build({wk_id, focus:"<exact-slug>",
  expected_content_digest:null})` for focus. `null` means confirmed absence;
  it is not a wildcard or a request to select a different carrier.
- `controlled_contract_proof_plan_stale`: the proof-plan carrier exists but
  does not match the current canonical sources. Rebuild with the same root or
  focused identity and the exact `expected_content_digest` returned by
  assessment (or by querying that carrier's current metadata with
  `workspace_controlled_contract_carrier_query({wk_id, carrier_kind:
  "proof_plan"})`, adding `focus:"<exact-slug>"` for focus). Do not replace a
  stale digest with `null`.

An existing proof-plan carrier owns assessment precedence. When it is present
and current, assessment returns the normal non-authoritative planning
projection (`assessment_scope:"planning"`), with no recovery call; request-
missing and evaluation-input-missing discrimination applies only when no
proof-plan carrier exists. A normal planning projection does not by itself
prove that the source carriers are present. A successful build is followed by
another assessment call.
The root/focused distinction applies to every carrier operation: root calls
omit `focus`, while focused calls carry the exact slug; `carrier_kind` is the
typed selector (`contract`, `evaluation_input`, `proof_plan_request`, or
`proof_plan`), never a path. For binding assistance,
`workspace_controlled_proof_pack_bindings_inspect` uses omitted
`evaluation_focus` for no evaluation input, `evaluation_focus:null` for the
root evaluation-input carrier, and `evaluation_focus:"<exact-slug>"` for a
focused evaluation-input carrier. The shared wiki-core identity owner limits a
non-null evaluation focus to 128 UTF-8 bytes.

`workspace_controlled_contract_carrier_query` has two modes. Without
`selectors`, index mode applies `target`, `filter`, and `cursor`; its target
vocabulary and invalid-target recovery are derived from `CARRIER_TARGETS` for
the addressed carrier kind. With a nonempty `selectors` list, selected mode
takes precedence and intentionally ignores `target`, `filter`, and `cursor`.
This interaction is not a mutual-exclusion rule.

Every public input field named `focus` mechanically projects
`CONTROLLED_CONTRACT_FOCUS_GRAMMAR`, the shared package-owned grammar: omit it
for the root carrier, or supply one canonical lowercase slug matching
`^(?!wk-[0-9])(?!slice-[0-9]+$)[a-z0-9]+(?:-[a-z0-9]+)*$` and no more than 128
UTF-8 bytes. The package-owned pattern reserves `wk-[0-9]` prefixes and exact
`slice-<digits>` forms. Slice IDs, `WK-####[#slice]` addresses, paths, uppercase
forms, and noncanonical separator forms are refused with the stable
focus-identity cause and the accepted root-or-slug form before repository
resolution.

These recovery projections are bounded, state-directed MCP guidance only.
They do not accept caller paths, roots, output locations, or other authority
carriers; they do not provide a CLI fallback or claim runtime truth. The
documented role restrictions and the compact/selected response bounds above
continue to apply.

Bounded carrier query, task-state inspection, authoring/pack description,
binding inspection, controlled queries, selection, assessment, and artifact
reads are available to orchestrator, operator, reviewer, and redteam profiles.
Create/patch authoring, task continuation, proof-skeleton generation, and
proof-plan construction are orchestrator/operator-only. Complete-carrier
read/write is operator-recovery-only; workers receive none of these routes. All
outputs preserve the package's typed axes,
residue, exclusions, admission and non-authoritative markers; none claims
runtime truth, evidence sufficiency, CCE or organization policy, readiness,
authorization, or dispatch authority.

Task-directed refusals preserve stable reason codes:
`controlled_contract_authoring_continuation_invalid`, `_unknown`, `_tampered`,
`_stale`, `_cross_wk`, `_cross_focus`, and `_carrier_conflict`; the last remains
an invalid-input refusal, not a valid publication transition. Recoverable
refusals include one `replacement_call` to the current canonical authoring-state
route with the caller's continuation removed, so an identical blind retry is
never prescribed. Use direct carrier describe/query/create/patch only when that
state or an explicit low-level recovery request calls for it; the package CLI is
not an agent fallback.

Every controlled-contract operation boundary returns the same frozen
`controlled-contract-mcp-refusal.v1` envelope, whose payload is
`controlled-contract-refusal-payload.v1` carrying `reason_code` plus a structured
`details` object. Schema-valid detail values, including JSON pointers, paths, and
nested caller-owned subtrees (`carrier_operations`, `evaluation_input`,
`replacement_call`), cross value-identically.

That envelope has two populations, and they are now distinguishable. A TYPED
refusal carries one of the stable reason codes above and is caller-correctable;
its code, message, and payload are unchanged. An UNEXPECTED INTERNAL EXCEPTION —
a programming defect that reaches the boundary with no reason code — still
projects the stable `controlled_contract_operation_failed` code, but its `details`
additionally carry one closed
`controlled-contract-internal-exception-diagnostic.v1` object under
`internal_exception`. Callers must keep treating
`controlled_contract_operation_failed` as terminal and must not branch on the
diagnostic's prose; it exists so an operator can identify the defect instead of
reading an opaque "operation failed".

The object has exactly these eleven keys and no others:

| Key | Value |
| --- | --- |
| `schema_version` | `controlled-contract-internal-exception-diagnostic.v1` |
| `unexpected_internal_exception` | always `true` |
| `caller_correctable` | always `false` |
| `exception_class` | the thrown value's class name, or its `typeof` for a non-`Error` |
| `summary` | the complete ordinary diagnostic, with only structured sensitive components removed |
| `summary_redactions` | closed signals for structured sensitive components removed from `summary` |
| `summary_truncated` | always `false`; ordinary diagnostics are never capped |
| `cause_class` | the cause's class name, or `null` when there is no cause |
| `cause_summary` | the cause's complete ordinary diagnostic under the same rules, or `null` |
| `cause_summary_redactions` | closed signals for structured sensitive components removed from `cause_summary` |
| `cause_summary_truncated` | always `false` |

**Losslessness.** `summary` and `cause_summary` have no character or byte cap.
Unicode, newlines, punctuation, and length survive exactly inside the controlled
route's declared semantic bound. A controlled-contract response that cannot fit
fails loudly and provides no secondary byte-recovery transport.

**Cause.** Exactly one cause level is described. A cause is summarized whenever
one is present and safely inspectable — it does NOT have to be an `Error`; a
string, number, symbol, or plain-object cause is classified and summarized the
same way. Traversal is bounded rather than recursive, so a long cause chain cannot
grow the envelope and a cause cycle terminates deterministically.

**Redaction.** Diagnostic/free-form/untrusted content is not a redaction class,
and neither field names nor prose shapes trigger removal. Paths remain ordinary
diagnostic values. A producer may explicitly declare an exact value as actual
secret material or legitimately private state; only that exact value is replaced
and signalled with its closed reason, while every surrounding and nested value
remains unchanged.

**What it never carries, and never grants.** No stack trace, arbitrary error
object, structured secret component, environment value, or credential. A
caller-supplied `toString` is never invoked, so an object whose
stringification would expose server state cannot smuggle it out; such a value is
described by its class instead. The diagnostic grants no retry, continuation,
recovery, policy, CCE, completion, or filesystem authority — a defect is not
something the caller corrects by retrying, and `caller_correctable: false` says so
rather than leaving it implicit.

**Boundary robustness.** Constructing a refusal never throws. Every read of the
thrown value is guarded, so a throwing getter, a hostile `Proxy`, a
null-prototype object, a primitive, a `Symbol`, or a non-`Error` value still
produces exactly one refusal envelope. The handler for unexpected
exceptions does not widen the throw surface it exists to contain.
### `workspace_verify_proof`

This authenticated orchestrator and launcher-managed worker/reviewer operation
accepts required `obligation_id`, optional `repo`, and orchestrator-only optional
`git_sha`. The request is closed: undeclared members and caller-selected target,
path, command, environment, provider, evaluator, receipt, policy, or authority
refuse. Managed workers and reviewers cannot supply `git_sha` or escape their
launcher-bound candidates. The server joins the obligation coverage row,
controlled behavior and `verifies` relation, unique `test_execution`
verification, declared Node-test target, stable test-proof binding, exact
candidate/source snapshot, complete runtime receipts, admitted post-delivery
pack, and content-addressed evaluator. It never selects a current, compatible,
or latest evaluator as a substitute.

The declared target comes only from the selected unit's canonical structured
`acceptance.validation[]` entries. Such an entry remains exactly
`{ command, verification_ids }`; there is no `target` field or second
validation carrier. For this operation, wiki-core accepts a bound command only
when it has the exact no-shell form `node --test <target>`, with one ASCII space
between tokens and no leading or trailing text. `<target>` must be one POSIX
repository-relative path of at most 4,096 characters, must end in lowercase
`.mjs`, and may contain only `/`-separated `[A-Za-z0-9_.-]+` segments. Empty,
`.` and `..` segments, an option-like leading `-`, absolute or backslash paths,
flags, multiple targets, quoting, shell metacharacters, whitespace, and control
characters are rejected. The parser does not invoke a shell or inspect the
filesystem.

The verification identity must occur exactly once in those entries. A missing
binding is non-executable; malformed, unsupported, or duplicate bound
declarations produce a typed integrity refusal before process execution.
The selected implementation unit supplies the worker declaration. For a
reviewer, the launcher-frozen reviewer binding selects the reviewed
implementation unit, and stale, ambiguous, or cross-WK review bindings refuse.
The candidate, controlled-contract generation, and source snapshot remain
server-resolved runtime identities rather than authorable validation fields.
MCP adapters pass the complete canonical selected unit to wiki-core and do not
parse commands or reconstruct verification mappings.

An orchestrator `git_sha` must be the configured repository's lowercase full
object-width commit identity. Abbreviations, refs, revision expressions,
all-zero identities, missing repositories, and non-commit objects do not select
another source. The runtime authenticates the commit and tree, materializes a
private detached mode-0700 checkout, and executes only there. With no `git_sha`,
it authenticates the configured worktree's HEAD/tree, dirty status, and exact
source-snapshot digest, copies those bytes into a disposable private candidate,
and requires source/candidate equality. The configured worktree is never the
orchestrator execution root. A dirty snapshot is ephemeral proof of those bytes,
not of HEAD, a commit, or deployment.

The operation may spawn only the joined declared target through the shared
launcher executor. Worker execution remains confined to the assigned worktree;
reviewer execution remains independent and confined to the frozen reviewed
candidate. Source/candidate movement, identity mismatch, checkout escape, and
cleanup failure refuse loudly. The private orchestrator candidate is cleaned up
after success and failure. Complete results identify the `git_commit` or
`worktree_snapshot` candidate and remain non-authoritative `satisfied`,
`unsatisfied`, reason-coded `not_executable`, or typed refusal. Copied responses
and incomplete retained receipts have no restart/replay authority; a later call
is a fresh proof instance. No result grants dispatch, review, admission,
integration, completion, CCE, lifecycle, policy, or general process-runner
authority.

## Generation-bound controlled-contract refactoring

Three MCP operations expose the bounded refactor lifecycle:
`workspace_controlled_contract_refactor_plan`,
`workspace_controlled_contract_refactor_query`, and
`workspace_controlled_contract_refactor_apply`. Discovery routes the
`controlled_contract_refactor` intent to `plan` first. Plan and query are
read-only; apply is a workspace write. Planning and apply are visible only to
orchestrator and operator sessions. Query is also visible to reviewer, worker,
and redteam sessions because an immutable plan or receipt grants no mutation or
lifecycle authority.

The package's single stable-v1 refactor-graph primitive receives the complete
current carrier population that wiki-core resolves. Its closure includes
contract nodes and edges, collection membership, verification bundles, stable
test-proof references, obligation and acceptance mappings, proof-plan source
bindings, and assessment source bindings. Plan, apply, and the existing
assessment surface consume the same package result. The assessment summary and
`cross_carrier_integrity` query collection expose dangling references, orphan
verification bindings, mappings to absent nodes, stale derived carriers, and
generation-identity conflicts without a second traversal or classifier.

`rename_identity` accepts distinct `old_identity` and `new_identity` values.
The package rewrites the closed identity graph and admits the mode only as
`identity_equivalent`; caller-provided `old_node` and `new_node` witnesses, when
present, must differ only by that identity. A proposition, modality,
applicability, verification method, relation role, collection membership, or
proof-requirement change is a mechanical refusal whose recovery names
`replace_subgraph`.

`replace_subgraph` requires a nonempty reason, an explicit old-to-new
correspondence, and the carrier patch operations that materialize every new node
and remove every old live edge. Empty new-identity arrays represent removals;
one-to-many rows represent splits. Changed or newly mapped nodes receive
explicit proof gaps with `proof_credit:"not_transferred"`. The package does not
classify coverage conflicts. Wiki-core delegates prospective obligation and
acceptance mappings to their existing rebase owners, and the finalization form
of `workspace_controlled_contract_refactor_plan` accepts the server-issued plan
and conflict-set identities plus both complete disposition populations. Only a
fully current, completely dispositioned result releases the unchanged opaque
apply continuation.

The initial plan is the first deterministic semantic page. Every page reports
`complete`, `returned`, `omitted`, and `remaining`; a nonfinal page returns one
authenticated cursor for `workspace_controlled_contract_refactor_query`. The
cursor owner is wiki-MCP's existing controlled-contract task-cursor codec, while
wiki-core owns deterministic order and its resource, kind, selector, snapshot,
offset, page-size, currentness, and stale-recovery binding. The final complete
plan page returns either the disposition-finalization call or the apply call,
never both. Receipt queries use the same lossless counts and semantic selectors
against an immutable receipt. An individually oversized plan or receipt item is
replaced by `controlled-contract-refactor-item-reference.v1`; repeated ranged
calls to `workspace_read_mcp_content_reference` reconstruct that one exact JSON
item. This is not a generic artifact store or query operation.

Apply accepts only `{ continuation, repo? }`. It reopens the existing durable
authoring continuation, acquires the existing canonical source lease, verifies
the exact source generation and manifest digest, and coordinates the existing
coverage persistence owners with the canonical generation publisher. Coverage
files remain outside carrier-set membership. Preparation, staging, coverage
commit, manifest selection, reverse compensation, transition reconciliation,
and immutable receipt settlement use one shared-lease transaction. A repeated,
restarted, or concurrent identical call converges on the same receipt identity
and bytes; a stale source returns an executable fresh-plan recovery. Historical
generations, evidence, proof results, assessments, and receipts remain
immutable. Proof plans and assessments invalidated by the new generation become
stale through their normal source bindings and must be rebuilt, reassessed, or
proved through their existing owners.

Every refactor failure preserves exactly one `mechanical_failure` or
`returned_policy_decision` limb, the producing owner code, deciding facts,
would-break invariant, and supported recovery. These operations synthesize no
policy decision and grant no proof, review, dispatch, integration, publication,
completion, or CCE authority. They are not generic diff, migration, rollback,
audit, or raw-carrier mutation operations.

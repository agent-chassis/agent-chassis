
# Acceptance-coverage MCP

Exact proof-pack parameter, source and construction metadata belongs to the
controlled-contract package. See [Proof pack parameters](proof-pack-parameters.md)
and its complete per-pack index. These declarations do not create another
instance-value store or change the coverage and canonical-resolution owners.

This page owns the public protocol for authoring the upstream controlled-contract
obligation source and for authoring and inspecting its downstream acceptance-
coverage mapping carrier. Both surfaces extend the existing canonical resolver,
currentness, carrier/schema, bounds, CAS, pagination, content-reference, role,
discovery, and routing owners. They do not define another obligation census,
evaluator, cursor, coverage vocabulary, state machine, authority owner, or
documentation catalog.

Selecting a proof accounts for an obligation’s proof decision without requiring an
execution case or a runnable test. An unmade proof decision leaves the obligation
unfinished. Omit an unknown case rather than supply an incomplete one: supplied
case defects remain authoring defects. A complete case may name a planned test
before implementation; execution checks existence and support. Falsification is
optional through the existing explicit `{support: "registry_unsupported"}` case
declaration. It requires no separate permission, installation-wide provider
absence or failed mutation attempt; acceptance remains required. A passing
selected test and positive execution evaluation supply no missing detection
evidence and do not establish the linked requirement’s behavior.

## Saved applications in current readiness

Current readiness reads the canonical v3 obligation source through the shared
proof-authoring resolver. It does not require a `proof_plan_request` or compiled
`proof_plan`, and it never constructs those artifacts to inspect saved selections,
parameters or exact pins. Plan-based compilation remains a separate operation.

The saved obligation and its selected proof are the authoritative association.
`resolved-obligation-coverage.v1` projects the exact selection and authored meaning,
with a resolved identity, `design_status` and owner diagnostics. It requires no
acceptance-criterion locator or separate guarantee selector. Existing authored
native node links remain available and are checked when present; none are inferred.
Which acceptance criteria an obligation covers is a separate author-declared fact
saved on the obligation itself; see
[Author-declared criterion coverage](#author-declared-criterion-coverage).

A resolved association, semantic completeness and executable proof support are
separate facts. Authoring and implementation admission depend on the saved
meaning and its integrity, never on an installed executor, an available
constructor or whether anything can run the selected proof. A `test_execution`
verification can state its verifier, observation and falsifying condition
without supplying `verification.runtime_test`. That omission does not make the
meaning incomplete or require an exemption. Supplying an executable binding
still requires its complete declared shape; malformed supplied references and
contradictory meaning retain their own refusals.

A stored test-proof binding may be authored partially; execution completeness is
a separate requirement, and only a complete binding executes. A stored field the
current definition does not declare is refused by current validation. No
conversion helper or workbench offer rewrites a retired stored shape: such a
binding is authored again through the current operations.

`resolved-obligation-coverage.v1` retains the selected definition, authored-input,
canonical-source, system-capability and execution-evidence facts separately.
Its executable-map `status` is not the semantic `semantic_status` used for
authoring and admission. Missing executable selections, native bindings or
targets must not be promoted into absent requirement meaning. Likewise, counts
of resolved selections or executable route validity are not a semantic
completeness verdict. No selection or design assessment produces execution
credit.

Every obligation of the selected unit must be accounted for before its contract
is reported complete: its author either selected a proof whose exact definition
validates, or explicitly declined proof through a
[deliberate proof exception](#deliberate-exceptions). An
obligation with neither is unfinished authoring. It stays savable, reports
`obligation_coverage_proof_unselected`, is counted invalid and keeps the unit
incomplete; nothing selects a proof, infers an opt-out or borrows a parent's or
sibling's obligations for it. A selection whose exact definition does not
validate (an unpinned name, an integrity mismatch, a definition that cannot be
loaded) is likewise unaccounted and keeps that owner's own code. A validated
selection is accounted whether or not anything can run it and before any proof
has run or passed; an opt-out is accounted with no selected, resolved or
executable proof and no credit. This one verdict is computed with the saved
rows and read unchanged by assessment, the assessment a save returns, the
completeness summary and readiness. When the executable-map owner itself fails,
no selection was validated, so no selected obligation is reported complete; the
failure keeps its native cause beside the semantic facts already established,
and an explicit opt-out or an unmade decision keeps its own answer.
The resolved-selection mapping is a different, mechanical fact: it holds only
obligations with a resolved selection, so a unit containing an opt-out has
none. Consumers that need that mapping still require it and say so; acceptance
rebase, which reads no mapping, waits on accounting instead, and runtime
eligibility classifies an opt-out as declaring no runtime proof rather than as
an unresolved design.

The exact selected definition owns the prerequisites for executing that route.
A provider-bound test route executes through its native binding; unavailable
generic construction or dependency machinery does not become an instruction to
change the authored requirement. `workspace_verify_proof` reports missing
execution support with its originating cause. Semantic assessment, ready-slice,
dispatch and provisioning retain that distinction rather than using executable
support as an authoring or implementation-admission gate.

A test route's canonical-source parameters are read from its one linked native
binding, which is derived from the authored case. When the binding is missing
or ambiguous, or the case omits the field a value is derived from (`component`
for the referent, `target` for the selector), the missing value is reported as
an authored-input symptom. Its cause kind is
`derived_parameter_prerequisite_missing`, and its `authored_prerequisite` names
the prerequisite, its status, the binding field and the authored case field.
Recovery is the normal query-then-upsert with the returned content digest, and
it names the case link or case field to author. Callers never edit the derived
binding or supply the parameter. This diagnostic identifies an incomplete
selected executable declaration; it does not by itself make a complete semantic
verification plan inadmissible. Only routes that require a native binding receive
this attribution.
An unknown boundary reference, a native binding not derived from a case, an
explicitly supplied canonical source and a canonical conflict keep their
canonical-source or authored-input classification.

Missing required semantic meaning, invalid supplied identities and stale
currentness remain errors in their own right. An unresolved execution capability
prevents claiming that execution or proof satisfaction succeeded; it does not
prevent authoring or implementation admission.

The declaration dimension accounts for every canonical `test_proofs` binding,
including its proof and verification claim identities, even when no admitted
obligation relationship exists. Its `declarations` count describes bindings;
`relationships` and `eligibility_population` describe the separate
obligation-to-verification applicability population, and `joined_rows`
describes their declaration join. Several distinctly identified obligations
may intentionally name one verification and one saved case. That is one
declaration with several relationship rows, not duplicate declarations or an
ambiguous mapping. Each row retains its obligation and verification identities;
a conflict authored on one relationship leaves valid siblings usable. Genuine
duplicate obligation identities, duplicate declarations, unresolved selectors,
and conflicting authored bindings retain their own diagnostics and complete
participant counts.
At execution, a relationship bound to a saved case runs the verification that
case's derived binding selects; the obligation's verification links are its
eligibility, not competing choices. Another verification of the same behavior
never joins that relationship, so a proof-subject request selects exactly the
obligations bound to that proof's case, and a population request retains each
case and its separate result; credit is never merged by behavior. Mandatory
behavior coverage and explicit relation checks apply to the authored links
before the selection narrows them. A case whose derived binding is missing
reports `verify_proof.test_proof_binding_missing.v1` and never adopts a linked
sibling. Relationship rows without a case keep every qualifying verification, so
two of them remain `verify_proof.qualifying_verification_ambiguous.v1`.
Authoring accepts the same distinction. An obligation may link several eligible
verifications while its case names one of them in `verification_id`; creating
that case, reusing it from another obligation that links the same verifications,
and adding a sibling link to an existing use all keep the saved selection, and
readback returns every link. Several eligible links with no selection are not
refused: the case is saved naming no verification, as an unresolved draft that
the assessment reports with its complete candidates. Refusals remain for a
selection that is not eligible for the obligation
(`obligation_coverage_case_selector_invalid`), a use whose verification links
exclude its shared case's selected verification
(`obligation_coverage_case_selector_ambiguous`,
`shared_case_verification_conflict`), and two cases explicitly claiming one
verification (`obligation_coverage_case_verification_conflict`).
Unresolved relationships do not contribute to `runtime_eligible`. Full identities
and owner diagnostics remain in the existing retained dimension projection and
its lossless retrieval, while readiness carries compact counts and source bindings.
These are design declarations and never execution or proof-success facts.

The evaluated snapshot binds the saved source, contract, record and pinned
definition/context identities. Readiness rechecks the resolved inputs after
classification and refuses changed inputs as `controlled_acceptance_source_not_current`
with `changed:false`. Integrity failures retain their originating owner code.
`workspace_validate_proof` derives authored semantic status before consulting
the independent executable-map and workbench owners. A system-owned failure in
either dependency is returned in `owner_failures` without erasing the authored
status, counts, or independent dispatch-assessment call.
The failed owner's result remains unavailable and explicitly system-owned; a
genuine authored semantic or source-currentness failure remains invalid and is
never promoted by that failure projection.
If the workbench owner fails, executable diagnostic groups already derived from
the authored assessment remain readable. A request that cannot be resolved
because semantic workbench detail is unavailable refuses as
`obligation_coverage_semantic_diagnostic_detail_unavailable`, attributes the
system owner, preserves its originating failure and the established authored
status, counts and source identities, and offers a fresh validation call.
Ordinary unknown-group refusals retain their existing code.
The registered integration-only failure composition covers two distinct error
shapes at each independent boundary: an explicitly system-attributed owner
failure and an unmarked Node module-load or repository-read failure. The latter
uses the native `ERR_MODULE_NOT_FOUND` or `ENOENT` error without adding ownership
metadata. This is witness support, not a production selector: no MCP argument,
environment variable, PATH entry, or CLI flag can activate it. An unknown
canonical semantic reference is a separate negative control and must remain an
invalid semantic answer rather than being reclassified as an independent-owner
failure.
Production attribution comes from the independent operation invocation that
failed, not from optional ownership metadata on its exception. The projection
retains the original cause code and details while naming that operation's fixed
owner. Stable canonical-source/currentness and proof-posture refusals are not
independent-owner failures and continue through the refusal boundary unchanged.
The package dynamic-import boundary is inside the same independent-owner guard.
A managed subprocess lets the production operation execute its default dynamic
import while a fixed test loader rejects that exact package specifier with native
`ERR_MODULE_NOT_FOUND`; the established semantic answer and original cause
survive. This covers the default import expression without uninstalling or
rewriting the installed package. The test loader is not selectable through an
MCP argument, product environment variable, `PATH` entry or product CLI flag.
Current author-input recovery starts with `workspace_validate_proof({unit})`; it
does not require a prepare-design or test-proof-query traversal. The incumbent
semantic admission rule remains unchanged: missing real semantic completeness
facts keep readiness incomplete. System-capability recovery instead names each
concrete unavailable operation, why the selected route requires it, affected obligations,
the responsible owner, and either its supported recovery or an explicit statement
that none is available. It does not imply that editing already-valid author input
can supply an owner capability.

## Canonical authored-case consumers

An authored case is stored once in the parent obligation source. Obligation rows,
including slice rows, retain its `case_id`. Consumers that require a native
test-proof shape use `resolveDerivedProofAuthoringContract` through the shared
proof-authoring context. The persisted controlled contract is not a second case
definition. Draft coverage uses `validateNativeTestProofAuthoringContract`;
execution retains the strict stable-test-proof validator. The coverage fact
projection keeps every derived test definition and omits exactly the selector,
system-under-test boundary, boundary subjects, observable result or falsifiers
the draft omits. Consumers report those omissions against the declaration
without inventing meaning or treating missing execution mechanics as missing
semantic meaning. A genuinely incomplete semantic draft remains incomplete.
Runtime test-proof
binding resolution, used by terminal candidate validation and managed-worker
declared tests, follows the same rule against its exact execution root: when the
parent obligation source carries authored cases, it derives the native shape from
the authenticated generation carrier through that owner, rechecks the generation
and case source after derivation, and reports the derived contract digest. A
native carrier with no authored case is used as persisted.

Proof-plan request authoring, plan build and plan-currentness checks consume that
same derived contract view. The canonical carrier digest remains the storage and
continuation fence, while the derived digest and parent case-source identity bind
the compiler input. A prospective case settlement validates its prospective case
population and retired native binding together, before publication; it never
republishes the derived binding. Consequently a request and plan may be authored
before a case (the case change invalidates the old plan for an explicit rebuild),
or after a case (the request skeleton and plan compile from the derived view).
Native-only contracts retain the existing persisted-contract behavior.

The generation resolver includes exact parent/slice obligation-source bytes
alongside native descriptors, derives native bindings through the case owner,
validates the derived associations and rechecks source currentness. These
association sources belong to the complete generation population; they are not
members of the public native-carrier census. Read-only findings materialization
copies that complete population through the attachment-generation resolver,
which validates descriptor identity and bytes without the association
validation; its capture contract is owned by
[Conduit authority and review sources](agent-launch-conduit-authority-and-review-sources.md#review-checkout-capture).

Launcher persistence and exact-W authentication use the generation-specific
classifier for that complete population while retaining the native-only public
carrier classifier. Persistence writes the exact source and native bytes plus
the canonical work record to the private WK ref, verifies their reachable Git
blobs, and admits only an exact created, observed, or concurrent-winner receipt.
Manifest authentication compares manifest membership with only the native
descriptor subset and authenticates every complete-generation descriptor.

The synchronous lifecycle identity reader uses the same eight-field descriptor
shape and complete population. Consequently, a case-only source correction
changes the generation digest without relabeling the manifest digest. Bounded
lifecycle observations, integration lineage, findings materialization, managed
provisioning, and terminal candidate status all consume that identity through
their existing owners.

Explicit proof validation retains grouped diagnostic categories, selected-route
effects and selected details. Evaluated snapshots, readiness, ready-slice,
dispatch validation, launcher preflight, and managed provisioning carry the
originating category, code, cause, route rationale, responsible owner, affected
obligations, counts, and the existing source-bound detail call. Compact
projections remain actionable without reclassifying canonical-source or
system-capability failures as author input.

## No confidentiality or security posture

This protocol defines no confidentiality boundary and makes no claim that
repository facts are secret from agents. `server-resolved` means only that the
server owns canonical identity, currentness, and mutation integrity; it does not
authorize withholding context that an agent needs to perform the selected task.
Omission is justified only when information is irrelevant or duplicative for
that task. It is never justified as secrecy, least privilege, or minimum
disclosure.

The ergonomic objective is complete task-relevant context at the lowest total
workflow cost. Measure the whole workflow: useful semantic payload, repeated
envelope bytes, calls, continuations, retries, and final-state verification. A
smaller individual response is not an improvement when it creates avoidable
round trips or prevents the caller from making the required semantic decision.

Orchestrators MUST be able to use this protocol through tool discovery, input
contracts, targeted tool guidance and operation responses alone. These surfaces
must supply the task-relevant inputs, identity provenance, conditional field
rules and supported corrections. Documentation and FAQ access are optional
assistance, not prerequisites for usage or recovery. A source path identifying
an internal owner is not usage guidance. If a caller must inspect implementation
code, copy private fixture state or guess a derived identifier to make the next
correct call, the public interface is incomplete.

Authoring usability evidence must exercise that tools-only information boundary,
without documentation, FAQ access or agent-chassis source supplying missing inputs.
It must follow a refusal's advertised correction through a successful save and
readback, rather than stop after checking that a guidance link exists. Keep
runtime failures, intentionally incomplete drafts and invalid requests distinct
from avoidable failures on a valid authoring journey.

## Semantic proof authoring

Callers save requirement, applicability, obligation, proof-selection, and case
meaning through ordinary upsert. The server owns stable identities, compilation,
CAS, and atomic persistence. Query returns the canonical saved projection and
explicit validation reports problems. No population session, mapping-axis
response, or separate publication step is part of the public contract.

## Obligation-source authoring operations

Coordinators create and amend obligations through `save_record`. When a current
write revision is needed, use
`workspace_read_wiki({reads:[{subject:unit,for_changes:["obligations"]}]})`.
It returns `contexts[unit].revision` and fitting input-contract calls; read
missing grammar only. Known subjects accept contract selections directly in
the same `reads` array, including mixed selections. Save with that revision,
or one returned by a successful mutation, and the caller-chosen
`changes.obligations` under the served schema. The current
public authoring owner composes the internal controlled-contract settlement;
internal operation names and combined content digests are not public save inputs.
Selected reads use a known subject or an issued reference and contract selections.

An assigned population with no saved mapping returns
`population.recovery.actor:"coordinator"`, an exact context call for that unit,
and the missing choices: obligation statements, requirement claims and criterion
associations. These are caller decisions, never generated IDs. Recovery grants
no mutation authority to the receiving reviewer or worker. The coordinator
reuses held grammar and semantic selections, obtains missing inputs and a
current write revision, then saves the chosen meaning. A successful save may
finish; readback is needed only when the task needs saved meaning. An empty
mapping is not complete contract meaning.

A contract requirement replaces a stored requirement when it names it with
`replace_claim_id`. The same requirement may list `rebind_case_ids` to retain
existing authored cases through that one settlement; selection, live-link,
bound, and refusal rules are defined in
[Incremental authored cases](#incremental-authored-cases). Listing stored
requirement claims in `contract_requirements.retire_claim_ids` retires them
with no replacement and reconciles their dependent records in the same
settlement; see [Requirement retirement](#requirement-retirement).

Optional `statement` and `controlled_contract_node_ids` replace only their
corresponding authored fields. Empty node lists are savable. Optional
`mechanism: {owner, kind, selector}` replaces the whole object; null clears it.
Omission preserves the existing value. Public `changes.obligations[].criteria`
lists semantic selectors for the selected unit's saved criteria, for example
`{kind:"criterion",match:{text:"The component exists."}}`, or `$key` labels
for criteria created through `changes.criteria` in that same request.
The internal settlement's `acceptance_criteria` identities are resolved by the
save owner, not authored as public inputs. A supplied list replaces the saved associations, `[]`
clears them and omission preserves them, as
[Author-declared criterion coverage](#author-declared-criterion-coverage)
describes. No obligation member declines proof and no `controlled_acceptance`
value exempts a unit: a supplied `proof_opt_out`, or a disposition other than
`required`, is refused by the request schema and by the operation itself before
any effect. Both decisions are [deliberate exceptions](#deliberate-exceptions).
The former authored `gap` field and all
four former `gap_kind` values are retired. Supplying one is an explicit
request-schema refusal. A retained source containing one is invalid and reports
`obligation_coverage_authored_gap_retired` with its obligation identity and
original annotation; the source is never silently cleared or admitted.

Case-target schema diagnostics follow the authored structure. Presence of
`target.provider` selects provider-qualified diagnostics even when the provider
value is malformed: the provider must be an identity object, and its selector
must use that owner's shape. No provider string alias, version or family is
inferred. Node-test targets retain their own path and selector constraints.
An unresolved or mixed selector without a provider reports the target-form
choice; the save refusal's existing input-contract call supplies the complete
schema for correction. These diagnostic choices change no accepted request.

Malformed obligation rows, including null rows, reach the schema owner's
structured `obligation_coverage_schema_invalid` result; retired-field
inspection neither coerces them nor throws ahead of schema validation.

The upsert's registered guidance member `unresolved_coverage` describes the
normal recovery when authored verification meaning is genuinely missing or
contradictory: keep `controlled_acceptance: {disposition: "required"}` and
author the missing requirement, verifier, observation, failure condition, or
canonical link. Missing catalog support is selected-route readiness and is not
authored meaning. The guidance offers no exception: a missing definition, a
failed execution or unavailable tooling is never a reason for one.

### Execution capability is not an authored gap

There is no authored gap vocabulary. `catalog_gap`,
`implementation_not_delivered`, `review_only` and `no_proof_required` are
retired and rejected by the current contract. Authoring
and execution share only the saved canonical contract, and the membrane is
one-way: execution reads that contract, authoring never reads the execution
environment. An authored field that asked what is installed would go stale the
moment a provider is installed or removed, with no authoring act able to correct
it, and would let executability decide dispatch.

A proof whose selected route nothing can run today is therefore authored without
turning that incapacity into a gap. An executable case may be supplied when the
author intends to define one, but selecting an execution definition does not by
itself require a case for otherwise-complete semantic meaning. An omitted case is
an execution prerequisite; an explicit `case_id` whose definition is absent, or
a supplied case whose required fields or references are incomplete, remains a
genuine authored defect. `workspace_verify_proof` reports execution incapacity at
verify time with its own enumerated cause. A refused request shape, an unknown
provider identity or a provider version the catalog does not list is a request
defect to correct, not a gap.

### Source inspection is complete verification meaning

Source review uses the existing `inspection` verification method; it is not a
`review_only` gap and does not require a catalog proof, `runtime_test`, executable
case, provider or execution evidence. For example, a requirement may author this
complete verification meaning (the declarations use ordinary canonical
references in an actual request):

```json
{
  "nature": "behavior",
  "modality": "MUST",
  "subject": { "declare": { "type_term": "cc:operation", "identity": {
    "kind": "code_symbol", "repository": "app", "path": "src/pins.mjs",
    "symbol": "parsePin" } } },
  "behavior": { "relation": "reference:rejects", "objects": [
    { "referent": { "declare": { "type_term": "cc:configuration", "identity": {
      "kind": "repository_path", "repository": "app", "path": "fixtures/bad-pin.yml" } } }
  ] },
  "verification": {
    "method": "inspection",
    "verifier": { "declare": { "type_term": "cc:actor", "identity": {
      "kind": "code_symbol", "repository": "app", "path": "src/pins.mjs",
      "symbol": "sourceInspectionReviewer" } } },
    "observes": { "relation": "reference:covers", "objects": [
      { "referent": { "declare": { "type_term": "cc:operation", "identity": {
        "kind": "code_symbol", "repository": "app", "path": "src/pins.mjs",
        "symbol": "parsePin" } } }
    ] },
    "fails_when": { "relation": "reference:accepts", "objects": [
      { "referent": { "declare": { "type_term": "cc:configuration", "identity": {
        "kind": "repository_path", "repository": "app", "path": "fixtures/bad-pin.yml" } } }
    ] }
  }
}
```

Link an obligation to the returned verification claim without `proof_name` or a
case. Validation reports that authored meaning as valid and reports that there is
no selected route to assess. Supplying the retired `review_only` annotation is
refused; inspection meaning is authored through the verification method itself.
The absence of an executable route, case, binding, proof result, waiver, provider
or installed executor remains a nonblocking route observation. Mixed populations
may therefore contain route-free inspection and executable behavioral
obligations without converting inspection into an execution prerequisite.

### Deliberate exceptions

The host setting `AGENT_CHASSIS_PUBLISH_CONTROLLED_ACCEPTANCE_OPT_OUT=false`
omits whole-unit opt-out choices, schemas, meanings, templates and authoring or
recovery instructions from agent tooling. Unset or `true` retains publication.
An explicit request to read that hidden contract returns
`controlled_acceptance_opt_out_not_published` without its schema or recipe.
Generic exception discovery remains available for proof and grammar exceptions
under their existing tier rules. Saved-state reads and successful receipts still
report an already-recorded opt-out, its rationale and its consequence truthfully.
The generic exception read reports saved whole-unit facts separately when its
request contract is not published.

This switch is presentation configuration, not authorization or org policy.
Neither reading a contract nor publishing it is a save prerequisite; a valid
direct opt-out request has the same outcome in either mode. No rationale is
assessed, no record is rewritten and no native test, review or acceptance policy
is waived by the switch. Remembered requests and arbitrary repository files are
outside this publication filter. Configure the launcher host environment and
restart the session/server; see [environment reference](env-reference.md).
Registered package help references that expose the recipe are omitted in the
disabled mode, and the existing guide generator supplies a vignette without the
opt-out authoring branch. Historical documentation is not removed.

Ordinary authoring states no exception. The `changes` of `save_record`, the
`initial` of `workspace_create_record` and the obligation-coverage upsert carry
no member that declines a proof, leaves meaning unencoded or exempts a unit, and
general authoring guidance and assessment corrections never propose one. An
incomplete draft and unresolved meaning stay savable and are not exceptions.

An exception is one explicit request, `save_record({unit, revision,
exception})`, exclusive with `changes` and `maintenance_retry`. `exception` is
`{kind, action, subject}` with a `rationale` when `action` is `apply`;
`withdraw` takes none. It names one existing saved subject at the unit's current
revision, and settles through the same fenced, compensated save as any authored
change, under the same session role. The `save_record` declaration lists
`exception` as one generic entry; its kinds, complete schema and consequences
are read through the saved unit's reference with
`select: {input_contract: {tool: "save_record", operation: "exception"}}`,
optionally narrowed by `kind`. That read changes nothing and is never a
precondition: a correctly formed request is accepted without it, and no token or
approval is involved. Its request template leaves the rationale, and any subject
the caller must name, empty.

| `kind` | `subject` | Applying records | Consequence, stated on every surface |
| --- | --- | --- | --- |
| `proof` | a saved obligation id of the selected unit | `proof_opt_out: true` and `proof_opt_out_rationale` on that obligation | "Proof declined by the author. Tests may still be written and run. Their results do not automatically establish this verification or grant controlled proof credit." |
| `grammar` | the id (`u1`, `u2`, ...) of a saved unresolved meaning at the supplied revision | `grammar_exception.rationale` on that unresolved item | "Author-declared grammar exception recorded. This meaning remains unresolved and unenforced; the specification remains incomplete." |
| `controlled_acceptance` | the work item of the selected unit | the whole-unit exemption in the record's proof posture | "Controlled acceptance exempted by the author. The stated rationale has not been assessed for eligibility." |

The rationale is the author's own text, trimmed, nonempty and at most 8192
bytes. It is recorded as written. Nothing reads it, classifies it or decides
whether the exception is eligible; urgency, convenience, a failed test or proof,
missing executable support, unavailable tooling and a missing definition are not
themselves a justification. Discovery’s `applies_when` states intended eligibility
guidance, not an assessed conclusion. Generated consequences report the author’s
action and established effects, even when the attributed caller rationale itself
claims that grammar or proof support is unavailable.

A proof exception keeps the obligation's statement, claim links and criterion
associations exactly as saved, and the requirement and verification stay
applicable. It is refused with `obligation_coverage_proof_opt_out_conflict`,
changing nothing, while the obligation keeps a proof selection or a test case:
neither is removed for the caller. Withdrawing it leaves the obligation
undecided and selects no proof.

A grammar exception keeps the unresolved text and its reason word for word. No
row, identity or expression is made for it, it is never compiled coverage, and
the specification stays incomplete. An unresolved id belongs to its revision, so
a stale request is refused rather than reaching another item. Restating the
unresolved list keeps the exception on each meaning it restates word for word;
withdrawing keeps the text. It is recorded on saved controlled requirements and
is therefore served under the paid tier only.

The whole-unit exemption is a separate applicability decision and is neither of
the others; saved requirements, obligations and proofs are not deleted, and
withdrawing restores `required`. The rationale is checked for shape
and size and for nothing else: no operation reads it, classifies it, or
establishes that the exempted obligation really does not apply. Every surface
that presents the exemption therefore carries the same provenance
(`controlled-acceptance-opt-out-provenance.v1`: `rationale: "caller_authored"`,
`rationale_assessment: "not_performed"`, `assessed_by: null`) — the upsert
operation's receipt, the obligation-coverage query's contract-input summary, the design
workbench (whose exempted rows report
`controlled_acceptance_opted_out_authored_unassessed`), the
controlled-acceptance projection's
`disposition.rationale_provenance: "caller_authored_unassessed"`, and the
compact `workspace_validate_dispatch` readiness. `mechanically_complete` for an
opt-out follows that recorded disposition and nothing else, so an exempted
dimension is never a catalog-certified claim of inapplicability or evidence that
a proof succeeded. Real missing proof on an authored required obligation remains
mechanical incompleteness.

A save that applies or withdraws an exception returns `exception`: the kind,
action and subject, the affected saved meaning, the rationale as written with
`rationale_assessment: "not_performed"`, and the consequence. A receipt too
large for one frame still states the kind, action, subject and consequence.

Assessment reports exceptions as `assessment.exceptions`, apart from unfinished
drafting. `proof` counts `selected`, `declined` and `undecided` obligations and,
for declined ones, repeats verification's facts (`accounting: "opted_out"`,
`proofs_executed: 0`, `credit_granted: 0`) with each declined obligation and its
rationale; credit established by a selected proof is unaffected.
`grammar` counts `unresolved_meanings` and `exceptions`, marks the excepted
meanings `NOT ENFORCED` and reports `specification: "incomplete"` whenever any
meaning is unresolved. `controlled_acceptance` reports the disposition and, when
exempted, the rationale and its unassessed provenance. An exception saved
without a rationale reports `rationale_state: "not_recorded"`; none is supplied
for it. Every count is exact. A delivered summary lists at most eight subjects
per list and cuts long text, marking `truncated_members`, counting omissions and
setting `complete: false`; when nothing is cut it equals the retained
assessment, which always lists every subject whole.

No other surface records or suggests an exception. The design workbench's
proof-posture row offers one response form,
`declare_controlled_acceptance_applies`; its owner refuses any other answer with
`controlled_contract_authoring_continuation_invalid` before any write and names
the exception request instead of treating the answer as an exemption. The
routing vocabulary carries no opt-out, exemption or exception phrase: its
controlled-contract authoring intent states that an exception is the separate
`save_record({unit, revision, exception})` request and names the reader
selection that returns its contract.

`proof_name` selects an exact proof catalog entry; it is not an authored title
or case ID. Find catalog names with `workspace_find_proofs`.
Omitting `proof_name` keeps a new obligation an unselected draft and preserves
an existing obligation's selection. Initial selection or a changed name pins
its current admitted version, profile digest, parameter-contract digest, and
admission digest. Repeating a bound name preserves the pin, including a
previously admitted exact version. Explicit `refresh_proof_version: true`
rebinds the saved name to its current version.
The public root-WK operation
`save_record({unit: "WK-…", revision: <fresh root revision>, changes: {refresh_proofs: true}})`
instead preserves each selected name and version while refreshing only stale
reference metadata throughout the root and every current slice. This change is
exclusive and unavailable on slices, initiatives, decisions or birth requests.
All sources form one prospective candidate before whole-closure validation and
one settlement; there is no sequence of independent saves. Absent sources,
unselected/unpinned drafts, opt-outs and current rows remain unchanged. Exact
definitions must be available through the existing admitted-meaning loader;
refresh never upgrades an unavailable selected version or rewrites parameters,
requirements, cases or criterion associations to make it compatible.
Any retired selection refuses the whole refresh with
`proof_pack_exact_version_not_current`; all participants remain unchanged.
Failure identifies affected units and obligations. Refresh-specific recovery
offers diagnosis and identifies missing cross-unit authored correction with its
proof-authoring/save_record owners; a per-unit save against stale siblings is
not a repair. Ordinary saves do not refresh implicitly, and targeted
`proof.refresh` retains its current-version selection semantics.
A supplied name that is not a catalog entry refuses the whole amendment with
`obligation_coverage_proof_name_unknown` before effects, including every other
obligation and contract input in the request. The refusal names the field and
value and returns the no-argument discovery call as its next call. A known name
whose catalog or definition cannot load refuses with that failure's own code;
unavailable or corrupt exact definitions never save an unpinned selection or
silently select another version. A saved obligation that selects no proof and
carries no `proof_opt_out` is reported as
`obligation_coverage_proof_unselected`, and a saved selection
without a pin as `obligation_coverage_proof_unpinned`. Both keep `field:
"proof_name"` for the saved carrier and add one owner fact, `discovery_input`:
the one `workspace_find_proofs` input that applies. An unselected row states
`query`: the property to establish is the caller's own, so no query is supplied
and no call is composed. An unpinned row states `proof_name`, the saved name
that discovery reads back. The fact is one short scalar because every affected
obligation repeats it inside a bounded answer.
Discovery lists candidates and selects none. The caller chooses the proof and
saves it as `changes.obligations[].proof.name` through `save_record` at the
revision the current `workspace_read_wiki` unit context returns; an unpinned
selection may instead be removed through `changes.remove.obligations`.

`parameters` is a map of named replacements. Omitted names and an empty map
preserve saved values. A supplied object or list replaces that one value as a
whole. `clear_parameters` removes only the named explicit values; set/clear
overlap refuses atomically. Null inside parameters is inert authored JSON data,
not clearing. Changing the proof preserves unspecified parameters. Known
contradictions with the selected exact definition refuse before effects; clear
incompatible explicit parameters and amend the native case in the same batch.

A normal save or removal receipt is exactly
`{unit, saved, unchanged, content_digest}`. Counts describe requested mutation
participants, including supplied contract inputs.
Remove requires `removal_scope`; omission is malformed under the current-contract-only
policy. `selection` clears the case use and entire selection, its pins and parameters,
while preserving obligation meaning, node links, mechanism, gap, siblings and history.
The retained row can be selected again through ordinary upsert. An already-unselected
obligation without a case use yields a CAS-checked no-op.

`obligation` deletes the complete selected row, including its selection and case-use
reference. It does not delete contract requirements, shared case definitions, other
parent or slice uses, verification/review history, or any other obligation. The saved
population and explicit validation therefore report any coverage gap created by the
deletion; deletion is not proof success, execution credit, or dispatch authority.
An unknown obligation refuses before effects. Repeating a successful `obligation`
removal consequently returns `obligation_coverage_obligation_not_found`, while repeating
`selection` removal is the CAS-checked no-op above. Any retained-reference or prospective
source conflict is a pre-effect refusal that names the exact references to correct; stale
combined revisions likewise leave every persistence participant unchanged.

Query resolves ONE selected population at one combined revision and returns it
as one flat result: `requirements`, deduplicated `references`, `obligations`, the
parent-owned `cases` those obligations use, and every global `notes` and `residue`
entry, beside `content_digest`, `source_identity`, `contract_content_digest`,
`meaning_identity`, `controlled_acceptance` and `population`. Each requirement's
`meaning.verifications` lists every linked verification, ordered by `claim_id`, with
its `method`, `verifier`, `observes`, `fails_when` and, where the canonical contract
declares one, `runtime_test`; `verification_claim_ids` is the exact relationship
index and always agrees with it. A verification owned by an authored case carries
its runtime meaning on that case. There is no singular `meaning.verification`.
Requirement meanings retain stable `select` identities and each needed reference is
defined once, so the result resolves subjects, applicability contexts, behavior
operands, verifiers, observations, failure conditions and runtime boundary subjects
by itself. A returned case whose `component` selects a saved reference by
`reference_id` resolves by itself too: that reference is defined in the same
`references` population, once, even when no returned requirement uses it, in
every population mode; a selected read adds no other reference, and
`population.returned.references` counts the population actually returned. A
`verifies` relation whose verification claim is absent, a missing definition
(a case component's names `cases[<case_id>].component`) or an inconsistent
duplicate identity fails with an exact projection diagnostic instead of an
omission.

`obligation_id` reads one known obligation directly; no inventory is needed first.
It keeps only requirements whose node closure intersects that obligation and its
case, each with ALL of its verification meaning, and only the case that obligation
uses; the case's `verification_id` is the exact association, not a choice of which
verification to show. Global notes and residue have no applicability mapping, so
every selection retains all of them once. `population` states the mode (`all`,
`obligation`, `assigned`, `assigned_obligation`), the returned counts and, outside
an assignment, the addressed unit's source counts. `parameter_detail: true` adds each
returned obligation's exact saved-pin parameter contract with
`parameter_detail.status: "current"`, or reports `unselected`, `unpinned` or `stale`
with the owner's reason code and the pin exactly as saved; a read never refreshes or
substitutes a pin. Absent source and unknown obligation remain distinct; an unknown
obligation names the inventory call.

`inventory: true` is the unknown-identity view of the same owner and revision: one
row per obligation with its complete `statement`, `proof_name`, `case_id` and
`explicit_gap`, a `contract_inputs_summary` of counts instead of requirement and
reference bodies, and an `obligation_detail_read` declaration naming the direct
`obligation_id` read and the complete view. Nothing is previewed or clipped.
`inventory` is refused with `obligation_id`, `parameter_detail` or `view: "complete"`
(`obligation_coverage_request_invalid`).

Delivery goes through the selected-response owner
([Selected-Response Details](mcp-selected-response-details.md)); the query has no
cursor, and a `cursor` argument is refused as an unrecognized key. A result whose
admission bytes — its larger representation, as
[MCP Integration](mcp-integration.md) defines — fit min(8,192 bytes, the active
inline limit) is returned
whole with `selected_detail.complete: true`. Otherwise the result is retained once:
the default `view: "compact"` answers with the identity, disposition, authorized
population counts, collection counts and the `next_calls` entry that starts complete
retrieval, and `view: "complete"` answers with that retrieval's first page. A compact
answer to `obligation_id` with `parameter_detail: true` keeps that intent: before any
optional member it carries `parameter_selection` -- the obligation's exact
`parameter_detail` pin fact plus, at the largest size that fits, the whole
`parameter_contract`, every parameter slot whole, or each slot's resolved
`refinements` (role, allowed type terms, identity kinds, cardinality) with the pin's
profile identity, or the pin fact alone. Every `complete: false` size lists each
parameter-contract field it leaves out in `not_inline` (`parameters.<n>` for a slot,
then each remaining contract member), and its one recommended `next_calls` entry is
an exact `detail` read of the first of them on that obligation's retained row. Each
such read names the next field in that list, so following only emitted calls
delivers exactly the `not_inline` fields; the complete-retrieval call follows,
unrecommended. An unselected, unpinned or stale pin is the inline fact with
`parameter_contract: null` and no recommended read (or, when that fact is too large,
its status and reason code with `not_inline: ["parameter_detail"]` and the read of
it); a mechanical loader failure refuses as before. Measured on a pinned
test-validity obligation beside six unrelated requirements and large global notes,
UTF-8 request plus CallToolResult bytes: the first response (7,795 bytes, one call)
carries every slot's resolved refinements, including the component refinement; the
whole parameter contract, reassembled from that response and the six emitted field
reads (two slots and four contract members), costs 48,286 bytes over seven calls.
A compact or inventory answer from the internal coverage-query owner for a unit
with criteria then carries, before any
optional member, `criterion_identities`: an object whose keys are the owner's
zero-based criterion `position` as a decimal string and whose values are the
`identity` an obligation names, projected from `acceptance_criteria` without text
or `text_sha256`. A position is the zero-based index of the criterion in the
selected unit's `acceptance.criteria` array, in stored order at the answer's
revision, so a caller that already holds that ordered list uses the mapped
identity without reading criterion text again; a caller that does not reads the
criterion meaning through the existing detail route. A position only locates a
known criterion: the caller still declares which obligation covers it, and a later
edit or reorder of the criteria makes earlier positions historical. It is whole or absent: when it does not fit beside the required
members and any `parameter_selection`, `selected_detail.omitted_members` names
`criterion_identities` and the rows stay in the `acceptance_criteria` collection,
whose count is `selected_detail.collections.acceptance_criteria`. A whole result
carries those rows and no map. Measured with nine long multibyte criteria, UTF-8
request plus CallToolResult bytes, the first response carries all nine identities
in one call: 5,421 bytes compact and 6,744 bytes inventory for the parent, 5,487
and 6,870 bytes for a slice with longer criterion prose. These internal query
bindings are not public `save_record` selectors: public criterion associations
use `changes.obligations[].criteria` with semantic selectors or request-local
labels, as described in [Author-declared criterion coverage](#author-declared-criterion-coverage).
After `criterion_identities` and before any optional member, a compact or inventory
answer carries `case_links`: an object keyed by each selected obligation's exact
`obligation_id` whose value is that obligation's exact saved `case_id`, or `null`
for an obligation without a case. It is projected from the selected obligations
only, so a slice or assignment maps only its own obligations and an empty slice has
no map; case definitions, verifications and targets stay in the `cases` collection.
This is the first route for reusing saved cases: no `view: "complete"` read is
needed for the identities. The map is whole or absent. When it does not fit,
`selected_detail.omitted_members` names `case_links` and the recommended
`next_calls` entry, after any parameter read, reads the `obligations` collection of
the same retained snapshot, whose rows carry `obligation_id` and `case_id`; the
complete-retrieval call follows it unrecommended, never duplicated. That read is
positional: `detail.selector.id` is a row position, while a fresh query with
`obligation_id` selects one obligation. A whole result carries the obligation rows
and no map. Measured with five long-prose obligations, four distinct
45-character saved case identities and one no-case inspection obligation, UTF-8
request plus CallToolResult bytes, the first response carries all five links in
one call: 6,095 bytes compact and 7,418 bytes inventory for the parent, and 6,191
bytes compact for the slice that reuses them.
`detail`
reads one bounded page of the retained result, takes only `unit` and `repo`, and is
refused beside any live selector. A page names its continuation and, when a
collection ends, the next non-empty collection (members, requirements, references,
obligations, cases, notes, residue), so following `next_calls` retrieves the whole
population once instead of an inventory plus one read per obligation. A row or value
too large for one frame is advertised as a field inventory with a `descend` call
template; a large scalar is delivered in exact UTF-8 byte ranges.

The session role is launcher startup state and never a request field. Orchestrator,
operator and an unmanaged session read the named canonical repository. Reviewer and
redteam read only the launcher's immutable review materialization
(`WIKI_MCP_REVIEW_MATERIALIZATION_DIR`), authenticated by the one findings-source
resolver that ordinary frozen reads also use: the session contract's
`advisory_review_source` binding must commit to this host's role, assigned unit,
advisory run, canonical repository and materialization root, and the root must still
be a directory. No frozen review artifact or worker run record is consulted, and the
agent supplies no run, path or role argument and makes no authentication call. They
keep repository-read entitlement, so any WK in that materialization is readable. A
source that does not authenticate is `obligation_coverage_query_source_unavailable`
whose `failed_condition` names the deciding cause — `launcher_session_unauthenticated`,
`advisory_review_source_binding_absent`, `advisory_review_source_binding_duplicated`,
`advisory_review_source_binding_mismatch`, `advisory_review_repository_unavailable`,
`review_materialization_unavailable` or `review_materialization_unreadable` — with the
subject it concerns and a `no_supported_route` recovery, since no call a findings
session can make repairs its launcher-bound source; it is never a live-main read. A
managed worker reads the controlled contract of its
assigned unit: the exact-slice binding the identity store holds for its run selects
the worktree, and the `assigned` population is that unit's obligations with exactly
their requirement, verification, reference and parent-owned case closure plus all
global notes and residue. A different WK, slice or focus is
`obligation_coverage_query_assignment_scope` with the one supported call; an
assignment with no saved obligations reports `assignment_mapping: "absent"` with
coordinator recovery rather than falling back to the whole parent. Counts in an
assignment describe only what it returns. This query is the worker's
authority-scoped route to contract meaning; raw `wiki/contracts` files stay
excluded. The worker's content-reference reader is a separate transport grant
whose boundary is owned by
[MCP Repository Model](mcp-repository-model.md#oversized-mcp-response-references);
it grants no page, record, entry, search or path read.

Current contract assessment composes the same resolver in process.
`assessCurrentContract` (`packages/wiki-mcp/src/lib/task-assess-contract.mjs`) takes
the trusted configured workspace and launcher session environment apart from a
closed selection of `unit`, optional `focus` and optional `obligation_id`; any other
selection key is refused, and the unit uses the shared saved-source unit grammar. It
resolves the source as the assessment consumer and passes only the authenticated
source root and the parsed selection to saved proof validation's internal capture
(`captureProofAssessmentOperation`), which owns the revision, source absence and
opt-out, whole-unit versus selected-obligation assessment, criterion coverage and
independent owner failures. Orchestrator and
operator assess the canonical repository; reviewer and redteam assess their
authenticated frozen materialization, and a source that does not authenticate keeps
the refusal above and is never answered from live main. Assessment excludes the
assigned-worker population before any worker binding is read: a worker session is
`contract_assessment_worker_excluded` with `failed_condition`
`assessment_excludes_worker_population` and an orchestrator-or-operator recovery,
because relaunching a worker cannot grant assessment; the query's assigned-worker
read is unchanged. The result is
`{repository, unit, focus, selection, source_authority, assessment, diagnosis_inventory}`:
`selection` is `whole_unit` or `selected_obligation` with `whole_unit_assessed`,
`source_authority` carries the resolved `role`, `source_kind` and `population_kind`,
and `assessment` is the validation projection unchanged, so a selected obligation
states no whole-unit validity or coverage. The user-requirements comparison follows
the trusted orchestrator role. This composition is not registered, published,
retained or delivered as an MCP response, and it grants no tool access.

`diagnosis_inventory` is private. The capture shares one computation with
`workspace_validate_proof` — the saved source is resolved and bound once, assessed once
and the workbench inspected once — and keeps every diagnosis those owners produced for
the population, in issue priority order, including nonblocking authoring groups and
inspection-only semantic groups the compact issue index omits. Each entry is the
selected-diagnosis projection (identity, meaning, recovery, every subject, addressed
`correction_call`) with its owner `family` (`authoring` or `semantic`) and the owner's
`correction_route`; the inventory states its `unit`, `focus`, `content_digest` and
`source`, its `population` (`whole_unit` with every saved `obligation_id`, or
`selected_obligation` with that one and only its subjects), and the `corrections`
definitions its subjects reference. `families` states each owner's availability:
`complete`, or after an independent owner failure `incomplete` (executable map: the
diagnoses the semantic assessment still established are kept) or `unavailable`
(workbench), each with that owner's native failure; `complete` is true only when no
family failed and describes capture of owner meaning, not proof or readiness.
A source-absent unit keeps applicability/source findings as unselectable findings;
no diagnosis id is invented for them. Definition or unfinished-meaning diagnoses
can coexist with those findings; otherwise no group is selectable.
Public validation answers are unchanged and carry no
inventory. Assessment task projections use the bounded shared response owner
described below.

`createContractAssessmentResults`
(`packages/wiki-mcp/src/lib/task-assess-contract-results.mjs`) retains that carrier
privately. `current(selection)` computes one assessment and then retains the exact
carrier, inventory included, with the source context that computed it, as one
`selected-response-source.v1` envelope under the producer route `workspace_assess_contract`, bound to the
repository, unit, original selection and population, original revision and the
authenticated authority. These private bytes are stored with the
operator-only access marker, so the generic content-reference reader refuses them and
names no owner call. The assessment handler authenticates its own original reads. If retention
fails after assessment, the carrier is returned unchanged with no locator and the
native retention cause; the assessment is not relabelled, recomputed or retried.
`original({source})` takes the `{ref_id}` locator; `unit` is optional. It
authenticates the session, reads the retained envelope once checking the stored
producer and configured repository, and treats the retained unit as data until the
full authority resolved from this session for that unit equals the retained one. Only
then is a supplied `unit` compared as a binding assertion, the carrier's unit and
repository checked against the binding, and the stored carrier returned unchanged, so a
selected-obligation original keeps its own scope and corrections and is never
broadened. Each mismatch is the selected-response owner's `source_binding_mismatch`
naming its field. The authority
binds role, repository, unit, source kind and a findings session's advisory run and
frozen-source binding, and no revision: source movement does not revoke an original,
while another role, run or frozen source is refused before any carrier is returned.
A missing, corrupt, non-selected or wrongly bound source keeps the selected-response
owner's refusal, and no failed read is answered by a fresh assessment. The read
reports `source_revision_currentness` as `current`, `changed` or `unavailable` with
the observation owner's cause — an unreadable current source does not withhold an
authentic original — and `assessment_context_currentness` as `not_observed`: it
invokes no assessor, workbench or provider and infers no capability currentness.
Retention follows the response store's existing bounds; nothing here promises
permanence.
The results owner's `deliverCurrent(selection, project)` and
`deliverOriginal(request, project)` reuse those same capture/authentication paths
for the surface's trusted projection; a request supplies neither a projector nor
an expected binding.

`original` also accepts a nonempty ordered `diagnoses` array of
`{diagnosis_id, obligation_id?}`; each supplied selector is a nonempty string,
`null` is not omission, and any other key — `repo`
included, on `current` as on `original` — is refused: the repository is the trusted
workspace configuration. Membership is inspected only after the session and source
authenticate, and solely in the saved inventory. `diagnosis_id` selects exactly one
diagnosis of a whole-unit or selected-obligation original by its saved
`diagnostic_group_id`; each successful selection in `selected_diagnoses` holds the saved diagnosis
and the saved correction definitions its subjects reference — beside the unchanged
carrier, provenance and currentness. With `obligation_id` the diagnosis is restricted
to every saved subject of that obligation, with the definitions those subjects use and
the saved correction route addressed at the original unit, focus and revision. Nothing
is assessed, fetched from the current source or repaired, and the stored carrier is
never altered. The obligation must belong to the original population
(`obligation_outside_original_population`; a selected-obligation original is never
broadened) and be a subject of that diagnosis (`obligation_not_a_diagnosis_subject`,
which a diagnosis naming no obligation always is), both
`obligation_coverage_obligation_not_found`. The remaining refusals are
`obligation_coverage_diagnostic_group_not_found` with a `failed_condition`:
`diagnosis_unknown_in_complete_inventory`; `retained_diagnosis_inventory_incomplete`
with the `unavailable_families` and their native failures, when an owner failed at
capture and the requested diagnosis was not observed — never reported as unknown;
`original_has_no_selectable_diagnoses` for a source-absent original;
`retained_diagnosis_inventory_malformed`, `retained_diagnosis_malformed`,
`retained_diagnosis_identity_ambiguous` and `retained_correction_definition_missing`
for retained bytes that do not hold the inventory. Each selection failure is returned
in its ordered entry's `failure`, preserving code, cause, subject and recovery;
it does not discard independently available selections. Authentication and source
failures refuse the whole request before membership is inspected. No obsolete retained format is read
or migrated.

### Public contract assessment responses

`workspace_assess_contract` is registered by the agent-task composition for
orchestrator, operator, reviewer and redteam sessions. Source resolution and
validation retain the authority described above. Workers cannot assess; findings
sessions use their authenticated frozen source. No response grants permission to
write, start an action, execute a proof or claim credit.

The closed request is `{unit?, focus?, obligation_id?, original?}`, where
`original` is `{source, diagnoses?:[{diagnosis_id, obligation_id?}, ...], view?:"diagnoses"}`.
A fresh request requires `unit`. An original read authenticates the supplied
source before inspecting diagnosis membership and runs no assessment.
`diagnoses` selects exactly the listed retained diagnoses, in requested order;
each optional `obligation_id` restricts only its own entry. A singleton uses the
same array. `view:"diagnoses"` selects the complete choice inventory and is
exclusive with `diagnoses`. Top-level selectors alongside an original must restate
the captured scope or a restriction shared by every selected entry. Neither
restatement changes the original assessed scope used by reassessment.
Conflicting selectors return separate original-only and fresh requests; neither
is chosen or run. A slice is addressed in `unit`, never `focus`. The existing
initiative-only lookup and slice-as-focus correction preserve caller selectors
and never claim to have selected a work record or verified slice existence.

`task-assess-contract-response.mjs` owns the public answer. A complete scoped
assessment can finish with the unit, necessary authored/specification verdicts
and an empty `next_calls`. Complete or inapplicable criterion checks add no field. It exposes no successful-check counts, compiler
inventory, source digests, authority identity or retention bookkeeping.
Missing whole-unit criterion coverage is a separate qualification; a selected
obligation establishes no whole-unit assessment. A saved exemption retains its
unassessed rationale and consequence rather than becoming proof credit.
Every captured user-requirement passage needs explicit obligation coverage,
explicitly classified contextual meaning or source-bound residue; unaccounted requirements prevent
`specification:"complete"` even when the selected definitions are complete.
Accounting covers the captured parent and its slices, while reassessment retains
the original unit, focus and obligation selection. Full declaration coverage
requires its complete assertion set across explicit obligation links; grouped
subsets and verification-only associations retain their exact meaning.
Each source-linked behavioral declaration needs those associations independently
of source-passage coverage. A different declaration or residue covering the same
passage cannot hide a missing association or make specification complete. If
unavailable associations could supply that membership, it remains unassessed
rather than being diagnosed as an established omission.
Unresolved association evidence remains unavailable. This qualification changes
no readiness, execution or publication gate and grants no proof credit.
When context or residue contributes, `assessment.requirement_accounting` supplies its owning
`unit`, accounting `status`, `obligation_coverage:"full"|"partial"|"none"|"unavailable"|"unknown"`
and the applicable `context_accounted:true` or `unmet_residue:true` qualifications.
Context is counted separately, never as obligation coverage or unmet residue.
Complete accounting with residue still leaves the
specification incomplete. Its saved text, reason and current/stale source
passages remain available through selected diagnoses and semantic reads;
unbound residue accounts for nothing. A full successful accounting check adds no
successful-check inventory. Neither outcome establishes faithful interpretation,
implementation success, satisfaction of residue or proof credit.
When the captured assessment carries the user-request-comparison qualification,
every public view retains `scope_limit`: authored validity and specification
completeness do not establish faithful coverage of the user's request. No
additional read, approval or automated prose comparison is implied. Absent or
empty recorded user requirements retain the owner's coverage-unestablished limit.
The same compact fidelity limit accompanies an established complete accounting
fact or complete specification with unknown source accounting, including when an
independent authored defect remains. Unknown accounting is not reported as empty
or complete coverage.

Public validity distinguishes a demonstrated authored defect (`invalid`) from
validity the validator could not establish (`unavailable`). Independent
`unassessed` causes identify the failed owner and specific cause. When a defect
and an owner failure coexist, both remain visible, including in selected detail.
The internal validator classification and all enforcement stay unchanged;
unavailable validity never means valid or permission to proceed.

Diagnosis choices in `next_calls` carry the native code or reason codes, cause,
affected subjects and correction unit. Parent-owned meaning remains distinct
from a slice's obligations. A complete choice set wider than the compact class
uses one returned `purpose:"diagnostic_inventory"` request with
`original.view:"diagnoses"`. Compaction retains independent `gaps`, unavailable
owner causes and historical-source qualifications immediately; only the wide
diagnosis menu moves to that read. Unfinished-meaning choices include their
authored text, reason and semantic fragment selector so the caller can distinguish
the intended behavior before opening a
dossier. Its complete selected answer needs no pagination,
decoding, integrity checks or filesystem rescue. Size never substitutes
obligation narrowing for complete selected meaning. An explicit obligation
restriction is the caller's choice and preserves the original captured scope.
Inventory choices share equal complete subject facts through local
`subject_definitions` references while retaining every affected obligation.
Requirements repeated across choices live once in `requirement_definitions`;
each requirement reference's `definition_id` selects that response-local fact.
These keys address no authored row: the shared facts retain the real semantic
selections. Different causes, applicability, uses and selections remain distinct.

An exact returned diagnosis call selects `selected_diagnoses`, an ordered array.
`requirement_obligation_association_missing` distinguishes a source-linked
declaration from explicit obligation coverage. Its subjects retain the reusable
requirement `target` and full declaration in detail. When assertions exist, the
selected answer states the missing caller choices and offers
`purpose:"choose_obligation_owner"` bulk reads for the captured parent/slices,
each with its title, public unit, obligation population and `for_changes:["obligations"]`.
Repeated titles also offer `purpose:"distinguish_obligation_owners"` through the
existing slice inventory; its authored targets and assignment headings distinguish
available choices without opening every obligation population. An explicitly
ambiguous inventory member does not establish the caller's intended owner.
Choose the intended owner, then an existing obligation or a new authored statement
using the returned current revision and grammar. Preserve its existing `claims`,
grouped subsets, explicit checks and cases while adding the intended coverage.
No save or owner is invented. The selected recovery's conditional `after_save`
keeps the original assessment scope. A missing receiving reader leaves a precise
stop. An incomplete declaration with no assertions needs authored meaning first;
a complete declaration with no supported obligation-association selection instead stops
with `obligation_association_unavailable`. Closed membership currently has this
representation limit; changing its meaning or automatically recording residue
is not an established correction.

An authored `definition:true` row is non-normative and requires no behavioral
obligation. Its provenance alone classifies nothing. Only an explicit saved
`source_role:"context"`, complete definition and current valid source binding
contribute contextual accounting. Neither classification nor source accounting
establishes faithful interpretation, implementation assurance or proof credit;
the compact `scope_limit` retains that distinction across public views.

`definition_source_classification_missing` retains the exact affected passage,
semantic target and declaration and asks for the caller's classification. If it
is context, follow the returned current parent context and save grammar, then
restate the preserved definition with `source_role:"context"` and the chosen exact
`user_requirement`/occurrence. If it is requested behavior, preserve the definition
and author the actual behavioral declaration and associations. Nothing is inferred
or converted into unmet residue. `definition_context_source_stale` retains the
saved role and stale passage; its bulk correction read also supplies the current
parent prose. Choose any rebinding explicitly. Source movement grants no new
credit; clearing the role removes only contextual accounting. Missing/ambiguous
targets, findings authority, focused-contract limits and unavailable receiving
contracts retain their precise stopping points. A successful save may finish;
the optional reassessment retains the original scope.

The caller can combine explicitly chosen calls from the same `original.source`
by concatenating their `original.diagnoses` arrays; sources cannot be combined.
Each entry repeats its `diagnosis_id` and optional `obligation_id`, and contains its
meaning and affected subjects, relevant authored correction inputs or the
precise stopping condition, or an individual `failure` with the selection refusal.
A successful entry is `{diagnosis_id, obligation_id?, diagnosis, recovery,
save_guidance?}`. `diagnosis` holds its `meaning`, `subjects`, `family`, applicable
`code`/`reason_codes`, and any category, gap class or shared subject definitions.
A failed entry is `{diagnosis_id, obligation_id?, failure}`: `failure` preserves
`code`, `cause`, `subject` and the applicable `failed_condition`, unavailable-owner
causes or precise `stop`. Per-selection failure is data in that entry; it does not
set a whole-request error or suppress other entries. Missing or altered selections
never become empty diagnoses or trigger reassessment.
Compatible current-correction calls occur once in top-level `next_calls`; for the same
unit their `for_changes` members are the union needed by successful selected
corrections. Each successful entry's `save_guidance` contains only `unit` and its
correction-specific `instruction`. `correction_contexts[unit]` supplies
`revision_from`, `changes_schema_from` and conditional original-scope `after_save`
once for that unit. Separate owning units retain separate contexts. Refresh-only
guidance retains its own call and sole-change constraint. Nothing in
this retained read executes, saves, changes the selected source or obtains a
current replacement for historical facts.
Equal definition facts are shared through
`subject_definitions`; their associations stay with the affected obligations.
Native validator check inventories, intermediate failed paths, source-generation
metadata and duplicate coverage recipes are not detail content. A retained
authoring diagnosis without its captured public-subject projection stops with
`assessment_authored_selection_unavailable`; current storage and native identities
cannot substitute for that missing historical meaning.

When the case owner establishes that a component supplies no runtime module
location, `component_requirement` retains its authored field, required identity
kind and fields, and the reason a descriptive identity is unsuitable. Its
`current` fact distinguishes a supplied value from absent input or unavailable
component evidence, resolved against the same captured source. A supplied
`profile_term` is not described as an omitted component. The caller supplies the
actual repository and path; assessment chooses no replacement location, edits
no identity and publishes no derived binding or validator paths.

Definition subjects carry whole authored declarations and semantic `target`
selectors from the common public-selection resolver, together with the required
typed meanings and exact authored use paths. Population membership alone does
not establish a usable replacement target: the producer resolves each selector
against the same captured source and preserves ambiguity or unavailable meaning.
An identity correction without a unique available authored target stops with
`definition_target_unresolved`; it offers no guessed save or positional address.
The affected subject owns each target/declaration once; correction guidance
refers to `affected subject.requirements[].target` and its declaration/uses.
Missing definitions can still be appended when their exact entity and typed
meaning are established. Compiler claim, row and reference identities remain
private and are never correction arguments.

A repository outside the bound assessment scope is reported with both the
authored and bound repository identities. It establishes neither a typo nor
local infrastructure failure. The requirement-source owner reports
`description_repository_unavailable` with the supplied and bound identities.
The existing identity-rebinding correction is available when the caller
explicitly identifies a mistake. It preserves behavior, applicability, source
passages and evidence associations. Intentional foreign references retain their
meaning and remain outside the bound source-resolution scope.
Same-repository missing committed files and unresolved declarations keep the
source owner's separate diagnoses and existing supported correction choices.
Their compact choices distinguish a mistaken existing-source reference from
planned functionality before detail is opened. Selected recovery asks for that
caller choice rather than unconditionally requiring a new typed definition.
Planned functionality uses a specification-owned identity without requiring
implementation; either correction preserves the authored behavior and its uses.
Reader/provider failures and unavailable or ambiguous authored targets do not
advertise this identity-replacement route.

Public requirement source links share one projection across selected rows,
full requirements and coverage. It retains the owning work record, source
field, exact passage, occurrence, location, currentness and stale-link
correction. Check digests and repeated constraint/claim arrays stay internal;
the declaration retains its semantic selector for dependent authoring.

Case-association details keep public case and obligation identities and map
verification choices through the same captured source and common resolver.
Each verification's distinguishing meaning appears once, with its eligibility
and candidacy; blocked owners and competing cases retain their actual effects.
Ambiguous or unavailable associations remain explicit and supply no guessed
selector. A missing case offers the exact associated-verification read. Missing
eligible meaning or an unknown association offers parent requirement choices;
the caller chooses the intended association, never a compiler identity.

A supported correction offers the exact current read in `next_calls` with
`purpose:"current_correction_context"`. `save_guidance.unit` names the write
owner. Reader calls use `{reads:[Read,...]}`, including a single read;
`for_changes` belongs on the `Read`. Consume results in request order and use
the explicitly requested `contexts[unit].revision` for the write owner. Follow
that context's returned call matching
`save_guidance.changes_schema_from.select` for the existing save grammar.
Requirement replacements and associations use the supplied semantic selectors;
case and obligation identities keep their existing public meanings. No historical
assessment supplies write authority. Missing definition, proof choice, authored
case prerequisite and unavailable capability have separate corrections. Derived
bindings are never authored in place of missing case content. Discovery with a
missing property question stays explicitly nonexecutable; no query is invented.

Obligation reads return `claims:[Selector,...]`, directly reusable by save.
These preserve the linked assertion subset and explicit verification links;
associated whole declarations are not a substitute for exact membership.
Omit `claims` when a correction leaves associations unchanged. Restating
unchanged membership reuses the returned selectors without expanding a group
or dropping verification links. An assertion-changing whole-declaration
amendment uses `replacement_key` for its submitted population, explicit claim
selections under that key for intended subsets, and a separate `verification.key`
for the submitted check. Translate the returned associations explicitly;
saved selectors continue to select saved assertions. Preserve shared case IDs
and unrelated links; unamended retiring uses in another unit refuse the write.
Unavailable membership makes
the read partial, retaining its cause and uncertainty with `claims` omitted for
the affected obligation. Independently available declarations remain selectable.
Repair requires the caller's intended replacement, never an inferred empty set.
Complete known declarations do not establish a complete scoped specification
when membership is unresolved. The public summary then reports specification
unavailable; independently incomplete meaning stays incomplete, with the affected
membership identified as unassessed in summaries, inventories and selected detail.

Independent source-absent, applicability, source-accounting and criterion gaps
are returned as separate `gaps`, each with its own cause, write owner and
correction or limitation. They remain available beside selectable diagnoses.
Accounting recovery preserves exact source passages and repeated occurrences;
a saved exception binding gap names its existing exception-schema selection.
Neither a source association nor an exception supplies missing typed meaning.
A stale definition-integrity pin can use the existing root read followed by
the nonexecutable sole `refresh_proofs` form. Exact availability, compatibility
and current-version fences remain the refresh owner's; no upgrade is inferred.

The public recovery owner checks external calls against the receiving tool's
live registered contract. A missing reader or rejected request gives a specific
consumer limitation and no save recipe. Findings-only, unavailable compilation
and focused-write limitations offer no contradictory authoring imperative or
ungranted preview. Named focused contracts have no save route; they are never
redirected to the root.

`save_guidance.after_save` preserves the original assessment unit, focus and
obligation selector even when the correction writes the parent. It is a
conditional reassessment call, not a requirement to reread after success.
Correction-only work may finish after saving. A row readback, action preview,
proof execution and credit are separate tasks. Retained reads preserve captured
meaning; a changed or unobservable current source qualifies the observation
without recomputing or rewriting that meaning.

Unknown diagnoses in a complete inventory, diagnoses unobserved after owner
failure, and outside-population restrictions have distinct refusal causes and
return the exact retained inventory request. Malformed/corrupt originals keep
their stopping condition; no live-source substitution or unchanged retry is
invented. Initial retention failure supplies no fabricated detail binding.

`createContractAssessmentSurface` retains its private `prepare` composition for
save settlement. That consumer receives the incumbent captured assessment facts;
`respond` uses the minimal public task projection. This separation preserves
save receipt behavior and gives it no new authority to expose internal facts.
Both share the same evaluator, authenticated capture and retained-source owner.

Every retained query binds a comparable `authority_identity` — route, unit, role,
the run the launcher bound (a worker's launch, run and retry tuple; a findings
session's advisory run, `{ kind: "advisory", run_id }`, with its source binding and
root), the source kind and identity, the
authorized population and, for a managed source, the unit's source generation. The
query session declares `requireAuthorityIdentity`, so retention and every hot
cursor, snapshot identity and cold retained-locator read re-resolve the caller's
identity and refuse (`selected_response_query_invalid`, binding field
`authority_identity`) before disclosing content when it is absent or different:
another role, run or retry, a moved frozen or assigned source, or another
population. A canonical retained read is labelled `current` or `changed` against the
unit's current revision.

Measured on a 66-obligation unit sharing eight requirements and a 3.5 KB global
note, UTF-8 request plus CallToolResult bytes: the compact first response costs
2,219 bytes in one call; complete retrieval costs 138,737 bytes in 21 calls; one
selected obligation costs 7,574 bytes in one call; an inventory followed by every
obligation read costs 530,948 bytes in 71 calls. The retired query's full read of
the same population, modelled exactly as three 25-row pages each repeating the
contract inputs, cost 97,168 bytes in three calls. Complete bounded retrieval
therefore costs 1.43 times the bytes and seven times the calls of the retired full
read, whose responses each exceeded the frame bound, and 26% of the bytes of
inventory plus N.

`workspace_validate_proof` accepts the same unit/focus and either an optional
`obligation_id` or a returned `diagnostic_group_id`, never both. It resolves the
whole unit with exact admitted pack metadata, so every group identity it publishes
is one the whole-unit group selector retrieves. It takes no cursor: an answer is
never paged, spilled or continued, and a `cursor` argument is refused as an
unrecognized key. Each answer is assembled against the shared admission
measurement and the selected-response delivery class, min(8192, the active MCP
inline limit); the response boundary owns that size and the operation owns field
meaning.

The default answer (`proof-validation-assessment.v2`) is an assessment and a
selection index, not a repair dossier. It publishes the unit, the combined
`content_digest` the authoring CAS accepts, and `source` (status, source and
context digests). `authored` reports authored validity with obligation, valid,
invalid, explicit-gap and unselected counts over the complete obligation
population; rows with no selected route remain in that denominator. An
obligation is valid only when its meaning is valid and it is accounted for by
a validated selection or an explicit opt-out; `unselected` counts every row
with no selected proof, opted out or not. `route`
separately reports the selected-route prerequisite assessment: its status,
assessed and prevented counts, and the authored-input, canonical-source,
system-capability and execution-evidence stages. An omitted configurable
definition parameter is an unresolved construction input on that route, never
missing authored meaning; an explicitly supplied malformed parameter is still
refused atomically. `owner_failures` lists each independent owner failure with
its actual owner, cause and system-owner recovery, never recast as authored
invalidity. `execution` is always `not_started` with zero proofs executed and
zero credit, and `dispatch` is `not_assessed` with the
`workspace_validate_dispatch` call as the independent structural assessment;
validation never invokes it. `acceptance_coverage` reports the whole unit's
criterion coverage status, criterion, covered, uncovered and stale-association
counts and its existing correction.

`diagnostics` names its count units: `authoring_groups`, `semantic_groups`,
`authoring_occurrence_effects` (selected-route blocking, nonblocking and
unresolved occurrence counts) and `semantic_logical_cause_recovery` (logical
causes by recovery status). Its `issues` index lists blocking or unresolved
authoring groups, then semantic groups whose owner established an authored
correction or a system-owner failure, each in its owner's order. Independent
owner failures come first under `owner_failures`. Each issue carries a
`meaning` reference, its subject and occurrence counts, the owner's bounded
affected `obligation_ids` with the exact `obligations_omitted`, and the exact
`diagnostic_group_id` call. An exactly equal public summary is stored once in
`diagnostics.meanings` and referenced by index; equal summaries never merge
owner groups, subjects or selectors. An authoring meaning names its owner, code,
category, effect, stage, route and route reason, and an occurrence no route
assessed states its owner's own reason. A semantic meaning names its owner, gap
class, reason codes, recovery status and that recovery's explanation. Complete
issues are admitted in priority order while the frame fits; `issues_returned`
and `issues_omitted` count that index exactly, and `issue_selection_basis` is
`group_recovery`, a different projection from the logical-cause recovery
counts. `subjects_included: false` states that per-subject detail is not in the
default.

That is the `workspace_validate_proof` producer's diagnostics, which keeps all
of these members. The `workspace_assess_contract` answer, and the assessment a
`workspace_create_record` or `save_record` answer embeds, is a projection of
it that carries `authoring_groups`, `semantic_groups`, `meanings`, `issues`,
`issues_returned`, `issues_omitted` and `subjects_included`, and omits
`authoring_occurrence_effects`, `semantic_logical_cause_recovery` and
`issue_selection_basis`: each indexed issue's meaning states its own effect,
stage, route and recovery, and each selected diagnosis its own recovery
status. The two group counts stay on every answer, including one whose
original could not be retained, and no replacement count is added. A read of
a retained original projects the same members and reassesses nothing. Nonblocking and inspection-only observations are counted, not indexed.
A population-level inspection-only semantic group with no obligation identity is
count-only in this bounded contract: that is an access limitation, not evidence
that its cause is harmless. The index is a bounded recommendation, not a cursor:
repeating the same call returns the same answer, while correcting an issue and
revalidating can expose the remaining current issues.

A selected diagnosis (`proof-validation-selected-diagnosis.v1`) carries the same
source and CAS envelope. For a `diagnostic_group_id`, `selected` names the group,
its owner and its code, category, effect, stage and route, or its gap class,
reason codes and recovery status, with its meaning. `recovery` keeps the owner's
explanation and instructions, and for a registered code the actor its registry
names; the registry's status and operator-action labels are not published as
instructions. `subjects` lists only that group's subjects with their typed facts:
obligation, authored path, case and verification identities, prerequisite and
status, and for an incomplete derived binding its public `failed_fields` and the
`corrections` clauses they select. `corrections` defines each clause actually
used by its authored field and upsert guidance member. `correction_call`, when the
owner's route supports it, addresses the actual obligations and cases at the
current `expected_content_digest`, and `requires_authored_values: true` states
that the caller still supplies the correction; no correction route the owner does
not grant is invented. Semantic subjects carry their semantic identity,
non-actionable reason and typed evidence facts such as missing fields and
competing values; provenance and nested owner dossiers stay with the owner. The
answer states `subjects_total`, `subjects_omitted`, `complete` and zero execution
and credit. When the whole group does not fit, it returns the same shared cause
with the complete identity-only `subject_index` (every affected obligation_id and
the validation call that selects one), or failing that the whole subjects that
fit, with exact omissions and `complete: false`; no offset, range, page or spill
is offered.

For an `obligation_id`, the answer states that obligation's authored and route
status and lists every owner cause naming it, each once and in the same priority
order, including semantic rows whose identity names it, with whole-unit group
identities and exact `diagnoses_total`, `diagnoses_returned` and
`diagnoses_omitted`. It is terminal: it never offers itself or an expanding group
as a narrowing continuation. If its first indivisible diagnosis cannot fit, it
refuses as `proof_validation_answer_exceeds_compact_class` with the exact scope,
measured size, limit and reason, and offers only a strictly narrower existing
selection when one exists. That refusal is an explicit delivery limitation, never
successful validation.

The package-owned `occurrenceRecoveryFacts` in `proof-executable-map.mjs` derives
the failed fields and correction clauses from the binding owner's typed failures;
the refusal prose and the selected diagnosis are composed from those same facts,
and nothing parses prose to classify a correction. A missing authored case
field uses that same mapping to name the specific authored component,
target, observation or falsification input. Independent association failures
keep their own correction; valid verification links stay intact. Public task
diagnoses state these authored fields through the selected correction recipe,
without publishing validator paths or restoring derived-binding bookkeeping.
An unavailable assessment names the affected requirement, proof-input or semantic
validity check with its native cause. Internal implementation ownership is not
an agent recovery action. Independently established defects remain correctable.
A missing authored prerequisite selects one prerequisite clause from its own owner fact and
publishes no failed fields: a parameter withheld because the obligation's case
lacks the field it is derived from selects `prerequisite_component`
(`obligations[].case.component`) or `prerequisite_target`
(`obligations[].case.target`) and names that case as the subject's `case_id`; a
missing case, or a parameter withheld because no single native test binding
resolves, selects `prerequisite_case` (`obligations[].case`, operation
`link_one_case`). Each prerequisite clause carries the owner's constraint that
the derived binding and the parameters read from it are never authored directly.
Every authored-input instruction this owner composes, registered or
stage-inferred, tells the author to read the current unit through
`workspace_read_wiki` and save the correction through `save_record` with the
returned revision, naming the authored member (`changes.obligations` or
`changes.validation`) the recovery belongs to. A registered recovery's `route`
remains the owner's structural identifier for that member; it is not an
instruction to call a tool of that name. Group identities bind the exact
source, context, definition and grouping-projection identity and replay
deterministically while those inputs remain current. Unknown groups and moved
inputs refuse as `obligation_coverage_diagnostic_group_not_found` with a fresh
validation call. Canonical-only slots reject explicit overrides. Validation
neither changes source or pins nor invokes providers, executes tests, emits
implementation evidence or grants readiness authority.

Counts name their denominators. `observation_count` is the complete population
of owner rows. Owner-based `group_count` retains distinct provenance, while
`logical_cause_count` groups independently by gap class, reason set, and
affected obligation: several owners observing one obligation correction count
once, but equivalent corrections required on two obligations count twice.
Population-level causes without an obligation identity group by class and reason
set. `recovery_status_counts` partitions those logical causes into authenticated
authored corrections, system-owner failures, and inspection-only causes. No
deduplication discards a cause, subject or owner group.

Recovery is qualified rather than inferred from a tool name. A validation or
query call may be inspection only. `authored_correction_available` additionally
requires an authenticated semantic transition and names the revision-bound read
and authoring owner; it never supplies the caller's semantic choice. Both facts
belong to one observation: the row carrying the authenticated transition is the
row whose remedy names the write. An owner's internal descriptor, or a write
named for another observation, establishes no correction.
`system_owner_failure` establishes no author-input repair. Execution-only
limitations remain reported by their execution owner and do not become semantic
admission causes.
The dispatch recovery carrier scopes these authorities explicitly:
`authored_completeness_admission` is the deciding authority, while route and
workbench observations are nonblocking. When authoring admission offers agent
correction, an independent observer's `inspection_only` status cannot be
presented as a global inability to repair.
Managed preflight and provisioning apply the same rule: classifier exceptions
and malformed internal projections preserve their originating code and details,
name the system owner, and carry `recovery:null`. They never advertise the
obligation query/upsert sequence unless the semantic state itself established an
applicable authored correction.

An authored `controlled_contract_node_ids` value is not subject to a save-time
membership gate. If a saved identity is absent from the current native contract,
validation reports `obligation_coverage_node_unknown` at the authored field as an
author-input problem. The operator queries the current source and replaces the
list through ordinary obligation-coverage upsert using the returned digest. A
known canonical component contradiction is different: the canonical carrier and
authoring writers reject it before effects, so it cannot become a persisted
authored-input-stage failure through either supported route.

## Authored and resolved representations

The sole authored file remains the incumbent obligation-source path. Its current
schema is `controlled-contract-obligation-coverage.v3`, with separate `focus`
and `selected_unit` fields. It stores optional obligation meaning and selection,
never effective defaults, derived graphs, observations or copied test declarations.
Bounds remain 4,096 rows and 1,048,576 canonical bytes.

The parent obligation source stores one `cases` definition per `case_id`.
Obligation rows, including slice rows, store only that identity. Definitions
reference canonical facts (for example, `component: {reference_id}` and an
associated `verification_id`) instead of copying those facts. Inline component
meaning that matches an existing canonical reference is normalized to that
reference. Target paths remain in work-record validation; cases retain `target.owner_unit`
and their selector. Query resolves that reference for semantic read-back. Case
revisions include the referenced component and target facts. Unfinished fields
remain absent.

A case definition's `verification_id` must name an eligible `test_execution`
verification claim. One owner computes that population for mutation, explicit
selection and assessment, from the contract's semantic facts alone: the
verification claims the obligation lists in its own
`controlled_contract_node_ids`, and the verification claims an explicit
`verifies` relationship ties to a requirement claim the obligation lists. A
requirement already records which verification verifies it, so linking only the
requirement claim is enough and the obligation does not repeat the verification
identity. Whether an executable `test_proofs` binding exists never changes the
population, and no relationship is inferred from prose. Every `test_execution`
verification of a linked requirement is eligible, so listing one of them beside
its requirement does not exclude the others; the case names the choice.
Association is authored meaning only: it is not executable readiness, which
still needs the case's complete target, observation and falsification, and it
is not proof success, which only execution establishes. A case may omit
`verification_id`. A saved case that names a verification keeps it, even when
further eligible verifications are linked later. A case that names none adopts
the sole eligible verification when selecting it would satisfy every incumbent
constraint: no other case owns it, no use of the case links verifications that
exclude it, and the unit that owns the case's declared target is the one saving.
That holds for a new case and for a previously saved one, and an amendment of the
obligation alone, with no case member, is enough to adopt it. The case's ordinary
target declarations follow it from its internal placeholder to the verification
through the incumbent identity rebinding, keeping their target, position and
owning unit.

With no eligible verification, with several, or with one a constraint blocks,
the save still commits every supplied change and the case stays an unresolved
draft that names no verification. Nothing is chosen for the author, including
among cases that want the same verification in one save, and request order never
decides. The draft's internal placeholder is not a canonical claim, is never
published as a verification, and derives no usable binding: validation reports
`obligation_coverage_native_binding_case_incomplete` with the binding owner's
missing-proposition facts, and proof execution starts no provider for it. The
selected diagnosis carries the subject's `association`: its `condition`
(`no_eligible_verification`, `sole_eligible_verification`,
`ambiguous_linked_verification`, or the blocking constraint's own
`verification_owned_by_another_case`, `shared_case_verification_conflict`,
`case_selector_cross_unit` or `case_target_invalid`), every
`eligible_verification_ids` entry, the complete
`candidate_verification_ids` an author may select, each `blocked` verification
with its constraint, and the `required_choice` member. The candidate population
is never shortened. For `verification_owned_by_another_case` there is no
verification to select, so `required_choice` is the save owner's conditional
recovery instead: `obligations[].case.id` `when: "same_test"` with the blocked
entries' `saved_case_ids` as `choose_one_of`, `otherwise`
`requirements[].verification` `when: "different_test"`, and that owner's
`correction`. `required_authored_input`, the subject's
`missing_authored_input` and the `association` correction definition state the
same two conditional members and never `obligations[].case.verification`.
Assessment chooses neither, and the save's identity checks are unchanged. One explicit eligible selection, or saving the obligation
again once its links leave a sole eligible verification, resolves that same case
without repeating its identity or any other member. The derived binding's
proposition identities come from the named claim and are never authored. The
`case_authoring.verification_association` guidance member states this
relationship and names
`required_object_shapes.requirement_rebinding.complete_case_population` as the
owner of which query output returns the identities. A selection that names an
ineligible verification refuses as `obligation_coverage_case_selector_invalid`
with condition `unlinked_verification_selected` or, from the native owner,
`unassociated_declaration`. Omission is never such a refusal. Each
refusal names the deciding field, the rejected identity, the eligible
identities, the obligation's current links, that guidance member and the
current-query call, and leaves persisted state unchanged.

One verification identity belongs to at most one `case_id`; several obligations
may share a case by naming its `case_id`. A different case naming a verification
another case owns refuses as `obligation_coverage_case_verification_conflict`
with condition `verification_owned_by_another_case`, the verification, the
saved and requested case identities, the requesting obligations, the
requirement claims that verification verifies, the
`obligations[].case.verification` field (the member a save accepts), and the guidance member
`case_authoring.verification_association.additional_verification`. That member
states the supported correction for a genuinely distinct test of the same
requirement: resubmit the requirement with unchanged nature, modality, subject
and behavior, a verification that differs in verifier, observes or fails_when,
and no `replace_claim_id`. Requirement and verification identities are compiled
independently, so the requirement keeps its claim, the existing verification,
its case and its links are unchanged, and `requirement_bindings` returns the
added verification for the new case to name. The refusal's next call is that
upsert with the unit and bound revision fixed and
`contract_requirements.requirements` left for the caller to author; it never
supplies meaning.

`case_authoring.component` states the component forms, where the selected
proof's `component` role refinement is read (query with `parameter_detail`),
and that one identity carries one type across the contract. A component whose
type the selected proof does not accept keeps its
`obligation_coverage_prospective_incompatible` refusal, reason, constraints and
internal cause path. When the prospective case states a component its saved
definition does not, that cause also names `obligations[].case.component` and
the case, and the refusal names the field and `case_authoring.component`; a
cause on an unchanged saved component, or on another parameter, is not
attributed to the request. A component declared by
value whose identity is saved under another type keeps the carrier's
`controlled_contract_carrier_validation_failed` refusal with
`duplicate_reference_identity`; the case owner adds the
`obligations[].case.component` field, that guidance member and
`component_reference_conflicts`, which lists each case, its obligations and the
requested and saved references. No type is coerced, merged or aliased, and a
request-schema refusal of the component is located at the same member.

A module test binding derives `system_under_test_boundary.runtime_module_path`
only from the resolved component: a by-value `repository_path` identity, or a
`reference_id` whose saved reference has one, supplies it when its path names an
accepted module source. A `profile_term` or other descriptive identity names
meaning, not a source location, and supplies no module path even when its term
mentions a file; the `case_authoring.component` member `module_source` states
this. When the typed owner diagnostic of
`obligation_coverage_native_binding_case_incomplete` reports that required
property missing, its recovery keeps the code, assessment and upsert call
addressed to the unit, obligation and case, and additionally names
`obligations[].case.component` and `case_authoring.component`; the caller
supplies the actual repository, path and current digest. Only that typed
required-property fact selects this correction, and a simultaneous
verification-association failure keeps its own correction beside it.

`deriveAuthoredTestCases` deterministically derives native structures from the
source and current canonical facts with the incumbent binding template. It never
recovers missing case fields from a native binding. Derived structures are not
persisted as another editable representation. Taking over an existing native
binding removes that binding through its incumbent owner in the same settlement;
subsequent native writes cannot reintroduce it. Unrelated canonical facts and
native declarations remain owned by their existing authoring routes.

Upsert compiles the entire prospective batch, then checks every affected parent
and slice use through `resolveProofAuthoring` (the authoring composition named
below, reached through its own `@agent-chassis/controlled-contract/proof-authoring`
subpath) in known-parameter mode. Missing
targets do not suppress independently known component contradictions. No save
runs full validation, construction, or providers, or returns a completeness report.

The existing source leases and settlement compose changed
obligation sources and, when needed, the authorized target owner or native
binding retirement. The source lease is the only exclusion any coverage writer
takes, including acceptance-coverage persistence and refactor coverage
settlement: a `.lock` file beside an obligation source or coverage carrier is
never read and governs no write. Ordinary case edits have no native publication participant.
Final and no-op comparisons fence the source closure, native facts, targets and
exact definitions. Proven compensation reports unchanged state; failed
compensation reports indeterminate effects. Post-commit read-back failure reports
committed state with selected-query recovery.

The shared list amendment primitive is `upsertProofAuthoringSelection`; the
backend composes it in `proof-authoring-operations.mjs`. Combined revision,
native case compilation and existing-owner settlement are factored into
`proof-authoring-revision.mjs`, `proof-authoring-case.mjs` and
`proof-authoring-targets.mjs`. `proof-validation-operations.mjs` owns
`validateProofOperation` with its assessment orchestration and presentation, and
invokes the saved-source assessor in `proof-authoring-assessment.mjs`. The package-owned
`proof-authoring-diagnostic-groups.mjs` projects semantic equivalence and lossless
occurrence membership; wiki-core alone mints public group IDs and calls, and the
validation answer is bounded to the compact class without spill or cursor. No
diagnostic store or second detail endpoint is involved.

#### A batched refusal states each repeated definition once

A prospective-parameter refusal carries one cause per affected obligation, and
every cause used to restate the definition it was measured against four times: as
`refinements[].value`, as `assessment.role`, and again inside `problem.cause`,
which repeated the cause's own `source_policy`, `refinements` and `assessment`
verbatim. Twelve obligations breaking one component-role refinement therefore
carried forty-eight copies of one small object.

`shareRepeatedProofConstraints`, in the same package-owned module, states each
repeated definition once. The refusal detail gains `shared_constraints`, whose
entries carry a `constraint_id`, the canonical `digest` that identifies the
definition, its `occurrence_count` and the definition itself; wherever that value
stood, the member now holds `{ "constraint": "<constraint_id>" }` and nothing
else. `problem.cause` names the members it restates in
`restates_cause_members` instead of repeating them.

The shared positions are named one by one — `source_policy`, each
`refinements[].value`, `assessment.role` and `problem.cause` — and a definition
that occurs only once stays inline, because a reference to a one-use table is
longer than the value. An occurrence identity is never a shared position: the
`unit`, `obligation_id`, authored `path`, `code`, `reason`, `owner`,
`problem.category`, `problem.severity` and the rejected `assessment.status`,
`assessment.reason` and `assessment.actual_references` of every cause stay inline,
because those are what make a cause distinct. Distinct roles, expected values and
recovery actions are therefore never merged, and `cause_count` and `member_count`
still count what they always counted.

### The shared proof contract and the two proof workflows

Proof authoring and proof execution are separate workflows over one saved
representation. Everything they must agree about that representation is owned by
the shared proof contract in `packages/controlled-contract/lib/proof-contract.mjs`
(also served as the `@agent-chassis/controlled-contract/proof-contract` subpath):
the `ProofAuthoringError` type, the draft-contract gate `assertProofAuthoringDraft`,
the diagnostic and problem shapes, the saved-row selection, and
`assessProofAuthoringSemantics` — the assessment of what an author actually
said. That assessment asks only whether the authored contract is mechanically
complete: an obligation's statement and the presence of every canonical node it
names in the current contract. It
does not judge whether the authored plan is adequate -- whether an obligation
reaches the verification of the requirement it covers, and what a verification
it reaches says, are policy judgments and are not authoring completeness. It
loads no proof pack, resolves no evaluator, and reads no executor, so it is
identical whether or not an executing runtime is installed.

The EXECUTABLE MAP over that same saved representation is owned by
`packages/controlled-contract/lib/proof-executable-map.mjs` (served as the
`@agent-chassis/controlled-contract/executable-map` subpath):
`resolveProofExecutableMap` resolves the exact admitted definition each row
pins, its parameter contract, the canonical values its slots derive from, the
dependency nodes it expands into, and each selected route's own prerequisites
and readiness. Both workflows consume that map and neither owns it. Proof
execution reads its rows and dependency nodes directly through that subpath, so
no execution module loads the authoring workflow to obtain them, and
`packages/controlled-contract/lib/proof-authoring-resolution.mjs` -- the
authoring composition, served as the
`@agent-chassis/controlled-contract/proof-authoring` subpath and deliberately
NOT a root-barrel export -- composes the map with the shared semantic assessment
and publishes the resolved-selection carrier, the per-obligation fact projection
and the population counts.

`packages/wiki-core/src/operations/controlled-contract/saved-proof-source.mjs`
is the matching owner one level up: the canonical unit-address parser, the saved
source tuple and its case population, the deterministic derived contract, the
canonical case-revision projection, and the canonical facts a saved plan is read
against. Authoring and execution both consume those functions directly; neither
reaches them through the other's operations, and there is one implementation of
each. `package-runtime.mjs` reaches that surface through
`loadControlledContractSharedContract`, which composes the package's narrow
contract subpaths under the same evict-on-rejection memo instead of the mixed
`current.mjs` barrel.

Reading a proof definition's meaning — its identity, digests, admission and
parameter contract — is `loadAdmittedProofPackMeaning` and
`loadExactAdmittedProofPackMeaning`. Execution keeps `loadAdmittedProofPack` and
`loadExactAdmittedProofPack`, which additionally resolve the exact evaluator and
retain their existing refusals unchanged: the current-version load hard-refuses a
test-validity pack with no exact evaluator, and the exact load attaches one only
when it resolves.

### Authored meaning and the selected route's executable map

`resolveProofAuthoring` publishes both facts about every assessed row and keeps
them apart. `semantic_status` and `semantic_diagnostics` are the shared semantic
assessment. `authoring_status` and `authoring_diagnostics` are the authored
inputs the row still owes. `selected_proof_assessment` is the executable map of
the route the author SELECTED: its exact definition, authored case, native test
binding, declared test target and construction capability, with its own
`readiness_status`, unchanged.

Selecting a route never makes a semantically complete plan depend on executor
preparation. `authoring_status` is the semantic assessment plus the inputs the
AUTHOR still owes: the content of a case they wrote, a parameter that case must
supply, an unknown reference, and a native binding the derivation produced from
that case without its complete meaning. The route's own executable map -- a
native test binding it could not derive, an ambiguous or absent declared test
target, and the definition's construction capability and dependency recipe --
stays on `selected_proof_assessment` with its unchanged `readiness_status`, is
reported to every consumer, and blocks neither authoring nor admission. A row
that selects no proof definition has no route to assess at all.

The resolver's aggregate `status` remains the executable-map fact — every
selected row resolved and the complete resolved population validated — and the
resolved `obligations` carrier keeps `design_status` bound to its own invariant.
The resolver's `counts.valid` and `counts.invalid` answer that same executable-map
question one row at a time. `workspace_validate_proof` does not republish that
executable-map verdict; its `route` assessment reports the selected-route stages,
and it derives its public `authored` verdict and valid/invalid totals from each
row's existing `status`,
`authoring_status`, and `semantic_status`; it does not implement another semantic
classifier or convert terminal diagnostic counts into an admission gate.

A declaration published by that readiness owner reports the execution-side facts
it would otherwise drop. Its stage lists are projected from the selected route's
stages, which exist only once the selection loads, so a row whose pinned
definition could not be loaded carried no explanation while the resolved-selection
carrier recorded `design_status` invalid for it. That row's declaration now
carries `reported_execution_diagnostic_codes` — present only when there is such
a fact, and only for a row that selected a definition. They are reported, never
blocking: no pin, pack, catalog or executor fact gates authoring completeness or
implementation admission.

### Per-obligation facts under an incomplete population

`resolveProofAuthoring` publishes the aggregate `mapping` only when every
assessed row resolves; an unresolved definition
keeps it null. It also publishes `obligation_facts`: the same per-row projection
over every assessed row, carrying each obligation's meaning, `design_status`,
resolved identity, selected-proof assessment and diagnostics.

Consumers that allow an incomplete population read the validated carrier rows
when the mapping exists and `obligation_facts` otherwise, so one obligation's
validated relationship survives a sibling's incompleteness. `obligation_facts`
is not a carrier and never an admissible mapping: it grants no proof credit, and
every complete-mapping consumer still refuses with
`obligation_coverage_resolution_required` when the aggregate is unresolved.

An obligation whose authored inputs are open reports its own cause. A retained
retired annotation is rejected by carrier validation and preserves its original
bytes and diagnostic evidence; a declaration that no obligation names reports
`runtime_proof_obligation_missing`. `obligation_coverage_resolution_required` is
reported only when no per-obligation fact was projected at all.

A work record that authored no obligation `mechanism` has not contradicted the
contract's verification method. Silence is an absent fact, so it neither
conflicts nor grants credit; only an authored mechanism kind that disagrees with
the contract is a cross-owner conflict.

### Criterion identity and authored criterion metadata

A work-record acceptance criterion may carry authoring metadata beside its text
(`verification_method`, `evidence_target`, `facet_provenance`), while criterion
identity is derived from position and text alone, or from an authored
`typed_identity` where one is supplied. Coverage therefore projects the
canonical criterion onto that narrower identity input before deriving
identities, and drops exactly those metadata fields from the projection. Any
other field reaches the identity owner and is refused there, so an unknown or
malformed criterion still fails at its owning boundary rather than being
silently discarded.

The metadata is not lost by this narrowing. It remains on the canonical
criterion the resolved facts report, and it remains inside the
`workRecordLocatorDigest` and obligation `source_locator_digest` that own
coverage source freshness. A metadata-only criterion edit consequently keeps
every criterion identity and saved coverage row addressable, and still reports
the source as changed.

### Author-declared criterion coverage

The author states which of the selected unit's acceptance criteria each of its
obligations covers, and the server trusts that statement. This is an authoring
aid for finding coverage gaps, not an adequacy review: the server checks only
mechanical integrity and never infers an association from counts, order,
wording or proof results.

- A public `{contract:"criteria"}` read returns the selected unit's criterion
  meaning and `members[].selector`. Public `changes.obligations[].criteria`
  uses `{kind:"criterion",match:{text?,typed_identity?}}`, with at least one
  authored field and exactly one saved match. Only an actually authored typed
  identity is eligible. Held semantic selectors can be used directly; read
  missing meaning with
  `workspace_read_wiki({reads:[{subject:unit,select:{contract:"criteria"},for_changes:["obligations"]}]})`.
  The ordered result supplies criterion selectors and `contexts[unit].revision`
  supplies the write revision. `$key` selects only a criterion created in that
  same save. Generated identities, positions and AC labels are not selectors.
- The internal coverage query returns `acceptance_criteria` with `identity`,
  `position`, `text` and `text_sha256`, and may project `criterion_identities`.
  These describe server bindings; the public author supplies semantic selectors.
- Each saved association lives on its owning obligation as
  `acceptance_criteria: [{identity, text_sha256}]`, binding the identity to the
  criterion text it was declared against. There is no second mapping. One
  obligation may cover several criteria and several obligations may cover one.
- Public selection refuses missing or ambiguous criterion meaning as
  `selection_not_found` or `selection_ambiguous` before publication. The internal
  association owner separately refuses an unknown resolved identity with
  `obligation_coverage_acceptance_criterion_unknown` and returns the exact bulk
  criteria read above, with any slice suffix intact. A parent's criteria are
  not a slice's and a slice's are not the parent's. Duplicate selectors are a
  request schema refusal. Every refusal happens before effects.
- Incomplete coverage is savable. It is an assessment result, not a reason to
  refuse authoring.
- When a criterion's text changes, an association declared against the old text
  no longer covers it, including when an authored `typed_identity` stays the
  same. Assessment reports it in `stale_associations` with reason
  `criterion_text_changed`, or `criterion_absent` when the identity is gone.
  Criterion edits also change the work record and therefore the combined
  revision, so an upsert using the earlier digest is refused as stale.

A [proof exception](#deliberate-exceptions) records that the author declines
proof for one obligation. The obligation keeps its statement and criterion
associations and covers those criteria when its authored meaning is valid. It
needs no executable selection, binding, executor or result, and it grants no
execution or verification credit. It cannot coexist with a proof selection or
case: applying it to such an obligation, or a later selection or case amendment
on the declined obligation, is refused atomically with
`obligation_coverage_proof_opt_out_conflict`, and a saved source holding both is
invalid. It is distinct from the whole-unit exemption and revives no retired
`gap_kind`. An obligation with neither a selected proof nor a proof exception is
unfinished authoring and covers no criterion. Missing executable support for a
selected proof never requires an exception.

Coverage of the selected unit (`acceptance-criterion-coverage.v1`) is the unit's
current criteria minus those named by a current association of one of the
unit's own valid obligations. Its `status` is `complete`, `incomplete`, or
`not_applicable` when the unit has no criteria. It reports `uncovered_criteria`
by identity and position, `stale_associations`, bounded lists with omitted
counts, `verification_credit: 0`, and for an incomplete unit a `correction`
naming the internal query and upsert for that exact unit and the stored
`obligations[].acceptance_criteria` field. Public authoring uses
`changes.obligations[].criteria`. Individually valid obligations
remain valid when coverage is incomplete. A parent's obligations never cover a
slice's criteria, and covering a slice changes no parent or sibling state.
A slice obligation may reference a shared parent case as `case:{id:caseId}` where
that case's meaning applies, but the reference carries no coverage: the slice
still authors its own obligations and associates them with its own criteria's
semantic selectors, never by AC label, position or similar wording. The
upsert authoring overview states this rule.

`workspace_validate_proof` reports this assessment's status, counts and correction
as `acceptance_coverage` on whole-unit validation. An `obligation_id` validation instead reports
`acceptance_coverage: {scope: "selected_obligation", whole_unit_assessed: false}`
and the whole-unit validation call, so one valid obligation is never read as
unit coverage.

The ordinary authoring readiness owner computes the same assessment once and
publishes it as `ordinary_authoring_readiness.acceptance_coverage`. A required
unit with uncovered criteria is `incomplete`, its authored-input correction is
the query/upsert route for the selected unit, and dispatch assessment refuses it
with `controlled_acceptance_incomplete`. The mechanically complete workbench
path cannot bypass this fact: a required unit is `complete` only when that
coverage is `complete` or `not_applicable`. Currentness, source refresh and
system-owner failures keep their own causes. Consumers read this one fact and
do not reconstruct coverage.

The readiness owner names its open conditions in `incomplete_conditions`
(`requirements_absent`, `obligations_absent`,
`obligation_definitions_incomplete`, `acceptance_criteria_uncovered`). When
uncovered criteria are the only deciding condition on a current,
generation-bound source, the shared admission attributes the refusal to
`assessAcceptanceCriterionCoverage` with the single owner code
`controlled_acceptance_criteria_uncovered`. Its `deciding_causes` entry carries
the criterion count, covered and uncovered counts, the uncovered identities and
the coverage correction. The explanation states that denominator and those
identities, and asks the author to supply the missing verification meaning and
associate an appropriate obligation with each uncovered criterion through the
query and an upsert that uses the query's fresh `content_digest`. No obligation
is reported as affected. The design-workbench rows stay in
`admission.independent_observations`, with their own owners, codes, population
and detail call, marked `not_deciding_this_refusal`. When other authored
conditions also decide the refusal, each one is kept in `deciding_causes`, and
the coverage owner and code are added to the observed causes rather than
replacing them. Recovery guidance never proposes a proof opt-out.

An existing obligation whose authored input is missing, such as its
`statement`, cannot cover the criteria it is associated with, so its own defect
and the coverage gap it causes can decide one refusal together. The
`obligation_definitions_incomplete` deciding cause then comes first and names
the selected unit, the `authored_inputs` stage and each open obligation from
definition readiness. Each diagnostic code is paired with the `field` its
semantic diagnostic reports in `problem.cause.field`. Every owner-explained
deciding cause carries a `summary` and an `explanation`. When all deciding
causes are explained, `admission.recovery_explanation` is the first cause's
explanation (with the query and fresh-CAS upsert) followed by the others'
summaries. The dispatch `next_action` is the summaries in the same order,
followed by the recovery carrier's selected-unit callable. The first correction
therefore amends that same obligation in place, keeping its identity, criterion
associations and case links. It is never a new obligation, an executable proof
selection or a proof run. Coverage stays incomplete until the obligation is
valid, and its denominator and uncovered identities follow as secondary facts.
A criterion no obligation names stays uncovered after the amendment.
`workspace_validate_dispatch` shows this explanation as its reason only when a
coverage cause also decides. Existing required records whose criteria have no
associations report incomplete coverage and recover through the same
query/upsert route; no association is backfilled from text.

### Incremental authored cases

Each amendment may include `case` with optional `case_id`,
`component: {type_term, identity}` or `{reference_id}`,
`target: {path, selector: {name, nesting}}` or the native target
`target: {provider: {provider_id, provider_version}, path, selector}`,
`observation: {kind}`, and
`falsification: {strategy, module_path, entry_export, operation, function_name, replacement}`.
Any known subset can be saved. Nested omission preserves supplied fields. An omitted case identity
creates one for a new obligation or edits its existing case; a case identity is supplied only to
choose a different or shared saved case, or to label a new one. Query returns
`case_id` and the exact `case_revision` with the saved fields.

The node:test target is the declaration-owned specialization described above.
A native target is one complete closed value owned by the case itself: the
installed candidate provider identity, one normalized repository-relative source
path, and one selection in the single selector member the provider's family
takes.

- Jest, Vitest, Mocha, AVA, Deno and lib0/testing take `selector: {title_path}`:
  the ordinary test titles as an array of strings, outermost first, with `path`
  naming the test source file once. For example
  `{"provider": {"provider_id": "launcher.mocha", "provider_version": "1.0.0"}, "path": "test/clamp.test.ts", "selector": {"title_path": ["clamp", "preserves in-range values"]}}`.
  Jest, Vitest and Mocha take 1 to 32 titles; AVA and Deno take exactly one;
  lib0/testing takes the `runTests` module key and the test function name. Each
  title is nonempty printable text of at most 1,024 Unicode scalars and is
  matched exactly, including quotation marks, backslashes and Unicode.
- Every other provider-qualified family takes `selector: {node_id}`: one literal
  native node identity in the family's `node_id_form`, whose source must equal
  `path`.

The provider's grammar owner validates the selection and derives the one
canonical test identity the case stores (at most 4,096 Unicode scalars, never
parsed as shell text or a pattern). For a title path that identity is composed
by the owner from `path` and the titles; it is not an authored value, and a
`node_id` submitted for one of those six families is refused with
`obligation_coverage_case_target_invalid`, naming `selector.title_path` as the
member to write. A refusal names the authored member in `details.field` and
states the provider's rule for it in `details.expected`. Absolute paths, `..`
segments, control characters, a source suffix the provider does not run,
provider or version mismatch, a selector member of another family and mixed
node:test and native fields are refused, and nothing is saved. The saved-contract
reads of `workspace_read_wiki` return each case target in this same authored
form, so a returned `provider`, `path` and `selector` save again unchanged;
`case_revision` and the stored identity are unaffected by the form a target is
read or written in. The native target is persisted once in the parent
case with `owner_unit` and never as a work-record `node_test` declaration; saving
it removes any ordinary declaration of that verification from the same unit.
Changing variant replaces the whole target, and only the existing owning unit may
change a native target, including replacing it with a node:test target. Query,
design validation, runtime binding and `workspace_verify_proof` resolve the same
case revision, provider, path and literal selector. A native case's falsification
uses `strategy: result_inversion` with `module_path`, `function_name` and one JSON
scalar `replacement`, including `null` (an amendment's `replacement: null` saves
null), that must be observably different from the original return; the installed mechanism
supports only a synchronous, undecorated top-level function whose body is one
scalar literal return, optionally after a docstring.

The guidance member `case_authoring` is the compact authoring table for
these fields, projected from the installed provider families and the enforced
case and falsifier schemas. `families` lists each family's languages, runner,
target variant, exact candidate `provider` identity, the form of the selector
member that variant lists (`title_path_form` or `node_id_form`) and source
suffixes, and names its falsifier mechanism. `falsification` lists, per
mechanism and strategy, the required and disallowed authored fields read from
the falsifier schema's conditional branches, the server-derived mutation fields,
and the mechanism's target constraint. `support_states` separates a lexical
proof candidate, an installed family, a save-accepted selector, a target whose
test existence and falsifier shape remain uninspected until
`workspace_verify_proof`, a demonstrated unsupported case, and an unresolved
fact. Saving and design validation do not inspect source files, so a saved
native case is not a claim that its test or falsifier target is supported.

`case_authoring.purpose` names the authored case members, `case.target`,
`case.observation` and `case.falsification`, and states that the derived
binding's `observable_result` comes from `case.observation`. A draft that omits
one remains an incomplete draft; the statement adds no requirement. The upsert
overview names the guidance member `authority`, which publishes one exact
selected guidance call per narrower decision: the case members, `component`,
`verification_association`, `falsification_support`, `target_variants`,
`observation`, and
`native_runtime_test_vocabulary.required_for_verification_method`. Each call is
an ordinary literal-path selection of the value's existing owner, bound by the
same source digest; the index holds calls, not rule text, schemas or catalogs,
and the broad members remain selectable. A selected family's facts come from
the family-selected answer the discovery route offers.

`case_authoring.observation` names its field, `obligations[].case.observation`,
states that an observation is an object whose `kind` classifies the observable
result the test inspects (assertion prose is not an observation value, and no
kind is a default), and carries `input_schema`: the enforced case schema's own
observation member, a closed object whose `kind` values are exactly
`native_runtime_test_vocabulary.observable_kinds`. It adds no requiredness;
omission and an empty object remain partial authoring, and `null` stays refused.
A request-schema refusal at that field or a descendant, such as a string, an
unlisted kind or an extra member, keeps its original issue, path and no-effect
result and offers one recommended, digest-bound selected call for that member;
identical rejections at several obligations share that one correction. Other
case fields with no bound location, including `case.target` and unknown case
members, still report `request_location_guidance_undeclared` and never receive
observation advice.

Case amendments distinguish omission from explicit clearing. Omission preserves
the saved value; a non-null value follows the ordinary amendment rules; null
deletes only these authored paths: `case.falsification`,
`case.falsification.strategy`, `case.falsification.module_path`,
`case.falsification.entry_export`, `case.falsification.operation`,
`case.falsification.operation.module_path`, and
`case.falsification.operation.export_name`. Clearing the last member of an
optional object removes the empty container, and clearing an absent field is a
combined-CAS no-op. Null is an upsert instruction and is never saved. Empty
objects do not clear values; saved definitions and native validation remain
non-nullable. Null does not clear case or verification identities, requirement
links, proof selections, parameters, targets, or shared parent/slice uses.

All amendments to a shared case compose before prospective validation. Repeated
clears and ancestor/descendant clears agree, while clear/set at one path and an
object clear combined with a descendant set refuse the complete batch regardless
of input order. If a strategy amendment would retain incompatible authored
fields, the refusal preserves every participant and returns the exact authored
paths and null corrections for one corrected retry. For example, changing
`forced_invocation` to `dependency_failure` while retaining both forced-only
fields requires `case.falsification.entry_export:null` and
`case.falsification.operation:null` in that same ordinary upsert. The server does
not discard those fields implicitly. Clearing required execution meaning may
save a quiet partial draft, but it does not make the case executable or invoke a
provider.

Use `case: {case_id}` to reference an existing case. Explicit new identities with
supplied meaning create independent cases. References to definitions authored in
the same batch work in either order. Contradictory amendments to one case field
reject the entire batch; disjoint amendments compose. Merely selecting another
implementation candidate never copies the case.

Parent and slice references express use. Editing the shared case through either
unit changes that one definition, checks every use, and preserves omitted fields
and unrelated targets. Conflicting executable target paths refuse; changing a
shared target requires its incumbent authorized owner. Foreign or ambiguous
canonical verification selectors also refuse.

#### Requirement replacement with retained cases

A requirement in `contract_requirements` that names `replace_claim_id` may also
list `rebind_case_ids`: a nonempty list of unique existing case identities.
Supplying the list without `replace_claim_id` is refused as
`obligation_coverage_request_invalid` at the request phase with the rejected
path. The requirement compiler alone produces the replacement requirement and
verification identities and decides what the replacement actually retires: the
old requirement claim when its identity changes, and each old verification that
no longer verifies a live requirement. A verification the replacement still
compiles survives with its identity. A verification that the replacement stops
using while another, unselected requirement still depends on it refuses as
`controlled_contract_requirement_correction_shared_verification` with the
verification and requirement identities.

Each listed case must exist in this work record (otherwise
`obligation_coverage_case_unknown` with the requested identities not found) and
must name a verification of the replaced requirement (otherwise
`obligation_coverage_case_selector_invalid` with condition
`unrelated_rebinding_case`). A listed case whose verification survives is
accepted unchanged. A case whose verification is retired adopts the replacement
verification, which must be a compiled `test_execution` verification replacing a
`test_execution` verification; otherwise the request refuses as
`obligation_coverage_case_rebinding_verification_incompatible` with the actual
methods. Every other case field, including component, target, observation and
falsification meaning, is preserved.

Selection is complete over every current case definition, including definitions
no obligation uses. When the list omits a case whose verification the
replacement retires, the request refuses as
`obligation_coverage_case_rebinding_incomplete` with the missing and complete
affected case identities, the current-query call and the registered guidance.
Without `rebind_case_ids`, a replacement that would strand a current case keeps
the strict `obligation_coverage_case_selector_invalid` refusal with condition
`stranded_case`. The server never adds unrequested case changes.

Rebinding composes with explicit case amendments in the same batch as ordinary
`verification_id` amendments through the shared-case owner. An explicit value
that disagrees, or two replacements assigning one case or one retired
verification different identities while a case, obligation link or executable
declaration in any unit uses it, refuses as
`obligation_coverage_case_shared_identity_conflict` with the conflicting paths
and values; valid simultaneous mappings, including cycles, apply at once.
Distinct cases converging on one verification keep
`obligation_coverage_case_verification_conflict` with the colliding cases.
Runtime-test meaning the replacement authors must agree with each retained case
after same-batch amendments compose: boundary subjects, kind and module path,
observable kind, selector, and falsifier strategy, module path, entry export and
operation are compared with the case and its derived system-under-test boundary
wherever both sides state them. A contradiction refuses as
`obligation_coverage_case_shared_identity_conflict` with condition
`replacement_runtime_meaning_conflict`, the case path and both values.

Every obligation link to the replaced requirement, and every link to a retired
verification that exactly one replacement maps, changes in the parent and every
slice source, whether or not cases are listed; unrelated links are preserved.
Executable `node_test` validation declarations naming a retired verification
change identity through the work-record target owner, keeping their target,
position, notes, unrelated identities and owning unit. Only the owning unit may
change a declaration: a replacement submitted through another unit that would
rebind it refuses before effects as `obligation_coverage_case_selector_cross_unit`
with `owner_units` and `selected_unit`; submit the replacement through the
owning unit instead. Remapping obligation links across units never authorizes
writing another unit's declarations. Native case targets keep
their provider, path and selector and gain no ordinary declaration. A rebound
identity declared by more than one unit refuses as
`obligation_coverage_case_selector_cross_unit`.

One answer still carries at most eight requirements. The case operation bound
of 64 counts each obligation case amendment plus each listed `rebind_case_ids`
entry; a case in both counts twice, and
`obligation_coverage_case_population_too_large` reports both counts, their sum
and the maximum. Every changed obligation source, including non-selected
slices, is validated against the draft schema and its row and byte bounds
before any effect. The combined revision, final comparison, compensation and
readback rules above apply unchanged, and reordering the requirements in a batch
produces the same result.

Replacement changes current identities only. Earlier entries, generations,
review evidence and authenticated proof receipts remain bound to their original
sources. A receipt produced before the replacement is not current evidence for
the replacement: presented against the new verification, contract or
generation it refuses as `verify_proof.evidence_cross_bound.v1`, even when the
case and test-proof identities are unchanged. Saving grants no execution,
proof, readiness or lifecycle credit.

The following is an explicitly incomplete obligation fragment, not a complete tool request.
For example, save `obligations: [{obligation_id: "OBL-ONE", proof_name:
"proof.verification.test-validity", case: {case_id: "case-component",
component: {type_term: "cc:runtime_component", identity: {kind: "repository_path",
repository: "example/repo", path: "src/component.mjs"}}}},
{obligation_id: "OBL-TWO", case: {case_id: "case-component"}}]`.
Later add observation, target, selector or falsification through either use.
Selected query reads the canonical authored meaning directly after restart.

Native execution validation and provider resolution remain strict. Partial
cases invoke no providers and earn no credit. Existing linked controlled claims
supply propositions; absent meaning stays unbound. Authoring never invents
requirement, observable or falsifying propositions. Verification consumes the
same saved case through the existing shared resolver without prior validation or
a caller-authored plan. Results bind the exact case revision, proof definition,
canonical carrier, deterministic derivation and authenticated candidate.

Cross-WK targeted verification first performs a bounded identity census over
the current obligation, authored-case and native test-proof identity fields. It
fully validates only the uniquely selected canonical tuple. A malformed
unrelated carrier therefore cannot veto a valid target; malformed selected data
still reaches canonical-source refusal, and identities found in more than one
WK refuse as ambiguous before any provider runs.

#### Requirement retirement

`contract_requirements.retire_claim_ids` is a nonempty list of unique stored
requirement claim identities, as query returns them, that the save retires with
no replacement. `contract_requirements` carries `requirements`,
`retire_claim_ids` or both, and their entries share the eight-entry answer
bound; obligation edits and `controlled_acceptance` may accompany them.
Omission never retires anything. An empty or duplicate list refuses as
`obligation_coverage_request_invalid` at the request phase, and an answer with
neither list or more than eight entries as `controlled_contract_requirement_invalid`.
A selection that is unknown, already retired (a fresh-digest replay), or a
verification claim refuses as
`controlled_contract_requirement_correction_target_invalid`; one that is also
replaced, or that a requirement in the same answer compiles, refuses as
`controlled_contract_requirement_correction_conflicting`. Each refusal names
the `retire_claim_ids[i]` path and the registered retirement guidance.

The requirement compiler retires each selected requirement and its `verifies`
edges. A verification retires only when no remaining requirement, including one
compiled in the same answer, still uses it; its native test proof and the
propositions and references no longer used leave with it. A shared verification
survives with its cases and declarations, as do residue and notes. A retained
non-`verifies` relation or collection that still names a retired claim refuses
as `controlled_contract_requirement_retirement_dependency_conflict` with the
relation or collection identities; a relation whose endpoints both leave the
contract leaves with them. No surviving claim, relation or collection is
deleted or rewritten to let a retirement pass.

Dependent uses are derived from the parent and every slice source. An
obligation is affected when one of its `controlled_contract_node_ids` or its
case's verification retires. It is deleted only when every link retires, its
case retires whenever it binds a verification, and the requirements those
identities support in the stored contract are nonempty and all retired.
Obligations with no retired link or case, including unlinked obligations, are
unchanged. Every other affected obligation, and every affected obligation the
same save amends, refuses the whole save as
`obligation_coverage_requirement_retirement_use_conflict`: each conflict names
its unit, obligation, case, retired identities and `condition` (`mixed_use`
with the surviving links and requirements, or `amended_use_retires`), up to 32
conflicts with the exact `conflict_count`, plus the current-query call. An
ordinary amendment of that obligation's links or case in the same save that
drops the retired identities resolves a mixed use.

Cases bound to a retired verification are deleted once their uses retire,
including cases no obligation uses and native cases with their targets;
unfinished cases and cases of surviving verifications remain. Executable
`node_test` declarations drop retired verification identities through the
work-record target owner, keeping each target, position, note and unrelated
identity and deleting only an emptied declaration. Only the owning unit may
change them: a retirement submitted through another unit refuses before effects
as `obligation_coverage_case_selector_cross_unit` with `owner_units`,
`selected_unit`, only the foreign-declared `verification_ids`, and each
offending selection in `retirement_selections` (`retire_index`, `claim_id`).
Each retired case counts toward the case operation bound of 64
and is reported as `retirement_operation_count`.

Retiring the final requirement is refused by the carrier owner as
`controlled_contract_carrier_validation_failed` with `empty_contract`; proof
posture is never changed or opted out. The combined revision, final comparison,
compensation, indeterminate-failure and committed-readback rules apply
unchanged, and selection order does not change the result. The receipt adds
`requirement_retirements` with each selection's input index, claim, retired and
surviving verification identities, plus `retired_obligation_count` and
`retired_case_count`; query is the complete read-back. Retirement changes
current state only: entries, generations, review evidence and proof receipts
keep their original bindings. Obligation removal remains the separate row or
selection deletion that preserves requirements.

## Current public boundary

Manual acceptance-axis authoring is no longer a public MCP workflow. The
canonical current inputs are contract requirements, explicit
controlled-acceptance applicability, and the obligation-to-proof map.

Criterion coverage and the internal acceptance-axis carrier are separate facts.
Coverage is read from the current criterion associations on valid obligations
and can be complete while no acceptance-axis carrier exists. That absence, and
every other acceptance-axis row, is an owner observation: its semantic cause is
`inspection_only`, carries no response form, repair authority or write, and is
identical in the workbench, the assessment summary and a selected diagnosis.
It stays reported and incomplete; saving obligations does not repair it and no
carrier is created to clear it. Missing statements, criterion associations and
proof choices remain authored corrections through their own owners.

Applicability-only correction instructions name `controlled_acceptance.disposition`
and the current revision; they do not teach unrelated obligation, case or proof
editing. The caller supplies the authored choice. Summary, unselectable-inventory
and selected-diagnosis recovery each supply their own supported recipe. That
recipe may request a focused current context for its known member; its schema
identity and safe held-instruction reuse rules are described in
[selected response details](mcp-selected-response-details.md#navigation-to-the-selection).
Declaring applicability supplies no missing meaning or evidence and establishes
no readiness verdict.

Use direct bulk selections for known authored meaning, including
`workspace_read_wiki({reads:[{subject:unit,select:{contract:"coverage"}}]})`.
Request `for_changes` on a read only when a current write context is needed;
plain reading supplies no write revision. Save supported authored changes with
`save_record({unit, revision, changes})`, using `contexts[unit].revision` from
an explicit write context or a successful mutation's returned revision and
the serving tool's typed work-item changes schema. Existing obligation and case
rows use `id`; new rows use `key`. Obligation associations use semantic
selectors in `criteria` and `claims`, or the appropriate same-request `$key`;
proof choices and parameters use `proof.name` and `proof.parameters`.
Requirements are authored as the one `changes.requirements` batch
(`entities`, `requirements`, `collections`, `unresolved`), which the host's
paid tier alone serves; its members, row identities, source links and readback
are stated in
[Controlled contract operations](mcp-controlled-contract-operations.md). A
requirement label in an obligation's `claims` names every behavioral claim its
row emits; generated compiler identities are not public association inputs.
A refused save publishes the owner's refusal details with the authored `field`,
the identities the owner considered, its correction and its next calls. It never
publishes a `guidance_path`, the owner's internal location of a guidance member.
Where that member is part of the requirement-authoring guidance below, the
details carry `guidance_call` instead: the `workspace_read_wiki` call that
focuses that member. A term outside the requirement vocabulary (a modality, a
relation, a verification method, an entity type) is refused by the batch's own
declaration before anything is compiled: the refusal names the member, states
the values accepted there, and writes nothing. A location outside the published
guidance is dropped with no call.

### Requirement-authoring guidance

`save_record`'s advertised description states the entry call
`workspace_read_wiki({reads:[{subject:{requirement_guidance:true}}]})`. It needs no
saved requirement, obligation or selected proof. For the accepted terms of a
requirement it also states the focused call
`workspace_read_wiki({reads:[{subject:{requirement_guidance:true},select:{guidance:["vocabulary"]}}]})`,
which reads the `vocabulary` topic directly. The declaration itself
carries no vocabulary. `{contract: true}` still names the repository manifest.

The entry's ordered result contains compact context with a `reference` and
available `selections`, including `{guidance:[<member>,...]}` topics. Choices
share a `selection_context` template; the entry recommends no default topic.
Read a known topic directly, or use `{reads:[{reference,select}]}` with an issued
reference and chosen selection. A selection is delivered whole through the reader's ordinary
selected delivery, and a path may name any nested member by literal segments,
for example `["vocabulary", "modalities"]`. An optional `topic` on the subject
selects that member directly when `select` is omitted; a save refusal's
`guidance_call` uses this form. A path that names no member refuses with
`requirement_guidance_topic_not_found` and the entry call as its correction.

| Topic | Content |
| --- | --- |
| `save_record_inputs` | `members`: which `changes` member takes each saved identity a contract read returns (`owner_field` is the member the unit's `{contract: "obligations"}` or `{contract: "cases"}` selection returns, read and never authored; `save_record_field` is the member that takes it), with the three new-row labels; `not_authored_here`: requirement notes and residue are not authored through `save_record`; how `key` labels and `$<key>` references bind rows in one request, and `associations`: how an obligation's `claims`, `criteria`, `proof.name`, `case`, `case.verification` and `case.id` associate it with a requirement, a criterion, a proof and a test case, each by the owner's own rule, and `slice_coverage.steps`: the order in which a slice gets coverage of its own. |
| `fields` | The owner's explanation of `subject`, `behavior`, `verifier`, `observes` and `fails_when`, with the shape each takes. In a save each names its entities by the ids the batch declares under `entities`. |
| `required_object_shapes` | The referent, statement and verification shapes, with requirement replacement and retirement stated by the current save inputs: a corrected requirement claim is `changes.requirements.requirements[].id`, kept cases are `changes.requirements.requirements[].rebind_case_ids`, retired requirements are `changes.remove.requirements`, and whole saved rows are restated by `changes.requirements.requirements[].row_id` or removed by `changes.remove.requirement_rows`. The underlying operation keeps its own input names; this guidance does not publish them. |
| `vocabulary` | Every accepted term: modalities, natures, verification methods, type terms, identity kinds, applicability modes and relation signatures. |
| `requirement_schema` | An index of the complete requirement batch grammar. Select `["requirement_schema","birth"]` before creation or `["requirement_schema","existing"]` for saved rows; append a returned definition name for that root and its complete transitive references. `workspace_create_record` defers `initial.requirements` to the birth selection and still validates the whole batch. A coherent creation can instead read every needed initial member together through its kind's selected `input_contract`. |
| `unresolved_coverage` | What to author when a proof, family or falsifier is missing, its record naming each obligation field by the `changes` member that carries it (`claims`, `proof.name`), with calls to the case-authoring and input-mapping topics and the `workspace_find_proofs` route, whose query is the author's own. |
| `conditional_verification_requirements`, `runtime_test_authoring`, `native_runtime_test_vocabulary` | When a verification is required and how its runtime test is stated. |
| `case_authoring` | The test-case members: verification association (`changes.obligations[].case.verification`, eligible through `changes.obligations[].claims`), component, target, observation and falsification. Each listed family keeps its provider identity and version, runner, source suffixes, selector form and `target_variant`, which names its entry in `target_variants` with the target fields and `path_owner`. Each falsification strategy lists the fields an author writes and may not write; what the save derives is not listed. |

A parent's obligations, criterion labels and coverage transfer nothing to a
slice: a slice is covered only by obligations saved on that slice unit.
`save_record_inputs.slice_coverage.steps` states the sequence for a slice
whose criterion an already saved parent requirement and test case show:

1. Reuse held slice criterion selectors and a current write revision. If the
   revision is missing, request `for_changes:["obligations"]` on the slice read;
   include only needed selections. To obtain missing criterion meaning too, use
   `workspace_read_wiki({reads:[{subject:"work record",select:{contract:"criteria"},for_changes:["obligations"]}]})`.
   Use `results[0].value.members[].selector` for the criterion and
   `contexts["work record"].revision` for the save.
2. Reuse held parent requirement selectors and saved case identities, or include
   the parent's `{contract:"requirements"}` and `{contract:"cases"}` reads
   in the same bulk call to obtain missing meaning. No catalogue or context
   read is required before known semantic selections.
3. Save the slice's own obligations on the slice unit at the slice's revision.
   No requirement and no case body is restated, so neither is duplicated.
   A proof-backed obligation names `claims`, the applicable saved `case.id`,
   `criteria` and, in `proof.name`, the proof that case verifies. An obligation
   that selects no proof stays saved as an undecided draft and covers no
   criterion.
4. Assess that exact slice with `workspace_assess_contract({unit:
   "WK-NNNN#SLICE-NNN"})`.

Whether a parent requirement applies to a slice criterion is
the author's judgment. Nothing is inherited, copied or inferred, parent coverage
is unchanged by a slice save, and mechanical completeness is not a statement
that the association is semantically adequate.

Accepted terms and their definitions have one owner, the controlled-contract
requirement guidance derived from the contract schema; the reader publishes
those members unchanged and adds only the `save_record` mapping, the
associations between its members and the overview. No topic is a worked
example: `proof.name` selects the checking route, and `case` supplies the test
details only when the selected proof's own `workspace_find_proofs` authoring
answer requires them. Reading guidance writes nothing,
and neither it nor a save executes a proof or grants execution credit.

The `requirement_guidance` source and its `guidance` selection are granted
through the central policy's `read_selections` to the roles that hold
`save_record`: orchestrator and operator. The reader declares the subject form
and the selection only to a granted role.

`workspace_assess_contract` projects correction guidance through those public
owners. Independent criterion, bootstrap and accounting corrections live in
`gaps`; a selected diagnosis carries only its own correction. The public shape
is described in [Public contract assessment responses](#public-contract-assessment-responses).
Each correction keeps the required authored input, affected subjects and
meaningful constraints. Its exact current read is a `next_calls` entry with
`purpose:"current_correction_context"`.
When a diagnosis's subjects reference correction definitions,
`required_authored_input` lists exactly the authored `save_record` members those
definitions name, each subject states its own `missing_authored_input` (the
member, and the operation when the definition implies one) beside its obligation
and case identities, and `constraints` repeats the definitions' owner
constraints. These name where the caller's authored value goes; they never
supply the value, select a proof or case, or address a storage or binding path.
A subject whose owner states a `discovery_input` awaits a proof selection and is
an authored correction even when its category is unclassified:
`required_authored_input` lists `obligations[].proof.name` rather than the saved
carrier's `field`. The fact becomes `discovery`, one entry per distinct input.
A property query is the caller's, so its entry is `{tool:
"workspace_find_proofs", executable: false, missing_caller_input: ["query"]}`
and carries no arguments; a saved proof name is a complete `{tool, arguments:
{proof_name}}` read. Assessment supplies no query, proof or parameter.
Selecting a proof clears only the unselected diagnosis; what the chosen proof
itself still needs remains reported.
A gap carries its save recipe in `save_guidance`. Selected diagnoses carry
correction-specific instructions in each entry's `save_guidance`, with revision,
schema and conditional reassessment shared once in `correction_contexts[unit]`.
A frozen, focused or unavailable correction has its
limitation instead of a save recipe. No result embeds a copy of the
`save_record` changes schema; the serving tool's published schema is its owner.
The current read is executable; the save guidance awaits caller-authored values
and that read's revision, and is never an executable correction. Missing
applicability, statements, criterion associations, proof choices and parameters
remain missing until the author supplies them. For
`controlled_acceptance_disposition_missing`, the caller chooses the declaration
through the selected schema. The ordinary authoring operation accepts
`changes: {controlled_acceptance: {disposition: "required"}}`. Save those
changes with the current-context revision. Assessment never supplies a revision
or chooses an exemption. Saved exception-binding gaps use their existing
exception-schema selection to preserve the saved decision and scope. Frozen or
focused limitations offer no authoring route.

Parent source-accounting gaps preserve the missing passages and repeated
occurrences needed to correct their source links. Their current correction
read supplies the write revision and authentic schema reference. Assessment
supplies no retained current-requirements reference or automatic full reread.

Original diagnosis and inventory calls return immutable assessed facts after
source movement, with a material currentness qualification when needed. They
supply no current write revision. A complete answer offers no automatic
historical reread; supported authoring uses the returned current correction read.

Malformed assessment requests retain the shared validator's deciding constraints,
accepted members and accepted field locations. Diagnosis reads require
`original: {source, diagnoses: [{diagnosis_id, obligation_id?}, ...]}`; the
complete inventory uses `original: {source, view: "diagnoses"}` exclusively.
A refusal may return a schema-validated corrected call for misplaced current
members or a single selection object supplied instead of its array. It preserves
the supplied source, order, restrictions and scope; it does not run or authenticate
the correction. Missing values, unknown spellings and conflicting choices require
caller input. No alternate spelling is accepted by the tool.

Incomplete criterion coverage retains the current authored criterion meaning and its
affected obligation associations. Missing or stale links offer current authoring
context and one mixed read of criteria and obligations for explicit caller choice.
Current links to invalid obligations instead point to those obligations' content
diagnoses; repairing the component, statement or other actual defect preserves the
links. Unavailable validity remains uncertain and establishes no authored-content
correction. A retained assessment without those cause facts supplies no invented
association fix. Conditional reassessment preserves the original scope; successful
save needs no compulsory read or reassessment.

The coverage gap's `criteria` contains `{criterion: {text, typed_identity?},
associations: [{obligation_id, association, validity}]}`. Association is `current`
or `criterion_text_changed`; validity is `valid`, `invalid` or `unavailable`.
An empty association list means no saved link to that current criterion.
`removed_criterion_associations` separately identifies obligations whose saved
criterion is absent. These are cause facts; reusable correction selectors come
from the returned `criterion_association_choices` bulk read's ordered criteria
and obligation results. A large summary points to the existing complete retained
diagnosis inventory for every coverage cause; populations are not truncated.

Frozen reviewers retain their source and population boundaries and receive no
authoring permission. The current save schema addresses root and slice units,
but has no focus argument: correction of a named focused contract is explicitly
unsupported, and must never be redirected to the root contract.

Semantic completeness, author-declared criterion coverage, execution capability,
dispatch status and proof satisfaction remain separate facts. Assessment and
original reads execute no proofs and grant no credit; a capability owner's
failure keeps its originating cause and does not become an authored defect.
Removing a proof selection preserves the obligation and shared or sibling case
meaning.

Source-present assessment also reports `specification` from the requirement
description owner, separately from obligation accounting and criterion coverage.
Its status can be incomplete while every obligation is accounted and coverage
is complete. The same definition assessment and selected source/closure feed
ordinary authoring readiness and the shared complete-contract verdict. Established
missing definitions keep that verdict incomplete even with valid obligation
accounting and complete criterion associations. Draft saves remain allowed;
assessment is a convenience reader, and its retained result grants no dispatch
authority. Paid implementation dispatch consumes that current verdict through the
existing readiness refusal. The free tier retains its existing refusal boundary:
contract incompleteness and definition findings remain visible, while
specification insufficiency alone does not refuse dispatch. Enforcement uses only
the serving host's captured tier, independently of proof execution or credit. The
private specification assessment's `authored_meaning`, `lowering` and `source_resolution` distinguish
missing definitions, unsupported lowering and unavailable definition source;
unavailable capability or source does not establish omitted authored meaning.
The public diagnosis choices keep deciding cause and affected identities;
selected details add public declaration targets, authored meaning, uses and typed correction
meaning needed to act. Retained diagnosis selections preserve
those captured facts after repair and restart without resolving definitions again.
Whole-unit findings need no obligation; slice and selected-obligation findings
use only their linked requirement roots and needed definition context.

Definition diagnoses offer `workspace_read_wiki` inspection and, where supported,
`save_record` guidance for caller-authored `requirements`. Definitions belong to
the parent specification even when a slice obligation reaches them: the correction
explicitly names that parent and leaves slice obligations untouched. Follow the
current bulk read for its explicitly requested `contexts[unit].revision` and
schema calls. One-item acquisition uses `reads:[Read]`; `for_changes` belongs
on that Read. Gather required meanings and write contexts in the same request,
then supply the
intended typed definition through the serving save schema. The assessment supplies
no replacement meaning or executable save. Frozen authority grants no write;
named focused-contract correction remains unsupported. Historical retrieval is
never a repair or current write revision.

An aggregate saved-authoring stage is an inspection observation; its owner codes
identify the cause but establish no independent obligation correction. Definition
recovery keeps the affected object, required meaning and applicability, and
semantic requirement selections in its nested subjects. Identity corrections
retain the supplied and bound repositories and require the caller's explicit
intent; an intentional foreign reference is never rebound automatically. Each
affected use names its public target and authored field path. Append-only
definition guidance supplies the entity meaning and accepted authoring shape;
the caller authors its value or behavior. Compiler row/claim/reference addresses
are not correction inputs.

Case replacement, rebinding and retirement refusals preserve the deciding
condition, affected public cases/obligations/units and semantic declarations.
Their bulk read supplies the selected dependencies and requested write contexts;
the caller explicitly supplies compatible amendments or retained case selections.
Missing/ambiguous targeting remains a refusal. A failed association diagnosis
preserves the original cause and states unavailable correction, without choosing
a replacement or retrying. Reads execute no replacement or repository checks.

Authorized authoring guidance emits
`grammar_guidance` calls to the existing `required_object_shapes`,
`authoring_vocabulary` and `save_record_inputs.requirement_batch` topics. Follow
each context's complete selection for statement shapes, accepted vocabulary and
the save mapping. Reading guidance supplies no definition and repairs nothing.
When a correction identifies one row definition, its `accepted_schema` call names
`["requirement_schema","existing",<definition>]` and delivers that root with its
complete local reference closure. A correction needing multiple row roots keeps
one complete batch route, including an alternative that specifies new behavior
and its typed input, result and condition definitions. An ordinary object can be
described by a normative row as well as a typed definition; that correction keeps
both forms available in the combined batch grammar.

Acceptance-coverage evaluation, identity comparison, rebase planning, and
transaction participation remain internal where readiness, persistence, or
integrity owners consume them. Their internal schemas and functions do not
create a caller-managed mapping lifecycle.

If assessment succeeds but retaining its selected detail fails, both fitting answers and delivery refusals preserve the native cause and the known completed-assessment/no-write/no-proof effects. They offer no invented detail binding or unchanged assessment retry. Transport stacks, storage receipts and successful check inventories remain internal.

Missing applicability and required specification remain independent correction choices when obligations already exist. Assessment retains those causes alongside obligation diagnoses; creating an obligation neither supplies an applicability decision nor removes its authored correction route.

# Controlled-contract operations

The public MCP surface exposes semantic proof authoring, inspection, validation,
and verification. Callers author requirement and obligation meaning directly;
they do not construct carriers, proof graphs, bundles, plans, or publication
sessions.

Orchestrators MUST be able to use these operations through tool discovery,
input contracts, targeted tool guidance and operation responses alone. Those
surfaces must explain the required inputs, their relationships, derived values
and supported corrections. Documentation, FAQ access and agent-chassis source
inspection must not be prerequisites or required recovery paths. Missing
operational information is a tool-interface defect; optional explanatory
material does not discharge this requirement.

## Public operations

The current registered family contains these operations:

- `workspace_controlled_proof_intents_discover` discovers package-owned named
  proof intents. A query returns bounded pages of compact ranked candidates, no
  query browses the catalogue compactly, and selected detail returns one
  candidate's complete scope.
- `workspace_controlled_contract_obligation_coverage_upsert` atomically saves
  one or more obligation changes. The same ordinary mutation can save
  contract-level requirements and the controlled-acceptance disposition.
- `workspace_controlled_contract_obligation_coverage_query` reads the
  saved obligation map and complete requirement meaning, every linked
  verification included, from the caller's authenticated source. It returns a
  whole result that fits one frame, otherwise a compact summary (default) or the
  first page of complete retrieval (`view: "complete"`), with retained `detail`
  pages. It supports direct `obligation_id` reads, exact `parameter_detail`, and an
  `inventory` view that lists each obligation with its complete statement for a
  caller that does not yet know which obligation to read. A managed worker reads
  its assigned unit's contract through it.
- `workspace_controlled_contract_obligation_coverage_remove` requires an
  explicit `removal_scope`: `selection` removes only the saved proof selection
  while preserving the obligation for reselection, and `obligation` deletes
  the complete obligation row. Both modes preserve contract requirements,
  shared case definitions, sibling uses, and historical evidence.
- `workspace_validate_proof` diagnoses saved authoring without executing a
  proof provider. Its compact default assesses authored validity and the
  selected route and indexes the actionable issues; `diagnostic_group_id` or
  `obligation_id` returns one selection's typed diagnosis.
- `workspace_verify_proof` resolves and executes the saved proof map against
  the exact selected candidate.

Contract-level requirement meaning and explicit controlled-acceptance
applicability or exemption rationale use the same ordinary upsert, query, and
validation operations. There is no separate preparation route or prerequisite.

Discovery ranks candidates by the property the query describes. Query terms are
normalized words; each matched term contributes, once per source kind that
contains it, that kind's weight times its inverse document frequency among the
admitted candidates for that kind. Assertions, intent definitions and
constraints weigh 2, proof names, intent identities and discovery terms weigh
1, and exclusions weigh 0. A term every candidate carries at one kind, such as
shared constraint grammar, contributes nothing there. Candidates are ordered by
match tier, then relevance score, then identity; the package result reports
each candidate's score, matched, unmatched and semantic terms, and every match
reason.

A query word that is exactly a single-word identity term of a listed test
provider family (a language, toolchain, runner, ecosystem or family name) is
provider context, not relevance: it is reported in `provider_context` and
`ranking.provider_terms` and never changes the order, so one property phrased
for Go, Rust, JavaScript or no provider ranks identically. `provider_context`
is `identified` when the terms fit one family, `ambiguous` for several,
`conflicting` for none, and `unspecified` when no such term appears.
Unrecognized words stay ordinary query text and are never treated as an
unsupported provider. A query with only provider terms matches no proof.

The MCP call accepts an optional `query`. With one, it snapshots the package's
complete ranked matches and returns the first page of them; without one, it
returns the first page of the listed catalogue. A query never appends
unmatched proofs, and zero lexical matches is not proof absence: that page
offers the compact browse call. Pages use the selected-response complete-frame
class, `min(WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES, active inline limit)`
(currently at most 8192 UTF-8 bytes across both MCP carriers), and carry exact
`total`, `returned` and `remaining` counts with a source-bound `continuation`
that reaches every omitted match in the same order. Continuation is optional:
no page has to be read to follow a row already shown.

A candidate row is compact: `proof_name`, the associated `intent_ids`, the
query's `match_kind`, the `essential_limitation` the query words touch (or
null, which never means the proof has no exclusions), the
`verification_capability` when the proof declares one, and a `detail_action`
for its selected detail. Rows never carry every candidate's assertion,
exclusions, parameter contracts or provenance. The first page adds `authoring`
once: `population` distinguishes query matches from the listed catalogue,
`scope` states whether matches remain unread, `row_meaning` states what each
row field means and that rows are ordered by match tier (so no later row has a
higher tier), and `next_calls` names the obligation-coverage guidance
selections for `case_authoring` and `unresolved_coverage`. Continuation pages
omit `authoring`.

Four facts stay separate, and the response never collapses them:

- **Query recognition.** `authoring.provider.query_recognition` is the package's
  `provider_context.status` under a name that says what it is about. It reports
  which listed family the QUERY NAMED. `unspecified` means the query named
  none, never that the catalog lists none, and the published
  `recognition_meaning` says so.
- **Catalog listing.** `listed_families` is the provider catalog's
  own population, published beside recognition on the first candidate page
  and the selected detail that carries
  provider facts and never derived from the query. It is a catalog fact, not a
  statement about what the execution environment can run; discovery reports no
  such statement at all. When recognition identifies
  one family, its complete case-authoring facts are inlined; otherwise
  `missing_selection` names the exact input a per-family lookup needs.
- **Proof applicability.** Provider facts appear only where a candidate declares
  a test-execution verification capability, published per row as
  `verification_capability` and taken from that proof's own admitted profile —
  never from a proof name or a language. A page with no such candidate
  carries no provider verdict; the gap route remains available.
- **Target support.** `not_established` repeats the authoring owner's own
  support states: a lexical match is not a capability fact, a listed family
  is not a target fact, and test existence and falsifier target shape are
  checked only when `workspace_verify_proof` runs.

The exact detail of a candidate that declares a verification capability carries
its own `authoring` route: the capability identity, the compact provider
facts, `target_shape_limits` (the mutation accepts only the shape its mechanism
states, and production code is never reshaped to fit it), and the targeted
calls for `case_authoring`, `falsifier_limits` — the mechanism's own
`target_constraint` — and `unresolved_coverage`. A candidate that declares no
such capability advertises no authoring route and makes no claim either way.

Selected proof detail preserves the admitted assertion and exclusion rows, then
appends each associated intent's existing distinction as
`{comparison: {intent_id, from_intent_id, explanation}}`. These source-exact
comparison rows are usage guidance, not additional admitted guarantees. A
candidate's detail is what a caller reads before binding it: a row is a
lexical candidate, not a selection. Direct `proof_name` lookup and row-emitted
detail actions expose the same exact detail population under the same
complete-frame class; wide detail pages, and field and range reads retain long
explanations losslessly, with range admission and emitted range continuation
sharing one scalar-range size.

## Ordinary authoring

Start by reading the selected unit:

```json
{
  "unit": "work record"
}
```

The query returns the current content digest, saved obligations, requirements
and their deduplicated `references`, or, when the result exceeds one frame, a
compact summary whose `next_calls` retrieve it. Requirement selectors resolve
against the response's `references` population; each needed definition is
returned once. Each requirement's `meaning.verifications` lists every linked
verification; an upsert restates one of them as `verification`. Use that digest
in the next mutation. An upsert may contain
any supported combination of nonempty obligation edits, contract requirements,
and a controlled-acceptance disposition. The server compiles typed requirements
and applies the disposition through their existing owners before one atomic
settlement.

```json
{
  "unit": "work record",
  "expected_content_digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "contract_requirements": {
    "requirements": [
      {
        "modality": "MUST",
        "subject": {
          "declare": {
            "type_term": "cc:runtime_component",
            "identity": {
              "kind": "repository_path",
              "repository": "example/repo",
              "path": "src/example.mjs"
            }
          }
        },
        "behavior": {
          "relation": "boolean:exists",
          "objects": [{ "boolean": true }]
        },
        "verification": {
          "method": "test_execution",
          "verifier": {
            "declare": {
              "type_term": "cc:test",
              "identity": {
                "kind": "repository_path",
                "repository": "example/repo",
                "path": "tests/example.test.mjs"
              }
            }
          },
          "observes": {
            "relation": "boolean:exists",
            "objects": [{ "boolean": true }]
          },
          "fails_when": {
            "relation": "boolean:exists",
            "objects": [{ "boolean": false }]
          }
        }
      }
    ]
  },
  "controlled_acceptance": {
    "disposition": "required"
  }
}
```

This example declares a verification plan without an executable binding. The
mandatory behavior includes its required verification, and the test path names
the intended verifier without asserting that the test exists or has run.

An exemption is explicit:

```json
{
  "unit": "work record",
  "expected_content_digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "controlled_acceptance": {
    "disposition": "opted_out",
    "rationale": "The record contains no implementation behavior."
  }
}
```

An empty exemption rationale, a stale digest, an invalid typed requirement, or
an invalid combined obligation edit is refused before effects. The server does
not translate former response-kind payloads or infer an exemption.

Obligation edits use semantic inputs such as `obligation_id`, statement,
named proof, mechanism, controlled-contract node identities, and typed case
meaning. Incomplete cases may be saved atomically. A successful save receipt is
quiet and contains the unit, new content digest, and saved/unchanged counts.

### A verification plan and its executable binding are separate

A `test_execution` verification states what a test establishes: its verifier,
the proposition it observes, and the concrete contradictory behaviour that
falsifies it. That meaning is what authoring saves, and it is complete on its
own. `verification.runtime_test` is the additional executable binding: supplying
it requires the complete per-strategy object and binds the test a launcher runs;
omitting it saves the plan with no executable binding and mints no test proof.

Authoring and implementation admission therefore never require an executable
proof-catalog selection, a native test binding, an installed executor or a
falsifier target the installed providers support. A saved plan whose test does
not exist yet, or which no installed provider can run, is still saved, read back
and admitted. `workspace_verify_proof` refuses to execute it, with its own
reason code, until the binding exists — and authoring success is never execution
evidence. Genuinely absent meaning is still refused: a mandatory behaviour with
no verification, a verification missing its falsifying condition, an obligation
with no statement or one naming a node the current contract does not carry all
keep their existing refusals and diagnostics.

To replace a requirement while keeping the authored cases that verify it, give
that requirement `replace_claim_id` and list the retained cases in
`rebind_case_ids`. The server generates the replacement identities and updates
the listed cases and live links in the same settlement; see
[Acceptance-coverage MCP](acceptance-coverage-mcp.md#incremental-authored-cases)
for the complete selection, link, bound, and refusal rules.

To reduce scope, list the stored requirements to retire in
`contract_requirements.retire_claim_ids`, with no replacement. The same
ordinary upsert retires their now-unused verifications, the parent and slice
obligations whose support is entirely retired, their cases and the selected
unit's test declarations. It refuses mixed or amended uses, another unit's
declarations and retained semantic dependencies before effects; see
[Acceptance-coverage MCP](acceptance-coverage-mcp.md#requirement-retirement).
Obligation removal never retires requirements.

Proof-plan consumers distinguish canonical storage identity from compiler input
identity when authored cases exist. The request skeleton and proof-plan compiler
read the contract derived by the canonical case owner, while continuation, CAS,
manifest and publication checks remain fenced by the raw canonical carrier and
its digest. Case publication validates the prospective case/native-retirement
state atomically and invalidates a plan compiled from older case facts. The
derived native binding is never written back as a second case definition.

## Query and restart

Query resolves the canonical selected source on every call. A fresh MCP process
reading the same repository returns the same contract inputs, case identity,
case revision, obligation selection, and combined source revision. Selected
reads use the same public query and do not require a separate native-proof,
reference-resolution, or carrier route. When `obligation_id` is supplied, the
requirement projection contains only requirements associated through that
obligation's controlled-contract node closure and the canonical reference
definitions needed to understand them. Its selection counts report the complete,
returned, and omitted requirement populations. An unselected query retrieves the
complete requirement population.

Subject, applicability-context, behavior-operand, verifier, observation,
failure-condition, and runtime-boundary reference identities are checked during
projection. A missing definition or one identity with inconsistent definitions
returns a projection-phase mechanical diagnostic with the affected field, claim,
population, and identity instead of returning incomplete semantic meaning.

If the obligation source is absent, query reports `source_absent` while still
returning any saved contract inputs. Absence is a source fact, not an offer to
enter a construction workflow.

The combined revision covers every participant of the work record's authored
proof state: the obligation source of the record and of every slice, the native
contract carrier set, the validation targets of the record and of every slice,
and the proof posture. For the selected unit, `content_digest` in query and
validation results, `contract_inputs.revision`, and the digest the upsert and
removal CAS compares are that one value. It is `null` only when none of those
participants exists anywhere in the record, so a slice-only source or target, a
contract without obligations, or a proof posture alone is a present state with a
nonnull revision. A source-only digest is never substituted for it. A stale or
raced revision is refused before any effect; read the current revision again
instead of retrying with a derived value.

## Validation and correction

`workspace_validate_proof` reads the current saved meaning and returns a compact
assessment (`proof-validation-assessment.v2`): authored validity counts, the
separate selected-route prerequisite stages, independent owner failures,
execution `not_started` with zero proofs and credit, dispatch `not_assessed` with
the `workspace_validate_dispatch` call, acceptance-coverage counts, named
diagnostic totals and a bounded issue index. Each issue names its owner meaning
(stored once when equal), subject and occurrence counts, bounded affected
obligations with exact omissions, and its exact `diagnostic_group_id` call. That
call, or an `obligation_id` selection, returns a
`proof-validation-selected-diagnosis.v1` answer with the selection's subjects,
typed failed fields, correction clauses and any addressed correction call at the
current revision. Every answer fits the complete-frame compact class; none is
paged, spilled or continued, and omissions are counted exactly. The
[acceptance-coverage protocol](acceptance-coverage-mcp.md) owns the complete
response contract. Validation does not run tests or other proof providers. Contract-input
problems, missing obligation sources, incomplete cases, unknown proof names,
invalid parameters, and association conflicts retain distinct codes and
responsible owners.

Every diagnostic is assessed against the exact selected route as `blocking`,
`nonblocking`, or `unresolved`. Row validity, aggregate validity, and diagnostic
counts follow that assessment rather than requiring an empty diagnostic list.
A complete provider-bound test route may therefore retain unavailable generic
constructor and dependency metadata as explicitly nonblocking context; those
generic capabilities remain unavailable and are not claimed as implemented.
Required missing inputs, invalid or stale identities, required owner-capability
failures, and unknown applicability remain attributed to the route and stage
they affect. A capability failure may prevent executing the selected proof; it
does not gate authoring or implementation admission. A complete semantic plan
is not made incomplete by the absence of an executable binding. Supplied
malformed identities and genuinely missing required meaning retain their
semantic or integrity diagnostics.

A carrier-validation refusal states each diagnostic fact once. Its `diagnostics`
envelope is the bounded projection; a row carries the slots its diagnostic
actually has, so a fact the diagnostic does not carry is absent rather than a
null, an empty string or a zero, and anything the projection's closed vocabulary
cannot name — a duplicate reference identity's `identity` and `reference_ids`,
for example — is republished under that row's `owner_facts`. Because the rows now
carry every fact their sources carried, the refusal publishes the second complete
copy only when the projection lost something: when `diagnostics.truncated` is
true or `omitted_count` is above zero it carries `diagnostic_details` as before,
and otherwise it carries `diagnostic_details_omitted` naming the reason and the
diagnostic count. The projection version is
`controlled-contract.bounded-diagnostic-projection.v2`.

The ordinary result identifies the selected route and its authored-input,
canonical-source, system-capability, and execution-evidence stages. Group and
detail reads preserve exact effects, causes, definition identities, affected
obligations, counts, and currentness. Validation reports execution as not
started with zero credit. It reports dispatch as not assessed and identifies
`workspace_validate_dispatch` as the independent structural owner; it neither
grants dispatch nor makes that call mandatory for ordinary saves.

Correct a diagnosed problem with one ordinary upsert using the current digest.
Validation is explicit feedback; it is not a preliminary write gate. When a
boundary lacks enough identity to construct a callable correction, it reports
the missing capability or source precisely instead of inventing arguments. If
the responsible owner supplies no supported recovery, the result says recovery
is unavailable and does not manufacture an input edit, constructor project, or
callable repair.

## Removal and shared meaning

Removal targets one obligation identity and the current content digest. It
removes the selected proof application for that obligation. It preserves the
obligation itself, a shared case still used elsewhere, sibling obligation uses,
and contract-level requirement meaning. The resulting digest is suitable for a
fresh query or the next atomic mutation.

## Verification

`workspace_verify_proof` consumes the same saved map used by query and
validation. It resolves the exact candidate identity before execution and binds
the result to:

- the requested proof subject and, when supplied, its explicit
  `source: {unit, focus?}` selection;
- the canonical saved source (its selected unit and focus) and case revision;
- the resolved proof definition;
- the exact candidate commit and source snapshot;
- the invoked provider and its truthful outcome.

Each requested proof, obligation relationship and the aggregate is `proven`,
`unproven` or reason-coded `not_executable`, for the requested proofs against
the tested source only. The result presents two evidence dimensions beside that
verdict. `selected_test` and `selected_status` in the compact result and
`test_observation` in full evidence report which test ran and what it did
(`passed`, `failed`, `skipped`, or `not_observed` when no selected-test event
was recorded); `mutation_evidence` reports per-member falsification for that
same proof. A detected mutation adds falsification evidence and a surviving
supported mutation is counterevidence that makes the proof `unproven`.
Unavailable mutation is a capability limitation that neither earns nor
withholds credit: a passing selected test whose other required checks hold is
`proven` with that limitation, and the limitation never excuses a survivor
elsewhere. Incomplete or unevaluable mutation evidence for a passing candidate
is `not_executable` with its reason codes. Failed test execution is separate
from all three and retains its reason and diagnostics. Compact rows carry the
actual evaluator diagnostic codes and a recovery only where a correction is
known; the complete evidence retrieval preserves the original observations,
outcomes, limitations, relationships, and evaluator diagnostics. See
[test-proof runtime identity](test-proof-runtime-identity.md#capability-limitations).

An ID saved in more than one source refuses and lists every authorized source
as a ready retry call; the explicit `source` selects exactly one of them and
never searches another. See the
[operation reference](mcp-operation-reference.md) for the request forms.

Ordinary verification does not require preparation, a skeleton, a plan, a
carrier, publication, or prior validation. Missing source or capability facts
produce a nonexecution result. Authoring and validation remain nonexecuting.

## Internal owners

Carrier compilation, requirement compilation, proof-posture disposition,
generation persistence, assessment, graph integrity, semantic projection, and
runtime evaluation may remain internal when retained consumers use them.
Internal module names do not create public endpoints or caller-authored
construction steps.

Public registration, discovery, role policy, routing metadata, and active
guidance must agree on the public population. Unknown removed names are refused
by the MCP call boundary.

# MCP Selected Response Details

This page owns the serving composition for compact summaries and complete,
authenticated semantic selections. The task contracts are described in
[MCP Operation Reference](mcp-operation-reference.md) and
[MCP Integration](mcp-integration.md).

## Owners

`packages/wiki-mcp/src/lib/selected-response-snapshot.mjs` composes the incumbent
response retention, verified byte reader, registry and continuation owners. It
adds no store, codec, authority identity or independent limit.

- `mcp-response.mjs` retains originals once, verifies stored bytes, measures the
  larger structured/text representation and admits complete selected responses.
- `createTaskResultSnapshotRegistry` owns internal ordering, collections,
  snapshots, cursors, expiry and range accounting where a producer uses them.
- The route owner selects permitted semantic meaning and authenticates its
  source, repository, subject and session before exposing it.
- The serving request-contract store and canonical continuation owner admit
  every offered call against the actual registered consumer.

Internal byte storage, hashing, pager and codec machinery is server-owned.
Public task responses do not expose raw logs, public base64 or agent integrity
and reconstruction jobs. There is no generic public spill-reader bypass.

## Delivery bound

Ordinary summaries use
`min(WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES,activeMcpInlineByteLimit())`.
Admission measures the larger compact structured value or delivered text,
including escaping and calls. Physical serialized wire size carries both
representations and is a distinct measurement. The bound is no content cap:
complete explicitly selected meaning uses the shared selected-full class.
Native test answers alone preserve the 1,024 UTF-8 byte total response exception.

A summary discloses original availability and the next semantic selection. A
selected-full answer delivers that complete selected meaning as one structured
result, even above the ordinary inline limit. It preserves the privately minted
response object through final transport admission rather than rewrapping it as
an ordinary response or spilling it to a retired reader.

## Retained source

The shared owner retains `{schema_version,binding,carrier}` exactly once. The
binding contains producer route, repository, unit, optional query/observation
identity and authenticated authority identity. A locator is exactly `{ref_id}`:
one opaque eight-character handle matching `^[A-Za-z0-9_-]{8}$`, for example
`{ref_id:"aB3_dE9x"}`. It is a source selector, never authority, and it carries
no digest: the caller performs no integrity work. Authentication resolves the
handle to the server-held retention metadata, checks that metadata is the
handle's own well-formed record, verifies the stored byte count and full SHA-256
against it, and checks the server-resolved binding before projection. An unknown
handle, a payload without metadata, malformed metadata, changed bytes, a source
mismatch and unavailable identity retain their specific causes; a refused read
repairs no metadata, selects no other object and reruns no producer. A hot
snapshot or cursor continues from the snapshot already verified for that handle
and rereads nothing.

A handle is six random bytes as unpadded base64url. Retention reserves it by
exclusive creation before publishing it, so concurrent producers never share
one; an occupied or half-allocated handle is passed over and never overwritten
or reassigned, and a store with no free handle in the bounded attempt reports
the persistence failure. No handle is returned until both payload and metadata
are complete. An allocation that never published its metadata stays unavailable
and does not stop restart discovery of complete originals; a published object
with unreadable bytes reports its own cause.

Journals keep the `{ref_id,sha256}` pair they recorded as internal evidence.
A public projection of a journal record exposes only `ref_id`, and a
journal-routed read refuses with `content_reference_recorded_digest_mismatch`
when the recorded digest disagrees with the retention metadata.

Only handles of this form are locators. An original retained under an earlier,
longer identifier keeps its stored bytes and its journal records, and no public
call reads it: a request naming it is refused by the request contract, and a
journal or restart discovery that selects it reports
`source_locator_not_current` with no continuation and reruns nothing. It is not
reported as absent.

Protected retention records the actual owner call and authoritative request
schema. Storage producer IDs remain unchanged when a public facade changes its
name. Old metadata is not a compatibility route: only the current selected owner
can expose permitted semantic material. Reads create no new original, rerun no
producer and never fall back to another source.

## Selected-full delivery

`readSelectedResponseFull(source,{env,expected,route})` authenticates the original
and delivers its carrier only when the owner permits that complete carrier.
`readSelectedResponseProjection(source,{env,expected,route,project})` authenticates
identically and calls the route's trusted in-process projector on copies. The
projector chooses only the permitted semantic material and current read facts;
request/environment input never supplies an executable projector. Refused reads
invoke no projector and return no carrier content.

Expected binding includes producer route, repository, unit and authority
identity. Missing authority refuses. `selectedFullContent` verifies the retained
serialization against its locator and privately brands the returned result. The
final response guard recognizes that exact object and regenerates its text from
the same canonical value. Cloning or JSON-wrapping it loses this delivery class.

The production reader, code-index selections, candidate/publication/landing
originals and common-result semantic detail use this same owner. They add no
parallel store, schema table, fallback parser or public owner router.

## Wiki selections

`workspace_read_wiki` first names a saved unit, canonical record, document,
search, manifest, repository or worker assignment. It returns compact context
and a retained descriptor containing resource identity and observed revision,
not the resource's complete content. A later `reference` plus one semantic
`select` authenticates that resource and projects the selected value through its
native owner. The combined authoring revision comes from the current context;
source/currentness facts remain distinct.

The central policy has one read-selection grant owner. Each role's advertised
schema contains only its granted source/selection forms. Assignment reads use
the launcher's frozen bytes; findings reads use the authenticated review source.
A returned reference grants no arbitrary filesystem access or mutation.

A findings request authenticates its frozen review source before any reader
runs: the session's run binding must commit to this host's role, assigned unit,
run, canonical repository and review materialization (see
[launch and admission](mcp-dispatch-launch-and-admission.md)). The bound private
checkout is the source. The selected WK's work records, its entries -- a body,
an explicit version, history, a text choice and a material reference -- and its
controlled contract are read from that checkout through their owners' native
read paths, and another WK of the same source keeps the reviewed commit's files.
A source that was absent at capture is absent from the checkout, so a record
that had no contract at capture reads as honestly absent, and an incomplete or
draft captured contract stays readable without any execution-readiness
requirement. No canonical or live read replaces the checkout. The retained
reference's authority identity includes the run and its source binding, so a
reference is not exchangeable across runs. The binding does not detect edits
made inside the private checkout after launch, and a read made while that
checkout is being edited is not guaranteed an unchanged answer; a selected
source that is malformed when it is read refuses with its owner's own
diagnostic.

`workspace_assess_contract` computes a findings session's fresh assessment
over the same bound checkout. Every authored source the assessment reads comes
from the files captured into it: the selected WK's contract,
the selected work record that the design-workbench owner loads, the internal
acceptance-axis carrier when one was present, the optional scope record, and
the root contract carriers of a `related` work record when the saved-proof owner
reads them as the mapping contracts of a pinned proof's construction input. The
frozen assessment therefore states what the native owner states over the same
sources at capture, for the root focus and for each focus the selected contract
publishes. A source that was absent at capture is absent to the
assessment, because materialization removed the reviewed commit's older copy
from the checkout; a related record the assessment does not use is not part of
the capture, and any other read of it is a read of an ordinary record of the
source. Host capability and execution facts are
observed where the assessment runs and are not part of the capture. A retained
original is read back without recomputation.

Every refusal of the findings-source resolver reaches `workspace_read_wiki` as
`workspace-read-wiki-source-refusal.v1` with that resolver's own code and
subject: an unauthenticated session, a missing, duplicated or mismatched
binding, and an unavailable or unreadable materialization. Documents, canonical DEC and IN records and search read the
authenticated source root after the request's authentication.
Entry inventories preserve every member in source order, with exact identities,
versions and totals. A nonempty inventory with entry grants returns one
`selection_context` containing the unchanged authenticated reference and the
explicit binding `select:{entry:members[i].entry}`. Optional `version` pins an
exact saved version. At most one fully expanded primary call is published in
`next_calls`; empty or ungranted inventories offer no entry selection. There is
no member-by-member repetition of the locator, duplicate navigation array or
pagination of the requested population.

A selected entry body also returns `reference`, the entry owner's immutable
reference string for the exact returned `entry_id` and `version_id`, including
when the request selected the current version. Pass it unchanged as
`save_record`'s `changes.material_refs:[{ref:reference}]`, or read it with
`workspace_read_wiki({reference:{ref:reference},select:{field:"text"}})`.
It pins the complete returned body after later versions are appended. It is
distinct from the context's retained `{ref_id}` locator and grants no
source visibility: reads and assignment preparation still authenticate the
repository, source and role or frozen scope through their existing owners.

A WK root or slice context returns one `reference` and the complete ordered
`selections` it offers under the session's grants. At most one fully expanded
call is published in `next_calls`: the recommended selection, which is the
first member of `selections`; a context with no granted selection publishes
none. Every other choice is read by passing that `reference` unchanged with one
returned selector unchanged, as `{reference, select: selections[i]}`. The
reference is stated once beside the expanded call instead of once per choice,
and there is no per-selection call list, second navigation array or derived
selector. Selection order, grants, authentication, currentness and refusals are
those of the expanded form. Other contexts keep one expanded call per selection.

A requirement-guidance context is read the same way, and its one `reference`
serves every topic it offers. A complete topic answer returns that `reference`
unchanged with `selections`, the other offered topics in the context's order
without the topic just returned, so another topic is read as
`{reference, select: selections[i]}` with no further context request. The
answer is complete and publishes an empty `next_calls`. An optional
`subject.topic` only chooses the context's recommended selection.

Work context includes a small literal summary with its scalar extent. Orchestrator
context also reports the parent record's literal requirements and source extent,
including absent and empty values, for both root and slice reads. Recommendations
select granted information that is still missing: partially delivered prose or
a further inventory. Already complete, absent or empty prose is not recommended.
Full field selections remain complete.

Work context `facts` also carry two advisory review observations of the saved
record, each projected from its existing semantic owner. A record's `facts`
carry `terminal_review_designation`: a `state` of `missing`, `designated`,
`ambiguous` or `not_applicable`, the exact `eligible_count`, and `unit_id` only
when exactly one unit is eligible. A findings unit's `facts`, for a record or a
selected slice, and each findings member of the complete
`select:{inventory:"slices"}` population carry `review_purpose` only when one is
in effect: the authored value, or `standalone` for `review` work that authors
none. A `redteam` unit that stores no purpose, a non-findings unit and a unit
whose authored purpose is contradictory carry no key; the reader never derives,
defaults or persists one, and the contradiction remains a diagnostic of the
`integrity` selection. These facts are compact and bounded: one count and at
most one identity for the designation, one scalar per member for the purpose.
They are descriptive only. They add no selection, input or grant, and nothing
in a reader response turns them into a blocker, next action, dispatch,
admission, integration, handoff or recovery decision.

An initiative `action` names one exact action identity. Work actions use the
initiative-status owner's selected-unit view, including its complete relevant
facts, without initiative-wide actions or consistency rows. Missing and foreign
action identities refuse with `action_not_found`; ranking hints are not selectors.
The reader projects named `top_actions`, `next_action` and nested
`recommendations` through the current role's live registered request contracts.
Executable calls carry trusted known arguments. Missing authored values are
explicit `missing_inputs`; absent effect capabilities are explicit
`missing_capability` facts. Information-acquisition calls are distinguished from
the requested effect. Reading a graph or record never persists graph-impact
evidence, supplies an authored title or fabricates a write revision.

Canonical carrier validation failures preserve the native cause code, affected
subject, schema errors and diagnostics in a declared source refusal delivered
through the response owner. Schema errors share complete reasons with all
affected subjects and occurrence counts. The shared diagnostic owner preserves
AJV property names, escaped field pointers, schema paths and constraint
parameters before grouping, without row caps or field truncation. `subject_fields`
names the columns of each subject row. Shared pointer bindings concatenate their
literal `prefix`, the named subject field and literal escaped `suffix` to preserve
each exact address. A read never repairs invalid carrier bytes. Where no serving
correction exists, `next_calls` is empty and recovery explicitly
states `no_supported_route`, including the absent repair capability and inability
to acquire a current authenticated authoring revision from the invalid source.

Create/save originals and candidate/publication/landing originals delegate through
their producer's authenticated read composition. Current and original facts are
never conflated, and an original read invokes no corresponding mutation.

A save receipt is not the saved record and is granted no record or contract
selection. A request that attaches such a selection to a save receipt is refused
with `selection_not_granted`. When the save owner authenticates that receipt for
the session -- producer, repository, unit and session authority -- and the
session's own schema and grants permit the record context read, the refusal
carries exactly one call, `workspace_read_wiki({subject})` for the receipt's
authenticated root or slice unit. That call returns the unit's current context
and a fresh reference; it does not apply the refused selection, and the caller
selects from the returned context. The refusal reads no record, repeats no save
or check and leaves the receipt unchanged. A foreign repository, a missing or
changed reference, an owner authentication refusal and a role without the save
receipt read keep their own refusal and gain no correction.

An initiative offers its whole record as `select:{field:"record"}`; a saved work
unit does not. That selection on a work-unit root or slice reference is refused
with `field_not_applicable` after the reference's binding, grants and
currentness are checked. The refusal names the unit's applicable fields, the
same reference and its granted selections, and, when the session's schema and
grants permit the context read, exactly one call:
`workspace_read_wiki({reference, select:{context:true}})` with that reference
unchanged. That call returns the context and its choices, not the refused
whole-record content; the caller chooses one offered selection, and none is
inferred or followed for it. A foreign, unauthorized, missing, changed or stale
reference keeps its own refusal and recovery.

## Proof discovery and code-index selections

`workspace_find_proofs` called with no arguments browses the catalogue, and
that is the normal first call: it returns every listed proof once, in the
catalogue owner's order, or a bounded count with one exact call
(`next_calls.catalogue`) to the complete retained list. Two request forms
follow and are never mixed. A fresh read of the current catalogue is
`{proof_name, part?, target_family?}`, or `{query, target_family?}` to search.
A read from a returned original is `{result, selection?: {proof_name?,
part?}}`. Top-level `proof_name` and `part` belong to a fresh read;
`target_family` belongs to a fresh `proof_name` or `query` request and never
to a retained selection. The tool description and each field's description
state this distinction, because a client may render the fields without their
dependencies. A complete catalogue or index carries one executable call,
`next_calls.select`, and `next_calls.selection` says how to use it: copy the
complete supplied arguments, keep `result` unchanged, and replace only
`selection.proof_name` with the listed proof wanted. The call names the first
listed proof only as an example and recommends none; a later part goes inside
`selection`, as `selection.part`. `tools/list`
publishes these request forms on the one flat declaration, derived from the
enforced union: each field's dependency names what it requires and which
fields it excludes. The dependency is one-way: `selection` requires `result`,
and `result` alone is a valid request. A `selection` sent without a `result`
is refused for that cause and nothing is read. When the selection is otherwise
valid and names a proof, the refusal offers one guidance call, the top-level
`proof_name` request, labelled as a read of the current catalogue; it is not
the retained original and is never executed or substituted for it. An optional
`query` instead returns complete lexical matches by tier, or bounded
counts with one exact call to the complete retained index. A complete catalogue
or index also
carries `short_descriptions`: one catalogue sentence of at most 120 characters
for exactly the listed proofs, keyed by proof name and empty when nothing
matched. The sentences are navigation prose for comparing candidates; they are
retained verbatim with the original, never searched or ranked, and add no
guarantee or execution capability. Complete selections
return assertion, exclusions, capability and applicable authoring facts. The
overview and combined answer also carry the exact catalogue `short_description`
and `usage` prerequisites and fit/misuse scenarios with their admitted boundary.
These inline illustrations do not establish source applicability or turn every
unsuitable case into an evaluator refusal. Catalogue/index rows remain unchanged.
An overview states `verification_capability` and carries no construction
inventory or definition digest; a selected family's falsification states each
strategy by its `required` and `not_allowed` authored fields, its field
patterns and its target constraint, without the mechanism name or the fields
the save derives. These
facts are selected semantic meaning, not paged byte reconstruction. Every stored
discovery selection checks the owner's current catalogue identity without
re-ranking. Source movement refuses rather than mixing populations.

Authoring a proof that a test case verifies needs the family that runs the
test. `target_family` is an input of `workspace_find_proofs`, never of
`save_record`. When an answer carrying authoring has no selected family,
`authoring.family` names the missing input and its task, and
`next_calls.primary` is `choose_family`. `next_calls.choose_family.choices`
lists every family of the case-authoring owner by `family_id` and `runner`,
each with one exact call: `{proof_name, target_family, part: {kind:
"authoring"}}`. `runner`, there and in a selected family's
`authoring.family.runner`, is the runtime runner name `workspace_run_test`
takes as `runner`, for example `deno` or `go-test`; a command label such as
`deno test` is query vocabulary and never a runner identifier. Each call is a
fresh read of the current catalogue that
returns a new result. `target_family` is no selection of a retained result,
so the earlier original is unchanged and stays without a family. No family is
inferred, defaulted or read ahead, and a choice carries no family's authoring
detail. Until a family is chosen, `save.awaits_family` names the case target
and falsification fields instead of listing the family among
`save.missing_inputs`. `next_calls.select` and `parts` remain the secondary
reads of the same result's parameters and constraints. A selected or
query-identified family, and a proof that declares no test execution, gain no
choice step.

A selected family states the one selector member its case target takes in
`authoring.family.target.fields`, with that member's form beside it. Jest,
Vitest, Mocha, AVA, Deno and lib0/testing list `selector.title_path` and carry
`title_path_form`: the ordinary test titles as an array of strings, outermost
first, with `path` naming the test source file once. Every other
provider-qualified family lists `selector.node_id` and carries `node_id_form`.
The form is the selector grammar owner's own, captured with the answer, and
`save.missing_inputs` names the same member. Discovery states no serialized
identity for a title path and no encoding instruction: the provider owner
derives the stored test identity from the saved path and titles. Discovery
classifies no selector syntax and corrects no request; a selector member of
another family is refused by the save, which names the member to write.

An authoring answer carries only calls that read its own retained result
and, for a missing family, the family choice. Inline strategy examples accompany
target constraints; there is no linked-example route or call into the
requirement-authoring guidance. The selected proof's
`authoring` already states whether a case is required (`authoring.case`), the
values the answer establishes (`save.changes`) and every input that remains the
caller's own (`save.missing_inputs`). A proof that declares no test execution
lists no case input, family or case member, so nothing in its answer leads
into case authoring. Required configurable proof parameters in
`save.missing_inputs` come from retained source policies/cardinality, with schemas
left to parameter parts. The checklist describes a new complete selection, not
missing values in an existing WK; incomplete drafts remain savable. Selected
family target constraints include inline supported/rejected strategy snippets
chosen from the family’s existing languages, authored once per mechanism and
language variant. Retained reads preserve both guidance and examples. The answer
does not vary with the reading session's role.

`query_code_index` retains its published-index and currentness owner. Its returned
selections deliver complete semantic rows through authenticated selected-full
projection. The public reader never consumes an oversized internal spill page or
reruns the original query merely to recover an original.

Default code-index status keeps availability, indexed commit, observed HEAD,
freshness, dirty state, base/SCIP usability and coverage qualifications,
without the store's own incarnation and publication sequence: the
project, inactive-project, project-document, covered and uncovered document
counts and every scalar base, provider and SCIP fact, with unknown counts left
unknown. Deep provider and provenance populations remain exact in
authenticated status selections. File context leads with the requested file
and recommends its complete `source`. Both summaries carry concise
`selected_detail.choices`, sharing `source` and `snapshot_identity`. Each choice
is composed as `{detail:{source:selected_detail.source,
snapshot_identity:selected_detail.snapshot_identity,...choice}}` on the same
route. Status retains its evidence once without indexing or requesting refresh;
selected reads retain nothing further.

What status recommends follows what the index needs. A fresh usable index
lists `supported_questions`, the selectors of each code question, and
recommends no inspection: its evidence selection stays offered and is no
prerequisite for a question. A published index that is stale or whose provider
facts are partial recommends exactly one call, the focused `diagnosis`
selection, which states the exact cause, both commits and what this session
can do; a registered preparation call follows it, still offered. An absent
index recommends the registered preparation call when this session holds one;
when it holds none, `preparation` names the missing capability and the
diagnosis is the recommendation. No preparation call is invented and no
unchanged retry is offered as a remedy. The explicit `graph_snapshot`
selection remains the complete, passive provenance read.

The code route uses the registry's existing row projection and presentation
hooks for oversized rows. Their stable positions fit the internal row budget;
the presenter resolves those positions against the same authenticated semantic
selection and delivers the complete values through selected-full admission.
Identity, selection, boundary and recovery checks still run in the registry.
An internal `row_field_inventory_exceeds_delivery_bound` refusal is therefore
not required to retrieve a complete selected source or provenance member. The
route adds no pager, retention store or public reader.

## Common execution-result selections

`get_run_result` default answers are compact live/durable or retained summaries.
Standalone/recorded proof results keep their incumbent summary and diagnosis
owners. Native originals use the native outcome reader and its strict bound;
that owner retains its read/continue/retry vocabulary and source checks.

Coordinators discover recorded proofs through the selected run's compact
`proof_verification`: `none_recorded` describes a healthy empty population,
`recorded` carries its exact count and inventory call, and `unavailable` carries
the actual evidence failure. Following the inventory call returns all invocation
rows from one validated journal prefix, including their subject, tested source,
result identity and exact original read calls. A later append does not alter
those invocation selections. Authentication uses the prepared backend's
visibility owner and durable attempt selection; a hot denial cannot retry cold.

The shared response owner admits this complete inventory using the exact native
journal bytes from the same successful validated read. It checks their private
source digest and preserves the complete selection's transport class. Those
bytes, unrelated attempts and journal paths never become public locators. A
chosen original's emitted `detail:{member:"outcome"}` call similarly uses the
cache reader's already verified envelope and exact stored bytes, with no reread,
response snapshot, public pager or new storage owner.

A complete proof outcome contains the permitted semantic outcome and each proof's
selected diagnosis through the existing presentation owners. Failed and
not-executable outcomes retain their cause, selected identity and tested source;
later success cannot replace an earlier failure. Private runner captures, raw
stdout/stderr and full stacks remain in the immutable original. Complete semantic
delivery can exceed the ordinary response bound, while default observation and
summary responses remain bounded. Malformed or mixed selectors identify their
actual field; missing, corrupt and deficient evidence refuses rather than
substituting another invocation or an empty result. Every read preserves original
bytes, permissions and identities and performs no execution, publication,
integration, lifecycle advance or repair.

After authenticating a proof original and its entitlement, the common reader
applies the proof producer's shared recovery projector to a presentation copy.
The trusted receiving role, live registered request contracts and authenticated
authoring-source resolver determine which correction reads are actually usable.
The original's subject, source/focus, diagnostics, competing verification IDs,
invocation identity and digest remain its historical facts. Stored carrier bytes,
request schema, journal and cache are never replaced by this presentation.

Worker subject acquisition remains unavailable under its registered reader
schema. Recovery reports the exact saved source and obligation, missing
capability and correction boundary; it substitutes neither assignment observation
nor an invented reference. An entitled coordinator's nonfocused current-source
read stays callable. Focused or unknown authoring intent and frozen or unavailable
review sources retain their specific acquisition boundaries. Reviewer recovery
coverage grants no proof-original read route: role/attempt refusals precede
projection and disclose no evidence. Source movement or later successful proofs
do not repin or replace a historical failure. Reading a permitted authoring
context may retain its ordinary selected-resource descriptor; that transport
effect neither re-retains proof evidence nor mutates authoring or proof state.

Delivery, integration and observation detail selects one returned semantic member
with `{result:{ref_id},detail:{member}}`. The owner returns `member`, its
complete `value`, pure observation facts, the unchanged `result` locator once and
`selections`, one `{member}` selector for each other member of that same original
in original order. Another member is read by passing both unchanged, as
`{result, detail: selections[i]}`. The returned member is not among the
selections and no call rereads it; there is no expanded call per member, and a
complete detail publishes an empty `next_calls`. A default summary's member
calls are unchanged. No cursor, offset, length or base64 field is
public in this detail contract. A missing member refuses with its available member names;
it never becomes an empty successful result. The original is authenticated again
before this shared selected-full projection.

Complete child text is reachable only through a selected original member. Default
observation carries kind, missing-result diagnosis, text length, publication state
and availability, not internal publication/journal/result carriers. Producer
settlement captures the permitted terminal original once independently of reads.
A read never settles, captures, integrates, writes canonical/Git state or reruns.

Producer pending spans settlement, retained-original capture and durable worker
binding while the child
can already be terminal. `original_publication` distinguishes `pending`,
`captured`, `failed`, `not_configured` and `unavailable`; journal
`result_publication` describes the separate durable-result publication. Worker
capture reports `bound:true` after the locked publisher binds its locator to the
exact recorded attempt/result. Failure at stage `original_binding` preserves the
actual publisher refusal or cause and the successfully captured original; live
and authenticated held-locator reads still offer that original.
Accepted nonterminal and original-publication-pending observations return an
exact `get_run_result` call pinned to the server-selected subject and attempt,
without replaying a timeout. Available originals instead return their
authenticated member call. Successful bounded waits preserve the immediate
read's original locator. Failed publication preserves its actual cause, stage
and responsible owner; observation does not retry publication or offer a retry
promise. The complete frame still uses the shared summary bound.

Known originals survive restart under their original session/source binding.
For a bound managed worker, the existing subject/attempt observation authenticates
the journal-selected original before returning its exact locator and member call.
Repository, authority identity, unit and carrier subject/run must agree. Reads
preserve historical failure originals after later success and source movement;
subject-only selection still refuses ambiguity. Assigned worker metadata grants
no observation-original access. A durable result without an original binding
has no discoverable complete-original call. The observation states
`durable_result_has_no_retained_original`; a read does not manufacture a locator.
Retaining bytes and recording the immutable worker result are separate from
binding a discoverable original locator. A crash between those publications can
leave complete originals accessible through authenticated held locators while
subject/attempt discovery remains unavailable. Reads never scan stored originals,
backfill missing linkage or recapture. Advisory observation remains process-local;
its held original retains the same authenticated reader after restart.

## Authority identity

Each producer preserves its existing source and entitlement binding. Wiki context,
worker assignment, findings source, native caller, standalone proof source,
integration, delivery and observation keep distinct entitlement boundaries.
Integration originals authenticate the orchestrator and configured repository;
delivery and observation additionally bind their stored launcher identity. A
foreign repository/role/attempt/source refuses before selected material is
returned. Worker delivery originals remain available to their authenticated
worker; integration/observation originals require the orchestrator owner. Native
results remain available to their authenticated execution role.

Optional proof selectors name one exact subject or authored source tuple within
a proof original; they select no native, delivery, integration or observation
meaning. Assigned recorded invocation reads retain their original subject/source
through the existing worker journal/cache authentication owner.

An original source ambiguity offers exact `get_run_result` inspection calls.
Each authenticated source inspection returns its selected tuple and an optional,
nonrecommended `verify_proof` execution call constructed by the current proof
owner. Inspection executes nothing and leaves stored producer identities and
original bytes unchanged.

Malformed recorded selectors report the recorded schema's exact field and
constraint, including caller-supplied `recorded_invocation.invocation_id` when
missing. Recovery never substitutes assigned observation or drops a recognized
selector. Unsupported-key corrections retain the invocation and proof selection
and must satisfy the complete registered contract; mixed selectors require the
caller to choose one request meaning.

## Refusals and purity

Refusals state the actual cause, selected subject and supported fix. No read
silently captures missing evidence, repairs a journal, prepares a runtime,
refreshes a proof pin, advances a candidate, publishes or integrates. Unavailable
originals, live-state loss after restart and contradictory identity remain explicit.
Original and current observations can disagree because they address distinct
resources; each response preserves its own source identity and certainty.
